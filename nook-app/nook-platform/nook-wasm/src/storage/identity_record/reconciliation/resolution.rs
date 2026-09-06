#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Identity persistence must complete before exact-marker cleanup becomes available.
use super::super as identity_record;
use super::super::super::indexed_db;
use super::{
    IdentityReconciliationStore, NookError, PendingIdentityReconciliation,
    PendingIdentityReconciliationProgress,
};
use identity_record::LegacyVaultIdentityInput;
use nook_core::{
    AgeArmoredCiphertext, AppKey, AuthKeyId, IdentityRecord, IdentityVaultDekEpoch,
    IdentityVaultDekEpochUpdate, IdentityVaultEventId, StoreId,
};
pub(super) struct EpochObservation<'a> {
    pub(super) observed: IdentityVaultDekEpoch,
    pub(super) verified_previous_key_epoch: Option<IdentityVaultEventId>,
    pub(super) committed_event_ids: &'a [IdentityVaultEventId],
    pub(super) checkpoint_ancestors: &'a [IdentityVaultEventId],
}
pub(super) struct IdentityEpochResolution {
    update: IdentityVaultDekEpochUpdate,
    consumed_marker: Option<String>,
}
/// Carries the selected marker through directory persistence without cleaning it.
/// Dropping this state or its unpolled future has no storage effect.
///
/// ```compile_fail,E0603
/// use nook_wasm::storage::identity_record::reconciliation::resolution::ResolvedIdentityPersistence;
/// ```
struct ResolvedIdentityPersistence {
    resolution: IdentityEpochResolution,
    store_id: StoreId,
    app_key: AppKey,
    label: String,
    secrets_envelope: AgeArmoredCiphertext,
    members_envelope: AgeArmoredCiphertext,
    authorized_auth_ids: Vec<AuthKeyId>,
}
/// Created after directory persistence succeeds; completion consumes the record
/// and deletes only the exact marker selected during resolution.
///
/// ```compile_fail,E0603
/// use nook_wasm::storage::identity_record::reconciliation::resolution::PersistedIdentityReconciliation;
/// ```
struct PersistedIdentityReconciliation {
    store_id: StoreId,
    record: IdentityRecord,
    consumed_marker: Option<String>,
}
impl IdentityReconciliationStore<'_> {
    pub(super) async fn resolve(
        &self,
        input: EpochObservation<'_>,
    ) -> Result<IdentityEpochResolution, NookError> {
        let store_id = self.store_id;
        let EpochObservation {
            observed,
            verified_previous_key_epoch,
            committed_event_ids,
            checkpoint_ancestors,
        } = input;

        let Some(raw) =
            indexed_db::idb_get_string(&IdentityReconciliationStore::new(store_id).key()).await?
        else {
            if let (
                Some(previous_key_epoch),
                IdentityVaultDekEpoch::Known {
                    key_epoch,
                    checkpoint,
                },
            ) = (verified_previous_key_epoch, &observed)
            {
                return Ok(IdentityEpochResolution {
                    update: IdentityVaultDekEpochUpdate::Rotate {
                        previous_key_epoch,
                        previous_checkpoint_ancestors: checkpoint_ancestors.to_vec(),
                        key_epoch: key_epoch.clone(),
                        checkpoint: checkpoint.clone(),
                    },
                    consumed_marker: None,
                });
            }
            return Ok(IdentityEpochResolution {
                update: IdentityVaultDekEpochUpdate::Observe {
                    key_epoch: observed,
                    checkpoint_ancestors: checkpoint_ancestors.to_vec(),
                },
                consumed_marker: None,
            });
        };
        let pending = PendingIdentityReconciliation::decode(&raw)?;
        if pending.store_id != *store_id {
            return Err(NookError::IndexedDb(
                "Identity reconciliation marker names another vault.".to_owned(),
            ));
        }
        let (observed_epoch, observed_checkpoint) = match &observed {
            IdentityVaultDekEpoch::Known {
                key_epoch,
                checkpoint,
            } => (key_epoch, checkpoint),
            IdentityVaultDekEpoch::LegacyUnknown => {
                return Err(NookError::IndexedDb(
                    "Event-log reconciliation cannot use an unknown epoch.".to_owned(),
                ));
            }
        };
        match &pending.progress {
            PendingIdentityReconciliationProgress::Prepared { .. }
            | PendingIdentityReconciliationProgress::EpochCommitted { .. } => {
                Err(NookError::IndexedDb(
                    "Security epoch rotation must resume before identity reconciliation."
                        .to_owned(),
                ))
            }
            PendingIdentityReconciliationProgress::Committed {
                key_epoch,
                checkpoint,
            } => {
                if !committed_event_ids.contains(key_epoch)
                    || !committed_event_ids.contains(checkpoint)
                    || (checkpoint != observed_checkpoint
                        && !checkpoint_ancestors.contains(checkpoint))
                {
                    return Err(NookError::IndexedDb(
                        "Committed security epoch checkpoint is absent from verified history."
                            .to_owned(),
                    ));
                }
                Ok(IdentityEpochResolution {
                    update: IdentityVaultDekEpochUpdate::Rotate {
                        previous_key_epoch: pending.previous_key_epoch,
                        previous_checkpoint_ancestors: checkpoint_ancestors.to_vec(),
                        key_epoch: observed_epoch.clone(),
                        checkpoint: observed_checkpoint.clone(),
                    },
                    consumed_marker: Some(raw),
                })
            }
        }
    }
}
impl LegacyVaultIdentityInput<'_> {
    pub(in super::super) async fn reconcile(self) -> Result<IdentityRecord, NookError> {
        let LegacyVaultIdentityInput {
            app_key,
            store_id,
            secrets_envelope,
            members_envelope,
            key_epoch,
            verified_previous_key_epoch,
            committed_event_ids,
            checkpoint_ancestors,
            authorized_auth_ids,
            label,
        } = self;
        let app_key = app_key.clone();
        let store_id = store_id.clone();
        let label = label.to_owned();
        let resolution = IdentityReconciliationStore::new(&store_id)
            .resolve(EpochObservation {
                observed: key_epoch,
                verified_previous_key_epoch,
                committed_event_ids: &committed_event_ids,
                checkpoint_ancestors: &checkpoint_ancestors,
            })
            .await?;

        ResolvedIdentityPersistence {
            resolution,
            store_id,
            app_key,
            label,
            secrets_envelope,
            members_envelope,
            authorized_auth_ids,
        }
        .persist()
        .await?
        .complete()
        .await
    }
}
impl ResolvedIdentityPersistence {
    async fn persist(self) -> Result<PersistedIdentityReconciliation, NookError> {
        let Self {
            resolution,
            store_id,
            app_key,
            label,
            secrets_envelope,
            members_envelope,
            authorized_auth_ids,
        } = self;
        let consumed_marker = resolution.consumed_marker;
        let directory_store_id = store_id.clone();
        let record = identity_record::update_identity_directory(move |directory| {
            let identity_id = directory
                .import_legacy_vault(
                    &label,
                    &app_key,
                    directory_store_id,
                    nook_core::IdentityVaultDekReconciliation {
                        secrets_envelope,
                        members_envelope,
                        epoch_update: resolution.update,
                        authorized_auth_ids,
                    },
                )
                .map_err(|error| NookError::Database(error.to_string()))?;
            directory
                .identities()
                .iter()
                .find(|record| record.identity_id == identity_id)
                .cloned()
                .ok_or_else(|| NookError::Database("Imported identity disappeared.".to_owned()))
        })
        .await?;

        Ok(PersistedIdentityReconciliation {
            store_id,
            record,
            consumed_marker,
        })
    }
}
impl PersistedIdentityReconciliation {
    async fn complete(self) -> Result<IdentityRecord, NookError> {
        let Self {
            store_id,
            record,
            consumed_marker,
        } = self;
        if let Some(consumed_marker) = consumed_marker {
            IdentityReconciliationStore::new(&store_id)
                .clear_consumed(&consumed_marker)
                .await?;
        }
        Ok(record)
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
impl IdentityEpochResolution {
    pub(super) fn update(&self) -> &IdentityVaultDekEpochUpdate {
        &self.update
    }
    pub(super) fn marker(&self) -> Option<&str> {
        self.consumed_marker.as_deref()
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod browser_tests {
    use super::{IdentityEpochResolution, ResolvedIdentityPersistence};
    use crate::NookError;
    use crate::storage::identity_record::reconciliation::IdentityReconciliationStore;
    use crate::storage::identity_record::{IDENTITY_DIRECTORY_KEY, load_identity_directory};
    use crate::storage::indexed_db;
    use nook_core::{AppKey, IdentityVaultDekEpoch, IdentityVaultDekEpochUpdate, StoreId};
    use wasm_bindgen_test::wasm_bindgen_test;

    struct PersistenceFixture {
        store_id: StoreId,
        app_key: AppKey,
        marker: String,
    }

    impl PersistenceFixture {
        fn new() -> Result<Self, NookError> {
            Ok(Self {
                store_id: StoreId::parse("store_abcdefghijk")
                    .map_err(|error| NookError::Database(error.to_string()))?,
                app_key: AppKey::generate()?,
                marker: "exact selected marker bytes".to_owned(),
            })
        }

        async fn install(&self) -> Result<(), NookError> {
            indexed_db::clear_vault_db().await?;
            indexed_db::idb_put_string(
                &IdentityReconciliationStore::new(&self.store_id).key(),
                &self.marker,
            )
            .await
        }

        fn resolved(&self) -> Result<ResolvedIdentityPersistence, NookError> {
            Ok(ResolvedIdentityPersistence {
                resolution: IdentityEpochResolution {
                    update: IdentityVaultDekEpochUpdate::Observe {
                        key_epoch: IdentityVaultDekEpoch::LegacyUnknown,
                        checkpoint_ancestors: Vec::new(),
                    },
                    consumed_marker: Some(self.marker.clone()),
                },
                store_id: self.store_id.clone(),
                app_key: self.app_key.clone(),
                label: "Imported fixture".to_owned(),
                secrets_envelope: self.app_key.seal_utf8(&"11".repeat(32))?,
                members_envelope: self.app_key.seal_utf8(&"22".repeat(32))?,
                authorized_auth_ids: vec![self.app_key.auth_id()],
            })
        }

        async fn assert_marker(&self) -> Result<(), NookError> {
            assert_eq!(
                indexed_db::idb_get_string(&IdentityReconciliationStore::new(&self.store_id).key())
                    .await?,
                Some(self.marker.clone())
            );
            Ok(())
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
    async fn identity_is_durable_before_exact_marker_completion() -> Result<(), NookError> {
        let fixture = PersistenceFixture::new()?;
        fixture.install().await?;
        let persisted = fixture.resolved()?.persist().await?;
        fixture.assert_marker().await?;
        let directory = load_identity_directory().await?;
        assert!(
            directory
                .identities()
                .iter()
                .any(|identity| identity.identity_id == persisted.record.identity_id)
        );
        let expected = persisted.record.clone();
        assert_eq!(persisted.complete().await?, expected);
        assert!(
            indexed_db::idb_get_string(&IdentityReconciliationStore::new(&fixture.store_id).key())
                .await?
                .is_none()
        );
        indexed_db::clear_vault_db().await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn failed_directory_persistence_preserves_selected_marker() -> Result<(), NookError> {
        let fixture = PersistenceFixture::new()?;
        fixture.install().await?;
        indexed_db::idb_put_string(IDENTITY_DIRECTORY_KEY, "{malformed").await?;
        assert!(matches!(
            fixture.resolved()?.persist().await,
            Err(NookError::IndexedDb(_))
        ));
        fixture.assert_marker().await?;
        assert_eq!(
            indexed_db::idb_get_string(IDENTITY_DIRECTORY_KEY)
                .await?
                .as_deref(),
            Some("{malformed")
        );
        indexed_db::clear_vault_db().await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn dropping_continuations_never_cleans_the_marker() -> Result<(), NookError> {
        let fixture = PersistenceFixture::new()?;
        fixture.install().await?;
        {
            let _resolved = fixture.resolved()?;
        }
        {
            let _unpolled_persistence = fixture.resolved()?.persist();
        }
        fixture.assert_marker().await?;
        assert!(
            indexed_db::idb_get_string(IDENTITY_DIRECTORY_KEY)
                .await?
                .is_none()
        );
        {
            let _persisted = fixture.resolved()?.persist().await?;
        }
        fixture.assert_marker().await?;
        {
            let _unpolled_completion = fixture.resolved()?.persist().await?.complete();
        }
        fixture.assert_marker().await?;
        assert!(
            indexed_db::idb_get_string(IDENTITY_DIRECTORY_KEY)
                .await?
                .is_some()
        );
        indexed_db::clear_vault_db().await
    }
}
