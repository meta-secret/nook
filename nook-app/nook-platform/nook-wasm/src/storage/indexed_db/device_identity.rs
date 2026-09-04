use crate::storage::identity_record;
use nook_core::AppId;
use rexie::TransactionMode;

use wasm_bindgen::prelude::wasm_bindgen;

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
use super::idb_delete_keys;
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
use super::idb_get_string;
use super::{
    APP_ID_KEY, APP_KEY_WRAPPED_KEY, DEVICE_ID_KEY, NookError, WRAPPED_DEVICE_IDENTITY_KEY,
    open_nook_database, read_string_preferring,
};
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
use nook_core::{DeviceProtectionStatus, WrappedDeviceIdentity};

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
async fn device_identity_protection_status() -> Result<nook_core::DeviceProtectionStatus, NookError>
{
    let Some((_, wrapped)) = load_wrapped_device_identity().await? else {
        return Ok(DeviceProtectionStatus::Missing);
    };
    DeviceProtectionStatus::from_persisted(wrapped.protection_mode()).ok_or_else(|| {
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

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
async fn device_identity_device_mode() -> Result<DeviceProtectionDeviceModeState, NookError> {
    let Some((_, wrapped)) = load_wrapped_device_identity().await? else {
        return Ok(DeviceProtectionDeviceModeState::Missing);
    };
    Ok(match wrapped {
        WrappedDeviceIdentity::Pin(_) => DeviceProtectionDeviceModeState::Pin,
        WrappedDeviceIdentity::PasskeyDerived(_) => DeviceProtectionDeviceModeState::Standard,
        WrappedDeviceIdentity::PasskeyWrappedLocal(_) => {
            DeviceProtectionDeviceModeState::AntiHacker
        }
    })
}

pub(crate) async fn load_wrapped_device_identity()
-> Result<Option<(String, nook_core::WrappedDeviceIdentity)>, NookError> {
    if let Some(entry) = identity_record::load_selected_entry().await? {
        return Ok(Some((
            entry.app_id().as_str().to_owned(),
            entry.wrapped_app_key().clone(),
        )));
    }
    load_legacy_wrapped_device_identity().await
}

pub(crate) async fn load_wrapped_device_identity_for_app_id(
    app_id: &str,
) -> Result<Option<(String, nook_core::WrappedDeviceIdentity)>, NookError> {
    let app_id = AppId::parse(app_id).map_err(|error| NookError::Database(error.to_string()))?;
    if let Some(entry) = identity_record::load_entry_for_app_id(&app_id).await? {
        return Ok(Some((
            entry.app_id().as_str().to_owned(),
            entry.wrapped_app_key().clone(),
        )));
    }
    Ok(load_legacy_wrapped_device_identity()
        .await?
        .filter(|(stored_app_id, _)| stored_app_id == app_id.as_str()))
}

async fn load_legacy_wrapped_device_identity()
-> Result<Option<(String, nook_core::WrappedDeviceIdentity)>, NookError> {
    let rexie = open_nook_database().await?;
    // Writers replace the ID and wrapped credential together. Read both from
    // the same snapshot so a concurrent replacement cannot fabricate a mixed
    // app-key record from two different commits.
    let transaction = rexie
        .transaction(&["vault"], TransactionMode::ReadOnly)
        .map_err(|error| {
            NookError::IndexedDb(format!("App key read transaction error: {error:?}"))
        })?;
    let store = transaction
        .store("vault")
        .map_err(|error| NookError::IndexedDb(format!("App key read store error: {error:?}")))?;
    let protected = load_legacy_wrapped_device_identity_from_store(&store).await?;
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!("App key read completion error: {error:?}"))
    })?;

    Ok(protected)
}

pub(crate) async fn load_legacy_wrapped_device_identity_from_store(
    store: &rexie::Store,
) -> Result<Option<(String, nook_core::WrappedDeviceIdentity)>, NookError> {
    let wrapped = read_string_preferring(
        store,
        APP_KEY_WRAPPED_KEY,
        WRAPPED_DEVICE_IDENTITY_KEY,
        "App key wrapped",
    )
    .await?;
    let app_id = read_string_preferring(store, APP_ID_KEY, DEVICE_ID_KEY, "App id").await?;
    let Some(raw) = wrapped else {
        return Ok(None);
    };
    let app_id = app_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| NookError::IndexedDb("Protected app key is missing app_id.".to_owned()))?;
    let wrapped = nook_core::parse_wrapped_device_identity(&raw)?;
    Ok(Some((app_id, wrapped)))
}

/// Atomically install a verified wrapped identity after the just-written
/// ciphertext can be read back.
#[cfg(test)]
pub(crate) async fn save_wrapped_device_identity(
    device_id: &str,
    record: &nook_core::WrappedDeviceIdentity,
) -> Result<(), NookError> {
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;

    put_wrapped_device_identity(&store, device_id, record).await?;

    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
    Ok(())
}

#[cfg(test)]
pub(crate) async fn put_wrapped_device_identity(
    store: &rexie::Store,
    device_id: &str,
    record: &nook_core::WrappedDeviceIdentity,
) -> Result<(), NookError> {
    let wrapped = nook_core::serialize_wrapped_device_identity(record)?;
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

    Ok(())
}

pub(crate) async fn delete_device_identity_for_recovery(
    expected_app_id: Option<nook_core::AppId>,
) -> Result<identity_record::LocalIdentityRecovery, NookError> {
    identity_record::delete_identity_directory_for_recovery(expected_app_id).await
}
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod tests {
    use crate::storage::identity_record::simple_genesis;
    use crate::storage::{identity_record, indexed_db};
    use nook_core::{
        AppKey, DeviceIdentity, DeviceKeyProtectionSetup, DeviceProtectionStatus, IdentityDirectory,
    };
    use rexie::Rexie;
    use wasm_bindgen::JsError;

    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn verified_passkey_identity_metadata_round_trips() -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        assert_eq!(
            device_identity_protection_status().await?,
            DeviceProtectionStatus::Missing
        );

        let setup = DeviceKeyProtectionSetup::generate()?;
        let secret =
            nook_core::derive_device_identity_from_passkey_prf(setup.user_handle(), &[21u8; 32])?;
        let identity = DeviceIdentity::from_secret_str(&secret)?;
        let wrapped = nook_core::passkey_derived_device_identity_record(
            &[7u8; 32],
            setup.user_handle(),
            setup.prf_input(),
        )?;
        save_wrapped_device_identity(identity.device_id().as_str(), &wrapped).await?;

        let (_, reloaded) = load_wrapped_device_identity()
            .await?
            .ok_or_else(|| JsError::new("wrapped device identity record should exist"))?;
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
        let _ = Rexie::delete("nook_db").await;
        let identity = DeviceIdentity::generate()?;
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
        let _ = Rexie::delete("nook_db").await;
        let identity = DeviceIdentity::generate()?;
        let wrapped =
            nook_core::wrap_device_identity_with_pin(&identity.secret_string(), "123456")?;
        save_wrapped_device_identity(identity.device_id().as_str(), &wrapped).await?;
        idb_delete_keys(&[APP_ID_KEY, DEVICE_ID_KEY]).await?;

        assert!(load_wrapped_device_identity().await.is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn live_app_id_lookup_is_independent_of_persisted_selection()
    -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        let first_key = AppKey::generate()?;
        let second_key = AppKey::generate()?;
        let first_wrapped =
            nook_core::wrap_device_identity_with_pin(&first_key.secret_string(), "first-secret")?;
        let second_wrapped =
            nook_core::wrap_device_identity_with_pin(&second_key.secret_string(), "second-secret")?;
        identity_record::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        identity_record::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            None,
            "Work",
        )
        .await?;

        let (app_id, reloaded) =
            load_wrapped_device_identity_for_app_id(first_key.app_id().as_str())
                .await?
                .ok_or_else(|| JsError::new("first identity record is missing"))?;

        assert_eq!(app_id, first_key.app_id().as_str());
        assert_eq!(reloaded, first_wrapped);
        assert_eq!(
            load_wrapped_device_identity()
                .await?
                .ok_or_else(|| JsError::new("selected identity record is missing"))?
                .0,
            second_key.app_id().as_str()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn recovery_atomically_forgets_app_key_and_identity_ownership()
    -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        let identity = DeviceIdentity::generate()?;
        let wrapped =
            nook_core::wrap_device_identity_with_pin(&identity.secret_string(), "123456")?;
        save_wrapped_device_identity(identity.device_id().as_str(), &wrapped).await?;
        indexed_db::idb_put_string(
            identity_record::IDENTITY_DIRECTORY_KEY,
            &serde_json::to_string(&IdentityDirectory::empty())?,
        )
        .await?;
        indexed_db::idb_put_string(simple_genesis::PENDING_SIMPLE_GENESIS_KEY, "pending").await?;
        indexed_db::idb_put_string("vault:preserved", "ciphertext").await?;

        let recovery = delete_device_identity_for_recovery(Some(identity.app_id().clone())).await?;

        assert!(load_wrapped_device_identity().await?.is_none());
        assert!(
            identity_record::load_identity_directory()
                .await?
                .identities()
                .is_empty()
        );
        assert!(
            idb_get_string(simple_genesis::PENDING_SIMPLE_GENESIS_KEY,)
                .await?
                .is_none()
        );
        assert_eq!(
            idb_get_string("vault:preserved").await?,
            Some("ciphertext".to_owned())
        );
        identity_record::complete_identity_recovery_cleanup(&recovery).await?;
        Ok(())
    }
}
