//! Browser `WebAuthn` option builders backed by `1Password/passkey-rs` types.
//!
//! `passkey-client` can model a `WebAuthn` client when Rust also owns the
//! authenticator. Browsers do not expose the platform passkey provider as a Rust
//! `Authenticator`, so the actual `navigator.credentials.create/get` call stays
//! in the web layer. This module keeps the request shape and PRF inputs in
//! Rust/WASM using `passkey-types`.

use coset::iana;
use getrandom::getrandom;
use passkey_types::{
    Bytes,
    webauthn::{
        AttestationConveyancePreference, AuthenticationExtensionsClientInputs,
        AuthenticationExtensionsPrfInputs, AuthenticationExtensionsPrfValues,
        AuthenticatorSelectionCriteria, CredentialCreationOptions, CredentialRequestOptions,
        PublicKeyCredentialCreationOptions, PublicKeyCredentialDescriptor,
        PublicKeyCredentialParameters, PublicKeyCredentialRequestOptions,
        PublicKeyCredentialRpEntity, PublicKeyCredentialType, PublicKeyCredentialUserEntity,
        ResidentKeyRequirement, UserVerificationRequirement,
    },
};
use serde::Serialize;
use std::collections::HashMap;
use wasm_bindgen::{JsError, JsValue};

const CHALLENGE_LEN: usize = 32;

pub(crate) fn creation_options(
    rp_id: &str,
    rp_name: &str,
    user_handle: &[u8],
    prf_input: &[u8],
) -> Result<JsValue, JsError> {
    let options = creation_options_struct(rp_id, rp_name, user_handle, prf_input)?;
    to_browser_value(&options).map_err(|error| {
        JsError::new(&format!(
            "Failed to build passkey creation options: {error}"
        ))
    })
}

pub(crate) fn request_options(
    rp_id: &str,
    credential_id: &[u8],
    prf_input: &[u8],
) -> Result<JsValue, JsError> {
    let options = request_options_struct(rp_id, credential_id, prf_input)?;
    to_browser_value(&options)
        .map_err(|error| JsError::new(&format!("Failed to build passkey request options: {error}")))
}

fn to_browser_value<T: Serialize>(value: &T) -> Result<JsValue, serde_wasm_bindgen::Error> {
    value.serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true))
}

fn creation_options_struct(
    rp_id: &str,
    rp_name: &str,
    user_handle: &[u8],
    prf_input: &[u8],
) -> Result<CredentialCreationOptions, JsError> {
    Ok(CredentialCreationOptions {
        public_key: PublicKeyCredentialCreationOptions {
            rp: PublicKeyCredentialRpEntity {
                id: Some(rp_id.to_owned()),
                name: rp_name.to_owned(),
            },
            user: PublicKeyCredentialUserEntity {
                id: user_handle.to_vec().into(),
                name: "Nook device".to_owned(),
                display_name: "Nook device".to_owned(),
            },
            challenge: random_challenge()?.to_vec().into(),
            pub_key_cred_params: vec![
                PublicKeyCredentialParameters {
                    ty: PublicKeyCredentialType::PublicKey,
                    alg: iana::Algorithm::ES256,
                },
                PublicKeyCredentialParameters {
                    ty: PublicKeyCredentialType::PublicKey,
                    alg: iana::Algorithm::RS256,
                },
            ],
            timeout: None,
            exclude_credentials: None,
            authenticator_selection: Some(AuthenticatorSelectionCriteria {
                authenticator_attachment: None,
                resident_key: Some(ResidentKeyRequirement::Required),
                require_resident_key: false,
                user_verification: UserVerificationRequirement::Required,
            }),
            hints: None,
            attestation: AttestationConveyancePreference::None,
            attestation_formats: None,
            extensions: Some(prf_extension(prf_input, None)),
        },
    })
}

fn request_options_struct(
    rp_id: &str,
    credential_id: &[u8],
    prf_input: &[u8],
) -> Result<CredentialRequestOptions, JsError> {
    let allow_credential = PublicKeyCredentialDescriptor {
        ty: PublicKeyCredentialType::PublicKey,
        id: credential_id.to_vec().into(),
        transports: None,
    };
    Ok(CredentialRequestOptions {
        public_key: PublicKeyCredentialRequestOptions {
            challenge: random_challenge()?.to_vec().into(),
            timeout: None,
            rp_id: Some(rp_id.to_owned()),
            allow_credentials: Some(vec![allow_credential]),
            user_verification: UserVerificationRequirement::Required,
            hints: None,
            attestation: AttestationConveyancePreference::None,
            attestation_formats: None,
            extensions: Some(prf_extension(prf_input, Some(credential_id))),
        },
    })
}

fn prf_extension(
    prf_input: &[u8],
    credential_id: Option<&[u8]>,
) -> AuthenticationExtensionsClientInputs {
    let values = AuthenticationExtensionsPrfValues {
        first: prf_input.to_vec().into(),
        second: None,
    };
    let prf = match credential_id {
        Some(id) => AuthenticationExtensionsPrfInputs {
            eval: None,
            eval_by_credential: Some(HashMap::from([(base64_url(id), values)])),
        },
        None => AuthenticationExtensionsPrfInputs {
            eval: Some(values),
            eval_by_credential: None,
        },
    };
    AuthenticationExtensionsClientInputs {
        cred_props: None,
        prf: Some(prf),
        prf_already_hashed: None,
    }
}

fn random_challenge() -> Result<[u8; CHALLENGE_LEN], JsError> {
    let mut challenge = [0u8; CHALLENGE_LEN];
    getrandom(&mut challenge)
        .map_err(|error| JsError::new(&format!("Failed to generate passkey challenge: {error}")))?;
    Ok(challenge)
}

fn base64_url(bytes: &[u8]) -> String {
    String::from(Bytes::from(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn to_json<T: serde::Serialize>(value: &T) -> Value {
        serde_json::to_value(value).expect("json value")
    }

    #[test]
    fn creation_options_use_passkey_prf_types() {
        let value = creation_options_struct("localhost", "Nook", &[8; 32], &[9; 32]).unwrap();
        let json = to_json(&value);

        assert_eq!(json["publicKey"]["rp"]["id"], "localhost");
        assert_eq!(json["publicKey"]["rp"]["name"], "Nook");
        assert_eq!(json["publicKey"]["user"]["name"], "Nook device");
        let algorithms = json["publicKey"]["pubKeyCredParams"]
            .as_array()
            .expect("credential parameters")
            .iter()
            .map(|param| param["alg"].as_i64().expect("credential algorithm"))
            .collect::<Vec<_>>();
        assert!(algorithms.contains(&-7));
        assert!(algorithms.contains(&-257));
        assert_eq!(
            json["publicKey"]["authenticatorSelection"]["residentKey"],
            "required"
        );
        assert_eq!(
            json["publicKey"]["authenticatorSelection"]["userVerification"],
            "required"
        );
        assert_eq!(json["publicKey"]["attestation"], "none");
        assert_eq!(
            json["publicKey"]["extensions"]["prf"]["eval"]["first"]
                .as_array()
                .expect("first prf input")
                .len(),
            32
        );
    }

    #[test]
    fn request_options_key_prf_input_by_credential_id() {
        let credential_id = [7u8; 32];
        let value = request_options_struct("localhost", &credential_id, &[9; 32]).unwrap();
        let json = to_json(&value);
        let key = base64_url(&credential_id);

        assert_eq!(json["publicKey"]["rpId"], "localhost");
        assert_eq!(
            json["publicKey"]["allowCredentials"][0]["id"]
                .as_array()
                .expect("credential id")
                .len(),
            32
        );
        assert_eq!(
            json["publicKey"]["extensions"]["prf"]["evalByCredential"][key]["first"]
                .as_array()
                .expect("first prf input")
                .len(),
            32
        );
    }
}
