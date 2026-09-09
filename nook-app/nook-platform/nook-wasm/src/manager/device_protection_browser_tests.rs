use super::*;
use crate::DeviceProtectionDeviceModeState;
use crate::NookExtensionIdentityHandoffContext;
use crate::NookVaultManager;
use nook_core::{AppKey, SigningIdentity};
use nook_core::{DeviceMode, DeviceProtectionStatus, PasskeyDeviceProtectionMode};
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

#[wasm_bindgen_test]
fn device_protection_contexts_and_manager_state_project_in_wasm() -> Result<(), JsError> {
    let store_id = nook_core::StoreId::generate()?;
    let creation = NookExtensionIdentityHandoffContext::vault_creation();
    assert!(matches!(
        (&creation).pending_extension_enrollment(None)?,
        PendingExtensionIdentityEnrollment::VaultCreation { authorizer: None }
    ));
    let authorizer = AppKey::generate()?;
    assert!(matches!(
        (&creation).pending_extension_enrollment(Some(&authorizer))?,
        PendingExtensionIdentityEnrollment::VaultCreation {
            authorizer: Some(_)
        }
    ));
    let paired = NookExtensionIdentityHandoffContext::paired_vault(store_id.as_str())?;
    assert!(matches!(
        (&paired).pending_extension_enrollment(None)?,
        PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock { .. }
    ));
    assert!(matches!(
        (&paired).pending_extension_enrollment(Some(&authorizer))?,
        PendingExtensionIdentityEnrollment::PairedVault { .. }
    ));
    let imported = NookExtensionIdentityHandoffContext::existing_vault_import(store_id.as_str())?;
    assert!(matches!(
        (&imported).pending_extension_enrollment(None)?,
        PendingExtensionIdentityEnrollment::ExistingVaultImport { .. }
    ));
    assert!(NookExtensionIdentityHandoffContext::paired_vault("invalid").is_err());
    assert_eq!(
        NookVaultManager::passkey_mode_from_device_mode(DeviceMode::Standard),
        PasskeyDeviceProtectionMode::Standard
    );
    assert_eq!(
        NookVaultManager::passkey_mode_from_device_mode(DeviceMode::AntiHacker),
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
    let store_id = nook_core::StoreId::generate()?;
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

#[wasm_bindgen_test]
async fn device_protection_projection_and_material_guards_fail_closed() -> Result<(), JsError> {
    let mut manager = NookVaultManager::new();
    manager.delete_local_browser_data().await?;

    assert_eq!(
        manager.device_protection_device_mode().await?,
        DeviceProtectionDeviceModeState::Missing
    );
    assert_eq!(
        manager.device_protection_status().await?,
        nook_core::DeviceProtectionStatus::Missing
    );
    let setup = manager.begin_device_protection().await?;
    assert!(!setup.user_handle().is_empty());
    assert!(!setup.prf_input().is_empty());
    assert!(
        manager
            .device_access_snapshot_request()?
            .resolve()
            .await
            .is_ok()
    );

    let identity = nook_core::DeviceIdentity::generate()?;
    manager.device.identity_private_key = identity.secret_string().into_inner();
    assert_eq!(
        manager.device_protection_status().await?,
        nook_core::DeviceProtectionStatus::Unlocked
    );
    manager.lock_device_identity();

    assert!(
        manager
            .finish_device_protection(vec![], vec![], vec![], vec![])
            .await
            .is_err()
    );
    assert!(
        manager
            .finish_device_protection_with_mode(
                vec![],
                vec![],
                vec![],
                vec![],
                nook_core::DeviceMode::AntiHacker,
            )
            .await
            .is_err()
    );
    assert!(
        manager
            .recover_device_protection_with_passkey_material(vec![], vec![], vec![])
            .await
            .is_err()
    );
    assert!(manager.unlock_device_identity(vec![]).await.is_err());
    assert!(
        manager
            .unlock_pin_device_identity("wrong pin".to_owned())
            .await
            .is_err()
    );
    assert!(manager.passkey_unlock_options().await.is_err());

    let app_key = nook_core::AppKey::generate()?;
    assert!(
        manager
            .set_device_access_passkey_name(
                app_key.app_id().to_string(),
                "missing-credential".to_owned(),
                "New name".to_owned(),
            )
            .await
            .is_err()
    );
    manager.delete_local_browser_data().await?;
    Ok(())
}

#[wasm_bindgen_test]
async fn pin_device_protection_roundtrip_restores_identity() -> Result<(), JsError> {
    let mut manager = NookVaultManager::new();
    manager.delete_local_browser_data().await?;

    manager
        .finish_pin_device_protection("coverage-pin".to_owned())
        .await?;
    assert_eq!(
        manager.device_protection_device_mode().await?,
        DeviceProtectionDeviceModeState::Pin
    );
    assert_eq!(
        manager.device_protection_status().await?,
        DeviceProtectionStatus::Unlocked
    );

    manager.lock_device_identity();
    assert_eq!(
        manager.device_protection_status().await?,
        DeviceProtectionStatus::Pin
    );
    assert!(manager.begin_device_protection().await.is_err());

    manager
        .unlock_pin_device_identity("coverage-pin".to_owned())
        .await?;
    assert_eq!(
        manager.device_protection_status().await?,
        DeviceProtectionStatus::Unlocked
    );
    manager.lock_device_identity();
    assert!(
        manager
            .unlock_pin_device_identity("wrong coverage pin".to_owned())
            .await
            .is_err()
    );

    manager.delete_local_browser_data().await?;
    Ok(())
}
