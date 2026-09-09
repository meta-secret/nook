//! Guarded updates and conditional migrations share one database transaction.
use super::{ReadOptionalStringFromStoreRequest, TransactionMode, identity_record};
use crate::IdentityDbLocalKeyringEntryForAppIdFromStore;
use crate::ReadStringPreferringRequest;
use crate::{NookDatabase, NookError};
use nook_core::{AppId, WrappedDeviceIdentity};

pub(crate) struct IndexedDbMigration<'a, F> {
    pub(crate) source_key: &'a str,
    pub(crate) target_key: &'a str,
    pub(crate) can_migrate: F,
}
pub(crate) struct IndexedDbFallbackUpdate<'a, F, P> {
    pub(crate) key: &'a str,
    pub(crate) fallback_key: Option<&'a str>,
    pub(crate) guard: StringUpdateGuard<'a>,
    pub(crate) can_adopt_fallback: P,
    pub(crate) update: F,
}
pub(crate) struct IndexedDbUpdate<'a, F> {
    pub(crate) key: &'a str,
    pub(crate) guard: StringUpdateGuard<'a>,
    pub(crate) update: F,
}
/// Named values required by NookDatabase::guarded_keyring_entry.
pub(crate) struct GuardedKeyringEntryRequest<'a> {
    pub(crate) store: &'a rexie::Store,
    pub(crate) guard: StringUpdateGuard<'a>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum StringUpdateGuard<'a> {
    Unconditional,
    WrappedCredentialFingerprint(&'a str),
    AppWrappedCredentialFingerprint { app_id: &'a str, expected: &'a str },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum StringUpdateResult {
    Applied,
    GuardRejected,
}

impl NookDatabase {
    pub(crate) async fn idb_update_string<F>(
        request: IndexedDbUpdate<'_, F>,
    ) -> Result<StringUpdateResult, NookError>
    where
        F: FnOnce(Option<String>) -> Result<String, NookError>,
    {
        let IndexedDbUpdate { key, guard, update } = request;
        NookDatabase::idb_update_string_with_fallback(IndexedDbFallbackUpdate {
            key: key,
            fallback_key: None,
            guard: guard,
            can_adopt_fallback: |_| true,
            update: update,
        })
        .await
    }
}

impl NookDatabase {
    async fn guarded_keyring_entry(
        request: GuardedKeyringEntryRequest<'_>,
    ) -> Result<(Option<nook_core::LocalIdentityKeyringEntry>, bool), NookError> {
        let GuardedKeyringEntryRequest { store, guard } = request;
        match guard {
            StringUpdateGuard::WrappedCredentialFingerprint(_) => Ok((
                NookDatabase::selected_local_keyring_entry_for_store(store).await?,
                true,
            )),
            StringUpdateGuard::AppWrappedCredentialFingerprint { app_id, .. } => {
                let app_id =
                    AppId::parse(app_id).map_err(|error| NookError::Database(error.to_string()))?;
                Ok((
                    NookDatabase::local_keyring_entry_for_app_id_from_store(
                        IdentityDbLocalKeyringEntryForAppIdFromStore {
                            store: store,
                            app_id: &app_id,
                        },
                    )
                    .await?,
                    false,
                ))
            }
            StringUpdateGuard::Unconditional => Ok((None, false)),
        }
    }
}

impl NookDatabase {
    pub(crate) async fn idb_update_string_with_fallback<F, P>(
        request: IndexedDbFallbackUpdate<'_, F, P>,
    ) -> Result<StringUpdateResult, NookError>
    where
        F: FnOnce(Option<String>) -> Result<String, NookError>,
        P: FnOnce(&str) -> bool,
    {
        let IndexedDbFallbackUpdate {
            key,
            fallback_key,
            guard,
            can_adopt_fallback,
            update,
        } = request;
        let rexie = NookDatabase::open_nook_database().await?;
        // IndexedDB serializes read-write transactions that overlap one object
        // store. Keeping both operations in this transaction prevents two tabs
        // from reading the same profile and later overwriting each other's update.
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| {
                NookError::IndexedDb(format!("Atomic string update transaction error: {error:?}"))
            })?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Atomic string update store error: {error:?}"))
        })?;
        let (guarded_entry, allow_legacy_guard) =
            NookDatabase::guarded_keyring_entry(GuardedKeyringEntryRequest {
                store: &store,
                guard: guard,
            })
            .await?;
        let expected_fingerprint = match guard {
            StringUpdateGuard::WrappedCredentialFingerprint(expected)
            | StringUpdateGuard::AppWrappedCredentialFingerprint { expected, .. } => Some(expected),
            StringUpdateGuard::Unconditional => None,
        };
        if let Some(expected) = expected_fingerprint {
            let fingerprint = match guarded_entry {
                Some(entry) => entry.wrapped_app_key().credential_id().ok().map(|bytes| {
                    nook_core::PasskeyAccessProfile::credential_identifier(bytes.as_ref())
                }),
                None if allow_legacy_guard => {
                    NookDatabase::read_string_preferring(ReadStringPreferringRequest {
                        store: &store,
                        preferred_key: APP_KEY_WRAPPED_KEY,
                        legacy_key: WRAPPED_DEVICE_IDENTITY_KEY,
                        label: "Atomic string guard",
                    })
                    .await?
                    .and_then(|raw| {
                        let wrapped = WrappedDeviceIdentity::parse(&raw).ok()?;
                        wrapped.credential_id().ok().map(|bytes| {
                            nook_core::PasskeyAccessProfile::credential_identifier(bytes.as_ref())
                        })
                    })
                }
                None => None,
            };
            if fingerprint.as_deref() != Some(expected) {
                transaction.done().await.map_err(|error| {
                    NookError::IndexedDb(format!("Atomic string guard completion error: {error:?}"))
                })?;
                return Ok(StringUpdateResult::GuardRejected);
            }
        }
        let id_key = serde_wasm_bindgen::to_value(key).map_err(|error| {
            NookError::IndexedDb(format!("Atomic string update key error: {error:?}"))
        })?;
        let mut current =
            NookDatabase::read_optional_string_from_store(ReadOptionalStringFromStoreRequest {
                store: &store,
                key: key,
                context: "Atomic string update",
            })
            .await?;
        let mut adopted_fallback_key = None;
        if current.is_none()
            && let Some(fallback_key) = fallback_key
        {
            let fallback =
                NookDatabase::read_optional_string_from_store(ReadOptionalStringFromStoreRequest {
                    store: &store,
                    key: fallback_key,
                    context: "Atomic string fallback",
                })
                .await?;
            if fallback.as_deref().is_some_and(can_adopt_fallback) {
                current = fallback;
                adopted_fallback_key = Some(fallback_key);
            }
        }
        let updated = update(current)?;
        let updated_value = serde_wasm_bindgen::to_value(&updated).map_err(|error| {
            NookError::IndexedDb(format!("Atomic string update encode error: {error:?}"))
        })?;
        store
            .put(&updated_value, Some(&id_key))
            .await
            .map_err(|error| {
                NookError::IndexedDb(format!("Atomic string update write error: {error:?}"))
            })?;
        if let Some(fallback_key) = adopted_fallback_key {
            let fallback_id = serde_wasm_bindgen::to_value(fallback_key).map_err(|error| {
                NookError::IndexedDb(format!("Atomic string fallback key error: {error:?}"))
            })?;
            store.delete(fallback_id).await.map_err(|error| {
                NookError::IndexedDb(format!("Atomic string fallback delete error: {error:?}"))
            })?;
        }
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Atomic string update completion error: {error:?}"))
        })?;
        Ok(StringUpdateResult::Applied)
    }
}

impl NookDatabase {
    pub(crate) async fn idb_migrate_string_if<F>(
        request: IndexedDbMigration<'_, F>,
    ) -> Result<(), NookError>
    where
        F: FnOnce(&str) -> bool,
    {
        let IndexedDbMigration {
            source_key,
            target_key,
            can_migrate,
        } = request;
        let rexie = NookDatabase::open_nook_database().await?;
        // The ownership check, conditional copy, and source deletion share one
        // read-write transaction. IndexedDB therefore serializes this migration
        // with profile updates from every tab that touches the vault store.
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| {
                NookError::IndexedDb(format!(
                    "Atomic string migration transaction error: {error:?}"
                ))
            })?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Atomic string migration store error: {error:?}"))
        })?;
        let source_id = serde_wasm_bindgen::to_value(source_key).map_err(|error| {
            NookError::IndexedDb(format!(
                "Atomic string migration source key error: {error:?}"
            ))
        })?;
        let source = store.get(source_id.clone()).await.map_err(|error| {
            NookError::IndexedDb(format!(
                "Atomic string migration source read error: {error:?}"
            ))
        })?;
        let Some(source) = source.filter(|value| !value.is_undefined() && !value.is_null()) else {
            transaction.done().await.map_err(|error| {
                NookError::IndexedDb(format!(
                    "Atomic string migration completion error: {error:?}"
                ))
            })?;
            return Ok(());
        };
        let source_text: String =
            serde_wasm_bindgen::from_value(source.clone()).map_err(|error| {
                NookError::IndexedDb(format!("Atomic string migration decode error: {error:?}"))
            })?;
        if !can_migrate(&source_text) {
            transaction.done().await.map_err(|error| {
                NookError::IndexedDb(format!(
                    "Atomic string migration completion error: {error:?}"
                ))
            })?;
            return Ok(());
        }
        let target_id = serde_wasm_bindgen::to_value(target_key).map_err(|error| {
            NookError::IndexedDb(format!(
                "Atomic string migration target key error: {error:?}"
            ))
        })?;
        let target = store.get(target_id.clone()).await.map_err(|error| {
            NookError::IndexedDb(format!(
                "Atomic string migration target read error: {error:?}"
            ))
        })?;
        if let Some(target) = target.filter(|value| !value.is_undefined() && !value.is_null()) {
            let target_text: String = serde_wasm_bindgen::from_value(target).map_err(|error| {
                NookError::IndexedDb(format!(
                    "Atomic string migration target decode error: {error:?}"
                ))
            })?;
            if target_text != source_text {
                transaction.done().await.map_err(|error| {
                    NookError::IndexedDb(format!(
                        "Atomic string migration completion error: {error:?}"
                    ))
                })?;
                return Err(NookError::Database(
                    "Legacy and identity-scoped records conflict; both records were preserved"
                        .to_owned(),
                ));
            }
        } else {
            store
                .put(&source, Some(&target_id))
                .await
                .map_err(|error| {
                    NookError::IndexedDb(format!("Atomic string migration write error: {error:?}"))
                })?;
        }
        store.delete(source_id).await.map_err(|error| {
            NookError::IndexedDb(format!("Atomic string migration delete error: {error:?}"))
        })?;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!(
                "Atomic string migration completion error: {error:?}"
            ))
        })?;
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod tests {
    use super::super::{IdbPutStringRequest, ReadStringPreferringRequest};
    use super::*;
    use rexie::Rexie;
    use wasm_bindgen_test::wasm_bindgen_test;
    #[wasm_bindgen_test]
    async fn atomic_string_migration_preserves_conflicting_records()
    -> Result<(), wasm_bindgen::JsError> {
        const SOURCE_KEY: &str = "test-legacy-profile-conflict";
        const TARGET_KEY: &str = "test-scoped-profile-conflict";
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: SOURCE_KEY,
            value: "legacy-value",
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: TARGET_KEY,
            value: "scoped-value",
        })
        .await?;

        let result = NookDatabase::idb_migrate_string_if(IndexedDbMigration {
            source_key: SOURCE_KEY,
            target_key: TARGET_KEY,
            can_migrate: |_| true,
        })
        .await;

        assert!(result.is_err());
        assert_eq!(
            NookDatabase::idb_get_string(SOURCE_KEY).await?.as_deref(),
            Some("legacy-value")
        );
        assert_eq!(
            NookDatabase::idb_get_string(TARGET_KEY).await?.as_deref(),
            Some("scoped-value")
        );
        NookDatabase::idb_delete_keys(&[SOURCE_KEY, TARGET_KEY]).await?;
        Ok(())
    }
    #[wasm_bindgen_test]
    async fn atomic_update_adopts_and_removes_legacy_fallback() -> Result<(), wasm_bindgen::JsError>
    {
        const SOURCE_KEY: &str = "test-legacy-profile-adoption";
        const TARGET_KEY: &str = "test-scoped-profile-adoption";
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: SOURCE_KEY,
            value: "legacy-value",
        })
        .await?;
        NookDatabase::idb_delete_key(TARGET_KEY).await?;

        let result = NookDatabase::idb_update_string_with_fallback(IndexedDbFallbackUpdate {
            key: TARGET_KEY,
            fallback_key: Some(SOURCE_KEY),
            guard: StringUpdateGuard::Unconditional,
            can_adopt_fallback: |_| true,
            update: |current| Ok(format!("{}-updated", current.unwrap_or_default())),
        })
        .await?;

        assert_eq!(result, StringUpdateResult::Applied);
        assert!(NookDatabase::idb_get_string(SOURCE_KEY).await?.is_none());
        assert_eq!(
            NookDatabase::idb_get_string(TARGET_KEY).await?.as_deref(),
            Some("legacy-value-updated")
        );
        NookDatabase::idb_delete_key(TARGET_KEY).await?;
        Ok(())
    }
    #[wasm_bindgen_test]
    async fn atomic_update_and_migration_noop_paths_are_explicit()
    -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        assert_eq!(
            NookDatabase::idb_update_string(IndexedDbUpdate {
                key: "current",
                guard: StringUpdateGuard::Unconditional,
                update: |value| { Ok(format!("{}-updated", value.unwrap_or_default())) }
            })
            .await?,
            StringUpdateResult::Applied
        );
        assert_eq!(
            NookDatabase::idb_get_string("current").await?.as_deref(),
            Some("-updated")
        );

        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: "fallback",
            value: "legacy",
        })
        .await?;
        assert_eq!(
            NookDatabase::idb_update_string_with_fallback(IndexedDbFallbackUpdate {
                key: "target",
                fallback_key: Some("fallback"),
                guard: StringUpdateGuard::Unconditional,
                can_adopt_fallback: |_| false,
                update: |value| Ok(value.unwrap_or_else(|| "fresh".to_owned()))
            })
            .await?,
            StringUpdateResult::Applied
        );
        assert_eq!(
            NookDatabase::idb_get_string("target").await?.as_deref(),
            Some("fresh")
        );
        assert_eq!(
            NookDatabase::idb_get_string("fallback").await?.as_deref(),
            Some("legacy")
        );

        NookDatabase::idb_migrate_string_if(IndexedDbMigration {
            source_key: "missing-source",
            target_key: "missing-target",
            can_migrate: |_| true,
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: "blocked-source",
            value: "legacy",
        })
        .await?;
        NookDatabase::idb_migrate_string_if(IndexedDbMigration {
            source_key: "blocked-source",
            target_key: "blocked-target",
            can_migrate: |_| false,
        })
        .await?;
        assert_eq!(
            NookDatabase::idb_get_string("blocked-source")
                .await?
                .as_deref(),
            Some("legacy")
        );

        let bad_guard = NookDatabase::idb_update_string(IndexedDbUpdate {
            key: "guarded",
            guard: StringUpdateGuard::AppWrappedCredentialFingerprint {
                app_id: "not-an-app-id",
                expected: "fingerprint",
            },
            update: |_| Ok("should-not-write".to_owned()),
        })
        .await;
        assert!(bad_guard.is_err());

        let database = NookDatabase::open_nook_database().await?;
        let transaction = database
            .transaction(&["vault"], TransactionMode::ReadOnly)
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        let store = transaction
            .store("vault")
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        assert_eq!(
            NookDatabase::read_string_preferring(ReadStringPreferringRequest {
                store: &store,
                preferred_key: "missing-preferred",
                legacy_key: "fallback",
                label: "legacy"
            })
            .await?,
            Some("legacy".to_owned())
        );
        transaction
            .done()
            .await
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        NookDatabase::clear_vault_db().await?;
        Ok(())
    }
}
