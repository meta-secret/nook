use super::*;
use crate::storage::indexed_db::{
    get_active_vault_id, import_vault_blob, list_vault_registry_entries, load_from_indexed_db,
    load_vault_blob, switch_active_vault,
};
use crate::vault_api::list_local_vaults;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

#[wasm_bindgen_test]
async fn pin_protection_bootstraps_the_initial_identity() -> anyhow::Result<()> {
    let mut manager = NookVaultManager::new();
    manager
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;

    manager
        .finish_pin_device_protection("correct horse battery staple".to_owned())
        .await
        .map_err(|error| anyhow::anyhow!("protect device: {error:?}"))?;
    let request = manager
        .identity_directory_snapshot_request()
        .map_err(|error| anyhow::anyhow!("build identity snapshot request: {error:?}"))?;
    let snapshot = request
        .resolve()
        .await
        .map_err(|error| anyhow::anyhow!("resolve identity snapshot: {error:?}"))?;

    assert_eq!(snapshot.length(), 1);
    assert_eq!(
        snapshot.selection_kind(),
        crate::identity_record::NookIdentityDirectorySelectionKind::Selected
    );
    assert_eq!(
        snapshot
            .identity(0)
            .map_err(|error| anyhow::anyhow!("read initial identity: {error:?}"))?
            .label(),
        "Personal"
    );
    manager
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    Ok(())
}

#[wasm_bindgen_test]
async fn passkey_protection_bootstraps_the_initial_identity() -> anyhow::Result<()> {
    let mut manager = NookVaultManager::new();
    manager
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    let setup = nook_core::DeviceKeyProtectionSetup::generate()?;

    manager
        .finish_device_protection(
            vec![7u8; 32],
            setup.user_handle().to_vec(),
            setup.prf_input().to_vec(),
            vec![21u8; 32],
        )
        .await
        .map_err(|error| anyhow::anyhow!("protect device with passkey: {error:?}"))?;
    let request = manager
        .identity_directory_snapshot_request()
        .map_err(|error| anyhow::anyhow!("build identity snapshot request: {error:?}"))?;
    let snapshot = request
        .resolve()
        .await
        .map_err(|error| anyhow::anyhow!("resolve identity snapshot: {error:?}"))?;

    assert_eq!(snapshot.length(), 1);
    assert_eq!(
        snapshot
            .identity(0)
            .map_err(|error| anyhow::anyhow!("read initial identity: {error:?}"))?
            .label(),
        "Personal"
    );
    manager
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    Ok(())
}

#[wasm_bindgen_test]
async fn authenticated_legacy_key_bootstraps_keyring_and_preserves_signer() -> anyhow::Result<()> {
    let mut manager = NookVaultManager::new();
    manager
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    let app_key = nook_core::AppKey::generate()?;
    let wrapped =
        nook_core::wrap_device_identity_with_pin(&app_key.secret_string(), "legacy identity pin")?;
    let (legacy_signing, legacy_seed) = nook_core::SigningIdentity::generate()?;
    crate::storage::indexed_db::save_wrapped_device_identity(app_key.app_id().as_str(), &wrapped)
        .await?;
    crate::storage::event_db::save_signing_seed(legacy_seed.as_str()).await?;

    manager
        .unlock_pin_device_identity("legacy identity pin".to_owned())
        .await
        .map_err(|error| anyhow::anyhow!("unlock legacy identity: {error:?}"))?;

    let keyring = crate::storage::identity_record::load_keyring().await?;
    assert_eq!(keyring.entries().len(), 1);
    assert_eq!(keyring.entries()[0].app_id(), app_key.app_id());
    assert!(keyring.entries()[0].has_signing_seed());
    assert_eq!(
        manager.ensure_signing_identity().await?.public_key(),
        legacy_signing.public_key()
    );
    assert!(
        crate::storage::event_db::load_signing_seed()
            .await?
            .is_none()
    );
    manager
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    Ok(())
}

#[wasm_bindgen_test]
async fn local_identities_never_fall_back_to_the_singleton_signing_seed() -> anyhow::Result<()> {
    let mut manager = NookVaultManager::new();
    manager
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    manager
        .finish_pin_device_protection("first identity pin".to_owned())
        .await
        .map_err(|error| anyhow::anyhow!("protect first identity: {error:?}"))?;
    let first_request = manager
        .identity_directory_snapshot_request()
        .map_err(|error| anyhow::anyhow!("build first identity snapshot: {error:?}"))?;
    let first_snapshot = first_request
        .resolve()
        .await
        .map_err(|error| anyhow::anyhow!("resolve first identity snapshot: {error:?}"))?;
    let first_identity_id = first_snapshot
        .identity(0)
        .map_err(|error| anyhow::anyhow!("read first identity: {error:?}"))?
        .identity_id();
    let first_app_id = manager.device_id();
    let first_signing_public_key = manager.ensure_signing_identity().await?.public_key();
    assert!(
        crate::storage::event_db::load_signing_seed()
            .await?
            .is_none()
    );

    manager
        .begin_local_identity_creation("Work")
        .await
        .map_err(|error| anyhow::anyhow!("begin second identity: {error:?}"))?;
    manager
        .finish_pin_device_protection("second identity pin".to_owned())
        .await
        .map_err(|error| anyhow::anyhow!("protect second identity: {error:?}"))?;
    let second_request = manager
        .identity_directory_snapshot_request()
        .map_err(|error| anyhow::anyhow!("build second identity snapshot: {error:?}"))?;
    let second_snapshot = second_request
        .resolve()
        .await
        .map_err(|error| anyhow::anyhow!("resolve second identity snapshot: {error:?}"))?;
    let second_identity_id = second_snapshot
        .selected_identity_id()
        .map_err(|error| anyhow::anyhow!("read second identity: {error:?}"))?;
    let second_app_id = manager.device_id();

    let observer = NookVaultManager::new();
    let observer_request = observer
        .identity_directory_snapshot_request()
        .map_err(|error| anyhow::anyhow!("build observer identity snapshot: {error:?}"))?;
    let observer_snapshot = observer_request
        .resolve()
        .await
        .map_err(|error| anyhow::anyhow!("resolve observer identity snapshot: {error:?}"))?;
    assert_eq!(
        observer_snapshot
            .selected_identity_id()
            .map_err(|error| anyhow::anyhow!("read observer identity: {error:?}"))?,
        second_identity_id
    );
    assert_eq!(
        observer_snapshot
            .device_access()
            .device_id()
            .value()
            .map_err(|error| anyhow::anyhow!("read observer app id: {error:?}"))?,
        second_app_id
    );
    let second_signing_public_key = manager.ensure_signing_identity().await?.public_key();
    assert_ne!(first_signing_public_key, second_signing_public_key);
    assert!(
        crate::storage::event_db::load_signing_seed()
            .await?
            .is_none()
    );

    manager
        .activate_local_identity(first_identity_id.clone())
        .await
        .map_err(|error| anyhow::anyhow!("select first identity: {error:?}"))?;
    assert_eq!(manager.device_id(), first_app_id);
    crate::storage::identity_record::select_local_identity(nook_core::IdentityId::parse(
        &second_identity_id,
    )?)
    .await?;
    assert_eq!(
        manager
            .local_identity_recovery_app_id()
            .await
            .map_err(|error| anyhow::anyhow!("read first recovery app id: {error:?}"))?,
        first_app_id
    );
    manager
        .unlock_pin_device_identity("first identity pin".to_owned())
        .await
        .map_err(|error| anyhow::anyhow!("unlock first identity: {error:?}"))?;
    assert_eq!(
        manager.ensure_signing_identity().await?.public_key(),
        first_signing_public_key
    );
    assert!(
        crate::storage::event_db::load_signing_seed()
            .await?
            .is_none()
    );
    manager.lock_device_identity();
    assert_eq!(manager.device_id(), first_app_id);
    assert_eq!(
        manager
            .local_identity_recovery_app_id()
            .await
            .map_err(|error| anyhow::anyhow!("read retained recovery app id: {error:?}"))?,
        first_app_id
    );
    manager
        .unlock_pin_device_identity("first identity pin".to_owned())
        .await
        .map_err(|error| anyhow::anyhow!("unlock retained first identity: {error:?}"))?;
    assert_eq!(manager.device_id(), first_app_id);

    manager
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    Ok(())
}

#[wasm_bindgen_test]
async fn simple_genesis_uses_the_tabs_app_key_after_another_tab_switches_identity()
-> anyhow::Result<()> {
    let mut first_tab = NookVaultManager::new();
    first_tab
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    first_tab
        .finish_pin_device_protection("first identity pin".to_owned())
        .await
        .map_err(|error| anyhow::anyhow!("protect first identity: {error:?}"))?;
    let first_key = first_tab.device_identity()?;
    let first_identity_id = crate::storage::identity_record::load_identity_directory()
        .await?
        .identity_for_app_key(&first_key)?
        .ok_or_else(|| anyhow::anyhow!("first identity is missing"))?;

    let mut second_tab = NookVaultManager::new();
    second_tab
        .begin_local_identity_creation("Work")
        .await
        .map_err(|error| anyhow::anyhow!("begin second identity: {error:?}"))?;
    second_tab
        .finish_pin_device_protection("second identity pin".to_owned())
        .await
        .map_err(|error| anyhow::anyhow!("protect second identity: {error:?}"))?;
    let selected_by_second_tab = crate::storage::identity_record::load_identity_directory()
        .await?
        .selected()?
        .identity_id
        .clone();
    assert_ne!(selected_by_second_tab, first_identity_id);

    let pending = first_tab
        .initialize_genesis_vault_with_identity(&first_key)
        .await?;

    assert_eq!(pending.identity_id, first_identity_id);
    assert_eq!(
        crate::storage::identity_record::load_identity_directory()
            .await?
            .selection(),
        &nook_core::IdentitySelection::Selected(selected_by_second_tab),
    );
    first_tab
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    Ok(())
}

#[wasm_bindgen_test]
async fn staged_genesis_uses_the_live_authorizer_after_another_tab_switches_identity()
-> anyhow::Result<()> {
    let mut first_tab = NookVaultManager::new();
    first_tab
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    first_tab
        .finish_pin_device_protection("first identity pin".to_owned())
        .await
        .map_err(|error| anyhow::anyhow!("protect first identity: {error:?}"))?;
    let first_key = first_tab.device_identity()?;
    let first_identity_id = crate::storage::identity_record::load_identity_directory()
        .await?
        .identity_for_app_key(&first_key)?
        .ok_or_else(|| anyhow::anyhow!("first identity is missing"))?;

    let mut second_tab = NookVaultManager::new();
    second_tab
        .begin_local_identity_creation("Work")
        .await
        .map_err(|error| anyhow::anyhow!("begin second identity: {error:?}"))?;
    second_tab
        .finish_pin_device_protection("second identity pin".to_owned())
        .await
        .map_err(|error| anyhow::anyhow!("protect second identity: {error:?}"))?;
    let selected_by_second_tab = crate::storage::identity_record::load_identity_directory()
        .await?
        .selected()?
        .identity_id
        .clone();
    assert_ne!(selected_by_second_tab, first_identity_id);

    let extension_key = nook_core::AppKey::generate()?;
    let (extension_signer, extension_signing_seed) = nook_core::SigningIdentity::generate()?;
    let (authorizer_signer, _) = nook_core::SigningIdentity::generate()?;
    first_tab.device.id = extension_key.app_id().as_str().to_owned();
    first_tab.device.identity_private_key = extension_key.secret_string().into_inner();
    first_tab.device.pending_extension_handoff = Some(
        super::super::device_protection::PendingExtensionIdentityHandoff {
            enrollment: super::super::PendingExtensionIdentityEnrollment::VaultCreation {
                authorizer: Some(first_key.clone()),
            },
            authorizer_signing: Some((first_key.app_id().clone(), authorizer_signer.public_key())),
            signing_public_key: extension_signer.public_key(),
            handoff_signing_seed: extension_signing_seed.as_str().to_owned(),
            persist_signing_seed: true,
            previous_session_signing_seed: String::new(),
        },
    );

    let pending = first_tab
        .initialize_genesis_vault_with_identity(&extension_key)
        .await?;

    assert_eq!(pending.identity_id, first_identity_id);
    let staged = pending
        .staged_identity()
        .ok_or_else(|| anyhow::anyhow!("staged identity is missing"))?;
    assert_eq!(
        staged.directory.identity_for_app_key(&extension_key)?,
        Some(first_identity_id),
    );
    assert_eq!(
        crate::storage::identity_record::load_identity_directory()
            .await?
            .selection(),
        &nook_core::IdentitySelection::Selected(selected_by_second_tab),
    );
    first_tab
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    Ok(())
}

#[wasm_bindgen_test]
async fn locked_passkey_tab_ignores_another_tabs_selection() -> anyhow::Result<()> {
    let mut manager = NookVaultManager::new();
    manager
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    let first_credential = vec![7u8; 32];
    let first_user_handle = vec![8u8; 32];
    let first_prf_input = vec![9u8; 32];
    let first_prf_output = vec![10u8; 32];
    manager
        .finish_device_protection(
            first_credential.clone(),
            first_user_handle,
            first_prf_input.clone(),
            first_prf_output.clone(),
        )
        .await
        .map_err(|error| anyhow::anyhow!("protect first passkey identity: {error:?}"))?;
    let first_app_id = manager.device_id();
    let first_request = manager
        .identity_directory_snapshot_request()
        .map_err(|error| anyhow::anyhow!("build first identity snapshot: {error:?}"))?;
    let first_snapshot = first_request
        .resolve()
        .await
        .map_err(|error| anyhow::anyhow!("resolve first identity snapshot: {error:?}"))?;
    let first_identity_id = first_snapshot
        .selected_identity_id()
        .map_err(|error| anyhow::anyhow!("read first identity: {error:?}"))?;

    manager
        .begin_local_identity_creation("Work")
        .await
        .map_err(|error| anyhow::anyhow!("begin second identity: {error:?}"))?;
    manager
        .finish_pin_device_protection("second identity pin".to_owned())
        .await
        .map_err(|error| anyhow::anyhow!("protect second PIN identity: {error:?}"))?;
    let second_request = manager
        .identity_directory_snapshot_request()
        .map_err(|error| anyhow::anyhow!("build second identity snapshot: {error:?}"))?;
    let second_snapshot = second_request
        .resolve()
        .await
        .map_err(|error| anyhow::anyhow!("resolve second identity snapshot: {error:?}"))?;
    let second_identity_id = second_snapshot
        .selected_identity_id()
        .map_err(|error| anyhow::anyhow!("read second identity: {error:?}"))?;

    manager
        .activate_local_identity(first_identity_id.clone())
        .await
        .map_err(|error| anyhow::anyhow!("select first passkey identity: {error:?}"))?;
    manager
        .unlock_device_identity(first_prf_output.clone())
        .await
        .map_err(|error| anyhow::anyhow!("unlock first passkey identity: {error:?}"))?;
    crate::storage::identity_record::select_local_identity(nook_core::IdentityId::parse(
        &second_identity_id,
    )?)
    .await?;
    manager.lock_device_identity();
    let retained_request = manager
        .identity_directory_snapshot_request()
        .map_err(|error| anyhow::anyhow!("build retained identity snapshot: {error:?}"))?;
    let retained_snapshot = retained_request
        .resolve()
        .await
        .map_err(|error| anyhow::anyhow!("resolve retained identity snapshot: {error:?}"))?;
    assert_eq!(
        retained_snapshot
            .selected_identity_id()
            .map_err(|error| anyhow::anyhow!("read retained identity: {error:?}"))?,
        first_identity_id
    );
    assert_eq!(
        retained_snapshot
            .device_access()
            .device_id()
            .value()
            .map_err(|error| anyhow::anyhow!("read retained app id: {error:?}"))?,
        first_app_id
    );
    assert_eq!(
        retained_snapshot.device_access().identity_state(),
        nook_core::DeviceAccessIdentityState::Locked
    );

    assert_eq!(
        manager
            .device_protection_status()
            .await
            .map_err(|error| anyhow::anyhow!("read retained protection: {error:?}"))?,
        nook_core::DeviceProtectionStatus::Passkey
    );
    assert_eq!(
        manager
            .device_protection_device_mode()
            .await
            .map_err(|error| anyhow::anyhow!("read retained device mode: {error:?}"))?,
        crate::DeviceProtectionDeviceModeState::Standard
    );
    let options = manager
        .passkey_unlock_options()
        .await
        .map_err(|error| anyhow::anyhow!("read retained passkey options: {error:?}"))?;
    assert_eq!(options.credential_id(), first_credential);
    assert_eq!(options.prf_input(), first_prf_input);
    assert_eq!(
        manager
            .local_identity_recovery_app_id()
            .await
            .map_err(|error| anyhow::anyhow!("read retained recovery app id: {error:?}"))?,
        first_app_id
    );
    manager
        .unlock_device_identity(first_prf_output)
        .await
        .map_err(|error| anyhow::anyhow!("unlock retained passkey identity: {error:?}"))?;
    assert_eq!(manager.device_id(), first_app_id);

    manager
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    Ok(())
}

#[wasm_bindgen_test]
async fn keyring_backed_simple_genesis_keeps_the_signer_out_of_the_singleton_seed()
-> anyhow::Result<()> {
    let mut manager = NookVaultManager::new();
    manager
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    manager
        .finish_pin_device_protection("identity pin".to_owned())
        .await
        .map_err(|error| anyhow::anyhow!("protect identity: {error:?}"))?;
    let identity = manager.device_identity()?;
    let pending = manager
        .initialize_genesis_vault_with_identity(&identity)
        .await?;

    manager.bootstrap_simple_event_log_genesis(&pending).await?;

    assert!(
        crate::storage::event_db::load_signing_seed()
            .await?
            .is_none(),
        "keyring-backed genesis must not recreate the plaintext singleton signer"
    );
    let entry = crate::storage::identity_record::load_entry_for_app_id(identity.app_id())
        .await?
        .ok_or_else(|| anyhow::anyhow!("protected identity keyring entry is missing"))?;
    assert!(entry.has_signing_seed());
    manager
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    Ok(())
}

#[wasm_bindgen_test]
async fn failed_reprotection_zeroizes_the_existing_local_app_key() -> anyhow::Result<()> {
    let mut manager = NookVaultManager::new();
    manager
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    manager
        .finish_pin_device_protection("first identity pin".to_owned())
        .await
        .map_err(|error| anyhow::anyhow!("protect identity: {error:?}"))?;
    crate::storage::indexed_db::idb_put_string(
        crate::storage::identity_record::PENDING_SIMPLE_GENESIS_KEY,
        "pending",
    )
    .await?;

    let result = manager
        .finish_pin_device_protection("replacement pin".to_owned())
        .await;

    assert!(result.is_err());
    assert_eq!(
        manager
            .device_protection_status()
            .await
            .map_err(|error| anyhow::anyhow!(
                "read protection after failed replacement: {error:?}"
            ))?,
        nook_core::DeviceProtectionStatus::Pin
    );
    crate::storage::indexed_db::idb_delete_key(
        crate::storage::identity_record::PENDING_SIMPLE_GENESIS_KEY,
    )
    .await?;
    manager
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    Ok(())
}

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
    source.persist_projection_cache().await?;
    if with_update {
        source
            .append_vault_operations(vec![nook_core::VaultOperation::VaultCleared])
            .await
            .map_err(|error| anyhow::anyhow!("append candidate update: {error}"))?;
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
async fn extension_import_resolves_the_granted_identity_instead_of_the_selection()
-> anyhow::Result<()> {
    let fixture = import_fixture(false).await?;
    let mut other_identity = NookVaultManager::new();
    other_identity
        .begin_local_identity_creation("Other")
        .await
        .map_err(|error| anyhow::anyhow!("begin other identity: {error:?}"))?;
    other_identity
        .finish_pin_device_protection("other identity pin".to_owned())
        .await
        .map_err(|error| anyhow::anyhow!("protect other identity: {error:?}"))?;
    let selected_device_id = other_identity.device.id.clone();
    let selected_device_secret = other_identity.device.identity_private_key.clone();
    assert_ne!(selected_device_id, fixture.device_id);

    let (mut importer, _) = replacement_manager(&fixture).await?;
    importer.device.id.clone_from(&selected_device_id);
    importer
        .device
        .identity_private_key
        .clone_from(&selected_device_secret);

    let status = importer
        .import_extension_event_log_records(
            &fixture.store_id,
            &fixture.device_id,
            fixture.device_public_key.as_str(),
            fixture.signing_public_key.as_str(),
            fixture.records,
        )
        .await?;

    assert!(status.access_granted);
    assert_eq!(importer.device.id, selected_device_id);
    assert_eq!(importer.device.identity_private_key, selected_device_secret);
    importer
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
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
async fn locked_external_import_preserves_prior_vault_and_password_entries() -> anyhow::Result<()> {
    let mut source = NookVaultManager::new();
    source.application = nook_core::VaultApplication::Simple;
    source
        .delete_local_browser_data()
        .await
        .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
    source
        .finish_pin_device_protection("correct horse battery staple".to_owned())
        .await
        .map_err(|error| anyhow::anyhow!("protect device: {error:?}"))?;
    let identity = source.device_identity()?;
    source.initialize_genesis_vault(&identity)?;
    source.vault.store_id = nook_core::generate_store_id()?.to_string();
    source.bootstrap_event_log_genesis().await?;
    source
        .add_vault_password_for_e2e("Recovery".to_owned(), "import-backup-password".to_owned())
        .await
        .map_err(|error| anyhow::anyhow!("add backup password: {error:?}"))?;
    let imported_store_id = source.vault.store_id.clone();
    let records = source
        .export_event_log_records()
        .await?
        .into_iter()
        .map(|record| ExternalEventLogRecord {
            event_id: record.event_id,
            event: record.event,
        })
        .collect::<Vec<_>>();

    let previous_store_id = nook_core::generate_store_id()?.to_string();
    let previous_projection = nook_core::serialize_stored_yaml_with_unlock_name_architecture(
        &[],
        &nook_core::VaultUnlock::Keys,
        &[],
        nook_core::VaultStoreIdentityRef::Assigned(&previous_store_id),
        nook_core::VaultNameRef::Named("Empty local vault"),
        nook_core::VaultVersionWrite::Initial,
        &nook_core::VaultArchitecture::default(),
    )?;
    import_vault_blob(previous_projection.as_str(), Some("Empty local vault")).await?;
    switch_active_vault(&previous_store_id).await?;

    let mut importer = NookVaultManager::new();
    importer.application = nook_core::VaultApplication::Simple;
    importer.vault.store_id.clone_from(&previous_store_id);
    importer.reset_vault_session();
    let _ = importer.sync_external_event_log_records(records).await?;
    assert_eq!(importer.vault.store_id, imported_store_id);
    assert!(
        !importer.vault.password_entries.is_empty(),
        "locked import must hydrate backup-password entries from the event graph"
    );

    let registry = list_vault_registry_entries().await?;
    assert!(
        registry
            .iter()
            .any(|entry| entry.store_id == previous_store_id),
        "previous empty local vault must remain registered after import"
    );
    assert!(
        registry
            .iter()
            .any(|entry| entry.store_id == imported_store_id),
        "imported provider vault must be registered"
    );
    assert!(
        load_vault_blob(&previous_store_id).await?.is_some(),
        "previous vault blob must survive import-as-new-vault"
    );
    let local_vaults = list_local_vaults()
        .await
        .map_err(|error| anyhow::anyhow!("list local vaults: {error:?}"))?;
    assert_eq!(local_vaults.len(), 2);

    let stranger = nook_core::DeviceIdentity::generate()?;
    let status = nook_core::assess_connect_access(&importer.stored_records_snapshot(), &stranger);
    assert_eq!(status, nook_core::ConnectAccessStatus::NeedsEnrollment);
    Ok(())
}

#[wasm_bindgen_test]
async fn staged_extension_import_without_ancestors_restores_session_and_active_projection()
-> anyhow::Result<()> {
    let mut fixture = import_fixture(true).await?;
    let dependent_index = fixture
        .records
        .iter()
        .position(|record| !record.event.body.parents.is_empty())
        .ok_or_else(|| anyhow::anyhow!("candidate update event is missing"))?;
    let dependent = fixture.records.remove(dependent_index);
    for record in &fixture.records {
        crate::storage::event_db::remove_event_fixture(&fixture.store_id, &record.event_id).await?;
    }
    let (mut replacement, previous_store_id) = replacement_manager(&fixture).await?;
    let status = replacement
        .import_extension_event_log_records(
            &fixture.store_id,
            &fixture.device_id,
            fixture.device_public_key.as_str(),
            fixture.signing_public_key.as_str(),
            vec![dependent],
        )
        .await?;
    assert!(!status.access_granted);
    assert_rollback(&replacement, &previous_store_id).await
}
