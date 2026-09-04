use super::{
    BuiltVaultEvent, NookError, NookVaultManager, VaultOperation, load_local_event_store,
    members_checkpoint_hash_from_roster, rewrapped_vault_meta_records_for_epoch, save_key_epoch,
};
use crate::storage::identity_record::PendingIdentityRotation;
use crate::storage::{event_db, identity_record};
use nook_core::{
    EpochMetadataState, EpochPasswordState, EventId, IdentityVaultEventId, ProjectionEpoch,
    StoreId, SymmetricKey,
};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

struct PreparedEpochRotation {
    previous_key_epoch: nook_core::IdentityVaultEventId,
    previous_checkpoint: nook_core::IdentityVaultEventId,
    new_keys: nook_core::VaultKeys,
    secrets: Vec<nook_core::EncryptedSecretPayload>,
    members_checkpoint_hash: nook_core::Sha256Hex,
    rotated_meta_records: Vec<nook_core::StoredSecretRecord>,
}

struct PersistedSecurityEpochRecoveryPlan {
    plan: SecurityEpochRecoveryPlan,
    plan_envelope: nook_core::AgeArmoredCiphertext,
}

struct PreparedSecurityEpochExecution {
    plan: SecurityEpochRecoveryPlan,
    store_id: nook_core::StoreId,
    trigger_event: BuiltVaultEvent,
    trigger_event_id: nook_core::EventId,
    key_epoch: nook_core::IdentityVaultEventId,
    checkpoint_event: BuiltVaultEvent,
    checkpoint_id: nook_core::EventId,
    checkpoint: nook_core::IdentityVaultEventId,
}

pub(in crate::manager) enum SecurityEpochRotationFailure {
    BeforeCommit(NookError),
    AfterCommit(NookError),
}

impl SecurityEpochRotationFailure {
    fn before<E: Into<NookError>>(error: E) -> Self {
        Self::BeforeCommit(error.into())
    }

    fn after<E: Into<NookError>>(error: E) -> Self {
        Self::AfterCommit(error.into())
    }

    fn into_error(self) -> NookError {
        match self {
            Self::BeforeCommit(error) | Self::AfterCommit(error) => error,
        }
    }
}

fn rewrap_password_entries(
    entries: &[nook_core::PasswordUnlockEntry],
    new_keys: &nook_core::VaultKeys,
    trigger: &VaultOperation,
) -> Result<Vec<nook_core::PasswordUnlockEntry>, NookError> {
    let mut entries = entries.to_vec();
    match trigger {
        VaultOperation::PasswordRotated { entry_id, envelope } => {
            let entry = entries
                .iter_mut()
                .find(|entry| entry.id == entry_id.as_str())
                .ok_or_else(|| NookError::Database("Password entry not found.".to_owned()))?;
            entry.envelope.clone_from(envelope);
        }
        VaultOperation::PasswordRemoved { entry_id } => {
            entries.retain(|entry| entry.id != entry_id.as_str());
        }
        _ => {}
    }
    for entry in &mut entries {
        entry.envelope = nook_core::rewrap_password_envelope(&entry.envelope, new_keys)
            .map_err(|error| NookError::Database(error.to_string()))?;
    }
    Ok(entries)
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecurityEpochRecoveryPlan {
    new_secrets_key: String,
    new_members_key: String,
    trigger_event_yaml: String,
    checkpoint_event_yaml: String,
}

impl Drop for SecurityEpochRecoveryPlan {
    fn drop(&mut self) {
        self.new_secrets_key.zeroize();
        self.new_members_key.zeroize();
    }
}

fn built_event_from_yaml(yaml: &str) -> Result<BuiltVaultEvent, NookError> {
    let bytes = yaml.as_bytes().to_vec();
    let event = nook_core::parse_event_storage_bytes(&bytes)?;
    Ok(BuiltVaultEvent { event, bytes })
}

fn projection_advanced_past(
    projection: &nook_core::VaultProjection,
    planned_epoch: &nook_core::EventId,
) -> bool {
    matches!(
        &projection.epoch,
        ProjectionEpoch::Current(nook_core::KeyEpoch(epoch)) if epoch != planned_epoch
    )
}

impl NookVaultManager {
    fn fail_closed_after_committed_security_epoch(
        &mut self,
        error: NookError,
    ) -> SecurityEpochRotationFailure {
        self.reset_vault_session();
        SecurityEpochRotationFailure::after(error)
    }

    fn prepare_security_epoch_rotation(
        &self,
        previous_key_epoch: nook_core::IdentityVaultEventId,
        previous_checkpoint: nook_core::IdentityVaultEventId,
    ) -> Result<PreparedEpochRotation, NookError> {
        let old_secrets_key = SymmetricKey::parse(&self.vault.secrets_key)?;
        let old_members_key = SymmetricKey::parse(&self.vault.members_key)?;
        let records_snapshot = self.stored_records_snapshot();
        let user_records = records_snapshot
            .iter()
            .filter(|record| !nook_core::is_vault_meta_record(record))
            .cloned()
            .collect::<Vec<_>>();
        let (new_keys, secrets) =
            nook_core::rotate_vault_keys_with_secrets(&user_records, &old_secrets_key)?;
        let members_checkpoint_hash = members_checkpoint_hash_from_roster(
            &records_snapshot,
            &old_members_key,
            &new_keys.members_key,
        )?;
        let rotated_meta_records =
            rewrapped_vault_meta_records_for_epoch(&records_snapshot, &old_members_key, &new_keys)?;
        Ok(PreparedEpochRotation {
            previous_key_epoch,
            previous_checkpoint,
            new_keys,
            secrets,
            members_checkpoint_hash,
            rotated_meta_records,
        })
    }

    fn rotation_frontier_matches(
        prepared: &PreparedEpochRotation,
        parents: &[nook_core::EventId],
    ) -> bool {
        match parents {
            [] => prepared.previous_checkpoint == prepared.previous_key_epoch,
            [parent] => parent.as_str() == prepared.previous_checkpoint.as_str(),
            _ => false,
        }
    }

    async fn persist_security_epoch_recovery_plan(
        &mut self,
        prepared: PreparedEpochRotation,
        trigger: VaultOperation,
        password_entries: &[nook_core::PasswordUnlockEntry],
    ) -> Result<PersistedSecurityEpochRecoveryPlan, NookError> {
        let previous_key_epoch = prepared.previous_key_epoch.clone();
        let previous_checkpoint = prepared.previous_checkpoint.clone();
        let parents = self
            .load_event_heads()
            .await?
            .into_iter()
            .map(|parent| EventId::parse(&parent))
            .collect::<Result<Vec<_>, _>>()?;
        if !Self::rotation_frontier_matches(&prepared, &parents) {
            return Err(NookError::Database(
                "Vault changed while preparing security epoch rotation; retry.".to_owned(),
            ));
        }
        let password_entries =
            rewrap_password_entries(password_entries, &prepared.new_keys, &trigger)?;
        let previous_epoch = EventId::parse(prepared.previous_key_epoch.as_str())?;
        let trigger_event = self
            .build_vault_operations_event(vec![trigger], parents, previous_epoch)
            .await?;
        let trigger_event_id = trigger_event.event.id()?;
        let checkpoint_event = self
            .build_vault_operations_event(
                vec![VaultOperation::EpochCheckpoint {
                    secrets: prepared.secrets.clone(),
                    members_checkpoint_hash: prepared.members_checkpoint_hash.clone(),
                    rotated_meta_records: EpochMetadataState::Replace(
                        prepared.rotated_meta_records,
                    ),
                    password_entries: EpochPasswordState::Replace(password_entries),
                }],
                vec![trigger_event_id.clone()],
                trigger_event_id,
            )
            .await?;
        let trigger_event_yaml = String::from_utf8(trigger_event.bytes)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        let checkpoint_event_yaml = String::from_utf8(checkpoint_event.bytes)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        let plan = SecurityEpochRecoveryPlan {
            new_secrets_key: prepared.new_keys.secrets_key.as_str().to_owned(),
            new_members_key: prepared.new_keys.members_key.as_str().to_owned(),
            trigger_event_yaml,
            checkpoint_event_yaml,
        };
        let plan_json = Zeroizing::new(
            serde_json::to_string(&plan)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        );
        let identity = self.device_identity()?;
        let plan_envelope = identity.seal_utf8(&plan_json)?;
        let store_id = StoreId::parse(&self.vault.store_id)?;
        identity_record::mark_identity_reconciliation_pending(
            &store_id,
            &previous_key_epoch,
            &previous_checkpoint,
            plan_envelope.clone(),
        )
        .await?;
        Ok(PersistedSecurityEpochRecoveryPlan {
            plan,
            plan_envelope,
        })
    }

    async fn execute_security_epoch_recovery_plan(
        &mut self,
        plan: SecurityEpochRecoveryPlan,
        plan_envelope: &nook_core::AgeArmoredCiphertext,
        persisted_key_epoch: Option<nook_core::IdentityVaultEventId>,
    ) -> Result<(), SecurityEpochRotationFailure> {
        let execution = Self::prepare_security_epoch_execution(
            &self.vault.store_id,
            plan,
            persisted_key_epoch.as_ref(),
        )
        .map_err(SecurityEpochRotationFailure::before)?;
        let saved_heads = event_db::save_security_epoch_event_pair(
            &self.vault.store_id,
            &execution.trigger_event.event,
            &execution.trigger_event.bytes,
            &execution.checkpoint_event.event,
            &execution.checkpoint_event.bytes,
        )
        .await;
        self.event_log.heads = match saved_heads {
            Ok(heads) => heads,
            Err(error) => {
                identity_record::abort_prepared_identity_reconciliation(
                    &execution.store_id,
                    plan_envelope,
                )
                .await
                .map_err(SecurityEpochRotationFailure::before)?;
                return Err(SecurityEpochRotationFailure::BeforeCommit(
                    NookError::Database(format!(
                        "Vault changed before security rotation committed; retry the operation: {error}"
                    )),
                ));
            }
        };
        if let Err(error) = self
            .complete_committed_security_epoch_recovery(execution)
            .await
        {
            return Err(self.fail_closed_after_committed_security_epoch(error));
        }
        Ok(())
    }

    fn prepare_security_epoch_execution(
        store_id: &str,
        plan: SecurityEpochRecoveryPlan,
        persisted_key_epoch: Option<&nook_core::IdentityVaultEventId>,
    ) -> Result<PreparedSecurityEpochExecution, NookError> {
        let store_id = StoreId::parse(store_id)?;
        let trigger_event = built_event_from_yaml(&plan.trigger_event_yaml)?;
        let trigger_event_id = trigger_event.event.id()?;
        let key_epoch = IdentityVaultEventId::parse(trigger_event_id.as_str())?;
        if persisted_key_epoch.is_some_and(|persisted| persisted != &key_epoch) {
            return Err(NookError::Database(
                "Persisted security epoch does not match its recovery plan.".to_owned(),
            ));
        }
        let checkpoint_event = built_event_from_yaml(&plan.checkpoint_event_yaml)?;
        let checkpoint_id = checkpoint_event.event.id()?;
        let checkpoint = IdentityVaultEventId::parse(checkpoint_id.as_str())?;
        Ok(PreparedSecurityEpochExecution {
            plan,
            store_id,
            trigger_event,
            trigger_event_id,
            key_epoch,
            checkpoint_event,
            checkpoint_id,
            checkpoint,
        })
    }

    async fn complete_committed_security_epoch_recovery(
        &mut self,
        execution: PreparedSecurityEpochExecution,
    ) -> Result<(), NookError> {
        let PreparedSecurityEpochExecution {
            plan,
            store_id,
            trigger_event,
            trigger_event_id,
            key_epoch,
            checkpoint_event,
            checkpoint_id,
            checkpoint,
        } = execution;
        let local = load_local_event_store(&self.vault.store_id).await?;
        let graph = local.load_graph(&self.vault.store_id)?;
        let projection = nook_core::project_vault(&graph, &self.vault.store_id)?;
        if projection_advanced_past(&projection, &trigger_event_id) {
            identity_record::commit_identity_reconciliation_epoch(&store_id, &key_epoch).await?;
            identity_record::commit_identity_reconciliation_checkpoint(
                &store_id,
                &key_epoch,
                &checkpoint,
            )
            .await?;
            nook_core::materialize_vault_meta_from_graph(&graph, &mut self.vault.meta)?;
            self.adopt_projected_security_epoch(&projection).await?;
            self.apply_event_projection_to_session().await?;
            self.persist_projection_cache().await?;
            let identity = self.device_identity()?;
            self.ensure_identity_after_connect(&identity).await?;
            return Ok(());
        }
        identity_record::commit_identity_reconciliation_epoch(&store_id, &key_epoch).await?;
        self.event_log.key_epoch = trigger_event_id.as_str().to_owned();
        save_key_epoch(&self.vault.store_id, &self.event_log.key_epoch).await?;

        let new_keys = nook_core::VaultKeys {
            secrets_key: SymmetricKey::parse(&plan.new_secrets_key)?,
            members_key: SymmetricKey::parse(&plan.new_members_key)?,
        };
        self.apply_vault_keys(new_keys.secrets_key.as_str(), new_keys.members_key.as_str())?;
        self.apply_event_projection_to_session().await?;
        self.queue_event_outbox_for_current_provider(&checkpoint_id, &checkpoint_event.bytes)
            .await?;
        self.queue_event_outbox_for_current_provider(&trigger_event_id, &trigger_event.bytes)
            .await?;
        self.persist_projection_cache().await?;
        identity_record::commit_identity_reconciliation_checkpoint(
            &store_id,
            &key_epoch,
            &checkpoint,
        )
        .await?;
        let identity = self.device_identity()?;
        self.ensure_identity_after_connect(&identity).await?;
        Ok(())
    }

    pub(in crate::manager) async fn resume_pending_security_epoch_rotation(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<bool, NookError> {
        if self.vault.store_id.is_empty() {
            return Ok(false);
        }
        let store_id = StoreId::parse(&self.vault.store_id)?;
        let Some(pending) = identity_record::load_pending_identity_rotation(&store_id).await?
        else {
            return Ok(false);
        };
        let (plan_envelope, persisted_key_epoch) = match pending {
            PendingIdentityRotation::Prepared { plan_envelope } => (plan_envelope, None),
            PendingIdentityRotation::EpochCommitted {
                key_epoch,
                plan_envelope,
            } => (plan_envelope, Some(key_epoch)),
        };
        let plan_json = Zeroizing::new(identity.open_utf8(&plan_envelope)?);
        let plan: SecurityEpochRecoveryPlan = serde_json::from_str(&plan_json)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        self.execute_security_epoch_recovery_plan(plan, &plan_envelope, persisted_key_epoch)
            .await
            .map_err(SecurityEpochRotationFailure::into_error)?;
        Ok(true)
    }

    pub(in crate::manager) async fn rotate_security_epoch_classified(
        &mut self,
        trigger: VaultOperation,
    ) -> Result<(), SecurityEpochRotationFailure> {
        let password_entries = self.vault.password_entries.clone();
        self.rotate_security_epoch_with_password_entries_classified(trigger, password_entries)
            .await
    }

    pub(in crate::manager) async fn rotate_security_epoch_with_password_entries(
        &mut self,
        trigger: VaultOperation,
        password_entries: Vec<nook_core::PasswordUnlockEntry>,
    ) -> Result<(), NookError> {
        self.rotate_security_epoch_with_password_entries_classified(trigger, password_entries)
            .await
            .map_err(SecurityEpochRotationFailure::into_error)
    }

    async fn rotate_security_epoch_with_password_entries_classified(
        &mut self,
        trigger: VaultOperation,
        password_entries: Vec<nook_core::PasswordUnlockEntry>,
    ) -> Result<(), SecurityEpochRotationFailure> {
        self.activate_event_log_mode()
            .await
            .map_err(SecurityEpochRotationFailure::before)?;
        let previous_key_epoch = IdentityVaultEventId::parse(
            &self
                .ensure_key_epoch()
                .await
                .map_err(SecurityEpochRotationFailure::before)?,
        )
        .map_err(SecurityEpochRotationFailure::before)?;
        let previous_checkpoint = IdentityVaultEventId::parse(
            &self
                .ensure_causal_event_checkpoint()
                .await
                .map_err(SecurityEpochRotationFailure::before)?,
        )
        .map_err(SecurityEpochRotationFailure::before)?;
        let prepared = self
            .prepare_security_epoch_rotation(previous_key_epoch, previous_checkpoint)
            .map_err(SecurityEpochRotationFailure::before)?;
        let persisted = self
            .persist_security_epoch_recovery_plan(prepared, trigger, &password_entries)
            .await
            .map_err(SecurityEpochRotationFailure::before)?;
        self.execute_security_epoch_recovery_plan(persisted.plan, &persisted.plan_envelope, None)
            .await
    }

    pub(in crate::manager) async fn rotate_password_security_epoch(
        &mut self,
        entry_id: nook_core::PasswordEntryId,
        password: &str,
        work_factor: u8,
    ) -> Result<nook_core::PasswordEnvelope, NookError> {
        self.activate_event_log_mode().await?;

        let previous_key_epoch = IdentityVaultEventId::parse(&self.ensure_key_epoch().await?)?;
        let previous_checkpoint =
            IdentityVaultEventId::parse(&self.ensure_causal_event_checkpoint().await?)?;
        let prepared =
            self.prepare_security_epoch_rotation(previous_key_epoch, previous_checkpoint)?;
        let envelope = nook_core::attach_password_envelope_with_work_factor(
            &prepared.new_keys,
            password,
            work_factor.into(),
        )?;

        let password_entries = self.vault.password_entries.clone();
        let persisted = self
            .persist_security_epoch_recovery_plan(
                prepared,
                VaultOperation::PasswordRotated {
                    entry_id,
                    envelope: envelope.clone(),
                },
                &password_entries,
            )
            .await?;
        self.execute_security_epoch_recovery_plan(persisted.plan, &persisted.plan_envelope, None)
            .await
            .map_err(SecurityEpochRotationFailure::into_error)?;
        Ok(envelope)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::PasswordEntryId;

    #[test]
    fn detects_a_verified_epoch_after_the_prepared_epoch() -> anyhow::Result<()> {
        let planned = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let latest = EventId::parse(&format!("sha256u:{}", "E".repeat(43)))?;
        let projection = nook_core::VaultProjection {
            epoch: ProjectionEpoch::Current(nook_core::KeyEpoch(latest)),
            ..Default::default()
        };
        assert!(projection_advanced_past(&projection, &planned));
        Ok(())
    }

    #[test]
    fn replaces_a_legacy_target_before_epoch_rewrap() -> anyhow::Result<()> {
        let keys = nook_core::generate_vault_keys()?;
        let legacy = serde_json::from_value(serde_json::json!({
            "id": "pwdentry001", "label": "Legacy", "created_at": "2026-08-15T00:00:00Z",
            "envelope": { "version": 1, "kdf": "scrypt", "work_factor": 10, "ciphertext": "old" }
        }))?;
        let envelope =
            nook_core::attach_password_envelope_with_work_factor(&keys, "updated", 10.into())?;
        let entries = rewrap_password_entries(
            &[legacy],
            &keys,
            &VaultOperation::PasswordRotated {
                entry_id: PasswordEntryId::parse("pwdentry001")?,
                envelope,
            },
        )?;
        assert_eq!(
            nook_core::resolve_keys_from_entry(&entries[0], "updated")?,
            keys
        );
        Ok(())
    }

    #[test]
    fn committed_epoch_failure_resets_the_live_session() {
        let mut manager = NookVaultManager::new();
        manager.vault.store_id = "store_committed_epoch_failure".to_owned();
        manager.vault.secrets_key = "old-secrets-key".to_owned();
        manager.vault.members_key = "old-members-key".to_owned();
        manager.event_log.key_epoch = "old-key-epoch".to_owned();

        let failure = manager.fail_closed_after_committed_security_epoch(NookError::Database(
            "post-commit completion failed".to_owned(),
        ));

        assert!(matches!(
            failure,
            SecurityEpochRotationFailure::AfterCommit(_)
        ));
        assert!(manager.vault.store_id.is_empty());
        assert!(manager.vault.secrets_key.is_empty());
        assert!(manager.vault.members_key.is_empty());
        assert!(manager.event_log.key_epoch.is_empty());
    }
}
