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
use crate::NookError;
use crate::storage::identity_record::{self, PENDING_SIMPLE_GENESIS_KEY, recovery};
use crate::storage::{event_db, indexed_db};
use nook_core::{
    AppKey, IdentityDirectory, IdentityId, IdentitySelection, LocalIdentityKeyring,
    LocalIdentityKeyringEntry, WrappedDeviceIdentity,
};
use rexie::Store;

pub(super) struct IdentityTransitionAdmission<'a> {
    pub(super) store: &'a Store,
}
impl IdentityTransitionAdmission<'_> {
    pub(super) async fn check(self) -> Result<(), NookError> {
        let simple_pending = keyring::read_string(
            self.store,
            PENDING_SIMPLE_GENESIS_KEY,
            "Pending Simple genesis",
        )
        .await?;
        let sentinel_pending = keyring::read_string(
            self.store,
            indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY,
            "Pending Sentinel genesis",
        )
        .await?;
        let recovery_cleanup_pending = keyring::read_string(
            self.store,
            recovery::PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY,
            "Pending identity recovery cleanup",
        )
        .await?;
        if simple_pending.is_some()
            || sentinel_pending.is_some()
            || recovery_cleanup_pending.is_some()
        {
            return Err(NookError::Database(
                "Pending vault creation or recovery cleanup must finish before changing identities"
                    .to_owned(),
            ));
        }
        Ok(())
    }
}

pub(crate) struct ProtectedIdentityPublication<'a> {
    pub(crate) store: &'a Store,
    pub(crate) directory: &'a mut IdentityDirectory,
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
    directory: &'a mut IdentityDirectory,
    keyring: LocalIdentityKeyring,
    identity_id: IdentityId,
    signing: CheckedIdentitySigningMaterial,
}
impl<'a> ProtectedIdentityPublication<'a> {
    pub(crate) async fn save_existing(self) -> Result<ProtectedLocalIdentitySave, NookError> {
        IdentityTransitionAdmission { store: self.store }
            .check()
            .await?;
        let keyring = keyring::load_keyring_for_store(self.store, self.directory).await?;
        // Peer-only recovery can bootstrap an independent local identity.
        let allow_peer_only_bootstrap = keyring.entries().is_empty()
            && matches!(self.directory.selection(), IdentitySelection::Empty);
        let identity = identity_record::ensure_local_identity_in_directory(
            self.directory,
            self.app_key,
            self.label,
            allow_peer_only_bootstrap,
        )?;
        self.prepare(ProtectedIdentitySelection {
            keyring,
            identity_id: identity.identity_id,
            seed_origin: SigningSeedOrigin::MigrateLegacy,
        })
        .await?
        .persist()
        .await
    }
    pub(crate) async fn save_new(
        self,
        prior_app_key: Option<&AppKey>,
    ) -> Result<ProtectedLocalIdentitySave, NookError> {
        IdentityTransitionAdmission { store: self.store }
            .check()
            .await?;
        let mut keyring = keyring::load_keyring_for_store(self.store, self.directory).await?;
        LegacySignerProtection {
            store: self.store,
            directory: self.directory,
            keyring: &mut keyring,
        }
        .protect(prior_app_key)
        .await?;
        let identity_id = self
            .directory
            .create_identity(self.label, self.app_key, None)
            .map_err(identity_record::map_domain_error)?;
        self.prepare(ProtectedIdentitySelection {
            keyring,
            identity_id,
            seed_origin: SigningSeedOrigin::NewIdentity,
        })
        .await?
        .persist()
        .await
    }
    async fn prepare(
        self,
        selection: ProtectedIdentitySelection,
    ) -> Result<PreparedProtectedIdentity<'a>, NookError> {
        let ProtectedIdentitySelection {
            mut keyring,
            identity_id,
            seed_origin,
        } = selection;
        let existing = keyring.entry(&identity_id);
        let evidence = IdentitySigningEvidence {
            directory: self.directory,
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
            keyring
                .replace(entry)
                .map_err(|error| NookError::Database(error.to_string()))?;
        } else {
            keyring
                .insert(entry)
                .map_err(|error| NookError::Database(error.to_string()))?;
        }
        self.directory
            .set_member_signing_public_key(
                &identity_id,
                self.app_key.app_id(),
                signing.public_key(),
            )
            .map_err(identity_record::map_domain_error)?;
        keyring::validate_keyring_directory_binding(&keyring, self.directory)?;
        Ok(PreparedProtectedIdentity {
            store: self.store,
            directory: self.directory,
            keyring,
            identity_id,
            signing,
        })
    }
}
impl PreparedProtectedIdentity<'_> {
    async fn persist(self) -> Result<ProtectedLocalIdentitySave, NookError> {
        keyring::write_keyring(self.store, &self.keyring).await?;
        identity_record::write_identity_directory(self.store, self.directory).await?;
        legacy::delete_legacy_active_key(self.store).await?;
        keyring::delete_key(
            self.store,
            event_db::SIGNING_SEED_KEY,
            "Legacy signing seed",
        )
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
    use crate::storage::identity_record;
    use crate::storage::identity_record::{recovery, simple_genesis};
    use crate::storage::{event_db, indexed_db};
    use nook_core::{AppKey, DeviceSigningPublicKey, LocalIdentityKeyringEntry, SigningIdentity};
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
            let app_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
            let wrapped =
                DeviceIdentityProtection::new(&app_key.secret_string()).with_pin(self.pin)?;
            let saved = identity_record::save_new_protected_local_identity(
                &app_key,
                &wrapped,
                self.prior_app_key,
                self.label,
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
    async fn later_marker_read_failure_precedes_pending_rejection() -> Result<(), NookError> {
        indexed_db::idb_put_string(simple_genesis::PENDING_SIMPLE_GENESIS_KEY, "pending").await?;
        let db = storage::open_nook_database().await?;
        let transaction = db
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| {
                NookError::IndexedDb(format!("Marker test transaction error: {error:?}"))
            })?;
        let store = transaction
            .store("vault")
            .map_err(|error| NookError::IndexedDb(format!("Marker test store error: {error:?}")))?;
        let key =
            serde_wasm_bindgen::to_value(indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY)
                .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        let malformed = serde_wasm_bindgen::to_value(&Vec::<String>::new())
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        store
            .put(&malformed, Some(&key))
            .await
            .map_err(|error| NookError::IndexedDb(format!("Marker test write error: {error:?}")))?;
        let result = IdentityTransitionAdmission { store: &store }.check().await;
        assert!(
            matches!(result, Err(NookError::IndexedDb(message)) if message.starts_with("Pending Sentinel genesis value error:"))
        );
        assert_eq!(
            keyring::read_string(
                &store,
                simple_genesis::PENDING_SIMPLE_GENESIS_KEY,
                "Test pending"
            )
            .await?
            .as_deref(),
            Some("pending")
        );
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Marker test completion error: {error:?}"))
        })?;
        indexed_db::idb_delete_key(simple_genesis::PENDING_SIMPLE_GENESIS_KEY).await?;
        indexed_db::idb_delete_key(indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY).await
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
        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let (app_key, wrapped, saved) = PinIdentityFixture {
            label: "Personal",
            pin: "original-pin",
            prior_app_key: None,
        }
        .create()
        .await?;
        let original_keyring = indexed_db::idb_get_string(LOCAL_IDENTITY_KEYRING_KEY).await?;
        let original_directory =
            indexed_db::idb_get_string(identity_record::IDENTITY_DIRECTORY_KEY).await?;
        indexed_db::idb_put_string(event_db::SIGNING_SEED_KEY, &saved.signing_seed).await?;
        let db = storage::open_nook_database().await?;
        let transaction = db
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| {
                NookError::IndexedDb(format!("Prepared test transaction error: {error:?}"))
            })?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Prepared test store error: {error:?}"))
        })?;
        let mut directory = identity_record::load_directory_for_write(&store).await?;
        let keyring = keyring::load_keyring_for_store(&store, &directory).await?;
        {
            let _prepared = ProtectedIdentityPublication {
                store: &store,
                directory: &mut directory,
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
            keyring::read_string(&store, LOCAL_IDENTITY_KEYRING_KEY, "Test keyring").await?,
            original_keyring
        );
        assert_eq!(
            keyring::read_string(
                &store,
                identity_record::IDENTITY_DIRECTORY_KEY,
                "Test directory"
            )
            .await?,
            original_directory
        );
        assert_eq!(
            keyring::read_string(&store, event_db::SIGNING_SEED_KEY, "Test seed")
                .await?
                .as_deref(),
            Some(saved.signing_seed.as_str())
        );
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Prepared test completion error: {error:?}"))
        })?;
        indexed_db::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
    }

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
        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let first_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let second_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;

        let first = identity_record::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        let second = identity_record::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            None,
            "Work",
        )
        .await?;

        assert_ne!(first.identity.identity_id, second.identity.identity_id);
        assert_ne!(first_key.app_id(), second_key.app_id());
        let keyring = keyring::load_keyring().await?;
        assert_eq!(keyring.entries().len(), 2);
        let first_signing_public_key = keyring
            .entry(&first.identity.identity_id)
            .ok_or_else(|| NookError::Database("First keyring entry is missing".to_owned()))?
            .signing_public_key(&first_key)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let second_signing_public_key = keyring
            .entry(&second.identity.identity_id)
            .ok_or_else(|| NookError::Database("Second keyring entry is missing".to_owned()))?
            .signing_public_key(&second_key)
            .map_err(|error| NookError::Database(error.to_string()))?;
        assert_ne!(first_signing_public_key, second_signing_public_key);
        keyring::select_local_identity(first.identity.identity_id.clone()).await?;
        let selected = keyring::load_selected_entry()
            .await?
            .ok_or_else(|| NookError::Database("Selected keyring entry is missing".to_owned()))?;
        assert_eq!(selected.app_id(), first_key.app_id());
        assert_eq!(
            selected
                .signing_public_key(&first_key)
                .map_err(|error| NookError::Database(error.to_string()))?,
            SigningIdentity::from_seed_hex_stored(&first.signing_seed)
                .map_err(|error| NookError::Database(error.to_string()))?
                .public_key()
        );

        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
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
        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let first_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let first = identity_record::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        let mut legacy_keyring = keyring::load_keyring().await?;
        legacy_keyring
            .replace(LocalIdentityKeyringEntry::legacy(
                first.identity.identity_id.clone(),
                first_key.app_id().clone(),
                first_wrapped,
            ))
            .map_err(|error| NookError::Database(error.to_string()))?;
        let encoded = serde_json::to_string(&legacy_keyring)
            .map_err(|error| NookError::Database(error.to_string()))?;
        indexed_db::idb_put_string(LOCAL_IDENTITY_KEYRING_KEY, &encoded).await?;
        let legacy_seed = first.signing_seed.clone();
        indexed_db::idb_put_string(event_db::SIGNING_SEED_KEY, &legacy_seed).await?;

        let second_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        assert!(
            identity_record::save_new_protected_local_identity(
                &second_key,
                &second_wrapped,
                None,
                "Work",
            )
            .await
            .is_err()
        );
        assert_eq!(
            indexed_db::idb_get_string(event_db::SIGNING_SEED_KEY,).await?,
            Some(legacy_seed.clone())
        );
        assert_eq!(keyring::load_keyring().await?.entries().len(), 1);

        identity_record::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            Some(&first_key),
            "Work",
        )
        .await?;
        let migrated = keyring::load_keyring().await?;
        assert_eq!(migrated.entries().len(), 2);
        assert_eq!(
            migrated
                .entry(&first.identity.identity_id)
                .ok_or_else(|| {
                    NookError::Database("Migrated legacy keyring entry is missing".to_owned())
                })?
                .open_signing_seed(&first_key)
                .map_err(|error| NookError::Database(error.to_string()))?,
            Some(legacy_seed)
        );
        assert!(
            indexed_db::idb_get_string(event_db::SIGNING_SEED_KEY,)
                .await?
                .is_none()
        );

        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
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
        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let (first_key, first_wrapped, first) = PinIdentityFixture {
            label: "Personal",
            pin: "first-secret",
            prior_app_key: None,
        }
        .create()
        .await?;
        let mut legacy_keyring = keyring::load_keyring().await?;
        legacy_keyring
            .replace(LocalIdentityKeyringEntry::legacy(
                first.identity.identity_id.clone(),
                first_key.app_id().clone(),
                first_wrapped,
            ))
            .map_err(|error| NookError::Database(error.to_string()))?;
        indexed_db::idb_put_string(
            LOCAL_IDENTITY_KEYRING_KEY,
            &serde_json::to_string(&legacy_keyring)
                .map_err(|error| NookError::Database(error.to_string()))?,
        )
        .await?;
        indexed_db::idb_put_string(event_db::SIGNING_SEED_KEY, &"22".repeat(32)).await?;
        let second_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;

        let result = identity_record::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            Some(&first_key),
            "Work",
        )
        .await;

        assert!(
            matches!(result, Err(NookError::Database(message)) if message.contains("established signing public key"))
        );
        assert_eq!(keyring::load_keyring().await?.entries().len(), 1);
        let directory = identity_record::load_identity_directory().await?;
        assert_eq!(directory.identities().len(), 1);
        assert_eq!(directory.identities()[0], first.identity);

        indexed_db::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
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
        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let (app_key, wrapped, protected) = PinIdentityFixture {
            label: "Personal",
            pin: "first-secret",
            prior_app_key: None,
        }
        .create()
        .await?;
        let mut keyring = keyring::load_keyring().await?;
        keyring
            .replace(LocalIdentityKeyringEntry::legacy(
                protected.identity.identity_id.clone(),
                app_key.app_id().clone(),
                wrapped,
            ))
            .map_err(|error| NookError::Database(error.to_string()))?;
        indexed_db::idb_put_string(
            LOCAL_IDENTITY_KEYRING_KEY,
            &serde_json::to_string(&keyring)
                .map_err(|error| NookError::Database(error.to_string()))?,
        )
        .await?;
        indexed_db::idb_put_string(event_db::SIGNING_SEED_KEY, &protected.signing_seed).await?;

        let signing_seed = LocalIdentitySigner { app_key: &app_key }
            .load_or_create()
            .await?;

        assert_eq!(signing_seed, protected.signing_seed);
        assert!(keyring::load_keyring().await?.entries()[0].has_signing_seed());
        assert!(
            indexed_db::idb_get_string(event_db::SIGNING_SEED_KEY)
                .await?
                .is_none()
        );
        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
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
        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        indexed_db::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
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
        let mut keyring = keyring::load_keyring().await?;
        keyring
            .replace(LocalIdentityKeyringEntry::legacy(
                protected.identity.identity_id.clone(),
                app_key.app_id().clone(),
                wrapped.clone(),
            ))
            .map_err(|error| NookError::Database(error.to_string()))?;
        let encoded = serde_json::to_string(&keyring)
            .map_err(|error| NookError::Database(error.to_string()))?;
        indexed_db::idb_put_string(LOCAL_IDENTITY_KEYRING_KEY, &encoded).await?;

        let result =
            identity_record::save_protected_local_identity(&app_key, &wrapped, "Personal").await;

        assert!(
            matches!(result, Err(NookError::Database(message)) if message.contains("established signing seed"))
        );
        let retained = keyring::load_keyring().await?;
        assert!(!retained.entries()[0].has_signing_seed());
        let directory = identity_record::load_identity_directory().await?;
        assert_eq!(
            directory.identities()[0].members[0].signing_public_key,
            signing_public_key
        );

        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
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
        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        indexed_db::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
        let app_key = AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let wrapped =
            DeviceIdentityProtection::new(&app_key.secret_string()).with_pin("first-secret")?;
        let protected = identity_record::save_new_protected_local_identity(
            &app_key, &wrapped, None, "Personal",
        )
        .await?;
        let identity_id = protected.identity.identity_id.clone();
        identity_record::update_identity_directory({
            let identity_id = identity_id.clone();
            let app_id = app_key.app_id().clone();
            move |directory| {
                directory
                    .set_member_signing_public_key(
                        &identity_id,
                        &app_id,
                        &DeviceSigningPublicKey::Unavailable,
                    )
                    .map_err(identity_record::map_domain_error)
            }
        })
        .await?;
        let mut keyring = keyring::load_keyring().await?;
        keyring
            .replace(LocalIdentityKeyringEntry::legacy(
                identity_id,
                app_key.app_id().clone(),
                wrapped.clone(),
            ))
            .map_err(|error| NookError::Database(error.to_string()))?;
        let encoded = serde_json::to_string(&keyring)
            .map_err(|error| NookError::Database(error.to_string()))?;
        indexed_db::idb_put_string(LOCAL_IDENTITY_KEYRING_KEY, &encoded).await?;

        let promoted =
            identity_record::save_protected_local_identity(&app_key, &wrapped, "Personal").await?;

        assert!(!promoted.signing_seed.is_empty());
        assert!(keyring::load_keyring().await?.entries()[0].has_signing_seed());
        assert!(matches!(
            promoted.identity.members[0].signing_public_key,
            DeviceSigningPublicKey::Ed25519Hex(_)
        ));

        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
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
        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let first_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        identity_record::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        indexed_db::idb_put_string(simple_genesis::PENDING_SIMPLE_GENESIS_KEY, "pending").await?;
        let second_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;

        let result = identity_record::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            Some(&first_key),
            "Work",
        )
        .await;

        assert!(matches!(
            result,
            Err(NookError::Database(message)) if message.contains("Pending vault creation")
        ));
        assert_eq!(keyring::load_keyring().await?.entries().len(), 1);
        indexed_db::idb_delete_key(simple_genesis::PENDING_SIMPLE_GENESIS_KEY).await?;
        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
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
        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
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
        indexed_db::idb_put_string(
            recovery::PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY,
            "pending",
        )
        .await?;

        let create_result = identity_record::save_new_protected_local_identity(
            &replacement_key,
            &replacement_wrapped,
            Some(&second_key),
            "Replacement",
        )
        .await;
        let activate_result = keyring::select_local_identity(first.identity.identity_id).await;

        assert!(
            matches!(create_result, Err(NookError::Database(message)) if message.contains("recovery cleanup"))
        );
        assert!(
            matches!(activate_result, Err(NookError::Database(message)) if message.contains("recovery cleanup"))
        );
        assert_eq!(keyring::load_keyring().await?.entries().len(), 2);

        indexed_db::idb_delete_key(recovery::PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY).await?;
        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
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
        indexed_db::save_wrapped_device_identity(app_key.app_id().as_str(), &replacement_wrapped)
            .await?;

        let reconciled = keyring::load_keyring().await?;
        let entry = reconciled
            .entries()
            .first()
            .ok_or_else(|| NookError::Database("Reconciled keyring entry is missing".to_owned()))?;

        assert_eq!(entry.wrapped_app_key(), &replacement_wrapped);
        assert_eq!(
            entry
                .open_signing_seed(&app_key)
                .map_err(|error| NookError::Database(error.to_string()))?
                .as_deref(),
            Some(protected.signing_seed.as_str())
        );
        assert!(
            indexed_db::idb_get_string(indexed_db::APP_KEY_WRAPPED_KEY)
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
        indexed_db::save_wrapped_device_identity(app_key.app_id().as_str(), &wrapped).await?;
        indexed_db::idb_delete_key(identity_record::IDENTITY_DIRECTORY_KEY).await?;
        assert!(keyring::load_keyring().await.is_err());
        assert!(
            indexed_db::idb_get_string(indexed_db::APP_KEY_WRAPPED_KEY)
                .await?
                .is_some()
        );
        let _ = Rexie::delete("nook_db").await;
        Ok(())
    }
}
