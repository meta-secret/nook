//! Post-genesis Sentinel onboarding packages.
//! Issuance checks structural consistency; recipient admission verifies the delivered share.
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

mod admission;
mod codec;
mod issuance;
use crate::{
    AgeArmoredCiphertext, AuthProvidersSnapshotData, MultiDeviceError, SentinelGenesisRequest,
    SentinelGenesisShareDelivery, StoredSecretRecord,
};
pub use admission::SentinelOnboardingRecipient;
pub use issuance::SentinelOnboardingIssuance;
use serde::{Deserialize, Serialize};
/// Version of the post-genesis Sentinel onboarding package wire format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "u32")]
pub struct SentinelOnboardingVersion(u32);

impl SentinelOnboardingVersion {
    pub const CURRENT: Self = Self(1);
}

impl From<SentinelOnboardingVersion> for u32 {
    fn from(value: SentinelOnboardingVersion) -> Self {
        value.0
    }
}

impl TryFrom<u32> for SentinelOnboardingVersion {
    type Error = String;
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: admits the existing numeric wire representation"
        )
    )]
    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::CURRENT),
            _ => Err("unsupported Sentinel onboarding version".to_owned()),
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

struct OnboardingDelivery<'a> {
    request: &'a SentinelGenesisRequest,
    delivery: &'a SentinelGenesisShareDelivery,
}
impl OnboardingDelivery<'_> {
    fn check(self) -> Result<(), MultiDeviceError> {
        let Self { request, delivery } = self;

        if request.session_id != delivery.session_id
            || request.policy != delivery.policy
            || request.initiator_signing_public_key != delivery.initiator_signing_public_key
        {
            return Err(MultiDeviceError::InvalidSentinelGenesisSession);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{SentinelOnboardingPackage, SentinelOnboardingVersion};
    use crate::{
        ActiveVaultScope, AuthProvidersSnapshotData, CheckedSentinelGenesisResponse,
        DeviceIdentity, OAuthFileConfigData, OauthFilePreset, ProviderSyncCheckpoint,
        ProviderVaultScope, SentinelGenesisRequest, SentinelGenesisShareDelivery,
        SentinelOnboardingIssuance, SentinelOnboardingRecipient, SigningIdentity,
        StorageProviderData, StorageProviderType, StoredGithubPat, StoredGithubRepository,
        StoredLocalFolderConfiguration, StoredOAuthAccessCredential, StoredOAuthFileConfiguration,
        StoredOAuthRemoteFileName,
    };
    use std::io::Error as IoError;

    pub(super) struct OnboardingFixture {
        pub(super) member: DeviceIdentity,
        pub(super) request: SentinelGenesisRequest,
        pub(super) delivery: SentinelGenesisShareDelivery,
        pub(super) snapshot: AuthProvidersSnapshotData,
    }
    impl OnboardingFixture {
        pub(super) fn new() -> anyhow::Result<Self> {
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
            let response = session
                .request()
                .prepare_response(crate::SentinelGenesisResponder {
                    identity: &member,
                    signing_key: member_signing.signing_key(),
                    label: "Member".to_owned(),
                })
                .and_then(CheckedSentinelGenesisResponse::sign)?;
            let session = session.collect(response)?;
            let request = session.request().clone();
            let store_id = crate::StoreId::generate()?;
            let issued = session
                .prepare(owner_signing.signing_key())?
                .issue(&store_id)?;
            let delivery = issued
                .deliveries
                .into_iter()
                .find(|delivery| delivery.device_id == *member.device_id())
                .ok_or_else(|| IoError::other("member delivery must exist"))?;

            Ok(Self {
                member,
                request,
                delivery,
                snapshot: Self::snapshot(store_id.as_str()),
            })
        }
        fn snapshot(store_id: &str) -> AuthProvidersSnapshotData {
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
        pub(super) fn package(&self) -> anyhow::Result<SentinelOnboardingPackage> {
            Ok(SentinelOnboardingIssuance {
                request: self.request.clone(),
                delivery: self.delivery.clone(),
                provider_snapshot: &self.snapshot,
            }
            .create()?)
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
        let fixture = OnboardingFixture::new()?;
        let package = fixture.package()?;
        let encoded = serde_json::to_string(&package)?;
        assert!(!encoded.contains("member-secret-token"));
        let compact = package.encode()?;
        assert!(
            compact.len() < 2_900,
            "compact package was {} bytes",
            compact.len()
        );
        let package = SentinelOnboardingPackage::decode(&compact)?;
        let accepted = SentinelOnboardingRecipient {
            package: &package,
            identity: &fixture.member,
        }
        .accept()?;
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
                .ok_or_else(|| IoError::other("provider OAuth fixture must exist"))?
                .access_token,
            StoredOAuthAccessCredential::AccessToken("member-secret-token".to_owned())
        );
        Ok(())
    }
}
