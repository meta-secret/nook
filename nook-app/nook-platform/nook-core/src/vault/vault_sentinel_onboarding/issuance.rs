//! Structural issuance admission followed by recipient encryption.
use super::{OnboardingDelivery, SentinelOnboardingPackage, SentinelOnboardingVersion};
use crate::ProviderVaultScope;
use crate::{
    AuthProvidersSnapshotData, MultiDeviceError, SentinelGenesisRequest,
    SentinelGenesisShareDelivery, StorageProviderType,
};
use zeroize::Zeroizing;

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
        self.provider_snapshot
            .validate_onboarding(self.delivery.store_id.as_str())?;
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
        // Keep the encrypted package within the QR budget while retaining semantic
        // enums in memory. The schema-1 projection is also readable after rollback.
        let provider_storage = provider_snapshot.legacy_storage_snapshot();
        let provider_json = Zeroizing::new(
            serde_json::to_vec(&provider_storage)
                .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?,
        );
        let provider_snapshot = delivery.encryption_public_key.seal_bytes(&provider_json)?;
        Ok(SentinelOnboardingPackage {
            version: SentinelOnboardingVersion::CURRENT,
            request,
            delivery,
            provider_snapshot,
        })
    }
}
impl AuthProvidersSnapshotData {
    pub(super) fn validate_onboarding(&self, store_id: &str) -> Result<(), MultiDeviceError> {
        let snapshot = self;

        if snapshot.providers.len() != 1 {
            return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
        }
        let Some(provider) = snapshot.providers.first() else {
            return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
        };
        if matches!(
            provider.provider_type,
            StorageProviderType::Local | StorageProviderType::LocalFolder
        ) || !matches!(&provider.store_id, ProviderVaultScope::StoreId(id) if id == store_id)
        {
            return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::OnboardingFixture;
    use super::SentinelOnboardingIssuance;
    use crate::{
        AuthProvidersSnapshotData, MultiDeviceError, ProviderVaultScope, StorageProviderType,
    };
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
    fn provider_admission_enforces_count_type_and_exact_store() -> anyhow::Result<()> {
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
        let mut wrong_store = fixture.snapshot.clone();
        let Some(wrong_store_provider) = wrong_store.providers.first_mut() else {
            anyhow::bail!("onboarding fixture must contain one provider");
        };
        wrong_store_provider.store_id =
            ProviderVaultScope::StoreId(format!(" {} ", fixture.delivery.store_id));
        for snapshot in [
            AuthProvidersSnapshotData::default(),
            duplicate,
            local,
            folder,
            wrong_store,
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
