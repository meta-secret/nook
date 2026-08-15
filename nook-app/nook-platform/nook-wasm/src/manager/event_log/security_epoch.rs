use super::{
    BuiltVaultEvent, NookError, NookVaultManager, VaultOperation,
    members_checkpoint_hash_from_roster, rewrapped_vault_meta_records_for_epoch, save_key_epoch,
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

impl NookVaultManager {
    fn prepare_security_epoch_rotation(
        &self,
        previous_key_epoch: nook_core::IdentityVaultEventId,
        previous_checkpoint: nook_core::IdentityVaultEventId,
    ) -> Result<PreparedEpochRotation, NookError> {
        let old_secrets_key = nook_core::SymmetricKey::parse(&self.vault.secrets_key)?;
        let old_members_key = nook_core::SymmetricKey::parse(&self.vault.members_key)?;
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
    ) -> Result<SecurityEpochRecoveryPlan, NookError> {
        let previous_key_epoch = prepared.previous_key_epoch.clone();
        let previous_checkpoint = prepared.previous_checkpoint.clone();
        let parents = self
            .load_event_heads()
            .await?
            .into_iter()
            .map(|parent| nook_core::EventId::parse(&parent))
            .collect::<Result<Vec<_>, _>>()?;
        if !Self::rotation_frontier_matches(&prepared, &parents) {
            return Err(NookError::Database(
                "Vault changed while preparing security epoch rotation; retry.".to_owned(),
            ));
        }
        let password_entries =
            rewrap_password_entries(&self.vault.password_entries, &prepared.new_keys, &trigger)?;
        let previous_epoch = nook_core::EventId::parse(prepared.previous_key_epoch.as_str())?;
        let trigger_event = self
            .build_vault_operations_event(vec![trigger], parents, previous_epoch)
            .await?;
        let trigger_event_id = trigger_event.event.id()?;
        let checkpoint_event = self
            .build_vault_operations_event(
                vec![VaultOperation::EpochCheckpoint {
                    secrets: prepared.secrets.clone(),
                    members_checkpoint_hash: prepared.members_checkpoint_hash.clone(),
                    rotated_meta_records: prepared.rotated_meta_records,
                    password_entries: nook_core::EpochPasswordState::Replace(password_entries),
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
        let store_id = nook_core::StoreId::parse(&self.vault.store_id)?;
        crate::storage::identity_record::mark_identity_reconciliation_pending(
            &store_id,
            &previous_key_epoch,
            &previous_checkpoint,
            plan_envelope,
        )
        .await?;
        Ok(plan)
    }

    async fn execute_security_epoch_recovery_plan(
        &mut self,
        plan: SecurityEpochRecoveryPlan,
        persisted_key_epoch: Option<nook_core::IdentityVaultEventId>,
    ) -> Result<(), NookError> {
        let store_id = nook_core::StoreId::parse(&self.vault.store_id)?;
        let trigger_event = built_event_from_yaml(&plan.trigger_event_yaml)?;
        let trigger_event_id = trigger_event.event.id()?;
        let key_epoch = nook_core::IdentityVaultEventId::parse(trigger_event_id.as_str())?;
        if persisted_key_epoch
            .as_ref()
            .is_some_and(|persisted| persisted != &key_epoch)
        {
            return Err(NookError::Database(
                "Persisted security epoch does not match its recovery plan.".to_owned(),
            ));
        }
        let checkpoint_event = built_event_from_yaml(&plan.checkpoint_event_yaml)?;
        let checkpoint_id = checkpoint_event.event.id()?;
        let checkpoint = nook_core::IdentityVaultEventId::parse(checkpoint_id.as_str())?;
        self.event_log.heads = crate::storage::event_db::save_security_epoch_event_pair(
            &self.vault.store_id,
            &trigger_event.event,
            &trigger_event.bytes,
            &checkpoint_event.event,
            &checkpoint_event.bytes,
        )
        .await?;
        crate::storage::identity_record::commit_identity_reconciliation_epoch(
            &store_id, &key_epoch,
        )
        .await?;
        self.event_log.key_epoch = trigger_event_id.as_str().to_owned();
        save_key_epoch(&self.vault.store_id, &self.event_log.key_epoch).await?;

        let new_keys = nook_core::VaultKeys {
            secrets_key: nook_core::SymmetricKey::parse(&plan.new_secrets_key)?,
            members_key: nook_core::SymmetricKey::parse(&plan.new_members_key)?,
        };
        self.apply_vault_keys(new_keys.secrets_key.as_str(), new_keys.members_key.as_str())?;
        self.apply_event_projection_to_session().await?;
        self.queue_event_outbox_for_current_provider(&checkpoint_id, &checkpoint_event.bytes)
            .await?;
        self.queue_event_outbox_for_current_provider(&trigger_event_id, &trigger_event.bytes)
            .await?;
        self.persist_projection_cache().await?;
        crate::storage::identity_record::commit_identity_reconciliation_checkpoint(
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
        let store_id = nook_core::StoreId::parse(&self.vault.store_id)?;
        let Some(pending) =
            crate::storage::identity_record::load_pending_identity_rotation(&store_id).await?
        else {
            return Ok(false);
        };
        let (plan_envelope, persisted_key_epoch) = match pending {
            crate::storage::identity_record::PendingIdentityRotation::Prepared {
                plan_envelope,
            } => (plan_envelope, None),
            crate::storage::identity_record::PendingIdentityRotation::EpochCommitted {
                key_epoch,
                plan_envelope,
            } => (plan_envelope, Some(key_epoch)),
        };
        let plan_json = Zeroizing::new(identity.open_utf8(&plan_envelope)?);
        let plan: SecurityEpochRecoveryPlan = serde_json::from_str(&plan_json)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        self.execute_security_epoch_recovery_plan(plan, persisted_key_epoch)
            .await?;
        Ok(true)
    }

    pub(in crate::manager) async fn rotate_security_epoch(
        &mut self,
        trigger: VaultOperation,
    ) -> Result<(), NookError> {
        self.activate_event_log_mode().await?;
        let previous_key_epoch =
            nook_core::IdentityVaultEventId::parse(&self.ensure_key_epoch().await?)?;
        let previous_checkpoint =
            nook_core::IdentityVaultEventId::parse(&self.ensure_causal_event_checkpoint().await?)?;
        let prepared =
            self.prepare_security_epoch_rotation(previous_key_epoch, previous_checkpoint)?;
        let plan = self
            .persist_security_epoch_recovery_plan(prepared, trigger)
            .await?;
        self.execute_security_epoch_recovery_plan(plan, None).await
    }

    pub(in crate::manager) async fn rotate_password_security_epoch(
        &mut self,
        entry_id: nook_core::PasswordEntryId,
        password: &str,
        work_factor: u8,
    ) -> Result<nook_core::PasswordEnvelope, NookError> {
        self.activate_event_log_mode().await?;

        let previous_key_epoch =
            nook_core::IdentityVaultEventId::parse(&self.ensure_key_epoch().await?)?;
        let previous_checkpoint =
            nook_core::IdentityVaultEventId::parse(&self.ensure_causal_event_checkpoint().await?)?;
        let prepared =
            self.prepare_security_epoch_rotation(previous_key_epoch, previous_checkpoint)?;
        let envelope = nook_core::attach_password_envelope_with_work_factor(
            &prepared.new_keys,
            password,
            work_factor,
        )?;

        let plan = self
            .persist_security_epoch_recovery_plan(
                prepared,
                VaultOperation::PasswordRotated {
                    entry_id,
                    envelope: envelope.clone(),
                },
            )
            .await?;
        self.execute_security_epoch_recovery_plan(plan, None)
            .await?;
        Ok(envelope)
    }
}
