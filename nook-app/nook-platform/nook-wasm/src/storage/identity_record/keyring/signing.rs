#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Signing material bound to independently protected local identity entries.
use super as keyring;
use crate::IdentityDbWriteIdentityDirectory;
use crate::KeyringDbKeyringDeleteKey;
use crate::KeyringDbKeyringReadString;
use crate::KeyringDbLoadKeyringForStore;
use crate::KeyringDbWriteKeyring;
use crate::storage::{self, event_db, identity_record};
use crate::{IdbPutStringRequest, NookDatabase, NookError};
use nook_core::{
    AppId, AppKey, DeviceSigningPublicKey, IdentityDirectory, IdentityId, IdentitySelection,
    IdentitySigningSeedProtection, LocalIdentityKeyring, LocalIdentityKeyringEntry,
    SigningIdentity, SigningSeedProtection, i18n_keys,
};
use nook_core::{DirectoryMemberSigningUpdate, IdentityMemberSigningUpdate};
use rexie::{Store, TransactionMode};

pub(super) enum SigningSeedOrigin {
    MigrateLegacy,
    NewIdentity,
}
pub(super) enum IdentityVaultEvidence {
    Empty,
    Established,
}
pub(super) struct IdentitySigningEvidence<'a> {
    pub(super) directory: &'a IdentityDirectory,
    pub(super) identity_id: &'a IdentityId,
    pub(super) app_id: &'a AppId,
}
pub(super) struct IdentitySigningSource<'a> {
    pub(super) store: &'a Store,
    pub(super) existing: Option<&'a LocalIdentityKeyringEntry>,
    pub(super) app_key: &'a AppKey,
    pub(super) origin: SigningSeedOrigin,
    pub(super) established: &'a DeviceSigningPublicKey,
    pub(super) vaults: IdentityVaultEvidence,
}
/// A seed and its checked public key stay together until the owner consumes them.
///
/// ```compile_fail,E0603
/// use nook_wasm::storage::identity_record::keyring::signing::CheckedIdentitySigningMaterial;
/// ```
pub(super) struct CheckedIdentitySigningMaterial {
    seed: String,
    public_key: DeviceSigningPublicKey,
}
impl CheckedIdentitySigningMaterial {
    #[must_use]
    pub(super) fn seed(&self) -> &str {
        &self.seed
    }
    #[must_use]
    pub(super) fn public_key(&self) -> &DeviceSigningPublicKey {
        &self.public_key
    }
    #[must_use]
    pub(super) fn into_seed(self) -> String {
        self.seed
    }
}
struct EstablishedSigningKey<'a>(&'a DeviceSigningPublicKey);
impl EstablishedSigningKey<'_> {
    fn check(&self, derived: &DeviceSigningPublicKey) -> Result<(), NookError> {
        if !matches!(self.0, DeviceSigningPublicKey::Unavailable) && self.0 != derived {
            return Err(NookError::Database(
                "Legacy signing seed does not match the established signing public key".to_owned(),
            ));
        }
        Ok(())
    }
}
impl IdentitySigningSource<'_> {
    pub(super) async fn check(self) -> Result<CheckedIdentitySigningMaterial, NookError> {
        let store = self.store;
        let existing = self.existing;
        let app_key = self.app_key;
        let legacy_signing_public_key = self.established;
        let seed = match existing {
            Some(entry) if entry.has_signing_seed() => entry
                .open_signing_seed(app_key)
                .map_err(|error| NookError::Database(error.to_string()))?
                .ok_or_else(|| {
                    NookError::Database("Protected signing seed is missing".to_owned())
                })?,
            Some(_) | None if matches!(self.origin, SigningSeedOrigin::MigrateLegacy) => {
                match NookDatabase::keyring_read_string(KeyringDbKeyringReadString {
                    store: store,
                    key: event_db::SIGNING_SEED_KEY,
                    context: "Legacy signing seed",
                })
                .await?
                {
                    Some(seed) => seed,
                    None if matches!(
                        legacy_signing_public_key,
                        DeviceSigningPublicKey::Unavailable
                    ) && matches!(self.vaults, IdentityVaultEvidence::Empty) =>
                    {
                        SigningIdentity::generate()
                            .map_err(|error| NookError::Database(error.to_string()))?
                            .1
                            .as_str()
                            .to_owned()
                    }
                    None => {
                        return Err(NookError::Database(
                    "Legacy protected identity with signing or vault evidence is missing its established signing seed"
                        .to_owned(),
                ));
                    }
                }
            }
            Some(_) => {
                return Err(NookError::Database(
                    "Existing protected identity cannot mint replacement signing material"
                        .to_owned(),
                ));
            }
            None => SigningIdentity::generate()
                .map_err(|error| NookError::Database(error.to_string()))?
                .1
                .as_str()
                .to_owned(),
        };
        let signing = SigningIdentity::from_seed_hex_stored(&seed)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let signing_public_key = signing.public_key();
        EstablishedSigningKey(self.established).check(&signing_public_key)?;
        Ok(CheckedIdentitySigningMaterial {
            seed,
            public_key: signing_public_key,
        })
    }
}
impl IdentitySigningEvidence<'_> {
    pub(super) fn public_key(&self) -> Result<DeviceSigningPublicKey, NookError> {
        self.directory
            .identities()
            .iter()
            .find(|identity| identity.identity_id == *self.identity_id)
            .and_then(|identity| {
                identity
                    .members
                    .iter()
                    .find(|member| member.app_id == *self.app_id)
            })
            .map(|member| member.signing_public_key.clone())
            .ok_or_else(|| NookError::Database("Protected identity member disappeared".to_owned()))
    }
    pub(super) fn vaults(&self) -> Result<IdentityVaultEvidence, NookError> {
        self.directory
            .identities()
            .iter()
            .find(|identity| identity.identity_id == *self.identity_id)
            .map(|identity| {
                if identity.vault_deks.is_empty() {
                    IdentityVaultEvidence::Empty
                } else {
                    IdentityVaultEvidence::Established
                }
            })
            .ok_or_else(|| NookError::Database("Protected identity disappeared".to_owned()))
    }
}
pub(super) struct LegacySignerProtection<'a> {
    pub(super) store: &'a Store,
    pub(super) directory: IdentityDirectory,
    pub(super) keyring: LocalIdentityKeyring,
}
pub(super) struct ProtectedLegacySigners {
    pub(super) directory: IdentityDirectory,
    pub(super) keyring: LocalIdentityKeyring,
}
impl LegacySignerProtection<'_> {
    pub(super) async fn protect(
        self,
        prior_app_key: Option<&AppKey>,
    ) -> Result<ProtectedLegacySigners, NookError> {
        let Self {
            store,
            mut directory,
            keyring,
        } = self;
        let Some(seed) = NookDatabase::keyring_read_string(KeyringDbKeyringReadString {
            store: store,
            key: event_db::SIGNING_SEED_KEY,
            context: "Legacy signing seed",
        })
        .await?
        else {
            return Ok(ProtectedLegacySigners { directory, keyring });
        };
        let IdentitySelection::Selected(identity_id) = directory.selection() else {
            return Err(NookError::Database(
                "Legacy signing seed has no selected identity owner".to_owned(),
            ));
        };
        let identity_id = identity_id.clone();
        let existing = keyring.entry(&identity_id).ok_or_else(|| {
            NookError::Database("Legacy signing seed owner has no local keyring entry".to_owned())
        })?;
        if existing.has_signing_seed() {
            return Ok(ProtectedLegacySigners { directory, keyring });
        }
        let prior_app_key = prior_app_key.ok_or_else(|| {
            NookError::Decryption(
                i18n_keys::ERRORS_DEVICE_PROTECTION_AUTHORIZATION_REQUIRED.to_owned(),
            )
        })?;
        let established_signing_public_key = IdentitySigningEvidence {
            directory: &directory,
            identity_id: &identity_id,
            app_id: prior_app_key.app_id(),
        }
        .public_key()?;
        let signing_public_key = SigningIdentity::from_seed_hex_stored(&seed)
            .map_err(|error| NookError::Database(error.to_string()))?
            .public_key();
        EstablishedSigningKey(&established_signing_public_key).check(&signing_public_key)?;
        let protected = keyring
            .protect_signing_seed(IdentitySigningSeedProtection {
                identity_id: &identity_id,
                material: SigningSeedProtection {
                    app_key: prior_app_key,
                    signing_seed: &seed,
                },
            })
            .map_err(|rejected| NookError::Database(rejected.into_cause().to_string()))?;
        EstablishedSigningKey(&signing_public_key).check(&protected.signing_public_key)?;
        directory = directory
            .set_member_signing_public_key(DirectoryMemberSigningUpdate {
                identity_id: &identity_id,
                member: IdentityMemberSigningUpdate {
                    app_id: prior_app_key.app_id(),
                    signing_public_key: &protected.signing_public_key,
                },
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        Ok(ProtectedLegacySigners {
            directory,
            keyring: protected.keyring,
        })
    }
}
pub(crate) struct LocalIdentitySigner<'a> {
    pub(crate) app_key: &'a AppKey,
}
impl LocalIdentitySigner<'_> {
    pub(crate) async fn load_or_create(self) -> Result<String, NookError> {
        let app_key = self.app_key;
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| {
                NookError::IndexedDb(format!("Identity signing key load error: {error:?}"))
            })?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Identity signing key store error: {error:?}"))
        })?;
        let mut directory = NookDatabase::load_directory_for_write(&store).await?;
        let mut keyring = NookDatabase::load_keyring_for_store(KeyringDbLoadKeyringForStore {
            store: &store,
            directory: &directory,
        })
        .await?;
        let existing = keyring
            .entries()
            .iter()
            .find(|entry| entry.app_id() == app_key.app_id())
            .ok_or_else(|| {
                NookError::Database("App key has no protected local keyring entry".to_owned())
            })?;
        let identity_id = existing.identity_id().clone();
        let evidence = IdentitySigningEvidence {
            directory: &directory,
            identity_id: &identity_id,
            app_id: app_key.app_id(),
        };
        let established = evidence.public_key()?;
        let vaults = evidence.vaults()?;
        let signing = IdentitySigningSource {
            store: &store,
            existing: Some(existing),
            app_key,
            origin: SigningSeedOrigin::MigrateLegacy,
            established: &established,
            vaults,
        }
        .check()
        .await?;
        if !existing.has_signing_seed() {
            keyring = keyring
                .protect_signing_seed(IdentitySigningSeedProtection {
                    identity_id: &identity_id,
                    material: SigningSeedProtection {
                        app_key,
                        signing_seed: signing.seed(),
                    },
                })
                .map_err(|rejected| NookError::Database(rejected.into_cause().to_string()))?
                .keyring;
            directory = directory
                .set_member_signing_public_key(DirectoryMemberSigningUpdate {
                    identity_id: &identity_id,
                    member: IdentityMemberSigningUpdate {
                        app_id: app_key.app_id(),
                        signing_public_key: signing.public_key(),
                    },
                })
                .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
            NookDatabase::write_keyring(KeyringDbWriteKeyring {
                store: &store,
                keyring: &keyring,
            })
            .await?;
            NookDatabase::write_identity_directory(IdentityDbWriteIdentityDirectory {
                store: &store,
                directory: &directory,
            })
            .await?;
        }
        NookDatabase::keyring_delete_key(KeyringDbKeyringDeleteKey {
            store: &store,
            key: event_db::SIGNING_SEED_KEY,
            context: "Legacy signing seed",
        })
        .await?;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Identity signing key completion error: {error:?}"))
        })?;
        Ok(signing.into_seed())
    }
}
#[cfg(test)]
mod tests {
    use crate::storage;
    use crate::storage::{event_db, indexed_db};
    use nook_core::{
        AppKey, DeviceSigningPublicKey, IdentityRecord, LocalIdentityKeyringEntry, SigningIdentity,
    };
    use rexie::TransactionMode;

    use super::{
        CheckedIdentitySigningMaterial, IdentitySigningSource, IdentityVaultEvidence,
        SigningSeedOrigin,
    };
    use crate::NookError;
    use nook_core::DeviceIdentityProtection;
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);

    struct LegacySeedFixture {
        seed: String,
        established: DeviceSigningPublicKey,
    }
    impl LegacySeedFixture {
        async fn check(self) -> Result<CheckedIdentitySigningMaterial, NookError> {
            NookDatabase::idb_put_string(IdbPutStringRequest {
                key: event_db::SIGNING_SEED_KEY,
                value: &self.seed,
            })
            .await?;
            let app_key =
                AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
            let db = NookDatabase::open_nook_database().await?;
            let transaction = db
                .transaction(&["vault"], TransactionMode::ReadOnly)
                .map_err(|error| {
                    NookError::IndexedDb(format!("Seed test transaction error: {error:?}"))
                })?;
            let store = transaction.store("vault").map_err(|error| {
                NookError::IndexedDb(format!("Seed test store error: {error:?}"))
            })?;
            let result = IdentitySigningSource {
                store: &store,
                existing: None,
                app_key: &app_key,
                origin: SigningSeedOrigin::MigrateLegacy,
                established: &self.established,
                vaults: IdentityVaultEvidence::Empty,
            }
            .check()
            .await;
            transaction.done().await.map_err(|error| {
                NookError::IndexedDb(format!("Seed test completion error: {error:?}"))
            })?;
            assert_eq!(
                NookDatabase::idb_get_string(event_db::SIGNING_SEED_KEY)
                    .await?
                    .as_deref(),
                Some(self.seed.as_str())
            );
            NookDatabase::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
            result
        }
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn checked_material_preserves_the_exact_legacy_seed() -> Result<(), NookError> {
        let seed = "11".repeat(32);
        let signing = SigningIdentity::from_seed_hex_stored(&seed)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let material = LegacySeedFixture {
            seed: seed.clone(),
            established: signing.public_key(),
        }
        .check()
        .await?;
        assert_eq!(material.public_key(), &signing.public_key());
        assert_eq!(material.into_seed(), seed);
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn malformed_and_wrong_legacy_seeds_remain_unpublished() -> Result<(), NookError> {
        let malformed = LegacySeedFixture {
            seed: "not a seed".to_owned(),
            established: DeviceSigningPublicKey::Unavailable,
        }
        .check()
        .await;
        assert!(matches!(malformed, Err(NookError::Database(_))));
        let other = SigningIdentity::from_seed_hex_stored(&"22".repeat(32))
            .map_err(|error| NookError::Database(error.to_string()))?;
        let mismatched = LegacySeedFixture {
            seed: "11".repeat(32),
            established: other.public_key(),
        }
        .check()
        .await;
        assert!(
            matches!(mismatched, Err(NookError::Database(message)) if message == "Legacy signing seed does not match the established signing public key")
        );
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn signed_vault_identity_without_seed_cannot_mint_a_replacement_signer()
    -> Result<(), NookError> {
        NookDatabase::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
        let app_key = AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let wrapped = DeviceIdentityProtection::new(&app_key.secret_string())
            .with_pin("legacy identity pin")?;
        let identity = IdentityRecord::create_with_app_key("Legacy", &app_key, None)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let entry = LocalIdentityKeyringEntry::legacy(
            identity.identity_id,
            app_key.app_id().clone(),
            wrapped,
        );
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| NookError::IndexedDb(format!("Signer test error: {error:?}")))?;
        let store = transaction
            .store("vault")
            .map_err(|error| NookError::IndexedDb(format!("Signer test store error: {error:?}")))?;

        let result = IdentitySigningSource {
            store: &store,
            existing: Some(&entry),
            app_key: &app_key,
            origin: SigningSeedOrigin::MigrateLegacy,
            established: &DeviceSigningPublicKey::Unavailable,
            vaults: IdentityVaultEvidence::Established,
        }
        .check()
        .await;

        assert!(
            matches!(result, Err(NookError::Database(message)) if message.contains("vault evidence"))
        );
        transaction.done().await.map(|_| ()).map_err(|error| {
            NookError::IndexedDb(format!("Signer test completion error: {error:?}"))
        })
    }
}
