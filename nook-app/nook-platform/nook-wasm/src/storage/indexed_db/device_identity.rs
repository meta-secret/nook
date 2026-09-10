use super::StoredStringRecord;
use crate::IdentityDbSaveNewProtectedLocalIdentity;
use crate::storage::identity_record;
use crate::storage::identity_record::ProtectedIdentityLookup;
use crate::storage::identity_record::ProtectedLocalIdentity;
use crate::storage::identity_record::StoredIdentityProtection;
use crate::{IdbPutStringRequest, NookDatabase, ReadStringPreferringRequest};
use nook_core::{AppId, WrappedDeviceIdentity};
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
use nook_core::{DeviceIdentityProtection, PasskeyRecordMetadata};
use rexie::TransactionMode;

use wasm_bindgen::prelude::wasm_bindgen;

use super::{
    APP_ID_KEY, APP_KEY_WRAPPED_KEY, DEVICE_ID_KEY, NookError, WRAPPED_DEVICE_IDENTITY_KEY,
};
use nook_core::DeviceProtectionStatus;

#[cfg(test)]
/// Named values required by NookDatabase::save_wrapped_device_identity.
pub(crate) struct SaveWrappedDeviceIdentityRequest<'a> {
    pub(crate) device_id: &'a str,
    pub(crate) record: &'a nook_core::WrappedDeviceIdentity,
}

/// Named values required by NookDatabase::put_wrapped_device_identity.
pub(crate) struct PutWrappedDeviceIdentityRequest<'a> {
    pub(crate) store: &'a rexie::Store,
    pub(crate) device_id: &'a str,
    pub(crate) record: &'a nook_core::WrappedDeviceIdentity,
}

impl NookDatabase {
    async fn device_identity_protection_status()
    -> Result<nook_core::DeviceProtectionStatus, NookError> {
        let ProtectedIdentityLookup::Configured(ProtectedLocalIdentity {
            wrapped_identity: wrapped,
            ..
        }) = NookDatabase::load_wrapped_device_identity().await?
        else {
            return Ok(DeviceProtectionStatus::Missing);
        };
        DeviceProtectionStatus::from_persisted(wrapped.protection_mode()).map_err(|_| {
            NookError::IndexedDb(format!(
                "Unsupported persisted device-protection status: {}",
                wrapped.protection_mode()
            ))
        })
    }
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
impl NookDatabase {
    async fn device_identity_device_mode() -> Result<DeviceProtectionDeviceModeState, NookError> {
        let ProtectedIdentityLookup::Configured(ProtectedLocalIdentity {
            wrapped_identity: wrapped,
            ..
        }) = NookDatabase::load_wrapped_device_identity().await?
        else {
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
}

impl NookDatabase {
    pub(crate) async fn load_wrapped_device_identity() -> Result<ProtectedIdentityLookup, NookError>
    {
        if let StoredIdentityProtection::Protected(entry) =
            NookDatabase::load_selected_entry().await?
        {
            return Ok(ProtectedIdentityLookup::Configured(
                ProtectedLocalIdentity {
                    app_id: entry.app_id().clone(),
                    wrapped_identity: entry.wrapped_app_key().clone(),
                },
            ));
        }
        NookDatabase::load_legacy_wrapped_device_identity().await
    }
}

impl NookDatabase {
    pub(crate) async fn load_wrapped_device_identity_for_app_id(
        app_id: &str,
    ) -> Result<ProtectedIdentityLookup, NookError> {
        let app_id =
            AppId::parse(app_id).map_err(|error| NookError::Database(error.to_string()))?;
        if let StoredIdentityProtection::Protected(entry) =
            NookDatabase::load_entry_for_app_id(&app_id).await?
        {
            return Ok(ProtectedIdentityLookup::Configured(
                ProtectedLocalIdentity {
                    app_id: entry.app_id().clone(),
                    wrapped_identity: entry.wrapped_app_key().clone(),
                },
            ));
        }
        Ok(
            match NookDatabase::load_legacy_wrapped_device_identity().await? {
                ProtectedIdentityLookup::Configured(identity) if identity.app_id == app_id => {
                    ProtectedIdentityLookup::Configured(identity)
                }
                ProtectedIdentityLookup::Configured(_) | ProtectedIdentityLookup::Unconfigured => {
                    ProtectedIdentityLookup::Unconfigured
                }
            },
        )
    }
}

impl NookDatabase {
    async fn load_legacy_wrapped_device_identity() -> Result<ProtectedIdentityLookup, NookError> {
        let rexie = NookDatabase::open_nook_database().await?;
        // Writers replace the ID and wrapped credential together. Read both from
        // the same snapshot so a concurrent replacement cannot fabricate a mixed
        // app-key record from two different commits.
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadOnly)
            .map_err(|error| {
                NookError::IndexedDb(format!("App key read transaction error: {error:?}"))
            })?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("App key read store error: {error:?}"))
        })?;
        let protected =
            NookDatabase::load_legacy_wrapped_device_identity_from_store(&store).await?;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("App key read completion error: {error:?}"))
        })?;

        Ok(protected)
    }
}

impl NookDatabase {
    pub(crate) async fn load_legacy_wrapped_device_identity_from_store(
        store: &rexie::Store,
    ) -> Result<ProtectedIdentityLookup, NookError> {
        let wrapped = NookDatabase::read_string_preferring(ReadStringPreferringRequest {
            store: store,
            preferred_key: APP_KEY_WRAPPED_KEY,
            legacy_key: WRAPPED_DEVICE_IDENTITY_KEY,
            label: "App key wrapped",
        })
        .await?;
        let app_id = NookDatabase::read_string_preferring(ReadStringPreferringRequest {
            store: store,
            preferred_key: APP_ID_KEY,
            legacy_key: DEVICE_ID_KEY,
            label: "App id",
        })
        .await?;
        let StoredStringRecord::Stored(raw) = wrapped else {
            return Ok(ProtectedIdentityLookup::Unconfigured);
        };
        let app_id = match app_id {
            StoredStringRecord::Stored(value) if !value.trim().is_empty() => value,
            StoredStringRecord::Stored(_) | StoredStringRecord::MissingKey => {
                return Err(NookError::IndexedDb(
                    "Protected app key is missing app_id.".to_owned(),
                ));
            }
        };
        let wrapped = WrappedDeviceIdentity::parse(&raw)?;
        Ok(ProtectedIdentityLookup::Configured(
            ProtectedLocalIdentity {
                app_id: AppId::parse(&app_id)
                    .map_err(|error| NookError::Database(error.to_string()))?,
                wrapped_identity: wrapped,
            },
        ))
    }
}

/// Atomically install a verified wrapped identity after the just-written
/// ciphertext can be read back.
#[cfg(test)]
impl NookDatabase {
    pub(crate) async fn save_wrapped_device_identity(
        request: SaveWrappedDeviceIdentityRequest<'_>,
    ) -> Result<(), NookError> {
        let SaveWrappedDeviceIdentityRequest { device_id, record } = request;
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
        let store = transaction
            .store("vault")
            .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;

        NookDatabase::put_wrapped_device_identity(PutWrappedDeviceIdentityRequest {
            store: &store,
            device_id: device_id,
            record: record,
        })
        .await?;

        transaction
            .done()
            .await
            .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
        Ok(())
    }
}

#[cfg(test)]
impl NookDatabase {
    pub(crate) async fn put_wrapped_device_identity(
        request: PutWrappedDeviceIdentityRequest<'_>,
    ) -> Result<(), NookError> {
        let PutWrappedDeviceIdentityRequest {
            store,
            device_id,
            record,
        } = request;
        let wrapped = record.to_json()?;
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
            .ok_or_else(|| {
                NookError::IndexedDb("Wrapped app key verification failed.".to_owned())
            })?;
        let verified: String = serde_wasm_bindgen::from_value(verified_value)
            .map_err(|e| NookError::IndexedDb(format!("Verify parse error: {e:?}")))?;
        if verified != wrapped {
            return Err(NookError::IndexedDb(
                "Wrapped app key verification mismatch.".to_owned(),
            ));
        }

        Ok(())
    }
}

impl NookDatabase {
    pub(crate) async fn delete_device_identity_for_recovery(
        request: identity_record::LocalIdentityRecoveryRequest,
    ) -> Result<identity_record::LocalIdentityRecovery, NookError> {
        request.execute().await
    }
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
            NookDatabase::device_identity_protection_status().await?,
            DeviceProtectionStatus::Missing
        );

        let setup = DeviceKeyProtectionSetup::generate()?;
        let output = nook_core::WebAuthnPrfOutput::try_from(vec![21u8; 32])?;
        let secret = setup.user_handle().derive_identity(&output)?;
        let identity = DeviceIdentity::from_secret_str(&secret)?;
        let credential = nook_core::WebAuthnCredentialId::try_from(vec![7u8; 32])?;
        let wrapped = WrappedDeviceIdentity::passkey_derived(&PasskeyRecordMetadata {
            credential_id: &credential,
            user_handle: setup.user_handle(),
            prf_input: setup.prf_input(),
        })?;
        NookDatabase::save_wrapped_device_identity(SaveWrappedDeviceIdentityRequest {
            device_id: identity.device_id().as_str(),
            record: &wrapped,
        })
        .await?;

        let ProtectedLocalIdentity {
            wrapped_identity: reloaded,
            ..
        } = match NookDatabase::load_wrapped_device_identity().await? {
            ProtectedIdentityLookup::Configured(value) => Ok(value),
            ProtectedIdentityLookup::Unconfigured => {
                Err(JsError::new("wrapped device identity record should exist"))
            }
        }?;
        assert_eq!(reloaded.protection_mode(), "passkey");
        assert_eq!(reloaded.device_mode()?, "standard");
        assert_eq!(
            NookDatabase::device_identity_device_mode().await?,
            DeviceProtectionDeviceModeState::Standard
        );
        assert_eq!(reloaded.user_handle()?, *setup.user_handle());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn pin_identity_reports_explicit_pin_device_mode() -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        let identity = DeviceIdentity::generate()?;
        let wrapped =
            DeviceIdentityProtection::new(&identity.secret_string()).with_pin("123456")?;

        NookDatabase::save_wrapped_device_identity(SaveWrappedDeviceIdentityRequest {
            device_id: identity.device_id().as_str(),
            record: &wrapped,
        })
        .await?;

        assert_eq!(
            NookDatabase::device_identity_device_mode().await?,
            DeviceProtectionDeviceModeState::Pin
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn wrapped_identity_without_device_id_is_rejected() -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        let identity = DeviceIdentity::generate()?;
        let wrapped =
            DeviceIdentityProtection::new(&identity.secret_string()).with_pin("123456")?;
        NookDatabase::save_wrapped_device_identity(SaveWrappedDeviceIdentityRequest {
            device_id: identity.device_id().as_str(),
            record: &wrapped,
        })
        .await?;
        NookDatabase::idb_delete_keys(&[APP_ID_KEY, DEVICE_ID_KEY]).await?;

        assert!(NookDatabase::load_wrapped_device_identity().await.is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn live_app_id_lookup_is_independent_of_persisted_selection()
    -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        let first_key = AppKey::generate()?;
        let second_key = AppKey::generate()?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &first_key,
            record: &first_wrapped,
            prior_app_key: None,
            label: "Personal",
        })
        .await?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &second_key,
            record: &second_wrapped,
            prior_app_key: None,
            label: "Work",
        })
        .await?;

        let ProtectedLocalIdentity {
            app_id,
            wrapped_identity: reloaded,
        } = match NookDatabase::load_wrapped_device_identity_for_app_id(first_key.app_id().as_str())
            .await?
        {
            ProtectedIdentityLookup::Configured(value) => Ok(value),
            ProtectedIdentityLookup::Unconfigured => {
                Err(JsError::new("first identity record is missing"))
            }
        }?;

        assert_eq!(&app_id, first_key.app_id());
        assert_eq!(reloaded, first_wrapped);
        assert_eq!(
            match NookDatabase::load_wrapped_device_identity().await? {
                ProtectedIdentityLookup::Configured(value) => Ok(value),
                ProtectedIdentityLookup::Unconfigured =>
                    Err(JsError::new("selected identity record is missing")),
            }?
            .app_id,
            second_key.app_id().clone()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn recovery_atomically_forgets_app_key_and_identity_ownership()
    -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        let identity = DeviceIdentity::generate()?;
        let wrapped =
            DeviceIdentityProtection::new(&identity.secret_string()).with_pin("123456")?;
        NookDatabase::save_wrapped_device_identity(SaveWrappedDeviceIdentityRequest {
            device_id: identity.device_id().as_str(),
            record: &wrapped,
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: identity_record::IDENTITY_DIRECTORY_KEY,
            value: &serde_json::to_string(&IdentityDirectory::empty())?,
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: simple_genesis::PENDING_SIMPLE_GENESIS_KEY,
            value: "pending",
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: "vault:preserved",
            value: "ciphertext",
        })
        .await?;

        let recovery = NookDatabase::delete_device_identity_for_recovery(
            identity_record::LocalIdentityRecoveryRequest {
                expected_app_id: Some(identity.app_id().clone()),
            },
        )
        .await?;

        assert!(matches!(
            NookDatabase::load_wrapped_device_identity().await?,
            ProtectedIdentityLookup::Unconfigured
        ));
        assert!(
            NookDatabase::load_identity_directory()
                .await?
                .identities()
                .is_empty()
        );
        assert!(matches!(
            NookDatabase::idb_get_string(simple_genesis::PENDING_SIMPLE_GENESIS_KEY,).await?,
            StoredStringRecord::MissingKey
        ));
        assert_eq!(
            NookDatabase::idb_get_string("vault:preserved").await?,
            StoredStringRecord::Stored("ciphertext".to_owned())
        );
        recovery.complete().await?;
        Ok(())
    }
}
