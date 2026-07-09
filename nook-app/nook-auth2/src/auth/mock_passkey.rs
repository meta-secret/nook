//! In-memory passkey authenticator emulator for Rust tests and local tooling.
//!
//! This module models the part of a resident `WebAuthn` passkey provider that
//! Nook needs at the device-protection boundary: credential storage, explicit
//! user authorization, RP-scoped lookup, and PRF output. It does not replace the
//! production browser ceremony; real web builds still use `navigator.credentials`.

use std::collections::HashMap;

use getrandom::getrandom;
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::errors::DeviceKeyProtectionError;

const MOCK_CREDENTIAL_ID_LEN: usize = 32;
const MOCK_PASSKEY_SECRET_LEN: usize = 32;
const MOCK_PASSKEY_PRF_CONTEXT: &[u8] = b"nook/mock-passkey-prf/v1";

pub type MockPasskeyResult<T> = Result<T, MockPasskeyError>;

#[derive(Debug, Error)]
pub enum MockPasskeyError {
    #[error("Mock passkey user authorization was denied.")]
    AuthorizationDenied,

    #[error("Mock passkey RP id is required.")]
    RpIdEmpty,

    #[error("No matching mock passkey credential was found.")]
    NoMatchingCredential,

    #[error("Multiple discoverable mock passkey credentials match the RP id.")]
    AmbiguousDiscoverableCredential,

    #[error("Mock passkey credential belongs to a different RP id.")]
    RpIdMismatch,

    #[error("Mock passkey credential id collided with an existing credential.")]
    CredentialIdCollision,

    #[error(transparent)]
    DeviceProtection(#[from] DeviceKeyProtectionError),

    #[error("Failed to generate mock passkey random bytes: {0}")]
    RandomBytes(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MockPasskeyUserAuthorization {
    Approved,
    Denied,
}

impl MockPasskeyUserAuthorization {
    fn require_approved(self) -> MockPasskeyResult<()> {
        match self {
            Self::Approved => Ok(()),
            Self::Denied => Err(MockPasskeyError::AuthorizationDenied),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MockPasskeyRegistrationRequest {
    rp_id: String,
    label: String,
    user_handle: Vec<u8>,
    prf_input: Vec<u8>,
}

impl MockPasskeyRegistrationRequest {
    #[must_use]
    pub fn new(
        rp_id: impl Into<String>,
        label: impl Into<String>,
        user_handle: impl Into<Vec<u8>>,
        prf_input: impl Into<Vec<u8>>,
    ) -> Self {
        Self {
            rp_id: rp_id.into(),
            label: label.into(),
            user_handle: user_handle.into(),
            prf_input: prf_input.into(),
        }
    }

    #[must_use]
    pub fn rp_id(&self) -> &str {
        &self.rp_id
    }

    #[must_use]
    pub fn label(&self) -> &str {
        &self.label
    }

    #[must_use]
    pub fn user_handle(&self) -> &[u8] {
        &self.user_handle
    }

    #[must_use]
    pub fn prf_input(&self) -> &[u8] {
        &self.prf_input
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MockPasskeyAssertionRequest {
    rp_id: String,
    allow_credentials: Vec<Vec<u8>>,
    prf_input: Vec<u8>,
}

impl MockPasskeyAssertionRequest {
    #[must_use]
    pub fn discoverable(rp_id: impl Into<String>, prf_input: impl Into<Vec<u8>>) -> Self {
        Self {
            rp_id: rp_id.into(),
            allow_credentials: Vec::new(),
            prf_input: prf_input.into(),
        }
    }

    #[must_use]
    pub fn with_allowed_credential(
        rp_id: impl Into<String>,
        credential_id: impl Into<Vec<u8>>,
        prf_input: impl Into<Vec<u8>>,
    ) -> Self {
        Self {
            rp_id: rp_id.into(),
            allow_credentials: vec![credential_id.into()],
            prf_input: prf_input.into(),
        }
    }

    #[must_use]
    pub fn with_allowed_credentials(
        rp_id: impl Into<String>,
        allow_credentials: impl Into<Vec<Vec<u8>>>,
        prf_input: impl Into<Vec<u8>>,
    ) -> Self {
        Self {
            rp_id: rp_id.into(),
            allow_credentials: allow_credentials.into(),
            prf_input: prf_input.into(),
        }
    }

    #[must_use]
    pub fn rp_id(&self) -> &str {
        &self.rp_id
    }

    #[must_use]
    pub fn allow_credentials(&self) -> &[Vec<u8>] {
        &self.allow_credentials
    }

    #[must_use]
    pub fn prf_input(&self) -> &[u8] {
        &self.prf_input
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MockPasskeyRegistration {
    credential_id: Vec<u8>,
    user_handle: Vec<u8>,
    prf_output: Vec<u8>,
}

impl MockPasskeyRegistration {
    #[must_use]
    pub fn credential_id(&self) -> &[u8] {
        &self.credential_id
    }

    #[must_use]
    pub fn user_handle(&self) -> &[u8] {
        &self.user_handle
    }

    #[must_use]
    pub fn prf_output(&self) -> &[u8] {
        &self.prf_output
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MockPasskeyAssertion {
    credential_id: Vec<u8>,
    user_handle: Vec<u8>,
    prf_output: Vec<u8>,
    sign_count: u32,
}

impl MockPasskeyAssertion {
    #[must_use]
    pub fn credential_id(&self) -> &[u8] {
        &self.credential_id
    }

    #[must_use]
    pub fn user_handle(&self) -> &[u8] {
        &self.user_handle
    }

    #[must_use]
    pub fn prf_output(&self) -> &[u8] {
        &self.prf_output
    }

    #[must_use]
    pub fn sign_count(&self) -> u32 {
        self.sign_count
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredMockPasskey {
    rp_id: String,
    label: String,
    credential_id: Vec<u8>,
    user_handle: Vec<u8>,
    secret: [u8; MOCK_PASSKEY_SECRET_LEN],
    sign_count: u32,
}

impl StoredMockPasskey {
    #[must_use]
    pub fn rp_id(&self) -> &str {
        &self.rp_id
    }

    #[must_use]
    pub fn label(&self) -> &str {
        &self.label
    }

    #[must_use]
    pub fn credential_id(&self) -> &[u8] {
        &self.credential_id
    }

    #[must_use]
    pub fn user_handle(&self) -> &[u8] {
        &self.user_handle
    }

    #[must_use]
    pub fn sign_count(&self) -> u32 {
        self.sign_count
    }
}

#[derive(Debug, Default)]
pub struct MemoryPasskeyAuthenticator {
    credentials: HashMap<Vec<u8>, StoredMockPasskey>,
}

impl MemoryPasskeyAuthenticator {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(
        &mut self,
        request: MockPasskeyRegistrationRequest,
        authorization: MockPasskeyUserAuthorization,
    ) -> MockPasskeyResult<MockPasskeyRegistration> {
        authorization.require_approved()?;
        validate_rp_id(&request.rp_id)?;
        validate_user_handle(&request.user_handle)?;
        validate_prf_input(&request.prf_input)?;

        let credential_id = self.generate_unique_credential_id()?;
        let mut secret = [0u8; MOCK_PASSKEY_SECRET_LEN];
        getrandom(&mut secret).map_err(|error| MockPasskeyError::RandomBytes(error.to_string()))?;
        let prf_output = evaluate_mock_prf(&secret, &request.prf_input).to_vec();

        let stored = StoredMockPasskey {
            rp_id: request.rp_id,
            label: request.label,
            credential_id: credential_id.clone(),
            user_handle: request.user_handle.clone(),
            secret,
            sign_count: 0,
        };
        self.credentials.insert(credential_id.clone(), stored);

        Ok(MockPasskeyRegistration {
            credential_id,
            user_handle: request.user_handle,
            prf_output,
        })
    }

    pub fn authenticate(
        &mut self,
        request: &MockPasskeyAssertionRequest,
        authorization: MockPasskeyUserAuthorization,
    ) -> MockPasskeyResult<MockPasskeyAssertion> {
        authorization.require_approved()?;
        validate_rp_id(&request.rp_id)?;
        validate_prf_input(&request.prf_input)?;

        let credential_id = self.match_credential_id(request)?;
        let credential = self
            .credentials
            .get_mut(&credential_id)
            .ok_or(MockPasskeyError::NoMatchingCredential)?;
        if credential.rp_id != request.rp_id {
            return Err(MockPasskeyError::RpIdMismatch);
        }
        credential.sign_count = credential.sign_count.saturating_add(1);

        Ok(MockPasskeyAssertion {
            credential_id: credential.credential_id.clone(),
            user_handle: credential.user_handle.clone(),
            prf_output: evaluate_mock_prf(&credential.secret, &request.prf_input).to_vec(),
            sign_count: credential.sign_count,
        })
    }

    #[must_use]
    pub fn credential(&self, credential_id: &[u8]) -> Option<&StoredMockPasskey> {
        self.credentials.get(credential_id)
    }

    #[must_use]
    pub fn credential_count(&self) -> usize {
        self.credentials.len()
    }

    fn generate_unique_credential_id(&self) -> MockPasskeyResult<Vec<u8>> {
        for _ in 0..8 {
            let mut credential_id = vec![0u8; MOCK_CREDENTIAL_ID_LEN];
            getrandom(&mut credential_id)
                .map_err(|error| MockPasskeyError::RandomBytes(error.to_string()))?;
            if !self.credentials.contains_key(&credential_id) {
                return Ok(credential_id);
            }
        }
        Err(MockPasskeyError::CredentialIdCollision)
    }

    fn match_credential_id(
        &self,
        request: &MockPasskeyAssertionRequest,
    ) -> MockPasskeyResult<Vec<u8>> {
        if request.allow_credentials.is_empty() {
            let mut candidates = self
                .credentials
                .values()
                .filter(|credential| credential.rp_id == request.rp_id)
                .map(|credential| credential.credential_id.clone());
            let credential_id = candidates
                .next()
                .ok_or(MockPasskeyError::NoMatchingCredential)?;
            if candidates.next().is_some() {
                return Err(MockPasskeyError::AmbiguousDiscoverableCredential);
            }
            return Ok(credential_id);
        }

        let mut saw_wrong_rp = false;
        for credential_id in &request.allow_credentials {
            if let Some(credential) = self.credentials.get(credential_id) {
                if credential.rp_id == request.rp_id {
                    return Ok(credential_id.clone());
                }
                saw_wrong_rp = true;
            }
        }
        if saw_wrong_rp {
            Err(MockPasskeyError::RpIdMismatch)
        } else {
            Err(MockPasskeyError::NoMatchingCredential)
        }
    }
}

fn validate_rp_id(rp_id: &str) -> MockPasskeyResult<()> {
    if rp_id.trim().is_empty() {
        Err(MockPasskeyError::RpIdEmpty)
    } else {
        Ok(())
    }
}

fn validate_user_handle(user_handle: &[u8]) -> MockPasskeyResult<()> {
    if user_handle.is_empty() || user_handle.len() > 64 {
        Err(DeviceKeyProtectionError::UserHandleInvalid.into())
    } else {
        Ok(())
    }
}

fn validate_prf_input(prf_input: &[u8]) -> MockPasskeyResult<()> {
    if prf_input.len() == 32 {
        Ok(())
    } else {
        Err(DeviceKeyProtectionError::PrfInputInvalid.into())
    }
}

fn evaluate_mock_prf(secret: &[u8; MOCK_PASSKEY_SECRET_LEN], prf_input: &[u8]) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(MOCK_PASSKEY_PRF_CONTEXT);
    append_hash_field(&mut digest, secret);
    append_hash_field(&mut digest, prf_input);
    digest.finalize().into()
}

fn append_hash_field(digest: &mut Sha256, value: &[u8]) {
    digest.update(u32::try_from(value.len()).unwrap_or(u32::MAX).to_be_bytes());
    digest.update(value);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        derive_device_identity_from_passkey_prf, deterministic_passkey_prf_input,
        passkey_derived_device_identity_record,
    };

    const RP_ID: &str = "localhost";

    fn approved_registration(
        authenticator: &mut MemoryPasskeyAuthenticator,
        user_handle: Vec<u8>,
    ) -> MockPasskeyRegistration {
        authenticator
            .register(
                MockPasskeyRegistrationRequest::new(
                    RP_ID,
                    "Test passkey",
                    user_handle,
                    deterministic_passkey_prf_input(),
                ),
                MockPasskeyUserAuthorization::Approved,
            )
            .unwrap()
    }

    #[test]
    fn registers_and_authorizes_device_identity_material() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let registration = approved_registration(&mut authenticator, vec![8; 32]);
        let assertion = authenticator
            .authenticate(
                &MockPasskeyAssertionRequest::with_allowed_credential(
                    RP_ID,
                    registration.credential_id().to_vec(),
                    deterministic_passkey_prf_input(),
                ),
                MockPasskeyUserAuthorization::Approved,
            )
            .unwrap();

        assert_eq!(registration.credential_id(), assertion.credential_id());
        assert_eq!(registration.user_handle(), assertion.user_handle());
        assert_eq!(registration.prf_output(), assertion.prf_output());
        assert_eq!(assertion.sign_count(), 1);
        assert!(
            derive_device_identity_from_passkey_prf(
                assertion.user_handle(),
                assertion.prf_output()
            )
            .is_ok()
        );
    }

    #[test]
    fn discoverable_assertion_recovers_same_passkey_after_local_metadata_is_missing() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let registration = approved_registration(&mut authenticator, vec![9; 32]);
        let original_identity = derive_device_identity_from_passkey_prf(
            registration.user_handle(),
            registration.prf_output(),
        )
        .unwrap();

        let assertion = authenticator
            .authenticate(
                &MockPasskeyAssertionRequest::discoverable(
                    RP_ID,
                    deterministic_passkey_prf_input(),
                ),
                MockPasskeyUserAuthorization::Approved,
            )
            .unwrap();
        let recovered_identity = derive_device_identity_from_passkey_prf(
            assertion.user_handle(),
            assertion.prf_output(),
        )
        .unwrap();
        let recovered_record = passkey_derived_device_identity_record(
            assertion.credential_id(),
            assertion.user_handle(),
            &deterministic_passkey_prf_input(),
        )
        .unwrap();

        assert_eq!(recovered_identity, original_identity);
        assert_eq!(
            recovered_record.credential_id_bytes().unwrap(),
            registration.credential_id()
        );
    }

    #[test]
    fn user_can_deny_registration_before_any_passkey_is_stored() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let result = authenticator.register(
            MockPasskeyRegistrationRequest::new(
                RP_ID,
                "Denied",
                vec![8; 32],
                deterministic_passkey_prf_input(),
            ),
            MockPasskeyUserAuthorization::Denied,
        );

        assert!(matches!(result, Err(MockPasskeyError::AuthorizationDenied)));
        assert_eq!(authenticator.credential_count(), 0);
    }

    #[test]
    fn user_can_deny_assertion_without_incrementing_sign_count() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let registration = approved_registration(&mut authenticator, vec![8; 32]);

        let result = authenticator.authenticate(
            &MockPasskeyAssertionRequest::with_allowed_credential(
                RP_ID,
                registration.credential_id().to_vec(),
                deterministic_passkey_prf_input(),
            ),
            MockPasskeyUserAuthorization::Denied,
        );

        assert!(matches!(result, Err(MockPasskeyError::AuthorizationDenied)));
        assert_eq!(
            authenticator
                .credential(registration.credential_id())
                .unwrap()
                .sign_count(),
            0
        );
    }

    #[test]
    fn assertion_rejects_unknown_allowed_credential() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        approved_registration(&mut authenticator, vec![8; 32]);

        let result = authenticator.authenticate(
            &MockPasskeyAssertionRequest::with_allowed_credential(
                RP_ID,
                vec![44; 32],
                deterministic_passkey_prf_input(),
            ),
            MockPasskeyUserAuthorization::Approved,
        );

        assert!(matches!(
            result,
            Err(MockPasskeyError::NoMatchingCredential)
        ));
    }

    #[test]
    fn assertion_rejects_credential_registered_for_another_rp() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let registration = approved_registration(&mut authenticator, vec![8; 32]);

        let result = authenticator.authenticate(
            &MockPasskeyAssertionRequest::with_allowed_credential(
                "example.com",
                registration.credential_id().to_vec(),
                deterministic_passkey_prf_input(),
            ),
            MockPasskeyUserAuthorization::Approved,
        );

        assert!(matches!(result, Err(MockPasskeyError::RpIdMismatch)));
    }

    #[test]
    fn allowed_credentials_are_checked_in_browser_order() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let first = approved_registration(&mut authenticator, vec![1; 32]);
        let second = approved_registration(&mut authenticator, vec![2; 32]);

        let assertion = authenticator
            .authenticate(
                &MockPasskeyAssertionRequest::with_allowed_credentials(
                    RP_ID,
                    vec![
                        vec![77; 32],
                        second.credential_id().to_vec(),
                        first.credential_id().to_vec(),
                    ],
                    deterministic_passkey_prf_input(),
                ),
                MockPasskeyUserAuthorization::Approved,
            )
            .unwrap();

        assert_eq!(assertion.credential_id(), second.credential_id());
        assert_eq!(
            authenticator
                .credential(first.credential_id())
                .unwrap()
                .sign_count(),
            0
        );
        assert_eq!(
            authenticator
                .credential(second.credential_id())
                .unwrap()
                .sign_count(),
            1
        );
    }

    #[test]
    fn discoverable_assertion_rejects_ambiguous_same_rp_credentials() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let first = approved_registration(&mut authenticator, vec![1; 32]);
        let second = approved_registration(&mut authenticator, vec![2; 32]);

        let result = authenticator.authenticate(
            &MockPasskeyAssertionRequest::discoverable(RP_ID, deterministic_passkey_prf_input()),
            MockPasskeyUserAuthorization::Approved,
        );

        assert!(matches!(
            result,
            Err(MockPasskeyError::AmbiguousDiscoverableCredential)
        ));
        assert_eq!(
            authenticator
                .credential(first.credential_id())
                .unwrap()
                .sign_count(),
            0
        );
        assert_eq!(
            authenticator
                .credential(second.credential_id())
                .unwrap()
                .sign_count(),
            0
        );
    }

    #[test]
    fn separate_passkeys_produce_distinct_device_identities() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let first = approved_registration(&mut authenticator, vec![1; 32]);
        let second = approved_registration(&mut authenticator, vec![2; 32]);

        let first_identity =
            derive_device_identity_from_passkey_prf(first.user_handle(), first.prf_output())
                .unwrap();
        let second_identity =
            derive_device_identity_from_passkey_prf(second.user_handle(), second.prf_output())
                .unwrap();

        assert_ne!(first.credential_id(), second.credential_id());
        assert_ne!(first_identity, second_identity);
    }

    #[test]
    fn invalid_webauthn_material_is_rejected_before_storage_or_assertion() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();

        let bad_user = authenticator.register(
            MockPasskeyRegistrationRequest::new(
                RP_ID,
                "Bad user",
                Vec::<u8>::new(),
                deterministic_passkey_prf_input(),
            ),
            MockPasskeyUserAuthorization::Approved,
        );
        let bad_prf = authenticator.authenticate(
            &MockPasskeyAssertionRequest::discoverable(RP_ID, vec![1; 31]),
            MockPasskeyUserAuthorization::Approved,
        );
        let bad_rp = authenticator.authenticate(
            &MockPasskeyAssertionRequest::discoverable(" ", deterministic_passkey_prf_input()),
            MockPasskeyUserAuthorization::Approved,
        );

        assert!(matches!(
            bad_user,
            Err(MockPasskeyError::DeviceProtection(
                DeviceKeyProtectionError::UserHandleInvalid
            ))
        ));
        assert!(matches!(
            bad_prf,
            Err(MockPasskeyError::DeviceProtection(
                DeviceKeyProtectionError::PrfInputInvalid
            ))
        ));
        assert!(matches!(bad_rp, Err(MockPasskeyError::RpIdEmpty)));
        assert_eq!(authenticator.credential_count(), 0);
    }
}
