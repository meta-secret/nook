use super::{
    NookError, NookVaultManager, VaultOperation, members_checkpoint_hash_from_roster,
    rewrap_vault_meta_for_epoch, save_key_epoch,
};

struct PreparedEpochRotation {
    previous_key_epoch: nook_core::IdentityVaultEventId,
    previous_checkpoint: nook_core::IdentityVaultEventId,
    records_snapshot: Vec<nook_core::StoredSecretRecord>,
    old_members_key: nook_core::SymmetricKey,
    new_keys: nook_core::VaultKeys,
    secrets: Vec<nook_core::EncryptedSecretPayload>,
    members_checkpoint_hash: nook_core::Sha256Hex,
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

    async fn adopt_latest_security_epoch(
        &mut self,
        prepared: &PreparedEpochRotation,
    ) -> Result<nook_core::IdentityVaultEventId, NookError> {
        let new_epoch = self.event_log.heads.last().cloned().ok_or_else(|| {
            NookError::Database("Security epoch rotation did not produce an event head.".to_owned())
        })?;
        let store_id = nook_core::StoreId::parse(&self.vault.store_id)?;
        let key_epoch = nook_core::IdentityVaultEventId::parse(&new_epoch)?;
        crate::storage::identity_record::mark_identity_reconciliation_pending(
            &store_id,
            &prepared.previous_key_epoch,
            &prepared.previous_checkpoint,
            &key_epoch,
        )
        .await?;
        let previous_in_memory_epoch = self.event_log.key_epoch.clone();
        self.event_log.key_epoch = new_epoch;
        if let Err(error) = save_key_epoch(&self.vault.store_id, &self.event_log.key_epoch).await {
            self.event_log.key_epoch = previous_in_memory_epoch;
            return Err(error);
        }
        Ok(key_epoch)
    }

    async fn commit_security_epoch_rotation(
        &mut self,
        prepared: PreparedEpochRotation,
        key_epoch: nook_core::IdentityVaultEventId,
    ) -> Result<(), NookError> {
        let store_id = nook_core::StoreId::parse(&self.vault.store_id)?;
        self.apply_vault_keys(
            prepared.new_keys.secrets_key.as_str(),
            prepared.new_keys.members_key.as_str(),
        )?;
        self.rewrap_device_meta_for_epoch(
            &prepared.records_snapshot,
            &prepared.old_members_key,
            &prepared.new_keys,
        )?;
        for payload in &prepared.secrets {
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
        self.append_vault_operations(vec![VaultOperation::EpochCheckpoint {
            secrets: prepared.secrets,
            members_checkpoint_hash: prepared.members_checkpoint_hash,
        }])
        .await?;
        let checkpoint = self.event_log.heads.last().ok_or_else(|| {
            NookError::Database(
                "Security epoch checkpoint did not produce an event head.".to_owned(),
            )
        })?;
        let checkpoint = nook_core::IdentityVaultEventId::parse(checkpoint)?;
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
        self.append_vault_operations(vec![trigger]).await?;
        let key_epoch = self.adopt_latest_security_epoch(&prepared).await?;
        self.commit_security_epoch_rotation(prepared, key_epoch)
            .await
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

        self.append_vault_operations(vec![VaultOperation::PasswordRotated {
            entry_id,
            envelope: envelope.clone(),
        }])
        .await?;
        let key_epoch = self.adopt_latest_security_epoch(&prepared).await?;
        self.commit_security_epoch_rotation(prepared, key_epoch)
            .await?;
        Ok(envelope)
    }
}
