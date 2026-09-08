//! Strict V1 schema for inert activation candidate publication and readback.

use super::super::super::{PairingRecipientAccess, PairingRecipientAccessRequest};
use super::super::{
    CompanionPairingCandidateFailure, PairingActivationCandidate, PairingActivationEvent,
};
use nook_companion_core::{
    CompanionPairingApproval, CompanionPairingEpochMilliseconds, ExtensionConnectScope,
};
use nook_core::{
    AuthProvidersSnapshotData, CheckedRemoteEvent, EventGraphVaultArchitecture, EventId,
    EventStorageBytes, LocalEventStore, Sha256Hex, StoreId, VaultApplication, VaultProjection,
    parse_event_storage_bytes, serialize_event_storage_yaml,
};
use serde::{
    Deserialize, Deserializer, Serialize, Serializer,
    de::{DeserializeOwned, Error as DeserializerError},
};
use serde_json::Value;

type SchemaResult<T> = Result<T, CompanionPairingCandidateFailure>;

#[derive(Clone, Copy)]
struct PairingActivationSchemaVersion;

impl Serialize for PairingActivationSchemaVersion {
    fn serialize<SerializerType>(
        &self,
        serializer: SerializerType,
    ) -> Result<SerializerType::Ok, SerializerType::Error>
    where
        SerializerType: Serializer,
    {
        serializer.serialize_u32(1)
    }
}

impl<'de> Deserialize<'de> for PairingActivationSchemaVersion {
    fn deserialize<DeserializerType>(
        deserializer: DeserializerType,
    ) -> Result<Self, DeserializerType::Error>
    where
        DeserializerType: Deserializer<'de>,
    {
        let version = u32::deserialize(deserializer)?;
        if version == 1 {
            Ok(Self)
        } else {
            Err(DeserializerError::custom("unsupported activation schema"))
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ActivationEventRow {
    event_id: String,
    bytes: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ActivationGate {
    schema_version: PairingActivationSchemaVersion,
    request_id: String,
    vault_store_id: String,
    application: VaultApplication,
    stored_at: CompanionPairingEpochMilliseconds,
    event_count: u32,
    event_heads: Vec<EventId>,
    provider_count: u32,
    pub(super) event_payload_keys: Vec<String>,
    pub(super) provider_payload_key: String,
    event_digests: Vec<Sha256Hex>,
    provider_digest: Sha256Hex,
    approval: CompanionPairingApproval,
}

pub(super) struct EncodedCandidate {
    pub(super) gate_key: String,
    pub(super) gate: ActivationGate,
    pub(super) events: Vec<(String, String)>,
    pub(super) providers: String,
}

pub(super) struct CandidateSchema;

pub(super) struct CandidateLocatorValidation<'a> {
    pub(super) gate: &'a ActivationGate,
    pub(super) store_id: &'a StoreId,
}

struct CandidateEventLocation<'a> {
    request_id: &'a str,
    store_id: &'a StoreId,
    event_id: &'a EventId,
}

struct CandidateActivationLocation<'a> {
    request_id: &'a str,
    store_id: &'a StoreId,
}

struct DecodedCandidateEvents {
    events: Vec<PairingActivationEvent>,
    heads: Vec<EventId>,
}

impl CandidateSchema {
    pub(super) fn gate_key(store_id: &StoreId) -> String {
        format!("companion-pairing-activation:gate:{}", store_id.as_str())
    }

    fn payload_prefix(request: &CandidateActivationLocation<'_>) -> String {
        let activation_id = Sha256Hex::from_bytes(
            format!("{}:{}", request.request_id, request.store_id.as_str()).as_bytes(),
        );
        format!("companion-pairing-activation:{}", activation_id.as_str())
    }

    fn event_key(request: &CandidateEventLocation<'_>) -> String {
        format!(
            "{}:event:{}",
            Self::payload_prefix(&CandidateActivationLocation {
                request_id: request.request_id,
                store_id: request.store_id,
            }),
            request.event_id.as_str()
        )
    }

    pub(super) fn encode(value: &impl Serialize) -> SchemaResult<String> {
        serde_json::to_string(value).map_err(|_| Self::integrity())
    }

    pub(super) fn decode<T>(value: &str) -> SchemaResult<T>
    where
        T: DeserializeOwned + Serialize,
    {
        let encoded: Value = serde_json::from_str(value).map_err(|_| Self::integrity())?;
        let decoded = serde_json::from_value(encoded.clone()).map_err(|_| Self::integrity())?;
        let canonical = serde_json::to_value(&decoded).map_err(|_| Self::integrity())?;
        if canonical != encoded {
            return Err(Self::integrity());
        }
        Ok(decoded)
    }

    pub(super) fn integrity() -> CompanionPairingCandidateFailure {
        CompanionPairingCandidateFailure::Integrity
    }
}

impl EncodedCandidate {
    pub(super) fn new(candidate: &PairingActivationCandidate) -> SchemaResult<Self> {
        let prefix = CandidateSchema::payload_prefix(&CandidateActivationLocation {
            request_id: &candidate.request_id,
            store_id: &candidate.vault_store_id,
        });
        let events = candidate
            .events
            .iter()
            .map(|event| {
                let row = ActivationEventRow {
                    event_id: event.event_id.as_str().to_owned(),
                    bytes: event.bytes.clone().into(),
                };
                Ok((
                    CandidateSchema::event_key(&CandidateEventLocation {
                        request_id: &candidate.request_id,
                        store_id: &candidate.vault_store_id,
                        event_id: &event.event_id,
                    }),
                    CandidateSchema::encode(&row)?,
                ))
            })
            .collect::<SchemaResult<Vec<_>>>()?;
        let providers = CandidateSchema::encode(&candidate.providers)?;
        Ok(Self {
            gate_key: CandidateSchema::gate_key(&candidate.vault_store_id),
            gate: ActivationGate {
                schema_version: PairingActivationSchemaVersion,
                request_id: candidate.request_id.clone(),
                vault_store_id: candidate.vault_store_id.as_str().to_owned(),
                application: candidate.application,
                stored_at: candidate.stored_at,
                event_count: u32::try_from(events.len())
                    .map_err(|_| CandidateSchema::integrity())?,
                event_heads: candidate.event_heads.clone(),
                provider_count: u32::try_from(candidate.providers.providers.len())
                    .map_err(|_| CandidateSchema::integrity())?,
                event_payload_keys: events.iter().map(|(key, _)| key.clone()).collect(),
                provider_payload_key: format!("{prefix}:providers"),
                event_digests: events
                    .iter()
                    .map(|(_, value)| Sha256Hex::from_bytes(value.as_bytes()))
                    .collect(),
                provider_digest: Sha256Hex::from_bytes(providers.as_bytes()),
                approval: candidate.approval.clone(),
            },
            events,
            providers,
        })
    }

    pub(super) fn validate_locator(request: &CandidateLocatorValidation<'_>) -> SchemaResult<()> {
        let CandidateLocatorValidation { gate, store_id } = request;
        let prefix = CandidateSchema::payload_prefix(&CandidateActivationLocation {
            request_id: &gate.request_id,
            store_id,
        });
        if gate.request_id.trim().is_empty()
            || gate.vault_store_id != store_id.as_str()
            || gate.event_payload_keys.len() != gate.event_count as usize
            || gate.event_digests.len() != gate.event_count as usize
            || gate
                .event_payload_keys
                .iter()
                .any(|key| !key.starts_with(&format!("{prefix}:event:")))
            || gate.provider_payload_key != format!("{prefix}:providers")
        {
            return Err(CandidateSchema::integrity());
        }
        Ok(())
    }

    pub(super) fn decode(self) -> SchemaResult<PairingActivationCandidate> {
        self.validate_payload_integrity()?;
        let store_id =
            StoreId::parse(&self.gate.vault_store_id).map_err(|_| CandidateSchema::integrity())?;
        Self::validate_locator(&CandidateLocatorValidation {
            gate: &self.gate,
            store_id: &store_id,
        })?;
        self.gate
            .approval
            .revalidate_at(self.gate.stored_at)
            .map_err(|_| CandidateSchema::integrity())?;
        let providers = self.decode_providers(&store_id)?;
        let decoded_events = self.decode_events(&store_id)?;
        Ok(PairingActivationCandidate {
            request_id: self.gate.request_id,
            vault_store_id: store_id,
            approval: self.gate.approval,
            application: self.gate.application,
            events: decoded_events.events,
            event_heads: decoded_events.heads,
            providers,
            stored_at: self.gate.stored_at,
        })
    }

    fn validate_payload_integrity(&self) -> SchemaResult<()> {
        if self
            .events
            .iter()
            .zip(&self.gate.event_payload_keys)
            .zip(&self.gate.event_digests)
            .any(|(((key, value), expected_key), expected_digest)| {
                key != expected_key || *expected_digest != Sha256Hex::from_bytes(value.as_bytes())
            })
            || self.gate.provider_digest != Sha256Hex::from_bytes(self.providers.as_bytes())
        {
            return Err(CandidateSchema::integrity());
        }
        Ok(())
    }

    fn decode_providers(&self, store_id: &StoreId) -> SchemaResult<AuthProvidersSnapshotData> {
        let providers: AuthProvidersSnapshotData = CandidateSchema::decode(&self.providers)?;
        if self.gate.application != VaultApplication::Extension
            || self.gate.request_id != self.gate.approval.request.request_id
            || self.gate.vault_store_id != self.gate.approval.vault_store_id
            || providers.providers.len() != self.gate.provider_count as usize
            || providers.active_vault_store_id.as_deref() != Some(store_id.as_str())
            || providers
                .providers
                .iter()
                .any(|provider| provider.store_id.as_deref() != Some(store_id.as_str()))
            || (!self
                .gate
                .approval
                .request
                .scopes
                .contains(&ExtensionConnectScope::SyncProviderCredentials)
                && !providers.providers.is_empty())
            || providers
                .companion_pairing_manifest_digest()
                .map_err(|_| CandidateSchema::integrity())?
                .as_str()
                != self.gate.approval.provider_manifest_digest.as_str()
        {
            return Err(CandidateSchema::integrity());
        }
        Ok(providers)
    }

    fn decode_events(&self, store_id: &StoreId) -> SchemaResult<DecodedCandidateEvents> {
        let mut event_store = LocalEventStore::new();
        let events = self
            .events
            .iter()
            .map(|(key, value)| {
                let row: ActivationEventRow = CandidateSchema::decode(value)?;
                let event_id =
                    EventId::parse(&row.event_id).map_err(|_| CandidateSchema::integrity())?;
                let expected_key = CandidateSchema::event_key(&CandidateEventLocation {
                    request_id: &self.gate.request_id,
                    store_id,
                    event_id: &event_id,
                });
                if key != expected_key {
                    return Err(CandidateSchema::integrity());
                }
                let bytes = EventStorageBytes::from(row.bytes);
                let event =
                    parse_event_storage_bytes(&bytes).map_err(|_| CandidateSchema::integrity())?;
                if serialize_event_storage_yaml(&event).map_err(|_| CandidateSchema::integrity())?
                    != bytes
                {
                    return Err(CandidateSchema::integrity());
                }
                let checked = CheckedRemoteEvent::parse(&event_id, &bytes)
                    .map_err(|_| CandidateSchema::integrity())?;
                if !checked.belongs_to_store(store_id.as_str())
                    || event_store.get_bytes(&event_id).is_some()
                {
                    return Err(CandidateSchema::integrity());
                }
                event_store.put_event(event_id.clone(), bytes.clone());
                Ok(PairingActivationEvent { event_id, bytes })
            })
            .collect::<SchemaResult<Vec<_>>>()?;
        let graph = event_store
            .load_graph(store_id.as_str())
            .map_err(|_| CandidateSchema::integrity())?;
        if graph.classify_vault_architecture() == EventGraphVaultArchitecture::Sentinel
            || !graph.pending_events().is_empty()
            || !graph.quarantined().is_empty()
        {
            return Err(CandidateSchema::integrity());
        }
        graph
            .validate_authorizations()
            .map_err(|_| CandidateSchema::integrity())?;
        let projection = VaultProjection::from_graph(&graph, store_id.as_str())
            .map_err(|_| CandidateSchema::integrity())?;
        let heads = graph.heads();
        if !projection.security_conflicts.is_empty() || heads != self.gate.event_heads {
            return Err(CandidateSchema::integrity());
        }
        PairingRecipientAccess::validate(&PairingRecipientAccessRequest {
            graph: &graph,
            approval: &self.gate.approval,
        })
        .map_err(|_| CandidateSchema::integrity())?;
        Ok(DecodedCandidateEvents { events, heads })
    }
}

#[cfg(test)]
mod tests {
    use super::super::super::tests::CandidateFixture;
    use super::*;
    use nook_companion_core::CompanionPairingProviderManifestDigest;
    use nook_core::{
        ActiveVaultScope, AppendEventInput, DeviceId, IsoTimestamp, ProviderVaultScope,
        SigningIdentity, StorageProviderData, VaultOperation, serialize_event_storage_yaml,
    };
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct GateEvidence {
        event_count: usize,
        provider_count: usize,
        event_payload_keys: Vec<String>,
        provider_payload_key: String,
        event_digests: Vec<Sha256Hex>,
        provider_digest: Sha256Hex,
    }

    impl GateEvidence {
        fn assert_real_v1_payload_relationships() -> anyhow::Result<()> {
            let encoded = EncodedCandidate::new(&CandidateFixture::candidate()?)?;
            let gate: Self = serde_json::from_str(&CandidateSchema::encode(&encoded.gate)?)?;
            assert_eq!(gate.event_count, encoded.events.len());
            assert_eq!(gate.provider_count, 0);
            for ((key, payload), (expected_key, digest)) in encoded
                .events
                .iter()
                .zip(gate.event_payload_keys.iter().zip(&gate.event_digests))
            {
                assert_eq!(key, expected_key);
                assert_eq!(*digest, Sha256Hex::from_bytes(payload.as_bytes()));
            }
            assert_eq!(gate.provider_payload_key, encoded.gate.provider_payload_key);
            assert_eq!(
                gate.provider_digest,
                Sha256Hex::from_bytes(encoded.providers.as_bytes())
            );
            Ok(())
        }
    }

    struct SchemaReadbackScenarios;

    impl SchemaReadbackScenarios {
        fn assert_strict_gate_boundaries() -> anyhow::Result<()> {
            let encoded = EncodedCandidate::new(&CandidateFixture::candidate()?)?;
            let gate_json = CandidateSchema::encode(&encoded.gate)?;
            let gate: ActivationGate = CandidateSchema::decode(&gate_json)?;
            EncodedCandidate::validate_locator(&CandidateLocatorValidation {
                gate: &gate,
                store_id: &StoreId::parse(&encoded.gate.vault_store_id)?,
            })?;
            for (field, replacement) in [("unexpected", true.into()), ("schema_version", 2.into())]
            {
                let mut value = serde_json::to_value(&encoded.gate)?;
                let object = value
                    .as_object_mut()
                    .ok_or_else(|| anyhow::anyhow!("gate must be an object"))?;
                object.insert(field.to_owned(), replacement);
                let json = serde_json::to_string(&value)?;
                assert!(matches!(
                    CandidateSchema::decode::<ActivationGate>(&json),
                    Err(CompanionPairingCandidateFailure::Integrity)
                ));
            }
            let mut value = serde_json::to_value(&encoded.gate)?;
            value
                .as_object_mut()
                .and_then(|gate| gate.get_mut("approval"))
                .and_then(Value::as_object_mut)
                .ok_or_else(|| anyhow::anyhow!("approval must be an object"))?
                .insert("unexpected".to_owned(), true.into());
            assert!(matches!(
                CandidateSchema::decode::<ActivationGate>(&serde_json::to_string(&value)?),
                Err(CompanionPairingCandidateFailure::Integrity)
            ));
            Ok(())
        }

        fn assert_digest_and_correlation_rejections() -> anyhow::Result<()> {
            let candidate = CandidateFixture::candidate()?;
            let mut event_digest = EncodedCandidate::new(&candidate)?;
            event_digest.gate.event_digests[0] = Sha256Hex::from_bytes(b"substituted");
            Self::assert_integrity(event_digest);
            let mut provider_digest = EncodedCandidate::new(&candidate)?;
            provider_digest.gate.provider_digest = Sha256Hex::from_bytes(b"substituted");
            Self::assert_integrity(provider_digest);
            let mut approval = EncodedCandidate::new(&candidate)?;
            approval.gate.approval.vault_store_id = "store_testtoken12".to_owned();
            Self::assert_integrity(approval);
            let mut expired = EncodedCandidate::new(&candidate)?;
            expired.gate.stored_at = serde_json::from_str("200")?;
            Self::assert_integrity(expired);
            let mut count = EncodedCandidate::new(&candidate)?;
            count.gate.event_count = 2;
            Self::assert_integrity(count);
            let mut key = EncodedCandidate::new(&candidate)?;
            key.gate.provider_payload_key = "companion-pairing-activation:other".to_owned();
            Self::assert_integrity(key);
            let mut heads = EncodedCandidate::new(&candidate)?;
            heads.gate.event_heads.clear();
            Self::assert_integrity(heads);
            Ok(())
        }

        fn assert_strict_payload_rejections() -> anyhow::Result<()> {
            let candidate = CandidateFixture::candidate()?;
            let mut event = EncodedCandidate::new(&candidate)?;
            let mut event_value: Value = serde_json::from_str(&event.events[0].1)?;
            event_value
                .as_object_mut()
                .ok_or_else(|| anyhow::anyhow!("event must be an object"))?
                .insert("unexpected".to_owned(), true.into());
            event.events[0].1 = serde_json::to_string(&event_value)?;
            event.gate.event_digests[0] = Sha256Hex::from_bytes(event.events[0].1.as_bytes());
            Self::assert_integrity(event);
            let mut inner_event = EncodedCandidate::new(&candidate)?;
            let mut row: Value = serde_json::from_str(&inner_event.events[0].1)?;
            let bytes = row
                .as_object_mut()
                .and_then(|object| object.get_mut("bytes"))
                .ok_or_else(|| anyhow::anyhow!("event row bytes must be present"))?;
            let mut yaml = String::from_utf8(serde_json::from_value(bytes.clone())?)?;
            yaml.push_str("unexpected: true\n");
            *bytes = serde_json::to_value(yaml.into_bytes())?;
            inner_event.events[0].1 = serde_json::to_string(&row)?;
            inner_event.gate.event_digests[0] =
                Sha256Hex::from_bytes(inner_event.events[0].1.as_bytes());
            Self::assert_integrity(inner_event);
            let mut providers = EncodedCandidate::new(&candidate)?;
            let mut value: Value = serde_json::from_str(&providers.providers)?;
            value
                .as_object_mut()
                .ok_or_else(|| anyhow::anyhow!("providers must be an object"))?
                .insert("unexpected".to_owned(), true.into());
            providers.providers = serde_json::to_string(&value)?;
            providers.gate.provider_digest = Sha256Hex::from_bytes(providers.providers.as_bytes());
            Self::assert_integrity(providers);
            let mut providers = EncodedCandidate::new(&Self::candidate_with_provider()?)?;
            let mut value: Value = serde_json::from_str(&providers.providers)?;
            value
                .as_object_mut()
                .and_then(|snapshot| snapshot.get_mut("providers"))
                .and_then(Value::as_array_mut)
                .and_then(|rows| rows.first_mut())
                .and_then(Value::as_object_mut)
                .ok_or_else(|| anyhow::anyhow!("provider must be an object"))?
                .insert("unexpected".to_owned(), true.into());
            providers.providers = serde_json::to_string(&value)?;
            providers.gate.provider_digest = Sha256Hex::from_bytes(providers.providers.as_bytes());
            Self::assert_integrity(providers);
            Ok(())
        }

        fn assert_event_key_alias_rejected() -> anyhow::Result<()> {
            let mut encoded = EncodedCandidate::new(&CandidateFixture::candidate()?)?;
            let canonical_key = &encoded.events[0].0;
            let alias_key = canonical_key.replacen(":event:", ":event:alias:event:", 1);
            encoded.events[0].0.clone_from(&alias_key);
            encoded.gate.event_payload_keys[0] = alias_key;
            encoded.gate.event_digests[0] = Sha256Hex::from_bytes(encoded.events[0].1.as_bytes());
            Self::assert_integrity(encoded);
            Ok(())
        }

        fn assert_other_recipient_graph_rejected() -> anyhow::Result<()> {
            let candidate = CandidateFixture::candidate()?;
            let other = EncodedCandidate::new(&CandidateFixture::candidate()?)?;
            let mut encoded = EncodedCandidate::new(&candidate)?;
            encoded.events = other.events;
            encoded.gate.event_payload_keys = other.gate.event_payload_keys;
            encoded.gate.event_digests = other.gate.event_digests;
            encoded.gate.event_heads = other.gate.event_heads;
            Self::assert_integrity(encoded);
            Ok(())
        }

        fn assert_recipient_loss_rejected() -> anyhow::Result<()> {
            let fixture = CandidateFixture::new()?.into_commit_fixture(serde_json::from_str::<
                CompanionPairingEpochMilliseconds,
            >("160")?)?;
            let mut candidate = fixture.candidate;
            let signing =
                SigningIdentity::from_seed_hex_stored(&fixture.manager.event_log.signing_seed)?;
            let parent = candidate.event_heads[0].clone();
            let (event, _) = AppendEventInput::build(AppendEventInput {
                store_id: &candidate.vault_store_id,
                actor_id: &signing.actor_id()?,
                signing_identity: &signing,
                parents: vec![parent.clone()],
                key_epoch: &parent,
                created_at: &IsoTimestamp::parse("2026-09-08T00:00:01Z")?,
                operations: vec![VaultOperation::DeviceRevoked {
                    device_id: DeviceId::parse(&candidate.approval.request.installation.app_id)?,
                }],
            })?;
            let event_id = event.id()?;
            candidate.events.push(PairingActivationEvent {
                event_id: event_id.clone(),
                bytes: serialize_event_storage_yaml(&event)?,
            });
            candidate.event_heads = vec![event_id];
            Self::assert_integrity(EncodedCandidate::new(&candidate)?);
            Ok(())
        }

        fn assert_integrity(encoded: EncodedCandidate) {
            assert!(matches!(
                encoded.decode(),
                Err(CompanionPairingCandidateFailure::Integrity)
            ));
        }

        fn candidate_with_provider() -> anyhow::Result<PairingActivationCandidate> {
            let mut fixture =
                CandidateFixture::new()?.into_commit_fixture(serde_json::from_str::<
                    CompanionPairingEpochMilliseconds,
                >("160")?)?;
            let identity = fixture.manager.device_identity()?;
            let store_id = fixture.candidate.vault_store_id.as_str().to_owned();
            let mut provider = StorageProviderData::github(
                "github-schema",
                "GitHub",
                "github_pat_schema",
                "nook",
                "2026-09-08T00:00:00Z",
            );
            provider.store_id = ProviderVaultScope::StoreId(store_id.clone());
            fixture.candidate.providers.providers.push(provider);
            fixture.candidate.providers.active_vault_store_id = ActiveVaultScope::StoreId(store_id);
            fixture
                .candidate
                .providers
                .seal_credentials_for(&identity.public_key())?;
            fixture
                .candidate
                .approval
                .request
                .scopes
                .push(ExtensionConnectScope::SyncProviderCredentials);
            fixture.candidate.approval.provider_manifest_digest =
                CompanionPairingProviderManifestDigest::parse(
                    fixture
                        .candidate
                        .providers
                        .companion_pairing_manifest_digest()?
                        .as_str(),
                )?;
            Ok(fixture.candidate)
        }
    }

    #[test]
    fn serialized_v1_gate_commits_exact_payload_relationships() -> anyhow::Result<()> {
        GateEvidence::assert_real_v1_payload_relationships()
    }

    #[test]
    fn strict_gate_rejects_unknown_fields_and_versions() -> anyhow::Result<()> {
        SchemaReadbackScenarios::assert_strict_gate_boundaries()
    }

    #[test]
    fn readback_rejects_digest_and_correlation_substitution() -> anyhow::Result<()> {
        SchemaReadbackScenarios::assert_digest_and_correlation_rejections()
    }

    #[test]
    fn readback_rejects_noncanonical_event_and_provider_payloads() -> anyhow::Result<()> {
        SchemaReadbackScenarios::assert_strict_payload_rejections()
    }

    #[test]
    fn readback_rejects_event_storage_key_alias() -> anyhow::Result<()> {
        SchemaReadbackScenarios::assert_event_key_alias_rejected()
    }

    #[test]
    fn coherent_graph_for_another_recipient_is_rejected() -> anyhow::Result<()> {
        SchemaReadbackScenarios::assert_other_recipient_graph_rejected()
    }

    #[test]
    fn graph_that_revokes_approved_recipient_is_rejected() -> anyhow::Result<()> {
        SchemaReadbackScenarios::assert_recipient_loss_rejected()
    }
}
