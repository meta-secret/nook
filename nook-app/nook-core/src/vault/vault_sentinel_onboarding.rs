//! Post-genesis Sentinel onboarding packages.
//!
//! The owner selects one sync provider after atomic genesis. Nook then creates
//! one package per participant: the already signed/encrypted Sentinel share and
//! a provider snapshot encrypted to that participant's device public key.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use flate2::{Compression, read::DeflateDecoder, write::DeflateEncoder};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

use crate::{
    AgeArmoredCiphertext, AuthProvidersSnapshotData, DeviceIdentity, MultiDeviceError,
    SentinelGenesisRequest, SentinelGenesisShareDelivery, StoredSecretRecord,
    accept_sentinel_genesis_share_delivery, encrypt_for_recipient,
};

const SENTINEL_ONBOARDING_VERSION: u32 = 1;
const MAX_ENCODED_PACKAGE_BYTES: usize = 16 * 1024;
const MAX_DECOMPRESSED_PACKAGE_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelOnboardingPackage {
    pub version: u32,
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
    let provider_json = serde_json::to_vec(provider_snapshot)
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    let provider_snapshot = encrypt_for_recipient(&provider_json, &delivery.encryption_public_key)?;
    Ok(SentinelOnboardingPackage {
        version: SENTINEL_ONBOARDING_VERSION,
        request,
        delivery,
        provider_snapshot,
    })
}

pub fn accept_sentinel_onboarding_package(
    package: &SentinelOnboardingPackage,
    identity: &DeviceIdentity,
) -> Result<AcceptedSentinelOnboarding, MultiDeviceError> {
    if package.version != SENTINEL_ONBOARDING_VERSION {
        return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
    }
    validate_request_delivery(&package.request, &package.delivery)?;
    let share_record =
        accept_sentinel_genesis_share_delivery(&package.delivery, &package.request, identity)?;
    let provider_json = identity.open_utf8(&package.provider_snapshot)?;
    let mut provider_snapshot: AuthProvidersSnapshotData = serde_json::from_str(&provider_json)
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    validate_provider_snapshot(&provider_snapshot, package.delivery.store_id.as_str())?;
    provider_snapshot.active_vault_store_id = Some(package.delivery.store_id.to_string());
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
    if matches!(provider.provider_type.as_str(), "local" | "local-folder")
        || provider.store_id.as_deref() != Some(store_id)
    {
        return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        DeviceIdentity, OAuthFileConfigData, SigningIdentity, StorageProviderData,
        finalize_sentinel_genesis_shares, start_sentinel_genesis,
    };

    fn provider_snapshot(store_id: &str) -> AuthProvidersSnapshotData {
        AuthProvidersSnapshotData {
            providers: vec![StorageProviderData {
                id: "drive-1".to_owned(),
                provider_type: "oauth-file".to_owned(),
                label: "Google Drive".to_owned(),
                github_pat: None,
                github_repo: None,
                oauth_file: Some(OAuthFileConfigData {
                    preset: "google-drive".to_owned(),
                    access_token: "member-secret-token".to_owned(),
                    file_name: Some("nook-events".to_owned()),
                    ..OAuthFileConfigData::default()
                }),
                local_folder: None,
                store_id: Some(store_id.to_owned()),
                last_synced_version: None,
                last_synced_at: None,
                last_sync_revision: None,
                last_common_content_hash: None,
                created_at: "2026-07-12T00:00:00.000Z".to_owned(),
            }],
            active_vault_store_id: Some(store_id.to_owned()),
        }
    }

    #[test]
    fn member_package_round_trips_share_and_provider_for_exact_device() {
        let owner = DeviceIdentity::generate().unwrap();
        let member = DeviceIdentity::generate().unwrap();
        let owner_signing = SigningIdentity::generate().unwrap().0;
        let member_signing = SigningIdentity::generate().unwrap().0;
        let mut session =
            start_sentinel_genesis(&owner, &owner_signing, 2, 2, "Owner".to_owned()).unwrap();
        let response = crate::respond_to_sentinel_genesis_request(
            &session.request,
            &member,
            &member_signing,
            "Member".to_owned(),
        )
        .unwrap();
        crate::add_sentinel_genesis_response(&mut session, response).unwrap();
        let request = session.request.clone();
        let store_id = crate::generate_store_id().unwrap();
        let issued =
            finalize_sentinel_genesis_shares(session, &store_id, owner_signing.signing_key())
                .unwrap();
        let delivery = issued
            .deliveries
            .into_iter()
            .find(|delivery| delivery.device_id == *member.device_id())
            .unwrap();
        let package = create_sentinel_onboarding_package(
            request,
            delivery,
            &provider_snapshot(store_id.as_str()),
        )
        .unwrap();
        let encoded = serde_json::to_string(&package).unwrap();
        assert!(!encoded.contains("member-secret-token"));

        let compact = encode_sentinel_onboarding_package(&package).unwrap();
        assert!(
            compact.len() < 2_900,
            "compact package was {} bytes",
            compact.len()
        );
        let package = decode_sentinel_onboarding_package(&compact).unwrap();

        let accepted = accept_sentinel_onboarding_package(&package, &member).unwrap();
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
                .unwrap()
                .access_token,
            "member-secret-token"
        );
    }

    #[test]
    fn oversized_onboarding_payload_is_rejected_before_deserialization() {
        let oversized_len = usize::try_from(MAX_DECOMPRESSED_PACKAGE_BYTES + 1).unwrap();
        let oversized = vec![b'x'; oversized_len];
        let mut deflater = DeflateEncoder::new(Vec::new(), Compression::best());
        deflater.write_all(&oversized).unwrap();
        let compressed_payload = URL_SAFE_NO_PAD.encode(deflater.finish().unwrap());

        assert!(matches!(
            decode_sentinel_onboarding_package(&compressed_payload),
            Err(MultiDeviceError::InvalidSentinelGenesisPayload)
        ));
    }
}
