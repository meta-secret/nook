use super::{DEFAULT_PASSKEY_LABEL, get_optional_array, get_optional_object, get_required_object};
use coset::iana;
use getrandom::fill;
use passkey_types::{
    Bytes,
    webauthn::{
        AttestationConveyancePreference, AuthenticationExtensionsClientInputs,
        AuthenticationExtensionsPrfInputs, AuthenticationExtensionsPrfValues,
        AuthenticatorSelectionCriteria, CredentialCreationOptions as PasskeyCreationOptions,
        CredentialRequestOptions as PasskeyRequestOptions, PublicKeyCredentialCreationOptions,
        PublicKeyCredentialDescriptor, PublicKeyCredentialParameters,
        PublicKeyCredentialRequestOptions, PublicKeyCredentialRpEntity, PublicKeyCredentialType,
        PublicKeyCredentialUserEntity, ResidentKeyRequirement, UserVerificationRequirement,
    },
};
use serde::Serialize;
use std::{collections::HashMap, fmt::Write as _};
use wasm_bindgen::{JsCast, JsError};
use web_sys::{CredentialCreationOptions, CredentialRequestOptions};

const CHALLENGE_LEN: usize = 32;

pub(crate) fn creation_options(
    rp_id: &str,
    rp_name: &str,
    passkey_label: &str,
    user_handle: &[u8],
    prf_input: &[u8],
) -> Result<CredentialCreationOptions, JsError> {
    let setup = nook_core::DeviceKeyProtectionSetup::new(user_handle, prf_input)
        .map_err(|error| JsError::new(&error.to_string()))?;
    let passkey_label = passkey_label_with_passkey_handle(passkey_label, setup.user_handle());
    let options = creation_options_struct(
        rp_id,
        rp_name,
        &passkey_label,
        setup.user_handle(),
        setup.prf_input(),
    )?;
    to_browser_object(&options)
        .map(JsCast::unchecked_into)
        .map_err(|error| {
            JsError::new(&format!(
                "Failed to build passkey creation options: {error}"
            ))
        })
}

pub(crate) fn request_options(
    rp_id: &str,
    credential_id: &[u8],
    prf_input: &[u8],
) -> Result<CredentialRequestOptions, JsError> {
    let request = nook_core::PasskeyAssertionRequest::new(credential_id, prf_input)
        .map_err(|error| JsError::new(&error.to_string()))?;
    let options = request_options_struct(rp_id, request.credential_id(), request.prf_input())?;
    to_browser_object(&options)
        .map(JsCast::unchecked_into)
        .map_err(|error| JsError::new(&format!("Failed to build passkey request options: {error}")))
}

pub(crate) fn recovery_options(rp_id: &str) -> Result<CredentialRequestOptions, JsError> {
    let prf_input = nook_core::deterministic_passkey_prf_input();
    let options = recovery_options_struct(rp_id, &prf_input)?;
    to_browser_object(&options)
        .map(JsCast::unchecked_into)
        .map_err(|error| {
            JsError::new(&format!(
                "Failed to build passkey recovery options: {error}"
            ))
        })
}

fn to_browser_object<T: Serialize>(value: &T) -> Result<js_sys::Object, serde_wasm_bindgen::Error> {
    let value =
        value.serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true))?;
    let value: js_sys::Object = value.unchecked_into();
    normalize_webauthn_binary_fields(&value)
        .map_err(|_| serde_wasm_bindgen::Error::new("Failed to normalize passkey binary fields"))?;
    Ok(value)
}

fn normalize_webauthn_binary_fields(value: &js_sys::Object) -> Result<(), JsError> {
    let public_key = get_required_object(value, "publicKey")?;
    set_uint8_array_field(&public_key, "challenge")?;
    normalize_creation_binary_fields(&public_key)?;
    normalize_request_binary_fields(&public_key)?;
    normalize_prf_binary_fields(&public_key)
}

fn normalize_creation_binary_fields(public_key: &js_sys::Object) -> Result<(), JsError> {
    if let Some(user) = get_optional_object(public_key, "user")? {
        set_uint8_array_field(&user, "id")?;
    }
    Ok(())
}

fn normalize_request_binary_fields(public_key: &js_sys::Object) -> Result<(), JsError> {
    let Some(allow_credentials) = get_optional_array(public_key, "allowCredentials")? else {
        return Ok(());
    };

    for credential in allow_credentials.iter() {
        let credential: js_sys::Object = credential.unchecked_into();
        set_uint8_array_field(&credential, "id")?;
    }
    Ok(())
}

fn normalize_prf_binary_fields(public_key: &js_sys::Object) -> Result<(), JsError> {
    let Some(extensions) = get_optional_object(public_key, "extensions")? else {
        return Ok(());
    };
    let Some(prf) = get_optional_object(&extensions, "prf")? else {
        return Ok(());
    };

    if let Some(values) = get_optional_object(&prf, "eval")? {
        set_prf_value_fields(&values)?;
    }

    if let Some(eval_by_credential) = get_optional_object(&prf, "evalByCredential")? {
        let keys = js_sys::Reflect::own_keys(&eval_by_credential)
            .map_err(|_| JsError::new("Failed to inspect passkey PRF evalByCredential entries"))?;
        for key in keys.iter() {
            let values = js_sys::Reflect::get(&eval_by_credential, &key)
                .map_err(|_| JsError::new("Failed to read passkey PRF evalByCredential entry"))?;
            let values: js_sys::Object = values.unchecked_into();
            set_prf_value_fields(&values)?;
        }
    }
    Ok(())
}

fn set_prf_value_fields(values: &js_sys::Object) -> Result<(), JsError> {
    set_uint8_array_field(values, "first")?;
    set_uint8_array_field(values, "second")
}

fn set_uint8_array_field(target: &js_sys::Object, field: &str) -> Result<(), JsError> {
    let Some(bytes) = get_optional_object(target, field)? else {
        return Ok(());
    };
    let typed_array = js_sys::Uint8Array::new(&bytes);
    js_sys::Reflect::set(target, &js_sys::JsString::from(field), typed_array.as_ref())
        .map_err(|_| JsError::new(&format!("Failed to normalize passkey binary field {field}")))?;
    Ok(())
}

fn creation_options_struct(
    rp_id: &str,
    rp_name: &str,
    passkey_label: &str,
    user_handle: &[u8],
    prf_input: &[u8],
) -> Result<PasskeyCreationOptions, JsError> {
    let passkey_label = normalized_passkey_label(passkey_label);
    Ok(PasskeyCreationOptions {
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

pub(crate) fn normalized_passkey_label(label: &str) -> String {
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

fn request_options_struct(
    rp_id: &str,
    credential_id: &[u8],
    prf_input: &[u8],
) -> Result<PasskeyRequestOptions, JsError> {
    let allow_credential = PublicKeyCredentialDescriptor {
        ty: PublicKeyCredentialType::PublicKey,
        id: credential_id.to_vec().into(),
        transports: None,
    };
    Ok(PasskeyRequestOptions {
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
) -> Result<PasskeyRequestOptions, JsError> {
    Ok(PasskeyRequestOptions {
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
    fill(&mut challenge)
        .map_err(|error| JsError::new(&format!("Failed to generate passkey challenge: {error}")))?;
    Ok(challenge)
}

fn base64_url(bytes: &[u8]) -> String {
    String::from(Bytes::from(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::de::DeserializeOwned;

    #[test]
    fn blank_passkey_labels_use_the_persisted_default_name() {
        assert_eq!(normalized_passkey_label("  "), DEFAULT_PASSKEY_LABEL);
        assert_eq!(normalized_passkey_label("  Personal Mac  "), "Personal Mac");
    }

    fn through_json<T>(value: &T) -> Result<T, JsError>
    where
        T: serde::Serialize + DeserializeOwned,
    {
        let json = serde_json::to_vec(value).map_err(|error| {
            JsError::new(&format!("Passkey fixture serialization failed: {error}"))
        })?;
        serde_json::from_slice(&json).map_err(|error| {
            JsError::new(&format!(
                "Passkey fixture typed deserialization failed: {error}"
            ))
        })
    }

    #[test]
    fn creation_options_use_passkey_prf_types() -> Result<(), JsError> {
        let value =
            creation_options_struct("localhost", "Nook", "Kitchen laptop", &[8; 32], &[9; 32])?;
        let options = through_json(&value)?;
        let public_key = options.public_key;

        assert_eq!(public_key.rp.id.as_deref(), Some("localhost"));
        assert_eq!(public_key.rp.name, "Nook");
        assert_eq!(public_key.user.name, "Kitchen laptop");
        assert_eq!(public_key.user.display_name, "Kitchen laptop");
        let algorithms = public_key
            .pub_key_cred_params
            .iter()
            .map(|parameter| parameter.alg)
            .collect::<Vec<_>>();
        assert!(algorithms.contains(&iana::Algorithm::ES256));
        assert!(algorithms.contains(&iana::Algorithm::RS256));
        let authenticator_selection = public_key
            .authenticator_selection
            .as_ref()
            .ok_or_else(|| JsError::new("Passkey authenticator selection is required"))?;
        assert_eq!(
            authenticator_selection.resident_key,
            Some(ResidentKeyRequirement::Required)
        );
        assert!(authenticator_selection.require_resident_key);
        assert_eq!(
            authenticator_selection.user_verification,
            UserVerificationRequirement::Required
        );
        assert_eq!(
            public_key.attestation,
            AttestationConveyancePreference::None
        );
        let extensions = public_key
            .extensions
            .as_ref()
            .ok_or_else(|| JsError::new("Passkey extensions are required"))?;
        let prf = extensions
            .prf
            .as_ref()
            .ok_or_else(|| JsError::new("Passkey PRF extension is required"))?;
        let eval = prf
            .eval
            .as_ref()
            .ok_or_else(|| JsError::new("Passkey PRF input is required"))?;
        assert_eq!(eval.first.len(), 32);
        Ok(())
    }

    #[test]
    fn blank_rp_id_uses_browser_origin_default() -> Result<(), JsError> {
        let creation =
            creation_options_struct("", "Nook", "Browser extension", &[8; 32], &[9; 32])?;
        let creation = through_json(&creation)?;
        assert!(matches!(&creation.public_key.rp.id, None));

        let request = request_options_struct("", &[7; 32], &[9; 32])?;
        let request = through_json(&request)?;
        assert!(matches!(&request.public_key.rp_id, None));

        let recovery = recovery_options_struct("", &[9; 32])?;
        let recovery = through_json(&recovery)?;
        assert!(matches!(&recovery.public_key.rp_id, None));
        Ok(())
    }

    #[test]
    fn request_options_key_prf_input_by_credential_id() -> Result<(), JsError> {
        let credential_id = [7u8; 32];
        let value = request_options_struct("localhost", &credential_id, &[9; 32])?;
        let options = through_json(&value)?;
        let public_key = options.public_key;
        let key = base64_url(&credential_id);

        assert_eq!(public_key.rp_id.as_deref(), Some("localhost"));
        let allowed_credentials = public_key
            .allow_credentials
            .as_ref()
            .ok_or_else(|| JsError::new("Allowed passkey credential is required"))?;
        let allowed_credential = allowed_credentials
            .first()
            .ok_or_else(|| JsError::new("Allowed passkey credential list must not be empty"))?;
        assert_eq!(allowed_credential.id.len(), 32);
        let extensions = public_key
            .extensions
            .as_ref()
            .ok_or_else(|| JsError::new("Passkey extensions are required"))?;
        let prf = extensions
            .prf
            .as_ref()
            .ok_or_else(|| JsError::new("Passkey PRF extension is required"))?;
        let eval_by_credential = prf
            .eval_by_credential
            .as_ref()
            .ok_or_else(|| JsError::new("Credential-specific PRF inputs are required"))?;
        let credential_prf = eval_by_credential
            .get(&key)
            .ok_or_else(|| JsError::new("Allowed credential PRF input is required"))?;
        assert_eq!(credential_prf.first.len(), 32);
        Ok(())
    }

    #[test]
    fn recovery_options_use_discoverable_credentials_and_global_prf_input() -> Result<(), JsError> {
        let value = recovery_options_struct("localhost", &[9; 32])?;
        let options = through_json(&value)?;
        let public_key = options.public_key;

        assert_eq!(public_key.rp_id.as_deref(), Some("localhost"));
        assert!(matches!(&public_key.allow_credentials, None));
        assert_eq!(
            public_key.user_verification,
            UserVerificationRequirement::Required
        );
        let extensions = public_key
            .extensions
            .as_ref()
            .ok_or_else(|| JsError::new("Recovery extensions are required"))?;
        let prf = extensions
            .prf
            .as_ref()
            .ok_or_else(|| JsError::new("Recovery PRF extension is required"))?;
        let eval = prf
            .eval
            .as_ref()
            .ok_or_else(|| JsError::new("Recovery PRF input is required"))?;
        assert_eq!(eval.first.len(), 32);
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use wasm_bindgen_test::*;

    fn get(target: &js_sys::Object, field: &str) -> Result<js_sys::Object, wasm_bindgen::JsError> {
        Ok(js_sys::Reflect::get(target, &js_sys::JsString::from(field))
            .map_err(|_| wasm_bindgen::JsError::new("failed to read reflected field"))?
            .unchecked_into())
    }

    fn get_string(target: &js_sys::Object, field: &str) -> Result<String, wasm_bindgen::JsError> {
        js_sys::Reflect::get(target, &js_sys::JsString::from(field))
            .map_err(|_| wasm_bindgen::JsError::new("failed to read reflected string field"))?
            .as_string()
            .ok_or_else(|| wasm_bindgen::JsError::new("field is not a string"))
    }

    fn assert_uint8_array(value: &js_sys::Object, expected_len: u32) {
        let bytes = js_sys::Uint8Array::new(value);
        assert_eq!(bytes.length(), expected_len);
        assert!(js_sys::ArrayBuffer::is_view(value));
    }

    #[wasm_bindgen_test]
    fn creation_options_serialize_webauthn_bytes_as_uint8_arrays()
    -> Result<(), wasm_bindgen::JsError> {
        let options = creation_options("localhost", "Nook", "Nook device", &[8; 32], &[9; 32])?;
        let public_key = get(&options, "publicKey")?;
        let user = get(&public_key, "user")?;
        let extensions = get(&public_key, "extensions")?;
        let prf = get(&extensions, "prf")?;
        let eval = get(&prf, "eval")?;

        assert_eq!(
            get_string(&user, "displayName")?,
            "Nook device - passkey 08080808...0808",
        );
        assert_uint8_array(&get(&public_key, "challenge")?, 32);
        assert_uint8_array(&get(&user, "id")?, 32);
        assert_uint8_array(&get(&eval, "first")?, 32);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn request_options_serialize_webauthn_bytes_as_uint8_arrays()
    -> Result<(), wasm_bindgen::JsError> {
        let credential_id = [7u8; 32];
        let options = request_options("localhost", &credential_id, &[9; 32])?;
        let public_key = get(&options, "publicKey")?;
        let credentials: js_sys::Array = get(&public_key, "allowCredentials")?.unchecked_into();
        let first_credential: js_sys::Object = credentials.get(0).unchecked_into();
        let extensions = get(&public_key, "extensions")?;
        let prf = get(&extensions, "prf")?;
        let eval_by_credential = get(&prf, "evalByCredential")?;
        let keyed_eval = get(&eval_by_credential, &base64_url(&credential_id))?;

        assert_uint8_array(&get(&public_key, "challenge")?, 32);
        assert_uint8_array(&get(&first_credential, "id")?, 32);
        assert_uint8_array(&get(&keyed_eval, "first")?, 32);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn recovery_options_serialize_webauthn_bytes_as_uint8_arrays()
    -> Result<(), wasm_bindgen::JsError> {
        let options = recovery_options("localhost")?;
        let public_key = get(&options, "publicKey")?;
        let extensions = get(&public_key, "extensions")?;
        let prf = get(&extensions, "prf")?;
        let eval = get(&prf, "eval")?;

        assert_uint8_array(&get(&public_key, "challenge")?, 32);
        assert_uint8_array(&get(&eval, "first")?, 32);
        Ok(())
    }
}
