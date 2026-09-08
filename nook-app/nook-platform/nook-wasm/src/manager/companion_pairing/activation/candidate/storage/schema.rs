//! Strict persisted V1 schema and coherence checks for inert candidates.

use super::super::{
    CompanionPairingCandidateFailure, PairingActivationCandidate, PairingActivationEvent,
};
use nook_companion_core::{
    CompanionPairingApproval, CompanionPairingEpochMilliseconds, ExtensionConnectScope,
};
use nook_core::{
    AuthProvidersSnapshotData, CheckedRemoteEvent, EventGraphVaultArchitecture, EventId,
    EventStorageBytes, LocalEventStore, Sha256Hex, VaultApplication,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};

type SchemaResult<T> = Result<T, CompanionPairingCandidateFailure>;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(try_from = "u32", into = "u32")]
enum PairingActivationSchemaVersion {
    V1,
}

impl From<PairingActivationSchemaVersion> for u32 {
    fn from(_: PairingActivationSchemaVersion) -> Self {
        1
    }
}

impl TryFrom<u32> for PairingActivationSchemaVersion {
    type Error = CompanionPairingCandidateFailure;

    fn try_from(value: u32) -> Result<Self, Self::Error> {
        if value == 1 {
            Ok(Self::V1)
        } else {
            Err(CompanionPairingCandidateFailure::UnsupportedSchema)
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct ActivationEventRow {
    event_id: String,
    bytes: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(super) struct ActivationGate {
    schema_version: PairingActivationSchemaVersion,
    request_id: String,
    vault_store_id: String,
    application: VaultApplication,
    stored_at: CompanionPairingEpochMilliseconds,
    event_count: u32,
    event_heads: Vec<String>,
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

#[derive(Deserialize)]
struct SchemaVersionProbe {
    schema_version: u32,
}

pub(super) struct CandidateSchema;

impl CandidateSchema {
    pub(super) fn gate_key(vault_store_id: &str) -> String {
        format!("companion-pairing-activation:gate:{vault_store_id}")
    }

    pub(super) fn encode(value: &impl Serialize) -> SchemaResult<String> {
        serde_json::to_string(value).map_err(|_| Self::integrity())
    }

    pub(super) fn decode<T: DeserializeOwned>(value: &str) -> SchemaResult<T> {
        serde_json::from_str(value).map_err(|_| Self::integrity())
    }

    pub(super) fn decode_gate(value: &str) -> SchemaResult<ActivationGate> {
        let probe: SchemaVersionProbe = Self::decode(value)?;
        PairingActivationSchemaVersion::try_from(probe.schema_version)?;
        Self::decode(value)
    }

    pub(super) fn integrity() -> CompanionPairingCandidateFailure {
        CompanionPairingCandidateFailure::Integrity
    }
}

impl EncodedCandidate {
    pub(super) fn new(candidate: &PairingActivationCandidate) -> SchemaResult<Self> {
        let activation_id = Sha256Hex::from_bytes(
            format!("{}:{}", candidate.request_id, candidate.vault_store_id).as_bytes(),
        );
        let prefix = format!("companion-pairing-activation:{}", activation_id.as_str());
        let events = candidate
            .events
            .iter()
            .map(|event| {
                let row = ActivationEventRow {
                    event_id: event.event_id.as_str().to_owned(),
                    bytes: event.bytes.clone().into(),
                };
                Ok((
                    format!("{prefix}:event:{}", row.event_id),
                    CandidateSchema::encode(&row)?,
                ))
            })
            .collect::<SchemaResult<Vec<_>>>()?;
        let providers = CandidateSchema::encode(&candidate.providers)?;
        Ok(Self {
            gate_key: CandidateSchema::gate_key(&candidate.vault_store_id),
            gate: ActivationGate {
                schema_version: PairingActivationSchemaVersion::V1,
                request_id: candidate.request_id.clone(),
                vault_store_id: candidate.vault_store_id.clone(),
                application: candidate.application,
                stored_at: candidate.stored_at,
                event_count: u32::try_from(events.len())
                    .map_err(|_| CandidateSchema::integrity())?,
                event_heads: candidate
                    .event_heads
                    .iter()
                    .map(|head| head.as_str().to_owned())
                    .collect(),
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

    pub(super) fn decode(&self) -> SchemaResult<PairingActivationCandidate> {
        if self.gate.event_payload_keys.len() != self.events.len()
            || self.gate.event_digests.len() != self.events.len()
            || self
                .events
                .iter()
                .zip(&self.gate.event_payload_keys)
                .zip(&self.gate.event_digests)
                .any(|(((key, value), expected_key), digest)| {
                    key != expected_key || *digest != Sha256Hex::from_bytes(value.as_bytes())
                })
            || self.gate.provider_digest != Sha256Hex::from_bytes(self.providers.as_bytes())
        {
            return Err(CandidateSchema::integrity());
        }
        let events = self
            .events
            .iter()
            .map(|(_, value)| {
                let row: ActivationEventRow = CandidateSchema::decode(value)?;
                Ok(PairingActivationEvent {
                    event_id: EventId::parse(&row.event_id)
                        .map_err(|_| CandidateSchema::integrity())?,
                    bytes: EventStorageBytes::from(row.bytes),
                })
            })
            .collect::<SchemaResult<Vec<_>>>()?;
        let providers: AuthProvidersSnapshotData = CandidateSchema::decode(&self.providers)?;
        let candidate = PairingActivationCandidate {
            request_id: self.gate.request_id.clone(),
            vault_store_id: self.gate.vault_store_id.clone(),
            approval: self.gate.approval.clone(),
            application: self.gate.application,
            stored_at: self.gate.stored_at,
            event_heads: self
                .gate
                .event_heads
                .iter()
                .map(|head| EventId::parse(head).map_err(|_| CandidateSchema::integrity()))
                .collect::<SchemaResult<Vec<_>>>()?,
            events,
            providers,
        };
        self.validate_candidate(&candidate)?;
        Ok(candidate)
    }

    fn validate_candidate(&self, candidate: &PairingActivationCandidate) -> SchemaResult<()> {
        let approval = &candidate.approval;
        if CandidateSchema::gate_key(&candidate.vault_store_id) != self.gate_key
            || candidate.application != VaultApplication::Extension
            || candidate.request_id.trim().is_empty()
            || candidate.request_id != approval.request.request_id
            || candidate.vault_store_id != approval.vault_store_id
            || candidate.events.len() != self.gate.event_count as usize
            || candidate.providers.providers.len() != self.gate.provider_count as usize
            || candidate.providers.active_vault_store_id.as_deref()
                != Some(candidate.vault_store_id.as_str())
            || candidate.providers.providers.iter().any(|provider| {
                provider.store_id.as_deref() != Some(candidate.vault_store_id.as_str())
            })
            || (!approval
                .request
                .scopes
                .contains(&ExtensionConnectScope::SyncProviderCredentials)
                && !candidate.providers.providers.is_empty())
        {
            return Err(CandidateSchema::integrity());
        }
        approval
            .revalidate_at(candidate.stored_at)
            .map_err(|_| CandidateSchema::integrity())?;
        let digest = candidate
            .providers
            .companion_pairing_manifest_digest()
            .map_err(|_| CandidateSchema::integrity())?;
        if digest.as_str() != approval.provider_manifest_digest.as_str() {
            return Err(CandidateSchema::integrity());
        }
        let mut store = LocalEventStore::new();
        for event in &candidate.events {
            if !CheckedRemoteEvent::parse(&event.event_id, &event.bytes)
                .map_err(|_| CandidateSchema::integrity())?
                .belongs_to_store(&candidate.vault_store_id)
                || store.get_bytes(&event.event_id).is_some()
            {
                return Err(CandidateSchema::integrity());
            }
            store.put_event(event.event_id.clone(), event.bytes.clone());
        }
        let graph = store
            .load_graph(&candidate.vault_store_id)
            .map_err(|_| CandidateSchema::integrity())?;
        graph
            .validate_authorizations()
            .map_err(|_| CandidateSchema::integrity())?;
        if graph.classify_vault_architecture() != EventGraphVaultArchitecture::Simple
            || !graph.pending_events().is_empty()
            || !graph.quarantined().is_empty()
            || graph.heads() != candidate.event_heads
        {
            return Err(CandidateSchema::integrity());
        }
        Ok(())
    }
}
