#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Rust-owned `WebAuthn` software authenticator for Nook website passkeys.

use p256::SecretKey;

use crate::{
    PASSKEY_SECRET_VERSION, PasskeyCredentialKey, PasskeyPrivateKeyPkcs8, PasskeyPublicKeyCose,
    PasskeySecret, PasskeySignatureCount,
};
#[cfg(test)]
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ciborium::value::{Integer, Value};
use ciborium::{de, ser};
use p256::Sec1Point;
use p256::ecdsa::{Signature, SigningKey, signature::Signer};
use p256::elliptic_curve::{Generate, sec1::ToSec1Point};
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use tsify::Tsify;
use url::Url;
use zeroize::{Zeroize, Zeroizing};

const ES256_ALGORITHM: i32 = -7;
const MIN_CHALLENGE_BYTES: usize = 16;
const MAX_CHALLENGE_BYTES: usize = 1024;
const MAX_CREDENTIAL_ID_BYTES: usize = 1024;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PasskeyAuthenticatorError {
    #[error("invalid WebAuthn request: {0}")]
    InvalidRequest(&'static str),
    #[error("the relying party does not match the request origin")]
    RpOriginMismatch,
    #[error("ES256 is not offered by the relying party")]
    UnsupportedAlgorithm,
    #[error("the requested credential is excluded")]
    CredentialExcluded,
    #[error("no matching passkey is available")]
    CredentialNotFound,
    #[error("more than one discoverable passkey matches this request")]
    AmbiguousCredential,
    #[error("passkey key material is invalid")]
    InvalidKeyMaterial,
    #[error("passkey signature counter is exhausted")]
    SignatureCounterExhausted,
    #[error("passkey randomness is unavailable")]
    RandomnessUnavailable,
    #[error("passkey serialization failed")]
    Serialization,
}

pub type PasskeyAuthenticatorResult<T> = Result<T, PasskeyAuthenticatorError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyRelyingParty {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyUser {
    pub id: String,
    pub name: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyCredentialDescriptor {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyRegistrationRequest {
    pub origin: String,
    pub challenge: String,
    pub relying_party: PasskeyRelyingParty,
    pub user: PasskeyUser,
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: preserves WebAuthn COSE algorithm identifiers required by the browser credential API"
        )
    )]
    pub algorithms: Vec<i32>,
    #[serde(default)]
    pub exclude_credentials: Vec<PasskeyCredentialDescriptor>,
    pub resident_key_required: bool,
    pub user_verification_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyAssertionRequest {
    pub origin: String,
    pub challenge: String,
    pub rp_id: String,
    #[serde(default)]
    pub allow_credentials: Vec<PasskeyCredentialDescriptor>,
    pub user_verification_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyRegistrationResult {
    pub credential: PasskeySecret,
    pub client_data_json: String,
    pub attestation_object: String,
    pub transports: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyAssertionResult {
    pub credential_id: String,
    pub client_data_json: String,
    pub authenticator_data: String,
    pub signature: String,
    pub user_handle: String,
    pub updated_credential: PasskeySecret,
}

mod assertion;
pub(crate) mod encoding;
mod registration;
pub use assertion::CheckedPasskeyAssertion;
use encoding::{
    AssertionAuthenticatorData, AttestationObject, CanonicalPasskeyField, ClientData,
    CoseEncodedPoint, RegistrationAuthenticatorData,
};
pub use registration::CheckedPasskeyRegistration;

/// The relying party and the exact origin reported for one ceremony.
pub struct PasskeyOrigin<'a> {
    pub rp_id: &'a str,
    pub origin: &'a str,
}
impl PasskeyOrigin<'_> {
    pub fn validate(&self) -> PasskeyAuthenticatorResult<()> {
        let Self { rp_id, origin } = *self;
        let parsed =
            Url::parse(origin).map_err(|_| PasskeyAuthenticatorError::InvalidRequest("origin"))?;
        if parsed.username() != ""
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || !matches!(parsed.path(), "" | "/")
        {
            return Err(PasskeyAuthenticatorError::InvalidRequest("origin"));
        }
        let host = parsed
            .host_str()
            .ok_or(PasskeyAuthenticatorError::InvalidRequest("origin"))?
            .to_ascii_lowercase();
        if parsed.scheme() != "https" && !(parsed.scheme() == "http" && host == "localhost") {
            return Err(PasskeyAuthenticatorError::InvalidRequest("secure origin"));
        }
        let rp_id = rp_id.to_ascii_lowercase();
        if rp_id != "localhost"
            && psl::suffix(rp_id.as_bytes())
                .is_some_and(|suffix| suffix.as_bytes() == rp_id.as_bytes())
        {
            return Err(PasskeyAuthenticatorError::InvalidRequest(
                "relying party public suffix",
            ));
        }
        if host != rp_id && !host.ends_with(&format!(".{rp_id}")) {
            return Err(PasskeyAuthenticatorError::RpOriginMismatch);
        }
        Ok(())
    }
}

#[cfg(test)]
impl PasskeyRegistrationRequest {
    fn fixture() -> Self {
        PasskeyRegistrationRequest {
            origin: "https://login.example.com".to_owned(),
            challenge: URL_SAFE_NO_PAD.encode([7_u8; 32]),
            relying_party: PasskeyRelyingParty {
                id: "example.com".to_owned(),
                name: "Example".to_owned(),
            },
            user: PasskeyUser {
                id: URL_SAFE_NO_PAD.encode(b"user-123"),
                name: "alice@example.com".to_owned(),
                display_name: "Alice".to_owned(),
            },
            algorithms: vec![-257, ES256_ALGORITHM],
            exclude_credentials: Vec::new(),
            resident_key_required: true,
            user_verification_required: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct OriginCase<'a> {
        origin: &'a str,
        rp_id: &'a str,
        expected: PasskeyAuthenticatorResult<()>,
    }

    impl OriginCase<'_> {
        fn check(self) {
            assert_eq!(
                PasskeyOrigin {
                    rp_id: self.rp_id,
                    origin: self.origin
                }
                .validate(),
                self.expected
            );
        }
    }

    #[test]
    fn origin_scope_keeps_localhost_subdomain_and_public_suffix_boundaries() {
        for case in [
            OriginCase {
                origin: "https://LOGIN.example.com/",
                rp_id: "EXAMPLE.com",
                expected: Ok(()),
            },
            OriginCase {
                origin: "https://example.com:8443",
                rp_id: "example.com",
                expected: Ok(()),
            },
            OriginCase {
                origin: "http://localhost:8080",
                rp_id: "localhost",
                expected: Ok(()),
            },
            OriginCase {
                origin: "http://example.com",
                rp_id: "example.com",
                expected: Err(PasskeyAuthenticatorError::InvalidRequest("secure origin")),
            },
            OriginCase {
                origin: "https://example.com.attacker.net",
                rp_id: "example.com",
                expected: Err(PasskeyAuthenticatorError::RpOriginMismatch),
            },
            OriginCase {
                origin: "https://login.co.uk",
                rp_id: "co.uk",
                expected: Err(PasskeyAuthenticatorError::InvalidRequest(
                    "relying party public suffix",
                )),
            },
            OriginCase {
                origin: "https://alice@example.com",
                rp_id: "example.com",
                expected: Err(PasskeyAuthenticatorError::InvalidRequest("origin")),
            },
            OriginCase {
                origin: "https://example.com/path",
                rp_id: "example.com",
                expected: Err(PasskeyAuthenticatorError::InvalidRequest("origin")),
            },
            OriginCase {
                origin: "https://example.com/?query",
                rp_id: "example.com",
                expected: Err(PasskeyAuthenticatorError::InvalidRequest("origin")),
            },
            OriginCase {
                origin: "https://example.com/#fragment",
                rp_id: "example.com",
                expected: Err(PasskeyAuthenticatorError::InvalidRequest("origin")),
            },
        ] {
            case.check();
        }
    }

    #[test]
    fn origin_algorithm_lookup_and_ambiguity_fail_closed() -> anyhow::Result<()> {
        let mut request = PasskeyRegistrationRequest::fixture();
        request.origin = "https://example.net".to_owned();
        assert_eq!(
            request
                .prepare(&[])
                .and_then(CheckedPasskeyRegistration::generate),
            Err(PasskeyAuthenticatorError::RpOriginMismatch)
        );
        request = PasskeyRegistrationRequest::fixture();
        request.algorithms = vec![-257];
        assert_eq!(
            request
                .prepare(&[])
                .and_then(CheckedPasskeyRegistration::generate),
            Err(PasskeyAuthenticatorError::UnsupportedAlgorithm)
        );

        let first = PasskeyRegistrationRequest::fixture()
            .prepare(&[])
            .and_then(CheckedPasskeyRegistration::generate)?
            .credential;
        let second = PasskeyRegistrationRequest::fixture()
            .prepare(&[])
            .and_then(CheckedPasskeyRegistration::generate)?
            .credential;
        let assertion = PasskeyAssertionRequest {
            origin: "https://example.com".to_owned(),
            challenge: URL_SAFE_NO_PAD.encode([3_u8; 32]),
            rp_id: "example.com".to_owned(),
            allow_credentials: Vec::new(),
            user_verification_required: true,
        };
        assert_eq!(
            assertion
                .prepare(&[first, second])
                .and_then(CheckedPasskeyAssertion::sign),
            Err(PasskeyAuthenticatorError::AmbiguousCredential)
        );

        assert_eq!(
            (PasskeyOrigin {
                rp_id: "co.uk",
                origin: "https://co.uk"
            })
            .validate(),
            Err(PasskeyAuthenticatorError::InvalidRequest(
                "relying party public suffix"
            ))
        );
        Ok(())
    }
}
