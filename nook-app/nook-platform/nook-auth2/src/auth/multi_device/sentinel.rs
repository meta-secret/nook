use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::Zeroize;

use super::secret_sharing::{
    IndexedShare, reconstruct_secret_bytes, split_secret_bytes, validate_sentinel_threshold,
};
use super::{DeviceIdentity, VaultKeys, VaultMetaRecord, encrypt_for_recipient};
use crate::auth::slip39;
use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{AgeArmoredCiphertext, DeviceId, DevicePublicKey, StoredSecretRecord, SymmetricKey};

pub const SENTINEL_SHARE_RECORD_PREFIX: &str = "sentinel_share:";

#[must_use]
pub fn sentinel_share_record_key(device_id: &DeviceId) -> String {
    format!("{SENTINEL_SHARE_RECORD_PREFIX}{device_id}")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SentinelShareEnvelope {
    pub version: u32,
    pub threshold: u8,
    pub required_participants: u8,
    pub share_index: u8,
    pub ciphertext: AgeArmoredCiphertext,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct SentinelSharePlaintext {
    version: u32,
    threshold: u8,
    required_participants: u8,
    share_index: u8,
    share: String,
}

/// Internal opened Sentinel share used only inside the Rust-owned unlock protocol.
///
/// This type contains plaintext share material. Browser/WASM APIs must wrap it
/// in a signed, session-bound encrypted [`crate::SentinelUnlockResponse`] and must
/// never serialize it directly to JavaScript.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenedSentinelShare {
    pub version: u32,
    pub threshold: u8,
    pub required_participants: u8,
    pub share_index: u8,
    /// Base64url of share bytes (same encoding as the decrypted share plaintext).
    pub share: String,
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct SentinelVaultKeysPlaintext {
    secrets_key: String,
    members_key: String,
}

const SENTINEL_ROOT_SHARE_VERSION: u32 = 2;
const SENTINEL_SECRETS_KEY_INFO: &[u8] = b"nook/sentinel-genesis/v1/secrets-key";
const SENTINEL_MEMBERS_KEY_INFO: &[u8] = b"nook/sentinel-genesis/v1/members-key";

fn derive_sentinel_vault_keys(root: &[u8; 32]) -> MultiDeviceResult<VaultKeys> {
    let hkdf = Hkdf::<Sha256>::new(None, root);
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

pub fn parse_sentinel_share_envelope(value: &str) -> MultiDeviceResult<SentinelShareEnvelope> {
    serde_json::from_str(value).map_err(MultiDeviceError::SentinelShareJson)
}

#[must_use]
pub fn is_sentinel_share_stored_record(record: &StoredSecretRecord) -> bool {
    matches!(
        VaultMetaRecord::classify(record),
        VaultMetaRecord::SentinelShare(..)
    )
}

pub fn create_sentinel_share_records(
    keys: &VaultKeys,
    participants: &[DeviceIdentity],
    threshold: u8,
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
    threshold: u8,
) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
    let required_participants =
        u8::try_from(recipients.len()).map_err(|_| MultiDeviceError::InvalidSentinelThreshold)?;
    validate_sentinel_threshold(threshold, required_participants)?;
    let payload = serde_json::to_vec(&SentinelVaultKeysPlaintext {
        secrets_key: keys.secrets_key.as_str().to_owned(),
        members_key: keys.members_key.as_str().to_owned(),
    })
    .map_err(MultiDeviceError::SentinelSharePayload)?;
    let shares = split_secret_bytes(&payload, threshold, required_participants)?;
    recipients
        .iter()
        .zip(shares)
        .map(|((device_id, public_key), share)| {
            let plaintext = SentinelSharePlaintext {
                version: 1,
                threshold,
                required_participants,
                share_index: share.index,
                share: URL_SAFE_NO_PAD.encode(&share.bytes),
            };
            let json =
                serde_json::to_vec(&plaintext).map_err(MultiDeviceError::SentinelSharePayload)?;
            let envelope = SentinelShareEnvelope {
                version: 1,
                threshold,
                required_participants,
                share_index: share.index,
                ciphertext: encrypt_for_recipient(&json, public_key)?,
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
    threshold: u8,
) -> MultiDeviceResult<(VaultKeys, Vec<StoredSecretRecord>)> {
    let required_participants =
        u8::try_from(recipients.len()).map_err(|_| MultiDeviceError::InvalidSentinelThreshold)?;
    validate_sentinel_threshold(threshold, required_participants)?;
    let mut root = [0_u8; 32];
    getrandom::fill(&mut root).map_err(|error| MultiDeviceError::GenerateKey(error.to_string()))?;
    let keys = derive_sentinel_vault_keys(&root)?;
    let shares = slip39::split_sentinel_secret(&root, threshold, required_participants)?;
    root.zeroize();
    let records = recipients
        .iter()
        .zip(shares)
        .enumerate()
        .map(|(offset, ((device_id, public_key), share))| {
            let share_index =
                u8::try_from(offset + 1).map_err(|_| MultiDeviceError::InvalidSentinelThreshold)?;
            let plaintext = SentinelSharePlaintext {
                version: SENTINEL_ROOT_SHARE_VERSION,
                threshold,
                required_participants,
                share_index,
                share,
            };
            let json =
                serde_json::to_vec(&plaintext).map_err(MultiDeviceError::SentinelSharePayload)?;
            let envelope = SentinelShareEnvelope {
                version: SENTINEL_ROOT_SHARE_VERSION,
                threshold,
                required_participants,
                share_index,
                ciphertext: encrypt_for_recipient(&json, public_key)?,
            };
            VaultMetaRecord::SentinelShare(device_id.clone(), envelope).to_stored()
        })
        .collect::<MultiDeviceResult<Vec<_>>>()?;
    Ok((keys, records))
}

#[must_use]
pub fn count_sentinel_share_records(records: &[StoredSecretRecord]) -> usize {
    records
        .iter()
        .filter(|record| is_sentinel_share_stored_record(record))
        .count()
}

/// Open this device's encrypted Sentinel share for an in-Rust unlock response.
pub fn open_sentinel_share_for_identity(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
) -> MultiDeviceResult<OpenedSentinelShare> {
    let record = records
        .iter()
        .find(|entry| entry.key.as_str() == sentinel_share_record_key(identity.device_id()))
        .ok_or_else(|| MultiDeviceError::SentinelShareNotFound {
            device_id: identity.device_id().to_string(),
        })?;
    let envelope = parse_sentinel_share_envelope(record.value.as_str())?;
    if !matches!(envelope.version, 1 | SENTINEL_ROOT_SHARE_VERSION) {
        return Err(MultiDeviceError::InvalidSentinelShareEncoding);
    }
    let plaintext_json = identity.open_utf8(&envelope.ciphertext)?;
    let plaintext: SentinelSharePlaintext =
        serde_json::from_str(&plaintext_json).map_err(MultiDeviceError::SentinelSharePayload)?;
    if plaintext.version != envelope.version
        || plaintext.threshold != envelope.threshold
        || plaintext.required_participants != envelope.required_participants
        || plaintext.share_index != envelope.share_index
    {
        return Err(MultiDeviceError::InvalidSentinelShareEncoding);
    }
    // Reject malformed legacy share encoding early. Current SLIP-0039 shares
    // are fully checksum/digest-validated when quorum reconstruction runs.
    if plaintext.version == SENTINEL_ROOT_SHARE_VERSION {
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
        device_id: identity.device_id().to_string(),
    })
}

/// Reconstruct vault keys from opened-share ceremony contributions.
///
/// `records` are used to verify each contribution matches a stored sentinel share
/// envelope; peer device identities are never required.
pub fn reconstruct_sentinel_vault_keys_from_opened(
    records: &[StoredSecretRecord],
    opened: &[OpenedSentinelShare],
) -> MultiDeviceResult<VaultKeys> {
    let mut shares = Vec::new();
    let mut expected_threshold = None;
    let mut expected_required = None;
    let mut expected_version = None;
    let mut seen_indexes = std::collections::BTreeSet::new();
    let mut slip39_mnemonics = Vec::new();
    for contribution in opened {
        let device_id =
            DeviceId::parse(&contribution.device_id).map_err(MultiDeviceError::Validation)?;
        let record = records
            .iter()
            .find(|entry| entry.key.as_str() == sentinel_share_record_key(&device_id))
            .ok_or_else(|| MultiDeviceError::SentinelShareNotFound {
                device_id: contribution.device_id.clone(),
            })?;
        let envelope = parse_sentinel_share_envelope(record.value.as_str())?;
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
        if contribution.version == SENTINEL_ROOT_SHARE_VERSION {
            if contribution.share.split_whitespace().count() != 33 {
                return Err(MultiDeviceError::InvalidSentinelShareEncoding);
            }
            slip39_mnemonics.push(contribution.share.clone());
        } else {
            let bytes = URL_SAFE_NO_PAD
                .decode(contribution.share.as_bytes())
                .map_err(|_| MultiDeviceError::InvalidSentinelShareEncoding)?;
            shares.push(IndexedShare {
                index: contribution.share_index,
                bytes,
            });
        }
    }
    let threshold = expected_threshold.ok_or(MultiDeviceError::NotEnoughSentinelShares {
        threshold: 1,
        available: 0,
    })?;
    if opened.len() < usize::from(threshold) {
        return Err(MultiDeviceError::NotEnoughSentinelShares {
            threshold,
            available: opened.len(),
        });
    }
    if expected_version == Some(SENTINEL_ROOT_SHARE_VERSION) {
        let mut root =
            slip39::recover_sentinel_secret(&slip39_mnemonics[..usize::from(threshold)])?;
        let keys = derive_sentinel_vault_keys(&root);
        root.zeroize();
        return keys;
    }
    let reconstructed = reconstruct_secret_bytes(&shares[..usize::from(threshold)], threshold)?;
    let payload: SentinelVaultKeysPlaintext =
        serde_json::from_slice(&reconstructed).map_err(MultiDeviceError::SentinelSharePayload)?;
    Ok(VaultKeys {
        secrets_key: SymmetricKey::parse(&payload.secrets_key)
            .map_err(MultiDeviceError::Validation)?,
        members_key: SymmetricKey::parse(&payload.members_key)
            .map_err(MultiDeviceError::Validation)?,
    })
}

/// Native/test helper: open each identity's share locally, then reconstruct.
///
/// Browser unlock must use the typed Sentinel unlock request/response protocol;
/// this helper is for native tests and compatibility code only.
pub fn reconstruct_sentinel_vault_keys(
    records: &[StoredSecretRecord],
    identities: &[DeviceIdentity],
) -> MultiDeviceResult<VaultKeys> {
    let opened = identities
        .iter()
        .map(|identity| open_sentinel_share_for_identity(records, identity))
        .collect::<MultiDeviceResult<Vec<_>>>()?;
    reconstruct_sentinel_vault_keys_from_opened(records, &opened)
}

#[cfg(test)]
mod tests {
    use super::super::{
        ConnectAccessStatus, DeviceIdentity, assess_connect_access, device_is_enrolled,
        generate_vault_keys, is_auth_stored_record, resolve_secrets_key,
    };
    use super::*;

    type SentinelShareFixture = (VaultKeys, [DeviceIdentity; 3], Vec<StoredSecretRecord>);

    fn sentinel_share_fixture() -> anyhow::Result<SentinelShareFixture> {
        let keys = generate_vault_keys()?;
        let identities = [
            DeviceIdentity::generate()?,
            DeviceIdentity::generate()?,
            DeviceIdentity::generate()?,
        ];
        let records = create_sentinel_share_records(&keys, &identities, 2)?;
        Ok((keys, identities, records))
    }

    #[test]
    fn sentinel_threshold_shares_reconstruct_keys_without_full_device_envelopes()
    -> anyhow::Result<()> {
        let (keys, [first, second, third], records) = sentinel_share_fixture()?;

        assert_eq!(records.len(), 3);
        assert!(records.iter().all(is_sentinel_share_stored_record));
        assert!(records.iter().all(|record| !is_auth_stored_record(record)));
        assert!(resolve_secrets_key(&records, &first).is_err());
        assert!(reconstruct_sentinel_vault_keys(&records, std::slice::from_ref(&first)).is_err());

        let reconstructed =
            reconstruct_sentinel_vault_keys(&records, &[first.clone(), second.clone()])?;
        assert_eq!(reconstructed, keys);

        let alternate = reconstruct_sentinel_vault_keys(&records, &[second, third])?;
        assert_eq!(alternate, keys);
        Ok(())
    }

    #[test]
    fn opened_sentinel_shares_reconstruct_without_peer_identities() -> anyhow::Result<()> {
        let (keys, [first, second, third], records) = sentinel_share_fixture()?;

        let opened_first = open_sentinel_share_for_identity(&records, &first)?;
        let opened_second = open_sentinel_share_for_identity(&records, &second)?;
        assert_eq!(opened_first.device_id, first.device_id().as_str());
        assert_eq!(opened_second.threshold, 2);

        assert!(
            reconstruct_sentinel_vault_keys_from_opened(
                &records,
                std::slice::from_ref(&opened_first)
            )
            .is_err()
        );

        let reconstructed =
            reconstruct_sentinel_vault_keys_from_opened(&records, &[opened_first, opened_second])?;
        assert_eq!(reconstructed, keys);

        // Share-row enrollment counts as Ready without an auth envelope.
        assert!(device_is_enrolled(&records, &first));
        assert_eq!(
            assess_connect_access(&records, &third),
            ConnectAccessStatus::Ready
        );
        assert!(resolve_secrets_key(&records, &first).is_err());
        Ok(())
    }
}
