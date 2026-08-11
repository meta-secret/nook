//! Browser `WebAuthn` option builders and credential ceremonies.
//!
//! `passkey-client` can model a `WebAuthn` client when Rust also owns the
//! authenticator. Browsers do not expose the platform passkey provider as a Rust
//! `Authenticator`, so this module calls `navigator.credentials.create/get`
//! through the browser JS API while keeping request shape, PRF extraction, and
//! passkey metadata parsing in Rust/WASM.

mod options;

pub(crate) use options::{
    creation_options, normalized_passkey_label, recovery_options, request_options,
};

use wasm_bindgen::{JsCast, JsError};
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
    let device_id = nook_core::DeviceId::parse(device_id).map_or_else(
        |_| device_id.trim().to_owned(),
        |id| nook_core::recovery_device_id_hint(&id),
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
    js_sys::Reflect::get(error, &js_sys::JsString::from(property))
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
    let details = js_sys::Object::new();
    js_sys::Reflect::set(
        details.as_ref(),
        &js_sys::JsString::from("rpId"),
        &js_sys::JsString::from(rp_id),
    )
    .map_err(|_| JsError::new("Failed to set passkey rpId detail"))?;
    js_sys::Reflect::set(
        details.as_ref(),
        &js_sys::JsString::from("userId"),
        js_sys::Uint8Array::from(user_handle).as_ref(),
    )
    .map_err(|_| JsError::new("Failed to set passkey userId detail"))?;
    js_sys::Reflect::set(
        details.as_ref(),
        &js_sys::JsString::from("name"),
        &js_sys::JsString::from(label.as_str()),
    )
    .map_err(|_| JsError::new("Failed to set passkey name detail"))?;
    js_sys::Reflect::set(
        details.as_ref(),
        &js_sys::JsString::from("displayName"),
        &js_sys::JsString::from(label.as_str()),
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

fn bytes_from_buffer(value: &js_sys::ArrayBuffer, name: &str) -> Result<Vec<u8>, JsError> {
    let bytes = js_sys::Uint8Array::new(value);
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
    let value = js_sys::Reflect::get(target, &js_sys::JsString::from(field))
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
    let value = js_sys::Reflect::get(target, &js_sys::JsString::from(field))
        .map_err(|_| JsError::new(&format!("Failed to read passkey option field {field}")))?;
    Ok(value.as_bool())
}

#[cfg(test)]
mod tests {
    use super::*;

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
