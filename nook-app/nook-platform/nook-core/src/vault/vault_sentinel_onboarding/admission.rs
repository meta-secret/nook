//! Signed-share admission followed by provider snapshot decryption.
use super::{AcceptedSentinelOnboarding, OnboardingDelivery, SentinelOnboardingPackage};
use crate::{
    ActiveVaultScope, CheckedSentinelGenesisDelivery, DeviceIdentity, MultiDeviceError,
    SentinelGenesisDeliveryRecipient, StoredSecretRecord, normalize_auth_snapshot,
};
use zeroize::Zeroizing;

/// Exact package and recipient observations for a consuming admission attempt.
/// ```compile_fail
/// use nook_core::SentinelOnboardingRecipient;
/// fn repeat(input: SentinelOnboardingRecipient<'_>) {
///     let _ = input.accept();
///     let _ = input.accept();
/// }
/// ```
/// ```compile_fail
/// use nook_core::SentinelOnboardingRecipient;
/// fn duplicate(input: SentinelOnboardingRecipient<'_>) { let _ = input.clone(); }
/// ```
/// ```compile_fail
/// use nook_core::SentinelOnboardingRecipient;
/// fn bypass(input: SentinelOnboardingRecipient<'_>) { let _ = input.check(); }
/// ```
pub struct SentinelOnboardingRecipient<'a> {
    pub package: &'a SentinelOnboardingPackage,
    pub identity: &'a DeviceIdentity,
}
struct CheckedOnboardingRecipient<'a> {
    recipient: SentinelOnboardingRecipient<'a>,
    share_record: StoredSecretRecord,
}
impl<'a> SentinelOnboardingRecipient<'a> {
    pub fn accept(self) -> Result<AcceptedSentinelOnboarding, MultiDeviceError> {
        self.check()?.complete()
    }
    fn check(self) -> Result<CheckedOnboardingRecipient<'a>, MultiDeviceError> {
        let package = self.package;
        OnboardingDelivery {
            request: &package.request,
            delivery: &package.delivery,
        }
        .check()?;
        let share_record = package
            .delivery
            .check(&SentinelGenesisDeliveryRecipient {
                expected_request: &package.request,
                identity: self.identity,
            })
            .and_then(CheckedSentinelGenesisDelivery::into_record)?;
        Ok(CheckedOnboardingRecipient {
            recipient: self,
            share_record,
        })
    }
}
impl CheckedOnboardingRecipient<'_> {
    fn complete(self) -> Result<AcceptedSentinelOnboarding, MultiDeviceError> {
        let Self {
            recipient: SentinelOnboardingRecipient { package, identity },
            share_record,
        } = self;
        let provider_json = Zeroizing::new(identity.open_utf8(&package.provider_snapshot)?);
        let provider_storage: serde_json::Value = serde_json::from_str(&provider_json)
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        let mut provider_snapshot = normalize_auth_snapshot(&provider_storage).snapshot;
        provider_snapshot.validate_onboarding(package.delivery.store_id.as_str())?;
        provider_snapshot.active_vault_store_id =
            ActiveVaultScope::StoreId(package.delivery.store_id.to_string());
        Ok(AcceptedSentinelOnboarding {
            share_record,
            provider_snapshot,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::tests::OnboardingFixture;
    use super::SentinelOnboardingRecipient;
    use crate::{DeviceIdentity, MultiDeviceError, encrypt_for_recipient};
    use std::ptr;

    #[test]
    fn recipient_mismatch_precedes_provider_payload_decode() -> anyhow::Result<()> {
        let fixture = OnboardingFixture::new()?;
        let mut package = fixture.package()?;
        package.provider_snapshot =
            encrypt_for_recipient(b"not-json", &fixture.delivery.encryption_public_key)?;
        let stranger = DeviceIdentity::generate()?;
        assert!(matches!(
            SentinelOnboardingRecipient {
                package: &package,
                identity: &stranger
            }
            .accept(),
            Err(MultiDeviceError::SentinelGenesisDeliveryRecipientMismatch)
        ));
        assert!(matches!(
            SentinelOnboardingRecipient {
                package: &package,
                identity: &fixture.member
            }
            .accept(),
            Err(MultiDeviceError::InvalidSentinelGenesisPayload)
        ));
        Ok(())
    }

    #[test]
    fn signature_rejection_precedes_provider_payload_decode() -> anyhow::Result<()> {
        let fixture = OnboardingFixture::new()?;
        let mut package = fixture.package()?;
        package.delivery.signature.clear();
        package.provider_snapshot =
            encrypt_for_recipient(b"not-json", &fixture.delivery.encryption_public_key)?;
        assert!(matches!(
            SentinelOnboardingRecipient {
                package: &package,
                identity: &fixture.member
            }
            .accept(),
            Err(MultiDeviceError::InvalidSentinelGenesisSignature)
        ));
        Ok(())
    }

    #[test]
    fn checked_recipient_retains_exact_observations_and_consumes_completion() -> anyhow::Result<()>
    {
        let fixture = OnboardingFixture::new()?;
        let package = fixture.package()?;
        let checked = SentinelOnboardingRecipient {
            package: &package,
            identity: &fixture.member,
        }
        .check()?;
        assert!(ptr::eq(checked.recipient.package, &raw const package));
        assert!(ptr::eq(
            checked.recipient.identity,
            &raw const fixture.member
        ));
        let accepted = checked.complete()?;
        assert_eq!(accepted.provider_snapshot, fixture.snapshot);
        Ok(())
    }

    #[test]
    fn decrypted_empty_provider_snapshot_is_rejected() -> anyhow::Result<()> {
        let fixture = OnboardingFixture::new()?;
        let mut package = fixture.package()?;
        // An empty object normalizes to zero providers and must still fail admission.
        package.provider_snapshot =
            encrypt_for_recipient(b"{}", &fixture.delivery.encryption_public_key)?;
        assert!(matches!(
            SentinelOnboardingRecipient {
                package: &package,
                identity: &fixture.member
            }
            .accept(),
            Err(MultiDeviceError::InvalidSentinelGenesisPayload)
        ));
        Ok(())
    }

    #[test]
    fn malformed_ciphertext_fails_after_share_admission() -> anyhow::Result<()> {
        use crate::AgeArmoredCiphertext;
        let fixture = OnboardingFixture::new()?;
        let mut package = fixture.package()?;
        package.provider_snapshot = AgeArmoredCiphertext::from_trusted("invalid armor".to_owned());
        let checked = SentinelOnboardingRecipient {
            package: &package,
            identity: &fixture.member,
        }
        .check()?;
        assert!(matches!(checked.complete(), Err(MultiDeviceError::Age(_))));
        Ok(())
    }

    #[test]
    fn accepted_scope_comes_from_delivery_after_provider_validation() -> anyhow::Result<()> {
        use crate::ActiveVaultScope;
        let mut fixture = OnboardingFixture::new()?;
        fixture.snapshot.active_vault_store_id =
            ActiveVaultScope::StoreId("untrusted-scope".to_owned());
        let package = fixture.package()?;
        let accepted = SentinelOnboardingRecipient {
            package: &package,
            identity: &fixture.member,
        }
        .accept()?;
        assert_eq!(
            accepted.provider_snapshot.active_vault_store_id.as_deref(),
            Some(fixture.delivery.store_id.as_str())
        );
        Ok(())
    }
}
