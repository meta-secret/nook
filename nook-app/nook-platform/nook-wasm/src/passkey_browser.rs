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
mod prf;
pub(crate) use prf::*;

use wasm_bindgen::{JsCast, JsError};
use wasm_bindgen_futures::JsFuture;
use web_sys::{CredentialCreationOptions, CredentialRequestOptions, PublicKeyCredential};

/// Browser property reports retain undefined versus explicit null at the JS edge.
pub(crate) enum BrowserObjectProperty {
    Undefined,
    Null,
    Reported(Object),
}
pub(crate) enum BrowserArrayProperty {
    Undefined,
    Null,
    Reported(js_sys::Array),
}
pub(crate) enum BrowserBufferProperty {
    Undefined,
    Null,
    Reported(js_sys::ArrayBuffer),
}
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum BrowserBooleanProperty {
    Unreported,
    Enabled,
    Disabled,
}
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum BrowserErrorText {
    Unreported,
    Reported(String),
}
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum BrowserErrorDetail<'a> {
    Unreported,
    Reported(&'a str),
}
impl BrowserErrorText {
    fn detail(&self) -> BrowserErrorDetail<'_> {
        match self {
            Self::Unreported => BrowserErrorDetail::Unreported,
            Self::Reported(value) => BrowserErrorDetail::Reported(value),
        }
    }
}

/// Browser capability admitted by secure-context and `WebAuthn` support checks.
pub(crate) struct BrowserPasskeyClient {
    window: web_sys::Window,
}
pub(crate) const PASSKEY_PRF_UNAVAILABLE: &str = "PASSKEY_PRF_UNAVAILABLE";
pub(crate) const PASSKEY_UNAVAILABLE: &str = "PASSKEY_UNAVAILABLE";
pub(crate) const PASSKEY_CEREMONY_NOT_ALLOWED: &str = "PASSKEY_CEREMONY_NOT_ALLOWED";
pub(crate) const DEFAULT_PASSKEY_LABEL: &str = "Nook device";

/// Named values required by `BrowserPasskeyClient::signal_current_user_details`.
pub(crate) struct BrowserPasskeySignalCurrentUserDetails<'a> {
    pub(crate) rp_id: &'a str,
    pub(crate) user_handle: &'a [u8],
    pub(crate) passkey_label: &'a str,
}

/// Named values required by `BrowserPasskeyClient::passkey_label_with_device_id`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserPasskeyPasskeyLabelWithDeviceId<'a> {
    pub(crate) passkey_label: &'a str,
    pub(crate) device_id: &'a str,
}

/// Named values required by `BrowserPasskeyClient::credential_from_promise`.
pub(crate) struct BrowserPasskeyCredentialFromPromise<'a> {
    pub(crate) method: &'a str,
    pub(crate) promise: js_sys::Promise,
}

/// Named values required by `BrowserPasskeyClient::credential_ceremony_error`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserPasskeyCredentialCeremonyError<'a> {
    pub(crate) method: &'a str,
    pub(crate) error: &'a js_sys::Object,
}

/// Named values required by `BrowserPasskeyClient::credential_ceremony_error_message`.
pub(crate) struct BrowserPasskeyCredentialCeremonyErrorMessage<'a> {
    pub(crate) method: &'a str,
    pub(crate) name: BrowserErrorDetail<'a>,
    pub(crate) message: BrowserErrorDetail<'a>,
}

/// Named values required by `BrowserPasskeyClient::js_error_text`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserPasskeyJsErrorText<'a> {
    pub(crate) error: &'a js_sys::Object,
    pub(crate) property: &'a str,
}

/// Named values required by `BrowserPasskeyClient::try_signal_current_user_details`.
pub(crate) struct BrowserPasskeyTrySignalCurrentUserDetails<'a> {
    pub(crate) rp_id: &'a str,
    pub(crate) user_handle: &'a [u8],
    pub(crate) passkey_label: &'a str,
}

/// Named values required by `BrowserPasskeyClient::bytes_from_buffer`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserPasskeyBytesFromBuffer<'a> {
    pub(crate) value: &'a js_sys::ArrayBuffer,
    pub(crate) name: &'a str,
}

/// Named values required by `BrowserPasskeyClient::get_required_object`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserPasskeyGetRequiredObject<'a> {
    pub(crate) target: &'a js_sys::Object,
    pub(crate) field: &'a str,
}

/// Named values required by `BrowserPasskeyClient::get_optional_object`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserPasskeyGetOptionalObject<'a> {
    pub(crate) target: &'a js_sys::Object,
    pub(crate) field: &'a str,
}

/// Named values required by `BrowserPasskeyClient::get_optional_array`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserPasskeyGetOptionalArray<'a> {
    pub(crate) target: &'a js_sys::Object,
    pub(crate) field: &'a str,
}

/// Named values required by `BrowserPasskeyClient::get_optional_buffer`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserPasskeyGetOptionalBuffer<'a> {
    pub(crate) target: &'a js_sys::Object,
    pub(crate) field: &'a str,
}

/// Named values required by `BrowserPasskeyClient::get_optional_bool`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserPasskeyGetOptionalBool<'a> {
    pub(crate) target: &'a js_sys::Object,
    pub(crate) field: &'a str,
}

impl BrowserPasskeyClient {
    pub(crate) async fn create_credential(
        options: &CredentialCreationOptions,
    ) -> Result<PublicKeyCredential, JsError> {
        let client = BrowserPasskeyClient::require_passkey_support()?;
        let promise = client
            .window
            .navigator()
            .credentials()
            .create_with_options(options)
            .map_err(|error| {
                BrowserPasskeyClient::credential_ceremony_error(
                    BrowserPasskeyCredentialCeremonyError {
                        method: "create",
                        error: &error.unchecked_into(),
                    },
                )
            })?;
        BrowserPasskeyClient::credential_from_promise(BrowserPasskeyCredentialFromPromise {
            method: "create",
            promise,
        })
        .await
    }
}

impl BrowserPasskeyClient {
    pub(crate) async fn get_credential(
        options: &CredentialRequestOptions,
    ) -> Result<PublicKeyCredential, JsError> {
        let client = BrowserPasskeyClient::require_passkey_support()?;
        let promise = client
            .window
            .navigator()
            .credentials()
            .get_with_options(options)
            .map_err(|error| {
                BrowserPasskeyClient::credential_ceremony_error(
                    BrowserPasskeyCredentialCeremonyError {
                        method: "get",
                        error: &error.unchecked_into(),
                    },
                )
            })?;
        BrowserPasskeyClient::credential_from_promise(BrowserPasskeyCredentialFromPromise {
            method: "get",
            promise,
        })
        .await
    }
}

impl BrowserPasskeyClient {
    pub(crate) async fn signal_current_user_details(
        request: BrowserPasskeySignalCurrentUserDetails<'_>,
    ) {
        let BrowserPasskeySignalCurrentUserDetails {
            rp_id,
            user_handle,
            passkey_label,
        } = request;
        if rp_id.trim().is_empty() {
            return;
        }
        let _ = BrowserPasskeyClient::try_signal_current_user_details(
            BrowserPasskeyTrySignalCurrentUserDetails {
                rp_id,
                user_handle,
                passkey_label,
            },
        )
        .await;
    }
}

impl BrowserPasskeyClient {
    pub(crate) fn credential_id(credential: &PublicKeyCredential) -> Result<Vec<u8>, JsError> {
        BrowserPasskeyClient::bytes_from_buffer(BrowserPasskeyBytesFromBuffer {
            value: &credential.raw_id(),
            name: "passkey rawId",
        })
    }
}

impl BrowserPasskeyClient {
    pub(crate) fn passkey_label_with_device_id(
        request: BrowserPasskeyPasskeyLabelWithDeviceId<'_>,
    ) -> String {
        let BrowserPasskeyPasskeyLabelWithDeviceId {
            passkey_label,
            device_id,
        } = request;
        let label = BrowserPasskeyClient::normalized_passkey_label(passkey_label);
        let device_id = DeviceId::parse(device_id).map_or_else(
            |_| device_id.trim().to_owned(),
            |id| nook_core::VaultRecoveryDevice::passkey_hint_for(&id),
        );
        format!("{label} - device {device_id}")
    }
}

impl BrowserPasskeyClient {
    pub(crate) fn assertion_user_handle(
        credential: &PublicKeyCredential,
    ) -> Result<Vec<u8>, JsError> {
        // WebAuthn responses are structurally typed browser objects. Some valid
        // implementations (including browser-compatible test doubles) do not
        // inherit from the exposed `AuthenticatorAssertionResponse` constructor,
        // so an `instanceof`-based `dyn_into` rejects them. The recovery ceremony
        // guarantees an assertion response; keep the boundary typed while using
        // the generated structural getter for `userHandle`.
        let response: web_sys::AuthenticatorAssertionResponse =
            credential.response().unchecked_into();
        let user_handle = response
            .user_handle()
            .ok_or_else(|| JsError::new("Missing passkey userHandle"))?;
        BrowserPasskeyClient::bytes_from_buffer(BrowserPasskeyBytesFromBuffer {
            value: &user_handle,
            name: "passkey userHandle",
        })
    }
}

impl BrowserPasskeyClient {
    fn require_passkey_support() -> Result<BrowserPasskeyClient, JsError> {
        let window = gloo_utils::window();
        if !window.is_secure_context() {
            return Err(JsError::new(
                "Passkeys require a secure context (HTTPS or localhost).",
            ));
        }

        if !matches!(
            BrowserPasskeyClient::get_optional_object(BrowserPasskeyGetOptionalObject {
                target: &js_sys::global().unchecked_into(),
                field: "PublicKeyCredential",
            })?,
            BrowserObjectProperty::Reported(_)
        ) {
            return Err(BrowserPasskeyClient::passkey_unavailable(
                "Passkeys are not available in this browser.",
            ));
        }

        let navigator: js_sys::Object = window.navigator().into();
        if !matches!(
            BrowserPasskeyClient::get_optional_object(BrowserPasskeyGetOptionalObject {
                target: &navigator,
                field: "credentials",
            })?,
            BrowserObjectProperty::Reported(_)
        ) {
            return Err(BrowserPasskeyClient::passkey_unavailable(
                "Passkeys are not available in this browser profile.",
            ));
        }
        Ok(BrowserPasskeyClient { window })
    }
}

impl BrowserPasskeyClient {
    async fn credential_from_promise(
        request: BrowserPasskeyCredentialFromPromise<'_>,
    ) -> Result<PublicKeyCredential, JsError> {
        let BrowserPasskeyCredentialFromPromise { method, promise } = request;
        let credential = JsFuture::from(promise).await.map_err(|error| {
            BrowserPasskeyClient::credential_ceremony_error(BrowserPasskeyCredentialCeremonyError {
                method,
                error: &error.unchecked_into(),
            })
        })?;
        credential
            .dyn_into()
            .map_err(|_| JsError::new(&format!("Passkey {method} ceremony was cancelled.")))
    }
}

impl BrowserPasskeyClient {
    fn credential_ceremony_error(request: BrowserPasskeyCredentialCeremonyError<'_>) -> JsError {
        let BrowserPasskeyCredentialCeremonyError { method, error } = request;
        let name = BrowserPasskeyClient::js_error_text(BrowserPasskeyJsErrorText {
            error,
            property: "name",
        });
        let message = BrowserPasskeyClient::js_error_text(BrowserPasskeyJsErrorText {
            error,
            property: "message",
        });
        JsError::new(&BrowserPasskeyClient::credential_ceremony_error_message(
            BrowserPasskeyCredentialCeremonyErrorMessage {
                method,
                name: name.detail(),
                message: message.detail(),
            },
        ))
    }
}

impl BrowserPasskeyClient {
    fn credential_ceremony_error_message(
        request: BrowserPasskeyCredentialCeremonyErrorMessage<'_>,
    ) -> String {
        let BrowserPasskeyCredentialCeremonyErrorMessage {
            method,
            name,
            message,
        } = request;
        // WebAuthn intentionally uses NotAllowedError for multiple
        // privacy-sensitive outcomes, including cancellation, timeout, policy
        // refusal, and an unavailable credential. Preserve that ambiguity as a
        // typed result so presentation layers can explain it without guessing.
        if name == BrowserErrorDetail::Reported("NotAllowedError") {
            return format!(
                "{PASSKEY_CEREMONY_NOT_ALLOWED}: Passkey {method} request did not finish."
            );
        }

        let detail = match (name, message) {
            (BrowserErrorDetail::Reported(name), BrowserErrorDetail::Reported(message)) => {
                format!("{name}: {message}")
            }
            (BrowserErrorDetail::Reported(name), BrowserErrorDetail::Unreported) => name.to_owned(),
            (BrowserErrorDetail::Unreported, BrowserErrorDetail::Reported(message)) => {
                message.to_owned()
            }
            (BrowserErrorDetail::Unreported, BrowserErrorDetail::Unreported) => {
                "unknown browser error".to_owned()
            }
        };

        format!("Passkey {method} ceremony failed ({detail}).")
    }
}

impl BrowserPasskeyClient {
    fn js_error_text(request: BrowserPasskeyJsErrorText<'_>) -> BrowserErrorText {
        let BrowserPasskeyJsErrorText { error, property } = request;
        match Reflect::get(error, &JsString::from(property))
            .ok()
            .and_then(|value| value.as_string())
        {
            Some(value) if !value.trim().is_empty() => BrowserErrorText::Reported(value),
            _ => BrowserErrorText::Unreported,
        }
    }
}

impl BrowserPasskeyClient {
    fn passkey_unavailable(message: &str) -> JsError {
        JsError::new(&format!("{PASSKEY_UNAVAILABLE}: {message}"))
    }
}

impl BrowserPasskeyClient {
    async fn try_signal_current_user_details(
        request: BrowserPasskeyTrySignalCurrentUserDetails<'_>,
    ) -> Result<(), JsError> {
        let BrowserPasskeyTrySignalCurrentUserDetails {
            rp_id,
            user_handle,
            passkey_label,
        } = request;
        let global: js_sys::Object = js_sys::global().unchecked_into();
        let BrowserObjectProperty::Reported(public_key_credential) =
            BrowserPasskeyClient::get_optional_object(BrowserPasskeyGetOptionalObject {
                target: &global,
                field: "PublicKeyCredential",
            })?
        else {
            return Ok(());
        };

        let BrowserObjectProperty::Reported(method_value) =
            BrowserPasskeyClient::get_optional_object(BrowserPasskeyGetOptionalObject {
                target: &public_key_credential,
                field: "signalCurrentUserDetails",
            })?
        else {
            return Ok(());
        };
        let method_fn: js_sys::Function = method_value.dyn_into().map_err(|_| {
            JsError::new("PublicKeyCredential.signalCurrentUserDetails is not callable")
        })?;

        let label = BrowserPasskeyClient::normalized_passkey_label(passkey_label);
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
}

impl BrowserPasskeyClient {
    fn bytes_from_buffer(request: BrowserPasskeyBytesFromBuffer<'_>) -> Result<Vec<u8>, JsError> {
        let BrowserPasskeyBytesFromBuffer { value, name } = request;
        let bytes = Uint8Array::new(value);
        if bytes.length() == 0 {
            return Err(JsError::new(&format!("Empty {name}")));
        }
        Ok(bytes.to_vec())
    }
}

impl BrowserPasskeyClient {
    fn get_required_object(
        request: BrowserPasskeyGetRequiredObject<'_>,
    ) -> Result<Object, JsError> {
        let BrowserPasskeyGetRequiredObject { target, field } = request;
        match BrowserPasskeyClient::get_optional_object(BrowserPasskeyGetOptionalObject {
            target,
            field,
        })? {
            BrowserObjectProperty::Reported(value) => Ok(value),
            BrowserObjectProperty::Undefined | BrowserObjectProperty::Null => Err(JsError::new(
                &format!("Missing required passkey option field {field}"),
            )),
        }
    }
}
impl BrowserPasskeyClient {
    fn get_optional_object(
        request: BrowserPasskeyGetOptionalObject<'_>,
    ) -> Result<BrowserObjectProperty, JsError> {
        let BrowserPasskeyGetOptionalObject { target, field } = request;
        let value = Reflect::get(target, &JsString::from(field))
            .map_err(|_| JsError::new(&format!("Failed to read passkey option field {field}")))?;
        if value.is_undefined() {
            Ok(BrowserObjectProperty::Undefined)
        } else if value.is_null() {
            Ok(BrowserObjectProperty::Null)
        } else {
            Ok(BrowserObjectProperty::Reported(value.unchecked_into()))
        }
    }
}
impl BrowserPasskeyClient {
    fn get_optional_array(
        request: BrowserPasskeyGetOptionalArray<'_>,
    ) -> Result<BrowserArrayProperty, JsError> {
        let BrowserPasskeyGetOptionalArray { target, field } = request;
        Ok(
            match BrowserPasskeyClient::get_optional_object(BrowserPasskeyGetOptionalObject {
                target,
                field,
            })? {
                BrowserObjectProperty::Undefined => BrowserArrayProperty::Undefined,
                BrowserObjectProperty::Null => BrowserArrayProperty::Null,
                BrowserObjectProperty::Reported(value) => {
                    BrowserArrayProperty::Reported(value.unchecked_into())
                }
            },
        )
    }
}
impl BrowserPasskeyClient {
    fn get_optional_buffer(
        request: BrowserPasskeyGetOptionalBuffer<'_>,
    ) -> Result<BrowserBufferProperty, JsError> {
        let BrowserPasskeyGetOptionalBuffer { target, field } = request;
        Ok(
            match BrowserPasskeyClient::get_optional_object(BrowserPasskeyGetOptionalObject {
                target,
                field,
            })? {
                BrowserObjectProperty::Undefined => BrowserBufferProperty::Undefined,
                BrowserObjectProperty::Null => BrowserBufferProperty::Null,
                BrowserObjectProperty::Reported(value) => {
                    BrowserBufferProperty::Reported(value.unchecked_into())
                }
            },
        )
    }
}
impl BrowserPasskeyClient {
    fn get_optional_bool(
        request: BrowserPasskeyGetOptionalBool<'_>,
    ) -> Result<BrowserBooleanProperty, JsError> {
        let BrowserPasskeyGetOptionalBool { target, field } = request;
        let value = Reflect::get(target, &JsString::from(field))
            .map_err(|_| JsError::new(&format!("Failed to read passkey option field {field}")))?;
        Ok(match value.as_bool() {
            Some(true) => BrowserBooleanProperty::Enabled,
            Some(false) => BrowserBooleanProperty::Disabled,
            None => BrowserBooleanProperty::Unreported,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn not_allowed_ceremony_is_classified_without_claiming_an_exact_cause() {
        assert_eq!(
            BrowserPasskeyClient::credential_ceremony_error_message(
                BrowserPasskeyCredentialCeremonyErrorMessage {
                    method: "get",
                    name: BrowserErrorDetail::Reported("NotAllowedError"),
                    message: BrowserErrorDetail::Reported(
                        "The operation either timed out or was not allowed."
                    )
                }
            ),
            format!("{PASSKEY_CEREMONY_NOT_ALLOWED}: Passkey get request did not finish.")
        );
    }

    #[wasm_bindgen_test]
    fn other_ceremony_errors_keep_the_browser_detail() {
        assert_eq!(
            BrowserPasskeyClient::credential_ceremony_error_message(
                BrowserPasskeyCredentialCeremonyErrorMessage {
                    method: "create",
                    name: BrowserErrorDetail::Reported("SecurityError"),
                    message: BrowserErrorDetail::Reported("This is an invalid domain.")
                }
            ),
            "Passkey create ceremony failed (SecurityError: This is an invalid domain.)."
        );
    }

    #[wasm_bindgen_test]
    fn ceremony_error_message_covers_partial_and_missing_browser_details() {
        assert_eq!(
            BrowserPasskeyClient::credential_ceremony_error_message(
                BrowserPasskeyCredentialCeremonyErrorMessage {
                    method: "get",
                    name: BrowserErrorDetail::Reported("AbortError"),
                    message: BrowserErrorDetail::Unreported
                }
            ),
            "Passkey get ceremony failed (AbortError)."
        );
        assert_eq!(
            BrowserPasskeyClient::credential_ceremony_error_message(
                BrowserPasskeyCredentialCeremonyErrorMessage {
                    method: "create",
                    name: BrowserErrorDetail::Unreported,
                    message: BrowserErrorDetail::Reported("cancelled")
                }
            ),
            "Passkey create ceremony failed (cancelled)."
        );
        assert_eq!(
            BrowserPasskeyClient::credential_ceremony_error_message(
                BrowserPasskeyCredentialCeremonyErrorMessage {
                    method: "get",
                    name: BrowserErrorDetail::Unreported,
                    message: BrowserErrorDetail::Unreported
                }
            ),
            "Passkey get ceremony failed (unknown browser error)."
        );
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use js_sys::{ArrayBuffer, Reflect, Uint8Array};
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn js_error_message(error: JsError) -> String {
        Reflect::get(&error.into(), &JsString::from("message"))
            .expect("JsError must remain a JavaScript Error")
            .as_string()
            .expect("JsError message must remain a string")
    }

    #[wasm_bindgen_test]
    fn browser_helpers_cover_binary_and_reflected_option_shapes() -> Result<(), JsError> {
        let empty = ArrayBuffer::new(0);
        let empty_error = BrowserPasskeyClient::bytes_from_buffer(BrowserPasskeyBytesFromBuffer {
            value: &empty,
            name: "passkey rawId",
        })
        .expect_err("empty browser buffers must be rejected");
        assert_eq!(js_error_message(empty_error), "Empty passkey rawId");

        let buffer = ArrayBuffer::new(3);
        let bytes = Uint8Array::new(&buffer);
        bytes.copy_from(&[4, 8, 15]);
        assert_eq!(
            BrowserPasskeyClient::bytes_from_buffer(BrowserPasskeyBytesFromBuffer {
                value: &buffer,
                name: "passkey rawId"
            })?,
            vec![4, 8, 15]
        );

        let target = Object::new();
        assert!(!matches!(
            BrowserPasskeyClient::get_optional_object(BrowserPasskeyGetOptionalObject {
                target: &target,
                field: "missing"
            })?,
            BrowserObjectProperty::Reported(_)
        ));
        let null = js_sys::JSON::parse("null")
            .map_err(|_| JsError::new("failed to create null fixture"))?;
        Reflect::set(&target, &JsString::from("nullable"), &null)
            .map_err(|_| JsError::new("failed to set nullable fixture"))?;
        assert!(!matches!(
            BrowserPasskeyClient::get_optional_object(BrowserPasskeyGetOptionalObject {
                target: &target,
                field: "nullable"
            })?,
            BrowserObjectProperty::Reported(_)
        ));
        assert!(
            BrowserPasskeyClient::get_required_object(BrowserPasskeyGetRequiredObject {
                target: &target,
                field: "missing"
            })
            .is_err()
        );

        Reflect::set(&target, &JsString::from("array"), &js_sys::Array::new())
            .map_err(|_| JsError::new("failed to set array fixture"))?;
        assert!(matches!(
            BrowserPasskeyClient::get_optional_array(BrowserPasskeyGetOptionalArray {
                target: &target,
                field: "array"
            })?,
            BrowserArrayProperty::Reported(_)
        ));
        Reflect::set(&target, &JsString::from("buffer"), &buffer)
            .map_err(|_| JsError::new("failed to set buffer fixture"))?;
        assert!(matches!(
            BrowserPasskeyClient::get_optional_buffer(BrowserPasskeyGetOptionalBuffer {
                target: &target,
                field: "buffer"
            })?,
            BrowserBufferProperty::Reported(_)
        ));

        Reflect::set(
            &target,
            &JsString::from("enabled"),
            &js_sys::Boolean::from(true),
        )
        .map_err(|_| JsError::new("failed to set bool fixture"))?;
        assert_eq!(
            BrowserPasskeyClient::get_optional_bool(BrowserPasskeyGetOptionalBool {
                target: &target,
                field: "enabled"
            })?,
            BrowserBooleanProperty::Enabled
        );
        Reflect::set(
            &target,
            &JsString::from("enabled"),
            &js_sys::Boolean::from(false),
        )
        .map_err(|_| JsError::new("failed to set bool fixture"))?;
        assert_eq!(
            BrowserPasskeyClient::get_optional_bool(BrowserPasskeyGetOptionalBool {
                target: &target,
                field: "enabled"
            })?,
            BrowserBooleanProperty::Disabled
        );
        Reflect::set(&target, &JsString::from("enabled"), &JsString::from("true"))
            .map_err(|_| JsError::new("failed to set string fixture"))?;
        assert_eq!(
            BrowserPasskeyClient::get_optional_bool(BrowserPasskeyGetOptionalBool {
                target: &target,
                field: "enabled"
            })?,
            BrowserBooleanProperty::Unreported
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn browser_helpers_project_labels_and_browser_error_details() -> Result<(), JsError> {
        assert_eq!(
            BrowserPasskeyClient::passkey_label_with_device_id(
                BrowserPasskeyPasskeyLabelWithDeviceId {
                    passkey_label: "  Laptop  ",
                    device_id: "0123456789abcdef"
                }
            )
            .strip_prefix("Laptop - device ")
            .map(str::to_owned),
            Some("012345...cdef".to_owned())
        );
        assert_eq!(
            BrowserPasskeyClient::passkey_label_with_device_id(
                BrowserPasskeyPasskeyLabelWithDeviceId {
                    passkey_label: " ",
                    device_id: "invalid device id"
                }
            ),
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
        let converted = BrowserPasskeyClient::credential_ceremony_error(
            BrowserPasskeyCredentialCeremonyError {
                method: "get",
                error: &error,
            },
        );
        assert_eq!(
            js_error_message(converted),
            "Passkey get ceremony failed (AbortError: cancelled)."
        );

        Reflect::set(&error, &JsString::from("message"), &JsString::from("  "))
            .map_err(|_| JsError::new("failed to set blank error message"))?;
        assert_eq!(
            BrowserPasskeyClient::js_error_text(BrowserPasskeyJsErrorText {
                error: &error,
                property: "message"
            }),
            BrowserErrorText::Unreported
        );
        Reflect::set(
            &error,
            &JsString::from("name"),
            &JsString::from("NotAllowedError"),
        )
        .map_err(|_| JsError::new("failed to set not-allowed error name"))?;
        assert_eq!(
            js_error_message(BrowserPasskeyClient::credential_ceremony_error(
                BrowserPasskeyCredentialCeremonyError {
                    method: "create",
                    error: &error
                }
            )),
            format!("{PASSKEY_CEREMONY_NOT_ALLOWED}: Passkey create request did not finish.")
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn promise_credential_conversion_reports_rejection_and_cancellation() {
        let plain_object = Object::new();
        let resolved_object = Promise::resolve(&plain_object);
        let cancelled =
            BrowserPasskeyClient::credential_from_promise(BrowserPasskeyCredentialFromPromise {
                method: "get",
                promise: resolved_object.unchecked_into(),
            })
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
        let rejected =
            BrowserPasskeyClient::credential_from_promise(BrowserPasskeyCredentialFromPromise {
                method: "create",
                promise: Promise::reject(&rejection),
            })
            .await
            .expect_err("rejected browser promises must remain errors");
        assert_eq!(
            js_error_message(rejected),
            format!("{PASSKEY_CEREMONY_NOT_ALLOWED}: Passkey create request did not finish.")
        );
    }
}

pub(crate) use options::{BrowserPasskeyCreationOptions, BrowserPasskeyRequestOptions};
