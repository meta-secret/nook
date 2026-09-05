use super::multi_device::SentinelShareEnvelope;
use crate::{
    CompactToken, DeviceId, DevicePublicKey, DeviceSigningPublicKey, MultiDeviceError,
    MultiDeviceResult, StoreId, StoredSecretRecord,
};
use crate::{SentinelParticipantCount, SentinelThreshold};
use serde::{Deserialize, Deserializer, Serialize, de};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct SentinelGenesisVersion(u32);

impl SentinelGenesisVersion {
    pub const CURRENT: Self = Self(1);

    fn parse(value: u32) -> Result<Self, &'static str> {
        match value {
            1 => Ok(Self::CURRENT),
            _ => Err("unsupported Sentinel genesis version"),
        }
    }
}

impl From<SentinelGenesisVersion> for u32 {
    fn from(value: SentinelGenesisVersion) -> Self {
        value.0
    }
}

impl<'de> Deserialize<'de> for SentinelGenesisVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::parse(u32::deserialize(deserializer)?).map_err(de::Error::custom)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelGenesisPolicy {
    pub participant_count: SentinelParticipantCount,
    pub threshold: SentinelThreshold,
}

impl SentinelGenesisPolicy {
    pub fn validate(self) -> MultiDeviceResult<()> {
        if u8::from(self.threshold) < 2
            || u8::from(self.participant_count) < 2
            || u8::from(self.participant_count) > 16
            || u8::from(self.threshold) > u8::from(self.participant_count)
        {
            return Err(MultiDeviceError::InvalidSentinelThreshold);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelGenesisRequest {
    pub version: SentinelGenesisVersion,
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
    pub version: SentinelGenesisVersion,
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
    pub version: SentinelGenesisVersion,
    pub device_id: DeviceId,
    pub encryption_public_key: DevicePublicKey,
    pub signing_public_key: DeviceSigningPublicKey,
    pub label: String,
    pub fingerprint: String,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelGenesisShareDelivery {
    pub version: SentinelGenesisVersion,
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
