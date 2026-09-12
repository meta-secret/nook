//! Testable event-log session orchestration (append, union, projection, outbox).

use crate::LocalEventBytes;
use crate::ResolveMemberRosterRequest;
use crate::{
    EpochMetadataState, EpochPasswordState, EventError, EventInsertStatus, VaultEpochError,
};
use nook_auth2::{BuildMembersRecordsRequest, VaultMember};
use nook_event_log::EventGraphRejection;

use crate::errors::{VaultError, VaultResult};
use crate::vault_ids::{AuthKeyId, StoreId};
use crate::vault_wire::{IsoTimestamp, Sha256Hex};
use crate::{
    AppendEventInput, CanonicalEventBodyBytes, Database, EventId, EventStorageBytes,
    LocalEventStore, ObservedHeads, SecretEpochReencryption, SigningIdentity, StoredSecretRecord,
    VaultCrypto, VaultMetaState, VaultOperation, VaultProjection,
};

/// In-memory event-log session state shared by WASM adapters and integration tests.
#[derive(Debug, Clone)]
pub struct VaultEventSession {
    pub store: LocalEventStore,
    pub store_id: String,
    pub heads: Vec<String>,
    pub key_epoch: String,
    pub signing: SigningIdentity,
    pub signing_seed: String,
}

#[derive(Clone, Copy, Debug)]
pub enum EventPublicationDestination<'a> {
    Local,
    Provider(&'a str),
}

pub struct VaultSecurityEpochRotationInput<'a> {
    pub trigger: VaultOperation,
    pub new_keys: &'a crate::VaultKeys,
    pub user_records: &'a [StoredSecretRecord],
    pub old_secrets_key: &'a crate::SymmetricKey,
    pub members_records: &'a [StoredSecretRecord],
    pub rotated_meta_records: Vec<StoredSecretRecord>,
    pub rewrapped_password_entries: Vec<crate::PasswordUnlockEntry>,
    pub created_at: &'a str,
    pub destination: EventPublicationDestination<'a>,
}

pub struct VaultEventAppend<'a> {
    pub operations: Vec<VaultOperation>,
    pub created_at: &'a str,
    pub destination: EventPublicationDestination<'a>,
}
#[derive(Debug)]
pub struct VaultEventAppended {
    pub session: VaultEventSession,
    pub event_id: EventId,
}
#[derive(Debug, thiserror::Error)]
#[error("{cause}")]
pub struct VaultEventSessionRejection {
    pub session: VaultEventSession,
    #[source]
    pub cause: VaultError,
}
impl VaultEventSessionRejection {
    #[must_use]
    pub fn into_cause(self) -> VaultError {
        self.cause
    }
}
pub struct VaultOutboxFlush<'a> {
    pub provider_id: &'a str,
    pub remote: LocalEventStore,
}
pub struct VaultOutboxFlushed {
    pub session: VaultEventSession,
    pub remote: LocalEventStore,
}
pub struct VaultEpochRotated<'a> {
    pub session: VaultEventSession,
    pub keys: &'a crate::VaultKeys,
}
struct PreparedSessionEvent {
    event_id: EventId,
    bytes: EventStorageBytes,
}
struct PreparedSessionPublication {
    events: Vec<PreparedSessionEvent>,
}
enum SessionCandidateGraph {
    Unloaded,
    Loaded(crate::EventGraph),
}

impl VaultEventSession {
    #[must_use]
    pub fn new(store_id: String, signing: SigningIdentity, signing_seed: String) -> Self {
        let key_epoch =
            EventId::from_body_bytes(&CanonicalEventBodyBytes::from(store_id.as_bytes().to_vec()))
                .into_inner();
        Self {
            store: LocalEventStore::new(),
            store_id,
            heads: Vec::new(),
            key_epoch,
            signing,
            signing_seed,
        }
    }

    pub fn actor_id(&self) -> VaultResult<AuthKeyId> {
        Ok(self.signing.actor_id()?)
    }

    #[expect(
        clippy::result_large_err,
        reason = "rejections retain the owned session so callers can recover it"
    )]
    pub fn set_heads_from_graph(mut self) -> Result<Self, VaultEventSessionRejection> {
        let graph = match self.store.load_graph(&self.store_id) {
            Ok(graph) => graph,
            Err(cause) => {
                return Err(VaultEventSessionRejection {
                    session: self,
                    cause: cause.into(),
                });
            }
        };
        self.heads = graph.heads().into_iter().map(|id| id.to_string()).collect();
        Ok(self)
    }

    #[expect(
        clippy::result_large_err,
        reason = "rejections retain the owned session so callers can recover it"
    )]
    pub fn append_operations(
        self,
        input: VaultEventAppend<'_>,
    ) -> Result<VaultEventAppended, VaultEventSessionRejection> {
        let prepared: VaultResult<_> = (|| {
            let store_id = StoreId::parse(&self.store_id)?;
            let actor_id = self.actor_id()?;
            let key_epoch = EventId::parse(&self.key_epoch)?;
            let created_at = IsoTimestamp::parse(input.created_at)?;
            let (event, bytes) = AppendEventInput::build(AppendEventInput {
                store_id: &store_id,
                actor_id: &actor_id,
                signing_identity: &self.signing,
                parents: ObservedHeads::parse(&self.heads)?.as_parents(),
                key_epoch: &key_epoch,
                created_at: &created_at,
                operations: input.operations,
            })?;
            let event_id = event.id()?;
            Ok((self.prepare_publication(vec![(event, bytes)])?, event_id))
        })();
        let (prepared, event_id) = match prepared {
            Ok(prepared) => prepared,
            Err(cause) => {
                return Err(VaultEventSessionRejection {
                    session: self,
                    cause,
                });
            }
        };
        Ok(VaultEventAppended {
            session: self.publish(prepared, input.destination),
            event_id,
        })
    }

    fn prepare_publication(
        &self,
        events: Vec<(crate::VaultEvent, EventStorageBytes)>,
    ) -> VaultResult<PreparedSessionPublication> {
        let mut candidate = SessionCandidateGraph::Unloaded;
        let mut prepared = Vec::with_capacity(events.len());
        for (event, bytes) in events {
            let event_id = event.id()?;
            // Existing event IDs are idempotent, even if unrelated stored data is malformed.
            if matches!(
                self.store.get_bytes(&event_id),
                LocalEventBytes::UnknownEvent
            ) {
                let graph = match candidate {
                    SessionCandidateGraph::Unloaded => self.store.load_graph(&self.store_id)?,
                    SessionCandidateGraph::Loaded(graph) => graph,
                };
                let inserted = graph
                    .insert(crate::EventGraphInsert {
                        event,
                        expected_store_id: &self.store_id,
                    })
                    .map_err(EventGraphRejection::into_cause)?;
                if let EventInsertStatus::Quarantined(reason) = inserted.status {
                    return Err(EventError::LocalAppendQuarantined { event_id, reason }.into());
                }
                candidate = SessionCandidateGraph::Loaded(inserted.graph);
            }
            prepared.push(PreparedSessionEvent { event_id, bytes });
        }
        Ok(PreparedSessionPublication { events: prepared })
    }
    fn publish(
        mut self,
        prepared: PreparedSessionPublication,
        destination: EventPublicationDestination<'_>,
    ) -> Self {
        for event in prepared.events {
            self.heads = vec![event.event_id.to_string()];
            if let EventPublicationDestination::Provider(provider_id) = destination {
                self.store = self.store.queue_outbox(crate::LocalOutboxWrite {
                    provider_id,
                    event: crate::LocalEventWrite {
                        event_id: event.event_id.clone(),
                        bytes: event.bytes.clone(),
                    },
                });
            }
            self.store = self.store.put_event(crate::LocalEventWrite {
                event_id: event.event_id,
                bytes: event.bytes,
            });
        }
        self
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "database boundary: admits persisted event bytes before converting them to EventStorageBytes"
        )
    )]
    #[expect(
        clippy::result_large_err,
        reason = "rejections retain the owned session so callers can recover it"
    )]
    pub fn union_remote(
        mut self,
        remote_events: &[(EventId, Vec<u8>)],
    ) -> Result<Self, VaultEventSessionRejection> {
        let remote_events = remote_events
            .iter()
            .map(|(id, bytes)| (id.clone(), EventStorageBytes::from(bytes.clone())))
            .collect::<Vec<_>>();
        match self.store.union_remote(crate::LocalRemoteUnion {
            remote_events: &remote_events,
            store_id: &self.store_id,
        }) {
            Ok(outcome) => {
                self.store = outcome.store;
                self.heads = outcome.heads;
                Ok(self)
            }
            Err(rejected) => {
                self.store = rejected.store;
                Err(VaultEventSessionRejection {
                    session: self,
                    cause: rejected.cause.into(),
                })
            }
        }
    }

    pub fn project(&self) -> VaultResult<VaultProjection> {
        let graph = self.store.load_graph(&self.store_id)?;
        Ok(VaultProjection::from_graph(&graph, &self.store_id)?)
    }

    pub fn apply_projection_to_armored(
        &self,
        crypto: &VaultCrypto,
        state: &mut VaultMetaState,
    ) -> VaultResult<Database> {
        let graph = self.store.load_graph(&self.store_id)?;
        let projection = VaultProjection::from_graph(&graph, &self.store_id)?;
        let live = projection.live_secrets(&graph);
        let user_records: Vec<StoredSecretRecord> = live.into_values().collect();
        crate::VaultUserRecordBatch::new(user_records).hydrate(crypto, state)
    }

    pub fn members_checkpoint_hash(
        records: &[StoredSecretRecord],
        members_key: &crate::SymmetricKey,
    ) -> VaultResult<Sha256Hex> {
        let roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
            records,
            members_key,
        })?;
        let member_records = VaultMember::build_members_records(BuildMembersRecordsRequest {
            roster,
            members_key,
        })?;
        let json = serde_json::to_string(&member_records)
            .map_err(VaultEpochError::MemberRecordsSerialize)?;
        Ok(Sha256Hex::from_bytes(json.as_bytes()))
    }

    #[must_use]
    pub fn flush_outbox_to_remote(mut self, input: VaultOutboxFlush<'_>) -> VaultOutboxFlushed {
        let VaultOutboxFlush {
            provider_id,
            mut remote,
        } = input;
        for (event_id, bytes) in self.store.pending_outbox(provider_id) {
            if matches!(remote.get_bytes(&event_id), LocalEventBytes::UnknownEvent) {
                remote = remote.put_event(crate::LocalEventWrite {
                    event_id: event_id.clone(),
                    bytes,
                });
            }
            self.store = self
                .store
                .dequeue_outbox(crate::LocalOutboxRemoval {
                    provider_id,
                    event_id: &event_id,
                })
                .store;
        }
        VaultOutboxFlushed {
            session: self,
            remote,
        }
    }

    #[expect(
        clippy::result_large_err,
        reason = "rejections retain the owned session so callers can recover it"
    )]
    pub fn rotate_security_epoch(
        mut self,
        input: VaultSecurityEpochRotationInput<'_>,
    ) -> Result<VaultEpochRotated<'_>, VaultEventSessionRejection> {
        let VaultSecurityEpochRotationInput {
            trigger,
            new_keys,
            user_records,
            old_secrets_key,
            members_records,
            rotated_meta_records,
            rewrapped_password_entries,
            created_at,
            destination,
        } = input;
        let prepared: VaultResult<_> = (|| {
            let secrets =
                SecretEpochReencryption::new(user_records, old_secrets_key, &new_keys.secrets_key)
                    .reencrypt()?;
            let members_checkpoint_hash =
                Self::members_checkpoint_hash(members_records, &new_keys.members_key)?;
            let checkpoint = VaultOperation::EpochCheckpoint {
                secrets,
                members_checkpoint_hash,
                rotated_meta_records: EpochMetadataState::Replace(rotated_meta_records),
                password_entries: EpochPasswordState::Replace(rewrapped_password_entries),
            };
            let store_id = StoreId::parse(&self.store_id)?;
            let actor_id = self.actor_id()?;
            let key_epoch = EventId::parse(&self.key_epoch)?;
            let created_at = IsoTimestamp::parse(created_at)?;
            let first = AppendEventInput::build(AppendEventInput {
                store_id: &store_id,
                actor_id: &actor_id,
                signing_identity: &self.signing,
                parents: ObservedHeads::parse(&self.heads)?.as_parents(),
                key_epoch: &key_epoch,
                created_at: &created_at,
                operations: vec![trigger],
            })?;
            let trigger_id = first.0.id()?;
            let second = AppendEventInput::build(AppendEventInput {
                store_id: &store_id,
                actor_id: &actor_id,
                signing_identity: &self.signing,
                parents: vec![trigger_id.clone()],
                key_epoch: &trigger_id,
                created_at: &created_at,
                operations: vec![checkpoint],
            })?;
            Ok((self.prepare_publication(vec![first, second])?, trigger_id))
        })();
        let (prepared, trigger_id) = match prepared {
            Ok(prepared) => prepared,
            Err(cause) => {
                return Err(VaultEventSessionRejection {
                    session: self,
                    cause,
                });
            }
        };
        self = self.publish(prepared, destination);
        self.key_epoch = trigger_id.to_string();
        Ok(VaultEpochRotated {
            session: self,
            keys: new_keys,
        })
    }
}
