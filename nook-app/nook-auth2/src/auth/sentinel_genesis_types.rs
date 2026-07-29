use super::multi_device::SentinelShareEnvelope;
use crate::{
    CompactToken, DeviceId, DevicePublicKey, DeviceSigningPublicKey, MultiDeviceError,
    MultiDeviceResult, StoreId, StoredSecretRecord,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelGenesisPolicy {
    pub participant_count: u8,
    pub threshold: u8,
}

impl SentinelGenesisPolicy {
    pub fn validate(self) -> MultiDeviceResult<()> {
        if self.threshold < 2
            || self.participant_count < 2
            || self.participant_count > 16
            || self.threshold > self.participant_count
        {
            return Err(MultiDeviceError::InvalidSentinelThreshold);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelGenesisRequest {
    pub version: u32,
    pub session_id: CompactToken,
    pub policy: SentinelGenesisPolicy,
    pub initiator_device_id: DeviceId,
    pub initiator_signing_public_key: DeviceSigningPublicKey,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelGenesisParticipant {
    pub device_id: DeviceId,
    pub encryption_public_key: DevicePublicKey,
    pub signing_public_key: DeviceSigningPublicKey,
    pub label: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelGenesisParticipantResponse {
    pub version: u32,
    pub session_id: CompactToken,
    pub participant: SentinelGenesisParticipant,
    pub signature: String,
}

/// Provider-free public key bundle a participant can share before any initiator
/// request exists. The initiator binds it to the active genesis session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelGenesisPublicKeyAnnouncement {
    pub kind: String,
    pub version: u32,
    pub device_id: DeviceId,
    pub encryption_public_key: DevicePublicKey,
    pub signing_public_key: DeviceSigningPublicKey,
    pub label: String,
    pub fingerprint: String,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelGenesisSession {
    pub request: SentinelGenesisRequest,
    /// Verified responses are intentionally session-only. Serializing a public
    /// draft never turns unverified participant fields into a trusted roster;
    /// deserialization yields an incomplete request-only draft that must be
    /// restarted through `start_sentinel_genesis`.
    #[serde(skip, default)]
    pub(super) participants: Vec<SentinelGenesisParticipant>,
}

impl SentinelGenesisSession {
    #[must_use]
    pub fn participants(&self) -> &[SentinelGenesisParticipant] {
        &self.participants
    }

    #[must_use]
    pub fn is_complete(&self) -> bool {
        self.participants.len() == usize::from(self.request.policy.participant_count)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelGenesisShareDelivery {
    pub version: u32,
    pub session_id: CompactToken,
    pub store_id: StoreId,
    pub policy: SentinelGenesisPolicy,
    pub device_id: DeviceId,
    pub encryption_public_key: DevicePublicKey,
    pub share: SentinelShareEnvelope,
    pub initiator_signing_public_key: DeviceSigningPublicKey,
    pub signature: String,
}

/// Atomic result of the key-generation step. Callers must serialize all
/// records together; no API exposes a partially issued share set.
pub struct SentinelGenesisIssued {
    pub records: Vec<StoredSecretRecord>,
    pub participants: Vec<SentinelGenesisParticipant>,
    pub deliveries: Vec<SentinelGenesisShareDelivery>,
}
