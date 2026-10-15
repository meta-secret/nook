//! Guarded string updates run inside one database transaction.
use super::{ReadStringRecordRequest, StoredStringRecord, TransactionMode};
use crate::IdentityDbLocalKeyringEntryForAppIdFromStore;
use crate::storage::identity_record::StoredIdentityProtection;
use crate::{NookDatabase, NookError};
use nook_core::AppId;

pub(crate) struct IndexedDbUpdate<'a, F> {
    pub(crate) key: &'a str,
    pub(crate) guard: StringUpdateGuard<'a>,
    pub(crate) update: F,
}
/// Named values required by `NookDatabase::guarded_keyring_entry`.
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
    async fn guarded_keyring_entry(
        request: GuardedKeyringEntryRequest<'_>,
    ) -> Result<StringUpdateResult, NookError> {
        let GuardedKeyringEntryRequest { store, guard } = request;
        let (wrapped, expected) = match guard {
            StringUpdateGuard::Unconditional => return Ok(StringUpdateResult::Applied),
            StringUpdateGuard::WrappedCredentialFingerprint(expected) => {
                match NookDatabase::selected_local_keyring_entry_for_store(store).await? {
                    StoredIdentityProtection::Protected(entry) => {
                        (entry.wrapped_app_key().clone(), expected)
                    }
                    StoredIdentityProtection::Unprotected => {
                        return Ok(StringUpdateResult::GuardRejected);
                    }
                }
            }
            StringUpdateGuard::AppWrappedCredentialFingerprint { app_id, expected } => {
                let app_id =
                    AppId::parse(app_id).map_err(|error| NookError::Database(error.to_string()))?;
                match NookDatabase::local_keyring_entry_for_app_id_from_store(
                    IdentityDbLocalKeyringEntryForAppIdFromStore {
                        store,
                        app_id: &app_id,
                    },
                )
                .await?
                {
                    StoredIdentityProtection::Protected(entry) => {
                        (entry.wrapped_app_key().clone(), expected)
                    }
                    StoredIdentityProtection::Unprotected => {
                        return Ok(StringUpdateResult::GuardRejected);
                    }
                }
            }
        };
        let authorized = wrapped.credential_id().is_ok_and(|bytes| {
            nook_core::PasskeyAccessProfile::credential_identifier(bytes.as_ref()) == expected
        });
        Ok(if authorized {
            StringUpdateResult::Applied
        } else {
            StringUpdateResult::GuardRejected
        })
    }
}

impl NookDatabase {
    pub(crate) async fn idb_update_string<F>(
        request: IndexedDbUpdate<'_, F>,
    ) -> Result<StringUpdateResult, NookError>
    where
        F: FnOnce(StoredStringRecord) -> Result<String, NookError>,
    {
        let IndexedDbUpdate { key, guard, update } = request;
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
        let authorization = NookDatabase::guarded_keyring_entry(GuardedKeyringEntryRequest {
            store: &store,
            guard,
        })
        .await?;
        if authorization == StringUpdateResult::GuardRejected {
            transaction.done().await.map_err(|error| {
                NookError::IndexedDb(format!("Atomic string guard completion error: {error:?}"))
            })?;
            return Ok(StringUpdateResult::GuardRejected);
        }
        let id_key = serde_wasm_bindgen::to_value(key).map_err(|error| {
            NookError::IndexedDb(format!("Atomic string update key error: {error:?}"))
        })?;
        let current = NookDatabase::read_string_record(ReadStringRecordRequest {
            store: &store,
            key,
            context: "Atomic string update",
        })
        .await?;
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
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Atomic string update completion error: {error:?}"))
        })?;
        Ok(StringUpdateResult::Applied)
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod tests {
    use super::*;
    use rexie::Rexie;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    async fn atomic_update_writes_and_rejects_an_unparseable_guard()
    -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        assert_eq!(
            NookDatabase::idb_update_string(IndexedDbUpdate {
                key: "current",
                guard: StringUpdateGuard::Unconditional,
                update: |value| match value {
                    StoredStringRecord::Stored(raw) => Ok(format!("{raw}-updated")),
                    StoredStringRecord::MissingKey => Ok("-updated".to_owned()),
                }
            })
            .await?,
            StringUpdateResult::Applied
        );
        assert_eq!(
            NookDatabase::idb_get_string("current").await?,
            StoredStringRecord::Stored(("-updated").to_owned())
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

        NookDatabase::clear_vault_db().await?;
        Ok(())
    }
}
