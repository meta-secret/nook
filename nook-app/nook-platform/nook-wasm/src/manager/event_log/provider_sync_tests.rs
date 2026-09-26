use crate::manager::session::NookEventLogSyncIssueState;

use super::*;
use nook_core::{
    DeviceIdentity, IsoTimestamp, SigningIdentity, VaultEvent, VaultEventBody,
    VaultEventSchemaVersion, VaultMetaState, VaultOperation,
};
use wasm_bindgen::JsError;
use wasm_bindgen_test::wasm_bindgen_test;

#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "framework boundary: test fixture constructs a signed event for provider export coverage"
    )
)]
pub(super) fn event_fixture() -> anyhow::Result<(EventId, EventStorageBytes, VaultEvent)> {
    let signing = SigningIdentity::generate()?.0;
    let event = VaultEvent::sign(
        VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: nook_core::StoreId::parse("store_testtoken11")?,
            actor_id: signing.actor_id()?,
            actor_signing_public_key: signing.public_key(),
            parents: Vec::new(),
            created_at: IsoTimestamp::parse("2026-08-15T00:00:00Z")?,
            key_epoch: EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?,
            operations: vec![VaultOperation::VaultCleared],
        },
        signing.signing_key(),
    )?;
    let event_id = event.id()?;
    let bytes = VaultEvent::serialize_event_storage_yaml(&event)?;
    Ok((event_id, bytes, event))
}

#[test]
fn projected_epoch_keys_use_the_current_auth_envelopes() -> anyhow::Result<()> {
    let identity = DeviceIdentity::generate()?;
    let keys = nook_core::VaultKeys::generate()?;
    let auth = identity.auth_record(&keys.secrets_key, &keys.members_key)?;
    let meta = VaultMetaState::from_stored_records(&[auth])?;

    let resolved = NookVaultManager::projected_epoch_keys(&meta, &identity)?;

    assert_eq!(resolved, keys);
    Ok(())
}

#[test]
#[cfg_attr(
    dylint_lib = "non_local_effect_before_unhandled_error",
    allow(
        non_local_effect_before_unhandled_error,
        reason = "the contract records a typed sync issue before rejecting the remote store"
    )
)]
fn rejected_event_log_classification_is_available_as_a_typed_issue() -> Result<(), JsError> {
    let mut manager = NookVaultManager::new();
    let classification = RemoteEventLogClassification::DifferentStore {
        local_store_id: "store_local12345".to_owned(),
        remote_store_id: "store_remote1234".to_owned(),
    };

    assert!(
        manager
            .guard_remote_event_log_classification("Sync provider", &classification)
            .is_err()
    );
    let issue = manager.take_event_log_sync_issue().issue()?;
    assert!(issue.is_store_mismatch());
    assert_eq!(issue.local_store_id()?, "store_local12345");
    assert_eq!(issue.remote_store_id()?, "store_remote1234");
    Ok(())
}

#[test]
fn empty_and_same_store_classifications_leave_no_pending_issue() -> Result<(), JsError> {
    let mut manager = NookVaultManager::new();
    for classification in [
        RemoteEventLogClassification::Empty,
        RemoteEventLogClassification::SameStore {
            store_id: "store_same12345".to_owned(),
        },
    ] {
        manager.guard_remote_event_log_classification("Drive", &classification)?;
        assert_eq!(
            manager.take_event_log_sync_issue().state(),
            NookEventLogSyncIssueState::Clear
        );
    }
    Ok(())
}

#[test]
#[cfg_attr(
    dylint_lib = "non_local_effect_before_unhandled_error",
    allow(
        non_local_effect_before_unhandled_error,
        reason = "the test intentionally observes and then inspects the stored multi-store issue"
    )
)]
fn multiple_store_classification_records_all_store_ids_in_the_issue() -> Result<(), JsError> {
    let mut manager = NookVaultManager::new();
    let classification = RemoteEventLogClassification::MultipleStores {
        store_ids: vec!["store_first1234".to_owned(), "store_second12".to_owned()],
    };
    let Err(error) = manager.guard_remote_event_log_classification("GitHub", &classification)
    else {
        return Err(JsError::new("multiple provider stores must be rejected"));
    };
    assert!(
        matches!(error, NookError::Database(message) if message.contains("store_first1234") && message.contains("store_second12"))
    );
    let issue = manager.take_event_log_sync_issue().issue()?;
    assert!(issue.is_multiple_stores());
    Ok(())
}

#[test]
fn provider_classification_errors_include_the_provider_and_store_context() {
    let mismatch = NookVaultManager::provider_store_mismatch_error(
        "Drive",
        "store_local12345",
        "store_remote1234",
    );
    assert!(matches!(
        mismatch,
        NookError::Database(message)
            if message == "Drive already contains another vault (local store_id store_local12345, provider store_id store_remote1234). Choose which vault to use before syncing."
    ));

    let multiple = NookVaultManager::provider_multiple_stores_error(
        "Backup folder",
        &["store_first1234".to_owned(), "store_second12".to_owned()],
    );
    assert!(matches!(
        multiple,
        NookError::Database(message)
            if message == "Backup folder contains multiple vault event logs (store_id: store_first1234, store_second12). Use a dedicated provider path for one vault before syncing."
    ));
}

#[test]
fn event_export_round_trips_content_addressed_records() -> anyhow::Result<()> {
    let (event_id, bytes, event) = event_fixture()?;
    let mut store = nook_core::LocalEventStore::new();
    store = store.put_event(nook_core::LocalEventWrite {
        event_id: event_id.clone(),
        bytes,
    });

    let records = NookVaultManager::export_event_records_from_store(&store)?;

    assert_eq!(records.len(), 1);
    let record = records
        .first()
        .ok_or_else(|| anyhow::anyhow!("exported event record must be present"))?;
    assert_eq!(record.event_id, event_id.as_str());
    assert_eq!(record.path, event_id.storage_path());
    assert_eq!(record.event.id()?, event.id()?);
    Ok(())
}

#[test]
fn event_export_rejects_corrupt_local_bytes() -> anyhow::Result<()> {
    let event_id = EventId::parse(&format!("sha256u:{}", "E".repeat(43)))?;
    let mut store = nook_core::LocalEventStore::new();
    store = store.put_event(nook_core::LocalEventWrite {
        event_id,
        bytes: b"corrupt event bytes".to_vec().into(),
    });

    assert!(NookVaultManager::export_event_records_from_store(&store).is_err());
    Ok(())
}

#[wasm_bindgen_test]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )
)]
fn wasm_projected_epoch_keys_reject_an_unknown_device() -> anyhow::Result<()> {
    let identity = DeviceIdentity::generate()?;
    let Err(error) = NookVaultManager::projected_epoch_keys(&VaultMetaState::default(), &identity)
    else {
        anyhow::bail!("missing auth envelope must fail closed");
    };
    assert!(matches!(
        error,
        NookError::Database(message)
            if message == "The current security epoch no longer authorizes this device."
    ));
    Ok(())
}

#[wasm_bindgen_test]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )
)]
#[cfg_attr(
    dylint_lib = "non_local_effect_before_unhandled_error",
    allow(
        non_local_effect_before_unhandled_error,
        reason = "the test intentionally observes and then inspects the stored provider issue"
    )
)]
fn wasm_provider_classification_errors_preserve_store_details() -> anyhow::Result<()> {
    let mut manager = NookVaultManager::new();
    let different = RemoteEventLogClassification::DifferentStore {
        local_store_id: "store_local12345".to_owned(),
        remote_store_id: "store_remote1234".to_owned(),
    };
    let Err(error) = manager.guard_remote_event_log_classification("Drive", &different) else {
        anyhow::bail!("different stores must be rejected");
    };
    assert!(matches!(
        error,
        NookError::Database(message)
            if message.contains("Drive")
                && message.contains("store_local12345")
                && message.contains("store_remote1234")
    ));

    let multiple = RemoteEventLogClassification::MultipleStores {
        store_ids: vec!["store_first1234".to_owned(), "store_second12".to_owned()],
    };
    let Err(error) = manager.guard_remote_event_log_classification("GitHub", &multiple) else {
        anyhow::bail!("multiple stores must be rejected");
    };
    assert!(matches!(
        error,
        NookError::Database(message)
            if message.contains("GitHub")
                && message.contains("store_first1234")
                && message.contains("store_second12")
    ));
    Ok(())
}

#[wasm_bindgen_test]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )
)]
#[cfg_attr(
    dylint_lib = "non_local_effect_before_unhandled_error",
    allow(
        non_local_effect_before_unhandled_error,
        reason = "the test intentionally observes and then inspects the mismatch issue"
    )
)]
fn private_drive_folder_target_keeps_store_id_mismatch_fail_closed() -> anyhow::Result<()> {
    let mut manager = NookVaultManager::new();
    manager.storage.mode = StorageMode::GoogleDrive;
    manager.storage.drive_event_parent = nook_core::DriveEventParent::PrivateAppDataFolder {
        folder_id: "stable-private-folder".to_owned(),
    };
    manager.storage.remote_ref = manager.storage.drive_event_parent.encode_storage_id();
    let classification = RemoteEventLogClassification::DifferentStore {
        local_store_id: "store_local12345".to_owned(),
        remote_store_id: "store_remote1234".to_owned(),
    };

    let Err(error) = manager.guard_remote_event_log_classification("Drive", &classification) else {
        anyhow::bail!("a private Drive target must not bypass the store_id guard");
    };
    assert!(matches!(
        error,
        NookError::Database(message)
            if message.contains("Drive")
                && message.contains("store_local12345")
                && message.contains("store_remote1234")
    ));
    let issue = manager
        .take_event_log_sync_issue()
        .issue()
        .map_err(|_| anyhow::anyhow!("expected a pending event-log sync issue"))?;
    assert!(issue.is_store_mismatch());
    assert_eq!(
        issue
            .local_store_id()
            .map_err(|_| anyhow::anyhow!("expected a local store ID on mismatch issue"))?,
        "store_local12345"
    );
    assert_eq!(
        issue
            .remote_store_id()
            .map_err(|_| anyhow::anyhow!("expected a remote store ID on mismatch issue"))?,
        "store_remote1234"
    );
    Ok(())
}

#[wasm_bindgen_test]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )
)]
async fn wasm_before_genesis_projection_is_a_safe_noop() -> anyhow::Result<()> {
    let mut manager = NookVaultManager::new();
    manager.vault.store_id = "store_projection_noop".to_owned();
    manager
        .persist_projected_key_epoch(&nook_core::VaultProjection::default())
        .await?;
    assert!(manager.event_log.key_epoch.is_empty());
    Ok(())
}

#[wasm_bindgen_test]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )
)]
async fn wasm_current_projection_persists_its_key_epoch() -> anyhow::Result<()> {
    let mut manager = NookVaultManager::new();
    manager.vault.store_id = format!("store_sync_epoch_{}", nook_core::StoreId::generate()?);
    let epoch = EventId::parse(&format!("sha256u:{}", "E".repeat(43)))?;
    let projection = nook_core::VaultProjection {
        epoch: ProjectionEpoch::Current(nook_core::KeyEpoch(epoch.clone())),
        ..Default::default()
    };

    manager.persist_projected_key_epoch(&projection).await?;

    assert_eq!(manager.event_log.key_epoch, epoch.as_str());
    Ok(())
}

#[wasm_bindgen_test]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )
)]
async fn wasm_adopting_the_active_epoch_is_idempotent_when_unlocked() -> anyhow::Result<()> {
    let mut manager = NookVaultManager::new();
    let keys = nook_core::VaultKeys::generate()?;
    let epoch = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
    let epoch_name = epoch.to_string();
    manager.event_log.key_epoch = epoch.to_string();
    manager.vault.crypto = VaultCryptoState::Unlocked(VaultCrypto::new(&keys.secrets_key)?);
    let projection = nook_core::VaultProjection {
        epoch: ProjectionEpoch::Current(nook_core::KeyEpoch(epoch)),
        ..Default::default()
    };

    manager.adopt_projected_security_epoch(&projection).await?;

    assert!(manager.vault.crypto.is_unlocked());
    assert_eq!(manager.event_log.key_epoch, epoch_name);
    Ok(())
}

#[wasm_bindgen_test]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )
)]
async fn wasm_sentinel_epoch_adoption_fails_closed_before_key_lookup() -> anyhow::Result<()> {
    let mut manager = NookVaultManager::new();
    manager.vault.architecture.vault_type = VaultType::Sentinel;
    manager.vault.secrets_key = "sentinel-secret".to_owned();
    manager.vault.members_key = "sentinel-members".to_owned();
    let epoch = EventId::parse(&format!("sha256u:{}", "E".repeat(43)))?;
    let projection = nook_core::VaultProjection {
        epoch: ProjectionEpoch::Current(nook_core::KeyEpoch(epoch)),
        ..Default::default()
    };

    let Err(error) = manager.adopt_projected_security_epoch(&projection).await else {
        anyhow::bail!("sentinel adoption requires the ceremony");
    };

    assert!(
        matches!(error, NookError::Encryption(message) if message == MultiDeviceError::SentinelCeremonyRequired.to_string())
    );
    assert!(manager.vault.secrets_key.is_empty());
    assert!(manager.vault.members_key.is_empty());
    assert!(!manager.vault.crypto.is_unlocked());
    Ok(())
}

#[wasm_bindgen_test]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )
)]
async fn local_outbox_queue_is_noop_without_a_provider_and_persists_with_one() -> anyhow::Result<()>
{
    let mut manager = NookVaultManager::new();
    manager.storage.mode = StorageMode::Local;
    let event_id = EventId::parse(&format!("sha256u:{}", "E".repeat(43)))?;

    manager
        .queue_event_outbox_for_current_provider(&event_id, b"no provider")
        .await?;
    manager.sync_outbox.provider_id = "local-outbox-test".to_owned();
    manager
        .queue_event_outbox_for_current_provider(&event_id, b"queued")
        .await?;
    assert_eq!(
        NookDatabase::load_outbox("local-outbox-test").await?,
        vec![(event_id.to_string(), b"queued".to_vec())]
    );
    NookDatabase::remove_outbox_entry(EventDbRemoveOutboxEntry {
        provider_id: "local-outbox-test",
        event_id: event_id.as_str(),
    })
    .await?;
    assert!(
        NookDatabase::load_outbox("local-outbox-test")
            .await?
            .is_empty()
    );
    Ok(())
}
