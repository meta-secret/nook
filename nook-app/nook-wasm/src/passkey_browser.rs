//! Browser `WebAuthn` option builders and credential ceremonies.
//!
//! `passkey-client` can model a `WebAuthn` client when Rust also owns the
//! authenticator. Browsers do not expose the platform passkey provider as a Rust
//! `Authenticator`, so this module calls `navigator.credentials.create/get`
//! through the browser JS API while keeping request shape, PRF extraction, and
//! passkey metadata parsing in Rust/WASM.

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
use std::{collections::HashMap, fmt::Write as _};
use wasm_bindgen::{JsCast, JsError, JsValue};
use wasm_bindgen_futures::JsFuture;

pub(crate) const PASSKEY_PRF_UNAVAILABLE: &str = "PASSKEY_PRF_UNAVAILABLE";
pub(crate) const PASSKEY_UNAVAILABLE: &str = "PASSKEY_UNAVAILABLE";
pub(crate) const PASSKEY_CEREMONY_NOT_ALLOWED: &str = "PASSKEY_CEREMONY_NOT_ALLOWED";
pub(crate) const DEFAULT_PASSKEY_LABEL: &str = "Nook device";

const CHALLENGE_LEN: usize = 32;

pub(crate) fn creation_options(
    rp_id: &str,
    rp_name: &str,
    passkey_label: &str,
    user_handle: &[u8],
    prf_input: &[u8],
) -> Result<JsValue, JsError> {
    let passkey_label = passkey_label_with_passkey_handle(passkey_label, user_handle);
    let options = creation_options_struct(rp_id, rp_name, &passkey_label, user_handle, prf_input)?;
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

pub(crate) async fn create_credential(options: &JsValue) -> Result<JsValue, JsError> {
    require_passkey_support()?;
    credential_ceremony("create", options).await
}

pub(crate) async fn get_credential(options: &JsValue) -> Result<JsValue, JsError> {
    require_passkey_support()?;
    credential_ceremony("get", options).await
}

pub(crate) async fn signal_current_user_details(
    rp_id: &str,
    user_handle: &[u8],
    passkey_label: &str,
) {
    if rp_id.trim().is_empty() {
        return;
    }
    let _ = try_signal_current_user_details(rp_id, user_handle, passkey_label).await;
}

pub(crate) fn credential_id(credential: &JsValue) -> Result<Vec<u8>, JsError> {
    let raw_id = get_required(credential, "rawId")?;
    bytes_from_js_value(&raw_id, "passkey rawId")
}

pub(crate) fn passkey_label_with_device_id(passkey_label: &str, device_id: &str) -> String {
    let label = normalized_passkey_label(passkey_label);
    format!("{label} - device {}", short_text_id(device_id))
}

pub(crate) fn assertion_user_handle(credential: &JsValue) -> Result<Vec<u8>, JsError> {
    let response = get_required(credential, "response")?;
    let user_handle = get_required(&response, "userHandle")?;
    bytes_from_js_value(&user_handle, "passkey userHandle")
}

pub(crate) fn prf_output(
    credential: &JsValue,
    require_enabled: bool,
) -> Result<Option<Vec<u8>>, JsError> {
    let extension_results = call_method0(credential, "getClientExtensionResults")?;
    let prf = get_optional(&extension_results, "prf")?;
    if is_absent(&prf) {
        if require_enabled {
            return Err(prf_unavailable(
                "This authenticator does not support the WebAuthn PRF extension required to protect device keys.",
            ));
        }
        return Ok(None);
    }
    if require_enabled && get_optional(&prf, "enabled")?.as_bool() != Some(true) {
        return Err(prf_unavailable(
            "This authenticator does not support the WebAuthn PRF extension required to protect device keys.",
        ));
    }

    let results = get_optional(&prf, "results")?;
    if is_absent(&results) {
        return Ok(None);
    }
    let first = get_optional(&results, "first")?;
    if is_absent(&first) {
        return Ok(None);
    }
    Ok(Some(bytes_from_js_value(&first, "passkey PRF output")?))
}

pub(crate) fn require_prf_output(credential: &JsValue) -> Result<Vec<u8>, JsError> {
    prf_output(credential, false)?
        .ok_or_else(|| prf_unavailable("The passkey did not return the required PRF output."))
}

pub(crate) fn prf_unavailable(message: &str) -> JsError {
    JsError::new(&format!("{PASSKEY_PRF_UNAVAILABLE}: {message}"))
}

fn to_browser_value<T: Serialize>(value: &T) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let value =
        value.serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true))?;
    normalize_webauthn_binary_fields(&value)
        .map_err(|_| serde_wasm_bindgen::Error::new("Failed to normalize passkey binary fields"))?;
    Ok(value)
}

fn require_passkey_support() -> Result<(), JsError> {
    let window = gloo_utils::window();
    if js_sys::Reflect::get(window.as_ref(), &JsValue::from_str("isSecureContext"))
        .ok()
        .and_then(|value| value.as_bool())
        != Some(true)
    {
        return Err(JsError::new(
            "Passkeys require a secure context (HTTPS or localhost).",
        ));
    }

    let public_key_credential = js_sys::Reflect::get(
        js_sys::global().as_ref(),
        &JsValue::from_str("PublicKeyCredential"),
    )
    .map_err(|_| JsError::new("Failed to inspect browser passkey support"))?;
    if is_absent(&public_key_credential) {
        return Err(passkey_unavailable(
            "Passkeys are not available in this browser.",
        ));
    }

    let navigator = js_sys::Reflect::get(window.as_ref(), &JsValue::from_str("navigator"))
        .map_err(|_| JsError::new("Failed to inspect browser navigator"))?;
    let credentials = get_optional(&navigator, "credentials")?;
    if is_absent(&credentials) {
        return Err(passkey_unavailable(
            "Passkeys are not available in this browser profile.",
        ));
    }
    Ok(())
}

async fn credential_ceremony(method: &str, options: &JsValue) -> Result<JsValue, JsError> {
    let window = gloo_utils::window();
    let navigator = js_sys::Reflect::get(window.as_ref(), &JsValue::from_str("navigator"))
        .map_err(|_| JsError::new("Failed to inspect browser navigator"))?;
    let credentials = get_required(&navigator, "credentials")?;
    let method_value = get_optional(&credentials, method)?;
    if is_absent(&method_value) {
        return Err(passkey_unavailable(&format!(
            "Passkey {method} is not available in this browser profile."
        )));
    }
    let method_fn: js_sys::Function = method_value.dyn_into().map_err(|_| {
        passkey_unavailable(&format!(
            "Passkey {method} is not available in this browser profile."
        ))
    })?;
    let promise = method_fn
        .call1(&credentials, options)
        .map_err(|error| credential_ceremony_error(method, &error))?;
    let credential = JsFuture::from(js_sys::Promise::from(promise))
        .await
        .map_err(|error| credential_ceremony_error(method, &error))?;
    if is_absent(&credential) {
        return Err(JsError::new(&format!(
            "Passkey {method} ceremony was cancelled."
        )));
    }
    Ok(credential)
}

fn credential_ceremony_error(method: &str, error: &JsValue) -> JsError {
    let name = js_error_text(error, "name");
    let message = js_error_text(error, "message");
    JsError::new(&credential_ceremony_error_message(
        method,
        name.as_deref(),
        message.as_deref(),
    ))
}

fn credential_ceremony_error_message(
    method: &str,
    name: Option<&str>,
    message: Option<&str>,
) -> String {
    // WebAuthn intentionally uses NotAllowedError for multiple
    // privacy-sensitive outcomes, including cancellation, timeout, policy
    // refusal, and an unavailable credential. Preserve that ambiguity as a
    // typed result so presentation layers can explain it without guessing.
    if name == Some("NotAllowedError") {
        return format!("{PASSKEY_CEREMONY_NOT_ALLOWED}: Passkey {method} request did not finish.");
    }

    let detail = match (name, message) {
        (Some(name), Some(message)) => format!("{name}: {message}"),
        (Some(name), None) => name.to_owned(),
        (None, Some(message)) => message.to_owned(),
        (None, None) => "unknown browser error".to_owned(),
    };

    format!("Passkey {method} ceremony failed ({detail}).")
}

fn js_error_text(error: &JsValue, property: &str) -> Option<String> {
    js_sys::Reflect::get(error, &JsValue::from_str(property))
        .ok()
        .and_then(|value| value.as_string())
        .filter(|value| !value.trim().is_empty())
}

fn passkey_unavailable(message: &str) -> JsError {
    JsError::new(&format!("{PASSKEY_UNAVAILABLE}: {message}"))
}

async fn try_signal_current_user_details(
    rp_id: &str,
    user_handle: &[u8],
    passkey_label: &str,
) -> Result<(), JsError> {
    let public_key_credential = js_sys::Reflect::get(
        js_sys::global().as_ref(),
        &JsValue::from_str("PublicKeyCredential"),
    )
    .map_err(|_| JsError::new("Failed to inspect browser passkey support"))?;
    if is_absent(&public_key_credential) {
        return Ok(());
    }

    let method_value = get_optional(&public_key_credential, "signalCurrentUserDetails")?;
    if is_absent(&method_value) {
        return Ok(());
    }
    let method_fn: js_sys::Function = method_value.dyn_into().map_err(|_| {
        JsError::new("PublicKeyCredential.signalCurrentUserDetails is not callable")
    })?;

    let label = normalized_passkey_label(passkey_label);
    let details = js_sys::Object::new();
    js_sys::Reflect::set(
        details.as_ref(),
        &JsValue::from_str("rpId"),
        &JsValue::from_str(rp_id),
    )
    .map_err(|_| JsError::new("Failed to set passkey rpId detail"))?;
    js_sys::Reflect::set(
        details.as_ref(),
        &JsValue::from_str("userId"),
        js_sys::Uint8Array::from(user_handle).as_ref(),
    )
    .map_err(|_| JsError::new("Failed to set passkey userId detail"))?;
    js_sys::Reflect::set(
        details.as_ref(),
        &JsValue::from_str("name"),
        &JsValue::from_str(&label),
    )
    .map_err(|_| JsError::new("Failed to set passkey name detail"))?;
    js_sys::Reflect::set(
        details.as_ref(),
        &JsValue::from_str("displayName"),
        &JsValue::from_str(&label),
    )
    .map_err(|_| JsError::new("Failed to set passkey displayName detail"))?;

    let promise = method_fn
        .call1(&public_key_credential, details.as_ref())
        .map_err(|_| JsError::new("Failed to signal updated passkey details"))?;
    JsFuture::from(js_sys::Promise::from(promise))
        .await
        .map_err(|_| JsError::new("Updated passkey details were rejected"))?;
    Ok(())
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

fn call_method0(target: &JsValue, method: &str) -> Result<JsValue, JsError> {
    let method_value = get_required(target, method)?;
    let method_fn: js_sys::Function = method_value
        .dyn_into()
        .map_err(|_| JsError::new(&format!("passkey method {method} is not callable")))?;
    method_fn
        .call0(target)
        .map_err(|_| JsError::new(&format!("Failed to call passkey method {method}")))
}

fn bytes_from_js_value(value: &JsValue, name: &str) -> Result<Vec<u8>, JsError> {
    if is_absent(value) {
        return Err(JsError::new(&format!("Missing {name}")));
    }
    let bytes = js_sys::Uint8Array::new(value);
    if bytes.length() == 0 {
        return Err(JsError::new(&format!("Empty {name}")));
    }
    Ok(bytes.to_vec())
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
    passkey_label: &str,
    user_handle: &[u8],
    prf_input: &[u8],
) -> Result<CredentialCreationOptions, JsError> {
    let passkey_label = normalized_passkey_label(passkey_label);
    Ok(CredentialCreationOptions {
        public_key: PublicKeyCredentialCreationOptions {
            rp: PublicKeyCredentialRpEntity {
                id: optional_rp_id(rp_id),
                name: rp_name.to_owned(),
            },
            user: PublicKeyCredentialUserEntity {
                id: user_handle.to_vec().into(),
                name: passkey_label.clone(),
                display_name: passkey_label,
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

fn optional_rp_id(rp_id: &str) -> Option<String> {
    let rp_id = rp_id.trim();
    (!rp_id.is_empty()).then(|| rp_id.to_owned())
}

fn normalized_passkey_label(label: &str) -> String {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        DEFAULT_PASSKEY_LABEL.to_owned()
    } else {
        trimmed.to_owned()
    }
}

fn passkey_label_with_passkey_handle(passkey_label: &str, user_handle: &[u8]) -> String {
    let label = normalized_passkey_label(passkey_label);
    format!("{label} - passkey {}", short_byte_id(user_handle))
}

fn short_byte_id(bytes: &[u8]) -> String {
    const PREFIX_LEN: usize = 4;
    const SUFFIX_LEN: usize = 2;

    if bytes.len() <= PREFIX_LEN + SUFFIX_LEN {
        let mut output = String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            let _ = write!(&mut output, "{byte:02x}");
        }
        return output;
    }

    let mut output = String::with_capacity((PREFIX_LEN + SUFFIX_LEN) * 2 + 3);
    for byte in bytes.iter().take(PREFIX_LEN) {
        let _ = write!(&mut output, "{byte:02x}");
    }
    output.push_str("...");
    for byte in bytes.iter().skip(bytes.len() - SUFFIX_LEN) {
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}

fn short_text_id(value: &str) -> String {
    const PREFIX_LEN: usize = 6;
    const SUFFIX_LEN: usize = 4;

    let trimmed = value.trim();
    let chars = trimmed.chars().collect::<Vec<_>>();
    if chars.len() <= PREFIX_LEN + SUFFIX_LEN + 3 {
        return trimmed.to_owned();
    }

    let prefix = chars.iter().take(PREFIX_LEN).collect::<String>();
    let suffix = chars
        .iter()
        .skip(chars.len() - SUFFIX_LEN)
        .collect::<String>();
    format!("{prefix}...{suffix}")
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
            rp_id: optional_rp_id(rp_id),
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
            rp_id: optional_rp_id(rp_id),
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
        let value =
            creation_options_struct("localhost", "Nook", "Kitchen laptop", &[8; 32], &[9; 32])
                .unwrap();
        let json = to_json(&value);

        assert_eq!(json["publicKey"]["rp"]["id"], "localhost");
        assert_eq!(json["publicKey"]["rp"]["name"], "Nook");
        assert_eq!(json["publicKey"]["user"]["name"], "Kitchen laptop");
        assert_eq!(json["publicKey"]["user"]["displayName"], "Kitchen laptop");
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
    fn blank_rp_id_uses_browser_origin_default() {
        let creation =
            creation_options_struct("", "Nook", "Browser extension", &[8; 32], &[9; 32]).unwrap();
        let creation_json = to_json(&creation);
        assert!(creation_json["publicKey"]["rp"].get("id").is_none());

        let request = request_options_struct("", &[7; 32], &[9; 32]).unwrap();
        let request_json = to_json(&request);
        assert!(request_json["publicKey"].get("rpId").is_none());

        let recovery = recovery_options_struct("", &[9; 32]).unwrap();
        let recovery_json = to_json(&recovery);
        assert!(recovery_json["publicKey"].get("rpId").is_none());
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

    #[test]
    fn not_allowed_ceremony_is_classified_without_claiming_an_exact_cause() {
        assert_eq!(
            credential_ceremony_error_message(
                "get",
                Some("NotAllowedError"),
                Some("The operation either timed out or was not allowed."),
            ),
            format!("{PASSKEY_CEREMONY_NOT_ALLOWED}: Passkey get request did not finish.")
        );
    }

    #[test]
    fn other_ceremony_errors_keep_the_browser_detail() {
        assert_eq!(
            credential_ceremony_error_message(
                "create",
                Some("SecurityError"),
                Some("This is an invalid domain."),
            ),
            "Passkey create ceremony failed (SecurityError: This is an invalid domain.)."
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
        let options =
            creation_options("localhost", "Nook", "Nook device", &[8; 32], &[9; 32]).unwrap();
        let public_key = get(&options, "publicKey");
        let user = get(&public_key, "user");
        let extensions = get(&public_key, "extensions");
        let prf = get(&extensions, "prf");
        let eval = get(&prf, "eval");

        assert_eq!(
            get(&user, "displayName").as_string().as_deref(),
            Some("Nook device - passkey 08080808...0808"),
        );
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
