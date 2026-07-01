//! Testable event-log session orchestration (append, union, projection, outbox).

use crate::errors::{EventError, VaultResult};
use crate::vault_ids::{AuthKeyId, StoreId};
use crate::vault_wire::{IsoTimestamp, SessionJsonl, Sha256Hex};
use crate::{
    AppendEventInput, EventId, LocalEventStore, ObservedHeads, SigningIdentity, StoredSecretRecord,
    VaultCrypto, VaultMetaState, VaultOperation, VaultProjection, build_members_records,
    build_signed_event, project_vault, resolve_member_roster, rotate_vault_keys_with_secrets,
    sha256_hex, union_remote_events,
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

impl VaultEventSession {
    #[must_use]
    pub fn new(store_id: String, signing: SigningIdentity, signing_seed: String) -> Self {
        let key_epoch = format!("sha256:{}", sha256_hex(store_id.as_bytes()).as_str());
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
        self.signing.actor_id()
    }

    pub fn set_heads_from_graph(&mut self) -> VaultResult<()> {
        let graph = self.store.load_graph(&self.store_id)?;
        self.heads = graph
            .heads()
            .into_iter()
            .map(|id| id.as_str().to_owned())
            .collect();
        Ok(())
    }

    pub fn append_operations(
        &mut self,
        operations: Vec<VaultOperation>,
        created_at: &str,
        provider_id: Option<&str>,
    ) -> VaultResult<EventId> {
        let store_id = StoreId::parse(&self.store_id)?;
        let actor_id = self.actor_id()?;
        let key_epoch = EventId::parse(&self.key_epoch)?;
        let created_at = IsoTimestamp::parse(created_at)?;
        let parents = ObservedHeads::parse(&self.heads)?.as_parents();
        let (event, bytes) = build_signed_event(AppendEventInput {
            store_id: &store_id,
            actor_id: &actor_id,
            signing_identity: &self.signing,
            parents,
            key_epoch: &key_epoch,
            created_at: &created_at,
            operations,
        })?;
        let event_id = event.id()?;
        self.store.put_event(event_id.clone(), bytes.clone());
        self.heads = vec![event_id.as_str().to_owned()];
        if let Some(provider) = provider_id {
            self.store.queue_outbox(provider, event_id.clone(), bytes);
        }
        Ok(event_id)
    }

    pub fn union_remote(&mut self, remote_events: &[(EventId, Vec<u8>)]) -> VaultResult<()> {
        union_remote_events(&mut self.store, remote_events, &self.store_id)?;
        self.set_heads_from_graph()
    }

    pub fn project(&self) -> VaultResult<VaultProjection> {
        let graph = self.store.load_graph(&self.store_id)?;
        project_vault(&graph, &self.store_id)
    }

    pub fn apply_projection_to_armored(
        &self,
        crypto: &VaultCrypto,
        state: &mut VaultMetaState,
    ) -> VaultResult<SessionJsonl> {
        let graph = self.store.load_graph(&self.store_id)?;
        let projection = project_vault(&graph, &self.store_id)?;
        let live = projection.live_secrets(&graph);
        let user_records: Vec<StoredSecretRecord> = live.into_values().collect();
        crate::apply_user_records_to_armored_session(user_records, crypto, state)
    }

    pub fn members_checkpoint_hash(
        records: &[StoredSecretRecord],
        members_key: &crate::SymmetricKey,
    ) -> VaultResult<Sha256Hex> {
        let roster = resolve_member_roster(records, members_key)?;
        let member_records = build_members_records(&roster, members_key)?;
        let json =
            serde_json::to_string(&member_records).map_err(EventError::MemberRecordsSerialize)?;
        Ok(sha256_hex(json.as_bytes()))
    }

    pub fn flush_outbox_to_remote(
        &mut self,
        provider_id: &str,
        remote: &mut LocalEventStore,
    ) -> VaultResult<()> {
        let pending = self.store.pending_outbox(provider_id);
        for (event_id, bytes) in pending {
            if remote.get_bytes(&event_id).is_none() {
                remote.put_event(event_id.clone(), bytes);
            }
            self.store.dequeue_outbox(provider_id, &event_id);
        }
        Ok(())
    }

    pub fn rotate_security_epoch(
        &mut self,
        trigger: VaultOperation,
        user_records: &[StoredSecretRecord],
        old_secrets_key: &crate::SymmetricKey,
        members_records: &[StoredSecretRecord],
        created_at: &str,
        provider_id: Option<&str>,
    ) -> VaultResult<(String, String)> {
        let trigger_id = self.append_operations(vec![trigger], created_at, provider_id)?;
        trigger_id.as_str().clone_into(&mut self.key_epoch);
        let (new_keys, secrets) = rotate_vault_keys_with_secrets(user_records, old_secrets_key)?;
        let members_checkpoint_hash =
            Self::members_checkpoint_hash(members_records, &new_keys.members_key)?;
        self.append_operations(
            vec![VaultOperation::EpochCheckpoint {
                secrets,
                members_checkpoint_hash,
            }],
            created_at,
            provider_id,
        )?;
        Ok((
            new_keys.secrets_key.into_inner(),
            new_keys.members_key.into_inner(),
        ))
    }
}
