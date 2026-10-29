use super::*;
use crate::DeviceProtectionDeviceModeState;
use crate::NookVaultManager;
use nook_core::DeviceProtectionStatus;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

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
