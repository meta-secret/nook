//! Structural issuance admission followed by recipient encryption.
use super::{OnboardingDelivery, SentinelOnboardingPackage, SentinelOnboardingVersion};
use crate::{
    AuthProvidersSnapshotData, MultiDeviceError, SentinelGenesisRequest,
    SentinelGenesisShareDelivery, StorageProviderData, StorageProviderType,
};

/// Inputs for one structurally admitted package. This does not verify delivery signatures.
/// ```compile_fail
/// use nook_core::SentinelOnboardingIssuance;
/// fn repeat(input: SentinelOnboardingIssuance<'_>) {
///     let _ = input.create();
///     let _ = input.create();
/// }
/// ```
/// Prepared issuance cannot be obtained without the public admission route:
/// ```compile_fail
/// use nook_core::SentinelOnboardingIssuance;
/// fn bypass(input: SentinelOnboardingIssuance<'_>) { let _ = input.prepare(); }
/// ```
pub struct SentinelOnboardingIssuance<'a> {
    pub request: SentinelGenesisRequest,
    pub delivery: SentinelGenesisShareDelivery,
    pub provider_snapshot: &'a AuthProvidersSnapshotData,
}
struct PreparedOnboardingIssuance<'a> {
    input: SentinelOnboardingIssuance<'a>,
}
impl<'a> SentinelOnboardingIssuance<'a> {
    pub fn create(self) -> Result<SentinelOnboardingPackage, MultiDeviceError> {
        self.prepare()?.seal()
    }
    fn prepare(self) -> Result<PreparedOnboardingIssuance<'a>, MultiDeviceError> {
        OnboardingDelivery {
            request: &self.request,
            delivery: &self.delivery,
        }
        .check()?;
        self.provider_snapshot.onboarding_provider()?;
        Ok(PreparedOnboardingIssuance { input: self })
    }
}
impl PreparedOnboardingIssuance<'_> {
    fn seal(self) -> Result<SentinelOnboardingPackage, MultiDeviceError> {
        let SentinelOnboardingIssuance {
            request,
            delivery,
            provider_snapshot,
        } = self.input;
        let provider_snapshot = delivery
            .encryption_public_key
            .seal_compressed_json(provider_snapshot.onboarding_provider()?)?;
        Ok(SentinelOnboardingPackage {
            version: SentinelOnboardingVersion::CURRENT,
            request,
            delivery,
            provider_snapshot,
        })
    }
}
impl AuthProvidersSnapshotData {
    /// The one cloud mount an onboarding package hands to the new member.
    fn onboarding_provider(&self) -> Result<&StorageProviderData, MultiDeviceError> {
        match self.providers.as_slice() {
            [provider] => provider.onboarding_cloud_mount(),
            _ => Err(MultiDeviceError::InvalidSentinelGenesisPayload),
        }
    }
}
impl StorageProviderData {
    pub(super) fn onboarding_cloud_mount(&self) -> Result<&Self, MultiDeviceError> {
        match self.provider_type {
            StorageProviderType::Github | StorageProviderType::OauthFile => Ok(self),
            StorageProviderType::Local | StorageProviderType::LocalFolder => {
                Err(MultiDeviceError::InvalidSentinelGenesisPayload)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::OnboardingFixture;
    use super::SentinelOnboardingIssuance;
    use crate::{AuthProvidersSnapshotData, MultiDeviceError, StorageProviderType};
    use std::ptr;

    #[test]
    fn structural_checks_precede_provider_validation() -> anyhow::Result<()> {
        let fixture = OnboardingFixture::new()?;
        let other = OnboardingFixture::new()?;
        let mut session = fixture.request.clone();
        session.session_id = other.request.session_id;
        let mut policy = fixture.request.clone();
        policy.policy.threshold = 1.into();
        let mut signer = fixture.request.clone();
        signer.initiator_signing_public_key = other.request.initiator_signing_public_key;
        for request in [session, policy, signer] {
            assert!(matches!(
                SentinelOnboardingIssuance {
                    request,
                    delivery: fixture.delivery.clone(),
                    provider_snapshot: &AuthProvidersSnapshotData::default(),
                }
                .create(),
                Err(MultiDeviceError::InvalidSentinelGenesisSession)
            ));
        }
        Ok(())
    }

    #[test]
    fn provider_admission_enforces_one_cloud_mount() -> anyhow::Result<()> {
        let fixture = OnboardingFixture::new()?;
        let mut duplicate = fixture.snapshot.clone();
        let Some(provider) = duplicate.providers.first().cloned() else {
            anyhow::bail!("onboarding fixture must contain one provider");
        };
        duplicate.providers.push(provider);
        let mut local = fixture.snapshot.clone();
        let Some(local_provider) = local.providers.first_mut() else {
            anyhow::bail!("onboarding fixture must contain one provider");
        };
        local_provider.provider_type = StorageProviderType::Local;
        let mut folder = fixture.snapshot.clone();
        let Some(folder_provider) = folder.providers.first_mut() else {
            anyhow::bail!("onboarding fixture must contain one provider");
        };
        folder_provider.provider_type = StorageProviderType::LocalFolder;
        for snapshot in [
            AuthProvidersSnapshotData::default(),
            duplicate,
            local,
            folder,
        ] {
            assert!(matches!(
                SentinelOnboardingIssuance {
                    request: fixture.request.clone(),
                    delivery: fixture.delivery.clone(),
                    provider_snapshot: &snapshot,
                }
                .create(),
                Err(MultiDeviceError::InvalidSentinelGenesisPayload)
            ));
        }
        Ok(())
    }

    #[test]
    fn prepared_issuance_retains_snapshot_and_does_not_verify_signature() -> anyhow::Result<()> {
        let fixture = OnboardingFixture::new()?;
        let mut delivery = fixture.delivery.clone();
        delivery.signature.clear();
        let prepared = SentinelOnboardingIssuance {
            request: fixture.request.clone(),
            delivery,
            provider_snapshot: &fixture.snapshot,
        }
        .prepare()?;
        assert!(ptr::eq(
            prepared.input.provider_snapshot,
            &raw const fixture.snapshot
        ));
        let package = prepared.seal()?;
        assert!(package.delivery.signature.is_empty());
        assert_eq!(package.request, fixture.request);
        Ok(())
    }
}
