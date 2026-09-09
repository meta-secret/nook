use super::secret_sharing::{IndexedShare, SentinelSecretSplit, SentinelShareThreshold};
use crate::{AssessConnectAccessRequest, DeviceIsEnrolledRequest, VaultMetaState};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

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

impl DeviceId {
    #[must_use]
    pub fn sentinel_share_record_key(device_id: &DeviceId) -> String {
        format!("{SENTINEL_SHARE_RECORD_PREFIX}{device_id}")
    }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, tsify::Tsify)]
#[serde(try_from = "u32")]
pub struct SentinelShareVersion(u32);

impl SentinelShareVersion {
    pub const LEGACY: Self = Self(1);
    pub const CURRENT: Self = Self(2);
}

impl From<SentinelShareVersion> for u32 {
    fn from(value: SentinelShareVersion) -> Self {
        value.0
    }
}

impl TryFrom<u32> for SentinelShareVersion {
    type Error = &'static str;
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: admits the existing numeric wire representation"
        )
    )]
    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::LEGACY),
            2 => Ok(Self::CURRENT),
            _ => Err("unsupported Sentinel share version"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct SentinelVaultKeysPlaintext {
    secrets_key: String,
    members_key: String,
}

/// Named values required by SentinelShareEnvelope::create_sentinel_share_records.
pub struct CreateSentinelShareRecordsRequest<'a> {
    pub keys: &'a VaultKeys,
    pub participants: &'a [DeviceIdentity],
    pub threshold: SentinelThreshold,
}

/// Named values required by SentinelShareEnvelope::create_sentinel_share_records_for_recipients.
pub struct CreateSentinelShareRecordsForRecipientsRequest<'a> {
    pub keys: &'a VaultKeys,
    pub recipients: &'a [(DeviceId, DevicePublicKey)],
    pub threshold: SentinelThreshold,
}

/// Named values required by SentinelShareEnvelope::create_sentinel_root_share_records_for_recipients.
pub struct CreateSentinelRootShareRecordsForRecipientsRequest<'a> {
    pub recipients: &'a [(DeviceId, DevicePublicKey)],
    pub threshold: SentinelThreshold,
}

impl SentinelShareEnvelope {
    pub fn parse_sentinel_share_envelope(value: &str) -> MultiDeviceResult<SentinelShareEnvelope> {
        serde_json::from_str(value).map_err(MultiDeviceError::SentinelShareJson)
    }
}

impl VaultMetaRecord {
    pub fn is_sentinel_share_stored_record(record: &StoredSecretRecord) -> MultiDeviceResult<bool> {
        Ok(matches!(
            VaultMetaRecord::classify(record)?,
            VaultMetaRecord::SentinelShare(..)
        ))
    }
}

impl SentinelShareEnvelope {
    pub fn create_sentinel_share_records(
        request: CreateSentinelShareRecordsRequest<'_>,
    ) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
        let CreateSentinelShareRecordsRequest {
            keys,
            participants,
            threshold,
        } = request;
        let recipients: Vec<(DeviceId, DevicePublicKey)> = participants
            .iter()
            .map(|participant| (participant.device_id().clone(), participant.public_key()))
            .collect();
        SentinelShareEnvelope::create_sentinel_share_records_for_recipients(
            CreateSentinelShareRecordsForRecipientsRequest {
                keys: keys,
                recipients: &recipients,
                threshold: threshold,
            },
        )
    }
}

/// Split vault keys into threshold shares encrypted to each recipient public key.
///
/// Interim GF(256) Shamir (byte-wise). Product SLIP-0039 mnemonic shares are
/// owned by #261 and should replace this once wired; do not invent a second
/// mnemonic format here.
impl SentinelShareEnvelope {
    pub fn create_sentinel_share_records_for_recipients(
        request: CreateSentinelShareRecordsForRecipientsRequest<'_>,
    ) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
        let CreateSentinelShareRecordsForRecipientsRequest {
            keys,
            recipients,
            threshold,
        } = request;
        let required_participants = SentinelParticipantCount::from(
            u8::try_from(recipients.len())
                .map_err(|_| MultiDeviceError::InvalidSentinelThreshold)?,
        );
        IndexedShare::validate_sentinel_threshold(SentinelShareThreshold {
            threshold: threshold.into(),
            required_participants: required_participants.into(),
        })?;
        let payload = serde_json::to_vec(&SentinelVaultKeysPlaintext {
            secrets_key: keys.secrets_key.as_str().to_owned(),
            members_key: keys.members_key.as_str().to_owned(),
        })
        .map_err(MultiDeviceError::SentinelSharePayload)?;
        let shares = IndexedShare::split_secret_bytes(SentinelSecretSplit {
            secret: &payload,
            threshold: threshold.into(),
            required_participants: required_participants.into(),
        })?;
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
                let json = serde_json::to_vec(&plaintext)
                    .map_err(MultiDeviceError::SentinelSharePayload)?;
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
}

/// Generate one Sentinel root, derive the explicit vault keys with
/// domain-separated HKDF, and issue encrypted current-format SLIP-0039 shares
/// atomically. Version 2 is deliberately distinct from legacy version-1 JSON
/// key bundles, which remain readable.
impl SentinelShareEnvelope {
    pub fn create_sentinel_root_share_records_for_recipients(
        request: CreateSentinelRootShareRecordsForRecipientsRequest<'_>,
    ) -> MultiDeviceResult<(VaultKeys, Vec<StoredSecretRecord>)> {
        let CreateSentinelRootShareRecordsForRecipientsRequest {
            recipients,
            threshold,
        } = request;
        let required_participants = SentinelParticipantCount::from(
            u8::try_from(recipients.len())
                .map_err(|_| MultiDeviceError::InvalidSentinelThreshold)?,
        );
        IndexedShare::validate_sentinel_threshold(SentinelShareThreshold {
            threshold: threshold.into(),
            required_participants: required_participants.into(),
        })?;
        let mut root = [0_u8; 32];
        getrandom::fill(&mut root)
            .map_err(|error| MultiDeviceError::GenerateKey(error.to_string()))?;
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
                    u8::try_from(offset + 1)
                        .map_err(|_| MultiDeviceError::InvalidSentinelThreshold)?,
                );
                let plaintext = SentinelSharePlaintext {
                    version: SentinelShareVersion::CURRENT,
                    threshold,
                    required_participants,
                    share_index,
                    share,
                };
                let json = serde_json::to_vec(&plaintext)
                    .map_err(MultiDeviceError::SentinelSharePayload)?;
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
}

impl SentinelShareEnvelope {
    pub fn count_sentinel_share_records(
        records: &[StoredSecretRecord],
    ) -> MultiDeviceResult<SentinelRecordCount> {
        let mut count = 0;
        for record in records {
            if VaultMetaRecord::is_sentinel_share_stored_record(record)? {
                count += 1;
            }
        }
        Ok(count.into())
    }
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
        let records = SentinelShareEnvelope::create_sentinel_share_records(
            CreateSentinelShareRecordsRequest {
                keys: &keys,
                participants: &identities,
                threshold: 2.into(),
            },
        )?;
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
            assert!(VaultMetaRecord::is_sentinel_share_stored_record(record)?);
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
        assert!(VaultMetaState::device_is_enrolled(
            DeviceIsEnrolledRequest {
                records: &records,
                identity: &first
            }
        )?);
        assert_eq!(
            VaultMetaState::assess_connect_access(AssessConnectAccessRequest {
                records: &records,
                identity: &third
            })?,
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
