use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Deserializer, Serialize, de};
use zeroize::Zeroize;

use super::secret_sharing::{split_secret_bytes, validate_sentinel_threshold};
use super::{DeviceIdentity, VaultKeys, VaultMetaRecord};
use crate::auth::slip39;
use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{
    AgeArmoredCiphertext, DeviceId, DevicePublicKey, SentinelParticipantCount, SentinelRecordCount,
    SentinelShareIndex, SentinelThreshold, StoredSecretRecord,
};

mod quorum;
use quorum::SentinelVaultKeyDerivation;
pub use quorum::{SentinelKeyReconstruction, SentinelShareOpening};

pub const SENTINEL_SHARE_RECORD_PREFIX: &str = "sentinel_share:";

#[must_use]
pub fn sentinel_share_record_key(device_id: &DeviceId) -> String {
    format!("{SENTINEL_SHARE_RECORD_PREFIX}{device_id}")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SentinelShareEnvelope {
    pub version: SentinelShareVersion,
    pub threshold: SentinelThreshold,
    pub required_participants: SentinelParticipantCount,
    pub share_index: SentinelShareIndex,
    pub ciphertext: AgeArmoredCiphertext,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct SentinelSharePlaintext {
    version: SentinelShareVersion,
    threshold: SentinelThreshold,
    required_participants: SentinelParticipantCount,
    share_index: SentinelShareIndex,
    share: String,
}

/// Internal opened Sentinel share used only inside the Rust-owned unlock protocol.
///
/// This type contains plaintext share material. Browser/WASM APIs must wrap it
/// in a signed, session-bound encrypted [`crate::SentinelUnlockResponse`] and must
/// never serialize it directly to JavaScript.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenedSentinelShare {
    pub version: SentinelShareVersion,
    pub threshold: SentinelThreshold,
    pub required_participants: SentinelParticipantCount,
    pub share_index: SentinelShareIndex,
    /// Base64url of share bytes (same encoding as the decrypted share plaintext).
    pub share: String,
    pub device_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct SentinelShareVersion(u32);

impl SentinelShareVersion {
    pub const LEGACY: Self = Self(1);
    pub const CURRENT: Self = Self(2);

    fn parse(value: u32) -> Result<Self, &'static str> {
        match value {
            1 => Ok(Self::LEGACY),
            2 => Ok(Self::CURRENT),
            _ => Err("unsupported Sentinel share version"),
        }
    }
}

impl From<SentinelShareVersion> for u32 {
    fn from(value: SentinelShareVersion) -> Self {
        value.0
    }
}

impl<'de> Deserialize<'de> for SentinelShareVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::parse(u32::deserialize(deserializer)?).map_err(de::Error::custom)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct SentinelVaultKeysPlaintext {
    secrets_key: String,
    members_key: String,
}

pub fn parse_sentinel_share_envelope(value: &str) -> MultiDeviceResult<SentinelShareEnvelope> {
    serde_json::from_str(value).map_err(MultiDeviceError::SentinelShareJson)
}

pub fn is_sentinel_share_stored_record(record: &StoredSecretRecord) -> MultiDeviceResult<bool> {
    Ok(matches!(
        VaultMetaRecord::classify(record)?,
        VaultMetaRecord::SentinelShare(..)
    ))
}

pub fn create_sentinel_share_records(
    keys: &VaultKeys,
    participants: &[DeviceIdentity],
    threshold: SentinelThreshold,
) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
    let recipients: Vec<(DeviceId, DevicePublicKey)> = participants
        .iter()
        .map(|participant| (participant.device_id().clone(), participant.public_key()))
        .collect();
    create_sentinel_share_records_for_recipients(keys, &recipients, threshold)
}

/// Split vault keys into threshold shares encrypted to each recipient public key.
///
/// Interim GF(256) Shamir (byte-wise). Product SLIP-0039 mnemonic shares are
/// owned by #261 and should replace this once wired; do not invent a second
/// mnemonic format here.
pub fn create_sentinel_share_records_for_recipients(
    keys: &VaultKeys,
    recipients: &[(DeviceId, DevicePublicKey)],
    threshold: SentinelThreshold,
) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
    let required_participants = SentinelParticipantCount::from(
        u8::try_from(recipients.len()).map_err(|_| MultiDeviceError::InvalidSentinelThreshold)?,
    );
    validate_sentinel_threshold(threshold.into(), required_participants.into())?;
    let payload = serde_json::to_vec(&SentinelVaultKeysPlaintext {
        secrets_key: keys.secrets_key.as_str().to_owned(),
        members_key: keys.members_key.as_str().to_owned(),
    })
    .map_err(MultiDeviceError::SentinelSharePayload)?;
    let shares = split_secret_bytes(&payload, threshold.into(), required_participants.into())?;
    recipients
        .iter()
        .zip(shares)
        .map(|((device_id, public_key), share)| {
            let plaintext = SentinelSharePlaintext {
                version: SentinelShareVersion::LEGACY,
                threshold,
                required_participants,
                share_index: share.index.into(),
                share: URL_SAFE_NO_PAD.encode(&share.bytes),
            };
            let json =
                serde_json::to_vec(&plaintext).map_err(MultiDeviceError::SentinelSharePayload)?;
            let envelope = SentinelShareEnvelope {
                version: SentinelShareVersion::LEGACY,
                threshold,
                required_participants,
                share_index: share.index.into(),
                ciphertext: public_key.seal_bytes(&json)?,
            };
            VaultMetaRecord::SentinelShare(device_id.clone(), envelope).to_stored()
        })
        .collect()
}

/// Generate one Sentinel root, derive the explicit vault keys with
/// domain-separated HKDF, and issue encrypted current-format SLIP-0039 shares
/// atomically. Version 2 is deliberately distinct from legacy version-1 JSON
/// key bundles, which remain readable.
pub fn create_sentinel_root_share_records_for_recipients(
    recipients: &[(DeviceId, DevicePublicKey)],
    threshold: SentinelThreshold,
) -> MultiDeviceResult<(VaultKeys, Vec<StoredSecretRecord>)> {
    let required_participants = SentinelParticipantCount::from(
        u8::try_from(recipients.len()).map_err(|_| MultiDeviceError::InvalidSentinelThreshold)?,
    );
    validate_sentinel_threshold(threshold.into(), required_participants.into())?;
    let mut root = [0_u8; 32];
    getrandom::fill(&mut root).map_err(|error| MultiDeviceError::GenerateKey(error.to_string()))?;
    let keys = SentinelVaultKeyDerivation::new(&root).derive()?;
    let shares = slip39::SentinelSecretSplitRequest::new(
        &root,
        threshold.into(),
        required_participants.into(),
    )
    .issue()?;
    root.zeroize();
    let records = recipients
        .iter()
        .zip(shares)
        .enumerate()
        .map(|(offset, ((device_id, public_key), share))| {
            let share_index = SentinelShareIndex::from(
                u8::try_from(offset + 1).map_err(|_| MultiDeviceError::InvalidSentinelThreshold)?,
            );
            let plaintext = SentinelSharePlaintext {
                version: SentinelShareVersion::CURRENT,
                threshold,
                required_participants,
                share_index,
                share,
            };
            let json =
                serde_json::to_vec(&plaintext).map_err(MultiDeviceError::SentinelSharePayload)?;
            let envelope = SentinelShareEnvelope {
                version: SentinelShareVersion::CURRENT,
                threshold,
                required_participants,
                share_index,
                ciphertext: public_key.seal_bytes(&json)?,
            };
            VaultMetaRecord::SentinelShare(device_id.clone(), envelope).to_stored()
        })
        .collect::<MultiDeviceResult<Vec<_>>>()?;
    Ok((keys, records))
}

pub fn count_sentinel_share_records(
    records: &[StoredSecretRecord],
) -> MultiDeviceResult<SentinelRecordCount> {
    let mut count = 0;
    for record in records {
        if is_sentinel_share_stored_record(record)? {
            count += 1;
        }
    }
    Ok(count.into())
}

#[cfg(test)]
mod tests {
    use std::slice;

    use super::super::{
        ConnectAccessStatus, DeviceIdentity, VaultRecordView, assess_connect_access,
        device_is_enrolled,
    };
    use super::*;

    type SentinelShareFixture = (VaultKeys, [DeviceIdentity; 3], Vec<StoredSecretRecord>);

    fn sentinel_share_fixture() -> anyhow::Result<SentinelShareFixture> {
        let keys = VaultKeys::generate()?;
        let identities = [
            DeviceIdentity::generate()?,
            DeviceIdentity::generate()?,
            DeviceIdentity::generate()?,
        ];
        let records = create_sentinel_share_records(&keys, &identities, 2.into())?;
        Ok((keys, identities, records))
    }

    #[test]
    fn sentinel_share_version_preserves_supported_scalars_and_rejects_others() -> anyhow::Result<()>
    {
        for (raw, expected) in [
            ("1", SentinelShareVersion::LEGACY),
            ("2", SentinelShareVersion::CURRENT),
        ] {
            let version: SentinelShareVersion = serde_json::from_str(raw)?;
            assert_eq!(version, expected);
            assert_eq!(serde_json::to_string(&version)?, raw);
        }
        for raw in ["0", "3", "4294967296"] {
            assert!(serde_json::from_str::<SentinelShareVersion>(raw).is_err());
        }
        Ok(())
    }

    #[test]
    fn sentinel_threshold_shares_reconstruct_keys_without_full_device_envelopes()
    -> anyhow::Result<()> {
        let (keys, [first, second, third], records) = sentinel_share_fixture()?;

        assert_eq!(records.len(), 3);
        for record in &records {
            assert!(is_sentinel_share_stored_record(record)?);
            assert!(!VaultMetaRecord::is_auth(record)?);
        }
        assert!(VaultRecordView::new(&records).secrets_key(&first).is_err());
        assert!(
            SentinelKeyReconstruction::from_identities(&records, slice::from_ref(&first))
                .reconstruct()
                .is_err()
        );

        let reconstructed =
            SentinelKeyReconstruction::from_identities(&records, &[first.clone(), second.clone()])
                .reconstruct()?;
        assert_eq!(reconstructed, keys);

        let alternate =
            SentinelKeyReconstruction::from_identities(&records, &[second, third]).reconstruct()?;
        assert_eq!(alternate, keys);
        Ok(())
    }

    #[test]
    fn opened_sentinel_shares_reconstruct_without_peer_identities() -> anyhow::Result<()> {
        let (keys, [first, second, third], records) = sentinel_share_fixture()?;

        let opened_first = SentinelShareOpening::new(&records, &first).open()?;
        let opened_second = SentinelShareOpening::new(&records, &second).open()?;
        assert_eq!(opened_first.device_id, first.device_id().as_str());
        assert_eq!(u8::from(opened_second.threshold), 2);

        assert!(
            SentinelKeyReconstruction::from_opened(&records, slice::from_ref(&opened_first))
                .reconstruct()
                .is_err()
        );

        let reconstructed =
            SentinelKeyReconstruction::from_opened(&records, &[opened_first, opened_second])
                .reconstruct()?;
        assert_eq!(reconstructed, keys);

        // Share-row enrollment counts as Ready without an auth envelope.
        assert!(device_is_enrolled(&records, &first)?);
        assert_eq!(
            assess_connect_access(&records, &third)?,
            ConnectAccessStatus::Ready
        );
        assert!(VaultRecordView::new(&records).secrets_key(&first).is_err());
        Ok(())
    }

    #[test]
    fn quorum_admission_validates_all_opened_contributions_before_reconstructing()
    -> anyhow::Result<()> {
        let (keys, [first, second, third], records) = sentinel_share_fixture()?;
        let opened_first = SentinelShareOpening::new(&records, &first).open()?;
        let opened_second = SentinelShareOpening::new(&records, &second).open()?;
        let mut malformed_third = SentinelShareOpening::new(&records, &third).open()?;
        malformed_third.share.push('!');

        let rejected = SentinelKeyReconstruction::from_opened(
            &records,
            &[opened_first.clone(), opened_second.clone(), malformed_third],
        )
        .reconstruct();
        assert!(matches!(
            rejected,
            Err(MultiDeviceError::InvalidSentinelShareEncoding)
        ));

        let reconstructed = SentinelKeyReconstruction::from_opened(
            &records,
            &[
                opened_first,
                opened_second,
                SentinelShareOpening::new(&records, &third).open()?,
            ],
        )
        .reconstruct()?;
        assert_eq!(reconstructed, keys);
        Ok(())
    }
}
