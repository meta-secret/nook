//! Persisted local identity protection selection.
use super::*;
use nook_core::{IdentityRecord, LocalIdentityKeyringEntry};

enum ProjectionAppSelection {
    Persisted,
    Requested(AppId),
}

pub(crate) enum StoredIdentityProtection {
    Unprotected,
    Protected(LocalIdentityKeyringEntry),
}

use nook_core::WrappedDeviceIdentity;

pub(crate) struct ProtectedLocalIdentity {
    pub(crate) app_id: AppId,
    pub(crate) wrapped_identity: WrappedDeviceIdentity,
}

pub(crate) enum ProtectedIdentityLookup {
    Unconfigured,
    Configured(ProtectedLocalIdentity),
}

pub(crate) enum StoredIdentityRecord {
    NotRegistered,
    Registered(IdentityRecord),
}

pub(crate) enum SelectedIdentityRecord {
    Unselected,
    Selected(IdentityRecord),
}

pub(crate) struct LocalIdentityProjection {
    pub(crate) directory: IdentityDirectory,
    pub(crate) keyring: nook_core::LocalIdentityKeyring,
    pub(crate) protected: ProtectedIdentityLookup,
}

impl NookDatabase {
    pub(crate) async fn load_local_identity_projection(
        session_app_id: &str,
    ) -> Result<LocalIdentityProjection, NookError> {
        let requested_app_id = if session_app_id.is_empty() {
            ProjectionAppSelection::Persisted
        } else {
            ProjectionAppSelection::Requested(
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
        let entry = match &requested_app_id {
            ProjectionAppSelection::Requested(app_id) => match keyring
                .entries()
                .iter()
                .find(|entry| entry.app_id() == app_id)
            {
                Some(entry) => LocalIdentityProtection::Protected(entry),
                None => LocalIdentityProtection::Unprotected,
            },
            ProjectionAppSelection::Persisted => match directory.selection() {
                IdentitySelection::Empty => LocalIdentityProtection::Unprotected,
                IdentitySelection::Selected(identity_id) => keyring.entry(identity_id),
            },
        };
        let protected = match entry {
            LocalIdentityProtection::Protected(entry) => {
                ProtectedIdentityLookup::Configured(ProtectedLocalIdentity {
                    app_id: entry.app_id().clone(),
                    wrapped_identity: entry.wrapped_app_key().clone(),
                })
            }
            LocalIdentityProtection::Unprotected => {
                match NookDatabase::load_legacy_wrapped_device_identity_from_store(&store).await? {
                    ProtectedIdentityLookup::Configured(identity)
                        if match &requested_app_id {
                            ProjectionAppSelection::Persisted => true,
                            ProjectionAppSelection::Requested(requested) => {
                                requested == &identity.app_id
                            }
                        } =>
                    {
                        ProtectedIdentityLookup::Configured(identity)
                    }
                    ProtectedIdentityLookup::Configured(_)
                    | ProtectedIdentityLookup::Unconfigured => {
                        ProtectedIdentityLookup::Unconfigured
                    }
                }
            }
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
    pub(in crate::storage) async fn selected_local_keyring_entry_for_store(
        store: &rexie::Store,
    ) -> Result<StoredIdentityProtection, NookError> {
        NookDatabase::selected_entry_from_store(store).await
    }
}
impl NookDatabase {
    pub(in crate::storage) async fn local_keyring_entry_for_app_id_from_store(
        request: IdentityDbLocalKeyringEntryForAppIdFromStore<'_>,
    ) -> Result<StoredIdentityProtection, NookError> {
        let IdentityDbLocalKeyringEntryForAppIdFromStore { store, app_id } = request;
        NookDatabase::entry_for_app_id_from_store(KeyringDbEntryForAppIdFromStore {
            store: store,
            app_id: app_id,
        })
        .await
    }
}

impl NookDatabase {
    pub(crate) async fn load_selected_identity() -> Result<SelectedIdentityRecord, NookError> {
        let directory = NookDatabase::load_identity_directory().await?;
        match directory.selection() {
            IdentitySelection::Empty => Ok(SelectedIdentityRecord::Unselected),
            IdentitySelection::Selected(_) => directory
                .selected()
                .cloned()
                .map(SelectedIdentityRecord::Selected)
                .map_err(|error| NookError::Database(error.to_string())),
        }
    }
}

impl NookDatabase {
    pub(crate) async fn load_identity(
        identity_id: &nook_core::IdentityId,
    ) -> Result<StoredIdentityRecord, NookError> {
        Ok(NookDatabase::load_identity_directory()
            .await?
            .identities()
            .iter()
            .find(|record| record.identity_id == *identity_id)
            .map_or(StoredIdentityRecord::NotRegistered, |record| {
                StoredIdentityRecord::Registered(record.clone())
            }))
    }
}
