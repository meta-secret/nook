use super::super::indexed_db::{
    StringUpdateGuard, StringUpdateResult, idb_get_string, idb_update_string,
};
use crate::{NookError, storage::open_nook_database};

const PENDING_IDENTITY_RECONCILIATION_PREFIX: &str = "pending_identity_reconciliation_v2:";
const LEGACY_IDENTITY_RECONCILIATION_PREFIX: &str = "pending_identity_reconciliation_v1:";

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingIdentityReconciliation {
    store_id: nook_core::StoreId,
    previous_key_epoch: nook_core::IdentityVaultEventId,
    previous_checkpoint: nook_core::IdentityVaultEventId,
    progress: PendingIdentityReconciliationProgress,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum PendingIdentityReconciliationProgress {
    Prepared {
        plan_envelope: nook_core::AgeArmoredCiphertext,
    },
    EpochCommitted {
        key_epoch: nook_core::IdentityVaultEventId,
        plan_envelope: nook_core::AgeArmoredCiphertext,
    },
    Committed {
        key_epoch: nook_core::IdentityVaultEventId,
        checkpoint: nook_core::IdentityVaultEventId,
    },
}

pub(crate) struct PendingIdentityRotation {
    pub(crate) plan_envelope: nook_core::AgeArmoredCiphertext,
    pub(crate) key_epoch: Option<nook_core::IdentityVaultEventId>,
}

pub(super) struct IdentityEpochResolution {
    pub(super) update: nook_core::IdentityVaultDekEpochUpdate,
    pub(super) consumed_marker: Option<String>,
}

fn identity_reconciliation_key(store_id: &nook_core::StoreId) -> String {
    format!("{PENDING_IDENTITY_RECONCILIATION_PREFIX}{store_id}")
}

pub(super) async fn clear_pending_identity_reconciliation_for_recovery(
    store_ids: &[nook_core::StoreId],
) -> Result<(), NookError> {
    for store_id in store_ids {
        super::super::indexed_db::idb_delete_key(&identity_reconciliation_key(store_id)).await?;
        super::super::indexed_db::idb_delete_key(&format!(
            "{LEGACY_IDENTITY_RECONCILIATION_PREFIX}{store_id}"
        ))
        .await?;
    }
    Ok(())
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
    plan_envelope: nook_core::AgeArmoredCiphertext,
) -> Result<(), NookError> {
    let proposed = PendingIdentityReconciliation {
        store_id: store_id.clone(),
        previous_key_epoch: previous_key_epoch.clone(),
        previous_checkpoint: previous_checkpoint.clone(),
        progress: PendingIdentityReconciliationProgress::Prepared { plan_envelope },
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

pub(crate) async fn load_pending_identity_rotation(
    store_id: &nook_core::StoreId,
) -> Result<Option<PendingIdentityRotation>, NookError> {
    let Some(raw) = idb_get_string(&identity_reconciliation_key(store_id)).await? else {
        return Ok(None);
    };
    let pending = decode_pending(&raw)?;
    if pending.store_id != *store_id {
        return Err(NookError::IndexedDb(
            "Identity reconciliation marker names another vault.".to_owned(),
        ));
    }
    Ok(match pending.progress {
        PendingIdentityReconciliationProgress::Prepared { plan_envelope } => {
            Some(PendingIdentityRotation {
                plan_envelope,
                key_epoch: None,
            })
        }
        PendingIdentityReconciliationProgress::EpochCommitted {
            key_epoch,
            plan_envelope,
        } => Some(PendingIdentityRotation {
            plan_envelope,
            key_epoch: Some(key_epoch),
        }),
        PendingIdentityReconciliationProgress::Committed { .. } => None,
    })
}

pub(crate) async fn commit_identity_reconciliation_epoch(
    store_id: &nook_core::StoreId,
    key_epoch: &nook_core::IdentityVaultEventId,
) -> Result<(), NookError> {
    let expected_store_id = store_id.clone();
    let expected_key_epoch = key_epoch.clone();
    let disposition = idb_update_string(
        &identity_reconciliation_key(store_id),
        StringUpdateGuard::Unconditional,
        move |raw| {
            let raw = raw.ok_or_else(|| {
                NookError::IndexedDb("Identity reconciliation marker disappeared.".to_owned())
            })?;
            let mut pending = decode_pending(&raw)?;
            if pending.store_id != expected_store_id {
                return Err(NookError::IndexedDb(
                    "Identity reconciliation marker changed before epoch commit.".to_owned(),
                ));
            }
            pending.progress = match pending.progress {
                PendingIdentityReconciliationProgress::Prepared { plan_envelope } => {
                    PendingIdentityReconciliationProgress::EpochCommitted {
                        key_epoch: expected_key_epoch.clone(),
                        plan_envelope,
                    }
                }
                PendingIdentityReconciliationProgress::EpochCommitted {
                    key_epoch,
                    plan_envelope,
                } if key_epoch == expected_key_epoch => {
                    PendingIdentityReconciliationProgress::EpochCommitted {
                        key_epoch,
                        plan_envelope,
                    }
                }
                _ => {
                    return Err(NookError::IndexedDb(
                        "Identity reconciliation epoch changed unexpectedly.".to_owned(),
                    ));
                }
            };
            encode_pending(&pending)
        },
    )
    .await?;
    if disposition != StringUpdateResult::Applied {
        return Err(NookError::IndexedDb(
            "Identity reconciliation epoch update was rejected.".to_owned(),
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
            if pending.store_id != expected_store_id {
                return Err(NookError::IndexedDb(
                    "Identity reconciliation marker changed before checkpoint commit.".to_owned(),
                ));
            }
            pending.progress = match pending.progress {
                PendingIdentityReconciliationProgress::EpochCommitted { key_epoch, .. }
                    if key_epoch == expected_key_epoch =>
                {
                    PendingIdentityReconciliationProgress::Committed {
                        key_epoch,
                        checkpoint: committed_checkpoint.clone(),
                    }
                }
                PendingIdentityReconciliationProgress::Committed {
                    key_epoch,
                    checkpoint,
                } if key_epoch == expected_key_epoch && checkpoint == committed_checkpoint => {
                    PendingIdentityReconciliationProgress::Committed {
                        key_epoch,
                        checkpoint,
                    }
                }
                _ => {
                    return Err(NookError::IndexedDb(
                        "Identity reconciliation checkpoint changed unexpectedly.".to_owned(),
                    ));
                }
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
    checkpoint_ancestors: &[nook_core::IdentityVaultEventId],
) -> Result<IdentityEpochResolution, NookError> {
    let Some(raw) = idb_get_string(&identity_reconciliation_key(store_id)).await? else {
        return Ok(IdentityEpochResolution {
            update: nook_core::IdentityVaultDekEpochUpdate::Observe {
                key_epoch: observed,
                checkpoint_ancestors: checkpoint_ancestors.to_vec(),
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
    match &pending.progress {
        PendingIdentityReconciliationProgress::Prepared { .. }
        | PendingIdentityReconciliationProgress::EpochCommitted { .. } => {
            Err(NookError::IndexedDb(
                "Security epoch rotation must resume before identity reconciliation.".to_owned(),
            ))
        }
        PendingIdentityReconciliationProgress::Committed {
            key_epoch,
            checkpoint,
        } => {
            if key_epoch != observed_epoch
                || !committed_event_ids.contains(checkpoint)
                || (checkpoint != observed_checkpoint && !checkpoint_ancestors.contains(checkpoint))
            {
                return Err(NookError::IndexedDb(
                    "Committed security epoch checkpoint is absent from verified history."
                        .to_owned(),
                ));
            }
            Ok(IdentityEpochResolution {
                update: nook_core::IdentityVaultDekEpochUpdate::Rotate {
                    previous_key_epoch: pending.previous_key_epoch,
                    previous_checkpoint: pending.previous_checkpoint,
                    key_epoch: key_epoch.clone(),
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

    fn plan_envelope() -> Result<nook_core::AgeArmoredCiphertext, NookError> {
        nook_core::AppKey::generate()?
            .seal_utf8("rotation-plan")
            .map_err(NookError::from)
    }

    #[wasm_bindgen_test]
    async fn awaiting_checkpoint_blocks_an_advanced_epoch() -> Result<(), NookError> {
        let store_id = store_id()?;
        let previous_epoch = event_id('a')?;
        let key_epoch = event_id('c')?;
        let plan_envelope = plan_envelope()?;
        mark_identity_reconciliation_pending(
            &store_id,
            &previous_epoch,
            &event_id('b')?,
            plan_envelope.clone(),
        )
        .await?;
        let prepared = load_pending_identity_rotation(&store_id)
            .await?
            .ok_or_else(|| NookError::IndexedDb("Prepared rotation disappeared.".to_owned()))?;
        assert_eq!(prepared.plan_envelope, plan_envelope);
        assert_eq!(prepared.key_epoch, None);
        commit_identity_reconciliation_epoch(&store_id, &key_epoch).await?;
        let committed = load_pending_identity_rotation(&store_id)
            .await?
            .ok_or_else(|| NookError::IndexedDb("Committed epoch disappeared.".to_owned()))?;
        assert_eq!(committed.key_epoch, Some(key_epoch.clone()));
        let result = resolve_identity_epoch(
            &store_id,
            nook_core::IdentityVaultDekEpoch::Known {
                key_epoch,
                checkpoint: event_id('d')?,
            },
            &[],
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
            plan_envelope()?,
        )
        .await?;
        commit_identity_reconciliation_epoch(&store_id, &key_epoch).await?;
        commit_identity_reconciliation_checkpoint(&store_id, &key_epoch, &checkpoint).await?;
        let resolution = resolve_identity_epoch(
            &store_id,
            nook_core::IdentityVaultDekEpoch::Known {
                key_epoch,
                checkpoint: advanced_head.clone(),
            },
            std::slice::from_ref(&checkpoint),
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
            plan_envelope()?,
        )
        .await?;
        commit_identity_reconciliation_epoch(&store_id, &first_epoch).await?;
        commit_identity_reconciliation_checkpoint(&store_id, &first_epoch, &checkpoint).await?;
        let resolution = resolve_identity_epoch(
            &store_id,
            nook_core::IdentityVaultDekEpoch::Known {
                key_epoch: first_epoch,
                checkpoint: checkpoint.clone(),
            },
            std::slice::from_ref(&checkpoint),
            &[],
        )
        .await?;
        let consumed = resolution.consumed_marker.ok_or_else(|| {
            NookError::IndexedDb("Committed marker was not selected for cleanup.".to_owned())
        })?;
        let successor = PendingIdentityReconciliation {
            store_id: store_id.clone(),
            previous_key_epoch: event_id('e')?,
            previous_checkpoint: event_id('f')?,
            progress: PendingIdentityReconciliationProgress::Prepared {
                plan_envelope: plan_envelope()?,
            },
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
