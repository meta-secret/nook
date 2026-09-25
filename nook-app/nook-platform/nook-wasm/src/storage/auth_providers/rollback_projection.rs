//! Ownership and migration policy for the singleton provider rollback projection.

use crate::AuthProviderDatabase;
use crate::NookDatabase;
use crate::ProviderDbReadRawSnapshotFromStore;
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
    Equivalent,
    Different,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum LegacyProjectionOwnership {
    Owned,
    Foreign,
}

pub(crate) enum ProviderSnapshotObservation {
    Missing,
    Present {
        snapshot: NormalizedAuthSnapshot,
        raw: serde_json::Value,
    },
}
impl From<serde_json::Value> for ProviderSnapshotObservation {
    fn from(raw: serde_json::Value) -> Self {
        match raw {
            serde_json::Value::Null => Self::Missing,
            raw => Self::Present {
                snapshot: NormalizedAuthSnapshot::from(raw.clone()),
                raw,
            },
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
    /// Compare complete snapshots and the exact schema-1 projection of a schema-2 snapshot.
    ///
    /// New private Drive targets are omitted from the rollback projection. The raw legacy record
    /// remains an ownership match when it exactly represents that projection, including when no
    /// provider credentials remain to authenticate its owner.
    pub(super) fn projections_match(
        request: ProviderDbProjectionsMatch<'_>,
    ) -> ProviderProjectionRelation {
        let ProviderDbProjectionsMatch { scoped, legacy } = request;
        match (scoped, legacy) {
            (
                ProviderSnapshotObservation::Present {
                    snapshot: scoped, ..
                },
                ProviderSnapshotObservation::Present {
                    snapshot: legacy,
                    raw: legacy_raw,
                },
            ) => {
                if scoped.snapshot == legacy.snapshot {
                    ProviderProjectionRelation::Equivalent
                } else {
                    match serde_json::to_value(scoped.snapshot.legacy_storage_snapshot()) {
                        Ok(expected_legacy) if &expected_legacy == legacy_raw => {
                            ProviderProjectionRelation::Equivalent
                        }
                        Ok(_) | Err(_) => ProviderProjectionRelation::Different,
                    }
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
        if AuthProviderDatabase::projections_match(ProviderDbProjectionsMatch { scoped, legacy })
            == ProviderProjectionRelation::Equivalent
        {
            return LegacyProjectionOwnership::Owned;
        }
        let ProviderSnapshotObservation::Present {
            snapshot: legacy, ..
        } = legacy
        else {
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
            ProviderSnapshotObservation::Present {
                snapshot: legacy, ..
            },
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
            .write_legacy(&snapshot)
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
            ProviderSnapshotObservation::Present {
                snapshot: legacy, ..
            },
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
                .write_legacy(&snapshot)
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
    use nook_core::{
        ActiveVaultScope, AuthProvidersSnapshotData, DeviceIdentity, GoogleDriveMode,
        OAuthFileConfigData, OauthFilePreset, ProviderSyncCheckpoint, ProviderVaultScope,
        StorageProviderData, StorageProviderType, StoredGithubPat, StoredGithubRepository,
        StoredGoogleDrivePrivateTarget, StoredLocalFolderConfiguration,
        StoredOAuthAccessCredential, StoredOAuthFileConfiguration,
    };

    fn pending_private_drive_snapshot() -> AuthProvidersSnapshotData {
        AuthProvidersSnapshotData {
            providers: vec![StorageProviderData {
                id: "private-drive".to_owned(),
                provider_type: StorageProviderType::OauthFile,
                label: "Google Drive".to_owned(),
                github_pat: StoredGithubPat::Missing,
                github_repo: StoredGithubRepository::DefaultRepository,
                oauth_file: StoredOAuthFileConfiguration::configured(OAuthFileConfigData {
                    preset: OauthFilePreset::GoogleDrive,
                    access_token: StoredOAuthAccessCredential::AccessToken(
                        "drive-access-token".to_owned(),
                    ),
                    drive_mode: GoogleDriveMode::Private,
                    drive_private_target: StoredGoogleDrivePrivateTarget::Pending,
                    ..OAuthFileConfigData::default()
                }),
                local_folder: StoredLocalFolderConfiguration::NotApplicable,
                store_id: ProviderVaultScope::StoreId("current-store".to_owned()),
                sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                created_at: "2026-09-25T00:00:00.000Z".to_owned(),
            }],
            active_vault_store_id: ActiveVaultScope::StoreId("current-store".to_owned()),
        }
    }

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
            ProviderProjectionRelation::Equivalent
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

    #[test]
    fn empty_legacy_projection_matches_pending_private_drive_snapshot() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let scoped_snapshot =
            pending_private_drive_snapshot().sealed_credentials_projection(&identity)?;
        let scoped = ProviderSnapshotObservation::from(serde_json::to_value(&scoped_snapshot)?);
        let legacy_raw = serde_json::to_value(scoped_snapshot.legacy_storage_snapshot())?;
        let expected_providers = serde_json::json!([]);
        assert_eq!(legacy_raw.get("providers"), Some(&expected_providers));
        let legacy = ProviderSnapshotObservation::from(legacy_raw);

        assert_eq!(
            AuthProviderDatabase::projections_match(ProviderDbProjectionsMatch {
                scoped: &scoped,
                legacy: &legacy,
            }),
            ProviderProjectionRelation::Equivalent
        );
        assert_eq!(
            AuthProviderDatabase::legacy_snapshot_belongs_to_identity(
                ProviderDbLegacySnapshotBelongsToIdentity {
                    identity: &identity,
                    scoped: &scoped,
                    legacy: &legacy,
                }
            ),
            LegacyProjectionOwnership::Owned
        );
        Ok(())
    }

    #[test]
    fn foreign_legacy_snapshot_does_not_match_private_drive_projection() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let foreign_identity = DeviceIdentity::generate()?;
        let scoped_snapshot =
            pending_private_drive_snapshot().sealed_credentials_projection(&identity)?;
        let scoped = ProviderSnapshotObservation::from(serde_json::to_value(&scoped_snapshot)?);
        let foreign_provider = StorageProviderData::github(
            "foreign-provider",
            "GitHub",
            "foreign-token",
            "owner/repo",
            "2026-09-25T00:00:00.000Z",
        );
        let foreign_snapshot = AuthProvidersSnapshotData {
            providers: vec![foreign_provider],
            active_vault_store_id: ActiveVaultScope::StoreId("foreign-store".to_owned()),
        }
        .sealed_credentials_projection(&foreign_identity)?;
        let foreign_legacy = serde_json::to_value(foreign_snapshot.legacy_storage_snapshot())?;
        let legacy = ProviderSnapshotObservation::from(foreign_legacy);

        assert_eq!(
            AuthProviderDatabase::projections_match(ProviderDbProjectionsMatch {
                scoped: &scoped,
                legacy: &legacy,
            }),
            ProviderProjectionRelation::Different
        );
        assert_eq!(
            AuthProviderDatabase::legacy_snapshot_belongs_to_identity(
                ProviderDbLegacySnapshotBelongsToIdentity {
                    identity: &identity,
                    scoped: &scoped,
                    legacy: &legacy,
                }
            ),
            LegacyProjectionOwnership::Foreign
        );
        assert!(
            AuthProviderDatabase::require_compatible_legacy_snapshot(
                ProviderDbRequireCompatibleLegacySnapshot {
                    scoped: &scoped,
                    legacy: &legacy,
                }
            )
            .is_err()
        );
        Ok(())
    }
}
