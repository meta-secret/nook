#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::EventDbSaveEventBytes;
use crate::EventDbSaveHeads;
use crate::IdentityDbSetIdentityMemberSigningPublicKey;
use crate::NookDatabase;

use crate::storage::identity_record;
use nook_core::{
    IsoTimestamp, MemberLabel, SigningIdentity, StorageMode, StoreId, SymmetricKey, VaultEvent,
    VaultEventSchemaVersion, VaultType,
};
use std::collections::BTreeSet;

use super::{
    DriveEventStore, EventId, GitHubEventStore, ICloudEventStore, NookError, NookVaultManager,
    VaultOperation, iso_timestamp,
};

impl NookError {
    fn is_github_event_missing(&self) -> bool {
        matches!(self, Self::GitHub(message) if message.contains("Event file missing at"))
    }
}

impl NookError {
    fn is_icloud_event_missing(&self) -> bool {
        matches!(self, Self::ICloud(message) if message.contains("is missing."))
    }
}

struct SimpleGenesisOperationsInput<'a> {
    pending: Option<&'a identity_record::PendingSimpleGenesis>,
    identity: &'a nook_core::AppKey,
    signing_public_key: &'a nook_core::DeviceSigningPublicKey,
    keys: &'a nook_core::VaultKeys,
    created_at: &'a nook_core::IsoTimestamp,
}

impl SimpleGenesisOperationsInput<'_> {
    async fn operations(&self) -> Result<Vec<VaultOperation>, NookError> {
        let Some(pending) = self.pending else {
            let auth_record = self
                .identity
                .auth_record(&self.keys.secrets_key, &self.keys.members_key)?;
            let envelopes = nook_core::AuthEnvelopes::parse(auth_record.value.as_str())?;
            return Ok(vec![VaultOperation::JoinApproved {
                device_id: self.identity.device_id().clone(),
                encryption_public_key: self.identity.public_key(),
                signing_public_key: self.signing_public_key.clone(),
                label: MemberLabel::from_trusted("genesis".to_owned()),
                secrets_key_ciphertext: envelopes.secrets_key,
                members_key_ciphertext: envelopes.members_key,
            }]);
        };
        let identity_record = if let Some(staged) = pending.staged_identity() {
            staged
                .directory
                .identities()
                .iter()
                .find(|identity| identity.identity_id == pending.identity_id)
                .cloned()
                .ok_or_else(|| {
                    NookError::Database(
                        "Staged Simple genesis identity no longer exists.".to_owned(),
                    )
                })?
        } else {
            NookDatabase::set_identity_member_signing_public_key(
                IdentityDbSetIdentityMemberSigningPublicKey {
                    identity_id: &pending.identity_id,
                    app_id: self.identity.device_id(),
                    signing_public_key: self.signing_public_key,
                },
            )
            .await?;
            NookDatabase::load_identity(&pending.identity_id)
                .await?
                .ok_or_else(|| {
                    NookError::Database("Simple genesis identity no longer exists.".to_owned())
                })?
        };
        nook_core::SimpleIdentityGenesisOperationsInput {
            identity: &identity_record,
            keys: self.keys,
            current_app_id: self.identity.device_id(),
            current_signing_public_key: self.signing_public_key,
            created_at: self.created_at.as_str(),
        }
        .operations()
        .map_err(NookError::from)
    }
}

impl NookVaultManager {
    async fn simple_genesis_signing_identity(
        &mut self,
        pending: Option<&identity_record::PendingSimpleGenesis>,
    ) -> Result<nook_core::SigningIdentity, NookError> {
        let Some(pending) = pending.filter(|pending| pending.is_staged()) else {
            return self.ensure_signing_identity().await;
        };
        let app_key = self.device_identity()?;
        if let Some(seed) = pending.resume_signing_seed(&app_key)? {
            self.event_log.signing_seed = seed;
        }
        if self.event_log.signing_seed.is_empty() {
            self.event_log.signing_seed =
                NookDatabase::load_signing_seed().await?.ok_or_else(|| {
                    NookError::Database(
                        "Staged Simple genesis requires an enrolled member signing key.".to_owned(),
                    )
                })?;
        }
        let signing = SigningIdentity::from_seed_hex_stored(&self.event_log.signing_seed)?;
        let staged = pending.staged_identity().ok_or_else(|| {
            NookError::Database("Staged Simple genesis state disappeared.".to_owned())
        })?;
        let member = staged
            .directory
            .identities()
            .iter()
            .find(|identity| identity.identity_id == pending.identity_id)
            .and_then(|identity| {
                identity
                    .members
                    .iter()
                    .find(|member| member.app_id == *app_key.app_id())
            })
            .ok_or_else(|| NookError::Database("Staged genesis member disappeared.".to_owned()))?;
        if member.signing_public_key != signing.public_key() {
            return Err(NookError::Database(
                "Staged genesis signer does not match the authorized member.".to_owned(),
            ));
        }
        Ok(signing)
    }
}

impl NookVaultManager {
    pub(super) async fn list_current_provider_event_ids(
        &self,
    ) -> Result<BTreeSet<EventId>, NookError> {
        let raw_ids = match self.storage.mode {
            StorageMode::Github => {
                (GitHubEventStore {
                    pat: &self.storage.access_token,
                    repo: &self.storage.remote_ref,
                })
                .list_github_event_ids()
                .await?
            }
            StorageMode::GoogleDrive => {
                (DriveEventStore {
                    token: &self.storage.access_token,
                    parent: &self.storage.drive_event_parent,
                })
                .list_drive_event_ids()
                .await?
            }
            StorageMode::ICloud => {
                (ICloudEventStore {
                    web_auth_token: &self.storage.access_token,
                    target: &self.storage.icloud_event_target,
                })
                .list_icloud_event_ids()
                .await?
            }
            StorageMode::Local => Vec::new(),
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
            StorageMode::Github => {
                match (GitHubEventStore {
                    pat: &self.storage.access_token,
                    repo: &self.storage.remote_ref,
                })
                .fetch_github_event(event_id)
                .await
                {
                    Ok(bytes) => Ok(Some(bytes)),
                    Err(error) if error.is_github_event_missing() => Ok(None),
                    Err(err) => Err(err),
                }
            }
            StorageMode::GoogleDrive => {
                (DriveEventStore {
                    token: &self.storage.access_token,
                    parent: &self.storage.drive_event_parent,
                })
                .fetch_drive_event_optional(event_id)
                .await
            }
            StorageMode::ICloud => {
                match (ICloudEventStore {
                    web_auth_token: &self.storage.access_token,
                    target: &self.storage.icloud_event_target,
                })
                .fetch_icloud_event(event_id)
                .await
                {
                    Ok(bytes) => Ok(Some(bytes)),
                    Err(error) if error.is_icloud_event_missing() => Ok(None),
                    Err(err) => Err(err),
                }
            }
            StorageMode::Local => Ok(None),
        }
    }

    pub(super) async fn put_current_provider_event_if_absent(
        &self,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        match self.storage.mode {
            StorageMode::Github => {
                (GitHubEventStore {
                    pat: &self.storage.access_token,
                    repo: &self.storage.remote_ref,
                })
                .put_github_event_if_absent(event_id, bytes)
                .await
            }
            StorageMode::GoogleDrive => (DriveEventStore {
                token: &self.storage.access_token,
                parent: &self.storage.drive_event_parent,
            })
            .put_drive_event_if_absent(event_id, bytes)
            .await
            .map(|_| ()),
            StorageMode::ICloud => {
                (ICloudEventStore {
                    web_auth_token: &self.storage.access_token,
                    target: &self.storage.icloud_event_target,
                })
                .put_icloud_event_if_absent(event_id, bytes)
                .await
            }
            StorageMode::Local => Ok(()),
        }
    }

    pub(in crate::manager) async fn bootstrap_event_log_genesis(
        &mut self,
    ) -> Result<(), NookError> {
        let created_at = IsoTimestamp::parse(&crate::BrowserTimestamp::now().into_iso_string())?;
        self.bootstrap_event_log_genesis_inner(&created_at, None)
            .await
    }

    pub(in crate::manager) async fn bootstrap_simple_event_log_genesis(
        &mut self,
        pending: &identity_record::PendingSimpleGenesis,
    ) -> Result<(), NookError> {
        self.bootstrap_event_log_genesis_inner(&pending.created_at, Some(pending))
            .await
    }

    async fn bootstrap_event_log_genesis_inner(
        &mut self,
        created_at: &nook_core::IsoTimestamp,
        pending: Option<&identity_record::PendingSimpleGenesis>,
    ) -> Result<(), NookError> {
        self.activate_event_log_mode().await?;
        let signing = self.simple_genesis_signing_identity(pending).await?;
        let actor_id = signing.actor_id()?;
        let signing_public_key = signing.public_key();
        let key_epoch = self.ensure_key_epoch().await?;
        let identity = self.device_identity()?;
        let mut operations = vec![VaultOperation::VaultImported {
            source_content_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
            secrets: vec![],
            password_entries: self.vault.password_entries.clone(),
        }];
        if let crate::manager::session::VaultKeyMaterial::Available { secrets, members } =
            self.vault.key_material()
        {
            let secrets_key = SymmetricKey::parse(secrets)?;
            let members_key = SymmetricKey::parse(members)?;
            match self.vault.architecture.vault_type {
                VaultType::Simple => {
                    operations.extend(
                        SimpleGenesisOperationsInput {
                            pending,
                            identity: &identity,
                            signing_public_key: &signing_public_key,
                            keys: &nook_core::VaultKeys {
                                secrets_key,
                                members_key,
                            },
                            created_at,
                        }
                        .operations()
                        .await?,
                    );
                }
                VaultType::Sentinel => {
                    operations.push(VaultOperation::SentinelParticipantEnrolled {
                        device_id: identity.device_id().clone(),
                        encryption_public_key: identity.public_key(),
                        signing_public_key: signing_public_key.clone(),
                        label: MemberLabel::from_trusted("genesis".to_owned()),
                    });
                }
            }
        }
        let body = nook_core::VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: StoreId::parse(&self.vault.store_id)?,
            actor_id,
            actor_signing_public_key: signing_public_key,
            parents: Vec::new(),
            created_at: created_at.clone(),
            key_epoch: EventId::parse(&key_epoch)?,
            operations,
        };
        let proposed = VaultEvent::sign(body, signing.signing_key())?;
        let proposed_bytes: Vec<u8> = VaultEvent::serialize_event_storage_yaml(&proposed)
            .map_err(|e| NookError::Serialization(e.to_string()))?
            .into();
        let bytes = if let Some(pending) = pending {
            let app_key = self.device_identity()?;
            let proposed_yaml = String::from_utf8(proposed_bytes)
                .map_err(|error| NookError::Serialization(error.to_string()))?;
            let pinned = (pending)
                .pin_event(identity_record::SimpleGenesisEventInput {
                    app_key: &app_key,
                    proposed_yaml,
                    proposed_signing_seed: self.event_log.signing_seed.clone(),
                })
                .await?;
            self.event_log.signing_seed.clone_from(&pinned.signing_seed);
            let keyring_backed = NookDatabase::load_entry_for_app_id(app_key.app_id())
                .await?
                .is_some();
            if !pending.is_staged() && !keyring_backed {
                NookDatabase::save_signing_seed(&pinned.signing_seed).await?;
            }
            pinned.event_yaml.into_bytes()
        } else {
            proposed_bytes
        };
        let import = VaultEvent::parse_event_storage_bytes(&bytes.clone().into())?;
        let expected_store_id = StoreId::parse(&self.vault.store_id)?;
        let event_id = import.validate_envelope(&expected_store_id)?;
        NookDatabase::save_event_bytes(EventDbSaveEventBytes {
            store_id: &self.vault.store_id,
            event_id: event_id.as_str(),
            bytes: bytes.as_ref(),
        })
        .await?;
        self.event_log.heads = vec![event_id.as_str().to_owned()];
        NookDatabase::save_heads(EventDbSaveHeads {
            store_id: &self.vault.store_id,
            heads: &self.event_log.heads,
        })
        .await?;
        self.queue_event_outbox_for_current_provider(&event_id, bytes.as_ref())
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
            source_content_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
            secrets: vec![],
            password_entries: vec![],
        }];
        operations.extend(participants.iter().map(|participant| {
            VaultOperation::SentinelParticipantEnrolled {
                device_id: participant.device_id.clone(),
                encryption_public_key: participant.encryption_public_key.clone(),
                signing_public_key: participant.signing_public_key.clone(),
                label: MemberLabel::from_trusted(participant.label.clone()),
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
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: StoreId::parse(&self.vault.store_id)?,
            actor_id,
            actor_signing_public_key: signing.public_key(),
            parents: Vec::new(),
            created_at: IsoTimestamp::parse(&crate::BrowserTimestamp::now().into_iso_string())?,
            key_epoch: EventId::parse(&key_epoch)?,
            operations,
        };
        let genesis = VaultEvent::sign(body, signing.signing_key())?;
        let event_id = genesis.id()?;
        let bytes = VaultEvent::serialize_event_storage_yaml(&genesis)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        NookDatabase::save_event_bytes(EventDbSaveEventBytes {
            store_id: &self.vault.store_id,
            event_id: event_id.as_str(),
            bytes: bytes.as_ref(),
        })
        .await?;
        self.event_log.heads = vec![event_id.as_str().to_owned()];
        NookDatabase::save_heads(EventDbSaveHeads {
            store_id: &self.vault.store_id,
            heads: &self.event_log.heads,
        })
        .await?;
        self.queue_event_outbox_for_current_provider(&event_id, bytes.as_ref())
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
        let store = NookDatabase::load_local_event_store(&self.vault.store_id).await?;
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
        NookDatabase::save_heads(EventDbSaveHeads {
            store_id: &self.vault.store_id,
            heads: &self.event_log.heads,
        })
        .await
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

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn provider_missing_event_errors_are_classified_by_their_storage() {
        assert!(
            NookError::GitHub("Event file missing at path".to_owned()).is_github_event_missing()
        );
        assert!(!NookError::GitHub("provider unavailable".to_owned()).is_github_event_missing());
        assert!(NookError::ICloud("event is missing.".to_owned()).is_icloud_event_missing());
        assert!(!NookError::ICloud("provider unavailable".to_owned()).is_icloud_event_missing());
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn local_provider_io_dispatches_without_remote_access() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager.storage.mode = StorageMode::Local;
        let event_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;

        assert!(manager.list_current_provider_event_ids().await?.is_empty());
        assert_eq!(
            manager
                .fetch_current_provider_event_optional(&event_id)
                .await?,
            None
        );
        manager
            .put_current_provider_event_if_absent(&event_id, b"ignored")
            .await?;
        assert!(!manager.sync_event_log_from_storage().await?);
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn local_genesis_is_idempotently_reused_by_sentinel_guard() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager
            .delete_local_browser_data()
            .await
            .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
        manager
            .finish_pin_device_protection("provider-io-test-pin".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("protect device: {error:?}"))?;
        let identity = manager.device_identity()?;
        manager.initialize_genesis_vault(&identity)?;
        manager.vault.store_id = nook_core::StoreId::generate()?.to_string();

        manager.bootstrap_event_log_genesis().await?;
        assert_eq!(manager.event_log.heads.len(), 1);
        manager.ensure_sentinel_genesis_event(&[], &[]).await?;
        assert_eq!(manager.event_log.heads.len(), 1);

        manager
            .delete_local_browser_data()
            .await
            .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
        Ok(())
    }
}
