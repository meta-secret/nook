use super::*;
use crate::storage::indexed_db::{
    get_active_vault_id, import_vault_blob, load_from_indexed_db, switch_active_vault,
};
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

struct ImportFixture {
    records: Vec<ExternalEventLogRecord>,
    store_id: String,
    device_id: String,
    device_secret: String,
    device_public_key: nook_core::DevicePublicKey,
    signing_public_key: nook_core::DeviceSigningPublicKey,
}

async fn import_fixture(with_update: bool) -> anyhow::Result<ImportFixture> {
    let mut source = NookVaultManager::new();
    source.application = nook_core::VaultApplication::Extension;
    source
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser-WASM identity fixture: {error:?}"))?;
    source
        .finish_pin_device_protection("correct horse battery staple".to_owned())
        .await
        .map_err(|error| anyhow::anyhow!("protect extension device identity: {error:?}"))?;
    let identity = source.device_identity()?;
    source.initialize_genesis_vault(&identity)?;
    source.vault.store_id = nook_core::generate_store_id()?.to_string();
    source.bootstrap_event_log_genesis().await?;
    if with_update {
        source
            .set_vault_name("Candidate vault")
            .await
            .map_err(|error| anyhow::anyhow!("append candidate update: {error:?}"))?;
    }
    let signing_public_key = source.ensure_signing_identity().await?.public_key();
    let records = source
        .export_event_log_records()
        .await?
        .into_iter()
        .map(|record| ExternalEventLogRecord {
            event_id: record.event_id,
            event: record.event,
        })
        .collect();
    Ok(ImportFixture {
        records,
        store_id: source.vault.store_id.clone(),
        device_id: source.device.id.clone(),
        device_secret: source.device.identity_private_key.clone(),
        device_public_key: identity.public_key(),
        signing_public_key,
    })
}

async fn replacement_manager(
    fixture: &ImportFixture,
) -> anyhow::Result<(NookVaultManager, String)> {
    let previous_store_id = nook_core::generate_store_id()?.to_string();
    let previous_projection = nook_core::serialize_stored_yaml_with_unlock_name_architecture(
        &[],
        &nook_core::VaultUnlock::Keys,
        &[],
        nook_core::VaultStoreIdentityRef::Assigned(&previous_store_id),
        nook_core::VaultNameRef::Named("Previous vault"),
        nook_core::VaultVersionWrite::Initial,
        &nook_core::VaultArchitecture::default(),
    )?;
    import_vault_blob(previous_projection.as_str(), Some("Previous vault")).await?;
    switch_active_vault(&previous_store_id).await?;

    let mut replacement = NookVaultManager::new();
    replacement.application = nook_core::VaultApplication::Extension;
    replacement.device.id.clone_from(&fixture.device_id);
    replacement
        .device
        .identity_private_key
        .clone_from(&fixture.device_secret);
    replacement.vault.store_id.clone_from(&previous_store_id);
    replacement.vault.secrets_key = "previous-secrets-key".to_owned();
    replacement.vault.members_key = "previous-members-key".to_owned();
    replacement.event_log.signing_seed = "previous-signing-seed".to_owned();
    replacement.event_log.key_epoch = "previous-key-epoch".to_owned();
    replacement.sync_outbox.provider_id = "previous-provider".to_owned();
    replacement.sync_outbox.storage_mode = nook_core::StorageMode::Github;
    replacement.sync_outbox.access_token = "previous-access-token".to_owned();
    replacement.sync_outbox.repo_arg = "previous/repository".to_owned();
    Ok((replacement, previous_store_id))
}

async fn assert_rollback(
    manager: &NookVaultManager,
    previous_store_id: &str,
) -> anyhow::Result<()> {
    assert_eq!(manager.vault.store_id, previous_store_id);
    assert_eq!(manager.vault.secrets_key, "previous-secrets-key");
    assert_eq!(manager.vault.members_key, "previous-members-key");
    assert_eq!(manager.event_log.signing_seed, "previous-signing-seed");
    assert_eq!(manager.event_log.key_epoch, "previous-key-epoch");
    assert_eq!(manager.sync_outbox.access_token, "previous-access-token");
    assert_eq!(
        get_active_vault_id().await?.as_deref(),
        Some(previous_store_id)
    );
    let projection = load_from_indexed_db()
        .await?
        .ok_or_else(|| anyhow::anyhow!("restored active projection is missing"))?;
    assert_eq!(
        nook_core::read_vault_store_id(&projection)?,
        nook_core::VaultStoreIdentity::Assigned(previous_store_id.to_owned())
    );
    Ok(())
}

#[wasm_bindgen_test]
async fn extension_repair_import_replaces_sentinel_vault_and_preserves_device() -> anyhow::Result<()>
{
    let fixture = import_fixture(false).await?;
    let (mut replacement, _) = replacement_manager(&fixture).await?;
    replacement.vault.architecture = nook_core::VaultArchitecture::sentinel_personal(
        nook_core::DeviceMode::Standard,
        nook_core::SentinelPolicy {
            threshold: 2,
            required_participants: 3,
            ready_participants: 3,
        },
    );
    let status = replacement
        .import_extension_event_log_records(
            &fixture.store_id,
            &fixture.device_id,
            fixture.device_public_key.as_str(),
            fixture.signing_public_key.as_str(),
            fixture.records,
        )
        .await?;
    assert!(status.access_granted);
    assert_eq!(replacement.vault.store_id, fixture.store_id);
    assert_eq!(
        replacement.vault.architecture.vault_type,
        nook_core::VaultType::Simple
    );
    assert_eq!(replacement.device.id, fixture.device_id);
    assert_eq!(
        replacement.device.identity_private_key,
        fixture.device_secret
    );
    Ok(())
}

#[wasm_bindgen_test]
async fn denied_extension_import_restores_session_and_active_projection() -> anyhow::Result<()> {
    let fixture = import_fixture(false).await?;
    let (mut replacement, previous_store_id) = replacement_manager(&fixture).await?;
    let unrelated_signing_key = nook_core::SigningIdentity::generate()?.0.public_key();
    let status = replacement
        .import_extension_event_log_records(
            &fixture.store_id,
            &fixture.device_id,
            fixture.device_public_key.as_str(),
            unrelated_signing_key.as_str(),
            fixture.records,
        )
        .await?;
    assert!(!status.access_granted);
    assert_rollback(&replacement, &previous_store_id).await
}

#[wasm_bindgen_test]
async fn staged_extension_import_error_restores_session_and_active_projection() -> anyhow::Result<()>
{
    let mut fixture = import_fixture(true).await?;
    let dependent = fixture
        .records
        .pop()
        .ok_or_else(|| anyhow::anyhow!("candidate update event is missing"))?;
    for record in &fixture.records {
        crate::storage::event_db::remove_event_fixture(&fixture.store_id, &record.event_id).await?;
    }
    let (mut replacement, previous_store_id) = replacement_manager(&fixture).await?;
    assert!(
        replacement
            .import_extension_event_log_records(
                &fixture.store_id,
                &fixture.device_id,
                fixture.device_public_key.as_str(),
                fixture.signing_public_key.as_str(),
                vec![dependent],
            )
            .await
            .is_err()
    );
    assert_rollback(&replacement, &previous_store_id).await
}
