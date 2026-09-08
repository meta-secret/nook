//! Browser `WebAuthn` option builders and credential ceremonies.
//!
//! `passkey-client` can model a `WebAuthn` client when Rust also owns the
//! authenticator. Browsers do not expose the platform passkey provider as a Rust
//! `Authenticator`, so this module calls `navigator.credentials.create/get`
//! through the browser JS API while keeping request shape, PRF extraction, and
//! passkey metadata parsing in Rust/WASM.

use js_sys::{JsString, Object, Promise, Reflect, Uint8Array};
use nook_core::DeviceId;
mod options;

pub(crate) use options::{
    creation_options, normalized_passkey_label, recovery_options, request_options,
};

use wasm_bindgen::{JsCast, JsError, JsValue};
use wasm_bindgen_futures::JsFuture;
use web_sys::{CredentialCreationOptions, CredentialRequestOptions, PublicKeyCredential};

pub(crate) const PASSKEY_PRF_UNAVAILABLE: &str = "PASSKEY_PRF_UNAVAILABLE";
pub(crate) const PASSKEY_UNAVAILABLE: &str = "PASSKEY_UNAVAILABLE";
pub(crate) const PASSKEY_CEREMONY_NOT_ALLOWED: &str = "PASSKEY_CEREMONY_NOT_ALLOWED";
pub(crate) const DEFAULT_PASSKEY_LABEL: &str = "Nook device";

pub(crate) async fn create_credential(
    options: &CredentialCreationOptions,
) -> Result<PublicKeyCredential, JsError> {
    require_passkey_support()?;
    let promise = gloo_utils::window()
        .navigator()
        .credentials()
        .create_with_options(options)
        .map_err(|error| credential_ceremony_error("create", &error.unchecked_into()))?;
    credential_from_promise("create", promise).await
}

pub(crate) async fn get_credential(
    options: &CredentialRequestOptions,
) -> Result<PublicKeyCredential, JsError> {
    require_passkey_support()?;
    let promise = gloo_utils::window()
        .navigator()
        .credentials()
        .get_with_options(options)
        .map_err(|error| credential_ceremony_error("get", &error.unchecked_into()))?;
    credential_from_promise("get", promise).await
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

pub(crate) fn credential_id(credential: &PublicKeyCredential) -> Result<Vec<u8>, JsError> {
    bytes_from_buffer(&credential.raw_id(), "passkey rawId")
}

pub(crate) fn passkey_label_with_device_id(passkey_label: &str, device_id: &str) -> String {
    let label = normalized_passkey_label(passkey_label);
    let device_id = DeviceId::parse(device_id).map_or_else(
        |_| device_id.trim().to_owned(),
        |id| nook_core::VaultRecoveryDevice::passkey_hint_for(&id),
    );
    format!("{label} - device {device_id}")
}

pub(crate) fn assertion_user_handle(credential: &PublicKeyCredential) -> Result<Vec<u8>, JsError> {
    // WebAuthn responses are structurally typed browser objects. Some valid
    // implementations (including browser-compatible test doubles) do not
    // inherit from the exposed `AuthenticatorAssertionResponse` constructor,
    // so an `instanceof`-based `dyn_into` rejects them. The recovery ceremony
    // guarantees an assertion response; keep the boundary typed while using
    // the generated structural getter for `userHandle`.
    let response: web_sys::AuthenticatorAssertionResponse = credential.response().unchecked_into();
    let user_handle = response
        .user_handle()
        .ok_or_else(|| JsError::new("Missing passkey userHandle"))?;
    bytes_from_buffer(&user_handle, "passkey userHandle")
}

pub(crate) fn prf_output(
    credential: &PublicKeyCredential,
    require_enabled: bool,
) -> Result<Option<Vec<u8>>, JsError> {
    let extension_results: js_sys::Object = credential.get_client_extension_results().into();
    let Some(prf) = get_optional_object(&extension_results, "prf")? else {
        if require_enabled {
            return Err(prf_unavailable(
                "This authenticator does not support the WebAuthn PRF extension required to protect device keys.",
            ));
        }
        return Ok(None);
    };
    if require_enabled && get_optional_bool(&prf, "enabled")? != Some(true) {
        return Err(prf_unavailable(
            "This authenticator does not support the WebAuthn PRF extension required to protect device keys.",
        ));
    }

    let Some(results) = get_optional_object(&prf, "results")? else {
        return Ok(None);
    };
    let Some(first) = get_optional_buffer(&results, "first")? else {
        return Ok(None);
    };
    Ok(Some(bytes_from_buffer(&first, "passkey PRF output")?))
}

pub(crate) fn require_prf_output(credential: &PublicKeyCredential) -> Result<Vec<u8>, JsError> {
    prf_output(credential, false)?
        .ok_or_else(|| prf_unavailable("The passkey did not return the required PRF output."))
}

pub(crate) fn prf_unavailable(message: &str) -> JsError {
    JsError::new(&format!("{PASSKEY_PRF_UNAVAILABLE}: {message}"))
}

fn require_passkey_support() -> Result<(), JsError> {
    let window = gloo_utils::window();
    if !window.is_secure_context() {
        return Err(JsError::new(
            "Passkeys require a secure context (HTTPS or localhost).",
        ));
    }

    if get_optional_object(&js_sys::global().unchecked_into(), "PublicKeyCredential")?.is_none() {
        return Err(passkey_unavailable(
            "Passkeys are not available in this browser.",
        ));
    }

    let navigator: js_sys::Object = window.navigator().into();
    if get_optional_object(&navigator, "credentials")?.is_none() {
        return Err(passkey_unavailable(
            "Passkeys are not available in this browser profile.",
        ));
    }
    Ok(())
}

async fn credential_from_promise(
    method: &str,
    promise: js_sys::Promise,
) -> Result<PublicKeyCredential, JsError> {
    let credential = JsFuture::from(promise)
        .await
        .map_err(|error| credential_ceremony_error(method, &error.unchecked_into()))?;
    credential
        .dyn_into()
        .map_err(|_| JsError::new(&format!("Passkey {method} ceremony was cancelled.")))
}

fn credential_ceremony_error(method: &str, error: &js_sys::Object) -> JsError {
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

fn js_error_text(error: &js_sys::Object, property: &str) -> Option<String> {
    Reflect::get(error, &JsString::from(property))
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
    let global: js_sys::Object = js_sys::global().unchecked_into();
    let Some(public_key_credential) = get_optional_object(&global, "PublicKeyCredential")? else {
        return Ok(());
    };

    let Some(method_value) =
        get_optional_object(&public_key_credential, "signalCurrentUserDetails")?
    else {
        return Ok(());
    };
    let method_fn: js_sys::Function = method_value.dyn_into().map_err(|_| {
        JsError::new("PublicKeyCredential.signalCurrentUserDetails is not callable")
    })?;

    let label = normalized_passkey_label(passkey_label);
    let details = Object::new();
    Reflect::set(
        details.as_ref(),
        &JsString::from("rpId"),
        &JsString::from(rp_id),
    )
    .map_err(|_| JsError::new("Failed to set passkey rpId detail"))?;
    Reflect::set(
        details.as_ref(),
        &JsString::from("userId"),
        Uint8Array::from(user_handle).as_ref(),
    )
    .map_err(|_| JsError::new("Failed to set passkey userId detail"))?;
    Reflect::set(
        details.as_ref(),
        &JsString::from("name"),
        &JsString::from(label.as_str()),
    )
    .map_err(|_| JsError::new("Failed to set passkey name detail"))?;
    Reflect::set(
        details.as_ref(),
        &JsString::from("displayName"),
        &JsString::from(label.as_str()),
    )
    .map_err(|_| JsError::new("Failed to set passkey displayName detail"))?;

    let promise = method_fn
        .call1(&public_key_credential, details.as_ref())
        .map_err(|_| JsError::new("Failed to signal updated passkey details"))?;
    JsFuture::from(Promise::from(promise))
        .await
        .map_err(|_| JsError::new("Updated passkey details were rejected"))?;
    Ok(())
}

fn bytes_from_buffer(value: &js_sys::ArrayBuffer, name: &str) -> Result<Vec<u8>, JsError> {
    let bytes = Uint8Array::new(value);
    if bytes.length() == 0 {
        return Err(JsError::new(&format!("Empty {name}")));
    }
    Ok(bytes.to_vec())
}

fn get_required_object(target: &js_sys::Object, field: &str) -> Result<js_sys::Object, JsError> {
    get_optional_object(target, field)?
        .ok_or_else(|| JsError::new(&format!("Missing required passkey option field {field}")))
}

fn get_optional_object(
    target: &js_sys::Object,
    field: &str,
) -> Result<Option<js_sys::Object>, JsError> {
    let value = Reflect::get(target, &JsString::from(field))
        .map_err(|_| JsError::new(&format!("Failed to read passkey option field {field}")))?;
    if value.is_undefined() || value.is_null() {
        Ok(None)
    } else {
        Ok(Some(value.unchecked_into()))
    }
}

fn get_optional_array(
    target: &js_sys::Object,
    field: &str,
) -> Result<Option<js_sys::Array>, JsError> {
    Ok(get_optional_object(target, field)?.map(JsCast::unchecked_into))
}

fn get_optional_buffer(
    target: &js_sys::Object,
    field: &str,
) -> Result<Option<js_sys::ArrayBuffer>, JsError> {
    Ok(get_optional_object(target, field)?.map(JsCast::unchecked_into))
}

fn get_optional_bool(target: &js_sys::Object, field: &str) -> Result<Option<bool>, JsError> {
    let value = Reflect::get(target, &JsString::from(field))
        .map_err(|_| JsError::new(&format!("Failed to read passkey option field {field}")))?;
    Ok(value.as_bool())
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
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

    #[wasm_bindgen_test]
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

    #[wasm_bindgen_test]
    fn ceremony_error_message_covers_partial_and_missing_browser_details() {
        assert_eq!(
            credential_ceremony_error_message("get", Some("AbortError"), None),
            "Passkey get ceremony failed (AbortError)."
        );
        assert_eq!(
            credential_ceremony_error_message("create", None, Some("cancelled")),
            "Passkey create ceremony failed (cancelled)."
        );
        assert_eq!(
            credential_ceremony_error_message("get", None, None),
            "Passkey get ceremony failed (unknown browser error)."
        );
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use js_sys::{ArrayBuffer, Reflect, Uint8Array};
    use wasm_bindgen::closure::Closure;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn js_error_message(error: JsError) -> String {
        JsValue::from(error)
            .dyn_into::<js_sys::Error>()
            .expect("JsError must remain a JavaScript Error")
            .message()
    }

    #[wasm_bindgen_test]
    fn browser_helpers_cover_binary_and_reflected_option_shapes() -> Result<(), JsError> {
        let empty = ArrayBuffer::new(0);
        let empty_error = bytes_from_buffer(&empty, "passkey rawId")
            .expect_err("empty browser buffers must be rejected");
        assert_eq!(js_error_message(empty_error), "Empty passkey rawId");

        let buffer = ArrayBuffer::new(3);
        let bytes = Uint8Array::new(&buffer);
        bytes.copy_from(&[4, 8, 15]);
        assert_eq!(bytes_from_buffer(&buffer, "passkey rawId")?, vec![4, 8, 15]);

        let target = Object::new();
        assert!(get_optional_object(&target, "missing")?.is_none());
        let null = js_sys::JSON::parse("null")
            .map_err(|_| JsError::new("failed to create null fixture"))?;
        Reflect::set(&target, &JsString::from("nullable"), &null)
            .map_err(|_| JsError::new("failed to set nullable fixture"))?;
        assert!(get_optional_object(&target, "nullable")?.is_none());
        assert!(get_required_object(&target, "missing").is_err());

        Reflect::set(&target, &JsString::from("array"), &js_sys::Array::new())
            .map_err(|_| JsError::new("failed to set array fixture"))?;
        assert!(get_optional_array(&target, "array")?.is_some());
        Reflect::set(&target, &JsString::from("buffer"), &buffer)
            .map_err(|_| JsError::new("failed to set buffer fixture"))?;
        assert!(get_optional_buffer(&target, "buffer")?.is_some());

        Reflect::set(
            &target,
            &JsString::from("enabled"),
            &js_sys::Boolean::from(true),
        )
        .map_err(|_| JsError::new("failed to set bool fixture"))?;
        assert_eq!(get_optional_bool(&target, "enabled")?, Some(true));
        Reflect::set(
            &target,
            &JsString::from("enabled"),
            &js_sys::Boolean::from(false),
        )
        .map_err(|_| JsError::new("failed to set bool fixture"))?;
        assert_eq!(get_optional_bool(&target, "enabled")?, Some(false));
        Reflect::set(&target, &JsString::from("enabled"), &JsString::from("true"))
            .map_err(|_| JsError::new("failed to set string fixture"))?;
        assert_eq!(get_optional_bool(&target, "enabled")?, None);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn browser_helpers_project_labels_and_browser_error_details() -> Result<(), JsError> {
        assert_eq!(
            passkey_label_with_device_id("  Laptop  ", "0123456789abcdef")
                .strip_prefix("Laptop - device ")
                .map(str::to_owned),
            Some("0123456789abcdef".to_owned())
        );
        assert_eq!(
            passkey_label_with_device_id(" ", "invalid device id"),
            "Nook device - device invalid device id"
        );

        let error = Object::new();
        Reflect::set(
            &error,
            &JsString::from("name"),
            &JsString::from("AbortError"),
        )
        .map_err(|_| JsError::new("failed to set error name"))?;
        Reflect::set(
            &error,
            &JsString::from("message"),
            &JsString::from("cancelled"),
        )
        .map_err(|_| JsError::new("failed to set error message"))?;
        let converted = credential_ceremony_error("get", &error);
        assert_eq!(
            js_error_message(converted),
            "Passkey get ceremony failed (AbortError: cancelled)."
        );

        Reflect::set(&error, &JsString::from("message"), &JsString::from("  "))
            .map_err(|_| JsError::new("failed to set blank error message"))?;
        assert_eq!(js_error_text(&error, "message"), None);
        Reflect::set(
            &error,
            &JsString::from("name"),
            &JsString::from("NotAllowedError"),
        )
        .map_err(|_| JsError::new("failed to set not-allowed error name"))?;
        assert_eq!(
            js_error_message(credential_ceremony_error("create", &error)),
            format!("{PASSKEY_CEREMONY_NOT_ALLOWED}: Passkey create request did not finish.")
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn prf_projection_distinguishes_absent_disabled_empty_and_present_results()
    -> Result<(), JsError> {
        let extension_results = Object::new();
        let credential_object = Object::new();
        let callback = Closure::<dyn FnMut() -> Object>::new({
            let extension_results = extension_results.clone();
            move || extension_results.clone()
        });
        Reflect::set(
            &credential_object,
            &JsString::from("getClientExtensionResults"),
            callback.as_ref(),
        )
        .map_err(|_| JsError::new("failed to set extension result callback"))?;
        let credential: PublicKeyCredential = credential_object.unchecked_into();

        assert_eq!(prf_output(&credential, false)?, None);
        assert!(prf_output(&credential, true).is_err());

        let prf = Object::new();
        Reflect::set(&extension_results, &JsString::from("prf"), &prf)
            .map_err(|_| JsError::new("failed to set PRF object"))?;
        assert_eq!(prf_output(&credential, false)?, None);
        Reflect::set(
            &prf,
            &JsString::from("enabled"),
            &js_sys::Boolean::from(false),
        )
        .map_err(|_| JsError::new("failed to set disabled PRF"))?;
        assert!(prf_output(&credential, true).is_err());

        let results = Object::new();
        Reflect::set(
            &prf,
            &JsString::from("enabled"),
            &js_sys::Boolean::from(true),
        )
        .map_err(|_| JsError::new("failed to set enabled PRF"))?;
        Reflect::set(&prf, &JsString::from("results"), &results)
            .map_err(|_| JsError::new("failed to set PRF results"))?;
        assert_eq!(prf_output(&credential, true)?, None);

        let buffer = ArrayBuffer::new(2);
        Uint8Array::new(&buffer).copy_from(&[3, 5]);
        Reflect::set(&results, &JsString::from("first"), &buffer)
            .map_err(|_| JsError::new("failed to set PRF output"))?;
        assert_eq!(prf_output(&credential, true)?, Some(vec![3, 5]));
        assert_eq!(require_prf_output(&credential)?, vec![3, 5]);
        drop(callback);
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn promise_credential_conversion_reports_rejection_and_cancellation() {
        let plain_object: JsValue = Object::new().into();
        let cancelled = credential_from_promise("get", Promise::resolve(&plain_object))
            .await
            .expect_err("plain objects are not credentials");
        assert_eq!(
            js_error_message(cancelled),
            "Passkey get ceremony was cancelled."
        );

        let rejection = Object::new();
        Reflect::set(
            &rejection,
            &JsString::from("name"),
            &JsString::from("NotAllowedError"),
        )
        .expect("set rejection name");
        let rejected = credential_from_promise("create", Promise::reject(&rejection))
            .await
            .expect_err("rejected browser promises must remain errors");
        assert_eq!(
            js_error_message(rejected),
            format!("{PASSKEY_CEREMONY_NOT_ALLOWED}: Passkey create request did not finish.")
        );
    }
}
