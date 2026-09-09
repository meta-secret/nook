//! Compatibility migration for the pre-keyring active app key fields.

use crate::KeyringDbKeyringDeleteKey;
use crate::KeyringDbValidateKeyringDirectoryBinding;
use crate::KeyringDbWriteKeyring;
use crate::{NookDatabase, ReadStringPreferringRequest};
use nook_core::WrappedDeviceIdentity;
use nook_core::{AppId, LocalIdentityKeyring, LocalIdentityKeyringEntry, WrappedAppKeyReplacement};

use crate::{NookError, storage::indexed_db};

/// Named values required by NookDatabase::migrate_legacy_active_key.
pub(crate) struct LegacyIdentityKeyMigration<'a> {
    pub(crate) store: &'a rexie::Store,
    pub(crate) directory: &'a nook_core::IdentityDirectory,
    pub(crate) keyring: LocalIdentityKeyring,
}

pub(super) enum LegacyKeyMigrationState {
    Unchanged,
    Migrated,
}
pub(super) struct LegacyKeyMigration {
    pub(super) keyring: LocalIdentityKeyring,
    pub(super) state: LegacyKeyMigrationState,
}

impl NookDatabase {
    pub(super) async fn delete_legacy_active_key(store: &rexie::Store) -> Result<(), NookError> {
        for key in [
            indexed_db::APP_ID_KEY,
            indexed_db::DEVICE_ID_KEY,
            indexed_db::APP_KEY_WRAPPED_KEY,
            indexed_db::WRAPPED_DEVICE_IDENTITY_KEY,
        ] {
            NookDatabase::keyring_delete_key(KeyringDbKeyringDeleteKey {
                store: store,
                key: key,
                context: "Legacy active app key",
            })
            .await?;
        }
        Ok(())
    }
}

impl NookDatabase {
    pub(super) async fn migrate_legacy_active_key(
        request: LegacyIdentityKeyMigration<'_>,
    ) -> Result<LegacyKeyMigration, NookError> {
        let LegacyIdentityKeyMigration {
            store,
            directory,
            mut keyring,
        } = request;
        let wrapped = NookDatabase::read_string_preferring(ReadStringPreferringRequest {
            store: store,
            preferred_key: indexed_db::APP_KEY_WRAPPED_KEY,
            legacy_key: indexed_db::WRAPPED_DEVICE_IDENTITY_KEY,
            label: "Legacy wrapped app key",
        })
        .await?;
        let app_id = NookDatabase::read_string_preferring(ReadStringPreferringRequest {
            store: store,
            preferred_key: indexed_db::APP_ID_KEY,
            legacy_key: indexed_db::DEVICE_ID_KEY,
            label: "Legacy app id",
        })
        .await?;
        let Some(wrapped) = wrapped else {
            if app_id.is_some() {
                return Err(NookError::IndexedDb(
                    "Legacy app id exists without a wrapped app key".to_owned(),
                ));
            }
            return Ok(LegacyKeyMigration {
                keyring,
                state: LegacyKeyMigrationState::Unchanged,
            });
        };
        let app_id = AppId::parse(app_id.as_deref().unwrap_or_default())
            .map_err(|error| NookError::Database(error.to_string()))?;
        let wrapped = WrappedDeviceIdentity::parse(&wrapped)?;

        if let Some(existing) = keyring
            .entries()
            .iter()
            .find(|entry| entry.app_id() == &app_id)
        {
            NookDatabase::validate_keyring_directory_binding(
                KeyringDbValidateKeyringDirectoryBinding {
                    keyring: &keyring,
                    directory: directory,
                },
            )?;
            if existing.wrapped_app_key() != &wrapped {
                keyring = keyring
                    .replace_wrapped_app_key(WrappedAppKeyReplacement {
                        app_id: &app_id,
                        wrapped_app_key: wrapped,
                    })
                    .map_err(|rejected| NookError::Database(rejected.into_cause().to_string()))?;
                NookDatabase::write_keyring(KeyringDbWriteKeyring {
                    store: store,
                    keyring: &keyring,
                })
                .await?;
            }
            NookDatabase::delete_legacy_active_key(store).await?;
            return Ok(LegacyKeyMigration {
                keyring,
                state: LegacyKeyMigrationState::Migrated,
            });
        }

        let identity_id = directory
            .identities()
            .iter()
            .find(|identity| identity.has_app_id(&app_id))
            .map(|identity| identity.identity_id.clone());
        let Some(identity_id) = identity_id else {
            if directory.identities().is_empty() {
                return Ok(LegacyKeyMigration {
                    keyring,
                    state: LegacyKeyMigrationState::Unchanged,
                });
            }
            return Err(NookError::Database(
                "Legacy protected app key has no identity owner".to_owned(),
            ));
        };
        keyring = keyring
            .insert(LocalIdentityKeyringEntry::legacy(
                identity_id,
                app_id,
                wrapped,
            ))
            .map_err(|error| NookError::Database(error.to_string()))?;
        NookDatabase::write_keyring(KeyringDbWriteKeyring {
            store: store,
            keyring: &keyring,
        })
        .await?;
        NookDatabase::delete_legacy_active_key(store).await?;
        Ok(LegacyKeyMigration {
            keyring,
            state: LegacyKeyMigrationState::Migrated,
        })
    }
}
