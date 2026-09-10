#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Protection admission and ordered publication inside the caller's identity transaction.
use super as keyring;
use super::ProtectedLocalIdentitySave;
use super::legacy;
use super::signing::{
    CheckedIdentitySigningMaterial, IdentitySigningEvidence, IdentitySigningSource,
    LegacySignerProtection, SigningSeedOrigin,
};
use crate::IdentityDbEnsureLocalIdentityInDirectory;
use crate::IdentityDbSaveNewProtectedLocalIdentity;
use crate::IdentityDbSaveProtectedLocalIdentity;
use crate::IdentityDbWriteIdentityDirectory;
use crate::KeyringDbKeyringDeleteKey;
use crate::KeyringDbKeyringReadString;
use crate::KeyringDbLoadKeyringForStore;
use crate::KeyringDbValidateKeyringDirectoryBinding;
use crate::KeyringDbWriteKeyring;
use crate::storage::identity_record::IdentityDirectoryWrite;
use crate::storage::identity_record::{self, PENDING_SIMPLE_GENESIS_KEY, recovery};
use crate::storage::{event_db, indexed_db};
use crate::{IdbPutStringRequest, NookDatabase, NookError, SaveWrappedDeviceIdentityRequest};
use nook_core::{
    AppKey, IdentityDirectory, IdentityId, IdentitySelection, LocalIdentityKeyring,
    LocalIdentityKeyringEntry, WrappedDeviceIdentity,
};
use nook_core::{DirectoryMemberSigningUpdate, IdentityCreation, IdentityMemberSigningUpdate};
#[cfg(test)]
use nook_core::{ProtectedSigningMaterial, SigningSeedHex};
use rexie::Store;

mod admission;
pub(super) use admission::IdentityTransitionAdmission;
pub(crate) struct ProtectedIdentityPublication<'a> {
    pub(crate) store: &'a Store,
    pub(crate) directory: IdentityDirectory,
    pub(crate) app_key: &'a AppKey,
    pub(crate) wrapped_app_key: &'a WrappedDeviceIdentity,
    pub(crate) label: &'a str,
}
struct ProtectedIdentitySelection {
    keyring: LocalIdentityKeyring,
    identity_id: IdentityId,
    seed_origin: SigningSeedOrigin,
}
/// In-memory preparation, not transaction completion. Dropping performs no cleanup.
/// Callers cannot manufacture or reuse this private, non-Clone publication state.
///
/// ```compile_fail,E0603
/// use nook_wasm::storage::identity_record::keyring::protection::PreparedProtectedIdentity;
/// ```
struct PreparedProtectedIdentity<'a> {
    store: &'a Store,
    directory: IdentityDirectory,
    keyring: LocalIdentityKeyring,
    identity_id: IdentityId,
    signing: CheckedIdentitySigningMaterial,
}
impl<'a> ProtectedIdentityPublication<'a> {
    pub(crate) async fn save_existing(mut self) -> Result<ProtectedLocalIdentitySave, NookError> {
        IdentityTransitionAdmission { store: self.store }
            .check()
            .await?;
        let keyring = NookDatabase::load_keyring_for_store(KeyringDbLoadKeyringForStore {
            store: self.store,
            directory: &self.directory,
        })
        .await?;
        // Peer-only recovery can bootstrap an independent local identity.
        let allow_peer_only_bootstrap = keyring.entries().is_empty()
            && matches!(self.directory.selection(), IdentitySelection::Empty);
        let ensured = NookDatabase::ensure_local_identity_in_directory(
            IdentityDbEnsureLocalIdentityInDirectory {
                directory: self.directory,
                app_key: self.app_key,
                label: self.label,
                allow_peer_only_bootstrap: allow_peer_only_bootstrap,
            },
        )?;
        self.directory = ensured.directory;
        self.prepare(ProtectedIdentitySelection {
            keyring,
            identity_id: ensured.value.identity_id,
            seed_origin: SigningSeedOrigin::MigrateLegacy,
        })
        .await?
        .persist()
        .await
    }
    pub(crate) async fn save_new(
        mut self,
        prior_app_key: Option<&AppKey>,
    ) -> Result<ProtectedLocalIdentitySave, NookError> {
        IdentityTransitionAdmission { store: self.store }
            .check()
            .await?;
        let mut keyring = NookDatabase::load_keyring_for_store(KeyringDbLoadKeyringForStore {
            store: self.store,
            directory: &self.directory,
        })
        .await?;
        let protected = LegacySignerProtection {
            store: self.store,
            directory: self.directory,
            keyring,
        }
        .protect(prior_app_key)
        .await?;
        self.directory = protected.directory;
        keyring = protected.keyring;
        let created = self
            .directory
            .create_identity(IdentityCreation {
                label: self.label,
                app_key: self.app_key,
                member_label: None,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        self.directory = created.directory;
        self.prepare(ProtectedIdentitySelection {
            keyring,
            identity_id: created.identity_id,
            seed_origin: SigningSeedOrigin::NewIdentity,
        })
        .await?
        .persist()
        .await
    }
    async fn prepare(
        mut self,
        selection: ProtectedIdentitySelection,
    ) -> Result<PreparedProtectedIdentity<'a>, NookError> {
        let ProtectedIdentitySelection {
            mut keyring,
            identity_id,
            seed_origin,
        } = selection;
        let existing = keyring.entry(&identity_id);
        let evidence = IdentitySigningEvidence {
            directory: &self.directory,
            identity_id: &identity_id,
            app_id: self.app_key.app_id(),
        };
        let established = evidence.public_key()?;
        let vaults = evidence.vaults()?;
        let signing = IdentitySigningSource {
            store: self.store,
            existing,
            app_key: self.app_key,
            origin: seed_origin,
            established: &established,
            vaults,
        }
        .check()
        .await?;
        let entry = LocalIdentityKeyringEntry::protected(
            identity_id.clone(),
            self.app_key,
            self.wrapped_app_key.clone(),
            signing.seed(),
        )
        .map_err(|error| NookError::Database(error.to_string()))?;
        if existing.is_some() {
            keyring = keyring
                .replace(entry)
                .map_err(|error| NookError::Database(error.to_string()))?;
        } else {
            keyring = keyring
                .insert(entry)
                .map_err(|error| NookError::Database(error.to_string()))?;
        }
        self.directory = self
            .directory
            .set_member_signing_public_key(DirectoryMemberSigningUpdate {
                identity_id: &identity_id,
                member: IdentityMemberSigningUpdate {
                    app_id: self.app_key.app_id(),
                    signing_public_key: signing.public_key(),
                },
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        NookDatabase::validate_keyring_directory_binding(
            KeyringDbValidateKeyringDirectoryBinding {
                keyring: &keyring,
                directory: &self.directory,
            },
        )?;
        Ok(PreparedProtectedIdentity {
            store: self.store,
            directory: self.directory,
            keyring,
            identity_id,
            signing,
        })
    }
}
mod publication;
#[cfg(test)]
mod tests {

    use crate::storage::identity_record::IdentityDirectoryWrite;

    use super::*;
    use crate::storage::identity_record;
    use crate::storage::identity_record::{recovery, simple_genesis};
    use crate::storage::{event_db, indexed_db};
    use nook_core::{AppKey, DeviceSigningPublicKey, LocalIdentityKeyringEntry, SigningIdentity};
    use nook_core::{DirectoryMemberSigningUpdate, IdentityMemberSigningUpdate};
    use rexie::{Rexie, TransactionMode};

    use super::{
        IdentityTransitionAdmission, ProtectedIdentityPublication, ProtectedIdentitySelection,
        ProtectedLocalIdentitySave, SigningSeedOrigin, keyring,
    };
    use crate::NookError;
    use crate::storage;
    use keyring::LOCAL_IDENTITY_KEYRING_KEY;
    use keyring::LocalIdentitySigner;
    use nook_core::DeviceIdentityProtection;
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);

    struct PinIdentityFixture<'a> {
        label: &'a str,
        pin: &'a str,
        prior_app_key: Option<&'a AppKey>,
    }
    impl PinIdentityFixture<'_> {
        async fn create(
            self,
        ) -> Result<
            (
                AppKey,
                nook_core::WrappedDeviceIdentity,
                ProtectedLocalIdentitySave,
            ),
            NookError,
        > {
            let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
            let wrapped =
                DeviceIdentityProtection::new(&app_key.secret_string()).with_pin(self.pin)?;
            let saved = NookDatabase::save_new_protected_local_identity(
                IdentityDbSaveNewProtectedLocalIdentity {
                    app_key: &app_key,
                    record: &wrapped,
                    prior_app_key: self.prior_app_key,
                    label: self.label,
                },
            )
            .await?;
            Ok((app_key, wrapped, saved))
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
    async fn dropping_prepared_publication_keeps_durable_identity_and_signer()
    -> Result<(), NookError> {
        NookDatabase::clear_keyring_for_test().await?;
        NookDatabase::clear_identity_directory_for_test().await?;
        let (app_key, wrapped, saved) = PinIdentityFixture {
            label: "Personal",
            pin: "original-pin",
            prior_app_key: None,
        }
        .create()
        .await?;
        let original_keyring = NookDatabase::idb_get_string(LOCAL_IDENTITY_KEYRING_KEY).await?;
        let original_directory =
            NookDatabase::idb_get_string(identity_record::IDENTITY_DIRECTORY_KEY).await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: event_db::SIGNING_SEED_KEY,
            value: &saved.signing_seed,
        })
        .await?;
        let db = NookDatabase::open_nook_database().await?;
        let transaction = db
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| {
                NookError::IndexedDb(format!("Prepared test transaction error: {error:?}"))
            })?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Prepared test store error: {error:?}"))
        })?;
        let mut directory = NookDatabase::load_directory_for_write(&store).await?;
        let keyring = NookDatabase::load_keyring_for_store(KeyringDbLoadKeyringForStore {
            store: &store,
            directory: &directory,
        })
        .await?;
        {
            let _prepared = ProtectedIdentityPublication {
                store: &store,
                directory,
                app_key: &app_key,
                wrapped_app_key: &wrapped,
                label: "Personal",
            }
            .prepare(ProtectedIdentitySelection {
                keyring,
                identity_id: saved.identity.identity_id,
                seed_origin: SigningSeedOrigin::MigrateLegacy,
            })
            .await?;
        }
        assert_eq!(
            NookDatabase::keyring_read_string(KeyringDbKeyringReadString {
                store: &store,
                key: LOCAL_IDENTITY_KEYRING_KEY,
                context: "Test keyring"
            })
            .await?,
            original_keyring
        );
        assert_eq!(
            NookDatabase::keyring_read_string(KeyringDbKeyringReadString {
                store: &store,
                key: identity_record::IDENTITY_DIRECTORY_KEY,
                context: "Test directory"
            })
            .await?,
            original_directory
        );
        assert_eq!(
            NookDatabase::keyring_read_string(KeyringDbKeyringReadString {
                store: &store,
                key: event_db::SIGNING_SEED_KEY,
                context: "Test seed"
            })
            .await?
            .as_deref(),
            Some(saved.signing_seed.as_str())
        );
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Prepared test completion error: {error:?}"))
        })?;
        NookDatabase::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
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
    async fn second_identity_requires_legacy_signer_to_be_protected_first() -> Result<(), NookError>
    {
        NookDatabase::clear_keyring_for_test().await?;
        NookDatabase::clear_identity_directory_for_test().await?;
        let first_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let first = NookDatabase::save_new_protected_local_identity(
            IdentityDbSaveNewProtectedLocalIdentity {
                app_key: &first_key,
                record: &first_wrapped,
                prior_app_key: None,
                label: "Personal",
            },
        )
        .await?;
        let mut legacy_keyring = NookDatabase::load_keyring().await?;
        legacy_keyring = legacy_keyring
            .replace(LocalIdentityKeyringEntry::legacy(
                first.identity.identity_id.clone(),
                first_key.app_id().clone(),
                first_wrapped,
            ))
            .map_err(|error| NookError::Database(error.to_string()))?;
        let encoded = serde_json::to_string(&legacy_keyring)
            .map_err(|error| NookError::Database(error.to_string()))?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: LOCAL_IDENTITY_KEYRING_KEY,
            value: &encoded,
        })
        .await?;
        let legacy_seed = first.signing_seed.clone();
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: event_db::SIGNING_SEED_KEY,
            value: &legacy_seed,
        })
        .await?;

        let second_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        assert!(
            NookDatabase::save_new_protected_local_identity(
                IdentityDbSaveNewProtectedLocalIdentity {
                    app_key: &second_key,
                    record: &second_wrapped,
                    prior_app_key: None,
                    label: "Work"
                }
            )
            .await
            .is_err()
        );
        assert_eq!(
            NookDatabase::idb_get_string(event_db::SIGNING_SEED_KEY,).await?,
            Some(legacy_seed.clone())
        );
        assert_eq!(NookDatabase::load_keyring().await?.entries().len(), 1);

        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &second_key,
            record: &second_wrapped,
            prior_app_key: Some(&first_key),
            label: "Work",
        })
        .await?;
        let migrated = NookDatabase::load_keyring().await?;
        assert_eq!(migrated.entries().len(), 2);
        assert_eq!(
            migrated
                .entry(&first.identity.identity_id)
                .ok_or_else(|| {
                    NookError::Database("Migrated legacy keyring entry is missing".to_owned())
                })?
                .open_signing_seed(&first_key)
                .map_err(|error| NookError::Database(error.to_string()))?,
            ProtectedSigningMaterial::Opened(SigningSeedHex::from_trusted(legacy_seed))
        );
        assert!(
            NookDatabase::idb_get_string(event_db::SIGNING_SEED_KEY,)
                .await?
                .is_none()
        );

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
    async fn stale_legacy_signing_seed_cannot_replace_established_membership()
    -> Result<(), NookError> {
        NookDatabase::clear_keyring_for_test().await?;
        NookDatabase::clear_identity_directory_for_test().await?;
        let (first_key, first_wrapped, first) = PinIdentityFixture {
            label: "Personal",
            pin: "first-secret",
            prior_app_key: None,
        }
        .create()
        .await?;
        let mut legacy_keyring = NookDatabase::load_keyring().await?;
        legacy_keyring = legacy_keyring
            .replace(LocalIdentityKeyringEntry::legacy(
                first.identity.identity_id.clone(),
                first_key.app_id().clone(),
                first_wrapped,
            ))
            .map_err(|error| NookError::Database(error.to_string()))?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: LOCAL_IDENTITY_KEYRING_KEY,
            value: &serde_json::to_string(&legacy_keyring)
                .map_err(|error| NookError::Database(error.to_string()))?,
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: event_db::SIGNING_SEED_KEY,
            value: &"22".repeat(32),
        })
        .await?;
        let second_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;

        let result = NookDatabase::save_new_protected_local_identity(
            IdentityDbSaveNewProtectedLocalIdentity {
                app_key: &second_key,
                record: &second_wrapped,
                prior_app_key: Some(&first_key),
                label: "Work",
            },
        )
        .await;

        assert!(
            matches!(result, Err(NookError::Database(message)) if message.contains("established signing public key"))
        );
        assert_eq!(NookDatabase::load_keyring().await?.entries().len(), 1);
        let directory = NookDatabase::load_identity_directory().await?;
        assert_eq!(directory.identities().len(), 1);
        assert_eq!(directory.identities()[0], first.identity);

        NookDatabase::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
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
    async fn normal_unlock_promotes_a_seedless_migrated_keyring_entry() -> Result<(), NookError> {
        NookDatabase::clear_keyring_for_test().await?;
        NookDatabase::clear_identity_directory_for_test().await?;
        let (app_key, wrapped, protected) = PinIdentityFixture {
            label: "Personal",
            pin: "first-secret",
            prior_app_key: None,
        }
        .create()
        .await?;
        let mut keyring = NookDatabase::load_keyring().await?;
        keyring = keyring
            .replace(LocalIdentityKeyringEntry::legacy(
                protected.identity.identity_id.clone(),
                app_key.app_id().clone(),
                wrapped,
            ))
            .map_err(|error| NookError::Database(error.to_string()))?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: LOCAL_IDENTITY_KEYRING_KEY,
            value: &serde_json::to_string(&keyring)
                .map_err(|error| NookError::Database(error.to_string()))?,
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: event_db::SIGNING_SEED_KEY,
            value: &protected.signing_seed,
        })
        .await?;

        let signing_seed = LocalIdentitySigner { app_key: &app_key }
            .load_or_create()
            .await?;

        assert_eq!(signing_seed, protected.signing_seed);
        assert!(NookDatabase::load_keyring().await?.entries()[0].has_signing_seed());
        assert!(
            NookDatabase::idb_get_string(event_db::SIGNING_SEED_KEY)
                .await?
                .is_none()
        );
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
    async fn legacy_identity_with_signing_evidence_but_no_seed_fails_closed()
    -> Result<(), NookError> {
        NookDatabase::clear_keyring_for_test().await?;
        NookDatabase::clear_identity_directory_for_test().await?;
        NookDatabase::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
        let (app_key, wrapped, protected) = PinIdentityFixture {
            label: "Personal",
            pin: "first-secret",
            prior_app_key: None,
        }
        .create()
        .await?;
        let signing_public_key = protected
            .identity
            .members
            .iter()
            .find(|member| member.app_id == *app_key.app_id())
            .ok_or_else(|| NookError::Database("Protected identity member is missing".to_owned()))?
            .signing_public_key
            .clone();
        let mut keyring = NookDatabase::load_keyring().await?;
        keyring = keyring
            .replace(LocalIdentityKeyringEntry::legacy(
                protected.identity.identity_id.clone(),
                app_key.app_id().clone(),
                wrapped.clone(),
            ))
            .map_err(|error| NookError::Database(error.to_string()))?;
        let encoded = serde_json::to_string(&keyring)
            .map_err(|error| NookError::Database(error.to_string()))?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: LOCAL_IDENTITY_KEYRING_KEY,
            value: &encoded,
        })
        .await?;

        let result =
            NookDatabase::save_protected_local_identity(IdentityDbSaveProtectedLocalIdentity {
                app_key: &app_key,
                record: &wrapped,
                label: "Personal",
            })
            .await;

        assert!(
            matches!(result, Err(NookError::Database(message)) if message.contains("established signing seed"))
        );
        let retained = NookDatabase::load_keyring().await?;
        assert!(!retained.entries()[0].has_signing_seed());
        let directory = NookDatabase::load_identity_directory().await?;
        assert_eq!(
            directory.identities()[0].members[0].signing_public_key,
            signing_public_key
        );

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
    async fn seedless_pre_vault_legacy_identity_mints_its_first_signer() -> Result<(), NookError> {
        NookDatabase::clear_keyring_for_test().await?;
        NookDatabase::clear_identity_directory_for_test().await?;
        NookDatabase::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
        let app_key = AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let wrapped =
            DeviceIdentityProtection::new(&app_key.secret_string()).with_pin("first-secret")?;
        let protected = NookDatabase::save_new_protected_local_identity(
            IdentityDbSaveNewProtectedLocalIdentity {
                app_key: &app_key,
                record: &wrapped,
                prior_app_key: None,
                label: "Personal",
            },
        )
        .await?;
        let identity_id = protected.identity.identity_id.clone();
        NookDatabase::update_identity_directory({
            let identity_id = identity_id.clone();
            let app_id = app_key.app_id().clone();
            move |directory| {
                directory
                    .set_member_signing_public_key(DirectoryMemberSigningUpdate {
                        identity_id: &identity_id,
                        member: IdentityMemberSigningUpdate {
                            app_id: &app_id,
                            signing_public_key: &DeviceSigningPublicKey::Unavailable,
                        },
                    })
                    .map(IdentityDirectoryWrite::from)
                    .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))
            }
        })
        .await?;
        let mut keyring = NookDatabase::load_keyring().await?;
        keyring = keyring
            .replace(LocalIdentityKeyringEntry::legacy(
                identity_id,
                app_key.app_id().clone(),
                wrapped.clone(),
            ))
            .map_err(|error| NookError::Database(error.to_string()))?;
        let encoded = serde_json::to_string(&keyring)
            .map_err(|error| NookError::Database(error.to_string()))?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: LOCAL_IDENTITY_KEYRING_KEY,
            value: &encoded,
        })
        .await?;

        let promoted =
            NookDatabase::save_protected_local_identity(IdentityDbSaveProtectedLocalIdentity {
                app_key: &app_key,
                record: &wrapped,
                label: "Personal",
            })
            .await?;

        assert!(!promoted.signing_seed.is_empty());
        assert!(NookDatabase::load_keyring().await?.entries()[0].has_signing_seed());
        assert!(matches!(
            promoted.identity.members[0].signing_public_key,
            DeviceSigningPublicKey::Ed25519Hex(_)
        ));

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
    async fn final_identity_creation_transaction_rechecks_pending_genesis() -> Result<(), NookError>
    {
        NookDatabase::clear_keyring_for_test().await?;
        NookDatabase::clear_identity_directory_for_test().await?;
        let first_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &first_key,
            record: &first_wrapped,
            prior_app_key: None,
            label: "Personal",
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: simple_genesis::PENDING_SIMPLE_GENESIS_KEY,
            value: "pending",
        })
        .await?;
        let second_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;

        let result = NookDatabase::save_new_protected_local_identity(
            IdentityDbSaveNewProtectedLocalIdentity {
                app_key: &second_key,
                record: &second_wrapped,
                prior_app_key: Some(&first_key),
                label: "Work",
            },
        )
        .await;

        assert!(matches!(
            result,
            Err(NookError::Database(message)) if message.contains("Pending vault creation")
        ));
        assert_eq!(NookDatabase::load_keyring().await?.entries().len(), 1);
        NookDatabase::idb_delete_key(simple_genesis::PENDING_SIMPLE_GENESIS_KEY).await?;
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
    async fn pending_recovery_cleanup_blocks_identity_creation_and_activation()
    -> Result<(), NookError> {
        NookDatabase::clear_keyring_for_test().await?;
        NookDatabase::clear_identity_directory_for_test().await?;
        let (first_key, _, first) = PinIdentityFixture {
            label: "Personal",
            pin: "first-secret",
            prior_app_key: None,
        }
        .create()
        .await?;
        let (second_key, _, _) = PinIdentityFixture {
            label: "Work",
            pin: "second-secret",
            prior_app_key: Some(&first_key),
        }
        .create()
        .await?;
        let replacement_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let replacement_wrapped = DeviceIdentityProtection::new(&replacement_key.secret_string())
            .with_pin("replacement-secret")?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: recovery::PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY,
            value: "pending",
        })
        .await?;

        let create_result = NookDatabase::save_new_protected_local_identity(
            IdentityDbSaveNewProtectedLocalIdentity {
                app_key: &replacement_key,
                record: &replacement_wrapped,
                prior_app_key: Some(&second_key),
                label: "Replacement",
            },
        )
        .await;
        let activate_result = NookDatabase::select_local_identity(first.identity.identity_id).await;

        assert!(
            matches!(create_result, Err(NookError::Database(message)) if message.contains("recovery cleanup"))
        );
        assert!(
            matches!(activate_result, Err(NookError::Database(message)) if message.contains("recovery cleanup"))
        );
        assert_eq!(NookDatabase::load_keyring().await?.entries().len(), 2);

        NookDatabase::idb_delete_key(recovery::PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY).await?;
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
    async fn newer_legacy_wrapper_reconciles_without_losing_signing_seed() -> Result<(), NookError>
    {
        let _ = Rexie::delete("nook_db").await;
        let (app_key, _, protected) = PinIdentityFixture {
            label: "Personal",
            pin: "first-secret",
            prior_app_key: None,
        }
        .create()
        .await?;
        let replacement_wrapped =
            DeviceIdentityProtection::new(&app_key.secret_string()).with_pin("new-protection")?;
        NookDatabase::save_wrapped_device_identity(SaveWrappedDeviceIdentityRequest {
            device_id: app_key.app_id().as_str(),
            record: &replacement_wrapped,
        })
        .await?;

        let reconciled = NookDatabase::load_keyring().await?;
        let entry = reconciled
            .entries()
            .first()
            .ok_or_else(|| NookError::Database("Reconciled keyring entry is missing".to_owned()))?;

        assert_eq!(entry.wrapped_app_key(), &replacement_wrapped);
        assert_eq!(
            entry
                .open_signing_seed(&app_key)
                .map_err(|error| NookError::Database(error.to_string()))?,
            ProtectedSigningMaterial::Opened(SigningSeedHex::from_trusted(
                protected.signing_seed.as_str().to_owned()
            ))
        );
        assert!(
            NookDatabase::idb_get_string(indexed_db::APP_KEY_WRAPPED_KEY)
                .await?
                .is_none()
        );
        let _ = Rexie::delete("nook_db").await;
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
    async fn invalid_keyring_binding_preserves_legacy_protection() -> Result<(), NookError> {
        let _ = Rexie::delete("nook_db").await;
        let (app_key, wrapped, _) = PinIdentityFixture {
            label: "Personal",
            pin: "first-secret",
            prior_app_key: None,
        }
        .create()
        .await?;
        NookDatabase::save_wrapped_device_identity(SaveWrappedDeviceIdentityRequest {
            device_id: app_key.app_id().as_str(),
            record: &wrapped,
        })
        .await?;
        NookDatabase::idb_delete_key(identity_record::IDENTITY_DIRECTORY_KEY).await?;
        assert!(NookDatabase::load_keyring().await.is_err());
        assert!(
            NookDatabase::idb_get_string(indexed_db::APP_KEY_WRAPPED_KEY)
                .await?
                .is_some()
        );
        let _ = Rexie::delete("nook_db").await;
        Ok(())
    }
}
