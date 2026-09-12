#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Vault-scoped reconciliation marker persistence and guarded cleanup.
use super::super::indexed_db;
use crate::NookError;
use crate::StoredStringRecord;
use crate::{IndexedDbUpdate, NookDatabase};
use indexed_db::{StringUpdateGuard, StringUpdateResult};
use nook_core::{AgeArmoredCiphertext, IdentityVaultEventId, StoreId};
use rexie::TransactionMode;
mod progress;
mod resolution;
use progress::{
    PendingIdentityReconciliation, PendingIdentityReconciliationProgress, ReconciliationUpdate,
};
#[cfg(all(test, target_arch = "wasm32"))]
use resolution::EpochObservation;
pub(crate) enum VerifiedPreviousEpoch {
    Unverified,
    Verified(IdentityVaultEventId),
}
const PENDING_IDENTITY_RECONCILIATION_PREFIX: &str = "pending_identity_reconciliation_v2:";
const LEGACY_IDENTITY_RECONCILIATION_PREFIX: &str = "pending_identity_reconciliation_v1:";

pub(crate) enum PendingIdentityRotation {
    Complete,
    Prepared {
        plan_envelope: AgeArmoredCiphertext,
    },
    EpochCommitted {
        key_epoch: IdentityVaultEventId,
        plan_envelope: AgeArmoredCiphertext,
    },
}

pub(crate) struct IdentityReconciliationStore<'a> {
    store_id: &'a StoreId,
}
pub(crate) struct ReconciliationIntent<'a> {
    pub(crate) previous_key_epoch: &'a IdentityVaultEventId,
    pub(crate) previous_checkpoint: &'a IdentityVaultEventId,
    pub(crate) plan_envelope: AgeArmoredCiphertext,
}
/// Returned only after the epoch marker update succeeds; checkpoint completion
/// consumes this continuation and still rechecks the durable marker.
///
/// ```compile_fail,E0603
/// use nook_wasm::storage::identity_record::reconciliation::EpochCommittedReconciliation;
/// ```
pub(crate) struct EpochCommittedReconciliation<'a> {
    store: IdentityReconciliationStore<'a>,
    key_epoch: IdentityVaultEventId,
}
impl<'a> IdentityReconciliationStore<'a> {
    #[must_use]
    pub(crate) fn new(store_id: &'a StoreId) -> Self {
        Self { store_id }
    }
    #[must_use]
    pub(super) fn matches_key(key: &str) -> bool {
        key.starts_with(PENDING_IDENTITY_RECONCILIATION_PREFIX)
            || key.starts_with(LEGACY_IDENTITY_RECONCILIATION_PREFIX)
    }
    fn key(&self) -> String {
        let store_id = self.store_id;
        format!("{PENDING_IDENTITY_RECONCILIATION_PREFIX}{store_id}")
    }
    pub(crate) async fn mark(&self, input: ReconciliationIntent<'_>) -> Result<(), NookError> {
        let store_id = self.store_id;
        let ReconciliationIntent {
            previous_key_epoch,
            previous_checkpoint,
            plan_envelope,
        } = input;

        let proposed = PendingIdentityReconciliation {
            store_id: store_id.clone(),
            previous_key_epoch: previous_key_epoch.clone(),
            previous_checkpoint: previous_checkpoint.clone(),
            progress: PendingIdentityReconciliationProgress::Prepared { plan_envelope },
        };
        let disposition = NookDatabase::idb_update_string(IndexedDbUpdate {
            key: &IdentityReconciliationStore::new(store_id).key(),
            guard: StringUpdateGuard::Unconditional,
            update: move |raw| match raw {
                StoredStringRecord::MissingKey => proposed.encode(),
                StoredStringRecord::Stored(raw) => {
                    if PendingIdentityReconciliation::decode(&raw)? == proposed {
                        Ok(raw)
                    } else {
                        Err(NookError::IndexedDb(
                            "Another security epoch rotation is already pending.".to_owned(),
                        ))
                    }
                }
            },
        })
        .await?;
        if disposition != StringUpdateResult::Applied {
            return Err(NookError::IndexedDb(
                "Identity reconciliation intent was rejected.".to_owned(),
            ));
        }
        Ok(())
    }
    pub(crate) async fn load(&self) -> Result<PendingIdentityRotation, NookError> {
        let store_id = self.store_id;

        let StoredStringRecord::Stored(raw) =
            NookDatabase::idb_get_string(&IdentityReconciliationStore::new(store_id).key()).await?
        else {
            return Ok(PendingIdentityRotation::Complete);
        };
        let pending = PendingIdentityReconciliation::decode(&raw)?;
        if pending.store_id != *store_id {
            return Err(NookError::IndexedDb(
                "Identity reconciliation marker names another vault.".to_owned(),
            ));
        }
        Ok(match pending.progress {
            PendingIdentityReconciliationProgress::Prepared { plan_envelope } => {
                PendingIdentityRotation::Prepared { plan_envelope }
            }
            PendingIdentityReconciliationProgress::EpochCommitted {
                key_epoch,
                plan_envelope,
            } => PendingIdentityRotation::EpochCommitted {
                plan_envelope,
                key_epoch,
            },
            PendingIdentityReconciliationProgress::Committed { .. } => {
                PendingIdentityRotation::Complete
            }
        })
    }
    pub(crate) async fn abort(
        &self,
        expected_plan_envelope: &AgeArmoredCiphertext,
    ) -> Result<(), NookError> {
        let store_id = self.store_id;

        self.delete_if(|raw| {
            let pending = PendingIdentityReconciliation::decode(raw)?;
            Ok(pending.store_id == *store_id
                && matches!(
                    pending.progress,
                    PendingIdentityReconciliationProgress::Prepared { ref plan_envelope }
                        if plan_envelope == expected_plan_envelope
                ))
        })
        .await
    }
    async fn delete_if<F>(&self, predicate: F) -> Result<(), NookError>
    where
        F: FnOnce(&str) -> Result<bool, NookError>,
    {
        let store_id = self.store_id;

        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| {
                NookError::IndexedDb(format!("Reconciliation cleanup error: {error:?}"))
            })?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Reconciliation cleanup store error: {error:?}"))
        })?;
        let key = IdentityReconciliationStore::new(store_id).key();
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
            if predicate(&raw)? {
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
    async fn update(&self, update: ReconciliationUpdate) -> Result<(), NookError> {
        let store_id = self.store_id;
        let stage = update.stage();

        let expected_store_id = store_id.clone();
        let disposition = NookDatabase::idb_update_string(IndexedDbUpdate {
            key: &IdentityReconciliationStore::new(store_id).key(),
            guard: StringUpdateGuard::Unconditional,
            update: move |raw| {
                let raw = match raw {
                    StoredStringRecord::Stored(raw) => raw,
                    StoredStringRecord::MissingKey => {
                        return Err(NookError::IndexedDb(
                            "Identity reconciliation marker disappeared.".to_owned(),
                        ));
                    }
                };
                let pending = PendingIdentityReconciliation::decode(&raw)?;
                if pending.store_id != expected_store_id {
                    return Err(NookError::IndexedDb(
                        "Identity reconciliation marker names another vault.".to_owned(),
                    ));
                }
                update.apply(pending)?.encode()
            },
        })
        .await?;
        if disposition != StringUpdateResult::Applied {
            return Err(NookError::IndexedDb(format!(
                "Identity reconciliation {stage} update was rejected."
            )));
        }
        Ok(())
    }
    pub(crate) async fn commit_epoch(
        &self,
        key_epoch: &IdentityVaultEventId,
    ) -> Result<EpochCommittedReconciliation<'a>, NookError> {
        self.update(ReconciliationUpdate::Epoch {
            key_epoch: key_epoch.clone(),
        })
        .await?;
        Ok(EpochCommittedReconciliation {
            store: Self::new(self.store_id),
            key_epoch: key_epoch.clone(),
        })
    }
    async fn clear_consumed(&self, consumed_marker: &str) -> Result<(), NookError> {
        self.delete_if(|raw| Ok(raw == consumed_marker)).await
    }
}
impl EpochCommittedReconciliation<'_> {
    pub(crate) async fn commit_checkpoint(
        self,
        checkpoint: &IdentityVaultEventId,
    ) -> Result<(), NookError> {
        self.store
            .update(ReconciliationUpdate::Checkpoint {
                key_epoch: self.key_epoch,
                checkpoint: checkpoint.clone(),
            })
            .await
    }
}
#[cfg(all(test, target_arch = "wasm32"))]
mod browser_tests {

    use crate::{IdbPutStringRequest, NookDatabase, StoredStringRecord};
    use nook_core::{
        AppKey, IdentityVaultDekEpoch, IdentityVaultDekEpochUpdate, IdentityVaultEventId, StoreId,
    };
    use std::slice;

    use super::{
        EpochObservation, IdentityReconciliationStore, NookError, PendingIdentityReconciliation,
        PendingIdentityReconciliationProgress, PendingIdentityRotation, ReconciliationIntent,
        VerifiedPreviousEpoch,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    struct ReconciliationFixture {
        store_id: StoreId,
    }
    impl ReconciliationFixture {
        fn event_id(fill: char) -> Result<nook_core::IdentityVaultEventId, NookError> {
            IdentityVaultEventId::parse(&format!("sha256u:{}", fill.to_string().repeat(43)))
                .map_err(|error| NookError::Database(error.to_string()))
        }

        fn new() -> Result<Self, NookError> {
            Ok(Self {
                store_id: StoreId::parse("store_abcdefghijk")
                    .map_err(|error| NookError::Database(error.to_string()))?,
            })
        }

        fn plan_envelope() -> Result<nook_core::AgeArmoredCiphertext, NookError> {
            AppKey::generate()?
                .seal_utf8("rotation-plan")
                .map_err(NookError::from)
        }
    }
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn abort_only_removes_the_matching_prepared_rotation() -> Result<(), NookError> {
        let store_id = ReconciliationFixture::new()?.store_id;
        let key = IdentityReconciliationStore::new(&store_id).key();
        NookDatabase::idb_delete_key(&key).await?;
        let first_plan = ReconciliationFixture::plan_envelope()?;
        IdentityReconciliationStore::new(&store_id)
            .mark(ReconciliationIntent {
                previous_key_epoch: &ReconciliationFixture::event_id('a')?,
                previous_checkpoint: &ReconciliationFixture::event_id('b')?,
                plan_envelope: first_plan.clone(),
            })
            .await?;

        IdentityReconciliationStore::new(&store_id)
            .abort(&first_plan)
            .await?;
        assert!(matches!(
            IdentityReconciliationStore::new(&store_id).load().await?,
            PendingIdentityRotation::Complete
        ));

        let successor_plan = ReconciliationFixture::plan_envelope()?;
        IdentityReconciliationStore::new(&store_id)
            .mark(ReconciliationIntent {
                previous_key_epoch: &ReconciliationFixture::event_id('c')?,
                previous_checkpoint: &ReconciliationFixture::event_id('d')?,
                plan_envelope: successor_plan.clone(),
            })
            .await?;
        IdentityReconciliationStore::new(&store_id)
            .abort(&first_plan)
            .await?;
        assert!(matches!(
            IdentityReconciliationStore::new(&store_id).load().await?,
            PendingIdentityRotation::Prepared { .. }
                | PendingIdentityRotation::EpochCommitted { .. }
        ));
        IdentityReconciliationStore::new(&store_id)
            .abort(&successor_plan)
            .await?;
        assert!(matches!(
            IdentityReconciliationStore::new(&store_id).load().await?,
            PendingIdentityRotation::Complete
        ));
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn awaiting_checkpoint_blocks_an_advanced_epoch() -> Result<(), NookError> {
        let store_id = ReconciliationFixture::new()?.store_id;
        let previous_epoch = ReconciliationFixture::event_id('a')?;
        let key_epoch = ReconciliationFixture::event_id('c')?;
        let plan_envelope = ReconciliationFixture::plan_envelope()?;
        IdentityReconciliationStore::new(&store_id)
            .mark(ReconciliationIntent {
                previous_key_epoch: &previous_epoch,
                previous_checkpoint: &ReconciliationFixture::event_id('b')?,
                plan_envelope: plan_envelope.clone(),
            })
            .await?;
        let prepared = IdentityReconciliationStore::new(&store_id).load().await?;
        assert!(matches!(
            prepared,
            PendingIdentityRotation::Prepared {
                plan_envelope: stored
            } if stored == plan_envelope
        ));
        let _epoch_commit = IdentityReconciliationStore::new(&store_id)
            .commit_epoch(&key_epoch)
            .await?;
        let committed = IdentityReconciliationStore::new(&store_id).load().await?;
        assert!(matches!(
            committed,
            PendingIdentityRotation::EpochCommitted {
                key_epoch: stored,
                ..
            } if stored == key_epoch
        ));
        let result = IdentityReconciliationStore::new(&store_id)
            .resolve(EpochObservation {
                observed: IdentityVaultDekEpoch::Known {
                    key_epoch,
                    checkpoint: ReconciliationFixture::event_id('d')?,
                },
                verified_previous_key_epoch: VerifiedPreviousEpoch::Unverified,
                committed_event_ids: &[],
                checkpoint_ancestors: &[],
            })
            .await;
        assert!(result.is_err());
        NookDatabase::idb_delete_key(&IdentityReconciliationStore::new(&store_id).key()).await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn committed_checkpoint_reconciles_through_an_advanced_head() -> Result<(), NookError> {
        let store_id = ReconciliationFixture::new()?.store_id;
        let previous_epoch = ReconciliationFixture::event_id('a')?;
        let previous_checkpoint = ReconciliationFixture::event_id('b')?;
        let key_epoch = ReconciliationFixture::event_id('c')?;
        let checkpoint = ReconciliationFixture::event_id('d')?;
        let advanced_epoch = ReconciliationFixture::event_id('e')?;
        let advanced_checkpoint = ReconciliationFixture::event_id('f')?;
        IdentityReconciliationStore::new(&store_id)
            .mark(ReconciliationIntent {
                previous_key_epoch: &previous_epoch,
                previous_checkpoint: &previous_checkpoint,
                plan_envelope: ReconciliationFixture::plan_envelope()?,
            })
            .await?;
        let epoch_commit = IdentityReconciliationStore::new(&store_id)
            .commit_epoch(&key_epoch)
            .await?;
        epoch_commit.commit_checkpoint(&checkpoint).await?;
        let resolution = IdentityReconciliationStore::new(&store_id)
            .resolve(EpochObservation {
                observed: IdentityVaultDekEpoch::Known {
                    key_epoch: advanced_epoch.clone(),
                    checkpoint: advanced_checkpoint.clone(),
                },
                verified_previous_key_epoch: VerifiedPreviousEpoch::Unverified,
                committed_event_ids: &[
                    key_epoch.clone(),
                    checkpoint.clone(),
                    advanced_epoch.clone(),
                    advanced_checkpoint.clone(),
                ],
                checkpoint_ancestors: slice::from_ref(&checkpoint),
            })
            .await?;
        assert!(matches!(
            resolution.update(),
            IdentityVaultDekEpochUpdate::Rotate {
                key_epoch: resolved_epoch,
                checkpoint: resolved,
                ..
            } if *resolved_epoch == advanced_epoch && *resolved == advanced_checkpoint
        ));
        IdentityReconciliationStore::new(&store_id)
            .clear_consumed(resolution.marker()?)
            .await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn cleanup_preserves_a_successor_marker() -> Result<(), NookError> {
        let store_id = ReconciliationFixture::new()?.store_id;
        let key = IdentityReconciliationStore::new(&store_id).key();
        let first_epoch = ReconciliationFixture::event_id('c')?;
        let checkpoint = ReconciliationFixture::event_id('d')?;
        IdentityReconciliationStore::new(&store_id)
            .mark(ReconciliationIntent {
                previous_key_epoch: &ReconciliationFixture::event_id('a')?,
                previous_checkpoint: &ReconciliationFixture::event_id('b')?,
                plan_envelope: ReconciliationFixture::plan_envelope()?,
            })
            .await?;
        let epoch_commit = IdentityReconciliationStore::new(&store_id)
            .commit_epoch(&first_epoch)
            .await?;
        epoch_commit.commit_checkpoint(&checkpoint).await?;
        let resolution = IdentityReconciliationStore::new(&store_id)
            .resolve(EpochObservation {
                observed: IdentityVaultDekEpoch::Known {
                    key_epoch: first_epoch.clone(),
                    checkpoint: checkpoint.clone(),
                },
                verified_previous_key_epoch: VerifiedPreviousEpoch::Unverified,
                committed_event_ids: &[first_epoch.clone(), checkpoint.clone()],
                checkpoint_ancestors: &[],
            })
            .await?;
        let consumed = resolution.marker()?;
        let successor = PendingIdentityReconciliation {
            store_id: store_id.clone(),
            previous_key_epoch: ReconciliationFixture::event_id('e')?,
            previous_checkpoint: ReconciliationFixture::event_id('f')?,
            progress: PendingIdentityReconciliationProgress::Prepared {
                plan_envelope: ReconciliationFixture::plan_envelope()?,
            },
        };
        let successor_raw = successor.encode()?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: &key,
            value: &successor_raw,
        })
        .await?;

        IdentityReconciliationStore::new(&store_id)
            .clear_consumed(consumed)
            .await?;

        let preserved = match NookDatabase::idb_get_string(&key).await? {
            StoredStringRecord::Stored(value) => Ok(value),
            StoredStringRecord::MissingKey => Err({
                NookError::IndexedDb("Successor reconciliation marker disappeared.".to_owned())
            }),
        }?;
        assert_eq!(preserved, successor_raw);
        NookDatabase::idb_delete_key(&key).await
    }
}
