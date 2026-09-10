//! Recovery directory evidence and fail-closed full-reset selection.
use super::{RecoveryPlanning, identity_record};
use crate::{NookDatabase, NookError};
use nook_core::IdentityDirectory;
pub(super) struct RecoveryDirectory {
    pub(super) value: IdentityDirectory,
    pub(super) readable: bool,
}
impl RecoveryPlanning<'_> {
    pub(super) async fn directory(&self) -> Result<RecoveryDirectory, NookError> {
        let store = self.store;
        let directory_key = serde_wasm_bindgen::to_value(identity_record::IDENTITY_DIRECTORY_KEY)
            .map_err(|error| {
            NookError::IndexedDb(format!("Identity reset key error: {error:?}"))
        })?;
        let raw = store.get(directory_key).await.map_err(|error| {
            NookError::IndexedDb(format!("Identity reset read error: {error:?}"))
        })?;
        let (mut directory, readable) =
            match raw.filter(|value| !value.is_undefined() && !value.is_null()) {
                Some(value) => match serde_wasm_bindgen::from_value::<String>(value)
                    .ok()
                    .and_then(|raw| NookDatabase::decode_directory(&raw).ok())
                {
                    Some(directory) => (directory, true),
                    None => (IdentityDirectory::empty(), false),
                },
                // A missing directory cannot prove which identity owns a surviving
                // keyring entry. Route recovery through the same safe full-reset
                // path as corrupt or future-incompatible directory metadata.
                None => (IdentityDirectory::empty(), false),
            };
        for app_id in NookDatabase::load_retired_app_ids(store)
            .await
            .unwrap_or_default()
        {
            directory = directory.retire_app_id(app_id);
        }
        Ok(RecoveryDirectory {
            value: directory,
            readable,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::identity_record::PriorAppAuthorization;
    use crate::storage::identity_record::RecoveryTarget;
    use crate::storage::identity_record::{
        IDENTITY_DIRECTORY_KEY, recovery::LocalIdentityRecoveryRequest,
    };
    use crate::{IdbPutStringRequest, IdentityDbSaveNewProtectedLocalIdentity};
    use nook_core::{AppKey, DeviceIdentityProtection};
    use wasm_bindgen_test::wasm_bindgen_test;
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn corrupt_directory_with_valid_keyring_uses_safe_full_reset() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        NookDatabase::clear_keyring_for_test().await?;
        let first_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let second_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &first_key,
            record: &first_wrapped,
            prior_app_key: PriorAppAuthorization::Unavailable,
            label: "Personal",
        })
        .await?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &second_key,
            record: &second_wrapped,
            prior_app_key: PriorAppAuthorization::Unavailable,
            label: "Work",
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: IDENTITY_DIRECTORY_KEY,
            value: "{future-or-corrupt",
        })
        .await?;

        let recovery = LocalIdentityRecoveryRequest {
            target: RecoveryTarget::App(first_key.app_id().clone()),
        }
        .execute()
        .await?;

        assert!(!recovery.has_remaining_local_identities);
        assert!(NookDatabase::load_keyring().await?.entries().is_empty());
        let directory = NookDatabase::load_identity_directory().await?;
        assert!(directory.identities().is_empty());
        assert!(directory.retired_app_ids().contains(first_key.app_id()));
        assert!(directory.retired_app_ids().contains(second_key.app_id()));
        recovery.complete().await?;
        NookDatabase::clear_keyring_for_test().await?;
        NookDatabase::clear_identity_directory_for_test().await
    }
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn missing_directory_with_valid_keyring_uses_safe_full_reset() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        NookDatabase::clear_keyring_for_test().await?;
        let first_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let second_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &first_key,
            record: &first_wrapped,
            prior_app_key: PriorAppAuthorization::Unavailable,
            label: "Personal",
        })
        .await?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &second_key,
            record: &second_wrapped,
            prior_app_key: PriorAppAuthorization::Unavailable,
            label: "Work",
        })
        .await?;
        NookDatabase::idb_delete_key(IDENTITY_DIRECTORY_KEY).await?;

        let recovery = LocalIdentityRecoveryRequest {
            target: RecoveryTarget::App(first_key.app_id().clone()),
        }
        .execute()
        .await?;

        assert!(!recovery.has_remaining_local_identities);
        assert!(NookDatabase::load_keyring().await?.entries().is_empty());
        let directory = NookDatabase::load_identity_directory().await?;
        assert!(directory.identities().is_empty());
        assert!(directory.retired_app_ids().contains(first_key.app_id()));
        assert!(directory.retired_app_ids().contains(second_key.app_id()));
        recovery.complete().await?;
        NookDatabase::clear_keyring_for_test().await?;
        NookDatabase::clear_identity_directory_for_test().await
    }
}
