#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Protection admission and ordered publication inside the caller's identity transaction.
#[cfg(test)]
use super as keyring;
use super::ProtectedLocalIdentitySave;
use super::signing::{
    CheckedIdentitySigningMaterial, IdentitySigningEvidence, IdentitySigningSource, MemberSigner,
    SigningSeedOrigin,
};
#[cfg(test)]
use crate::IdbPutStringRequest;
use crate::IdentityDbEnsureLocalIdentityInDirectory;
#[cfg(test)]
use crate::IdentityDbSaveNewProtectedLocalIdentity;
use crate::IdentityDbWriteIdentityDirectory;
use crate::KeyringDbKeyringDeleteKey;
use crate::KeyringDbKeyringReadString;
use crate::KeyringDbLoadKeyringForStore;
use crate::KeyringDbValidateKeyringDirectoryBinding;
use crate::KeyringDbWriteKeyring;
use crate::storage::identity_record::{PENDING_SIMPLE_GENESIS_KEY, recovery};
#[cfg(test)]
use crate::storage::indexed_db::StoredStringRecord;
use crate::storage::{event_db, indexed_db};
use crate::{NookDatabase, NookError};
use nook_core::MemberLabelState;
use nook_core::{
    AppKey, IdentityDirectory, IdentityId, IdentitySelection, LocalIdentityKeyring,
    LocalIdentityKeyringEntry, SigningSeedHex, WrappedDeviceIdentity,
};
use nook_core::{DirectoryMemberSigningUpdate, IdentityCreation, IdentityMemberSigningUpdate};
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
struct ProtectedIdentitySelection<'s> {
    keyring: LocalIdentityKeyring,
    identity_id: IdentityId,
    seed_origin: SigningSeedOrigin<'s>,
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
    pub(crate) async fn save_existing(
        mut self,
        signer: MemberSigner<'_>,
    ) -> Result<ProtectedLocalIdentitySave, NookError> {
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
                allow_peer_only_bootstrap,
            },
        )?;
        self.directory = ensured.directory;
        self.prepare(ProtectedIdentitySelection {
            keyring,
            identity_id: ensured.value.identity_id,
            seed_origin: match signer {
                MemberSigner::Installation => SigningSeedOrigin::AdoptSessionSigner,
                MemberSigner::Passkey(seed) => SigningSeedOrigin::Passkey(seed),
            },
        })
        .await?
        .persist()
        .await
    }
    pub(crate) async fn save_new(
        mut self,
        signer: MemberSigner<'_>,
    ) -> Result<ProtectedLocalIdentitySave, NookError> {
        IdentityTransitionAdmission { store: self.store }
            .check()
            .await?;
        let keyring = NookDatabase::load_keyring_for_store(KeyringDbLoadKeyringForStore {
            store: self.store,
            directory: &self.directory,
        })
        .await?;
        let created = self
            .directory
            .create_identity(IdentityCreation {
                label: self.label,
                app_key: self.app_key,
                member_label: MemberLabelState::Unnamed,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        self.directory = created.directory;
        self.prepare(ProtectedIdentitySelection {
            keyring,
            identity_id: created.identity_id,
            seed_origin: match signer {
                MemberSigner::Installation => SigningSeedOrigin::NewIdentity,
                MemberSigner::Passkey(seed) => SigningSeedOrigin::Passkey(seed),
            },
        })
        .await?
        .persist()
        .await
    }
    /// Protect the passkey's app key under an identity this directory just
    /// gained from a provider, with the signer the identity's log lists.
    pub(crate) async fn save_added(
        self,
        identity_id: IdentityId,
        signer: &SigningSeedHex,
    ) -> Result<ProtectedLocalIdentitySave, NookError> {
        IdentityTransitionAdmission { store: self.store }
            .check()
            .await?;
        let keyring = NookDatabase::load_keyring_for_store(KeyringDbLoadKeyringForStore {
            store: self.store,
            directory: &self.directory,
        })
        .await?;
        self.prepare(ProtectedIdentitySelection {
            keyring,
            identity_id,
            seed_origin: SigningSeedOrigin::Passkey(signer),
        })
        .await?
        .persist()
        .await
    }
    async fn prepare(
        mut self,
        selection: ProtectedIdentitySelection<'_>,
    ) -> Result<PreparedProtectedIdentity<'a>, NookError> {
        let ProtectedIdentitySelection {
            mut keyring,
            identity_id,
            seed_origin,
        } = selection;
        let existing = keyring.entry(&identity_id);
        let replaces_existing =
            matches!(&existing, nook_core::LocalIdentityProtection::Protected(_));
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
        if replaces_existing {
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

    use super::*;
    use crate::storage::event_db;
    use crate::storage::identity_record;
    use crate::storage::identity_record::{recovery, simple_genesis};

    use nook_core::AppKey;

    use rexie::TransactionMode;

    use super::{
        ProtectedIdentityPublication, ProtectedIdentitySelection, ProtectedLocalIdentitySave,
        SigningSeedOrigin, keyring,
    };
    use crate::NookError;

    use keyring::LOCAL_IDENTITY_KEYRING_KEY;

    use nook_core::DeviceIdentityProtection;
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);

    struct PinIdentityFixture<'a> {
        label: &'a str,
        pin: &'a str,
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
        let directory = NookDatabase::load_directory_for_write(&store).await?;
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
                seed_origin: SigningSeedOrigin::AdoptSessionSigner,
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
            .await?,
            StoredStringRecord::Stored((saved.signing_seed.as_str()).to_owned())
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
        let (_first_key, _, first) = PinIdentityFixture {
            label: "Personal",
            pin: "first-secret",
        }
        .create()
        .await?;
        let (_second_key, _, _) = PinIdentityFixture {
            label: "Work",
            pin: "second-secret",
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
}
