//! Post-genesis Sentinel onboarding packages.
//!
//! The owner selects one sync provider after atomic genesis. Nook then creates
//! one package per participant: the already signed/encrypted Sentinel share and
//! a provider snapshot encrypted to that participant's device public key.

use crate::ActiveVaultScope;

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use flate2::{Compression, read::DeflateDecoder, write::DeflateEncoder};
use serde::{Deserialize, Deserializer, Serialize, de};
use std::io::{Read, Write};

use crate::{
    AgeArmoredCiphertext, AuthProvidersSnapshotData, DeviceIdentity, MultiDeviceError,
    SentinelGenesisRequest, SentinelGenesisShareDelivery, StorageProviderType, StoredSecretRecord,
    accept_sentinel_genesis_share_delivery, auth_snapshot_legacy_storage_value,
    encrypt_for_recipient, normalize_auth_snapshot,
};

const MAX_ENCODED_PACKAGE_BYTES: usize = 16 * 1024;
const MAX_DECOMPRESSED_PACKAGE_BYTES: u64 = 64 * 1024;

/// Version of the post-genesis Sentinel onboarding package wire format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct SentinelOnboardingVersion(u32);

impl SentinelOnboardingVersion {
    pub const CURRENT: Self = Self(1);
}

impl From<SentinelOnboardingVersion> for u32 {
    fn from(value: SentinelOnboardingVersion) -> Self {
        value.0
    }
}

impl<'de> Deserialize<'de> for SentinelOnboardingVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        match u32::deserialize(deserializer)? {
            1 => Ok(Self::CURRENT),
            _ => Err(de::Error::custom("unsupported Sentinel onboarding version")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelOnboardingPackage {
    pub version: SentinelOnboardingVersion,
    pub request: SentinelGenesisRequest,
    pub delivery: SentinelGenesisShareDelivery,
    pub provider_snapshot: AgeArmoredCiphertext,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedSentinelOnboarding {
    pub share_record: StoredSecretRecord,
    pub provider_snapshot: AuthProvidersSnapshotData,
}

pub fn create_sentinel_onboarding_package(
    request: SentinelGenesisRequest,
    delivery: SentinelGenesisShareDelivery,
    provider_snapshot: &AuthProvidersSnapshotData,
) -> Result<SentinelOnboardingPackage, MultiDeviceError> {
    validate_request_delivery(&request, &delivery)?;
    validate_provider_snapshot(provider_snapshot, delivery.store_id.as_str())?;
    // Keep the encrypted package within the QR budget while retaining semantic
    // enums in memory. The schema-1 projection is also readable after rollback.
    let provider_storage = auth_snapshot_legacy_storage_value(provider_snapshot)
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    let provider_json = serde_json::to_vec(&provider_storage)
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    let provider_snapshot = encrypt_for_recipient(&provider_json, &delivery.encryption_public_key)?;
    Ok(SentinelOnboardingPackage {
        version: SentinelOnboardingVersion::CURRENT,
        request,
        delivery,
        provider_snapshot,
    })
}

pub fn accept_sentinel_onboarding_package(
    package: &SentinelOnboardingPackage,
    identity: &DeviceIdentity,
) -> Result<AcceptedSentinelOnboarding, MultiDeviceError> {
    validate_request_delivery(&package.request, &package.delivery)?;
    let share_record =
        accept_sentinel_genesis_share_delivery(&package.delivery, &package.request, identity)?;
    let provider_json = identity.open_utf8(&package.provider_snapshot)?;
    let provider_storage: serde_json::Value = serde_json::from_str(&provider_json)
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    let mut provider_snapshot = normalize_auth_snapshot(&provider_storage).snapshot;
    validate_provider_snapshot(&provider_snapshot, package.delivery.store_id.as_str())?;
    provider_snapshot.active_vault_store_id =
        ActiveVaultScope::StoreId(package.delivery.store_id.to_string());
    Ok(AcceptedSentinelOnboarding {
        share_record,
        provider_snapshot,
    })
}

pub fn encode_sentinel_onboarding_package(
    package: &SentinelOnboardingPackage,
) -> Result<String, MultiDeviceError> {
    let json =
        serde_json::to_vec(package).map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
    encoder
        .write_all(&json)
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    let compressed = encoder
        .finish()
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    Ok(URL_SAFE_NO_PAD.encode(compressed))
}

pub fn decode_sentinel_onboarding_package(
    encoded: &str,
) -> Result<SentinelOnboardingPackage, MultiDeviceError> {
    let encoded = encoded.trim();
    if encoded.is_empty() || encoded.len() > MAX_ENCODED_PACKAGE_BYTES {
        return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
    }
    let compressed = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    let mut decoder = DeflateDecoder::new(compressed.as_slice());
    let mut json = Vec::new();
    decoder
        .by_ref()
        .take(MAX_DECOMPRESSED_PACKAGE_BYTES + 1)
        .read_to_end(&mut json)
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    if json.len() as u64 > MAX_DECOMPRESSED_PACKAGE_BYTES {
        return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
    }
    serde_json::from_slice(&json).map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
}

fn validate_request_delivery(
    request: &SentinelGenesisRequest,
    delivery: &SentinelGenesisShareDelivery,
) -> Result<(), MultiDeviceError> {
    if request.session_id != delivery.session_id
        || request.policy != delivery.policy
        || request.initiator_signing_public_key != delivery.initiator_signing_public_key
    {
        return Err(MultiDeviceError::InvalidSentinelGenesisSession);
    }
    Ok(())
}

fn validate_provider_snapshot(
    snapshot: &AuthProvidersSnapshotData,
    store_id: &str,
) -> Result<(), MultiDeviceError> {
    if snapshot.providers.len() != 1 {
        return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
    }
    let provider = &snapshot.providers[0];
    if matches!(
        provider.provider_type,
        StorageProviderType::Local | StorageProviderType::LocalFolder
    ) || provider.store_id.as_deref() != Some(store_id)
    {
        return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::{
        ActiveVaultScope, ProviderSyncCheckpoint, ProviderVaultScope, StoredGithubPat,
        StoredGithubRepository, StoredLocalFolderConfiguration, StoredOAuthAccessCredential,
        StoredOAuthFileConfiguration, StoredOAuthRemoteFileName,
    };

    use std::io;

    use super::*;
    use crate::{
        DeviceIdentity, OAuthFileConfigData, OauthFilePreset, SigningIdentity, StorageProviderData,
        StorageProviderType,
    };

    fn provider_snapshot(store_id: &str) -> AuthProvidersSnapshotData {
        AuthProvidersSnapshotData {
            providers: vec![StorageProviderData {
                id: "drive-1".to_owned(),
                provider_type: StorageProviderType::OauthFile,
                label: "Google Drive".to_owned(),
                github_pat: StoredGithubPat::Missing,
                github_repo: StoredGithubRepository::DefaultRepository,
                oauth_file: StoredOAuthFileConfiguration::configured(OAuthFileConfigData {
                    preset: OauthFilePreset::GoogleDrive,
                    access_token: StoredOAuthAccessCredential::AccessToken(
                        "member-secret-token".to_owned(),
                    ),
                    file_name: StoredOAuthRemoteFileName::FileName("nook-events".to_owned()),
                    ..OAuthFileConfigData::default()
                }),
                local_folder: StoredLocalFolderConfiguration::NotApplicable,
                store_id: ProviderVaultScope::StoreId(store_id.to_owned()),
                sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                created_at: "2026-07-12T00:00:00.000Z".to_owned(),
            }],
            active_vault_store_id: ActiveVaultScope::StoreId(store_id.to_owned()),
        }
    }

    #[test]
    fn onboarding_version_preserves_scalar_and_rejects_unsupported_values() -> anyhow::Result<()> {
        let encoded = serde_json::to_string(&SentinelOnboardingVersion::CURRENT)?;
        assert_eq!(encoded, "1");
        assert_eq!(
            serde_json::from_str::<SentinelOnboardingVersion>(&encoded)?,
            SentinelOnboardingVersion::CURRENT
        );
        for invalid in ["0", "2", "4294967296"] {
            assert!(serde_json::from_str::<SentinelOnboardingVersion>(invalid).is_err());
        }
        Ok(())
    }

    #[test]
    fn member_package_round_trips_share_and_provider_for_exact_device() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let member = DeviceIdentity::generate()?;
        let owner_signing = SigningIdentity::generate()?.0;
        let member_signing = SigningIdentity::generate()?.0;
        let session = crate::StartSentinelGenesisArgs {
            label: "Owner".to_owned(),
            participant_count: 2.into(),
            threshold: 2.into(),
        }
        .start(&owner, &owner_signing)?;
        let response = crate::respond_to_sentinel_genesis_request(
            session.request(),
            &member,
            &member_signing,
            "Member".to_owned(),
        )?;
        let session = session.collect(response)?;
        let request = session.request().clone();
        let store_id = crate::generate_store_id()?;
        let issued = session
            .prepare(owner_signing.signing_key())?
            .issue(&store_id)?;
        let delivery = issued
            .deliveries
            .into_iter()
            .find(|delivery| delivery.device_id == *member.device_id())
            .ok_or_else(|| io::Error::other("member delivery must exist"))?;
        let package = create_sentinel_onboarding_package(
            request,
            delivery,
            &provider_snapshot(store_id.as_str()),
        )?;
        let encoded = serde_json::to_string(&package)?;
        assert!(!encoded.contains("member-secret-token"));

        let compact = encode_sentinel_onboarding_package(&package)?;
        assert!(
            compact.len() < 2_900,
            "compact package was {} bytes",
            compact.len()
        );
        let package = decode_sentinel_onboarding_package(&compact)?;

        let accepted = accept_sentinel_onboarding_package(&package, &member)?;
        assert!(
            accepted
                .share_record
                .key
                .as_str()
                .starts_with("sentinel_share:")
        );
        assert_eq!(
            accepted.provider_snapshot.providers[0]
                .oauth_file
                .as_ref()
                .ok_or_else(|| io::Error::other("provider OAuth fixture must exist"))?
                .access_token,
            StoredOAuthAccessCredential::AccessToken("member-secret-token".to_owned())
        );
        Ok(())
    }

    #[test]
    fn oversized_onboarding_payload_is_rejected_before_deserialization() -> anyhow::Result<()> {
        let oversized_len = usize::try_from(MAX_DECOMPRESSED_PACKAGE_BYTES + 1)?;
        let oversized = vec![b'x'; oversized_len];
        let mut deflater = DeflateEncoder::new(Vec::new(), Compression::best());
        deflater.write_all(&oversized)?;
        let compressed_payload = URL_SAFE_NO_PAD.encode(deflater.finish()?);

        assert!(matches!(
            decode_sentinel_onboarding_package(&compressed_payload),
            Err(MultiDeviceError::InvalidSentinelGenesisPayload)
        ));
        Ok(())
    }
}
