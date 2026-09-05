#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
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

struct CommittedSecurityEpochExecution {
    execution: PreparedSecurityEpochExecution,
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

impl PreparedEpochRotation {
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

impl SecurityEpochRecoveryPlan {
    fn built_event_from_yaml(yaml: &str) -> Result<BuiltVaultEvent, NookError> {
        let bytes = yaml.as_bytes().to_vec();
        let event = nook_core::parse_event_storage_bytes(&bytes)?;
        Ok(BuiltVaultEvent { event, bytes })
    }
}

impl CommittedSecurityEpochExecution {
    fn projection_advanced_past(&self, projection: &nook_core::VaultProjection) -> bool {
        matches!(
            &projection.epoch,
            ProjectionEpoch::Current(nook_core::KeyEpoch(epoch)) if epoch != &self.execution.trigger_event_id
        )
    }
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
        let user_records = nook_core::user_stored_records(&records_snapshot)?;
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
}

impl PreparedEpochRotation {
    fn rotation_frontier_matches(&self, parents: &[nook_core::EventId]) -> bool {
        match parents {
            [] => self.previous_checkpoint == self.previous_key_epoch,
            [parent] => parent.as_str() == self.previous_checkpoint.as_str(),
            _ => false,
        }
    }
}

impl NookVaultManager {
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
        if !prepared.rotation_frontier_matches(&parents) {
            return Err(NookError::Database(
                "Vault changed while preparing security epoch rotation; retry.".to_owned(),
            ));
        }
        let password_entries = PreparedEpochRotation::rewrap_password_entries(
            password_entries,
            &prepared.new_keys,
            &trigger,
        )?;
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
        let execution = plan
            .prepare_execution(&self.vault.store_id, persisted_key_epoch.as_ref())
            .map_err(SecurityEpochRotationFailure::before)?;
        let committed = execution.commit(self, plan_envelope).await?;
        if let Err(error) = committed.complete(self).await {
            return Err(self.fail_closed_after_committed_security_epoch(error));
        }
        Ok(())
    }
}

impl PreparedSecurityEpochExecution {
    async fn commit(
        self,
        manager: &mut NookVaultManager,
        plan_envelope: &nook_core::AgeArmoredCiphertext,
    ) -> Result<CommittedSecurityEpochExecution, SecurityEpochRotationFailure> {
        let saved_heads = event_db::save_security_epoch_event_pair(
            &manager.vault.store_id,
            &self.trigger_event.event,
            &self.trigger_event.bytes,
            &self.checkpoint_event.event,
            &self.checkpoint_event.bytes,
        )
        .await;
        manager.event_log.heads = match saved_heads {
            Ok(heads) => heads,
            Err(error) => {
                identity_record::abort_prepared_identity_reconciliation(
                    &self.store_id,
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
        Ok(CommittedSecurityEpochExecution { execution: self })
    }
}

impl SecurityEpochRecoveryPlan {
    fn prepare_execution(
        self,
        store_id: &str,
        persisted_key_epoch: Option<&nook_core::IdentityVaultEventId>,
    ) -> Result<PreparedSecurityEpochExecution, NookError> {
        let store_id = StoreId::parse(store_id)?;
        let trigger_event = Self::built_event_from_yaml(&self.trigger_event_yaml)?;
        let trigger_event_id = trigger_event.event.id()?;
        let key_epoch = IdentityVaultEventId::parse(trigger_event_id.as_str())?;
        if persisted_key_epoch.is_some_and(|persisted| persisted != &key_epoch) {
            return Err(NookError::Database(
                "Persisted security epoch does not match its recovery plan.".to_owned(),
            ));
        }
        let checkpoint_event = Self::built_event_from_yaml(&self.checkpoint_event_yaml)?;
        let checkpoint_id = checkpoint_event.event.id()?;
        let checkpoint = IdentityVaultEventId::parse(checkpoint_id.as_str())?;
        Ok(PreparedSecurityEpochExecution {
            plan: self,
            store_id,
            trigger_event,
            trigger_event_id,
            key_epoch,
            checkpoint_event,
            checkpoint_id,
            checkpoint,
        })
    }
}

impl CommittedSecurityEpochExecution {
    async fn complete(self, manager: &mut NookVaultManager) -> Result<(), NookError> {
        let local = load_local_event_store(&manager.vault.store_id).await?;
        let graph = local.load_graph(&manager.vault.store_id)?;
        let projection = nook_core::project_vault(&graph, &manager.vault.store_id)?;
        let advanced = self.projection_advanced_past(&projection);
        let PreparedSecurityEpochExecution {
            plan,
            store_id,
            trigger_event,
            trigger_event_id,
            key_epoch,
            checkpoint_event,
            checkpoint_id,
            checkpoint,
        } = self.execution;
        if advanced {
            identity_record::commit_identity_reconciliation_epoch(&store_id, &key_epoch).await?;
            identity_record::commit_identity_reconciliation_checkpoint(
                &store_id,
                &key_epoch,
                &checkpoint,
            )
            .await?;
            nook_core::materialize_vault_meta_from_graph(&graph, &mut manager.vault.meta)?;
            manager.adopt_projected_security_epoch(&projection).await?;
            manager.apply_event_projection_to_session().await?;
            manager.persist_projection_cache().await?;
            let identity = manager.device_identity()?;
            manager.ensure_identity_after_connect(&identity).await?;
            return Ok(());
        }
        identity_record::commit_identity_reconciliation_epoch(&store_id, &key_epoch).await?;
        manager.event_log.key_epoch = trigger_event_id.as_str().to_owned();
        save_key_epoch(&manager.vault.store_id, &manager.event_log.key_epoch).await?;

        let new_keys = nook_core::VaultKeys {
            secrets_key: SymmetricKey::parse(&plan.new_secrets_key)?,
            members_key: SymmetricKey::parse(&plan.new_members_key)?,
        };
        manager.apply_vault_keys(new_keys.secrets_key.as_str(), new_keys.members_key.as_str())?;
        manager.apply_event_projection_to_session().await?;
        manager
            .queue_event_outbox_for_current_provider(&checkpoint_id, &checkpoint_event.bytes)
            .await?;
        manager
            .queue_event_outbox_for_current_provider(&trigger_event_id, &trigger_event.bytes)
            .await?;
        manager.persist_projection_cache().await?;
        identity_record::commit_identity_reconciliation_checkpoint(
            &store_id,
            &key_epoch,
            &checkpoint,
        )
        .await?;
        let identity = manager.device_identity()?;
        manager.ensure_identity_after_connect(&identity).await?;
        Ok(())
    }
}

impl NookVaultManager {
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
    use nook_core::{
        IsoTimestamp, PasswordEntryId, SigningIdentity, VaultEvent, VaultEventBody,
        VaultEventSchemaVersion,
    };
    use std::slice;

    impl SecurityEpochRecoveryPlan {
        fn fixture() -> anyhow::Result<Self> {
            let signing = SigningIdentity::generate()?.0;
            let event = VaultEvent::sign(
                VaultEventBody {
                    schema_version: VaultEventSchemaVersion::CURRENT,
                    store_id: StoreId::parse("store_epochstate1")?,
                    actor_id: signing.actor_id()?,
                    actor_signing_public_key: signing.public_key(),
                    parents: Vec::new(),
                    created_at: IsoTimestamp::parse("2026-08-15T00:00:00Z")?,
                    key_epoch: EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?,
                    operations: vec![VaultOperation::VaultCleared],
                },
                signing.signing_key(),
            )?;
            let yaml = String::from_utf8(nook_core::serialize_event_storage_yaml(&event)?)?;
            Ok(Self {
                new_secrets_key: String::new(),
                new_members_key: String::new(),
                trigger_event_yaml: yaml.clone(),
                checkpoint_event_yaml: yaml,
            })
        }
    }

    #[test]
    fn preparation_rejects_persisted_epoch_before_decoding_checkpoint() -> anyhow::Result<()> {
        let mut plan = SecurityEpochRecoveryPlan::fixture()?;
        plan.checkpoint_event_yaml = "invalid checkpoint".to_owned();
        let persisted = IdentityVaultEventId::parse(&format!("sha256u:{}", "E".repeat(43)))?;
        match plan.prepare_execution("store_epochstate1", Some(&persisted)) {
            Err(NookError::Database(message)) => {
                assert_eq!(
                    message,
                    "Persisted security epoch does not match its recovery plan."
                );
            }
            Err(error) => return Err(error.into()),
            Ok(_) => anyhow::bail!("Mismatched persisted epoch was accepted"),
        }
        Ok(())
    }

    #[test]
    fn rotation_frontier_requires_the_captured_checkpoint() -> anyhow::Result<()> {
        let epoch = IdentityVaultEventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let other = EventId::parse(&format!("sha256u:{}", "E".repeat(43)))?;
        let mut prepared = PreparedEpochRotation {
            previous_key_epoch: epoch.clone(),
            previous_checkpoint: epoch,
            new_keys: nook_core::generate_vault_keys()?,
            secrets: Vec::new(),
            members_checkpoint_hash: nook_core::Sha256Hex::from_trusted("00".repeat(32)),
            rotated_meta_records: Vec::new(),
        };
        assert!(prepared.rotation_frontier_matches(&[]));
        assert!(!prepared.rotation_frontier_matches(slice::from_ref(&other)));
        prepared.previous_checkpoint = IdentityVaultEventId::parse(other.as_str())?;
        assert!(!prepared.rotation_frontier_matches(&[]));
        assert!(prepared.rotation_frontier_matches(slice::from_ref(&other)));
        assert!(!prepared.rotation_frontier_matches(&[other.clone(), other]));
        Ok(())
    }

    #[test]
    fn detects_a_verified_epoch_after_the_prepared_epoch() -> anyhow::Result<()> {
        let committed = CommittedSecurityEpochExecution {
            execution: SecurityEpochRecoveryPlan::fixture()?
                .prepare_execution("store_epochstate1", None)?,
        };
        let latest = EventId::parse(&format!("sha256u:{}", "E".repeat(43)))?;
        let projection = nook_core::VaultProjection {
            epoch: ProjectionEpoch::Current(nook_core::KeyEpoch(latest)),
            ..Default::default()
        };
        assert!(committed.projection_advanced_past(&projection));
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
        let entries = PreparedEpochRotation::rewrap_password_entries(
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
