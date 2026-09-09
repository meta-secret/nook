#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::super::secret_sharing::SentinelSecretReconstruction;
use crate::SentinelShareEnvelope;
use std::collections::BTreeSet;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::Zeroize;

use super::super::secret_sharing::IndexedShare;
use super::{
    OpenedSentinelShare, SentinelSharePlaintext, SentinelShareVersion, SentinelVaultKeysPlaintext,
};
use crate::auth::slip39;
use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{
    DeviceId, DeviceIdentity, SentinelThreshold, StoredSecretRecord, SymmetricKey, VaultKeys,
};

const SENTINEL_SECRETS_KEY_INFO: &[u8] = b"nook/sentinel-genesis/v1/secrets-key";
const SENTINEL_MEMBERS_KEY_INFO: &[u8] = b"nook/sentinel-genesis/v1/members-key";

/// Borrowed stored records and identity awaiting one Sentinel share opening.
pub struct SentinelShareOpening<'a> {
    records: &'a [StoredSecretRecord],
    identity: &'a DeviceIdentity,
}

impl<'a> SentinelShareOpening<'a> {
    #[must_use]
    pub fn new(records: &'a [StoredSecretRecord], identity: &'a DeviceIdentity) -> Self {
        Self { records, identity }
    }

    /// Consume the opening request into one validated plaintext contribution.
    pub fn open(self) -> MultiDeviceResult<OpenedSentinelShare> {
        let record = self
            .records
            .iter()
            .find(|entry| {
                entry.key.as_str() == DeviceId::sentinel_share_record_key(self.identity.device_id())
            })
            .ok_or_else(|| MultiDeviceError::SentinelShareNotFound {
                device_id: self.identity.device_id().to_string(),
            })?;
        let envelope = SentinelShareEnvelope::parse_sentinel_share_envelope(record.value.as_str())?;
        let plaintext_json = self.identity.open_utf8(&envelope.ciphertext)?;
        let plaintext: SentinelSharePlaintext = serde_json::from_str(&plaintext_json)
            .map_err(MultiDeviceError::SentinelSharePayload)?;
        if plaintext.version != envelope.version
            || plaintext.threshold != envelope.threshold
            || plaintext.required_participants != envelope.required_participants
            || plaintext.share_index != envelope.share_index
        {
            return Err(MultiDeviceError::InvalidSentinelShareEncoding);
        }
        // Opening checks only the transport encoding. Current SLIP-0039
        // checksum and digest validation remains inside quorum reconstruction.
        if plaintext.version == SentinelShareVersion::CURRENT {
            if plaintext.share.split_whitespace().count() != 33 {
                return Err(MultiDeviceError::InvalidSentinelShareEncoding);
            }
        } else {
            URL_SAFE_NO_PAD
                .decode(plaintext.share.as_bytes())
                .map_err(|_| MultiDeviceError::InvalidSentinelShareEncoding)?;
        }
        Ok(OpenedSentinelShare {
            version: plaintext.version,
            threshold: plaintext.threshold,
            required_participants: plaintext.required_participants,
            share_index: plaintext.share_index,
            share: plaintext.share,
            device_id: self.identity.device_id().to_string(),
        })
    }
}

/// Borrowed opened contributions awaiting validation and consuming reconstruction.
pub struct SentinelKeyReconstruction<'a> {
    records: &'a [StoredSecretRecord],
    source: ReconstructionSource<'a>,
}

enum ReconstructionSource<'a> {
    Opened(&'a [OpenedSentinelShare]),
    Identities(&'a [DeviceIdentity]),
}

impl<'a> SentinelKeyReconstruction<'a> {
    #[must_use]
    pub fn from_opened(
        records: &'a [StoredSecretRecord],
        opened: &'a [OpenedSentinelShare],
    ) -> Self {
        Self {
            records,
            source: ReconstructionSource::Opened(opened),
        }
    }

    #[must_use]
    pub fn from_identities(
        records: &'a [StoredSecretRecord],
        identities: &'a [DeviceIdentity],
    ) -> Self {
        Self {
            records,
            source: ReconstructionSource::Identities(identities),
        }
    }

    /// Validate all contributions, admit a private quorum, and consume it to recover keys.
    pub fn reconstruct(self) -> MultiDeviceResult<VaultKeys> {
        match self.source {
            ReconstructionSource::Opened(opened) => {
                AdmittedSentinelQuorum::admit(self.records, opened)?.reconstruct()
            }
            ReconstructionSource::Identities(identities) => {
                let opened = identities
                    .iter()
                    .map(|identity| SentinelShareOpening::new(self.records, identity).open())
                    .collect::<MultiDeviceResult<Vec<_>>>()?;
                AdmittedSentinelQuorum::admit(self.records, &opened)?.reconstruct()
            }
        }
    }
}

/// Private, non-Clone state retaining only contributions admitted against stored records.
struct AdmittedSentinelQuorum {
    threshold: SentinelThreshold,
    version: SentinelShareVersion,
    legacy_shares: Vec<IndexedShare>,
    slip39_mnemonics: Vec<String>,
}

impl AdmittedSentinelQuorum {
    fn admit(
        records: &[StoredSecretRecord],
        opened: &[OpenedSentinelShare],
    ) -> MultiDeviceResult<Self> {
        let mut legacy_shares = Vec::new();
        let mut expected_threshold = None;
        let mut expected_required = None;
        let mut expected_version = None;
        let mut seen_indexes = BTreeSet::new();
        let mut slip39_mnemonics = Vec::new();
        for contribution in opened {
            let device_id =
                DeviceId::parse(&contribution.device_id).map_err(MultiDeviceError::Validation)?;
            let record = records
                .iter()
                .find(|entry| entry.key.as_str() == DeviceId::sentinel_share_record_key(&device_id))
                .ok_or_else(|| MultiDeviceError::SentinelShareNotFound {
                    device_id: contribution.device_id.clone(),
                })?;
            let envelope =
                SentinelShareEnvelope::parse_sentinel_share_envelope(record.value.as_str())?;
            if contribution.version != envelope.version
                || contribution.threshold != envelope.threshold
                || contribution.required_participants != envelope.required_participants
                || contribution.share_index != envelope.share_index
            {
                return Err(MultiDeviceError::InvalidSentinelShareEncoding);
            }
            if let Some(threshold) = expected_threshold {
                if threshold != contribution.threshold {
                    return Err(MultiDeviceError::InvalidSentinelThreshold);
                }
            } else {
                expected_threshold = Some(contribution.threshold);
            }
            if let Some(required) = expected_required {
                if required != contribution.required_participants {
                    return Err(MultiDeviceError::InvalidSentinelThreshold);
                }
            } else {
                expected_required = Some(contribution.required_participants);
            }
            if let Some(version) = expected_version {
                if version != contribution.version {
                    return Err(MultiDeviceError::InvalidSentinelShareEncoding);
                }
            } else {
                expected_version = Some(contribution.version);
            }
            if !seen_indexes.insert(contribution.share_index) {
                return Err(MultiDeviceError::InvalidSentinelShareEncoding);
            }
            if contribution.version == SentinelShareVersion::CURRENT {
                if contribution.share.split_whitespace().count() != 33 {
                    return Err(MultiDeviceError::InvalidSentinelShareEncoding);
                }
                slip39_mnemonics.push(contribution.share.clone());
            } else {
                let bytes = URL_SAFE_NO_PAD
                    .decode(contribution.share.as_bytes())
                    .map_err(|_| MultiDeviceError::InvalidSentinelShareEncoding)?;
                legacy_shares.push(IndexedShare {
                    index: contribution.share_index.into(),
                    bytes,
                });
            }
        }
        let threshold = expected_threshold.ok_or(MultiDeviceError::NotEnoughSentinelShares {
            threshold: 1.into(),
            available: 0.into(),
        })?;
        if opened.len() < usize::from(u8::from(threshold)) {
            return Err(MultiDeviceError::NotEnoughSentinelShares {
                threshold,
                available: opened.len().into(),
            });
        }
        Ok(Self {
            threshold,
            version: expected_version.ok_or(MultiDeviceError::InvalidSentinelShareEncoding)?,
            legacy_shares,
            slip39_mnemonics,
        })
    }

    fn reconstruct(self) -> MultiDeviceResult<VaultKeys> {
        let required = usize::from(u8::from(self.threshold));
        if self.version == SentinelShareVersion::CURRENT {
            let mut root =
                slip39::SentinelSecretRecoveryRequest::sentinel(&self.slip39_mnemonics[..required])
                    .recover()?;
            let keys = SentinelVaultKeyDerivation::new(&root).derive();
            root.zeroize();
            return keys;
        }
        let reconstructed = IndexedShare::reconstruct_secret_bytes(SentinelSecretReconstruction {
            shares: &self.legacy_shares[..required],
            threshold: self.threshold.into(),
        })?;
        let payload: SentinelVaultKeysPlaintext = serde_json::from_slice(&reconstructed)
            .map_err(MultiDeviceError::SentinelSharePayload)?;
        Ok(VaultKeys {
            secrets_key: SymmetricKey::parse(&payload.secrets_key)
                .map_err(MultiDeviceError::Validation)?,
            members_key: SymmetricKey::parse(&payload.members_key)
                .map_err(MultiDeviceError::Validation)?,
        })
    }
}

/// Borrowed Sentinel root awaiting domain-separated vault-key derivation.
pub(super) struct SentinelVaultKeyDerivation<'a> {
    root: &'a [u8; 32],
}

impl<'a> SentinelVaultKeyDerivation<'a> {
    #[must_use]
    pub(super) fn new(root: &'a [u8; 32]) -> Self {
        Self { root }
    }

    pub(super) fn derive(self) -> MultiDeviceResult<VaultKeys> {
        let hkdf = Hkdf::<Sha256>::new(None, self.root);
        let mut secrets = [0_u8; 32];
        let mut members = [0_u8; 32];
        hkdf.expand(SENTINEL_SECRETS_KEY_INFO, &mut secrets)
            .map_err(|_| MultiDeviceError::InvalidSentinelShareEncoding)?;
        hkdf.expand(SENTINEL_MEMBERS_KEY_INFO, &mut members)
            .map_err(|_| MultiDeviceError::InvalidSentinelShareEncoding)?;
        let result = Ok(VaultKeys {
            secrets_key: SymmetricKey::parse(&hex::encode(secrets))
                .map_err(MultiDeviceError::Validation)?,
            members_key: SymmetricKey::parse(&hex::encode(members))
                .map_err(MultiDeviceError::Validation)?,
        });
        secrets.zeroize();
        members.zeroize();
        result
    }
}
