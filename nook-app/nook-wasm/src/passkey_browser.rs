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

pub(crate) fn recovery_options(rp_id: &str) -> Result<JsValue, JsError> {
    let prf_input = nook_core::deterministic_passkey_prf_input();
    let options = recovery_options_struct(rp_id, &prf_input)?;
    to_browser_value(&options).map_err(|error| {
        JsError::new(&format!(
            "Failed to build passkey recovery options: {error}"
        ))
    })
}

fn to_browser_value<T: Serialize>(value: &T) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let value =
        value.serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true))?;
    normalize_webauthn_binary_fields(&value)
        .map_err(|_| serde_wasm_bindgen::Error::new("Failed to normalize passkey binary fields"))?;
    Ok(value)
}

fn normalize_webauthn_binary_fields(value: &JsValue) -> Result<(), JsError> {
    let public_key = get_required(value, "publicKey")?;
    set_uint8_array_field(&public_key, "challenge")?;
    normalize_creation_binary_fields(&public_key)?;
    normalize_request_binary_fields(&public_key)?;
    normalize_prf_binary_fields(&public_key)
}

fn normalize_creation_binary_fields(public_key: &JsValue) -> Result<(), JsError> {
    let user = get_optional(public_key, "user")?;
    if !is_absent(&user) {
        set_uint8_array_field(&user, "id")?;
    }
    Ok(())
}

fn normalize_request_binary_fields(public_key: &JsValue) -> Result<(), JsError> {
    let allow_credentials = get_optional(public_key, "allowCredentials")?;
    if is_absent(&allow_credentials) {
        return Ok(());
    }

    let credentials = js_sys::Array::from(&allow_credentials);
    for credential in credentials.iter() {
        set_uint8_array_field(&credential, "id")?;
    }
    Ok(())
}

fn normalize_prf_binary_fields(public_key: &JsValue) -> Result<(), JsError> {
    let extensions = get_optional(public_key, "extensions")?;
    if is_absent(&extensions) {
        return Ok(());
    }
    let prf = get_optional(&extensions, "prf")?;
    if is_absent(&prf) {
        return Ok(());
    }

    set_prf_value_fields(&get_optional(&prf, "eval")?)?;

    let eval_by_credential = get_optional(&prf, "evalByCredential")?;
    if !is_absent(&eval_by_credential) {
        let keys = js_sys::Reflect::own_keys(&eval_by_credential)
            .map_err(|_| JsError::new("Failed to inspect passkey PRF evalByCredential entries"))?;
        for key in keys.iter() {
            let values = js_sys::Reflect::get(&eval_by_credential, &key)
                .map_err(|_| JsError::new("Failed to read passkey PRF evalByCredential entry"))?;
            set_prf_value_fields(&values)?;
        }
    }
    Ok(())
}

fn set_prf_value_fields(values: &JsValue) -> Result<(), JsError> {
    if is_absent(values) {
        return Ok(());
    }
    set_uint8_array_field(values, "first")?;
    set_uint8_array_field(values, "second")
}

fn set_uint8_array_field(target: &JsValue, field: &str) -> Result<(), JsError> {
    let bytes = get_optional(target, field)?;
    if is_absent(&bytes) {
        return Ok(());
    }
    let typed_array = js_sys::Uint8Array::new(&bytes);
    js_sys::Reflect::set(target, &JsValue::from_str(field), typed_array.as_ref())
        .map_err(|_| JsError::new(&format!("Failed to normalize passkey binary field {field}")))?;
    Ok(())
}

fn get_required(target: &JsValue, field: &str) -> Result<JsValue, JsError> {
    let value = get_optional(target, field)?;
    if is_absent(&value) {
        return Err(JsError::new(&format!(
            "Missing required passkey option field {field}"
        )));
    }
    Ok(value)
}

fn get_optional(target: &JsValue, field: &str) -> Result<JsValue, JsError> {
    js_sys::Reflect::get(target, &JsValue::from_str(field))
        .map_err(|_| JsError::new(&format!("Failed to read passkey option field {field}")))
}

fn is_absent(value: &JsValue) -> bool {
    value.is_undefined() || value.is_null()
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
                require_resident_key: true,
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

fn recovery_options_struct(
    rp_id: &str,
    prf_input: &[u8],
) -> Result<CredentialRequestOptions, JsError> {
    Ok(CredentialRequestOptions {
        public_key: PublicKeyCredentialRequestOptions {
            challenge: random_challenge()?.to_vec().into(),
            timeout: None,
            rp_id: Some(rp_id.to_owned()),
            allow_credentials: None,
            user_verification: UserVerificationRequirement::Required,
            hints: None,
            attestation: AttestationConveyancePreference::None,
            attestation_formats: None,
            extensions: Some(prf_extension(prf_input, None)),
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
            json["publicKey"]["authenticatorSelection"]["requireResidentKey"],
            true
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

    #[test]
    fn recovery_options_use_discoverable_credentials_and_global_prf_input() {
        let value = recovery_options_struct("localhost", &[9; 32]).unwrap();
        let json = to_json(&value);

        assert_eq!(json["publicKey"]["rpId"], "localhost");
        assert!(json["publicKey"]["allowCredentials"].is_null());
        assert_eq!(json["publicKey"]["userVerification"], "required");
        assert_eq!(
            json["publicKey"]["extensions"]["prf"]["eval"]["first"]
                .as_array()
                .expect("first prf input")
                .len(),
            32
        );
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::*;

    fn get(target: &JsValue, field: &str) -> JsValue {
        js_sys::Reflect::get(target, &JsValue::from_str(field)).expect("js field")
    }

    fn assert_uint8_array(value: &JsValue, expected_len: u32) {
        let bytes = js_sys::Uint8Array::new(value);
        assert_eq!(bytes.length(), expected_len);
        assert!(js_sys::ArrayBuffer::is_view(value));
    }

    #[wasm_bindgen_test]
    fn creation_options_serialize_webauthn_bytes_as_uint8_arrays() {
        let options = creation_options("localhost", "Nook", &[8; 32], &[9; 32]).unwrap();
        let public_key = get(&options, "publicKey");
        let user = get(&public_key, "user");
        let extensions = get(&public_key, "extensions");
        let prf = get(&extensions, "prf");
        let eval = get(&prf, "eval");

        assert_uint8_array(&get(&public_key, "challenge"), 32);
        assert_uint8_array(&get(&user, "id"), 32);
        assert_uint8_array(&get(&eval, "first"), 32);
    }

    #[wasm_bindgen_test]
    fn request_options_serialize_webauthn_bytes_as_uint8_arrays() {
        let credential_id = [7u8; 32];
        let options = request_options("localhost", &credential_id, &[9; 32]).unwrap();
        let public_key = get(&options, "publicKey");
        let credentials = js_sys::Array::from(&get(&public_key, "allowCredentials"));
        let first_credential = credentials.get(0);
        let extensions = get(&public_key, "extensions");
        let prf = get(&extensions, "prf");
        let eval_by_credential = get(&prf, "evalByCredential");
        let keyed_eval = get(&eval_by_credential, &base64_url(&credential_id));

        assert_uint8_array(&get(&public_key, "challenge"), 32);
        assert_uint8_array(&get(&first_credential, "id"), 32);
        assert_uint8_array(&get(&keyed_eval, "first"), 32);
    }

    #[wasm_bindgen_test]
    fn recovery_options_serialize_webauthn_bytes_as_uint8_arrays() {
        let options = recovery_options("localhost").unwrap();
        let public_key = get(&options, "publicKey");
        let extensions = get(&public_key, "extensions");
        let prf = get(&extensions, "prf");
        let eval = get(&prf, "eval");

        assert_uint8_array(&get(&public_key, "challenge"), 32);
        assert_uint8_array(&get(&eval, "first"), 32);
    }
}
