use super::*;
use nook_core::{AppKey, SigningIdentity};
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

#[wasm_bindgen_test]
fn device_protection_contexts_and_manager_state_project_in_wasm() -> Result<(), JsError> {
    let store_id = nook_core::generate_store_id()?;
    let creation = NookExtensionIdentityHandoffContext::vault_creation();
    assert!(matches!(
        pending_extension_enrollment(&creation, None)?,
        PendingExtensionIdentityEnrollment::VaultCreation { authorizer: None }
    ));
    let authorizer = AppKey::generate()?;
    assert!(matches!(
        pending_extension_enrollment(&creation, Some(&authorizer))?,
        PendingExtensionIdentityEnrollment::VaultCreation {
            authorizer: Some(_)
        }
    ));
    let paired = NookExtensionIdentityHandoffContext::paired_vault(store_id.as_str())?;
    assert!(matches!(
        pending_extension_enrollment(&paired, None)?,
        PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock { .. }
    ));
    assert!(matches!(
        pending_extension_enrollment(&paired, Some(&authorizer))?,
        PendingExtensionIdentityEnrollment::PairedVault { .. }
    ));
    let imported = NookExtensionIdentityHandoffContext::existing_vault_import(store_id.as_str())?;
    assert!(matches!(
        pending_extension_enrollment(&imported, None)?,
        PendingExtensionIdentityEnrollment::ExistingVaultImport { .. }
    ));
    assert!(NookExtensionIdentityHandoffContext::paired_vault("invalid").is_err());
    assert_eq!(
        passkey_mode_from_device_mode(DeviceMode::Standard),
        PasskeyDeviceProtectionMode::Standard
    );
    assert_eq!(
        passkey_mode_from_device_mode(DeviceMode::AntiHacker),
        PasskeyDeviceProtectionMode::AntiHacker
    );

    let mut manager = NookVaultManager::new();
    assert!(!manager.extension_identity_handoff_requires_connect());
    let public_key = manager.begin_extension_identity_handoff()?;
    assert!(!public_key.is_empty());
    let _request = manager.device_access_snapshot_request()?;
    manager.quiesce_for_local_recovery();
    manager.confirm_extension_identity_handoff();
    manager.rollback_extension_identity_handoff();
    assert!(!manager.extension_identity_handoff_requires_connect());
    Ok(())
}

#[wasm_bindgen_test]
fn pending_handoff_state_can_be_confirmed_and_rolled_back() -> Result<(), JsError> {
    let extension = AppKey::generate()?;
    let authorizer = AppKey::generate()?;
    let store_id = nook_core::generate_store_id()?;
    let (signing, signing_seed) = SigningIdentity::generate()?;
    let mut manager = NookVaultManager::new();
    manager.device.id = extension.device_id().as_str().to_owned();
    manager.device.identity_private_key = extension.secret_string().into_inner();
    manager.device.pending_extension_handoff = Some(PendingExtensionIdentityHandoff {
        enrollment: PendingExtensionIdentityEnrollment::PairedVault {
            authorizer,
            store_id: store_id.clone(),
        },
        authorizer_signing: None,
        signing_public_key: signing.public_key(),
        handoff_signing_seed: signing_seed.as_str().to_owned(),
        persist_signing_seed: false,
        previous_session_signing_seed: String::new(),
    });
    assert!(manager.extension_identity_handoff_requires_connect());
    manager.vault.store_id = store_id.to_string();
    manager.mark_extension_identity_handoff_existing_vault_import()?;
    manager.confirm_extension_identity_handoff();
    assert!(!manager.extension_identity_handoff_requires_connect());
    Ok(())
}

#[wasm_bindgen_test]
async fn device_protection_handoff_guards_fail_closed_without_session_state() -> Result<(), JsError>
{
    let mut manager = NookVaultManager::new();
    let context = NookExtensionIdentityHandoffContext::vault_creation();

    assert!(
        manager
            .finish_extension_identity_handoff(
                "not-an-envelope",
                "nonce",
                "not-a-device",
                "not-a-public-key",
                "not-a-signing-key",
                &context,
            )
            .await
            .is_err()
    );
    assert!(
        manager
            .seal_extension_identity_handoff("not-a-public-key", "nonce")
            .await
            .is_err()
    );
    assert!(
        manager
            .mark_extension_identity_handoff_existing_vault_import()
            .is_err()
    );
    assert!(manager.commit_extension_identity_handoff().await.is_err());
    assert!(
        manager
            .set_device_access_passkey_name(
                "not-an-app-id".to_owned(),
                "fingerprint".to_owned(),
                "name".to_owned(),
            )
            .await
            .is_err()
    );
    Ok(())
}

#[wasm_bindgen_test]
fn handoff_contexts_reject_empty_store_references() {
    assert!(NookExtensionIdentityHandoffContext::paired_vault("").is_err());
    assert!(NookExtensionIdentityHandoffContext::existing_vault_import("").is_err());
}
