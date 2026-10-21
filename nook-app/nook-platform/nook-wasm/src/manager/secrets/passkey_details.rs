//! On-demand public detail projection for one stored website passkey.

use super::NookVaultManager;
use crate::{NookDatabase, NookPasskeyDetails};
use nook_core::{PasskeyDetailRead, SecretId, StoreId, VaultProjection};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
    /// Decrypt one passkey just long enough to project its public details.
    ///
    /// The full record, including the private key, is zeroized before return
    /// on every path. Non-passkey items are rejected.
    #[wasm_bindgen]
    pub async fn passkey_details_js(&self, id: &str) -> Result<NookPasskeyDetails, JsError> {
        let crypto = self.vault.crypto.get()?;
        let store_id = StoreId::parse(&self.vault.store_id)?;
        let store = NookDatabase::load_local_event_store_strict(store_id.as_str()).await?;
        let graph = store.load_graph(store_id.as_str())?;
        let projection = VaultProjection::from_graph(&graph, store_id.as_str())?;
        let id = SecretId::from_vault_record(id);
        let details = PasskeyDetailRead {
            projection: &projection,
            graph: &graph,
            store_id: &store_id,
            selected_id: &id,
            crypto,
        }
        .read()?;
        Ok(NookPasskeyDetails::from_core(details))
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use crate::NookPasskeyNameState;
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    use nook_core::{
        DeviceIdentity, LoginSecret, PasskeyRegistrationRequest, PasskeyRelyingParty, PasskeyUser,
        PasskeyUserVerification, SecretType, SecretValue,
    };
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn js<T>(result: Result<T, JsError>) -> anyhow::Result<T> {
        result.map_err(|error| anyhow::anyhow!("{error:?}"))
    }

    #[wasm_bindgen_test]
    async fn empty_session_rejects_passkey_details() {
        let manager = NookVaultManager::new();
        assert!(manager.passkey_details_js("secret_missing").await.is_err());
    }

    #[wasm_bindgen_test]
    async fn imported_assertion_resolves_the_displayed_revision_in_actual_manager()
    -> anyhow::Result<()> {
        use crate::manager::event_log::ExternalEventLogRecord;
        use crate::manager::passkeys::{
            decode_website_passkey_assertion_request, decode_website_passkey_registration_request,
        };
        use crate::manager::secrets::event_log::NookExternalEventLogRecords;

        let mut extension = NookVaultManager::new();
        js(extension.delete_local_browser_data().await)?;
        let identity = DeviceIdentity::generate()?;
        extension.device.identity_private_key = identity.secret_string().into_inner();
        extension.initialize_genesis_vault(&identity)?;
        extension.vault.store_id = StoreId::generate()?.to_string();
        extension.bootstrap_event_log_genesis().await?;
        let active = js_sys::Function::new_no_args("return true;");
        let registration = js(decode_website_passkey_registration_request(
            r#"{"origin":"https://login.example.com","challenge":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc","relyingParty":{"id":"example.com","name":"Example"},"user":{"id":"dXNlci0xMjM","name":"alice@example.com","displayName":"Alice"},"algorithms":[-7],"residentKeyRequired":true,"userVerification":"required"}"#,
        ))?;
        let registered = js(extension
            .register_website_passkey(&registration, &active)
            .await)?;

        let mut website = NookVaultManager::new();
        website.device.identity_private_key = identity.secret_string().into_inner();
        website.vault.store_id.clone_from(&extension.vault.store_id);
        website.apply_vault_keys(&extension.vault.secrets_key, &extension.vault.members_key)?;
        website.apply_event_projection_to_session().await?;
        let page = website.query_secret_page(
            "",
            nook_core::SecretTypeFilter::Only(SecretType::Passkey),
            0,
            50,
        )?;
        let selected = page
            .records
            .first()
            .ok_or_else(|| anyhow::anyhow!("registration was not listed"))?
            .id
            .clone();
        let before = js(website.passkey_details_js(selected.as_str()).await)?;
        assert_eq!(before.signature_count(), 0);

        let assertion = js(decode_website_passkey_assertion_request(
            r#"{"origin":"https://login.example.com","challenge":"CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg","rpId":"example.com","userVerification":"required"}"#,
        ))?;
        js(extension.assert_website_passkey(&assertion, &active).await)?;
        let exported = extension.export_event_log_records().await?;
        let imported = exported
            .into_iter()
            .map(|record| ExternalEventLogRecord {
                event_id: record.event_id,
                event: record.event,
            })
            .collect();
        js(website
            .sync_external_event_log_records_js(NookExternalEventLogRecords(imported))
            .await)?;
        assert!(!website.vault.meta.secrets.contains_key(&selected));
        let details = js(website.passkey_details_js(selected.as_str()).await)?;
        assert_eq!(details.credential_id(), registered.credential_id());
        assert_eq!(details.user_name(), "alice@example.com");
        assert_eq!(details.signature_count(), 1);

        let current_page = website.query_secret_page(
            "",
            nook_core::SecretTypeFilter::Only(SecretType::Passkey),
            0,
            50,
        )?;
        let current = current_page
            .records
            .first()
            .ok_or_else(|| anyhow::anyhow!("replacement was not listed"))?
            .id
            .clone();
        js(website.delete_secret(current.to_string()).await)?;
        assert!(website.passkey_details_js(selected.as_str()).await.is_err());
        website.clear_vault_keys();
        assert!(website.passkey_details_js(selected.as_str()).await.is_err());
        js(website.delete_local_browser_data().await)?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn stored_passkey_projects_details_and_other_items_are_rejected() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        js(manager.delete_local_browser_data().await)?;
        let identity = DeviceIdentity::generate()?;
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.initialize_genesis_vault(&identity)?;
        manager.vault.store_id = nook_core::StoreId::generate()?.to_string();
        manager.bootstrap_event_log_genesis().await?;

        let request = PasskeyRegistrationRequest {
            origin: "https://login.example.com".to_owned(),
            challenge: URL_SAFE_NO_PAD.encode([7_u8; 32]),
            relying_party: PasskeyRelyingParty {
                id: "example.com".to_owned(),
                name: "Example".to_owned(),
            },
            user: PasskeyUser {
                id: URL_SAFE_NO_PAD.encode(b"user-123"),
                name: "alice@example.com".to_owned(),
                display_name: "Alice".to_owned(),
            },
            algorithms: vec![-7],
            exclude_credentials: Vec::new(),
            resident_key_required: true,
            user_verification: PasskeyUserVerification::Required,
        };
        let credential = request.prepare(&[])?.generate()?.credential;
        let credential_id = credential.credential_id.clone();
        let passkey_id = js(manager.generate_secret_id())?;
        let passkey_data = SecretValue::Passkey(credential).to_yaml()?.into_inner();
        js(manager
            .add_secret(passkey_id.clone(), SecretType::Passkey, passkey_data)
            .await)?;

        let details = js(manager.passkey_details_js(&passkey_id).await)?;
        assert_eq!(details.credential_id(), credential_id);
        assert_eq!(
            details.relying_party_name_state(),
            NookPasskeyNameState::Distinct
        );
        assert_eq!(details.relying_party_name(), "Example");
        assert_eq!(details.user_name_state(), NookPasskeyNameState::Distinct);
        assert_eq!(details.user_name(), "alice@example.com");
        assert!(details.public_key_fingerprint().starts_with("SHA256:"));
        assert_eq!(details.signature_count(), 0);

        let login_id = js(manager.generate_secret_id())?;
        let login_data = SecretValue::Login(LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "alice".to_owned(),
            password: "login-password".to_owned(),
            notes: String::new(),
        })
        .to_yaml()?
        .into_inner();
        js(manager
            .add_secret(login_id.clone(), SecretType::Login, login_data)
            .await)?;
        assert!(manager.passkey_details_js(&login_id).await.is_err());

        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }
}
