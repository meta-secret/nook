use wasm_bindgen::prelude::wasm_bindgen;

use super::{
    APP_ID_KEY, APP_KEY_WRAPPED_KEY, DEVICE_ID_KEY, NookError, WRAPPED_DEVICE_IDENTITY_KEY,
    idb_delete_keys, idb_get_string, open_nook_database, read_string_preferring,
};

pub(crate) async fn device_identity_protection_status()
-> Result<nook_core::DeviceProtectionStatus, NookError> {
    let Some(raw) =
        idb_get_string_preferring(APP_KEY_WRAPPED_KEY, WRAPPED_DEVICE_IDENTITY_KEY).await?
    else {
        return Ok(nook_core::DeviceProtectionStatus::Missing);
    };
    let wrapped = nook_core::parse_wrapped_device_identity(&raw)?;
    nook_core::DeviceProtectionStatus::from_persisted(wrapped.protection_mode()).ok_or_else(|| {
        NookError::IndexedDb(format!(
            "Unsupported persisted device-protection status: {}",
            wrapped.protection_mode()
        ))
    })
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceProtectionDeviceModeState {
    Missing,
    Pin,
    Standard,
    AntiHacker,
}

pub(crate) async fn device_identity_device_mode()
-> Result<DeviceProtectionDeviceModeState, NookError> {
    let Some(raw) =
        idb_get_string_preferring(APP_KEY_WRAPPED_KEY, WRAPPED_DEVICE_IDENTITY_KEY).await?
    else {
        return Ok(DeviceProtectionDeviceModeState::Missing);
    };
    let wrapped = nook_core::parse_wrapped_device_identity(&raw)?;
    Ok(match wrapped {
        nook_core::WrappedDeviceIdentity::Pin(_) => DeviceProtectionDeviceModeState::Pin,
        nook_core::WrappedDeviceIdentity::PasskeyDerived(_) => {
            DeviceProtectionDeviceModeState::Standard
        }
        nook_core::WrappedDeviceIdentity::PasskeyWrappedLocal(_) => {
            DeviceProtectionDeviceModeState::AntiHacker
        }
    })
}

pub(crate) async fn load_wrapped_device_identity()
-> Result<Option<(String, nook_core::WrappedDeviceIdentity)>, NookError> {
    let rexie = open_nook_database().await?;
    // Writers replace the ID and wrapped credential together. Read both from
    // the same snapshot so a concurrent replacement cannot fabricate a mixed
    // app-key record from two different commits.
    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadOnly)
        .map_err(|error| {
            NookError::IndexedDb(format!("App key read transaction error: {error:?}"))
        })?;
    let store = transaction
        .store("vault")
        .map_err(|error| NookError::IndexedDb(format!("App key read store error: {error:?}")))?;
    let wrapped = read_string_preferring(
        &store,
        APP_KEY_WRAPPED_KEY,
        WRAPPED_DEVICE_IDENTITY_KEY,
        "App key wrapped",
    )
    .await?;
    let app_id = read_string_preferring(&store, APP_ID_KEY, DEVICE_ID_KEY, "App id").await?;
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!("App key read completion error: {error:?}"))
    })?;

    let Some(raw) = wrapped else {
        return Ok(None);
    };
    let app_id = app_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| NookError::IndexedDb("Protected app key is missing app_id.".to_owned()))?;
    let wrapped = nook_core::parse_wrapped_device_identity(&raw)?;
    Ok(Some((app_id, wrapped)))
}

async fn idb_get_string_preferring(
    preferred_key: &str,
    legacy_key: &str,
) -> Result<Option<String>, NookError> {
    if let Some(value) = idb_get_string(preferred_key).await? {
        return Ok(Some(value));
    }
    idb_get_string(legacy_key).await
}

/// Atomically install a verified wrapped identity after the just-written
/// ciphertext can be read back.
pub(crate) async fn save_wrapped_device_identity(
    device_id: &str,
    record: &nook_core::WrappedDeviceIdentity,
) -> Result<(), NookError> {
    let wrapped = nook_core::serialize_wrapped_device_identity(record)?;
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;

    let id_value = serde_wasm_bindgen::to_value(device_id)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let wrapped_value = serde_wasm_bindgen::to_value(&wrapped)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;

    // Dual-write preferred app_* keys and legacy device_* keys during migration.
    for key_name in [APP_ID_KEY, DEVICE_ID_KEY] {
        let key = serde_wasm_bindgen::to_value(key_name)
            .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
        store
            .put(&id_value, Some(&key))
            .await
            .map_err(|e| NookError::IndexedDb(format!("Put error: {e:?}")))?;
    }
    for key_name in [APP_KEY_WRAPPED_KEY, WRAPPED_DEVICE_IDENTITY_KEY] {
        let key = serde_wasm_bindgen::to_value(key_name)
            .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
        store
            .put(&wrapped_value, Some(&key))
            .await
            .map_err(|e| NookError::IndexedDb(format!("Put error: {e:?}")))?;
    }
    let verify_key = serde_wasm_bindgen::to_value(APP_KEY_WRAPPED_KEY)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let verified_value = store
        .get(verify_key)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Verify get error: {e:?}")))?
        .ok_or_else(|| NookError::IndexedDb("Wrapped app key verification failed.".to_owned()))?;
    let verified: String = serde_wasm_bindgen::from_value(verified_value)
        .map_err(|e| NookError::IndexedDb(format!("Verify parse error: {e:?}")))?;
    if verified != wrapped {
        return Err(NookError::IndexedDb(
            "Wrapped app key verification mismatch.".to_owned(),
        ));
    }

    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
    Ok(())
}

pub(crate) async fn delete_device_identity_for_recovery() -> Result<(), NookError> {
    idb_delete_keys(&[
        crate::storage::device_access::DEVICE_ACCESS_PROFILE_KEY,
        APP_KEY_WRAPPED_KEY,
        APP_ID_KEY,
        WRAPPED_DEVICE_IDENTITY_KEY,
        DEVICE_ID_KEY,
    ])
    .await
}
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn verified_passkey_identity_metadata_round_trips() -> Result<(), wasm_bindgen::JsError> {
        let _ = rexie::Rexie::delete("nook_db").await;
        assert_eq!(
            device_identity_protection_status().await?,
            nook_core::DeviceProtectionStatus::Missing
        );

        let setup = nook_core::DeviceKeyProtectionSetup::generate()?;
        let secret =
            nook_core::derive_device_identity_from_passkey_prf(setup.user_handle(), &[21u8; 32])?;
        let identity = nook_core::DeviceIdentity::from_secret_str(&secret)?;
        let wrapped = nook_core::passkey_derived_device_identity_record(
            &[7u8; 32],
            setup.user_handle(),
            setup.prf_input(),
        )?;
        save_wrapped_device_identity(identity.device_id().as_str(), &wrapped).await?;

        let (_, reloaded) = load_wrapped_device_identity().await?.ok_or_else(|| {
            wasm_bindgen::JsError::new("wrapped device identity record should exist")
        })?;
        assert_eq!(reloaded.protection_mode(), "passkey");
        assert_eq!(reloaded.device_mode()?, "standard");
        assert_eq!(
            device_identity_device_mode().await?,
            DeviceProtectionDeviceModeState::Standard
        );
        assert_eq!(reloaded.user_handle_bytes()?, setup.user_handle());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn pin_identity_reports_explicit_pin_device_mode() -> Result<(), wasm_bindgen::JsError> {
        let _ = rexie::Rexie::delete("nook_db").await;
        let identity = nook_core::DeviceIdentity::generate()?;
        let wrapped =
            nook_core::wrap_device_identity_with_pin(&identity.secret_string(), "123456")?;

        save_wrapped_device_identity(identity.device_id().as_str(), &wrapped).await?;

        assert_eq!(
            device_identity_device_mode().await?,
            DeviceProtectionDeviceModeState::Pin
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn wrapped_identity_without_device_id_is_rejected() -> Result<(), wasm_bindgen::JsError> {
        let _ = rexie::Rexie::delete("nook_db").await;
        let identity = nook_core::DeviceIdentity::generate()?;
        let wrapped =
            nook_core::wrap_device_identity_with_pin(&identity.secret_string(), "123456")?;
        save_wrapped_device_identity(identity.device_id().as_str(), &wrapped).await?;
        idb_delete_key(DEVICE_ID_KEY).await?;

        assert!(load_wrapped_device_identity().await.is_err());
        Ok(())
    }
}
