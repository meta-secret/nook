//! Shared in-memory event-sourcing test kit for integration scenarios.

#![allow(dead_code)]
#![allow(clippy::must_use_candidate, clippy::missing_errors_doc)]

use nook_core::{
    Database, DeviceIdentity, EventId, LocalEventStore, SecretId, SecretType, SigningIdentity,
    VaultCrypto, VaultEventSession, VaultKeys, VaultOperation, VaultProjection, VaultResult,
    VaultUnlock, encrypted_secret_from_armored, generate_store_id, generate_vault_keys,
    genesis_auth_record, genesis_members_records, hydrate_keys_from_projection_yaml,
    legacy_vault_to_import_event, serialize_stored_yaml_with_unlock,
};
use std::collections::HashMap;

const TS: &str = "2026-06-28T00:00:00Z";

/// Simulated device with local event store, signing identity, and projection YAML cache.
pub struct EventLogDevice {
    pub session: VaultEventSession,
    pub identity: DeviceIdentity,
    pub secrets_key: String,
    pub members_key: String,
    pub projection_cache_yaml: String,
    pub crypto: VaultCrypto,
}

impl EventLogDevice {
    pub fn genesis(label: &str) -> VaultResult<Self> {
        let keys = generate_vault_keys()?;
        let identity = DeviceIdentity::generate()?;
        let store_id = generate_store_id()?;
        let (signing, signing_seed) = SigningIdentity::generate()?;
        let session = VaultEventSession::new(store_id.to_string(), signing, signing_seed);
        let projection_cache_yaml = genesis_yaml(&keys, &identity, store_id.as_str())?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut device = Self {
            session,
            identity,
            secrets_key: keys.secrets_key.as_str().to_owned(),
            members_key: keys.members_key.as_str().to_owned(),
            projection_cache_yaml,
            crypto,
        };
        device.import_legacy_yaml(&genesis_yaml(&keys, &device.identity, device.store_id())?)?;
        let _ = label;
        Ok(device)
    }

    /// Second device sharing the same vault `store_id` but with an empty local event log.
    pub fn replica_of(peer: &Self) -> VaultResult<Self> {
        let (signing, signing_seed) = SigningIdentity::generate()?;
        Ok(Self {
            session: VaultEventSession::new(peer.store_id().to_owned(), signing, signing_seed),
            identity: DeviceIdentity::generate()?,
            secrets_key: peer.secrets_key.clone(),
            members_key: peer.members_key.clone(),
            projection_cache_yaml: peer.projection_cache_yaml.clone(),
            crypto: VaultCrypto::new(
                &nook_core::SymmetricKey::parse(&peer.secrets_key)
                    .map_err(nook_core::VaultError::Validation)?,
            )?,
        })
    }

    pub fn store_id(&self) -> &str {
        &self.session.store_id
    }

    pub fn actor_id(&self) -> VaultResult<String> {
        self.session.actor_id()
    }

    pub fn append_secret(&mut self, secret_id: &str, plaintext: &str) -> VaultResult<EventId> {
        let ciphertext = self.crypto.encrypt_value(plaintext)?;
        self.append_signed(vec![VaultOperation::SecretCreated {
            secret: encrypted_secret_from_armored(
                secret_id,
                SecretType::ApiKey,
                ciphertext.as_str(),
            ),
        }])
    }

    pub fn append_signed(&mut self, ops: Vec<VaultOperation>) -> VaultResult<EventId> {
        self.session.append_operations(ops, TS, Some("github"))
    }

    pub fn union_from(&mut self, remote: &EventLogDevice) -> VaultResult<()> {
        let remote_events: Vec<(EventId, Vec<u8>)> = remote
            .session
            .store
            .event_ids()
            .into_iter()
            .filter_map(|id| {
                remote
                    .session
                    .store
                    .get_bytes(&id)
                    .map(|bytes| (id, bytes.to_vec()))
            })
            .collect();
        self.session.union_remote(&remote_events)
    }

    pub fn project(&self) -> VaultResult<VaultProjection> {
        self.session.project()
    }

    pub fn pending_outbox(&self, provider: &str) -> Vec<(EventId, Vec<u8>)> {
        self.session.store.pending_outbox(provider)
    }

    pub fn flush_outbox_to(
        &mut self,
        provider: &str,
        remote: &mut LocalEventStore,
    ) -> VaultResult<()> {
        self.session.flush_outbox_to_remote(provider, remote)
    }

    pub fn remote_events(&self) -> Vec<(EventId, Vec<u8>)> {
        self.session
            .store
            .event_ids()
            .into_iter()
            .filter_map(|id| {
                self.session
                    .store
                    .get_bytes(&id)
                    .map(|bytes| (id, bytes.to_vec()))
            })
            .collect()
    }

    pub fn drop_crypto_simulating_sync(&mut self) -> VaultResult<()> {
        self.secrets_key.clear();
        self.members_key.clear();
        let (secrets_key, members_key) =
            hydrate_keys_from_projection_yaml(&self.projection_cache_yaml, &self.identity)?;
        self.secrets_key.clone_from(&secrets_key);
        self.members_key.clone_from(&members_key);
        self.crypto = VaultCrypto::new(
            &nook_core::SymmetricKey::parse(&secrets_key)
                .map_err(nook_core::VaultError::Validation)?,
        )?;
        Ok(())
    }

    pub fn import_legacy_yaml(&mut self, yaml: &str) -> VaultResult<EventId> {
        let event = legacy_vault_to_import_event(
            yaml,
            self.store_id(),
            &self.actor_id()?,
            self.session.signing.signing_key(),
            TS,
        )?;
        let id = event.id()?;
        let bytes = serde_json::to_vec(&event).map_err(nook_core::EventError::from)?;
        self.session.store.put_event(id.clone(), bytes);
        self.session.set_heads_from_graph()?;
        Ok(id)
    }
}

fn genesis_yaml(
    keys: &VaultKeys,
    identity: &DeviceIdentity,
    store_id: &str,
) -> VaultResult<String> {
    let mut records = vec![genesis_auth_record(
        identity,
        &keys.secrets_key,
        &keys.members_key,
    )?];
    records.extend(genesis_members_records(identity, &keys.members_key, TS)?);
    Ok(serialize_stored_yaml_with_unlock(
        &records,
        &VaultUnlock::Keys,
        &[],
        Some(store_id),
        None,
    )?)
}

/// Remote provider bucket keyed by provider id.
pub type ProviderBuckets = HashMap<String, LocalEventStore>;

pub fn push_device_outbox(
    device: &mut EventLogDevice,
    providers: &mut ProviderBuckets,
) -> VaultResult<()> {
    for (provider, bucket) in providers.iter_mut() {
        device.flush_outbox_to(provider, bucket)?;
    }
    Ok(())
}

pub fn union_device_from_providers(
    device: &mut EventLogDevice,
    providers: &ProviderBuckets,
) -> VaultResult<()> {
    let mut remote: Vec<(EventId, Vec<u8>)> = Vec::new();
    for bucket in providers.values() {
        for id in bucket.event_ids() {
            if let Some(bytes) = bucket.get_bytes(&id) {
                remote.push((id, bytes.to_vec()));
            }
        }
    }
    device.session.union_remote(&remote)
}

pub fn sample_legacy_yaml(crypto: &VaultCrypto) -> VaultResult<String> {
    let mut db = Database::new();
    db.insert(
        SecretId::from_vault_record("legacy-secret"),
        nook_core::SecretValue::ApiKey(nook_core::ApiKeySecret {
            website_url: "https://example.com".to_owned(),
            key: "legacy-value".to_owned(),
            expires_at: String::new(),
        }),
    );
    let records = db.to_stored_records_with_crypto(crypto)?;
    Ok(nook_core::serialize_stored(
        &records,
        nook_core::VaultFormat::Yaml,
    )?)
}
