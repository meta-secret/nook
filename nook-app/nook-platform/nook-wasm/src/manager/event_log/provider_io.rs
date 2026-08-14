use std::collections::BTreeSet;

use super::{
    EventId, NookError, NookVaultManager, VaultOperation, fetch_drive_event_optional,
    fetch_github_event, fetch_icloud_event, iso_timestamp, list_drive_event_ids,
    list_github_event_ids, list_icloud_event_ids, load_local_event_store,
    put_drive_event_if_absent, put_github_event_if_absent, put_icloud_event_if_absent,
    save_event_bytes, save_heads, save_signing_seed,
};

fn is_github_event_missing(message: &str) -> bool {
    message.contains("Event file missing at")
}

fn is_icloud_event_missing(message: &str) -> bool {
    message.contains("is missing.")
}

impl NookVaultManager {
    pub(super) async fn list_current_provider_event_ids(
        &self,
    ) -> Result<BTreeSet<EventId>, NookError> {
        let raw_ids = match self.storage.mode {
            nook_core::StorageMode::Github => {
                list_github_event_ids(&self.storage.access_token, &self.storage.remote_ref).await?
            }
            nook_core::StorageMode::GoogleDrive => {
                list_drive_event_ids(&self.storage.access_token, &self.storage.drive_event_parent)
                    .await?
            }
            nook_core::StorageMode::ICloud => {
                list_icloud_event_ids(
                    &self.storage.access_token,
                    &self.storage.icloud_event_target,
                )
                .await?
            }
            nook_core::StorageMode::Local => Vec::new(),
        };
        raw_ids
            .into_iter()
            .map(|raw| EventId::parse(&raw).map_err(NookError::from))
            .collect()
    }

    pub(super) async fn fetch_current_provider_event_optional(
        &self,
        event_id: &EventId,
    ) -> Result<Option<Vec<u8>>, NookError> {
        match self.storage.mode {
            nook_core::StorageMode::Github => {
                match fetch_github_event(
                    &self.storage.access_token,
                    &self.storage.remote_ref,
                    event_id,
                )
                .await
                {
                    Ok(bytes) => Ok(Some(bytes)),
                    Err(NookError::GitHub(message)) if is_github_event_missing(&message) => {
                        Ok(None)
                    }
                    Err(err) => Err(err),
                }
            }
            nook_core::StorageMode::GoogleDrive => {
                fetch_drive_event_optional(
                    &self.storage.access_token,
                    &self.storage.drive_event_parent,
                    event_id,
                )
                .await
            }
            nook_core::StorageMode::ICloud => {
                match fetch_icloud_event(
                    &self.storage.access_token,
                    &self.storage.icloud_event_target,
                    event_id,
                )
                .await
                {
                    Ok(bytes) => Ok(Some(bytes)),
                    Err(NookError::ICloud(message)) if is_icloud_event_missing(&message) => {
                        Ok(None)
                    }
                    Err(err) => Err(err),
                }
            }
            nook_core::StorageMode::Local => Ok(None),
        }
    }

    pub(super) async fn put_current_provider_event_if_absent(
        &self,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        match self.storage.mode {
            nook_core::StorageMode::Github => {
                put_github_event_if_absent(
                    &self.storage.access_token,
                    &self.storage.remote_ref,
                    event_id,
                    bytes,
                )
                .await
            }
            nook_core::StorageMode::GoogleDrive => put_drive_event_if_absent(
                &self.storage.access_token,
                &self.storage.drive_event_parent,
                event_id,
                bytes,
            )
            .await
            .map(|_| ()),
            nook_core::StorageMode::ICloud => {
                put_icloud_event_if_absent(
                    &self.storage.access_token,
                    &self.storage.icloud_event_target,
                    event_id,
                    bytes,
                )
                .await
            }
            nook_core::StorageMode::Local => Ok(()),
        }
    }

    pub(in crate::manager) async fn bootstrap_event_log_genesis(
        &mut self,
    ) -> Result<(), NookError> {
        let created_at = nook_core::IsoTimestamp::parse(&iso_timestamp())?;
        self.bootstrap_event_log_genesis_inner(&created_at, None)
            .await
    }

    pub(in crate::manager) async fn bootstrap_simple_event_log_genesis(
        &mut self,
        pending: &crate::storage::identity_record::PendingSimpleGenesis,
    ) -> Result<(), NookError> {
        self.bootstrap_event_log_genesis_inner(&pending.created_at, Some(pending))
            .await
    }

    async fn bootstrap_event_log_genesis_inner(
        &mut self,
        created_at: &nook_core::IsoTimestamp,
        pending: Option<&crate::storage::identity_record::PendingSimpleGenesis>,
    ) -> Result<(), NookError> {
        self.activate_event_log_mode().await?;
        let signing = self.ensure_signing_identity().await?;
        let actor_id = signing.actor_id()?;
        let signing_public_key = signing.public_key();
        let key_epoch = self.ensure_key_epoch().await?;
        let identity = self.device_identity()?;
        let mut operations = vec![VaultOperation::VaultImported {
            source_content_hash: nook_core::Sha256Hex::from_trusted("0".repeat(64)),
            secrets: vec![],
            password_entries: self.vault.password_entries.clone(),
        }];
        if !self.vault.secrets_key.is_empty() && !self.vault.members_key.is_empty() {
            let secrets_key = nook_core::SymmetricKey::parse(&self.vault.secrets_key)?;
            let members_key = nook_core::SymmetricKey::parse(&self.vault.members_key)?;
            match self.vault.architecture.vault_type {
                nook_core::VaultType::Simple => {
                    let auth_record =
                        nook_core::genesis_auth_record(&identity, &secrets_key, &members_key)?;
                    let envelopes = nook_core::parse_auth_envelopes(auth_record.value.as_str())?;
                    operations.push(VaultOperation::JoinApproved {
                        device_id: identity.device_id().clone(),
                        encryption_public_key: identity.public_key(),
                        signing_public_key: signing_public_key.clone(),
                        label: nook_core::MemberLabel::from_trusted("genesis".to_owned()),
                        secrets_key_ciphertext: envelopes.secrets_key,
                        members_key_ciphertext: envelopes.members_key,
                    });
                }
                nook_core::VaultType::Sentinel => {
                    operations.push(VaultOperation::SentinelParticipantEnrolled {
                        device_id: identity.device_id().clone(),
                        encryption_public_key: identity.public_key(),
                        signing_public_key: signing_public_key.clone(),
                        label: nook_core::MemberLabel::from_trusted("genesis".to_owned()),
                    });
                }
            }
        }
        let body = nook_core::VaultEventBody {
            schema_version: nook_core::VaultEventSchemaVersion::CURRENT,
            store_id: nook_core::StoreId::parse(&self.vault.store_id)?,
            actor_id,
            actor_signing_public_key: signing_public_key,
            parents: Vec::new(),
            created_at: created_at.clone(),
            key_epoch: EventId::parse(&key_epoch)?,
            operations,
        };
        let proposed = nook_core::VaultEvent::sign(body, signing.signing_key())?;
        let proposed_bytes = nook_core::serialize_event_storage_yaml(&proposed)
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        let bytes = if let Some(pending) = pending {
            let proposed_yaml = String::from_utf8(proposed_bytes)
                .map_err(|error| NookError::Serialization(error.to_string()))?;
            let pinned = crate::storage::identity_record::persist_simple_genesis_event(
                pending,
                proposed_yaml,
                self.event_log.signing_seed.clone(),
            )
            .await?;
            self.event_log.signing_seed.clone_from(&pinned.signing_seed);
            save_signing_seed(&pinned.signing_seed).await?;
            pinned.event_yaml.into_bytes()
        } else {
            proposed_bytes
        };
        let import = nook_core::parse_event_storage_bytes(&bytes)?;
        let expected_store_id = nook_core::StoreId::parse(&self.vault.store_id)?;
        let event_id = import.validate_envelope(&expected_store_id)?;
        save_event_bytes(&self.vault.store_id, event_id.as_str(), &bytes).await?;
        self.event_log.heads = vec![event_id.as_str().to_owned()];
        save_heads(&self.vault.store_id, &self.event_log.heads).await?;
        self.queue_event_outbox_for_current_provider(&event_id, &bytes)
            .await?;
        Ok(())
    }

    /// Write Sentinel genesis as one immutable root event. The complete roster and
    /// complete encrypted share set are deliberately inseparable here: no
    /// partially enrolled/openable Sentinel event history is ever published.
    pub(in crate::manager) async fn bootstrap_sentinel_genesis_event(
        &mut self,
        participants: &[nook_core::SentinelGenesisParticipant],
        deliveries: &[nook_core::SentinelGenesisShareDelivery],
    ) -> Result<(), NookError> {
        self.activate_event_log_mode().await?;
        let signing = self.ensure_signing_identity().await?;
        let actor_id = signing.actor_id()?;
        let key_epoch = self.ensure_key_epoch().await?;
        let mut operations = vec![VaultOperation::VaultImported {
            source_content_hash: nook_core::Sha256Hex::from_trusted("0".repeat(64)),
            secrets: vec![],
            password_entries: vec![],
        }];
        operations.extend(participants.iter().map(|participant| {
            VaultOperation::SentinelParticipantEnrolled {
                device_id: participant.device_id.clone(),
                encryption_public_key: participant.encryption_public_key.clone(),
                signing_public_key: participant.signing_public_key.clone(),
                label: nook_core::MemberLabel::from_trusted(participant.label.clone()),
            }
        }));
        operations.push(VaultOperation::SentinelSharesIssued {
            shares: deliveries
                .iter()
                .map(|delivery| nook_core::SentinelShareIssuedPayload {
                    device_id: delivery.device_id.clone(),
                    version: delivery.share.version,
                    threshold: delivery.share.threshold,
                    required_participants: delivery.share.required_participants,
                    share_index: delivery.share.share_index,
                    ciphertext: delivery.share.ciphertext.clone(),
                })
                .collect(),
        });
        let body = nook_core::VaultEventBody {
            schema_version: nook_core::VaultEventSchemaVersion::CURRENT,
            store_id: nook_core::StoreId::parse(&self.vault.store_id)?,
            actor_id,
            actor_signing_public_key: signing.public_key(),
            parents: Vec::new(),
            created_at: nook_core::IsoTimestamp::parse(&iso_timestamp())?,
            key_epoch: EventId::parse(&key_epoch)?,
            operations,
        };
        let genesis = nook_core::VaultEvent::sign(body, signing.signing_key())?;
        let event_id = genesis.id()?;
        let bytes = nook_core::serialize_event_storage_yaml(&genesis)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        save_event_bytes(&self.vault.store_id, event_id.as_str(), &bytes).await?;
        self.event_log.heads = vec![event_id.as_str().to_owned()];
        save_heads(&self.vault.store_id, &self.event_log.heads).await?;
        self.queue_event_outbox_for_current_provider(&event_id, &bytes)
            .await?;
        Ok(())
    }

    /// Idempotently finish the event-log portion of Sentinel genesis. If a crash
    /// happened after event bytes were indexed but before heads were written,
    /// rebuild heads from the existing graph rather than creating a second root.
    pub(in crate::manager) async fn ensure_sentinel_genesis_event(
        &mut self,
        participants: &[nook_core::SentinelGenesisParticipant],
        deliveries: &[nook_core::SentinelGenesisShareDelivery],
    ) -> Result<(), NookError> {
        let store = load_local_event_store(&self.vault.store_id).await?;
        if store.event_ids().is_empty() {
            return self
                .bootstrap_sentinel_genesis_event(participants, deliveries)
                .await;
        }
        self.activate_event_log_mode().await?;
        let graph = store.load_graph(&self.vault.store_id)?;
        self.event_log.heads = graph
            .heads()
            .into_iter()
            .map(|head| head.as_str().to_owned())
            .collect();
        save_heads(&self.vault.store_id, &self.event_log.heads).await
    }

    pub(in crate::manager) async fn persist_vault_change(
        &mut self,
        operations: Vec<VaultOperation>,
    ) -> Result<(), NookError> {
        self.ensure_event_log_ready().await?;
        if operations.is_empty() {
            self.persist_projection_cache().await?;
            self.flush_sync_event_outbox().await?;
        } else {
            self.append_vault_operations(operations).await?;
        }
        Ok(())
    }

    pub(in crate::manager) async fn sync_event_log_from_storage(
        &mut self,
    ) -> Result<bool, NookError> {
        if !self.ensure_event_log_mode().await? {
            return Ok(false);
        }
        let before = self.event_log.heads.clone();
        self.sync_events_from_current_provider().await?;
        let changed = self.event_log.heads != before;
        if changed
            && (self.vault.crypto.is_unlocked()
                || self.ensure_vault_crypto_from_cache().await.is_ok())
        {
            self.apply_event_projection_to_session().await?;
        }
        Ok(changed)
    }
}
