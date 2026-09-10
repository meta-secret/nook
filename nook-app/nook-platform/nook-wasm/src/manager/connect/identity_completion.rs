//! Identity adoption and verified epoch reconciliation at connect completion.
use super::*;

impl NookVaultManager {
    pub(super) async fn complete_connected_identity(
        &mut self,
        identity: &nook_core::DeviceIdentity,
        pending_cleanup: SimpleGenesisProgress,
    ) -> Result<(), NookError> {
        let staged_genesis = matches!(&pending_cleanup, SimpleGenesisProgress::Pending(pending) if pending.is_staged());
        if !staged_genesis {
            self.ensure_identity_after_connect(identity).await?;
        }
        self.finalize_existing_vault_import_handoff().await?;
        self.finalize_paired_vault_handoff().await?;
        let SimpleGenesisProgress::Pending(completed) = pending_cleanup else {
            return Ok(());
        };
        let staged_handoff = completed.is_staged();
        let completion = if staged_handoff {
            SimpleGenesisCompletion::Staged {
                pending: &completed,
                signing_seed: self.event_log.signing_seed.as_str(),
            }
        } else {
            SimpleGenesisCompletion::Ordinary {
                pending: &completed,
            }
        };
        completion.clear_pending().await?;
        if staged_handoff {
            self.device.pending_extension_handoff = ExtensionIdentityPublication::Idle;
        }
        Ok(())
    }

    /// Persist a first-class Identity after connect, synthesizing from vault auth when needed.
    pub(in crate::manager) async fn ensure_identity_after_connect(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<(), NookError> {
        if self.defers_identity_reconciliation_until_handoff() {
            return Ok(());
        }
        let label = match &self.vault.vault_name {
            VaultNameState::Named(name) if !name.trim().is_empty() => name.clone(),
            _ => "Personal".to_owned(),
        };
        if self.vault.store_id.is_empty() {
            let _ = NookDatabase::ensure_local_identity_for_app_key(
                IdentityDbEnsureLocalIdentityForAppKey {
                    app_key: identity,
                    label: &label,
                },
            )
            .await?;
            return Ok(());
        }
        let store_id = StoreId::parse(&self.vault.store_id)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let (key_epoch, committed_event_ids, checkpoint_ancestors, verified_previous_key_epoch) =
            if self.event_log.enabled {
                let key_epoch = self.ensure_key_epoch().await?;
                let checkpoint = self.ensure_causal_event_checkpoint().await?;
                let event_store =
                    NookDatabase::load_local_event_store(&self.vault.store_id).await?;
                let graph = event_store.load_graph(&self.vault.store_id)?;
                let checkpoint_event_id = EventId::parse(&checkpoint)
                    .map_err(|error| NookError::Database(error.to_string()))?;
                let ordered_event_ids = graph.topological_order()?;
                let key_epoch_event_id = EventId::parse(&key_epoch)
                    .map_err(|error| NookError::Database(error.to_string()))?;
                let verified_previous_key_epoch = match graph.get(&key_epoch_event_id) {
                    nook_core::EventLookup::UnknownEvent => None,
                    nook_core::EventLookup::Recorded(event)
                        if event.body.key_epoch == key_epoch_event_id =>
                    {
                        None
                    }
                    nook_core::EventLookup::Recorded(event) => Some(
                        IdentityVaultEventId::parse(event.body.key_epoch.as_str())
                            .map_err(|error| NookError::Database(error.to_string()))?,
                    ),
                };
                let committed_event_ids = ordered_event_ids
                    .iter()
                    .map(|event_id| IdentityVaultEventId::parse(event_id.as_str()))
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|error| NookError::Database(error.to_string()))?;
                let checkpoint_ancestors = ordered_event_ids
                    .iter()
                    .filter(|event_id| graph.is_ancestor(event_id, &checkpoint_event_id))
                    .map(|event_id| IdentityVaultEventId::parse(event_id.as_str()))
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|error| NookError::Database(error.to_string()))?;
                (
                    IdentityVaultDekEpoch::Known {
                        key_epoch: IdentityVaultEventId::parse(&key_epoch)
                            .map_err(|error| NookError::Database(error.to_string()))?,
                        checkpoint: IdentityVaultEventId::parse(&checkpoint)
                            .map_err(|error| NookError::Database(error.to_string()))?,
                    },
                    committed_event_ids,
                    checkpoint_ancestors,
                    match verified_previous_key_epoch {
                        Some(epoch) => VerifiedPreviousEpoch::Verified(epoch),
                        None => VerifiedPreviousEpoch::Unverified,
                    },
                )
            } else {
                (
                    IdentityVaultDekEpoch::LegacyUnknown,
                    Vec::new(),
                    Vec::new(),
                    VerifiedPreviousEpoch::Unverified,
                )
            };
        if let Some(envelopes) = self.vault.meta.auth.get(&identity.auth_id()) {
            let authorized_auth_ids = if self.event_log.enabled {
                let store = NookDatabase::load_local_event_store(store_id.as_str()).await?;
                let graph = store.load_graph(store_id.as_str())?;
                EventGraphAuthorizationProjection::new(&graph).active_auth_ids()?
            } else {
                self.vault.meta.auth.keys().cloned().collect()
            };
            let _ = NookDatabase::ensure_identity_from_legacy_vault(
                identity_record::LegacyVaultIdentityInput {
                    app_key: identity,
                    store_id: &store_id,
                    secrets_envelope: envelopes.secrets_key.clone(),
                    members_envelope: envelopes.members_key.clone(),
                    key_epoch,
                    verified_previous_key_epoch,
                    committed_event_ids,
                    checkpoint_ancestors,
                    authorized_auth_ids,
                    label: &label,
                },
            )
            .await?;
            return Ok(());
        }
        let _ = NookDatabase::ensure_local_identity_for_app_key(
            IdentityDbEnsureLocalIdentityForAppKey {
                app_key: identity,
                label: &label,
            },
        )
        .await?;
        Ok(())
    }
}
