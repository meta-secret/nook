//! Ownership and migration policy for the singleton provider rollback projection.

use crate::AuthProviderDatabase;
use crate::NookDatabase;
use crate::ProviderDbReadRawSnapshotFromStore;
use crate::storage::identity_record;
use nook_core::{DeviceIdentity, NormalizedAuthSnapshot, ProviderCredentialStorageAdmission};
use rexie::TransactionMode;

use super::{NookError, ProviderSnapshotStore, SCHEMA_KEY, STATE_KEY, STORE};

/// Named values required by AuthProviderDatabase::projections_match.
pub(crate) struct ProviderDbProjectionsMatch<'a> {
    pub(crate) scoped: &'a serde_json::Value,
    pub(crate) legacy: &'a serde_json::Value,
}

/// Named values required by AuthProviderDatabase::require_compatible_legacy_snapshot.
pub(crate) struct ProviderDbRequireCompatibleLegacySnapshot<'a> {
    pub(crate) scoped: &'a serde_json::Value,
    pub(crate) legacy: &'a serde_json::Value,
}

/// Named values required by AuthProviderDatabase::legacy_snapshot_belongs_to_identity.
pub(crate) struct ProviderDbLegacySnapshotBelongsToIdentity<'a> {
    pub(crate) identity: &'a DeviceIdentity,
    pub(crate) scoped: &'a serde_json::Value,
    pub(crate) legacy: &'a serde_json::Value,
}

impl AuthProviderDatabase {
    pub(super) async fn may_migrate_legacy_snapshot(
        app_id: &nook_core::AppId,
    ) -> Result<bool, NookError> {
        let keyring = NookDatabase::load_keyring().await?;
        Ok(keyring.entries().is_empty()
            || (keyring.entries().len() == 1
                && keyring
                    .entries()
                    .first()
                    .is_some_and(|entry| entry.app_id() == app_id)))
    }
}

impl AuthProviderDatabase {
    pub(super) async fn should_refresh_legacy_projection(
        app_id: &nook_core::AppId,
    ) -> Result<bool, NookError> {
        let keyring = NookDatabase::load_keyring().await?;
        Ok(keyring.entries().len() == 1
            && keyring
                .entries()
                .first()
                .is_some_and(|entry| entry.app_id() == app_id))
    }
}

impl AuthProviderDatabase {
    pub(super) fn projections_match(request: ProviderDbProjectionsMatch<'_>) -> bool {
        let ProviderDbProjectionsMatch { scoped, legacy } = request;
        if scoped.is_null() || legacy.is_null() {
            return false;
        }
        NormalizedAuthSnapshot::from_wire(scoped).snapshot
            == NormalizedAuthSnapshot::from_wire(legacy).snapshot
    }
}

impl AuthProviderDatabase {
    fn require_compatible_legacy_snapshot(
        request: ProviderDbRequireCompatibleLegacySnapshot<'_>,
    ) -> Result<(), NookError> {
        let ProviderDbRequireCompatibleLegacySnapshot { scoped, legacy } = request;
        if scoped.is_null()
            || legacy.is_null()
            || AuthProviderDatabase::projections_match(ProviderDbProjectionsMatch {
                scoped: scoped,
                legacy: legacy,
            })
        {
            return Ok(());
        }
        Err(NookError::Database(
        "Legacy auth providers conflict with the identity-scoped snapshot; both records were preserved"
            .to_owned(),
    ))
    }
}

impl AuthProviderDatabase {
    pub(super) fn legacy_snapshot_belongs_to_identity(
        request: ProviderDbLegacySnapshotBelongsToIdentity<'_>,
    ) -> bool {
        let ProviderDbLegacySnapshotBelongsToIdentity {
            identity,
            scoped,
            legacy,
        } = request;
        if AuthProviderDatabase::projections_match(ProviderDbProjectionsMatch {
            scoped: scoped,
            legacy: legacy,
        }) {
            return true;
        }
        if legacy.is_null() {
            return false;
        }
        let mut snapshot = NormalizedAuthSnapshot::from_wire(legacy).snapshot;
        let sealed = snapshot.clone();
        snapshot
            .open_credentials(identity)
            .is_ok_and(|opened| opened != sealed)
    }
}

impl AuthProviderDatabase {
    pub(super) async fn migrate_legacy_auth_providers_for_identity(
        identity: &DeviceIdentity,
    ) -> Result<(), NookError> {
        let state_key = AuthProviderDatabase::state_key_for_app_id(identity.app_id());
        let schema_key = AuthProviderDatabase::schema_key_for_app_id(identity.app_id());
        let rexie = AuthProviderDatabase::open_auth_db().await?;
        let transaction = rexie
            .transaction(&[STORE], TransactionMode::ReadWrite)
            .map_err(|e| {
                NookError::IndexedDb(format!(
                    "{}: {:?}",
                    "nook_auth migration transaction error", e
                ))
            })?;
        let store = transaction.store(STORE).map_err(|e| {
            NookError::IndexedDb(format!("{}: {:?}", "nook_auth migration store error", e))
        })?;
        let scoped = AuthProviderDatabase::read_raw_snapshot_from_store(
            ProviderDbReadRawSnapshotFromStore {
                store: &store,
                state_key: &state_key,
            },
        )
        .await?;
        let legacy = AuthProviderDatabase::read_raw_snapshot_from_store(
            ProviderDbReadRawSnapshotFromStore {
                store: &store,
                state_key: STATE_KEY,
            },
        )
        .await?;
        AuthProviderDatabase::require_compatible_legacy_snapshot(
            ProviderDbRequireCompatibleLegacySnapshot {
                scoped: &scoped,
                legacy: &legacy,
            },
        )?;
        if scoped.is_null() && !legacy.is_null() {
            let mut snapshot = NormalizedAuthSnapshot::from_wire(&legacy).snapshot;
            snapshot = snapshot
                .open_credentials(identity)
                .map_err(|rejection| rejection.into_cause())?;
            snapshot = snapshot
                .seal_credentials(identity)
                .map_err(|rejection| rejection.into_cause())?;
            ProviderSnapshotStore {
                store: &store,
                state_key: &state_key,
                schema_key: &schema_key,
            }
            .write(&snapshot)
            .await?;
            ProviderSnapshotStore {
                store: &store,
                state_key: STATE_KEY,
                schema_key: SCHEMA_KEY,
            }
            .write(&snapshot)
            .await?;
        }
        transaction
            .done()
            .await
            .map_err(|e| {
                NookError::IndexedDb(format!(
                    "{}: {:?}",
                    "nook_auth migration completion error", e
                ))
            })
            .map(|_| ())
    }
}

impl AuthProviderDatabase {
    pub(crate) async fn migrate_legacy_auth_providers_for_selected_identity()
    -> Result<(), NookError> {
        let Some(entry) = NookDatabase::load_selected_entry().await? else {
            return Ok(());
        };
        if !AuthProviderDatabase::may_migrate_legacy_snapshot(entry.app_id()).await? {
            return Ok(());
        }
        let state_key = AuthProviderDatabase::state_key_for_app_id(entry.app_id());
        let schema_key = AuthProviderDatabase::schema_key_for_app_id(entry.app_id());
        let rexie = AuthProviderDatabase::open_auth_db().await?;
        let transaction = rexie
            .transaction(&[STORE], TransactionMode::ReadWrite)
            .map_err(|e| {
                NookError::IndexedDb(format!(
                    "{}: {:?}",
                    "nook_auth locked migration transaction error", e
                ))
            })?;
        let store = transaction.store(STORE).map_err(|e| {
            NookError::IndexedDb(format!(
                "{}: {:?}",
                "nook_auth locked migration store error", e
            ))
        })?;
        let scoped = AuthProviderDatabase::read_raw_snapshot_from_store(
            ProviderDbReadRawSnapshotFromStore {
                store: &store,
                state_key: &state_key,
            },
        )
        .await?;
        let legacy = AuthProviderDatabase::read_raw_snapshot_from_store(
            ProviderDbReadRawSnapshotFromStore {
                store: &store,
                state_key: STATE_KEY,
            },
        )
        .await?;
        AuthProviderDatabase::require_compatible_legacy_snapshot(
            ProviderDbRequireCompatibleLegacySnapshot {
                scoped: &scoped,
                legacy: &legacy,
            },
        )?;
        if scoped.is_null() {
            let snapshot = NormalizedAuthSnapshot::from_wire(&legacy).snapshot;
            if !legacy.is_null()
                && snapshot.credential_storage_admission()
                    != ProviderCredentialStorageAdmission::MarkerCompatible
            {
                return Err(NookError::Decryption(
                    "Legacy auth providers require current identity authorization".to_owned(),
                ));
            }
            if !legacy.is_null() {
                ProviderSnapshotStore {
                    store: &store,
                    state_key: &state_key,
                    schema_key: &schema_key,
                }
                .write(&snapshot)
                .await?;
                ProviderSnapshotStore {
                    store: &store,
                    state_key: STATE_KEY,
                    schema_key: SCHEMA_KEY,
                }
                .write(&snapshot)
                .await?;
            }
        }
        transaction
            .done()
            .await
            .map_err(|e| {
                NookError::IndexedDb(format!(
                    "{}: {:?}",
                    "nook_auth locked migration completion error", e
                ))
            })
            .map(|_| ())
    }
}
