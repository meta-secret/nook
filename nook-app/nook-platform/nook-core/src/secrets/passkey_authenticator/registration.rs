#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Registration admission precedes credential randomness and generation.
use super::*;
/// Admitted request data, with the original request and exclusion input still borrowed.
/// This state does not establish user presence or durable credential persistence.
///
/// Preparation is the public route to generation.
///
/// ```
/// use nook_core::{PasskeyRegistrationRequest, PasskeySecret, PasskeyAuthenticatorError};
/// let generate = |request: &PasskeyRegistrationRequest, credentials: &[PasskeySecret]|
///     -> Result<_, PasskeyAuthenticatorError> { request.prepare(credentials)?.generate() };
/// ```
///
/// An admitted ceremony cannot be generated twice.
///
/// ```compile_fail,E0382
/// use nook_core::{CheckedPasskeyRegistration, PasskeyAuthenticatorError};
/// let twice = |checked: CheckedPasskeyRegistration<'_>| -> Result<_, PasskeyAuthenticatorError> {
///     checked.generate()?;
///     checked.generate()
/// };
/// ```
///
/// The request cannot change while its admitted state is still in use.
///
/// ```compile_fail,E0502
/// use nook_core::{PasskeyRegistrationRequest, PasskeyAuthenticatorError};
/// let changed = |request: &mut PasskeyRegistrationRequest| -> Result<_, PasskeyAuthenticatorError> {
///     let checked = request.prepare(&[])?;
///     request.challenge.clear();
///     checked.generate()
/// };
/// ```
///
/// Decoded fields cannot be supplied to bypass admission.
///
/// ```compile_fail,E0451
/// use nook_core::{CheckedPasskeyRegistration, PasskeyRegistrationRequest};
/// let fabricate = |request: &PasskeyRegistrationRequest| {
///     let _ = CheckedPasskeyRegistration {
///         request, _existing_credentials: &[], user_handle: Vec::new(), client_data: Vec::new(),
///     };
/// };
/// ```
pub struct CheckedPasskeyRegistration<'a> {
    request: &'a PasskeyRegistrationRequest,
    _existing_credentials: &'a [PasskeySecret],
    user_handle: Vec<u8>,
    client_data: Vec<u8>,
}
impl PasskeyRegistrationRequest {
    pub fn prepare<'a>(
        &'a self,
        existing_credentials: &'a [PasskeySecret],
    ) -> PasskeyAuthenticatorResult<CheckedPasskeyRegistration<'a>> {
        let request = self;
        (PasskeyOrigin {
            rp_id: &request.relying_party.id,
            origin: &request.origin,
        })
        .validate()?;
        if !request.algorithms.contains(&ES256_ALGORITHM) {
            return Err(PasskeyAuthenticatorError::UnsupportedAlgorithm);
        }
        let user_handle = CanonicalPasskeyField {
            name: "user handle",
            value: &request.user.id,
            min: 1,
            max: 64,
        }
        .decode()?;
        let client_data = ClientData {
            ceremony_type: "webauthn.create",
            challenge: &request.challenge,
            origin: &request.origin,
            cross_origin: false,
        }
        .encode()?;
        let excluded = request
            .exclude_credentials
            .iter()
            .map(|descriptor| {
                CanonicalPasskeyField {
                    name: "excluded credential id",
                    value: &descriptor.id,
                    min: 16,
                    max: MAX_CREDENTIAL_ID_BYTES,
                }
                .decode()?;
                Ok(descriptor.id.as_str())
            })
            .collect::<PasskeyAuthenticatorResult<HashSet<_>>>()?;
        if existing_credentials.iter().any(|credential| {
            credential
                .rp_id
                .eq_ignore_ascii_case(&request.relying_party.id)
                && excluded.contains(credential.credential_id.as_str())
        }) {
            return Err(PasskeyAuthenticatorError::CredentialExcluded);
        }

        Ok(CheckedPasskeyRegistration {
            request,
            _existing_credentials: existing_credentials,
            user_handle,
            client_data,
        })
    }
}
impl CheckedPasskeyRegistration<'_> {
    pub fn generate(self) -> PasskeyAuthenticatorResult<PasskeyRegistrationResult> {
        let Self {
            request,
            user_handle,
            client_data,
            ..
        } = self;
        let mut credential_id = [0_u8; 32];
        getrandom::fill(&mut credential_id)
            .map_err(|_| PasskeyAuthenticatorError::RandomnessUnavailable)?;
        let credential_id_encoded = URL_SAFE_NO_PAD.encode(credential_id);
        let secret_key = SecretKey::try_generate()
            .map_err(|_| PasskeyAuthenticatorError::RandomnessUnavailable)?;
        let pkcs8 = secret_key
            .to_pkcs8_der()
            .map_err(|_| PasskeyAuthenticatorError::Serialization)?;
        let encoded_point = secret_key.public_key().to_sec1_point(false);
        let cose_key = CoseEncodedPoint(&encoded_point).encode()?;
        let private_key = PasskeyPrivateKeyPkcs8::parse(URL_SAFE_NO_PAD.encode(pkcs8.as_bytes()))
            .map_err(|_| PasskeyAuthenticatorError::InvalidKeyMaterial)?;
        let public_key = PasskeyPublicKeyCose::parse(URL_SAFE_NO_PAD.encode(&cose_key))
            .map_err(|_| PasskeyAuthenticatorError::InvalidKeyMaterial)?;
        let credential = PasskeySecret {
            version: PASSKEY_SECRET_VERSION,
            rp_id: request.relying_party.id.to_ascii_lowercase(),
            rp_name: request.relying_party.name.clone(),
            credential_id: credential_id_encoded,
            user_handle: URL_SAFE_NO_PAD.encode(user_handle),
            user_name: request.user.name.clone(),
            user_display_name: request.user.display_name.clone(),
            key: PasskeyCredentialKey::Es256 {
                private_key_pkcs8: private_key,
                public_key_cose: public_key,
            },
            signature_count: PasskeySignatureCount::ZERO,
            discoverable: true,
            backup_eligible: true,
            backup_state: true,
        };
        credential
            .validate()
            .map_err(|_| PasskeyAuthenticatorError::InvalidKeyMaterial)?;
        let authenticator_data = RegistrationAuthenticatorData {
            rp_id: &credential.rp_id,
            credential_id: &credential_id,
            cose_key: &cose_key,
            user_verified: request.user_verification_required,
        }
        .encode()?;
        credential_id.zeroize();
        Ok(PasskeyRegistrationResult {
            credential,
            client_data_json: URL_SAFE_NO_PAD.encode(client_data),
            attestation_object: URL_SAFE_NO_PAD
                .encode(AttestationObject(authenticator_data).encode()?),
            transports: vec!["internal".to_owned()],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ptr;

    struct RegistrationRejection {
        request: PasskeyRegistrationRequest,
        expected: PasskeyAuthenticatorError,
    }

    impl RegistrationRejection {
        fn check(self) -> anyhow::Result<()> {
            match self.request.prepare(&[]) {
                Err(error) => assert_eq!(error, self.expected),
                Ok(_) => anyhow::bail!("invalid registration reached generation state"),
            }
            Ok(())
        }
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RegistrationClientData {
        #[serde(rename = "type")]
        ceremony_type: String,
        challenge: String,
        origin: String,
        cross_origin: bool,
    }

    #[test]
    fn admission_preserves_origin_algorithm_user_challenge_descriptor_order() -> anyhow::Result<()>
    {
        let mut request = PasskeyRegistrationRequest::fixture();
        request.origin = "https://unrelated.example.net".to_owned();
        request.algorithms.clear();
        request.user.id = "invalid=".to_owned();
        request.challenge = "invalid=".to_owned();
        request.exclude_credentials = vec![PasskeyCredentialDescriptor {
            id: "invalid=".to_owned(),
        }];
        RegistrationRejection {
            request: request.clone(),
            expected: PasskeyAuthenticatorError::RpOriginMismatch,
        }
        .check()?;
        request.origin = "https://example.com".to_owned();
        RegistrationRejection {
            request: request.clone(),
            expected: PasskeyAuthenticatorError::UnsupportedAlgorithm,
        }
        .check()?;
        request.algorithms = vec![ES256_ALGORITHM];
        RegistrationRejection {
            request: request.clone(),
            expected: PasskeyAuthenticatorError::InvalidRequest("user handle"),
        }
        .check()?;
        request.user.id = URL_SAFE_NO_PAD.encode([1_u8]);
        RegistrationRejection {
            request: request.clone(),
            expected: PasskeyAuthenticatorError::InvalidRequest("challenge"),
        }
        .check()?;
        request.challenge = URL_SAFE_NO_PAD.encode([2_u8; 16]);
        RegistrationRejection {
            request,
            expected: PasskeyAuthenticatorError::InvalidRequest("excluded credential id"),
        }
        .check()?;
        Ok(())
    }

    #[test]
    fn generation_retains_exact_report_and_preparation_does_not_mutate_inputs() -> anyhow::Result<()>
    {
        let mut request = PasskeyRegistrationRequest::fixture();
        request.origin = "https://LOGIN.example.com/".to_owned();
        request.relying_party.id = "EXAMPLE.com".to_owned();
        request.user_verification_required = false;
        let before = request.clone();
        let existing = Vec::new();
        let checked = request.prepare(&existing)?;
        assert!(ptr::eq(checked.request, &request));
        assert!(ptr::eq(checked._existing_credentials, existing.as_slice()));
        drop(checked);
        assert_eq!(request, before);
        assert!(existing.is_empty());
        let result = request.prepare(&existing)?.generate()?;
        let data: RegistrationClientData =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(result.client_data_json)?)?;
        assert_eq!(data.ceremony_type, "webauthn.create");
        assert_eq!(data.challenge, request.challenge);
        assert_eq!(data.origin, request.origin);
        assert!(!data.cross_origin);
        assert_eq!(result.credential.rp_id, "example.com");
        assert_eq!(result.credential.user_handle, request.user.id);
        assert_eq!(
            result.credential.signature_count,
            PasskeySignatureCount::ZERO
        );
        assert_eq!(request, before);
        Ok(())
    }

    #[test]
    fn registration_builds_valid_es256_none_attestation() -> anyhow::Result<()> {
        let result = PasskeyRegistrationRequest::fixture()
            .prepare(&[])
            .and_then(CheckedPasskeyRegistration::generate)?;
        result.credential.validate()?;
        let attestation = URL_SAFE_NO_PAD.decode(&result.attestation_object)?;
        let value: Value = de::from_reader(attestation.as_slice())?;
        let Value::Map(entries) = value else {
            panic!("attestation must be a map")
        };
        assert!(
            entries
                .iter()
                .any(|(key, value)| key == &Value::Text("fmt".to_owned())
                    && value == &Value::Text("none".to_owned()))
        );
        Ok(())
    }
}
