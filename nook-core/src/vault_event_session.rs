//! Testable event-log session orchestration (append, union, projection, outbox).

use crate::errors::{EventError, VaultResult};
use crate::{
    AppendEventInput, Database, EventId, LocalEventStore, SigningIdentity, StoredSecretRecord,
    VaultCrypto, VaultOperation, VaultProjection, build_members_records, build_signed_event,
    is_vault_meta_record, project_vault, resolve_member_roster, rotate_vault_keys_with_secrets,
    sha256_hex, union_remote_events,
};
use std::collections::HashMap;

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
        let key_epoch = format!("sha256:{}", sha256_hex(store_id.as_bytes()));
        Self {
            store: LocalEventStore::new(),
            store_id,
            heads: Vec::new(),
            key_epoch,
            signing,
            signing_seed,
        }
    }

    pub fn actor_id(&self) -> VaultResult<String> {
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
        let actor_id = self.actor_id()?;
        let (event, bytes) = build_signed_event(AppendEventInput {
            store_id: &self.store_id,
            actor_id: &actor_id,
            signing_identity: &self.signing,
            parents: self.heads.clone(),
            key_epoch: &self.key_epoch,
            created_at,
            operations,
        })?;
        let event_id = event.id()?;
        self.store.put_event(event_id.clone(), bytes.clone());
        self.heads = vec![event_id.as_str().to_owned()];
        if let Some(provider) = provider_id {
            self.store
                .queue_outbox(provider, event_id.clone(), bytes);
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
        armored: &mut HashMap<String, String>,
        secret_types: &mut HashMap<String, crate::SecretType>,
    ) -> VaultResult<String> {
        let graph = self.store.load_graph(&self.store_id)?;
        let projection = project_vault(&graph, &self.store_id)?;
        let live = projection.live_secrets(&graph);
        let user_records: Vec<StoredSecretRecord> = live.into_values().collect();
        let db = Database::from_stored_records_with_crypto(&user_records, crypto)?;
        let jsonl = db.to_jsonl()?;
        armored.retain(|key, value| {
            is_vault_meta_record(&StoredSecretRecord {
                key: key.clone(),
                secret_type: None,
                value: value.clone(),
            })
        });
        secret_types.retain(|key, _| armored.contains_key(key));
        for record in user_records {
            armored.insert(record.key.clone(), record.value);
            if let Some(secret_type) = record.secret_type {
                secret_types.insert(record.key, secret_type);
            }
        }
        Ok(jsonl)
    }

    pub fn members_checkpoint_hash(
        records: &[StoredSecretRecord],
        members_key: &str,
    ) -> VaultResult<String> {
        let roster = resolve_member_roster(records, members_key)?;
        let member_records = build_members_records(&roster, members_key)?;
        let json = serde_json::to_string(&member_records).map_err(EventError::MemberRecordsSerialize)?;
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
        old_secrets_key: &str,
        members_records: &[StoredSecretRecord],
        created_at: &str,
        provider_id: Option<&str>,
    ) -> VaultResult<(String, String)> {
        let trigger_id = self.append_operations(vec![trigger], created_at, provider_id)?;
        trigger_id.as_str().clone_into(&mut self.key_epoch);
        let (new_keys, secrets) =
            rotate_vault_keys_with_secrets(user_records, old_secrets_key)?;
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
        Ok((new_keys.secrets_key, new_keys.members_key))
    }
}
