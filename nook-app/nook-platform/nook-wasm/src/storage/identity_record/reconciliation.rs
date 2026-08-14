use super::super::indexed_db::{
    StringUpdateGuard, StringUpdateResult, idb_get_string, idb_update_string,
};
use crate::{NookError, storage::open_nook_database};

const PENDING_IDENTITY_RECONCILIATION_PREFIX: &str = "pending_identity_reconciliation_v1:";

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingIdentityReconciliation {
    store_id: nook_core::StoreId,
    previous_key_epoch: nook_core::IdentityVaultEventId,
    previous_checkpoint: nook_core::IdentityVaultEventId,
    key_epoch: nook_core::IdentityVaultEventId,
    #[serde(default)]
    checkpoint_state: PendingIdentityReconciliationCheckpoint,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum PendingIdentityReconciliationCheckpoint {
    #[default]
    AwaitingCheckpoint,
    Committed {
        checkpoint: nook_core::IdentityVaultEventId,
    },
}

pub(super) struct IdentityEpochResolution {
    pub(super) update: nook_core::IdentityVaultDekEpochUpdate,
    pub(super) consumed_marker: Option<String>,
}

fn identity_reconciliation_key(store_id: &nook_core::StoreId) -> String {
    format!("{PENDING_IDENTITY_RECONCILIATION_PREFIX}{store_id}")
}

fn decode_pending(raw: &str) -> Result<PendingIdentityReconciliation, NookError> {
    serde_json::from_str(raw).map_err(|error| {
        NookError::IndexedDb(format!(
            "Identity reconciliation marker decode error: {error}"
        ))
    })
}

fn encode_pending(pending: &PendingIdentityReconciliation) -> Result<String, NookError> {
    serde_json::to_string(pending).map_err(|error| {
        NookError::IndexedDb(format!(
            "Identity reconciliation marker encode error: {error}"
        ))
    })
}

pub(crate) async fn mark_identity_reconciliation_pending(
    store_id: &nook_core::StoreId,
    previous_key_epoch: &nook_core::IdentityVaultEventId,
    previous_checkpoint: &nook_core::IdentityVaultEventId,
    key_epoch: &nook_core::IdentityVaultEventId,
) -> Result<(), NookError> {
    let proposed = PendingIdentityReconciliation {
        store_id: store_id.clone(),
        previous_key_epoch: previous_key_epoch.clone(),
        previous_checkpoint: previous_checkpoint.clone(),
        key_epoch: key_epoch.clone(),
        checkpoint_state: PendingIdentityReconciliationCheckpoint::AwaitingCheckpoint,
    };
    let disposition = idb_update_string(
        &identity_reconciliation_key(store_id),
        StringUpdateGuard::Unconditional,
        move |raw| match raw {
            None => encode_pending(&proposed),
            Some(raw) => {
                if decode_pending(&raw)? == proposed {
                    Ok(raw)
                } else {
                    Err(NookError::IndexedDb(
                        "Another security epoch rotation is already pending.".to_owned(),
                    ))
                }
            }
        },
    )
    .await?;
    if disposition != StringUpdateResult::Applied {
        return Err(NookError::IndexedDb(
            "Identity reconciliation intent was rejected.".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) async fn commit_identity_reconciliation_checkpoint(
    store_id: &nook_core::StoreId,
    key_epoch: &nook_core::IdentityVaultEventId,
    checkpoint: &nook_core::IdentityVaultEventId,
) -> Result<(), NookError> {
    let expected_store_id = store_id.clone();
    let expected_key_epoch = key_epoch.clone();
    let committed_checkpoint = checkpoint.clone();
    let disposition = idb_update_string(
        &identity_reconciliation_key(store_id),
        StringUpdateGuard::Unconditional,
        move |raw| {
            let raw = raw.ok_or_else(|| {
                NookError::IndexedDb("Identity reconciliation marker disappeared.".to_owned())
            })?;
            let mut pending = decode_pending(&raw)?;
            if pending.store_id != expected_store_id || pending.key_epoch != expected_key_epoch {
                return Err(NookError::IndexedDb(
                    "Identity reconciliation marker changed before checkpoint commit.".to_owned(),
                ));
            }
            pending.checkpoint_state = PendingIdentityReconciliationCheckpoint::Committed {
                checkpoint: committed_checkpoint.clone(),
            };
            encode_pending(&pending)
        },
    )
    .await?;
    if disposition != StringUpdateResult::Applied {
        return Err(NookError::IndexedDb(
            "Identity reconciliation checkpoint update was rejected.".to_owned(),
        ));
    }
    Ok(())
}

pub(super) async fn resolve_identity_epoch(
    store_id: &nook_core::StoreId,
    observed: nook_core::IdentityVaultDekEpoch,
    committed_event_ids: &[nook_core::IdentityVaultEventId],
) -> Result<IdentityEpochResolution, NookError> {
    let Some(raw) = idb_get_string(&identity_reconciliation_key(store_id)).await? else {
        return Ok(IdentityEpochResolution {
            update: nook_core::IdentityVaultDekEpochUpdate::Observe {
                key_epoch: observed,
            },
            consumed_marker: None,
        });
    };
    let pending = decode_pending(&raw)?;
    if pending.store_id != *store_id {
        return Err(NookError::IndexedDb(
            "Identity reconciliation marker names another vault.".to_owned(),
        ));
    }
    let (observed_epoch, observed_checkpoint) = match &observed {
        nook_core::IdentityVaultDekEpoch::Known {
            key_epoch,
            checkpoint,
        } => (key_epoch, checkpoint),
        nook_core::IdentityVaultDekEpoch::LegacyUnknown => {
            return Err(NookError::IndexedDb(
                "Event-log reconciliation cannot use an unknown epoch.".to_owned(),
            ));
        }
    };
    match &pending.checkpoint_state {
        PendingIdentityReconciliationCheckpoint::AwaitingCheckpoint => {
            if *observed_epoch != pending.previous_key_epoch {
                return Err(NookError::IndexedDb(
                    "Security epoch checkpoint is not committed yet.".to_owned(),
                ));
            }
            Ok(IdentityEpochResolution {
                update: nook_core::IdentityVaultDekEpochUpdate::Observe {
                    key_epoch: observed,
                },
                consumed_marker: Some(raw),
            })
        }
        PendingIdentityReconciliationCheckpoint::Committed { checkpoint } => {
            if pending.key_epoch != *observed_epoch || !committed_event_ids.contains(checkpoint) {
                return Err(NookError::IndexedDb(
                    "Committed security epoch checkpoint is absent from verified history."
                        .to_owned(),
                ));
            }
            Ok(IdentityEpochResolution {
                update: nook_core::IdentityVaultDekEpochUpdate::Rotate {
                    previous_key_epoch: pending.previous_key_epoch,
                    previous_checkpoint: pending.previous_checkpoint,
                    key_epoch: pending.key_epoch,
                    checkpoint: observed_checkpoint.clone(),
                },
                consumed_marker: Some(raw),
            })
        }
    }
}

pub(super) async fn clear_consumed_identity_reconciliation(
    store_id: &nook_core::StoreId,
    consumed_marker: &str,
) -> Result<(), NookError> {
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadWrite)
        .map_err(|error| {
            NookError::IndexedDb(format!("Reconciliation cleanup error: {error:?}"))
        })?;
    let store = transaction.store("vault").map_err(|error| {
        NookError::IndexedDb(format!("Reconciliation cleanup store error: {error:?}"))
    })?;
    let key = identity_reconciliation_key(store_id);
    let id = serde_wasm_bindgen::to_value(&key).map_err(|error| {
        NookError::IndexedDb(format!("Reconciliation cleanup key error: {error:?}"))
    })?;
    let current = store.get(id.clone()).await.map_err(|error| {
        NookError::IndexedDb(format!("Reconciliation cleanup read error: {error:?}"))
    })?;
    if let Some(current) = current.filter(|value| !value.is_undefined() && !value.is_null()) {
        let raw: String = serde_wasm_bindgen::from_value(current).map_err(|error| {
            NookError::IndexedDb(format!("Reconciliation cleanup decode error: {error:?}"))
        })?;
        if raw == consumed_marker {
            store.delete(id).await.map_err(|error| {
                NookError::IndexedDb(format!("Reconciliation cleanup delete error: {error:?}"))
            })?;
        }
    }
    transaction.done().await.map(|_| ()).map_err(|error| {
        NookError::IndexedDb(format!(
            "Reconciliation cleanup completion error: {error:?}"
        ))
    })
}

#[cfg(all(test, target_arch = "wasm32"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    fn event_id(fill: char) -> Result<nook_core::IdentityVaultEventId, NookError> {
        nook_core::IdentityVaultEventId::parse(&format!("sha256u:{}", fill.to_string().repeat(43)))
            .map_err(|error| NookError::Database(error.to_string()))
    }

    fn store_id() -> Result<nook_core::StoreId, NookError> {
        nook_core::StoreId::parse("store_abcdefghijk")
            .map_err(|error| NookError::Database(error.to_string()))
    }

    #[wasm_bindgen_test]
    async fn awaiting_checkpoint_blocks_an_advanced_epoch() -> Result<(), NookError> {
        let store_id = store_id()?;
        let previous_epoch = event_id('a')?;
        let key_epoch = event_id('c')?;
        mark_identity_reconciliation_pending(
            &store_id,
            &previous_epoch,
            &event_id('b')?,
            &key_epoch,
        )
        .await?;
        let result = resolve_identity_epoch(
            &store_id,
            nook_core::IdentityVaultDekEpoch::Known {
                key_epoch,
                checkpoint: event_id('d')?,
            },
            &[],
        )
        .await;
        assert!(result.is_err());
        super::super::super::indexed_db::idb_delete_key(&identity_reconciliation_key(&store_id))
            .await
    }

    #[wasm_bindgen_test]
    async fn committed_checkpoint_reconciles_through_an_advanced_head() -> Result<(), NookError> {
        let store_id = store_id()?;
        let previous_epoch = event_id('a')?;
        let previous_checkpoint = event_id('b')?;
        let key_epoch = event_id('c')?;
        let checkpoint = event_id('d')?;
        let advanced_head = event_id('e')?;
        mark_identity_reconciliation_pending(
            &store_id,
            &previous_epoch,
            &previous_checkpoint,
            &key_epoch,
        )
        .await?;
        commit_identity_reconciliation_checkpoint(&store_id, &key_epoch, &checkpoint).await?;
        let resolution = resolve_identity_epoch(
            &store_id,
            nook_core::IdentityVaultDekEpoch::Known {
                key_epoch,
                checkpoint: advanced_head.clone(),
            },
            std::slice::from_ref(&checkpoint),
        )
        .await?;
        assert!(matches!(
            resolution.update,
            nook_core::IdentityVaultDekEpochUpdate::Rotate {
                checkpoint: resolved,
                ..
            } if resolved == advanced_head
        ));
        clear_consumed_identity_reconciliation(
            &store_id,
            resolution.consumed_marker.as_deref().unwrap_or_default(),
        )
        .await
    }

    #[wasm_bindgen_test]
    async fn cleanup_preserves_a_successor_marker() -> Result<(), NookError> {
        let store_id = store_id()?;
        let key = identity_reconciliation_key(&store_id);
        let first_epoch = event_id('c')?;
        let checkpoint = event_id('d')?;
        mark_identity_reconciliation_pending(
            &store_id,
            &event_id('a')?,
            &event_id('b')?,
            &first_epoch,
        )
        .await?;
        commit_identity_reconciliation_checkpoint(&store_id, &first_epoch, &checkpoint).await?;
        let resolution = resolve_identity_epoch(
            &store_id,
            nook_core::IdentityVaultDekEpoch::Known {
                key_epoch: first_epoch,
                checkpoint: checkpoint.clone(),
            },
            std::slice::from_ref(&checkpoint),
        )
        .await?;
        let consumed = resolution.consumed_marker.ok_or_else(|| {
            NookError::IndexedDb("Committed marker was not selected for cleanup.".to_owned())
        })?;
        let successor = PendingIdentityReconciliation {
            store_id: store_id.clone(),
            previous_key_epoch: event_id('e')?,
            previous_checkpoint: event_id('f')?,
            key_epoch: event_id('g')?,
            checkpoint_state: PendingIdentityReconciliationCheckpoint::AwaitingCheckpoint,
        };
        let successor_raw = encode_pending(&successor)?;
        super::super::super::indexed_db::idb_put_string(&key, &successor_raw).await?;

        clear_consumed_identity_reconciliation(&store_id, &consumed).await?;

        let preserved = super::super::super::indexed_db::idb_get_string(&key)
            .await?
            .ok_or_else(|| {
                NookError::IndexedDb("Successor reconciliation marker disappeared.".to_owned())
            })?;
        assert_eq!(preserved, successor_raw);
        super::super::super::indexed_db::idb_delete_key(&key).await
    }
}
