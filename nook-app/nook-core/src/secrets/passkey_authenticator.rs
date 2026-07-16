//! Rust-owned `WebAuthn` software authenticator for Nook website passkeys.

use crate::{
    PASSKEY_SECRET_VERSION, PasskeyCredentialKey, PasskeyPrivateKeyPkcs8, PasskeyPublicKeyCose,
    PasskeySecret,
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ciborium::value::{Integer, Value};
use p256::ecdsa::{Signature, SigningKey, signature::Signer};
use p256::elliptic_curve::rand_core::{OsRng, RngCore};
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
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
    #[error("passkey serialization failed")]
    Serialization,
}

pub type PasskeyAuthenticatorResult<T> = Result<T, PasskeyAuthenticatorError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyRelyingParty {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyUser {
    pub id: String,
    pub name: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyCredentialDescriptor {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyRegistrationRequest {
    pub origin: String,
    pub challenge: String,
    pub relying_party: PasskeyRelyingParty,
    pub user: PasskeyUser,
    pub algorithms: Vec<i32>,
    #[serde(default)]
    pub exclude_credentials: Vec<PasskeyCredentialDescriptor>,
    pub resident_key_required: bool,
    pub user_verification_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClientData<'a> {
    #[serde(rename = "type")]
    ceremony_type: &'static str,
    challenge: &'a str,
    origin: &'a str,
    cross_origin: bool,
}

fn canonical_bytes(
    name: &'static str,
    value: &str,
    min: usize,
    max: usize,
) -> PasskeyAuthenticatorResult<Vec<u8>> {
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| PasskeyAuthenticatorError::InvalidRequest(name))?;
    if bytes.len() < min || bytes.len() > max || URL_SAFE_NO_PAD.encode(&bytes) != value {
        return Err(PasskeyAuthenticatorError::InvalidRequest(name));
    }
    Ok(bytes)
}

pub fn validate_website_passkey_origin(
    rp_id: &str,
    origin: &str,
) -> PasskeyAuthenticatorResult<()> {
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
        && psl::suffix(rp_id.as_bytes()).is_some_and(|suffix| suffix.as_bytes() == rp_id.as_bytes())
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

fn client_data_json(
    ceremony_type: &'static str,
    challenge: &str,
    origin: &str,
) -> PasskeyAuthenticatorResult<Vec<u8>> {
    canonical_bytes(
        "challenge",
        challenge,
        MIN_CHALLENGE_BYTES,
        MAX_CHALLENGE_BYTES,
    )?;
    serde_json::to_vec(&ClientData {
        ceremony_type,
        challenge,
        origin,
        cross_origin: false,
    })
    .map_err(|_| PasskeyAuthenticatorError::Serialization)
}

fn integer(value: i64) -> Value {
    Value::Integer(Integer::from(value))
}

fn cose_public_key(encoded_point: &p256::EncodedPoint) -> PasskeyAuthenticatorResult<Vec<u8>> {
    let x = encoded_point
        .x()
        .ok_or(PasskeyAuthenticatorError::InvalidKeyMaterial)?;
    let y = encoded_point
        .y()
        .ok_or(PasskeyAuthenticatorError::InvalidKeyMaterial)?;
    let value = Value::Map(vec![
        (integer(1), integer(2)),
        (integer(3), integer(i64::from(ES256_ALGORITHM))),
        (integer(-1), integer(1)),
        (integer(-2), Value::Bytes(x.to_vec())),
        (integer(-3), Value::Bytes(y.to_vec())),
    ]);
    let mut bytes = Vec::new();
    ciborium::ser::into_writer(&value, &mut bytes)
        .map_err(|_| PasskeyAuthenticatorError::Serialization)?;
    Ok(bytes)
}

fn cose_coordinates(bytes: &[u8]) -> PasskeyAuthenticatorResult<(Vec<u8>, Vec<u8>)> {
    let value: Value = ciborium::de::from_reader(bytes)
        .map_err(|_| PasskeyAuthenticatorError::InvalidKeyMaterial)?;
    let Value::Map(entries) = value else {
        return Err(PasskeyAuthenticatorError::InvalidKeyMaterial);
    };
    let mut x = None;
    let mut y = None;
    let mut key_type = None;
    let mut algorithm = None;
    let mut curve = None;
    for (key, value) in entries {
        let Value::Integer(key) = key else { continue };
        let key = i128::from(key);
        match (key, value) {
            (1, Value::Integer(value)) => key_type = Some(i128::from(value)),
            (3, Value::Integer(value)) => algorithm = Some(i128::from(value)),
            (-1, Value::Integer(value)) => curve = Some(i128::from(value)),
            (-2, Value::Bytes(value)) => x = Some(value),
            (-3, Value::Bytes(value)) => y = Some(value),
            _ => {}
        }
    }
    let (Some(x), Some(y)) = (x, y) else {
        return Err(PasskeyAuthenticatorError::InvalidKeyMaterial);
    };
    if key_type != Some(2)
        || algorithm != Some(i128::from(ES256_ALGORITHM))
        || curve != Some(1)
        || x.len() != 32
        || y.len() != 32
    {
        return Err(PasskeyAuthenticatorError::InvalidKeyMaterial);
    }
    Ok((x, y))
}

pub(crate) fn validate_es256_credential_key(
    private_key: &PasskeyPrivateKeyPkcs8,
    public_key: Option<&PasskeyPublicKeyCose>,
) -> PasskeyAuthenticatorResult<()> {
    let private_bytes = Zeroizing::new(
        URL_SAFE_NO_PAD
            .decode(private_key.encoded())
            .map_err(|_| PasskeyAuthenticatorError::InvalidKeyMaterial)?,
    );
    let secret = p256::SecretKey::from_pkcs8_der(&private_bytes)
        .map_err(|_| PasskeyAuthenticatorError::InvalidKeyMaterial)?;
    if let Some(public_key) = public_key {
        let public_bytes = URL_SAFE_NO_PAD
            .decode(public_key.encoded())
            .map_err(|_| PasskeyAuthenticatorError::InvalidKeyMaterial)?;
        let (x, y) = cose_coordinates(&public_bytes)?;
        let encoded = secret.public_key().to_encoded_point(false);
        if encoded
            .x()
            .is_none_or(|value| value.as_slice() != x.as_slice())
            || encoded
                .y()
                .is_none_or(|value| value.as_slice() != y.as_slice())
        {
            return Err(PasskeyAuthenticatorError::InvalidKeyMaterial);
        }
    }
    Ok(())
}

fn authenticator_flags(user_verified: bool, attested: bool) -> u8 {
    0x01 | if user_verified { 0x04 } else { 0 } | 0x08 | 0x10 | if attested { 0x40 } else { 0 }
}

fn registration_authenticator_data(
    rp_id: &str,
    credential_id: &[u8],
    cose_key: &[u8],
    user_verified: bool,
) -> PasskeyAuthenticatorResult<Vec<u8>> {
    let mut data = Vec::with_capacity(55 + credential_id.len() + cose_key.len());
    data.extend_from_slice(&Sha256::digest(rp_id.as_bytes()));
    data.push(authenticator_flags(user_verified, true));
    data.extend_from_slice(&0_u32.to_be_bytes());
    data.extend_from_slice(&[0_u8; 16]);
    let credential_id_len = u16::try_from(credential_id.len())
        .map_err(|_| PasskeyAuthenticatorError::InvalidRequest("credential id"))?;
    data.extend_from_slice(&credential_id_len.to_be_bytes());
    data.extend_from_slice(credential_id);
    data.extend_from_slice(cose_key);
    Ok(data)
}

fn assertion_authenticator_data(rp_id: &str, count: u32, user_verified: bool) -> Vec<u8> {
    let mut data = Vec::with_capacity(37);
    data.extend_from_slice(&Sha256::digest(rp_id.as_bytes()));
    data.push(authenticator_flags(user_verified, false));
    data.extend_from_slice(&count.to_be_bytes());
    data
}

fn attestation_object(authenticator_data: Vec<u8>) -> PasskeyAuthenticatorResult<Vec<u8>> {
    let value = Value::Map(vec![
        (
            Value::Text("fmt".to_owned()),
            Value::Text("none".to_owned()),
        ),
        (Value::Text("attStmt".to_owned()), Value::Map(Vec::new())),
        (
            Value::Text("authData".to_owned()),
            Value::Bytes(authenticator_data),
        ),
    ]);
    let mut bytes = Vec::new();
    ciborium::ser::into_writer(&value, &mut bytes)
        .map_err(|_| PasskeyAuthenticatorError::Serialization)?;
    Ok(bytes)
}

pub fn create_website_passkey(
    request: &PasskeyRegistrationRequest,
    existing_credentials: &[PasskeySecret],
) -> PasskeyAuthenticatorResult<PasskeyRegistrationResult> {
    validate_website_passkey_origin(&request.relying_party.id, &request.origin)?;
    if !request.algorithms.contains(&ES256_ALGORITHM) {
        return Err(PasskeyAuthenticatorError::UnsupportedAlgorithm);
    }
    let user_handle = canonical_bytes("user handle", &request.user.id, 1, 64)?;
    let client_data = client_data_json("webauthn.create", &request.challenge, &request.origin)?;
    let excluded = request
        .exclude_credentials
        .iter()
        .map(|descriptor| {
            canonical_bytes(
                "excluded credential id",
                &descriptor.id,
                16,
                MAX_CREDENTIAL_ID_BYTES,
            )?;
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

    let mut credential_id = [0_u8; 32];
    OsRng.fill_bytes(&mut credential_id);
    let credential_id_encoded = URL_SAFE_NO_PAD.encode(credential_id);
    let secret_key = p256::SecretKey::random(&mut OsRng);
    let pkcs8 = secret_key
        .to_pkcs8_der()
        .map_err(|_| PasskeyAuthenticatorError::Serialization)?;
    let encoded_point = secret_key.public_key().to_encoded_point(false);
    let cose_key = cose_public_key(&encoded_point)?;
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
        signature_count: 0,
        discoverable: true,
        backup_eligible: true,
        backup_state: true,
    };
    credential
        .validate()
        .map_err(|_| PasskeyAuthenticatorError::InvalidKeyMaterial)?;
    let authenticator_data = registration_authenticator_data(
        &credential.rp_id,
        &credential_id,
        &cose_key,
        request.user_verification_required,
    )?;
    credential_id.zeroize();
    Ok(PasskeyRegistrationResult {
        credential,
        client_data_json: URL_SAFE_NO_PAD.encode(client_data),
        attestation_object: URL_SAFE_NO_PAD.encode(attestation_object(authenticator_data)?),
        transports: vec!["internal".to_owned()],
    })
}

pub fn assert_website_passkey(
    request: &PasskeyAssertionRequest,
    credentials: &[PasskeySecret],
) -> PasskeyAuthenticatorResult<PasskeyAssertionResult> {
    validate_website_passkey_origin(&request.rp_id, &request.origin)?;
    let client_data = client_data_json("webauthn.get", &request.challenge, &request.origin)?;
    let allowed = request
        .allow_credentials
        .iter()
        .map(|descriptor| {
            canonical_bytes(
                "allowed credential id",
                &descriptor.id,
                16,
                MAX_CREDENTIAL_ID_BYTES,
            )?;
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
        .any(|candidate| !same_credential_material(credential, candidate))
    {
        return Err(PasskeyAuthenticatorError::AmbiguousCredential);
    }
    credential
        .validate()
        .map_err(|_| PasskeyAuthenticatorError::InvalidKeyMaterial)?;
    let next_count = credential
        .signature_count
        .checked_add(1)
        .ok_or(PasskeyAuthenticatorError::SignatureCounterExhausted)?;
    let authenticator_data = assertion_authenticator_data(
        &credential.rp_id,
        next_count,
        request.user_verification_required,
    );
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
    let secret = p256::SecretKey::from_pkcs8_der(&private_bytes)
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

fn same_credential_material(left: &PasskeySecret, right: &PasskeySecret) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::{VerifyingKey, signature::Verifier};

    fn challenge(byte: u8) -> String {
        URL_SAFE_NO_PAD.encode([byte; 32])
    }

    fn registration_request() -> PasskeyRegistrationRequest {
        PasskeyRegistrationRequest {
            origin: "https://login.example.com".to_owned(),
            challenge: challenge(7),
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

    #[test]
    fn registration_builds_valid_es256_none_attestation() {
        let result = create_website_passkey(&registration_request(), &[]).unwrap();
        result.credential.validate().unwrap();
        let attestation = URL_SAFE_NO_PAD.decode(&result.attestation_object).unwrap();
        let value: Value = ciborium::de::from_reader(attestation.as_slice()).unwrap();
        let Value::Map(entries) = value else {
            panic!("attestation must be a map")
        };
        assert!(
            entries
                .iter()
                .any(|(key, value)| key == &Value::Text("fmt".to_owned())
                    && value == &Value::Text("none".to_owned()))
        );
    }

    #[test]
    fn assertion_signature_verifies_and_counter_advances() {
        let registration = create_website_passkey(&registration_request(), &[]).unwrap();
        let request = PasskeyAssertionRequest {
            origin: "https://login.example.com".to_owned(),
            challenge: challenge(9),
            rp_id: "example.com".to_owned(),
            allow_credentials: vec![PasskeyCredentialDescriptor {
                id: registration.credential.credential_id.clone(),
            }],
            user_verification_required: true,
        };
        let assertion =
            assert_website_passkey(&request, std::slice::from_ref(&registration.credential))
                .unwrap();
        assert_eq!(assertion.updated_credential.signature_count, 1);
        let auth_data = URL_SAFE_NO_PAD
            .decode(&assertion.authenticator_data)
            .unwrap();
        let client_data = URL_SAFE_NO_PAD.decode(&assertion.client_data_json).unwrap();
        let mut signed = auth_data;
        signed.extend_from_slice(&Sha256::digest(client_data));
        let signature =
            Signature::from_der(&URL_SAFE_NO_PAD.decode(assertion.signature).unwrap()).unwrap();
        let PasskeyCredentialKey::Es256 {
            public_key_cose, ..
        } = &registration.credential.key;
        let (x, y) =
            cose_coordinates(&URL_SAFE_NO_PAD.decode(public_key_cose.encoded()).unwrap()).unwrap();
        let mut point = vec![4];
        point.extend_from_slice(&x);
        point.extend_from_slice(&y);
        let verifying = VerifyingKey::from_sec1_bytes(&point).unwrap();
        verifying.verify(&signed, &signature).unwrap();
    }

    #[test]
    fn origin_algorithm_lookup_and_ambiguity_fail_closed() {
        let mut request = registration_request();
        request.origin = "https://example.net".to_owned();
        assert_eq!(
            create_website_passkey(&request, &[]),
            Err(PasskeyAuthenticatorError::RpOriginMismatch)
        );
        request = registration_request();
        request.algorithms = vec![-257];
        assert_eq!(
            create_website_passkey(&request, &[]),
            Err(PasskeyAuthenticatorError::UnsupportedAlgorithm)
        );

        let first = create_website_passkey(&registration_request(), &[])
            .unwrap()
            .credential;
        let second = create_website_passkey(&registration_request(), &[])
            .unwrap()
            .credential;
        let assertion = PasskeyAssertionRequest {
            origin: "https://example.com".to_owned(),
            challenge: challenge(3),
            rp_id: "example.com".to_owned(),
            allow_credentials: Vec::new(),
            user_verification_required: true,
        };
        assert_eq!(
            assert_website_passkey(&assertion, &[first, second]),
            Err(PasskeyAuthenticatorError::AmbiguousCredential)
        );

        assert_eq!(
            validate_website_passkey_origin("co.uk", "https://co.uk"),
            Err(PasskeyAuthenticatorError::InvalidRequest(
                "relying party public suffix"
            ))
        );
    }

    #[test]
    fn concurrent_counter_variants_resume_from_the_highest_counter() {
        let registration = create_website_passkey(&registration_request(), &[]).unwrap();
        let mut older = registration.credential.clone();
        older.signature_count = 2;
        let mut newer = registration.credential;
        newer.signature_count = 7;
        let request = PasskeyAssertionRequest {
            origin: "https://login.example.com".to_owned(),
            challenge: challenge(11),
            rp_id: "example.com".to_owned(),
            allow_credentials: vec![PasskeyCredentialDescriptor {
                id: newer.credential_id.clone(),
            }],
            user_verification_required: true,
        };

        let assertion = assert_website_passkey(&request, &[older, newer]).unwrap();

        assert_eq!(assertion.updated_credential.signature_count, 8);
    }

    #[test]
    fn credential_key_validation_rejects_mismatched_public_key() {
        let first = create_website_passkey(&registration_request(), &[])
            .unwrap()
            .credential;
        let second = create_website_passkey(&registration_request(), &[])
            .unwrap()
            .credential;
        let PasskeyCredentialKey::Es256 {
            private_key_pkcs8, ..
        } = &first.key;
        let PasskeyCredentialKey::Es256 {
            public_key_cose, ..
        } = &second.key;
        assert_eq!(
            validate_es256_credential_key(private_key_pkcs8, Some(public_key_cose)),
            Err(PasskeyAuthenticatorError::InvalidKeyMaterial)
        );
    }

    #[test]
    fn exclusions_malformed_descriptors_and_exhausted_counters_fail_closed() {
        let credential = create_website_passkey(&registration_request(), &[])
            .unwrap()
            .credential;
        let mut excluded_request = registration_request();
        excluded_request.exclude_credentials = vec![PasskeyCredentialDescriptor {
            id: credential.credential_id.clone(),
        }];
        assert_eq!(
            create_website_passkey(&excluded_request, std::slice::from_ref(&credential)),
            Err(PasskeyAuthenticatorError::CredentialExcluded)
        );

        let mut assertion_request = PasskeyAssertionRequest {
            origin: "https://login.example.com".to_owned(),
            challenge: challenge(12),
            rp_id: "example.com".to_owned(),
            allow_credentials: vec![PasskeyCredentialDescriptor {
                id: "not-base64url=".to_owned(),
            }],
            user_verification_required: true,
        };
        assert_eq!(
            assert_website_passkey(&assertion_request, std::slice::from_ref(&credential)),
            Err(PasskeyAuthenticatorError::InvalidRequest(
                "allowed credential id"
            ))
        );

        let mut exhausted = credential;
        exhausted.signature_count = u32::MAX;
        assertion_request.allow_credentials = vec![PasskeyCredentialDescriptor {
            id: exhausted.credential_id.clone(),
        }];
        assert_eq!(
            assert_website_passkey(&assertion_request, &[exhausted]),
            Err(PasskeyAuthenticatorError::SignatureCounterExhausted)
        );
    }
}
