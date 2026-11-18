use super::*;
use crate::TypedInput;
use crate::manager::NookExternalEventLogRecords;
use crate::manager::search_catalog::extension_hint::{
    NookEncryptedSearchCatalogHint, NookExtensionLocalEventLogUpdate,
};
use crate::storage::event_db::{RemoteEventUnion, VaultEventPersistence};
use nook_core::{
    AuthEnvelopes, DeviceSigningPublicKey, MemberLabel, SearchCatalogHintAdmitRequest,
    SearchCatalogHintContext, SignedSearchCatalogHint, SymmetricKey, VaultEvent, VaultEventBody,
    VaultEventSchemaVersion,
};
use tsify::Ts;

struct CatalogPairingFixture {
    device: DeviceIdentity,
    signing_key: DeviceSigningPublicKey,
    approval: VaultOperation,
}

impl CatalogPairingFixture {
    async fn new(publisher: &NookVaultManager) -> anyhow::Result<Self> {
        let mut extension = NookVaultManager::new();
        extension.application = VaultApplication::Extension;
        extension
            .begin_local_identity_creation("Synthetic extension")
            .await
            .map_err(|_| anyhow::anyhow!("begin independent extension identity"))?;
        extension
            .finish_pin_device_protection("synthetic extension pin".to_owned())
            .await
            .map_err(|_| anyhow::anyhow!("protect independent extension identity"))?;
        let device = extension.device_identity()?;
        let signing_key = extension.ensure_signing_identity().await?.public_key();
        let secrets_key = SymmetricKey::parse(&publisher.vault.secrets_key)?;
        let members_key = SymmetricKey::parse(&publisher.vault.members_key)?;
        let auth = device.auth_record(&secrets_key, &members_key)?;
        let envelopes = AuthEnvelopes::parse(auth.value.as_str())?;
        let approval = VaultOperation::JoinApproved {
            device_id: device.app_id().clone(),
            encryption_public_key: device.public_key(),
            signing_public_key: signing_key.clone(),
            label: MemberLabel::from_trusted("Synthetic extension".to_owned()),
            secrets_key_ciphertext: envelopes.secrets_key,
            members_key_ciphertext: envelopes.members_key,
        };
        Ok(Self {
            device,
            signing_key,
            approval,
        })
    }

    fn receipt(&self, source: &ImportFixture) -> anyhow::Result<VaultEvent> {
        let [genesis] = source.records.as_slice() else {
            anyhow::bail!("expected the shared genesis before pairing");
        };
        Ok(VaultEvent::sign(
            VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: StoreId::parse(&source.store_id)?,
                actor_id: source.signer.actor_id()?,
                actor_signing_public_key: source.signer.public_key(),
                parents: vec![genesis.event.id()?],
                created_at: IsoTimestamp::parse("2026-08-15T00:00:00Z")?,
                key_epoch: genesis.event.body.key_epoch.clone(),
                operations: vec![self.approval.clone()],
            },
            source.signer.signing_key(),
        )?)
    }

    fn select(self, fixture: &mut ImportFixture) {
        fixture.device_id = self.device.app_id().as_str().to_owned();
        fixture.device_secret = self.device.secret_string().into_inner();
        fixture.device_public_key = self.device.public_key();
        fixture.signing_public_key = self.signing_key;
    }
}

#[wasm_bindgen_test]
async fn valid_encrypted_catalog_survives_local_pairing_and_is_reused_after_open()
-> anyhow::Result<()> {
    const ORIGIN: &str = "https://catalog-positive.example";
    const USERNAME: &str = "synthetic-catalog-user";
    let mut fixture = import_fixture(false).await?;
    let (mut publisher, _) = replacement_manager(&fixture).await?;
    publisher
        .open_extension_passkey_vault_js(
            &fixture.store_id,
            &fixture.device_id,
            fixture.device_public_key.as_str(),
            fixture.signing_public_key.as_str(),
        )
        .await
        .map_err(|_| anyhow::anyhow!("open source vault for catalog fixture"))?;
    publisher.application = VaultApplication::Simple;
    let pairing = CatalogPairingFixture::new(&publisher).await?;
    let receipt = pairing.receipt(&fixture)?;
    publisher
        .append_vault_operations(vec![pairing.approval.clone()])
        .await?;
    let bitwarden = serde_json::json!({
        "encrypted": false,
        "folders": [],
        "items": [{
            "type": 1,
            "name": "Synthetic catalog login",
            "notes": "",
            "login": {
                "username": USERNAME,
                "password": "synthetic-catalog-password",
                "uris": [{"uri": ORIGIN}],
                "fido2Credentials": [],
            },
        }],
    });
    publisher
        .import_bitwarden_json(serde_json::to_string(&bitwarden)?, String::new())
        .await
        .map_err(|_| anyhow::anyhow!("import synthetic catalog login"))?;
    fixture.records = publisher
        .export_event_log_records()
        .await?
        .into_iter()
        .map(|record| ExternalEventLogRecord {
            event_id: record.event_id,
            event: record.event,
        })
        .collect();

    let hint = publisher
        .export_extension_search_catalog_hint_js(&fixture.store_id)
        .await
        .map_err(|_| anyhow::anyhow!("export real encrypted catalog hint"))?
        .decode()?;
    let NookEncryptedSearchCatalogHint::Sealed { encoded } = &hint else {
        anyhow::bail!("source did not produce a catalog hint");
    };
    let store_id = StoreId::parse(&fixture.store_id)?;
    let store = NookDatabase::load_local_event_store(store_id.as_str()).await?;
    let graph = store.load_graph(store_id.as_str())?;
    let admitted = SignedSearchCatalogHint::admit(SearchCatalogHintAdmitRequest {
        encoded,
        context: SearchCatalogHintContext {
            store_id: &store_id,
            graph: &graph,
        },
    })?;
    let [bucket] = admitted.as_slice() else {
        anyhow::bail!("one imported login must produce one encrypted bucket");
    };
    let expected = vec![(
        u8::from(bucket.bucket),
        bucket.ciphertext.as_str().to_owned(),
    )];
    assert!(
        NookDatabase::load_secret_search_catalog_buckets(store_id.as_str())
            .await?
            .is_empty()
    );
    let receipt_id = receipt.id()?;
    let receipt_bytes = VaultEvent::serialize_event_storage_yaml(&receipt)?;
    VaultEventPersistence::new(store_id.as_str())
        .union_remote(RemoteEventUnion {
            events: &[(receipt_id, receipt_bytes.into())],
        })
        .await?;
    pairing.select(&mut fixture);

    let (mut receiver, _) = replacement_manager(&fixture).await?;
    receiver.lock_device_identity();
    let update = serde_json::json!({
        "vaultStoreId": fixture.store_id,
        "deviceId": fixture.device_id,
        "devicePublicKey": fixture.device_public_key,
        "deviceSigningPublicKey": fixture.signing_public_key,
        "catalogHint": hint,
    });
    let update = js_sys::JSON::parse(&serde_json::to_string(&update)?)
        .map_err(|_| anyhow::anyhow!("construct typed positive event update"))?;
    let update = NookExternalEventLogRecords(std::mem::take(&mut fixture.records))
        .with_local_update(&Ts::<NookExtensionLocalEventLogUpdate>::new_unchecked(
            update,
        ))
        .map_err(|_| anyhow::anyhow!("prepare typed positive event update"))?;
    let status = receiver
        .import_extension_local_event_log_update_js(update)
        .await
        .and_then(|status| status.to_object())
        .map_err(|_| anyhow::anyhow!("accept signed event update with encrypted cache"))?
        .decode()?;
    assert!(status.access_granted);
    assert_eq!(status.heads.len(), 2);
    assert!(NookDatabase::load_secret_search_catalog_buckets(store_id.as_str()).await? == expected);

    let (mut reader, _) = replacement_manager(&fixture).await?;
    reader
        .open_extension_passkey_vault_js(
            &fixture.store_id,
            &fixture.device_id,
            fixture.device_public_key.as_str(),
            fixture.signing_public_key.as_str(),
        )
        .await
        .map_err(|_| anyhow::anyhow!("authorize a fresh extension reader"))?;
    let accounts = reader
        .list_website_login_accounts(ORIGIN)
        .await
        .map_err(|_| anyhow::anyhow!("match the imported synthetic login"))?;
    let [account] = accounts.as_slice() else {
        anyhow::bail!("expected exactly one matched login");
    };
    assert_eq!(account.username(), USERNAME);
    // A fresh per-record rebuild would write a newly encrypted ciphertext.
    assert!(NookDatabase::load_secret_search_catalog_buckets(store_id.as_str()).await? == expected);
    Ok(())
}
