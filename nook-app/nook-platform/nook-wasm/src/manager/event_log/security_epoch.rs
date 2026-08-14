use super::{
    BuiltVaultEvent, NookError, NookVaultManager, VaultOperation,
    members_checkpoint_hash_from_roster, rewrap_vault_meta_for_epoch, save_key_epoch,
};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

struct PreparedEpochRotation {
    previous_key_epoch: nook_core::IdentityVaultEventId,
    previous_checkpoint: nook_core::IdentityVaultEventId,
    records_snapshot: Vec<nook_core::StoredSecretRecord>,
    old_members_key: nook_core::SymmetricKey,
    new_keys: nook_core::VaultKeys,
    secrets: Vec<nook_core::EncryptedSecretPayload>,
    members_checkpoint_hash: nook_core::Sha256Hex,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecurityEpochRecoveryPlan {
    records_snapshot: Vec<nook_core::StoredSecretRecord>,
    old_members_key: String,
    new_secrets_key: String,
    new_members_key: String,
    secrets: Vec<nook_core::EncryptedSecretPayload>,
    members_checkpoint_hash: nook_core::Sha256Hex,
    trigger_event_yaml: String,
    checkpoint_event_yaml: String,
}

impl Drop for SecurityEpochRecoveryPlan {
    fn drop(&mut self) {
        self.old_members_key.zeroize();
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
    fn rewrap_device_meta_for_epoch(
        &mut self,
        records_snapshot: &[nook_core::StoredSecretRecord],
        old_members_key: &nook_core::SymmetricKey,
        new_keys: &nook_core::VaultKeys,
    ) -> Result<(), NookError> {
        let identity = self.device_identity()?;
        rewrap_vault_meta_for_epoch(
            &mut self.vault.meta,
            &identity,
            records_snapshot,
            old_members_key,
            new_keys,
        )?;
        Ok(())
    }

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
        Ok(PreparedEpochRotation {
            previous_key_epoch,
            previous_checkpoint,
            records_snapshot,
            old_members_key,
            new_keys,
            secrets,
            members_checkpoint_hash,
        })
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
            records_snapshot: prepared.records_snapshot,
            old_members_key: prepared.old_members_key.as_str().to_owned(),
            new_secrets_key: prepared.new_keys.secrets_key.as_str().to_owned(),
            new_members_key: prepared.new_keys.members_key.as_str().to_owned(),
            secrets: prepared.secrets,
            members_checkpoint_hash: prepared.members_checkpoint_hash,
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
        self.persist_built_vault_event(trigger_event).await?;
        crate::storage::identity_record::commit_identity_reconciliation_epoch(
            &store_id, &key_epoch,
        )
        .await?;
        self.event_log.key_epoch = trigger_event_id.into_inner();
        save_key_epoch(&self.vault.store_id, &self.event_log.key_epoch).await?;

        let old_members_key = nook_core::SymmetricKey::parse(&plan.old_members_key)?;
        let new_keys = nook_core::VaultKeys {
            secrets_key: nook_core::SymmetricKey::parse(&plan.new_secrets_key)?,
            members_key: nook_core::SymmetricKey::parse(&plan.new_members_key)?,
        };
        self.apply_vault_keys(new_keys.secrets_key.as_str(), new_keys.members_key.as_str())?;
        self.rewrap_device_meta_for_epoch(&plan.records_snapshot, &old_members_key, &new_keys)?;
        for payload in &plan.secrets {
            self.vault.meta.secrets.insert(
                payload.id.clone(),
                (
                    payload.secret_type,
                    nook_core::StoredRecordPayload::from_trusted(
                        payload.ciphertext.as_str().to_owned(),
                    ),
                ),
            );
        }
        let checkpoint_event = built_event_from_yaml(&plan.checkpoint_event_yaml)?;
        let checkpoint =
            nook_core::IdentityVaultEventId::parse(checkpoint_event.event.id()?.as_str())?;
        self.persist_built_vault_event(checkpoint_event).await?;
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
        let plan_json = Zeroizing::new(identity.open_utf8(&pending.plan_envelope)?);
        let plan: SecurityEpochRecoveryPlan = serde_json::from_str(&plan_json)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        self.execute_security_epoch_recovery_plan(plan, pending.key_epoch)
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
        let previous_checkpoint = match self.load_event_heads().await?.last() {
            Some(head) => nook_core::IdentityVaultEventId::parse(head)?,
            None => previous_key_epoch.clone(),
        };
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
        let previous_checkpoint = match self.load_event_heads().await?.last() {
            Some(head) => nook_core::IdentityVaultEventId::parse(head)?,
            None => previous_key_epoch.clone(),
        };
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
