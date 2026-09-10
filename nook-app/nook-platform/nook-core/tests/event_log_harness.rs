//! Shared in-memory event-sourcing test kit for integration scenarios.

#![allow(dead_code)]
#![allow(clippy::must_use_candidate, clippy::missing_errors_doc)]

use nook_auth2::{GenesisMembersRecordsRequest, VaultMember};
use nook_core::LocalEventBytes;
use nook_core::RecordTypeDeclaration;
use nook_core::{
    AgeArmoredCiphertext, SecretFingerprint, Sha256Hex, SymmetricKey, VaultError, VaultFormat,
    VaultStoreIdentityRef, VaultSyncError, VaultVersionWrite,
};

use nook_core::{
    AuthKeyId, Database, DeviceIdentity, DeviceSigningPublicKey, EncryptedSecretPayload, EventId,
    JoinRequest, LocalEventStore, LoginSecret, MemberLabel, SecretId, SecretType, SecretValue,
    SigningIdentity, StoreId, VaultCrypto, VaultEventSession, VaultKeys, VaultOperation,
    VaultProjection, VaultProjectionCache, VaultRecordSet, VaultResult, VaultUnlock,
};
use std::collections::{BTreeSet, HashMap};

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

pub struct DeviceRejection {
    pub device: EventLogDevice,
    pub cause: VaultError,
}
pub struct DeviceAppended {
    pub device: EventLogDevice,
    pub event_id: EventId,
}
pub struct DeviceFlushed {
    pub device: EventLogDevice,
    pub remote: LocalEventStore,
}
pub struct DeviceJoinRequested {
    pub device: EventLogDevice,
    pub join: JoinRequest,
}
pub struct DeviceProvidersFlushed {
    pub device: EventLogDevice,
    pub providers: ProviderBuckets,
}
pub struct ProviderRejection {
    pub providers: ProviderBuckets,
    pub cause: VaultError,
}

impl EventLogDevice {
    pub fn genesis(label: &str) -> VaultResult<Self> {
        let keys = VaultKeys::generate()?;
        let identity = DeviceIdentity::generate()?;
        let store_id = StoreId::generate()?;
        let (signing, signing_seed) = SigningIdentity::generate()?;
        let session =
            VaultEventSession::new(store_id.to_string(), signing, signing_seed.into_inner());
        let projection_cache_yaml = genesis_yaml(&keys, &identity, store_id.as_str())?.into_inner();
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut device = Self {
            session,
            identity,
            secrets_key: keys.secrets_key.as_str().to_owned(),
            members_key: keys.members_key.as_str().to_owned(),
            projection_cache_yaml,
            crypto,
        };
        device = device
            .append_signed(vec![VaultOperation::VaultImported {
                source_content_hash: Sha256Hex::from_trusted("0".repeat(64)),
                secrets: Vec::new(),
                password_entries: Vec::new(),
            }])
            .map_err(|rejected| rejected.cause)?
            .device;
        let _ = label;
        Ok(device)
    }

    /// Second device sharing the same vault `store_id` but with an empty local event log.
    pub fn replica_of(peer: &Self) -> VaultResult<Self> {
        Ok(Self {
            session: VaultEventSession::new(
                peer.store_id().to_owned(),
                peer.session.signing.clone(),
                peer.session.signing_seed.clone(),
            ),
            identity: DeviceIdentity::generate()?,
            secrets_key: peer.secrets_key.clone(),
            members_key: peer.members_key.clone(),
            projection_cache_yaml: peer.projection_cache_yaml.clone(),
            crypto: VaultCrypto::new(
                &SymmetricKey::parse(&peer.secrets_key).map_err(VaultError::Validation)?,
            )?,
        })
    }

    pub fn store_id(&self) -> &str {
        &self.session.store_id
    }

    pub fn actor_id(&self) -> VaultResult<AuthKeyId> {
        self.session.actor_id()
    }

    pub fn append_secret(
        self,
        secret_id: &str,
        plaintext: &str,
    ) -> Result<DeviceAppended, DeviceRejection> {
        let ciphertext = match self.crypto.encrypt_value(plaintext) {
            Ok(ciphertext) => ciphertext,
            Err(cause) => {
                return Err(DeviceRejection {
                    device: self,
                    cause,
                });
            }
        };
        self.append_signed(vec![VaultOperation::SecretCreated {
            secret: EncryptedSecretPayload::from_armored(
                &SecretId::from_vault_record(secret_id),
                SecretType::ApiKey,
                ciphertext.as_str(),
                SecretFingerprint::from_trusted(format!("test-identity:{secret_id}")),
                SecretFingerprint::from_trusted(format!("test-version:{secret_id}")),
            ),
        }])
    }

    /// Append a login secret with identity/version fingerprints (matches WASM `add_secret`).
    pub fn append_login(
        self,
        secret_id: &str,
        website_url: &str,
        username: &str,
        password: &str,
        notes: &str,
    ) -> Result<DeviceAppended, DeviceRejection> {
        let value = SecretValue::Login(LoginSecret {
            website_url: website_url.to_owned(),
            username: username.to_owned(),
            password: password.to_owned(),
            notes: notes.to_owned(),
        });
        let operation: VaultResult<_> = (|| {
            let secrets_key = SymmetricKey::parse(&self.secrets_key)?;
            let identity = value.identity_fingerprint(&secrets_key)?;
            let version = value.fingerprint(&secrets_key)?;
            let ciphertext = self.crypto.encrypt_value(value.to_yaml()?.as_str())?;
            Ok(VaultOperation::SecretCreated {
                secret: EncryptedSecretPayload::from_armored(
                    &SecretId::from_vault_record(secret_id),
                    SecretType::Login,
                    ciphertext.as_str(),
                    identity,
                    version,
                ),
            })
        })();
        match operation {
            Ok(operation) => self.append_signed(vec![operation]),
            Err(cause) => Err(DeviceRejection {
                device: self,
                cause,
            }),
        }
    }

    pub fn decrypt_live_login_passwords(&self) -> VaultResult<BTreeSet<String>> {
        let graph = self.session.store.load_graph(self.store_id())?;
        let live = self.project()?.live_secrets(&graph);
        let mut passwords = BTreeSet::new();
        for record in live.values() {
            if record.secret_type != RecordTypeDeclaration::Secret(SecretType::Login) {
                continue;
            }
            let plaintext = self
                .crypto
                .decrypt_value(&AgeArmoredCiphertext::parse(record.value.as_str())?)?;
            let value = SecretValue::from_yaml_str(SecretType::Login, plaintext.as_str())?;
            let SecretValue::Login(login) = value else {
                continue;
            };
            passwords.insert(login.password);
        }
        Ok(passwords)
    }

    pub fn live_identity_fingerprints(&self) -> VaultResult<Vec<String>> {
        let graph = self.session.store.load_graph(self.store_id())?;
        let projection = self.project()?;
        let mut fingerprints = projection
            .secrets
            .iter()
            .filter(|(_, secret)| secret.is_live(&graph))
            .map(|(_, secret)| secret.identity_fingerprint.as_str().to_owned())
            .collect::<Vec<_>>();
        fingerprints.sort();
        Ok(fingerprints)
    }

    pub fn append_signed(
        mut self,
        ops: Vec<VaultOperation>,
    ) -> Result<DeviceAppended, DeviceRejection> {
        match self.session.append_operations(nook_core::VaultEventAppend {
            operations: ops,
            created_at: TS,
            provider_id: Some("github"),
        }) {
            Ok(appended) => {
                self.session = appended.session;
                Ok(DeviceAppended {
                    device: self,
                    event_id: appended.event_id,
                })
            }
            Err(rejected) => {
                self.session = rejected.session;
                Err(DeviceRejection {
                    device: self,
                    cause: rejected.cause,
                })
            }
        }
    }

    pub fn union_events(mut self, events: &[(EventId, Vec<u8>)]) -> Result<Self, DeviceRejection> {
        match self.session.union_remote(events) {
            Ok(session) => {
                self.session = session;
                Ok(self)
            }
            Err(rejected) => {
                self.session = rejected.session;
                Err(DeviceRejection {
                    device: self,
                    cause: rejected.cause,
                })
            }
        }
    }

    pub fn union_from(self, remote: &EventLogDevice) -> Result<Self, DeviceRejection> {
        self.union_events(&remote.remote_events())
    }

    pub fn project(&self) -> VaultResult<VaultProjection> {
        self.session.project()
    }

    pub fn pending_outbox(&self, provider: &str) -> Vec<(EventId, Vec<u8>)> {
        self.session
            .store
            .pending_outbox(provider)
            .into_iter()
            .map(|(event_id, bytes)| (event_id, bytes.into()))
            .collect()
    }

    pub fn flush_outbox_to(mut self, provider: &str, remote: LocalEventStore) -> DeviceFlushed {
        let flushed = self
            .session
            .flush_outbox_to_remote(nook_core::VaultOutboxFlush {
                provider_id: provider,
                remote,
            });
        self.session = flushed.session;
        DeviceFlushed {
            device: self,
            remote: flushed.remote,
        }
    }

    pub fn remote_events(&self) -> Vec<(EventId, Vec<u8>)> {
        self.session
            .store
            .event_ids()
            .into_iter()
            .filter_map(|id| match self.session.store.get_bytes(&id) {
                LocalEventBytes::Stored(bytes) => Some((id, bytes.into())),
                LocalEventBytes::UnknownEvent => None,
            })
            .collect()
    }

    pub fn drop_crypto_simulating_sync(mut self) -> Result<Self, DeviceRejection> {
        let prepared: VaultResult<_> = (|| {
            let (secrets_key, members_key) =
                VaultProjectionCache::new(&self.projection_cache_yaml).unlock(&self.identity)?;
            let crypto = VaultCrypto::new(
                &SymmetricKey::parse(&secrets_key).map_err(VaultError::Validation)?,
            )?;
            Ok((secrets_key, members_key, crypto))
        })();
        match prepared {
            Ok((secrets_key, members_key, crypto)) => {
                self.secrets_key = secrets_key;
                self.members_key = members_key;
                self.crypto = crypto;
                Ok(self)
            }
            Err(cause) => Err(DeviceRejection {
                device: self,
                cause,
            }),
        }
    }
}

fn genesis_yaml(
    keys: &VaultKeys,
    identity: &DeviceIdentity,
    store_id: &str,
) -> VaultResult<nook_core::StoredVaultYaml> {
    let mut records = vec![identity.auth_record(&keys.secrets_key, &keys.members_key)?];
    records.extend(VaultMember::genesis_members_records(
        GenesisMembersRecordsRequest {
            identity: identity,
            members_key: &keys.members_key,
            enrolled_at: TS,
        },
    )?);
    VaultRecordSet::serialize_yaml_with_unlock(
        &records,
        &VaultUnlock::Keys,
        &[],
        VaultStoreIdentityRef::Assigned(store_id),
        VaultVersionWrite::Initial,
    )
    .map_err(Into::into)
}

/// Remote provider bucket keyed by provider id.
pub type ProviderBuckets = HashMap<String, LocalEventStore>;

pub fn missing_provider_bucket(provider_id: &str) -> nook_core::VaultSyncError {
    VaultSyncError::ProviderDisappeared {
        provider_id: provider_id.to_owned(),
    }
}

pub fn live_secret_ids(device: &EventLogDevice) -> VaultResult<BTreeSet<String>> {
    let graph = device.session.store.load_graph(device.store_id())?;
    Ok(device
        .project()?
        .live_secrets(&graph)
        .keys()
        .cloned()
        .collect())
}

pub fn write_all_device_events_to_provider(
    device: &EventLogDevice,
    mut providers: ProviderBuckets,
    provider: &str,
) -> Result<ProviderBuckets, ProviderRejection> {
    let Some(mut bucket) = providers.remove(provider) else {
        return Err(ProviderRejection {
            providers,
            cause: missing_provider_bucket(provider).into(),
        });
    };
    for (id, bytes) in device.remote_events() {
        if matches!(bucket.get_bytes(&id), LocalEventBytes::UnknownEvent) {
            bucket = bucket.put_event(nook_core::LocalEventWrite {
                event_id: id,
                bytes: bytes.into(),
            });
        }
    }
    providers.insert(provider.to_owned(), bucket);
    Ok(providers)
}

pub fn pull_provider_into_device(
    device: EventLogDevice,
    providers: &ProviderBuckets,
    provider: &str,
) -> Result<EventLogDevice, DeviceRejection> {
    let Some(bucket) = providers.get(provider) else {
        return Err(DeviceRejection {
            device,
            cause: missing_provider_bucket(provider).into(),
        });
    };
    let events = bucket
        .event_ids()
        .into_iter()
        .filter_map(|id| match bucket.get_bytes(&id) {
            LocalEventBytes::Stored(bytes) => Some((id, bytes.into())),
            LocalEventBytes::UnknownEvent => None,
        })
        .collect::<Vec<_>>();
    device.union_events(&events)
}

pub fn request_join(
    device: EventLogDevice,
    joiner: &DeviceIdentity,
    label: &str,
) -> Result<DeviceJoinRequested, DeviceRejection> {
    let signing_public_key = DeviceSigningPublicKey::from_trusted(String::new());
    let join = JoinRequest {
        device_id: joiner.device_id().clone(),
        public_key: joiner.public_key(),
        signing_public_key: signing_public_key.clone(),
        requested_at: TS.to_owned(),
    };
    let appended = device.append_signed(vec![VaultOperation::JoinRequested {
        device_id: join.device_id.clone(),
        encryption_public_key: join.public_key.clone(),
        signing_public_key,
        label: MemberLabel::from_trusted(label.to_owned()),
    }])?;
    Ok(DeviceJoinRequested {
        device: appended.device,
        join,
    })
}

pub fn approve_join(
    device: EventLogDevice,
    join: &JoinRequest,
    label: &str,
) -> Result<EventLogDevice, DeviceRejection> {
    let prepared: VaultResult<_> = (|| {
        Ok(VaultOperation::JoinApproved {
            device_id: join.device_id.clone(),
            encryption_public_key: join.public_key.clone(),
            signing_public_key: join.signing_public_key.clone(),
            label: MemberLabel::from_trusted(label.to_owned()),
            secrets_key_ciphertext: device.crypto.encrypt_value(&device.secrets_key)?,
            members_key_ciphertext: device.crypto.encrypt_value(&device.members_key)?,
        })
    })();
    let operation = match prepared {
        Ok(operation) => operation,
        Err(cause) => return Err(DeviceRejection { device, cause }),
    };
    Ok(device.append_signed(vec![operation])?.device)
}

pub fn push_device_outbox(
    mut device: EventLogDevice,
    providers: ProviderBuckets,
) -> DeviceProvidersFlushed {
    let mut flushed_providers = HashMap::with_capacity(providers.len());
    for (provider, bucket) in providers {
        let flushed = device.flush_outbox_to(&provider, bucket);
        device = flushed.device;
        flushed_providers.insert(provider, flushed.remote);
    }
    DeviceProvidersFlushed {
        device,
        providers: flushed_providers,
    }
}

pub fn union_device_from_providers(
    device: EventLogDevice,
    providers: &ProviderBuckets,
) -> Result<EventLogDevice, DeviceRejection> {
    let mut remote: Vec<(EventId, Vec<u8>)> = Vec::new();
    for bucket in providers.values() {
        for id in bucket.event_ids() {
            if let LocalEventBytes::Stored(bytes) = bucket.get_bytes(&id) {
                remote.push((id, bytes.into()));
            }
        }
    }
    device.union_events(&remote)
}

pub fn sample_stored_vault_yaml(crypto: &VaultCrypto) -> VaultResult<String> {
    let mut db = Database::new();
    db.insert(
        SecretId::from_vault_record("import-secret"),
        SecretValue::ApiKey(nook_core::ApiKeySecret {
            website_url: "https://example.com".to_owned(),
            key: "import-value".to_owned(),
            expires_at: String::new(),
        }),
    );
    let records = db.to_stored_records_with_crypto(crypto)?;
    Ok(
        nook_core::VaultRecordSet::serialize(&records, VaultFormat::Yaml)?
            .as_str()
            .to_owned(),
    )
}
