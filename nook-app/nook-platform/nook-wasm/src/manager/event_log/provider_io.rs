#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::EventDbSaveEventBytes;
use crate::EventDbSaveHeads;
use crate::IdentityDbSetIdentityMemberSigningPublicKey;
use crate::NookDatabase;
use crate::storage::identity_record::StoredIdentityProtection;
use crate::storage::identity_record::StoredIdentityRecord;
use crate::storage::remote_event::RemoteEventRead;

use crate::storage::checked_event_write::{CheckedEventWrite, CheckedEventWriteRequest};
use crate::storage::drive_namespace::DriveNamespace;
use crate::storage::identity_record;
use nook_core::{
    DriveEventParent, EventLogLocation, EventLogNamespaceKind, IsoTimestamp, MemberLabel,
    PlacedNamespace, StorageMode, StoreId, SymmetricKey, VaultEvent, VaultEventSchemaVersion,
    VaultPlacement, VaultType,
};
use std::collections::BTreeSet;

use super::{
    DriveEventStore, EventId, GitHubEventStore, ICloudEventStore, NookError, NookVaultManager,
    VaultOperation,
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

#[derive(Clone, Copy)]
enum GenesisContext<'a> {
    ExistingVault,
    Pending(&'a identity_record::PendingSimpleGenesis),
}

struct GenesisBootstrap<'a> {
    created_at: &'a IsoTimestamp,
    pending: GenesisContext<'a>,
}

struct SimpleGenesisOperationsInput<'a> {
    pending: GenesisContext<'a>,
    identity: &'a nook_core::AppKey,
    signing_public_key: &'a nook_core::DeviceSigningPublicKey,
    keys: &'a nook_core::VaultKeys,
    created_at: &'a nook_core::IsoTimestamp,
}

impl SimpleGenesisOperationsInput<'_> {
    async fn operations(&self) -> Result<Vec<VaultOperation>, NookError> {
        let GenesisContext::Pending(pending) = self.pending else {
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
        NookDatabase::set_identity_member_signing_public_key(
            IdentityDbSetIdentityMemberSigningPublicKey {
                identity_id: &pending.identity_id,
                app_id: self.identity.device_id(),
                signing_public_key: self.signing_public_key,
            },
        )
        .await?;
        let identity_record = match NookDatabase::load_identity(&pending.identity_id).await? {
            StoredIdentityRecord::Registered(value) => Ok(value),
            StoredIdentityRecord::NotRegistered => Err(NookError::Database(
                "Simple genesis identity no longer exists.".to_owned(),
            )),
        }?;
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
    /// Where the open vault's events live at the prepared provider.
    pub(in crate::manager) fn current_vault_location(&self) -> Result<EventLogLocation, NookError> {
        let store_id = StoreId::parse(self.vault.store_id.trim()).map_err(|_| {
            NookError::Database("Choose a vault before syncing its events.".to_owned())
        })?;
        Ok(EventLogLocation::Vault(store_id))
    }

    async fn drive_parent_for(
        &self,
        placed: &PlacedNamespace,
    ) -> Result<DriveEventParent, NookError> {
        if let Some(parent) = self.storage.drive_namespace_parent(placed) {
            return Ok(parent);
        }
        let parent = (DriveNamespace {
            token: &self.storage.access_token,
            parent: self.storage.drive_event_parent.parent()?,
            placed,
        })
        .resolve()
        .await?;
        self.storage.remember_drive_namespace(placed, &parent);
        Ok(parent)
    }

    /// Every namespace the prepared provider files one vault in, whichever
    /// identity's folder holds it.
    async fn vault_namespaces_at_current_provider(
        &self,
        store_id: &StoreId,
    ) -> Result<Vec<PlacedNamespace>, NookError> {
        match self.storage.mode {
            StorageMode::Github => {
                GitHubEventStore::list_github_namespaces(
                    &self.storage.access_token,
                    &self.storage.remote_ref,
                    EventLogNamespaceKind::Vault,
                )
                .await
            }
            StorageMode::GoogleDrive => {
                DriveNamespace::list_placed(
                    &self.storage.access_token,
                    self.storage.drive_event_parent.parent()?,
                    EventLogNamespaceKind::Vault,
                )
                .await
            }
            StorageMode::ICloud => {
                ICloudEventStore::find_icloud_vault(
                    &self.storage.access_token,
                    self.storage.icloud_event_target.target()?,
                    store_id,
                )
                .await
            }
            StorageMode::Local => Ok(Vec::new()),
        }
    }

    /// Where one log already sits at the prepared provider: an identity log in
    /// its own folder, a vault in the identity folder that files it. A vault
    /// the provider does not hold yet sits nowhere.
    pub(in crate::manager) async fn placed_at_current_provider(
        &self,
        location: &EventLogLocation,
    ) -> Result<VaultPlacement, NookError> {
        let store_id = match location {
            EventLogLocation::Identity(identity) => {
                return Ok(VaultPlacement::Filed(PlacedNamespace::identity_log(
                    identity.clone(),
                )));
            }
            EventLogLocation::Vault(store_id) => store_id,
        };
        if let Some(placed) = self.storage.vault_placement(store_id) {
            return Ok(VaultPlacement::Filed(placed));
        }
        let found = self.vault_namespaces_at_current_provider(store_id).await?;
        let placement = VaultPlacement::of(store_id, found)?;
        if let VaultPlacement::Filed(placed) = &placement {
            self.storage.remember_vault_placement(store_id, placed);
        }
        Ok(placement)
    }

    /// Where a write of one log goes: where the provider already files it, or,
    /// for a vault it does not hold yet, a new folder under the identity of
    /// this installation's unlocked app key.
    async fn placed_for_write(
        &self,
        location: &EventLogLocation,
    ) -> Result<PlacedNamespace, NookError> {
        match (self.placed_at_current_provider(location).await?, location) {
            (VaultPlacement::Filed(placed), _) => Ok(placed),
            (VaultPlacement::Unfiled, EventLogLocation::Vault(store_id)) => {
                let writer = Self::current_identity_id(&self.unlocked_app_key()?).await?;
                let placed = VaultPlacement::Unfiled.for_writer(store_id.clone(), writer);
                self.storage.remember_vault_placement(store_id, &placed);
                Ok(placed)
            }
            (VaultPlacement::Unfiled, EventLogLocation::Identity(identity)) => {
                Ok(PlacedNamespace::identity_log(identity.clone()))
            }
        }
    }

    pub(in crate::manager) async fn list_provider_event_ids_at(
        &self,
        location: &EventLogLocation,
    ) -> Result<BTreeSet<EventId>, NookError> {
        let VaultPlacement::Filed(placed) = self.placed_at_current_provider(location).await? else {
            return Ok(BTreeSet::new());
        };
        let raw_ids = match self.storage.mode {
            StorageMode::Github => {
                (GitHubEventStore {
                    pat: &self.storage.access_token,
                    repo: &self.storage.remote_ref,
                    placed: &placed,
                })
                .list_github_event_ids()
                .await?
            }
            StorageMode::GoogleDrive => {
                let parent = self.drive_parent_for(&placed).await?;
                (DriveEventStore {
                    token: &self.storage.access_token,
                    parent: &parent,
                    location,
                })
                .list_drive_event_ids()
                .await?
            }
            StorageMode::ICloud => {
                (ICloudEventStore {
                    web_auth_token: &self.storage.access_token,
                    target: self.storage.icloud_event_target.target()?,
                    placed: &placed,
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

    pub(in crate::manager) async fn read_provider_event_at(
        &self,
        location: &EventLogLocation,
        event_id: &EventId,
    ) -> Result<RemoteEventRead, NookError> {
        let VaultPlacement::Filed(placed) = self.placed_at_current_provider(location).await? else {
            return Ok(RemoteEventRead::Unavailable);
        };
        match self.storage.mode {
            StorageMode::Github => {
                match (GitHubEventStore {
                    pat: &self.storage.access_token,
                    repo: &self.storage.remote_ref,
                    placed: &placed,
                })
                .fetch_github_event(event_id)
                .await
                {
                    Ok(bytes) => Ok(RemoteEventRead::Retrieved(bytes.into())),
                    Err(error) if error.is_github_event_missing() => {
                        Ok(RemoteEventRead::Unavailable)
                    }
                    Err(err) => Err(err),
                }
            }
            StorageMode::GoogleDrive => {
                let parent = self.drive_parent_for(&placed).await?;
                (DriveEventStore {
                    token: &self.storage.access_token,
                    parent: &parent,
                    location,
                })
                .read_drive_event(event_id)
                .await
            }
            StorageMode::ICloud => {
                match (ICloudEventStore {
                    web_auth_token: &self.storage.access_token,
                    target: self.storage.icloud_event_target.target()?,
                    placed: &placed,
                })
                .fetch_icloud_event(event_id)
                .await
                {
                    Ok(bytes) => Ok(RemoteEventRead::Retrieved(bytes.into())),
                    Err(error) if error.is_icloud_event_missing() => {
                        Ok(RemoteEventRead::Unavailable)
                    }
                    Err(err) => Err(err),
                }
            }
            StorageMode::Local => Ok(RemoteEventRead::Unavailable),
        }
    }

    pub(in crate::manager) async fn put_provider_event_at(
        &self,
        location: &EventLogLocation,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        let provider = match self.storage.mode {
            StorageMode::Local => return Ok(()),
            StorageMode::Github => "GitHub",
            StorageMode::GoogleDrive => "Drive",
            StorageMode::ICloud => "CloudKit",
        };
        // A malformed event is refused before any network call, placement
        // included.
        CheckedEventWrite::parse(CheckedEventWriteRequest {
            bytes,
            event_id,
            location,
            provider,
        })?;
        let placed = self.placed_for_write(location).await?;
        match self.storage.mode {
            StorageMode::Github => {
                (GitHubEventStore {
                    pat: &self.storage.access_token,
                    repo: &self.storage.remote_ref,
                    placed: &placed,
                })
                .put_github_event_if_absent(event_id, bytes)
                .await
            }
            StorageMode::GoogleDrive => {
                let parent = self.drive_parent_for(&placed).await?;
                (DriveEventStore {
                    token: &self.storage.access_token,
                    parent: &parent,
                    location,
                })
                .put_drive_event_if_absent(event_id, bytes)
                .await
                .map(|_| ())
            }
            StorageMode::ICloud => {
                (ICloudEventStore {
                    web_auth_token: &self.storage.access_token,
                    target: self.storage.icloud_event_target.target()?,
                    placed: &placed,
                })
                .put_icloud_event_if_absent(event_id, bytes)
                .await
            }
            StorageMode::Local => Ok(()),
        }
    }

    /// Delete one namespace (a vault deleted everywhere) at the prepared
    /// provider. Returns whether anything was there.
    pub(in crate::manager) async fn delete_provider_namespace_at(
        &self,
        location: &EventLogLocation,
    ) -> Result<bool, NookError> {
        let VaultPlacement::Filed(placed) = self.placed_at_current_provider(location).await? else {
            return Ok(false);
        };
        match self.storage.mode {
            StorageMode::Github => Ok((GitHubEventStore {
                pat: &self.storage.access_token,
                repo: &self.storage.remote_ref,
                placed: &placed,
            })
            .delete_github_namespace()
            .await?
                > 0),
            StorageMode::GoogleDrive => {
                (DriveNamespace {
                    token: &self.storage.access_token,
                    parent: self.storage.drive_event_parent.parent()?,
                    placed: &placed,
                })
                .delete()
                .await
            }
            StorageMode::ICloud => Ok((ICloudEventStore {
                web_auth_token: &self.storage.access_token,
                target: self.storage.icloud_event_target.target()?,
                placed: &placed,
            })
            .delete_icloud_namespace()
            .await?
                > 0),
            StorageMode::Local => Ok(false),
        }
    }

    /// Every namespace of one kind at the prepared provider, each in the
    /// identity folder that files it. This browser's own store has none.
    pub(in crate::manager) async fn list_namespaces_at_current_provider(
        &self,
        kind: EventLogNamespaceKind,
    ) -> Result<Vec<PlacedNamespace>, NookError> {
        match self.storage.mode {
            StorageMode::Github => {
                GitHubEventStore::list_github_namespaces(
                    &self.storage.access_token,
                    &self.storage.remote_ref,
                    kind,
                )
                .await
            }
            StorageMode::GoogleDrive => {
                DriveNamespace::list_placed(
                    &self.storage.access_token,
                    self.storage.drive_event_parent.parent()?,
                    kind,
                )
                .await
            }
            StorageMode::ICloud => {
                ICloudEventStore::list_icloud_namespaces(
                    &self.storage.access_token,
                    self.storage.icloud_event_target.target()?,
                    kind,
                )
                .await
            }
            StorageMode::Local => Ok(Vec::new()),
        }
    }

    /// Vaults with a namespace at the prepared provider.
    pub(in crate::manager) async fn list_vault_ids_at_current_provider(
        &self,
    ) -> Result<Vec<StoreId>, NookError> {
        let mut store_ids = self
            .list_namespaces_at_current_provider(EventLogNamespaceKind::Vault)
            .await?
            .into_iter()
            .filter_map(|placed| match placed.location() {
                EventLogLocation::Vault(store_id) => Some(store_id.clone()),
                EventLogLocation::Identity(_) => None,
            })
            .collect::<Vec<_>>();
        store_ids.sort();
        store_ids.dedup();
        Ok(store_ids)
    }

    pub(super) async fn list_current_provider_event_ids(
        &self,
    ) -> Result<BTreeSet<EventId>, NookError> {
        let location = self.current_vault_location()?;
        self.list_provider_event_ids_at(&location).await
    }

    pub(super) async fn read_current_provider_event(
        &self,
        event_id: &EventId,
    ) -> Result<RemoteEventRead, NookError> {
        let location = self.current_vault_location()?;
        self.read_provider_event_at(&location, event_id).await
    }

    pub(super) async fn put_current_provider_event_if_absent(
        &self,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        let location = self.current_vault_location()?;
        self.put_provider_event_at(&location, event_id, bytes).await
    }

    pub(in crate::manager) async fn bootstrap_event_log_genesis(
        &mut self,
    ) -> Result<(), NookError> {
        let created_at = IsoTimestamp::parse(&crate::BrowserTimestamp::now().into_iso_string())?;
        self.bootstrap_event_log_genesis_inner(GenesisBootstrap {
            created_at: &created_at,
            pending: GenesisContext::ExistingVault,
        })
        .await
    }

    pub(in crate::manager) async fn bootstrap_simple_event_log_genesis(
        &mut self,
        pending: &identity_record::PendingSimpleGenesis,
    ) -> Result<(), NookError> {
        self.bootstrap_event_log_genesis_inner(GenesisBootstrap {
            created_at: &pending.created_at,
            pending: GenesisContext::Pending(pending),
        })
        .await
    }

    #[expect(
        clippy::too_many_lines,
        reason = "genesis bootstrap keeps the atomic event-log persistence sequence together"
    )]
    async fn bootstrap_event_log_genesis_inner(
        &mut self,
        input: GenesisBootstrap<'_>,
    ) -> Result<(), NookError> {
        let GenesisBootstrap {
            created_at,
            pending,
        } = input;
        self.activate_event_log_mode().await?;
        let signing = self.ensure_signing_identity().await?;
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
        let bytes = if let GenesisContext::Pending(pending) = pending {
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
            let keyring_backed = matches!(
                NookDatabase::load_entry_for_app_id(app_key.app_id()).await?,
                StoredIdentityProtection::Protected(_)
            );
            if !keyring_backed {
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
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
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
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn local_provider_io_dispatches_without_remote_access() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager.storage.mode = StorageMode::Local;
        manager.vault.store_id = nook_core::StoreId::generate()?.to_string();
        let event_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;

        assert!(manager.list_current_provider_event_ids().await?.is_empty());
        assert_eq!(
            manager.read_current_provider_event(&event_id).await?,
            RemoteEventRead::Unavailable
        );
        manager
            .put_current_provider_event_if_absent(&event_id, b"ignored")
            .await?;
        assert!(!manager.sync_event_log_from_storage().await?);
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
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
