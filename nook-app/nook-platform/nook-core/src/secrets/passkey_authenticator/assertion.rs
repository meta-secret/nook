#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Assertion selection binds the credential, counter, and request before signing.
use super::*;
use base64::Engine as _;
/// A locally selected credential and its next counter, not a global counter reservation.
///
/// ```
/// use nook_core::{WebsitePasskeyAssertionRequest, PasskeySecret, PasskeyAuthenticatorError};
/// let sign = |request: &WebsitePasskeyAssertionRequest, credentials: &[PasskeySecret]|
///     -> Result<_, PasskeyAuthenticatorError> { request.prepare(credentials)?.sign() };
/// ```
///
/// Signing consumes the selection.
///
/// ```compile_fail,E0382
/// use nook_core::{CheckedPasskeyAssertion, PasskeyAuthenticatorError};
/// let twice = |checked: CheckedPasskeyAssertion<'_>| -> Result<_, PasskeyAuthenticatorError> {
///     checked.sign()?;
///     checked.sign()
/// };
/// ```
///
/// The selected credential cannot be altered before its signature is produced.
///
/// ```compile_fail,E0502
/// use nook_core::{WebsitePasskeyAssertionRequest, PasskeySecret, PasskeyAuthenticatorError};
/// let changed = |request: &WebsitePasskeyAssertionRequest, credentials: &mut [PasskeySecret]|
///     -> Result<_, PasskeyAuthenticatorError> {
///     let checked = request.prepare(credentials)?;
///     credentials[0].credential_id.clear();
///     checked.sign()
/// };
/// ```
///
/// Callers cannot supply a counter or client-data value without selection.
///
/// ```compile_fail,E0451
/// use nook_core::{CheckedPasskeyAssertion, WebsitePasskeyAssertionRequest, PasskeySecret, PasskeySignatureCount};
/// let fabricate = |request: &WebsitePasskeyAssertionRequest, credential: &PasskeySecret| {
///     let _ = CheckedPasskeyAssertion {
///         request, credential, next_count: PasskeySignatureCount::ZERO, client_data: Vec::new(),
///     };
/// };
/// ```
pub struct CheckedPasskeyAssertion<'a> {
    request: &'a PasskeyAssertionRequest,
    credential: &'a PasskeySecret,
    next_count: PasskeySignatureCount,
    client_data: Vec<u8>,
}
impl PasskeyAssertionRequest {
    pub fn prepare<'a>(
        &'a self,
        credentials: &'a [PasskeySecret],
    ) -> PasskeyAuthenticatorResult<CheckedPasskeyAssertion<'a>> {
        let request = self;
        (PasskeyOrigin {
            rp_id: &request.rp_id,
            origin: &request.origin,
        })
        .validate()?;
        let client_data = ClientData {
            ceremony_type: "webauthn.get",
            challenge: &request.challenge,
            origin: &request.origin,
            cross_origin: false,
        }
        .encode()?;
        let allowed = request
            .allow_credentials
            .iter()
            .map(|descriptor| {
                CanonicalPasskeyField {
                    name: "allowed credential id",
                    value: &descriptor.id,
                    min: 16,
                    max: MAX_CREDENTIAL_ID_BYTES,
                }
                .decode()?;
                Ok(descriptor.id.as_str())
            })
            .collect::<PasskeyAuthenticatorResult<HashSet<_>>>()?;
        let matching = credentials
            .iter()
            .filter(|credential| {
                credential.rp_id.eq_ignore_ascii_case(&request.rp_id)
                    && (allowed.is_empty() || allowed.contains(credential.credential_id.as_str()))
            })
            .collect::<Vec<_>>();
        let credential = matching
            .iter()
            .copied()
            .max_by_key(|credential| credential.signature_count)
            .ok_or(PasskeyAuthenticatorError::CredentialNotFound)?;
        if matching
            .iter()
            .any(|candidate| !credential.same_credential_material(candidate))
        {
            return Err(PasskeyAuthenticatorError::AmbiguousCredential);
        }
        credential
            .validate()
            .map_err(|_| PasskeyAuthenticatorError::InvalidKeyMaterial)?;
        let next_count = credential
            .signature_count
            .checked_increment()
            .ok_or(PasskeyAuthenticatorError::SignatureCounterExhausted)?;

        Ok(CheckedPasskeyAssertion {
            request,
            credential,
            next_count,
            client_data,
        })
    }
}
impl CheckedPasskeyAssertion<'_> {
    pub fn sign(self) -> PasskeyAuthenticatorResult<PasskeyAssertionResult> {
        let Self {
            request,
            credential,
            next_count,
            client_data,
        } = self;
        let authenticator_data = AssertionAuthenticatorData {
            rp_id: &credential.rp_id,
            count: u32::from(next_count),
            user_verified: request.user_verification_required,
        }
        .encode();
        let mut signed_bytes = authenticator_data.clone();
        signed_bytes.extend_from_slice(&Sha256::digest(&client_data));
        let PasskeyCredentialKey::Es256 {
            private_key_pkcs8, ..
        } = &credential.key;
        let private_bytes = Zeroizing::new(
            URL_SAFE_NO_PAD
                .decode(private_key_pkcs8.encoded())
                .map_err(|_| PasskeyAuthenticatorError::InvalidKeyMaterial)?,
        );
        let secret = SecretKey::from_pkcs8_der(&private_bytes)
            .map_err(|_| PasskeyAuthenticatorError::InvalidKeyMaterial)?;
        let signing_key = SigningKey::from(secret);
        let signature: Signature = signing_key.sign(&signed_bytes);
        signed_bytes.zeroize();
        let mut updated_credential = credential.clone();
        updated_credential.signature_count = next_count;
        Ok(PasskeyAssertionResult {
            credential_id: credential.credential_id.clone(),
            client_data_json: URL_SAFE_NO_PAD.encode(client_data),
            authenticator_data: URL_SAFE_NO_PAD.encode(authenticator_data),
            signature: URL_SAFE_NO_PAD.encode(signature.to_der().as_bytes()),
            user_handle: credential.user_handle.clone(),
            updated_credential,
        })
    }
}
impl PasskeySecret {
    fn same_credential_material(&self, right: &Self) -> bool {
        let left = self;
        left.version == right.version
            && left.rp_id.eq_ignore_ascii_case(&right.rp_id)
            && left.rp_name == right.rp_name
            && left.credential_id == right.credential_id
            && left.user_handle == right.user_handle
            && left.user_name == right.user_name
            && left.user_display_name == right.user_display_name
            && left.key == right.key
            && left.discoverable == right.discoverable
            && left.backup_eligible == right.backup_eligible
            && left.backup_state == right.backup_state
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::{VerifyingKey, signature::Verifier};
    use std::ptr;
    use std::slice;

    impl PasskeyAssertionRequest {
        fn fixture() -> Self {
            Self {
                origin: "https://login.example.com".to_owned(),
                challenge: URL_SAFE_NO_PAD.encode([9_u8; 32]),
                rp_id: "example.com".to_owned(),
                allow_credentials: Vec::new(),
                user_verification_required: true,
            }
        }
    }

    struct AssertionRejection {
        request: PasskeyAssertionRequest,
        expected: PasskeyAuthenticatorError,
    }

    impl AssertionRejection {
        fn check(self) -> anyhow::Result<()> {
            match self.request.prepare(&[]) {
                Err(error) => assert_eq!(error, self.expected),
                Ok(_) => anyhow::bail!("invalid assertion reached signing state"),
            }
            Ok(())
        }
    }

    #[test]
    fn admission_preserves_origin_challenge_allow_list_and_lookup_order() -> anyhow::Result<()> {
        let mut request = PasskeyAssertionRequest::fixture();
        request.origin = "https://unrelated.example.net".to_owned();
        request.challenge = "invalid=".to_owned();
        request.allow_credentials = vec![PasskeyCredentialDescriptor {
            id: "invalid=".to_owned(),
        }];
        AssertionRejection {
            request: request.clone(),
            expected: PasskeyAuthenticatorError::RpOriginMismatch,
        }
        .check()?;
        request.origin = "https://example.com".to_owned();
        AssertionRejection {
            request: request.clone(),
            expected: PasskeyAuthenticatorError::InvalidRequest("challenge"),
        }
        .check()?;
        request.challenge = URL_SAFE_NO_PAD.encode([2_u8; 16]);
        AssertionRejection {
            request: request.clone(),
            expected: PasskeyAuthenticatorError::InvalidRequest("allowed credential id"),
        }
        .check()?;
        request.allow_credentials.clear();
        AssertionRejection {
            request,
            expected: PasskeyAuthenticatorError::CredentialNotFound,
        }
        .check()?;
        Ok(())
    }

    #[test]
    fn checked_selection_borrows_highest_counter_and_drop_leaves_it_unchanged() -> anyhow::Result<()>
    {
        let registration = PasskeyRegistrationRequest::fixture()
            .prepare(&[])?
            .generate()?;
        let mut older = registration.credential.clone();
        older.signature_count = 3.into();
        let mut newer = registration.credential;
        newer.signature_count = 9.into();
        let credentials = vec![older, newer];
        let before = credentials.clone();
        let request = PasskeyAssertionRequest::fixture();
        let checked = request.prepare(&credentials)?;
        assert!(ptr::eq(checked.request, &request));
        assert!(ptr::eq(checked.credential, &credentials[1]));
        assert_eq!(u32::from(checked.next_count), 10);
        drop(checked);
        assert_eq!(credentials, before);
        let signed = request.prepare(&credentials)?.sign()?;
        assert_eq!(u32::from(signed.updated_credential.signature_count), 10);
        assert_eq!(signed.credential_id, credentials[1].credential_id);
        assert_eq!(credentials, before);
        Ok(())
    }

    #[test]
    fn assertion_signature_verifies_and_counter_advances() -> anyhow::Result<()> {
        let registration = PasskeyRegistrationRequest::fixture()
            .prepare(&[])
            .and_then(CheckedPasskeyRegistration::generate)?;
        let request = PasskeyAssertionRequest {
            origin: "https://login.example.com".to_owned(),
            challenge: URL_SAFE_NO_PAD.encode([9_u8; 32]),
            rp_id: "example.com".to_owned(),
            allow_credentials: vec![PasskeyCredentialDescriptor {
                id: registration.credential.credential_id.clone(),
            }],
            user_verification_required: true,
        };
        let assertion = request
            .prepare(slice::from_ref(&registration.credential))
            .and_then(CheckedPasskeyAssertion::sign)?;
        assert_eq!(u32::from(assertion.updated_credential.signature_count), 1);
        let auth_data = URL_SAFE_NO_PAD.decode(&assertion.authenticator_data)?;
        let client_data = URL_SAFE_NO_PAD.decode(&assertion.client_data_json)?;
        let mut signed = auth_data;
        signed.extend_from_slice(&Sha256::digest(client_data));
        let signature = Signature::from_der(&URL_SAFE_NO_PAD.decode(assertion.signature)?)?;
        let PasskeyCredentialKey::Es256 {
            public_key_cose, ..
        } = &registration.credential.key;
        let (x, y) =
            CoseKeyBytes(&URL_SAFE_NO_PAD.decode(public_key_cose.encoded())?).coordinates()?;
        let mut point = vec![4];
        point.extend_from_slice(&x);
        point.extend_from_slice(&y);
        let verifying = VerifyingKey::from_sec1_bytes(&point)?;
        verifying.verify(&signed, &signature)?;
        Ok(())
    }
    #[test]
    fn concurrent_counter_variants_resume_from_the_highest_counter() -> anyhow::Result<()> {
        let registration = PasskeyRegistrationRequest::fixture()
            .prepare(&[])
            .and_then(CheckedPasskeyRegistration::generate)?;
        let mut older = registration.credential.clone();
        older.signature_count = 2.into();
        let mut newer = registration.credential;
        newer.signature_count = 7.into();
        let request = PasskeyAssertionRequest {
            origin: "https://login.example.com".to_owned(),
            challenge: URL_SAFE_NO_PAD.encode([11_u8; 32]),
            rp_id: "example.com".to_owned(),
            allow_credentials: vec![PasskeyCredentialDescriptor {
                id: newer.credential_id.clone(),
            }],
            user_verification_required: true,
        };

        let assertion = request
            .prepare(&[older, newer])
            .and_then(CheckedPasskeyAssertion::sign)?;

        assert_eq!(u32::from(assertion.updated_credential.signature_count), 8);
        Ok(())
    }
    #[test]
    fn exclusions_malformed_descriptors_and_exhausted_counters_fail_closed() -> anyhow::Result<()> {
        let credential = PasskeyRegistrationRequest::fixture()
            .prepare(&[])
            .and_then(CheckedPasskeyRegistration::generate)?
            .credential;
        let mut excluded_request = PasskeyRegistrationRequest::fixture();
        excluded_request.exclude_credentials = vec![PasskeyCredentialDescriptor {
            id: credential.credential_id.clone(),
        }];
        assert_eq!(
            excluded_request
                .prepare(slice::from_ref(&credential))
                .and_then(CheckedPasskeyRegistration::generate),
            Err(PasskeyAuthenticatorError::CredentialExcluded)
        );

        let mut assertion_request = PasskeyAssertionRequest {
            origin: "https://login.example.com".to_owned(),
            challenge: URL_SAFE_NO_PAD.encode([12_u8; 32]),
            rp_id: "example.com".to_owned(),
            allow_credentials: vec![PasskeyCredentialDescriptor {
                id: "not-base64url=".to_owned(),
            }],
            user_verification_required: true,
        };
        assert_eq!(
            assertion_request
                .prepare(slice::from_ref(&credential))
                .and_then(CheckedPasskeyAssertion::sign),
            Err(PasskeyAuthenticatorError::InvalidRequest(
                "allowed credential id"
            ))
        );

        let mut exhausted = credential;
        exhausted.signature_count = u32::MAX.into();
        assertion_request.allow_credentials = vec![PasskeyCredentialDescriptor {
            id: exhausted.credential_id.clone(),
        }];
        assert_eq!(
            assertion_request
                .prepare(&[exhausted])
                .and_then(CheckedPasskeyAssertion::sign),
            Err(PasskeyAuthenticatorError::SignatureCounterExhausted)
        );
        Ok(())
    }
}
