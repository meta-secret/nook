#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
use crate::IdbPutStringRequest;
#[cfg(test)]
use crate::IdentityDbSaveNewProtectedLocalIdentity;
use crate::NookDatabase;
use crate::storage::identity_record;
use crate::storage::identity_record::ProtectedIdentityLookup;
use crate::storage::identity_record::ProtectedLocalIdentity;
use crate::storage::identity_record::StoredIdentityProtection;
use nook_core::AppId;
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
use nook_core::{DeviceIdentityProtection, PasskeyRecordMetadata, WrappedDeviceIdentity};

use wasm_bindgen::prelude::wasm_bindgen;

use super::NookError;
use nook_core::DeviceProtectionStatus;

/// Named values required by `NookDatabase::save_wrapped_device_identity`.
#[cfg(test)]
pub(crate) struct SaveWrappedDeviceIdentityRequest<'a> {
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) record: &'a nook_core::WrappedDeviceIdentity,
}

impl NookDatabase {
    #[allow(dead_code)]
    async fn device_identity_protection_status()
    -> Result<nook_core::DeviceProtectionStatus, NookError> {
        let ProtectedIdentityLookup::Configured(identity) =
            NookDatabase::load_wrapped_device_identity().await?
        else {
            return Ok(DeviceProtectionStatus::Missing);
        };
        let ProtectedLocalIdentity {
            wrapped_identity: wrapped,
            ..
        } = *identity;
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
        let ProtectedIdentityLookup::Configured(identity) =
            NookDatabase::load_wrapped_device_identity().await?
        else {
            return Ok(DeviceProtectionDeviceModeState::Missing);
        };
        let ProtectedLocalIdentity {
            wrapped_identity: wrapped,
            ..
        } = *identity;
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
    /// The selected local identity's protected app key.
    pub(crate) async fn load_wrapped_device_identity() -> Result<ProtectedIdentityLookup, NookError>
    {
        Ok(match NookDatabase::load_selected_entry().await? {
            StoredIdentityProtection::Protected(entry) => {
                ProtectedIdentityLookup::configured(ProtectedLocalIdentity {
                    app_id: entry.app_id().clone(),
                    wrapped_identity: entry.wrapped_app_key().clone(),
                })
            }
            StoredIdentityProtection::Unprotected => ProtectedIdentityLookup::Unconfigured,
        })
    }
}

impl NookDatabase {
    pub(crate) async fn load_wrapped_device_identity_for_app_id(
        app_id: &str,
    ) -> Result<ProtectedIdentityLookup, NookError> {
        let app_id =
            AppId::parse(app_id).map_err(|error| NookError::Database(error.to_string()))?;
        Ok(match NookDatabase::load_entry_for_app_id(&app_id).await? {
            StoredIdentityProtection::Protected(entry) => {
                ProtectedIdentityLookup::configured(ProtectedLocalIdentity {
                    app_id: entry.app_id().clone(),
                    wrapped_identity: entry.wrapped_app_key().clone(),
                })
            }
            StoredIdentityProtection::Unprotected => ProtectedIdentityLookup::Unconfigured,
        })
    }
}

/// Test fixture: protect an app key as a new local identity.
#[cfg(test)]
impl NookDatabase {
    pub(crate) async fn save_wrapped_device_identity(
        request: SaveWrappedDeviceIdentityRequest<'_>,
    ) -> Result<(), NookError> {
        let SaveWrappedDeviceIdentityRequest { app_key, record } = request;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key,
            record,
            label: "Personal",
        })
        .await?;
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
    use crate::storage::identity_record;
    use crate::storage::identity_record::RecoveryTarget;
    use crate::storage::identity_record::simple_genesis;
    use crate::storage::indexed_db::StoredStringRecord;
    use nook_core::{AppKey, DeviceIdentity, DeviceKeyProtectionSetup, DeviceProtectionStatus};
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
            app_key: &identity,
            record: &wrapped,
        })
        .await?;

        let ProtectedLocalIdentity {
            wrapped_identity: reloaded,
            ..
        } = *match NookDatabase::load_wrapped_device_identity().await? {
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
            app_key: &identity,
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
            label: "Personal",
        })
        .await?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &second_key,
            record: &second_wrapped,
            label: "Work",
        })
        .await?;

        let ProtectedLocalIdentity {
            app_id,
            wrapped_identity: reloaded,
        } = *match NookDatabase::load_wrapped_device_identity_for_app_id(
            first_key.app_id().as_str(),
        )
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
            app_key: &identity,
            record: &wrapped,
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
                target: RecoveryTarget::App(identity.app_id().clone()),
            },
        )
        .await?;

        assert!(matches!(
            NookDatabase::load_wrapped_device_identity().await?,
            ProtectedIdentityLookup::Unconfigured
        ));
        assert!(
            !NookDatabase::load_identity_directory()
                .await?
                .identities()
                .iter()
                .any(|owner| owner.has_app_id(identity.app_id()))
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
