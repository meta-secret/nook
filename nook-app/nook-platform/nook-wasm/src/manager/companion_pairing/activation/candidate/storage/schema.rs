//! Write-only V1 schema for inert activation candidate publication.

use super::super::{CompanionPairingCandidateFailure, PairingActivationCandidate};
use nook_companion_core::{CompanionPairingApproval, CompanionPairingEpochMilliseconds};
use nook_core::{Sha256Hex, VaultApplication};
use serde::{Serialize, Serializer};

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

#[derive(Serialize)]
#[serde(deny_unknown_fields)]
struct ActivationEventRow {
    event_id: String,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
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

pub(super) struct CandidateSchema;

impl CandidateSchema {
    pub(super) fn gate_key(vault_store_id: &str) -> String {
        format!("companion-pairing-activation:gate:{vault_store_id}")
    }

    pub(super) fn encode(value: &impl Serialize) -> SchemaResult<String> {
        serde_json::to_string(value).map_err(|_| Self::integrity())
    }

    pub(super) fn integrity() -> CompanionPairingCandidateFailure {
        CompanionPairingCandidateFailure::Integrity
    }
}

impl EncodedCandidate {
    pub(super) fn new(candidate: &PairingActivationCandidate) -> SchemaResult<Self> {
        let activation_id = Sha256Hex::from_bytes(
            format!(
                "{}:{}",
                candidate.request_id,
                candidate.vault_store_id.as_str()
            )
            .as_bytes(),
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
            gate_key: CandidateSchema::gate_key(candidate.vault_store_id.as_str()),
            gate: ActivationGate {
                schema_version: PairingActivationSchemaVersion,
                request_id: candidate.request_id.clone(),
                vault_store_id: candidate.vault_store_id.as_str().to_owned(),
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
}

#[cfg(test)]
mod tests {
    use super::super::super::tests::CandidateFixture;
    use super::*;
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

    #[test]
    fn serialized_v1_gate_commits_exact_payload_relationships() -> anyhow::Result<()> {
        GateEvidence::assert_real_v1_payload_relationships()
    }
}
