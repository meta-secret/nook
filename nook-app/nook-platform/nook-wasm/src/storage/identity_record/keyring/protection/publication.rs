//! Commit prepared identity and signing material in transaction order.
use super::{
    IdentityDbWriteIdentityDirectory, KeyringDbKeyringDeleteKey, KeyringDbWriteKeyring,
    NookDatabase, NookError, PreparedProtectedIdentity, ProtectedLocalIdentitySave, event_db,
};
#[cfg(all(test, target_arch = "wasm32"))]
use crate::storage::identity_record::PriorAppAuthorization;
#[cfg(test)]
use crate::storage::identity_record::StoredIdentityProtection;

impl PreparedProtectedIdentity<'_> {
    pub(super) async fn persist(self) -> Result<ProtectedLocalIdentitySave, NookError> {
        NookDatabase::write_keyring(KeyringDbWriteKeyring {
            store: self.store,
            keyring: &self.keyring,
        })
        .await?;
        NookDatabase::write_identity_directory(IdentityDbWriteIdentityDirectory {
            store: self.store,
            directory: &self.directory,
        })
        .await?;
        NookDatabase::delete_legacy_active_key(self.store).await?;
        NookDatabase::keyring_delete_key(KeyringDbKeyringDeleteKey {
            store: self.store,
            key: event_db::SIGNING_SEED_KEY,
            context: "Legacy signing seed",
        })
        .await?;
        let identity = self
            .directory
            .identities()
            .iter()
            .find(|identity| identity.identity_id == self.identity_id)
            .cloned()
            .ok_or_else(|| NookError::Database("Protected identity disappeared".to_owned()))?;
        Ok(ProtectedLocalIdentitySave {
            identity,
            signing_seed: self.signing.into_seed(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::identity_record::PriorAppAuthorization;
    use nook_core::{DeviceIdentityProtection, SigningIdentity};
    use wasm_bindgen_test::wasm_bindgen_test;
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn distinct_protected_identities_can_be_selected_independently() -> Result<(), NookError>
    {
        NookDatabase::clear_keyring_for_test().await?;
        NookDatabase::clear_identity_directory_for_test().await?;
        let first_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let second_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;

        let first = NookDatabase::save_new_protected_local_identity(
            IdentityDbSaveNewProtectedLocalIdentity {
                app_key: &first_key,
                record: &first_wrapped,
                prior_app_key: PriorAppAuthorization::Unavailable,
                label: "Personal",
            },
        )
        .await?;
        let second = NookDatabase::save_new_protected_local_identity(
            IdentityDbSaveNewProtectedLocalIdentity {
                app_key: &second_key,
                record: &second_wrapped,
                prior_app_key: PriorAppAuthorization::Unavailable,
                label: "Work",
            },
        )
        .await?;

        assert_ne!(first.identity.identity_id, second.identity.identity_id);
        assert_ne!(first_key.app_id(), second_key.app_id());
        let keyring = NookDatabase::load_keyring().await?;
        assert_eq!(keyring.entries().len(), 2);
        let first_signing_public_key = keyring
            .entry(&first.identity.identity_id)
            .require_protected()
            .map_err(NookDatabase::map_domain_error)?
            .signing_public_key(&first_key)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let second_signing_public_key = keyring
            .entry(&second.identity.identity_id)
            .require_protected()
            .map_err(NookDatabase::map_domain_error)?
            .signing_public_key(&second_key)
            .map_err(|error| NookError::Database(error.to_string()))?;
        assert_ne!(first_signing_public_key, second_signing_public_key);
        NookDatabase::select_local_identity(first.identity.identity_id.clone()).await?;
        let selected = match NookDatabase::load_selected_entry().await? {
            StoredIdentityProtection::Protected(value) => Ok(value),
            StoredIdentityProtection::Unprotected => Err(NookError::Database(
                "Selected keyring entry is missing".to_owned(),
            )),
        }?;
        assert_eq!(selected.app_id(), first_key.app_id());
        assert_eq!(
            selected
                .signing_public_key(&first_key)
                .map_err(|error| NookError::Database(error.to_string()))?,
            SigningIdentity::from_seed_hex_stored(&first.signing_seed)
                .map_err(|error| NookError::Database(error.to_string()))?
                .public_key()
        );

        NookDatabase::clear_keyring_for_test().await?;
        NookDatabase::clear_identity_directory_for_test().await
    }
}
