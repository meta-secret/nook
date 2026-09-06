#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Local registration state binds setup data; it does not verify a browser ceremony.
use super::protected_identity;
use super::{
    DeviceIdentity, DeviceKeyProtectionError, DeviceKeyProtectionResult, PasskeyAssertionRequest,
    PasskeyDeviceIdentityMaterial, PasskeyDeviceProtectionMode, PasskeyRegistrationPrfOutput,
    WebAuthnCredentialId, WebAuthnPrfInput, WebAuthnPrfOutput, WebAuthnUserHandle,
};

/// Borrowed setup supplied by the existing browser or direct completion boundary.
pub struct PasskeyRegistrationInput<'a> {
    pub credential_id: &'a WebAuthnCredentialId,
    pub user_handle: &'a WebAuthnUserHandle,
    pub prf_input: &'a WebAuthnPrfInput,
    pub mode: PasskeyDeviceProtectionMode,
}
/// One local registration attempt; no browser authorization is established here.
///
/// ```
/// use nook_auth2::{PasskeyRegistration, PasskeyRegistrationInput, WebAuthnPrfOutput};
/// let complete = |input: PasskeyRegistrationInput<'_>, output: &WebAuthnPrfOutput|
///     -> anyhow::Result<_> { Ok(PasskeyRegistration::new(input).complete(output)?) };
/// ```
///
/// ```compile_fail,E0382
/// use nook_auth2::{PasskeyRegistration, WebAuthnPrfOutput};
/// let twice = |registration: PasskeyRegistration<'_>, output: &WebAuthnPrfOutput|
///     -> anyhow::Result<_> {
///     registration.complete(output)?;
///     Ok(registration.complete(output)?)
/// };
/// ```
///
/// ```compile_fail,E0451
/// use nook_auth2::{PasskeyRegistration, PasskeyRegistrationInput};
/// let fabricate = |input: PasskeyRegistrationInput<'_>| {
///     let _ = PasskeyRegistration { input };
/// };
/// ```
pub struct PasskeyRegistration<'a> {
    input: PasskeyRegistrationInput<'a>,
}
/// The original registration remains bound while awaiting its PRF output.
///
/// ```
/// use nook_auth2::{AwaitingPasskeyAssertion, WebAuthnPrfOutput};
/// let finish = |pending: AwaitingPasskeyAssertion<'_>, output: &WebAuthnPrfOutput|
///     -> anyhow::Result<_> { Ok(pending.complete(output)?) };
/// ```
///
/// ```compile_fail,E0382
/// use nook_auth2::{AwaitingPasskeyAssertion, WebAuthnPrfOutput};
/// let twice = |pending: AwaitingPasskeyAssertion<'_>, output: &WebAuthnPrfOutput|
///     -> anyhow::Result<_> {
///     pending.complete(output)?;
///     Ok(pending.complete(output)?)
/// };
/// ```
///
/// ```compile_fail,E0599
/// use nook_auth2::AwaitingPasskeyAssertion;
/// let duplicate = |pending: AwaitingPasskeyAssertion<'_>| pending.clone();
/// ```
///
/// ```compile_fail,E0451
/// use nook_auth2::{AwaitingPasskeyAssertion, PasskeyRegistration, PasskeyAssertionRequest};
/// let fabricate = |registration: PasskeyRegistration<'_>, request: PasskeyAssertionRequest| {
///     let _ = AwaitingPasskeyAssertion { registration, request };
/// };
/// ```
///
/// ```compile_fail,E0505
/// use nook_auth2::{AwaitingPasskeyAssertion, WebAuthnPrfOutput};
/// let keep_observation = |pending: AwaitingPasskeyAssertion<'_>, output: &WebAuthnPrfOutput|
///     -> anyhow::Result<_> {
///     let request = pending.request();
///     let material = pending.complete(output)?;
///     let _ = request.credential_id();
///     Ok(material)
/// };
/// ```
pub struct AwaitingPasskeyAssertion<'a> {
    registration: PasskeyRegistration<'a>,
    request: PasskeyAssertionRequest,
}
pub enum PasskeyRegistrationOutcome<'a> {
    Complete(Box<PasskeyDeviceIdentityMaterial>),
    NeedsAssertion(AwaitingPasskeyAssertion<'a>),
}
impl<'a> PasskeyRegistration<'a> {
    #[must_use]
    pub fn new(input: PasskeyRegistrationInput<'a>) -> Self {
        Self { input }
    }

    pub fn resolve(
        self,
        output: PasskeyRegistrationPrfOutput,
    ) -> DeviceKeyProtectionResult<PasskeyRegistrationOutcome<'a>> {
        match output {
            PasskeyRegistrationPrfOutput::Available(output) => self
                .complete(&output)
                .map(Box::new)
                .map(PasskeyRegistrationOutcome::Complete),
            PasskeyRegistrationPrfOutput::Unavailable => {
                let request = PasskeyAssertionRequest::new(
                    self.input.credential_id.clone(),
                    self.input.prf_input.clone(),
                );
                Ok(PasskeyRegistrationOutcome::NeedsAssertion(
                    AwaitingPasskeyAssertion {
                        registration: self,
                        request,
                    },
                ))
            }
        }
    }
    pub fn complete(
        self,
        prf_output: &WebAuthnPrfOutput,
    ) -> DeviceKeyProtectionResult<PasskeyDeviceIdentityMaterial> {
        match self.input.mode {
            PasskeyDeviceProtectionMode::Standard => self.derive(prf_output),
            PasskeyDeviceProtectionMode::AntiHacker => self.wrap(prf_output),
        }
    }
    fn derive(
        self,
        prf_output: &WebAuthnPrfOutput,
    ) -> DeviceKeyProtectionResult<PasskeyDeviceIdentityMaterial> {
        let PasskeyRegistrationInput {
            credential_id,
            user_handle,
            prf_input,
            ..
        } = self.input;

        let identity_secret = user_handle.derive_identity(prf_output)?;
        let identity = DeviceIdentity::from_secret_str(&identity_secret)
            .map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity)?;
        let record = protected_identity::passkey_derived_device_identity_record(
            credential_id,
            user_handle,
            prf_input,
        )?;
        Ok(PasskeyDeviceIdentityMaterial {
            device_id: identity.device_id().to_string(),
            identity_secret,
            record,
        })
    }
    fn wrap(
        self,
        prf_output: &WebAuthnPrfOutput,
    ) -> DeviceKeyProtectionResult<PasskeyDeviceIdentityMaterial> {
        let PasskeyRegistrationInput {
            credential_id,
            user_handle,
            prf_input,
            ..
        } = self.input;

        let identity = DeviceIdentity::generate()
            .map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity)?;
        let identity_secret = identity.secret_string();
        let record = protected_identity::passkey_wrapped_device_identity_record(
            credential_id,
            user_handle,
            prf_input,
            prf_output,
            &identity_secret,
        )?;
        Ok(PasskeyDeviceIdentityMaterial {
            device_id: identity.device_id().to_string(),
            identity_secret,
            record,
        })
    }
}
impl AwaitingPasskeyAssertion<'_> {
    #[must_use]
    pub fn request(&self) -> &PasskeyAssertionRequest {
        &self.request
    }
    pub fn complete(
        self,
        prf_output: &WebAuthnPrfOutput,
    ) -> DeviceKeyProtectionResult<PasskeyDeviceIdentityMaterial> {
        self.registration.complete(prf_output)
    }
}

#[cfg(test)]
mod tests {
    use super::super::{
        DeviceKeyProtectionSetup, DeviceKeyProtectionVersion, PasskeyIdentityUnlock,
        PasskeyRecoveryInput, PasskeyRecoveryRequest, WrappedDeviceIdentity,
    };
    use super::*;
    use crate::auth::mock_passkey::{
        MemoryPasskeyAuthenticator, MockPasskeyAssertionRequest, MockPasskeyError,
        MockPasskeyRegistration, MockPasskeyRegistrationRequest, MockPasskeyUserAuthorization,
    };
    const TEST_RP_ID: &str = "localhost";
    struct RegistrationFixture {
        authenticator: MemoryPasskeyAuthenticator,
    }
    impl RegistrationFixture {
        fn new() -> Self {
            Self {
                authenticator: MemoryPasskeyAuthenticator::new(),
            }
        }
        fn typed_credential_id(value: &[u8]) -> anyhow::Result<WebAuthnCredentialId> {
            Ok(value.to_vec().try_into()?)
        }
        fn typed_user_handle(value: &[u8]) -> anyhow::Result<WebAuthnUserHandle> {
            Ok(value.to_vec().try_into()?)
        }
        fn typed_prf_output(value: &[u8]) -> anyhow::Result<WebAuthnPrfOutput> {
            Ok(value.to_vec().try_into()?)
        }
        fn approved_mock_registration(
            &mut self,
            setup: &DeviceKeyProtectionSetup,
        ) -> anyhow::Result<MockPasskeyRegistration> {
            Ok(self.authenticator.register(
                MockPasskeyRegistrationRequest::new(
                    TEST_RP_ID,
                    "Test passkey",
                    setup.user_handle().as_ref().to_vec(),
                    setup.prf_input().as_ref().to_vec(),
                ),
                MockPasskeyUserAuthorization::Approved,
            )?)
        }
        fn complete_mock_registration(
            &mut self,
        ) -> anyhow::Result<(
            DeviceKeyProtectionSetup,
            MockPasskeyRegistration,
            PasskeyDeviceIdentityMaterial,
        )> {
            let setup = DeviceKeyProtectionSetup::generate()?;
            let registration = self.approved_mock_registration(&setup)?;
            let credential_id =
                RegistrationFixture::typed_credential_id(registration.credential_id())?;
            let resolution = PasskeyRegistration::new(PasskeyRegistrationInput {
                credential_id: &credential_id,
                user_handle: setup.user_handle(),
                prf_input: setup.prf_input(),
                mode: PasskeyDeviceProtectionMode::Standard,
            })
            .resolve(PasskeyRegistrationPrfOutput::Available(
                RegistrationFixture::typed_prf_output(registration.prf_output())?,
            ))?;
            let PasskeyRegistrationOutcome::Complete(material) = resolution else {
                return Err(anyhow::anyhow!(
                    "registration should complete from create() PRF output"
                ));
            };
            Ok((setup, registration, *material))
        }
    }

    #[test]
    fn continuation_retains_setup_and_mode_through_both_completion_branches() -> anyhow::Result<()>
    {
        let credential_id = RegistrationFixture::typed_credential_id(&[7; 48])?;
        let user_handle = RegistrationFixture::typed_user_handle(&[8; 32])?;
        let prf_input = WebAuthnPrfInput::try_from(vec![9; 32])?;
        let output = RegistrationFixture::typed_prf_output(&[10; 32])?;
        for mode in [
            PasskeyDeviceProtectionMode::Standard,
            PasskeyDeviceProtectionMode::AntiHacker,
        ] {
            let registration = PasskeyRegistration::new(PasskeyRegistrationInput {
                credential_id: &credential_id,
                user_handle: &user_handle,
                prf_input: &prf_input,
                mode,
            });
            let PasskeyRegistrationOutcome::NeedsAssertion(pending) =
                registration.resolve(PasskeyRegistrationPrfOutput::Unavailable)?
            else {
                anyhow::bail!("missing PRF must retain the assertion continuation");
            };
            assert_eq!(pending.request().credential_id(), &credential_id);
            assert_eq!(pending.request().prf_input(), &prf_input);
            assert_eq!(pending.registration.input.user_handle, &user_handle);
            assert_eq!(pending.registration.input.mode, mode);
            let material = pending.complete(&output)?;
            assert_eq!(material.record().credential_id()?, credential_id);
            assert_eq!(material.record().user_handle()?, user_handle);
            assert_eq!(material.record().prf_input()?, prf_input);
            assert_eq!(material.record().device_mode()?, mode.as_str());
            assert_eq!(
                material.record().unlock_passkey(&PasskeyIdentityUnlock {
                    stored_device_id: material.device_id(),
                    prf_output: &output,
                })?,
                *material.identity_secret()
            );
            let immediate = PasskeyRegistration::new(PasskeyRegistrationInput {
                credential_id: &credential_id,
                user_handle: &user_handle,
                prf_input: &prf_input,
                mode,
            })
            .resolve(PasskeyRegistrationPrfOutput::Available(output.clone()))?;
            let PasskeyRegistrationOutcome::Complete(immediate) = immediate else {
                anyhow::bail!("available PRF must complete registration");
            };
            assert_eq!(
                immediate.record().device_mode()?,
                material.record().device_mode()?
            );
            assert_eq!(
                immediate.record().credential_id()?,
                material.record().credential_id()?
            );
            match mode {
                PasskeyDeviceProtectionMode::Standard => assert_eq!(*immediate, material),
                PasskeyDeviceProtectionMode::AntiHacker => {
                    assert!(matches!(
                        immediate.record(),
                        WrappedDeviceIdentity::PasskeyWrappedLocal(_)
                    ));
                    assert_eq!(
                        immediate.record().unlock_passkey(&PasskeyIdentityUnlock {
                            stored_device_id: immediate.device_id(),
                            prf_output: &output,
                        })?,
                        *immediate.identity_secret()
                    );
                }
            }
        }
        Ok(())
    }

    #[test]
    fn ending_an_incomplete_continuation_keeps_borrowed_setup_unchanged() -> anyhow::Result<()> {
        let setup = DeviceKeyProtectionSetup::generate()?;
        let before = setup.clone();
        let credential_id = RegistrationFixture::typed_credential_id(&[7; 48])?;
        let original_credential = credential_id.clone();
        {
            let outcome = PasskeyRegistration::new(PasskeyRegistrationInput {
                credential_id: &credential_id,
                user_handle: setup.user_handle(),
                prf_input: setup.prf_input(),
                mode: PasskeyDeviceProtectionMode::AntiHacker,
            })
            .resolve(PasskeyRegistrationPrfOutput::Unavailable)?;
            let PasskeyRegistrationOutcome::NeedsAssertion(pending) = outcome else {
                anyhow::bail!("missing PRF must not create identity material");
            };
            assert_eq!(pending.request().credential_id(), &credential_id);
        }
        assert_eq!(setup, before);
        assert_eq!(credential_id, original_credential);
        Ok(())
    }

    #[test]
    fn passkey_workflow_setup_completes_with_registration_prf() -> anyhow::Result<()> {
        let mut fixture = RegistrationFixture::new();
        let (setup, registration, material) = fixture.complete_mock_registration()?;

        assert_eq!(
            material.record().credential_id()?.as_ref(),
            registration.credential_id()
        );
        assert_eq!(material.record().user_handle()?, *setup.user_handle());
        assert_eq!(material.record().prf_input()?, *setup.prf_input());
        assert_eq!(
            material.identity_secret(),
            &setup
                .user_handle()
                .derive_identity(&RegistrationFixture::typed_prf_output(
                    registration.prf_output()
                )?)?
        );
        Ok(())
    }

    #[test]
    fn mode_aware_registration_creates_wrapped_local_identity() -> anyhow::Result<()> {
        let mut fixture = RegistrationFixture::new();
        let setup = DeviceKeyProtectionSetup::generate()?;
        let registration = fixture.approved_mock_registration(&setup)?;
        let credential_id = RegistrationFixture::typed_credential_id(registration.credential_id())?;
        let resolution = PasskeyRegistration::new(PasskeyRegistrationInput {
            credential_id: &credential_id,
            user_handle: setup.user_handle(),
            prf_input: setup.prf_input(),
            mode: PasskeyDeviceProtectionMode::AntiHacker,
        })
        .resolve(PasskeyRegistrationPrfOutput::Available(
            RegistrationFixture::typed_prf_output(registration.prf_output())?,
        ))?;
        let PasskeyRegistrationOutcome::Complete(material) = resolution else {
            return Err(anyhow::anyhow!(
                "registration should complete from create() PRF output"
            ));
        };
        assert!(matches!(
            material.record(),
            WrappedDeviceIdentity::PasskeyWrappedLocal(_)
        ));
        Ok(())
    }

    #[test]
    fn passkey_workflow_prf_missing_registration_falls_back_to_assertion() -> anyhow::Result<()> {
        let mut fixture = RegistrationFixture::new();
        let setup = DeviceKeyProtectionSetup::generate()?;
        let registration = fixture.approved_mock_registration(&setup)?;
        let credential_id = RegistrationFixture::typed_credential_id(registration.credential_id())?;
        let resolution = PasskeyRegistration::new(PasskeyRegistrationInput {
            credential_id: &credential_id,
            user_handle: setup.user_handle(),
            prf_input: setup.prf_input(),
            mode: PasskeyDeviceProtectionMode::Standard,
        })
        .resolve(PasskeyRegistrationPrfOutput::Unavailable)?;

        let PasskeyRegistrationOutcome::NeedsAssertion(pending) = resolution else {
            return Err(anyhow::anyhow!(
                "registration without PRF output should request assertion fallback"
            ));
        };
        let request = pending.request();
        assert_eq!(
            request.credential_id().as_ref(),
            registration.credential_id()
        );
        assert_eq!(request.prf_input(), setup.prf_input());

        let assertion = fixture.authenticator.authenticate(
            &MockPasskeyAssertionRequest::with_allowed_credential(
                TEST_RP_ID,
                request.credential_id().as_ref().to_vec(),
                request.prf_input().as_ref().to_vec(),
            ),
            MockPasskeyUserAuthorization::Approved,
        )?;
        let material = pending.complete(&RegistrationFixture::typed_prf_output(
            assertion.prf_output(),
        )?)?;

        assert_eq!(
            material.record().credential_id()?.as_ref(),
            registration.credential_id()
        );
        assert_eq!(
            material.identity_secret(),
            &setup
                .user_handle()
                .derive_identity(&RegistrationFixture::typed_prf_output(
                    assertion.prf_output()
                )?)?
        );
        Ok(())
    }

    #[test]
    fn passkey_workflow_unlock_succeeds_from_stored_metadata() -> anyhow::Result<()> {
        let mut fixture = RegistrationFixture::new();
        let (_, registration, material) = fixture.complete_mock_registration()?;
        let request = material.record().assertion_request()?;
        let assertion = fixture.authenticator.authenticate(
            &MockPasskeyAssertionRequest::with_allowed_credential(
                TEST_RP_ID,
                request.credential_id().as_ref().to_vec(),
                request.prf_input().as_ref().to_vec(),
            ),
            MockPasskeyUserAuthorization::Approved,
        )?;

        let unlocked = material.record().unlock_passkey(&PasskeyIdentityUnlock {
            stored_device_id: material.device_id(),
            prf_output: &RegistrationFixture::typed_prf_output(assertion.prf_output())?,
        })?;

        assert_eq!(assertion.credential_id(), registration.credential_id());
        assert_eq!(&unlocked, material.identity_secret());

        let mut wrong_version = material.record().clone();
        let WrappedDeviceIdentity::PasskeyDerived(inner) = &mut wrong_version else {
            return Err(anyhow::anyhow!("expected passkey-derived record"));
        };
        inner.version = DeviceKeyProtectionVersion::PIN;
        assert!(matches!(
            wrong_version.unlock_passkey(&PasskeyIdentityUnlock {
                stored_device_id: material.device_id(),
                prf_output: &RegistrationFixture::typed_prf_output(assertion.prf_output())?
            }),
            Err(DeviceKeyProtectionError::UnsupportedVersion(_))
        ));
        Ok(())
    }

    #[test]
    fn passkey_workflow_recovery_reconstructs_metadata_after_local_record_loss()
    -> anyhow::Result<()> {
        let mut fixture = RegistrationFixture::new();
        let (_, registration, original) = fixture.complete_mock_registration()?;
        let recovery_request = PasskeyRecoveryRequest::deterministic();
        let assertion = fixture.authenticator.authenticate(
            &MockPasskeyAssertionRequest::discoverable(
                TEST_RP_ID,
                recovery_request.prf_input().as_ref().to_vec(),
            ),
            MockPasskeyUserAuthorization::Approved,
        )?;

        let recovered = PasskeyRecoveryRequest::deterministic().recover(&PasskeyRecoveryInput {
            credential_id: &RegistrationFixture::typed_credential_id(assertion.credential_id())?,
            user_handle: &RegistrationFixture::typed_user_handle(assertion.user_handle())?,
            prf_output: &RegistrationFixture::typed_prf_output(assertion.prf_output())?,
        })?;

        assert_eq!(recovered.device_id(), original.device_id());
        assert_eq!(recovered.identity_secret(), original.identity_secret());
        assert_eq!(
            recovered.record().credential_id()?.as_ref(),
            registration.credential_id()
        );
        assert_eq!(
            recovered.record().prf_input()?,
            WebAuthnPrfInput::deterministic()
        );
        Ok(())
    }

    #[test]
    fn passkey_workflow_denial_blocks_registration_and_assertion() -> anyhow::Result<()> {
        let mut fixture = RegistrationFixture::new();
        let setup = DeviceKeyProtectionSetup::generate()?;
        let denied_registration = fixture.authenticator.register(
            MockPasskeyRegistrationRequest::new(
                TEST_RP_ID,
                "Denied",
                setup.user_handle().as_ref().to_vec(),
                setup.prf_input().as_ref().to_vec(),
            ),
            MockPasskeyUserAuthorization::Denied,
        );
        assert!(matches!(
            denied_registration,
            Err(MockPasskeyError::AuthorizationDenied)
        ));

        let registration = fixture.approved_mock_registration(&setup)?;
        let credential_id = RegistrationFixture::typed_credential_id(registration.credential_id())?;
        let PasskeyRegistrationOutcome::NeedsAssertion(pending) =
            PasskeyRegistration::new(PasskeyRegistrationInput {
                credential_id: &credential_id,
                user_handle: setup.user_handle(),
                prf_input: setup.prf_input(),
                mode: PasskeyDeviceProtectionMode::Standard,
            })
            .resolve(PasskeyRegistrationPrfOutput::Unavailable)?
        else {
            return Err(anyhow::anyhow!(
                "registration without PRF output should request assertion fallback"
            ));
        };
        let request = pending.request();
        let denied_assertion = fixture.authenticator.authenticate(
            &MockPasskeyAssertionRequest::with_allowed_credential(
                TEST_RP_ID,
                request.credential_id().as_ref().to_vec(),
                request.prf_input().as_ref().to_vec(),
            ),
            MockPasskeyUserAuthorization::Denied,
        );

        assert!(matches!(
            denied_assertion,
            Err(MockPasskeyError::AuthorizationDenied)
        ));
        Ok(())
    }

    #[test]
    fn passkey_workflow_wrong_rp_or_unknown_credential_is_rejected() -> anyhow::Result<()> {
        let mut fixture = RegistrationFixture::new();
        let (_, registration, material) = fixture.complete_mock_registration()?;
        let request = material.record().assertion_request()?;

        let wrong_rp = fixture.authenticator.authenticate(
            &MockPasskeyAssertionRequest::with_allowed_credential(
                "example.com",
                request.credential_id().as_ref().to_vec(),
                request.prf_input().as_ref().to_vec(),
            ),
            MockPasskeyUserAuthorization::Approved,
        );
        let unknown_credential = fixture.authenticator.authenticate(
            &MockPasskeyAssertionRequest::with_allowed_credential(
                TEST_RP_ID,
                vec![44; registration.credential_id().len()],
                request.prf_input().as_ref().to_vec(),
            ),
            MockPasskeyUserAuthorization::Approved,
        );

        assert!(matches!(wrong_rp, Err(MockPasskeyError::RpIdMismatch)));
        assert!(matches!(
            unknown_credential,
            Err(MockPasskeyError::NoMatchingCredential)
        ));
        Ok(())
    }

    #[test]
    fn passkey_workflow_reconstructs_request_metadata_and_rejects_mismatched_identity()
    -> anyhow::Result<()> {
        let mut fixture = RegistrationFixture::new();
        let (_, registration, material) = fixture.complete_mock_registration()?;
        let request = material.record().assertion_request()?;

        assert_eq!(
            request.credential_id().as_ref(),
            registration.credential_id()
        );
        assert_eq!(request.prf_input(), &WebAuthnPrfInput::deterministic());

        let wrong_output = RegistrationFixture::typed_prf_output(&[99u8; 32])?;
        assert!(matches!(
            material.record().unlock_passkey(&PasskeyIdentityUnlock {
                stored_device_id: material.device_id(),
                prf_output: &wrong_output
            }),
            Err(DeviceKeyProtectionError::DeviceIdentityMismatch)
        ));
        Ok(())
    }
}
