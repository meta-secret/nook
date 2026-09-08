#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Serialized marker progression, separate from runtime continuations.
use super::NookError;
use nook_core::{AgeArmoredCiphertext, IdentityVaultEventId, StoreId};
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PendingIdentityReconciliation {
    pub(super) store_id: StoreId,
    pub(super) previous_key_epoch: IdentityVaultEventId,
    pub(super) previous_checkpoint: IdentityVaultEventId,
    pub(super) progress: PendingIdentityReconciliationProgress,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(super) enum PendingIdentityReconciliationProgress {
    Prepared {
        plan_envelope: AgeArmoredCiphertext,
    },
    EpochCommitted {
        key_epoch: IdentityVaultEventId,
        plan_envelope: AgeArmoredCiphertext,
    },
    Committed {
        key_epoch: IdentityVaultEventId,
        checkpoint: IdentityVaultEventId,
    },
}

impl PendingIdentityReconciliation {
    pub(super) fn decode(raw: &str) -> Result<Self, NookError> {
        serde_json::from_str(raw).map_err(|error| {
            NookError::IndexedDb(format!(
                "Identity reconciliation marker decode error: {error}"
            ))
        })
    }
    pub(super) fn encode(&self) -> Result<String, NookError> {
        let pending = self;
        serde_json::to_string(pending).map_err(|error| {
            NookError::IndexedDb(format!(
                "Identity reconciliation marker encode error: {error}"
            ))
        })
    }
}
pub(super) enum ReconciliationUpdate {
    Epoch {
        key_epoch: IdentityVaultEventId,
    },
    Checkpoint {
        key_epoch: IdentityVaultEventId,
        checkpoint: IdentityVaultEventId,
    },
}
impl ReconciliationUpdate {
    pub(super) fn stage(&self) -> &'static str {
        match self {
            Self::Epoch { .. } => "epoch",
            Self::Checkpoint { .. } => "checkpoint",
        }
    }
    pub(super) fn apply(
        self,
        mut pending: PendingIdentityReconciliation,
    ) -> Result<PendingIdentityReconciliation, NookError> {
        match self {
            Self::Epoch {
                key_epoch: expected_key_epoch,
            } => {
                pending.progress = match pending.progress {
                    PendingIdentityReconciliationProgress::Prepared { plan_envelope } => {
                        PendingIdentityReconciliationProgress::EpochCommitted {
                            key_epoch: expected_key_epoch,
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
                    PendingIdentityReconciliationProgress::EpochCommitted { .. }
                    | PendingIdentityReconciliationProgress::Committed { .. } => {
                        return Err(NookError::IndexedDb(
                            "Identity reconciliation epoch changed unexpectedly.".to_owned(),
                        ));
                    }
                };
            }
            Self::Checkpoint {
                key_epoch: expected_key_epoch,
                checkpoint: committed_checkpoint,
            } => {
                pending.progress = match pending.progress {
                    PendingIdentityReconciliationProgress::EpochCommitted { key_epoch, .. }
                        if key_epoch == expected_key_epoch =>
                    {
                        PendingIdentityReconciliationProgress::Committed {
                            key_epoch,
                            checkpoint: committed_checkpoint,
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
            }
        }
        Ok(pending)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        PendingIdentityReconciliation, PendingIdentityReconciliationProgress, ReconciliationUpdate,
    };
    use crate::NookError;
    use nook_core::{AppKey, IdentityVaultEventId, StoreId};
    use wasm_bindgen_test::wasm_bindgen_test;

    struct ProgressFixture {
        prepared: PendingIdentityReconciliation,
        epoch: IdentityVaultEventId,
        checkpoint: IdentityVaultEventId,
    }

    impl ProgressFixture {
        fn event_id(fill: char) -> Result<IdentityVaultEventId, NookError> {
            IdentityVaultEventId::parse(&format!("sha256u:{}", fill.to_string().repeat(43)))
                .map_err(|error| NookError::Database(error.to_string()))
        }

        fn new() -> Result<Self, NookError> {
            Ok(Self {
                prepared: PendingIdentityReconciliation {
                    store_id: StoreId::parse("store_abcdefghijk")
                        .map_err(|error| NookError::Database(error.to_string()))?,
                    previous_key_epoch: Self::event_id('a')?,
                    previous_checkpoint: Self::event_id('b')?,
                    progress: PendingIdentityReconciliationProgress::Prepared {
                        plan_envelope: AppKey::generate()?.seal_utf8("rotation-plan")?,
                    },
                },
                epoch: Self::event_id('c')?,
                checkpoint: Self::event_id('d')?,
            })
        }

        fn epoch_update(&self) -> ReconciliationUpdate {
            ReconciliationUpdate::Epoch {
                key_epoch: self.epoch.clone(),
            }
        }

        fn checkpoint_update(&self) -> ReconciliationUpdate {
            ReconciliationUpdate::Checkpoint {
                key_epoch: self.epoch.clone(),
                checkpoint: self.checkpoint.clone(),
            }
        }
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn progression_preserves_identity_and_accepts_identical_stage_updates() -> Result<(), NookError>
    {
        let fixture = ProgressFixture::new()?;
        let epoch = fixture.epoch_update().apply(fixture.prepared.clone())?;
        assert_eq!(epoch.store_id, fixture.prepared.store_id);
        assert_eq!(
            epoch.previous_key_epoch,
            fixture.prepared.previous_key_epoch
        );
        assert_eq!(
            epoch.previous_checkpoint,
            fixture.prepared.previous_checkpoint
        );
        assert_eq!(fixture.epoch_update().apply(epoch.clone())?, epoch);
        let committed = fixture.checkpoint_update().apply(epoch)?;
        assert_eq!(
            fixture.checkpoint_update().apply(committed.clone())?,
            committed
        );
        assert_eq!(
            PendingIdentityReconciliation::decode(&committed.encode()?)?,
            committed
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn checkpoint_requires_the_committed_epoch_and_cannot_change_it() -> Result<(), NookError> {
        let fixture = ProgressFixture::new()?;
        assert!(
            matches!(fixture.checkpoint_update().apply(fixture.prepared.clone()),
            Err(NookError::IndexedDb(message)) if message == "Identity reconciliation checkpoint changed unexpectedly.")
        );
        let epoch = fixture.epoch_update().apply(fixture.prepared.clone())?;
        let wrong_epoch = ReconciliationUpdate::Epoch {
            key_epoch: ProgressFixture::event_id('e')?,
        };
        assert!(matches!(wrong_epoch.apply(epoch.clone()),
            Err(NookError::IndexedDb(message)) if message == "Identity reconciliation epoch changed unexpectedly."));
        let committed = fixture.checkpoint_update().apply(epoch)?;
        assert!(matches!(fixture.epoch_update().apply(committed.clone()),
            Err(NookError::IndexedDb(message)) if message == "Identity reconciliation epoch changed unexpectedly."));
        let changed = ReconciliationUpdate::Checkpoint {
            key_epoch: fixture.epoch,
            checkpoint: ProgressFixture::event_id('e')?,
        };
        assert!(matches!(changed.apply(committed),
            Err(NookError::IndexedDb(message)) if message == "Identity reconciliation checkpoint changed unexpectedly."));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn malformed_marker_keeps_decode_error_context() {
        assert!(matches!(PendingIdentityReconciliation::decode("{broken"),
            Err(NookError::IndexedDb(message)) if message.starts_with("Identity reconciliation marker decode error:")));
    }
}
