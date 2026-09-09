//! Local identity-directory persistence, independent of vault `store_id`.

use crate::storage::indexed_db;
use crate::{IdbPutStringRequest, NookDatabase, NookError};
use nook_core::{AppId, IdentityDirectory, IdentitySelection, MultiDeviceError};
use nook_core::{
    DirectoryMemberSigningUpdate, DirectoryOwnedVaultOpening, IdentityCreation,
    IdentityMemberSigningUpdate, IdentityVaultKeyOpening,
};
use rexie::TransactionMode;
mod directory_migration;
mod genesis_cleanup;
mod genesis_flow;
mod handoff;
mod keyring;
mod reconciliation;
mod recovery;
pub(crate) mod simple_genesis;
mod staged_genesis;
pub(crate) use genesis_flow::SimpleGenesisCompletion;
pub(crate) use handoff::{ExistingVaultImportCommit, IdentityHandoffCommit};
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
pub(crate) use keyring::LOCAL_IDENTITY_KEYRING_KEY;
pub(crate) use keyring::{LocalIdentitySigner, ProtectedLocalIdentitySave};

pub(crate) struct LocalIdentityProjection {
    pub(crate) directory: IdentityDirectory,
    pub(crate) keyring: nook_core::LocalIdentityKeyring,
    pub(crate) protected: Option<(String, nook_core::WrappedDeviceIdentity)>,
}

/// Named values required by NookDatabase::local_keyring_entry_for_app_id_from_store.
pub(crate) struct IdentityDbLocalKeyringEntryForAppIdFromStore<'a> {
    pub(crate) store: &'a rexie::Store,
    pub(crate) app_id: &'a AppId,
}

/// Named values required by NookDatabase::persist_pending_genesis.
pub(crate) struct IdentityDbPersistPendingGenesis<'a> {
    pub(crate) store: &'a rexie::Store,
    pub(crate) pending: &'a PendingSimpleGenesis,
}

/// Named values required by NookDatabase::migrate_directory_in_store.
pub(crate) struct IdentityDbMigrateDirectoryInStore<'a> {
    pub(crate) store: &'a rexie::Store,
    pub(crate) directory: IdentityDirectory,
}

/// Named values required by NookDatabase::migrate_directory.
pub(crate) struct IdentityDbMigrateDirectory<'a> {
    pub(crate) directory: IdentityDirectory,
    pub(crate) preserved_identity_id: Option<&'a nook_core::IdentityId>,
}

/// Named values required by NookDatabase::write_identity_directory.
pub(crate) struct IdentityDbWriteIdentityDirectory<'a> {
    pub(crate) store: &'a rexie::Store,
    pub(crate) directory: &'a IdentityDirectory,
}

/// Named values required by NookDatabase::save_protected_local_identity.
pub(crate) struct IdentityDbSaveProtectedLocalIdentity<'a> {
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) record: &'a nook_core::WrappedDeviceIdentity,
    pub(crate) label: &'a str,
}

/// Named values required by NookDatabase::save_new_protected_local_identity.
pub(crate) struct IdentityDbSaveNewProtectedLocalIdentity<'a> {
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) record: &'a nook_core::WrappedDeviceIdentity,
    pub(crate) prior_app_key: Option<&'a nook_core::AppKey>,
    pub(crate) label: &'a str,
}

/// Named values required by NookDatabase::set_identity_member_signing_public_key.
pub(crate) struct IdentityDbSetIdentityMemberSigningPublicKey<'a> {
    pub(crate) identity_id: &'a nook_core::IdentityId,
    pub(crate) app_id: &'a AppId,
    pub(crate) signing_public_key: &'a nook_core::DeviceSigningPublicKey,
}

/// Named values required by NookDatabase::ensure_local_identity_for_app_key.
pub(crate) struct IdentityDbEnsureLocalIdentityForAppKey<'a> {
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) label: &'a str,
}

/// Named values required by NookDatabase::ensure_local_identity_in_directory.
pub(crate) struct IdentityDbEnsureLocalIdentityInDirectory<'a> {
    pub(crate) directory: IdentityDirectory,
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) label: &'a str,
    pub(crate) allow_peer_only_bootstrap: bool,
}

mod directory_write;
pub(crate) use directory_write::IdentityDirectoryWrite;

/// Named values required by NookDatabase::generate_vault_dek_for_identity.
pub(crate) struct IdentityDbGenerateVaultDekForIdentity<'a> {
    pub(crate) identity_id: &'a nook_core::IdentityId,
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) store_id: nook_core::StoreId,
}

/// Named values required by NookDatabase::validate_vault_identity_enrollment.
pub(crate) struct IdentityDbValidateVaultIdentityEnrollment<'a> {
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) store_id: &'a nook_core::StoreId,
}

impl NookDatabase {
    pub(crate) async fn load_local_identity_projection(
        session_app_id: &str,
    ) -> Result<LocalIdentityProjection, NookError> {
        let requested_app_id = if session_app_id.is_empty() {
            None
        } else {
            Some(
                AppId::parse(session_app_id)
                    .map_err(|error| NookError::Database(error.to_string()))?,
            )
        };
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| {
                NookError::IndexedDb(format!("Identity projection transaction error: {error:?}"))
            })?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Identity projection store error: {error:?}"))
        })?;
        let directory = NookDatabase::load_directory_for_write(&store).await?;
        let keyring = NookDatabase::load_keyring_for_store(KeyringDbLoadKeyringForStore {
            store: &store,
            directory: &directory,
        })
        .await?;
        let entry = match requested_app_id.as_ref() {
            Some(app_id) => keyring
                .entries()
                .iter()
                .find(|entry| entry.app_id() == app_id),
            None => match directory.selection() {
                IdentitySelection::Empty => None,
                IdentitySelection::Selected(identity_id) => keyring.entry(identity_id),
            },
        };
        let protected = match entry {
            Some(entry) => Some((
                entry.app_id().as_str().to_owned(),
                entry.wrapped_app_key().clone(),
            )),
            None => NookDatabase::load_legacy_wrapped_device_identity_from_store(&store)
                .await?
                .filter(|(app_id, _)| {
                    requested_app_id
                        .as_ref()
                        .is_none_or(|requested| requested.as_str() == app_id)
                }),
        };
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Identity projection completion error: {error:?}"))
        })?;
        Ok(LocalIdentityProjection {
            directory,
            keyring,
            protected,
        })
    }
}

impl NookDatabase {
    pub(super) async fn selected_local_keyring_entry_for_store(
        store: &rexie::Store,
    ) -> Result<Option<nook_core::LocalIdentityKeyringEntry>, NookError> {
        NookDatabase::selected_entry_from_store(store).await
    }
}
impl NookDatabase {
    pub(super) async fn local_keyring_entry_for_app_id_from_store(
        request: IdentityDbLocalKeyringEntryForAppIdFromStore<'_>,
    ) -> Result<Option<nook_core::LocalIdentityKeyringEntry>, NookError> {
        let IdentityDbLocalKeyringEntryForAppIdFromStore { store, app_id } = request;
        NookDatabase::entry_for_app_id_from_store(KeyringDbEntryForAppIdFromStore {
            store: store,
            app_id: app_id,
        })
        .await
    }
}
pub(crate) use reconciliation::{
    IdentityReconciliationStore, PendingIdentityRotation, ReconciliationIntent,
};
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
pub(crate) use recovery::PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY;
pub(crate) use recovery::{LocalIdentityRecovery, LocalIdentityRecoveryRequest};
pub(crate) use simple_genesis::PENDING_SIMPLE_GENESIS_KEY;
pub(crate) use simple_genesis::{
    OrdinarySimpleGenesisRequest, PendingSimpleGenesis, SimpleGenesisEventInput,
};
pub(crate) use staged_genesis::StagedSimpleGenesisInput;

pub(super) const IDENTITY_DIRECTORY_KEY: &str = "identity_directory_v1";
pub(super) const LEGACY_IDENTITY_RECORD_KEY: &str = "identity_record_v1";
const RETIRED_APP_IDS_KEY: &str = "retired_app_ids_v1";

impl NookDatabase {
    fn map_domain_error(error: MultiDeviceError) -> NookError {
        let message = error.to_string();
        drop(error);
        NookError::Database(message)
    }
}

impl NookDatabase {
    pub(crate) async fn load_identity_directory() -> Result<IdentityDirectory, NookError> {
        let raw = NookDatabase::load_or_migrate_identity_directory_raw().await?;
        raw.map_or_else(
            || Ok(IdentityDirectory::empty()),
            |raw| NookDatabase::decode_directory(&raw),
        )
    }
}

impl NookDatabase {
    fn decode_directory(raw: &str) -> Result<IdentityDirectory, NookError> {
        NookDatabase::migrate_directory(IdentityDbMigrateDirectory {
            directory: NookDatabase::decode_directory_value(raw)?,
            preserved_identity_id: None,
        })
        .map(|(directory, _)| directory)
    }
}

impl NookDatabase {
    fn decode_directory_value(raw: &str) -> Result<IdentityDirectory, NookError> {
        serde_json::from_str(raw).map_err(|error| {
            NookError::IndexedDb(format!("Identity directory decode error: {error}"))
        })
    }
}

impl NookDatabase {
    fn migrate_directory(
        request: IdentityDbMigrateDirectory<'_>,
    ) -> Result<(IdentityDirectory, bool), NookError> {
        let IdentityDbMigrateDirectory {
            directory,
            preserved_identity_id,
        } = request;
        match preserved_identity_id {
            Some(identity_id) => {
                directory.migrate_legacy_duplicate_app_key_ownership_preserving(identity_id)
            }
            None => directory.migrate_legacy_duplicate_app_key_ownership(),
        }
        .map_err(|error| NookError::Database(error.to_string()))
    }
}

impl NookDatabase {
    async fn load_directory_for_write(
        store: &rexie::Store,
    ) -> Result<IdentityDirectory, NookError> {
        let current_id = serde_wasm_bindgen::to_value(IDENTITY_DIRECTORY_KEY).map_err(|error| {
            NookError::IndexedDb(format!("Identity update key error: {error:?}"))
        })?;
        let current = store.get(current_id).await.map_err(|error| {
            NookError::IndexedDb(format!("Identity update read error: {error:?}"))
        })?;
        let directory = if let Some(value) =
            current.filter(|value| !value.is_undefined() && !value.is_null())
        {
            let raw: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
                NookError::IndexedDb(format!("Identity update value error: {error:?}"))
            })?;
            NookDatabase::decode_directory_value(&raw)?
        } else {
            let legacy_id =
                serde_wasm_bindgen::to_value(LEGACY_IDENTITY_RECORD_KEY).map_err(|error| {
                    NookError::IndexedDb(format!("Legacy update key error: {error:?}"))
                })?;
            let legacy = store.get(legacy_id).await.map_err(|error| {
                NookError::IndexedDb(format!("Legacy identity update read error: {error:?}"))
            })?;
            legacy
                .filter(|value| !value.is_undefined() && !value.is_null())
                .map(serde_wasm_bindgen::from_value::<String>)
                .transpose()
                .map_err(|error| {
                    NookError::IndexedDb(format!("Legacy update value error: {error:?}"))
                })?
                .map(|raw| {
                    serde_json::from_str(&raw)
                        .map_err(|error| {
                            NookError::IndexedDb(format!("Legacy update decode error: {error}"))
                        })
                        .and_then(|record| {
                            IdentityDirectory::from_legacy_record(record)
                                .map_err(NookDatabase::map_domain_error)
                        })
                })
                .transpose()?
                .unwrap_or_else(IdentityDirectory::empty)
        };
        NookDatabase::migrate_directory_in_store(IdentityDbMigrateDirectoryInStore {
            store: store,
            directory: directory,
        })
        .await
        .map(|(directory, _)| directory)
    }
}

impl NookDatabase {
    async fn load_retired_app_ids(store: &rexie::Store) -> Result<Vec<AppId>, NookError> {
        let key = serde_wasm_bindgen::to_value(RETIRED_APP_IDS_KEY).map_err(|error| {
            NookError::IndexedDb(format!("Retired app IDs key error: {error:?}"))
        })?;
        let Some(value) = store
            .get(key)
            .await
            .map_err(|error| {
                NookError::IndexedDb(format!("Retired app IDs read error: {error:?}"))
            })?
            .filter(|value| !value.is_undefined() && !value.is_null())
        else {
            return Ok(Vec::new());
        };
        let raw: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
            NookError::IndexedDb(format!("Retired app IDs value error: {error:?}"))
        })?;
        serde_json::from_str(&raw)
            .map_err(|error| NookError::IndexedDb(format!("Retired app IDs decode error: {error}")))
    }
}

impl NookDatabase {
    async fn write_identity_directory(
        request: IdentityDbWriteIdentityDirectory<'_>,
    ) -> Result<(), NookError> {
        let IdentityDbWriteIdentityDirectory { store, directory } = request;
        directory
            .validate()
            .map_err(NookDatabase::map_domain_error)?;
        let current_id = serde_wasm_bindgen::to_value(IDENTITY_DIRECTORY_KEY).map_err(|error| {
            NookError::IndexedDb(format!("Identity update key error: {error:?}"))
        })?;
        let legacy_id = serde_wasm_bindgen::to_value(LEGACY_IDENTITY_RECORD_KEY)
            .map_err(|error| NookError::IndexedDb(format!("Legacy update key error: {error:?}")))?;
        let encoded = serde_json::to_string(directory).map_err(|error| {
            NookError::IndexedDb(format!("Identity directory encode error: {error}"))
        })?;
        let encoded = serde_wasm_bindgen::to_value(&encoded).map_err(|error| {
            NookError::IndexedDb(format!("Identity update value error: {error:?}"))
        })?;
        store
            .put(&encoded, Some(&current_id))
            .await
            .map_err(|error| {
                NookError::IndexedDb(format!("Identity directory write error: {error:?}"))
            })?;
        store.delete(legacy_id).await.map_err(|error| {
            NookError::IndexedDb(format!("Legacy identity delete error: {error:?}"))
        })?;
        Ok(())
    }
}

impl NookDatabase {
    pub(crate) async fn update_identity_directory<F, T>(update: F) -> Result<T, NookError>
    where
        F: FnOnce(IdentityDirectory) -> Result<IdentityDirectoryWrite<T>, NookError>,
    {
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| NookError::IndexedDb(format!("Identity update error: {error:?}")))?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Identity update store error: {error:?}"))
        })?;
        let directory = NookDatabase::load_directory_for_write(&store).await?;
        let IdentityDirectoryWrite { directory, value } = update(directory)?;
        NookDatabase::write_identity_directory(IdentityDbWriteIdentityDirectory {
            store: &store,
            directory: &directory,
        })
        .await?;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Identity update completion error: {error:?}"))
        })?;
        Ok(value)
    }
}

impl NookDatabase {
    pub(crate) async fn save_protected_local_identity(
        request: IdentityDbSaveProtectedLocalIdentity<'_>,
    ) -> Result<ProtectedLocalIdentitySave, NookError> {
        let IdentityDbSaveProtectedLocalIdentity {
            app_key,
            record,
            label,
        } = request;
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| NookError::IndexedDb(format!("Identity setup error: {error:?}")))?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Identity setup store error: {error:?}"))
        })?;
        let mut directory = NookDatabase::load_directory_for_write(&store).await?;
        let identity = keyring::ProtectedIdentityPublication {
            store: &store,
            directory,
            app_key,
            wrapped_app_key: record,
            label,
        }
        .save_existing()
        .await?;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Identity setup completion error: {error:?}"))
        })?;
        Ok(identity)
    }
}

impl NookDatabase {
    pub(crate) async fn save_new_protected_local_identity(
        request: IdentityDbSaveNewProtectedLocalIdentity<'_>,
    ) -> Result<ProtectedLocalIdentitySave, NookError> {
        let IdentityDbSaveNewProtectedLocalIdentity {
            app_key,
            record,
            prior_app_key,
            label,
        } = request;
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| NookError::IndexedDb(format!("Identity creation error: {error:?}")))?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Identity creation store error: {error:?}"))
        })?;
        let mut directory = NookDatabase::load_directory_for_write(&store).await?;
        let identity = keyring::ProtectedIdentityPublication {
            store: &store,
            directory,
            app_key,
            wrapped_app_key: record,
            label,
        }
        .save_new(prior_app_key)
        .await?;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Identity creation completion error: {error:?}"))
        })?;
        Ok(identity)
    }
}

impl NookDatabase {
    pub(crate) async fn load_selected_identity()
    -> Result<Option<nook_core::IdentityRecord>, NookError> {
        let directory = NookDatabase::load_identity_directory().await?;
        match directory.selection() {
            IdentitySelection::Empty => Ok(None),
            IdentitySelection::Selected(_) => directory
                .selected()
                .cloned()
                .map(Some)
                .map_err(|error| NookError::Database(error.to_string())),
        }
    }
}

impl NookDatabase {
    pub(crate) async fn load_identity(
        identity_id: &nook_core::IdentityId,
    ) -> Result<Option<nook_core::IdentityRecord>, NookError> {
        Ok(NookDatabase::load_identity_directory()
            .await?
            .identities()
            .iter()
            .find(|record| record.identity_id == *identity_id)
            .cloned())
    }
}

impl NookDatabase {
    pub(crate) async fn set_identity_member_signing_public_key(
        request: IdentityDbSetIdentityMemberSigningPublicKey<'_>,
    ) -> Result<(), NookError> {
        let IdentityDbSetIdentityMemberSigningPublicKey {
            identity_id,
            app_id,
            signing_public_key,
        } = request;
        let identity_id = identity_id.clone();
        let app_id = app_id.clone();
        let signing_public_key = signing_public_key.clone();
        NookDatabase::update_identity_directory(move |directory| {
            directory
                .set_member_signing_public_key(DirectoryMemberSigningUpdate {
                    identity_id: &identity_id,
                    member: IdentityMemberSigningUpdate {
                        app_id: &app_id,
                        signing_public_key: &signing_public_key,
                    },
                })
                .map(IdentityDirectoryWrite::from)
                .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))
        })
        .await
    }
}

/// Resolve the identity owned by the current app key.
///
/// This preserves the legacy single-installation bootstrap. New cross-installation
/// membership uses the explicit enrollment flow rather than this compatibility path.
/// Persisted selection is only a default for a new browser session; an already-open
/// manager remains bound to its own app key when another tab changes that selection.
impl NookDatabase {
    pub(crate) async fn ensure_local_identity_for_app_key(
        request: IdentityDbEnsureLocalIdentityForAppKey<'_>,
    ) -> Result<nook_core::IdentityRecord, NookError> {
        let IdentityDbEnsureLocalIdentityForAppKey { app_key, label } = request;
        let app_key = app_key.clone();
        let label = label.to_owned();
        NookDatabase::update_identity_directory(move |directory| {
            NookDatabase::ensure_local_identity_in_directory(
                IdentityDbEnsureLocalIdentityInDirectory {
                    directory: directory,
                    app_key: &app_key,
                    label: &label,
                    allow_peer_only_bootstrap: false,
                },
            )
        })
        .await
    }
}

impl NookDatabase {
    fn ensure_local_identity_in_directory(
        request: IdentityDbEnsureLocalIdentityInDirectory<'_>,
    ) -> Result<IdentityDirectoryWrite<nook_core::IdentityRecord>, NookError> {
        let IdentityDbEnsureLocalIdentityInDirectory {
            mut directory,
            app_key,
            label,
            allow_peer_only_bootstrap,
        } = request;
        let identity_id = match directory
            .identity_for_app_key(app_key)
            .map_err(NookDatabase::map_domain_error)?
        {
            Some(identity_id) => identity_id,
            None if directory.identities().is_empty() || allow_peer_only_bootstrap => {
                let resolved_identity = directory
                    .create_identity(IdentityCreation {
                        label,
                        app_key,
                        member_label: None,
                    })
                    .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
                directory = resolved_identity.directory;
                resolved_identity.identity_id
            }
            None => {
                return Err(NookError::Database(
                    MultiDeviceError::IdentityEnrollmentRequired.to_string(),
                ));
            }
        };
        let value = directory
            .identities()
            .iter()
            .find(|identity| identity.identity_id == identity_id)
            .cloned()
            .ok_or_else(|| {
                NookError::Database(
                    MultiDeviceError::IdentityNotFound {
                        identity_id: identity_id.to_string(),
                    }
                    .to_string(),
                )
            })?;
        Ok(IdentityDirectoryWrite { directory, value })
    }
}

/// Associate a legacy vault with an identity without guessing from active selection.
pub(crate) struct LegacyVaultIdentityInput<'a> {
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) store_id: &'a nook_core::StoreId,
    pub(crate) secrets_envelope: nook_core::AgeArmoredCiphertext,
    pub(crate) members_envelope: nook_core::AgeArmoredCiphertext,
    pub(crate) key_epoch: nook_core::IdentityVaultDekEpoch,
    pub(crate) verified_previous_key_epoch: Option<nook_core::IdentityVaultEventId>,
    pub(crate) committed_event_ids: Vec<nook_core::IdentityVaultEventId>,
    pub(crate) checkpoint_ancestors: Vec<nook_core::IdentityVaultEventId>,
    pub(crate) authorized_auth_ids: Vec<nook_core::AuthKeyId>,
    pub(crate) label: &'a str,
}

impl NookDatabase {
    pub(crate) async fn ensure_identity_from_legacy_vault(
        input: LegacyVaultIdentityInput<'_>,
    ) -> Result<nook_core::IdentityRecord, NookError> {
        input.reconcile().await
    }
}

impl NookDatabase {
    pub(crate) async fn generate_vault_dek_for_identity(
        request: IdentityDbGenerateVaultDekForIdentity<'_>,
    ) -> Result<nook_core::VaultKeys, NookError> {
        let IdentityDbGenerateVaultDekForIdentity {
            identity_id,
            app_key,
            store_id,
        } = request;
        let identity_id = identity_id.clone();
        let app_key = app_key.clone();
        NookDatabase::update_identity_directory(move |directory| {
            directory
                .open_or_generate_vault_dek_for_identity(DirectoryOwnedVaultOpening {
                    identity_id: &identity_id,
                    vault: IdentityVaultKeyOpening {
                        app_key: &app_key,
                        store_id: store_id,
                    },
                })
                .map(IdentityDirectoryWrite::from)
                .map_err(|rejected| NookError::Database(rejected.into_cause().to_string()))
        })
        .await
    }
}

impl NookDatabase {
    pub(crate) async fn validate_vault_identity_enrollment(
        request: IdentityDbValidateVaultIdentityEnrollment<'_>,
    ) -> Result<(), NookError> {
        let IdentityDbValidateVaultIdentityEnrollment { app_key, store_id } = request;
        NookDatabase::load_identity_directory()
            .await?
            .validate_vault_enrollment(app_key, store_id)
            .map_err(|error| NookError::Database(error.to_string()))
    }
}

#[cfg(test)]
impl NookDatabase {
    pub(crate) async fn clear_identity_directory_for_test() -> Result<(), NookError> {
        NookDatabase::clear_vault_db().await
    }
}

#[cfg(test)]
mod tests {

    use crate::storage::identity_record::IdentityDirectoryWrite;

    use crate::identity_record;
    use crate::identity_record::NookIdentityDirectorySelectionKind;
    use crate::storage::event_db;
    use nook_core::{AppKey, IdentityDirectory, IdentityRecord, IdentitySelection, IsoTimestamp};
    use nook_core::{IdentityCreation, IdentityVaultKeyOpening};

    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn migrates_legacy_record_then_persists_multiple_identities() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let legacy = IdentityRecord::create_with_app_key("Personal", &app_key, None)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let legacy_id = legacy.identity_id.clone();
        let raw = serde_json::to_string(&legacy)
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: LEGACY_IDENTITY_RECORD_KEY,
            value: &raw,
        })
        .await?;

        let migrated = NookDatabase::load_identity_directory().await?;
        assert_eq!(
            migrated
                .selected()
                .map_err(NookDatabase::map_domain_error)?
                .identity_id,
            legacy_id
        );
        assert!(
            NookDatabase::idb_get_string(LEGACY_IDENTITY_RECORD_KEY)
                .await?
                .is_none()
        );
        assert!(
            NookDatabase::idb_get_string(IDENTITY_DIRECTORY_KEY)
                .await?
                .is_some()
        );

        let work_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let work_id = NookDatabase::update_identity_directory(move |directory| {
            directory
                .create_identity(IdentityCreation {
                    label: "Work",
                    app_key: &work_key,
                    member_label: None,
                })
                .map(IdentityDirectoryWrite::from)
                .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))
        })
        .await?;
        let reloaded = NookDatabase::load_identity_directory().await?;
        assert_eq!(reloaded.identities().len(), 2);
        assert_eq!(
            reloaded
                .selected()
                .map_err(NookDatabase::map_domain_error)?
                .identity_id,
            work_id
        );
        let snapshot = identity_record::load_identity_directory_snapshot()
            .await
            .map_err(|error| NookError::Database(format!("{error:?}")))?;
        assert_eq!(snapshot.length(), 2);
        assert_eq!(
            snapshot.selection_kind(),
            NookIdentityDirectorySelectionKind::Selected
        );
        assert_eq!(
            snapshot
                .selected_identity_id()
                .map_err(|error| NookError::Database(format!("{error:?}")))?,
            work_id.as_str()
        );
        let selected = snapshot
            .identity(1)
            .map_err(|error| NookError::Database(format!("{error:?}")))?;
        assert_eq!(selected.label(), "Work");
        assert_eq!(selected.members().len(), 1);
        assert!(selected.vault_store_ids().is_empty());
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn existing_app_key_resolution_ignores_another_tabs_selection() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let first_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let first = NookDatabase::ensure_local_identity_for_app_key(
            IdentityDbEnsureLocalIdentityForAppKey {
                app_key: &first_key,
                label: "Personal",
            },
        )
        .await?;
        let second_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let second_id = NookDatabase::update_identity_directory(move |directory| {
            directory
                .create_identity(IdentityCreation {
                    label: "Work",
                    app_key: &second_key,
                    member_label: None,
                })
                .map(IdentityDirectoryWrite::from)
                .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))
        })
        .await?;

        let resolved = NookDatabase::ensure_local_identity_for_app_key(
            IdentityDbEnsureLocalIdentityForAppKey {
                app_key: &first_key,
                label: "Ignored",
            },
        )
        .await?;

        assert_eq!(resolved.identity_id, first.identity_id);
        assert_eq!(
            NookDatabase::load_identity_directory().await?.selection(),
            &IdentitySelection::Selected(second_id),
        );
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn normalizes_persisted_duplicate_app_key_owners_without_losing_vaults()
    -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let mut legacy = IdentityDirectory::empty();
        let resolved_identity = legacy
            .create_identity(IdentityCreation {
                label: "Personal",
                app_key: &app_key,
                member_label: None,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        legacy = resolved_identity.directory;
        let store_id = nook_core::StoreId::generate().map_err(NookDatabase::map_domain_error)?;
        let opened_identity = legacy
            .open_or_generate_vault_dek(IdentityVaultKeyOpening {
                app_key: &app_key,
                store_id: store_id.clone(),
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        legacy = opened_identity.identity;
        let expected = opened_identity.keys;
        let resolved_identity = legacy
            .create_identity(IdentityCreation {
                label: "Work",
                app_key: &app_key,
                member_label: None,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        legacy = resolved_identity.directory;
        let selected_id = resolved_identity.identity_id;
        let legacy_raw = serde_json::to_string(&legacy)
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: IDENTITY_DIRECTORY_KEY,
            value: &legacy_raw,
        })
        .await?;

        let mut migrated = NookDatabase::load_identity_directory().await?;

        assert_eq!(migrated.identities().len(), 1);
        assert_eq!(
            migrated
                .selected()
                .map_err(NookDatabase::map_domain_error)?
                .identity_id,
            selected_id
        );
        assert_eq!(
            migrated
                .open_vault_dek(IdentityVaultKeyOpening {
                    app_key: &app_key,
                    store_id: store_id
                })
                .map_err(NookDatabase::map_domain_error)?,
            expected
        );
        let normalized_raw = NookDatabase::idb_get_string(IDENTITY_DIRECTORY_KEY)
            .await?
            .ok_or_else(|| NookError::IndexedDb("Normalized directory is missing.".to_owned()))?;
        assert_ne!(normalized_raw, legacy_raw);
        let normalized: IdentityDirectory = serde_json::from_str(&normalized_raw)
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        normalized
            .validate()
            .map_err(NookDatabase::map_domain_error)?;
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn valid_directory_ignores_malformed_pending_genesis_marker() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let mut directory = IdentityDirectory::empty();
        let resolved_identity = directory
            .create_identity(IdentityCreation {
                label: "Personal",
                app_key: &app_key,
                member_label: None,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        directory = resolved_identity.directory;
        let identity_id = resolved_identity.identity_id;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: IDENTITY_DIRECTORY_KEY,
            value: &serde_json::to_string(&directory)
                .map_err(|error| NookError::IndexedDb(error.to_string()))?,
        })
        .await?;
        let malformed_marker = "{\"futureFormat\":true}";
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: PENDING_SIMPLE_GENESIS_KEY,
            value: malformed_marker,
        })
        .await?;

        let loaded = NookDatabase::load_identity_directory().await?;

        assert_eq!(
            loaded
                .selected()
                .map_err(NookDatabase::map_domain_error)?
                .identity_id,
            identity_id
        );
        assert_eq!(
            NookDatabase::idb_get_string(PENDING_SIMPLE_GENESIS_KEY)
                .await?
                .as_deref(),
            Some(malformed_marker)
        );
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn current_directory_wins_over_stale_legacy_record() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let legacy = IdentityRecord::create_with_app_key("Legacy", &app_key, None)
            .map_err(NookDatabase::map_domain_error)?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: LEGACY_IDENTITY_RECORD_KEY,
            value: &serde_json::to_string(&legacy)
                .map_err(|error| NookError::IndexedDb(error.to_string()))?,
        })
        .await?;
        let mut current = IdentityDirectory::empty();
        let resolved_identity = current
            .create_identity(IdentityCreation {
                label: "Personal",
                app_key: &app_key,
                member_label: None,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        current = resolved_identity.directory;
        let work_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let resolved_identity = current
            .create_identity(IdentityCreation {
                label: "Work",
                app_key: &work_key,
                member_label: None,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        current = resolved_identity.directory;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: IDENTITY_DIRECTORY_KEY,
            value: &serde_json::to_string(&current)
                .map_err(|error| NookError::IndexedDb(error.to_string()))?,
        })
        .await?;

        let loaded = NookDatabase::load_identity_directory().await?;
        assert_eq!(loaded, current);
        assert!(
            NookDatabase::idb_get_string(LEGACY_IDENTITY_RECORD_KEY)
                .await?
                .is_none()
        );
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn invalid_current_directory_preserves_legacy_record() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let legacy = IdentityRecord::create_with_app_key("Legacy", &app_key, None)
            .map_err(NookDatabase::map_domain_error)?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: LEGACY_IDENTITY_RECORD_KEY,
            value: &serde_json::to_string(&legacy)
                .map_err(|error| NookError::IndexedDb(error.to_string()))?,
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: IDENTITY_DIRECTORY_KEY,
            value: "{invalid-json",
        })
        .await?;

        assert!(NookDatabase::load_identity_directory().await.is_err());
        assert!(
            NookDatabase::idb_get_string(LEGACY_IDENTITY_RECORD_KEY)
                .await?
                .is_some()
        );
        NookDatabase::clear_identity_directory_for_test().await
    }
}

pub(crate) use keyring::{
    KeyringDbEntryForAppIdFromStore, KeyringDbKeyringDeleteKey, KeyringDbKeyringReadString,
    KeyringDbLoadKeyringForStore, KeyringDbValidateKeyringDirectoryBinding, KeyringDbWriteKeyring,
};

pub(crate) use keyring::LegacyIdentityKeyMigration;
