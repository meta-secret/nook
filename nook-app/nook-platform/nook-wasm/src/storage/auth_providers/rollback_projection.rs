//! Ownership and migration policy for the singleton provider rollback projection.

use crate::AuthProviderDatabase;
use crate::NookDatabase;
use crate::ProviderDbReadRawSnapshotFromStore;
#[cfg(all(test, target_arch = "wasm32"))]
use crate::storage::identity_record;
use crate::storage::identity_record::StoredIdentityProtection;
use nook_core::{
    DeviceIdentity, NormalizedAuthSnapshot, ProviderCredentialRejection,
    ProviderCredentialStorageAdmission,
};
use rexie::TransactionMode;

use super::{NookError, ProviderSnapshotStore, SCHEMA_KEY, STATE_KEY, STORE};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ProviderProjectionRelation {
    MissingRecord,
    Equal,
    Different,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum LegacyProjectionOwnership {
    Owned,
    Foreign,
}

pub(crate) enum ProviderSnapshotObservation {
    Missing,
    Present(NormalizedAuthSnapshot),
}
impl From<serde_json::Value> for ProviderSnapshotObservation {
    fn from(raw: serde_json::Value) -> Self {
        match raw {
            serde_json::Value::Null => Self::Missing,
            raw => Self::Present(NormalizedAuthSnapshot::from(raw)),
        }
    }
}
/// Named values required by `AuthProviderDatabase::projections_match`.
#[derive(Clone, Copy)]
pub(crate) struct ProviderDbProjectionsMatch<'a> {
    pub(crate) scoped: &'a ProviderSnapshotObservation,
    pub(crate) legacy: &'a ProviderSnapshotObservation,
}

/// Named values required by `AuthProviderDatabase::require_compatible_legacy_snapshot`.
#[derive(Clone, Copy)]
pub(crate) struct ProviderDbRequireCompatibleLegacySnapshot<'a> {
    pub(crate) scoped: &'a ProviderSnapshotObservation,
    pub(crate) legacy: &'a ProviderSnapshotObservation,
}

/// Named values required by `AuthProviderDatabase::legacy_snapshot_belongs_to_identity`.
#[derive(Clone, Copy)]
pub(crate) struct ProviderDbLegacySnapshotBelongsToIdentity<'a> {
    pub(crate) identity: &'a DeviceIdentity,
    pub(crate) scoped: &'a ProviderSnapshotObservation,
    pub(crate) legacy: &'a ProviderSnapshotObservation,
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
    pub(super) fn projections_match(
        request: ProviderDbProjectionsMatch<'_>,
    ) -> ProviderProjectionRelation {
        let ProviderDbProjectionsMatch { scoped, legacy } = request;
        match (scoped, legacy) {
            (
                ProviderSnapshotObservation::Present(scoped),
                ProviderSnapshotObservation::Present(legacy),
            ) => {
                if scoped.snapshot == legacy.snapshot {
                    ProviderProjectionRelation::Equal
                } else {
                    ProviderProjectionRelation::Different
                }
            }
            _ => ProviderProjectionRelation::MissingRecord,
        }
    }
}

impl AuthProviderDatabase {
    fn require_compatible_legacy_snapshot(
        request: ProviderDbRequireCompatibleLegacySnapshot<'_>,
    ) -> Result<(), NookError> {
        let ProviderDbRequireCompatibleLegacySnapshot { scoped, legacy } = request;
        if AuthProviderDatabase::projections_match(ProviderDbProjectionsMatch { scoped, legacy })
            != ProviderProjectionRelation::Different
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
    ) -> LegacyProjectionOwnership {
        let ProviderDbLegacySnapshotBelongsToIdentity {
            identity,
            scoped,
            legacy,
        } = request;
        if AuthProviderDatabase::projections_match(ProviderDbProjectionsMatch {
            scoped: scoped,
            legacy: legacy,
        }) == ProviderProjectionRelation::Equal
        {
            return LegacyProjectionOwnership::Owned;
        }
        let ProviderSnapshotObservation::Present(legacy) = legacy else {
            return LegacyProjectionOwnership::Foreign;
        };
        match legacy.snapshot.credential_opening_evidence(identity) {
            Ok(nook_core::ProviderCredentialOpening::Opened) => LegacyProjectionOwnership::Owned,
            Ok(nook_core::ProviderCredentialOpening::Unchanged) | Err(_) => {
                LegacyProjectionOwnership::Foreign
            }
        }
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
        let scoped = ProviderSnapshotObservation::from(scoped);
        let legacy = ProviderSnapshotObservation::from(legacy);
        AuthProviderDatabase::require_compatible_legacy_snapshot(
            ProviderDbRequireCompatibleLegacySnapshot {
                scoped: &scoped,
                legacy: &legacy,
            },
        )?;
        if let (
            ProviderSnapshotObservation::Missing,
            ProviderSnapshotObservation::Present(legacy),
        ) = (scoped, legacy)
        {
            let mut snapshot = legacy.snapshot;
            snapshot = snapshot
                .open_credentials(identity)
                .map_err(ProviderCredentialRejection::into_cause)?;
            snapshot = snapshot
                .seal_credentials(identity)
                .map_err(ProviderCredentialRejection::into_cause)?;
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
        let StoredIdentityProtection::Protected(entry) =
            NookDatabase::load_selected_entry().await?
        else {
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
        let scoped = ProviderSnapshotObservation::from(scoped);
        let legacy = ProviderSnapshotObservation::from(legacy);
        AuthProviderDatabase::require_compatible_legacy_snapshot(
            ProviderDbRequireCompatibleLegacySnapshot {
                scoped: &scoped,
                legacy: &legacy,
            },
        )?;
        if let (
            ProviderSnapshotObservation::Missing,
            ProviderSnapshotObservation::Present(legacy),
        ) = (scoped, legacy)
        {
            let snapshot = legacy.snapshot;
            if snapshot.credential_storage_admission()
                != ProviderCredentialStorageAdmission::MarkerCompatible
            {
                return Err(NookError::Decryption(
                    "Legacy auth providers require current identity authorization".to_owned(),
                ));
            }
            {
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_records_do_not_prove_rollback_projection_ownership() {
        let missing = ProviderSnapshotObservation::Missing;
        let empty = ProviderSnapshotObservation::from(serde_json::json!({ "providers": [] }));
        assert_eq!(
            AuthProviderDatabase::projections_match(ProviderDbProjectionsMatch {
                scoped: &missing,
                legacy: &empty
            }),
            ProviderProjectionRelation::MissingRecord
        );
        let tagged_empty = ProviderSnapshotObservation::from(
            serde_json::json!({ "providers": [], "activeVaultStoreId": { "state": "unselected" } }),
        );
        assert_eq!(
            AuthProviderDatabase::projections_match(ProviderDbProjectionsMatch {
                scoped: &empty,
                legacy: &tagged_empty
            }),
            ProviderProjectionRelation::Equal
        );
        assert!(
            AuthProviderDatabase::require_compatible_legacy_snapshot(
                ProviderDbRequireCompatibleLegacySnapshot {
                    scoped: &missing,
                    legacy: &empty
                }
            )
            .is_ok()
        );
    }
}
