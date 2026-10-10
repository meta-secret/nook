//! WASM exports that decode session and response wire contracts.

#[cfg(all(test, target_arch = "wasm32"))]
use nook_companion_core::AuthenticationOutcomeResponseKind;
#[cfg(all(test, target_arch = "wasm32"))]
use nook_companion_core::AuthenticatorBackupAttachResponseKind;
#[cfg(all(test, target_arch = "wasm32"))]
use nook_companion_core::AuthenticatorEnrollmentConfirmResponseKind;
#[cfg(all(test, target_arch = "wasm32"))]
use nook_companion_core::AuthenticatorEnrollmentStageResponseKind;
#[cfg(all(test, target_arch = "wasm32"))]
use nook_companion_core::AuthenticatorOptionsResponseKind;
#[cfg(all(test, target_arch = "wasm32"))]
use nook_companion_core::AuthenticatorPickerOpenResponseKind;
#[cfg(all(test, target_arch = "wasm32"))]
use nook_companion_core::AuthenticatorPreviewResponseKind;
#[cfg(all(test, target_arch = "wasm32"))]
use nook_companion_core::GeneratedPasswordResponseKind;
#[cfg(all(test, target_arch = "wasm32"))]
use nook_companion_core::WebsitePasskeyAccountListKind;
mod authenticator_mutation;
mod vault_event_log;
pub use authenticator_mutation::{
    AuthenticatorBackupAttachAdmission, AuthenticatorEnrollmentConfirmAdmission,
    AuthenticatorEnrollmentStageAdmission, decode_authenticator_backup_attach_response,
    decode_authenticator_enrollment_confirm_response,
    decode_authenticator_enrollment_stage_response,
};
pub use vault_event_log::*;

use nook_companion_core::AuthenticatorCodeSessionResponse;
use nook_companion_core::AuthenticatorPreviewSessionResponse;
use nook_companion_core::AuthenticatorSecretSessionResponse;
use nook_companion_core::ExtensionSessionRequestValidation;
use nook_companion_core::VerifiedAuthenticatorBackupAttachResponse;
use nook_companion_core::{
    AuthenticationOutcomeResponse, ExtensionSessionStatusAvailability, LoginPickerOpenResponse,
};
use nook_companion_core::{
    AuthenticatorOptionsResponse, AuthenticatorPickerOpenResponse, AuthenticatorPreviewResponse,
    GeneratedPasswordResponse, WebsiteLoginOptions, WebsitePasskeyAccountList,
};
use serde::Deserialize;
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct WebsiteLoginOptionsAdmission(
    pub(crate) nook_companion_core::WebsiteLoginOptionsWireValue,
);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct WebsiteLoginSaveOfferAdmission(nook_companion_core::WebsiteLoginSaveOfferResponse);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct WebsiteLoginSavePendingAdmission(nook_companion_core::WebsiteLoginSavePendingResponse);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct WebsiteLoginSaveActionAdmission(nook_companion_core::WebsiteLoginSaveActionResponse);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct LoginPickerOpenAdmission(nook_companion_core::LoginPickerOpenResponseWire);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct AuthenticatorPickerOpenAdmission(
    nook_companion_core::AuthenticatorPickerOpenResponseWire,
);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct AuthenticationOutcomeAdmission(nook_companion_core::AuthenticationOutcomeResponseWire);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct GeneratedPasswordAdmission(nook_companion_core::GeneratedPasswordResponseWire);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct AuthenticatorOptionsAdmission(nook_companion_core::AuthenticatorOptionsResponseWire);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct AuthenticatorPreviewAdmission(nook_companion_core::AuthenticatorPreviewResponseWire);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct ExtensionSessionStatusAdmission(nook_companion_core::ExtensionSessionStatusResponseWire);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct ExtensionSessionRequestAdmission(nook_companion_core::ExtensionSessionRequestWire);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct ExtensionEventLogRecordAdmission(nook_companion_core::ExtensionEventLogRecord);

#[cfg(test)]
mod session_request_admission_tests {
    use super::*;
    #[cfg(test)]
    use nook_companion_core::ExtensionSessionRequest;

    #[test]
    fn chrome_session_request_admission_is_unknown_and_schema_checked() {
        assert!(ExtensionSessionRequestAdmission::DECL.ends_with(" = unknown;"));
        assert!(ExtensionSessionRequest::DECL.contains("nook:extension-session-status"));
        assert!(serde_json::from_str::<ExtensionSessionRequestAdmission>("null").is_err());
        assert!(
            serde_json::from_str::<ExtensionSessionRequestAdmission>(
                r#"{"type":"nook:extension-session-status","payload":{"queue":{"kind":"message-default"},"unexpected":true}}"#,
            )
            .is_err()
        );
        let Ok(decoded) = serde_json::from_str::<ExtensionSessionRequestAdmission>(
            r#"{"type":"nook:extension-session-status","payload":{"queue":{"kind":"message-default"}}}"#,
        ) else {
            panic!("valid status request must decode");
        };
        assert!(matches!(
            decoded.0.decoded(),
            ExtensionSessionRequest::Status(_)
        ));
    }
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn validate_extension_session_request(
    request: &tsify::Ts<ExtensionSessionRequestAdmission>,
) -> Result<nook_companion_core::ExtensionSessionRequestValidation, wasm_bindgen::JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        let ExtensionSessionRequestAdmission(request) = request;
        drop(request);
        ExtensionSessionRequestValidation::Accepted
    };
    Ok(result)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_extension_session_request(
    request: &tsify::Ts<ExtensionSessionRequestAdmission>,
) -> Result<tsify::Ts<nook_companion_core::ExtensionSessionRequest>, wasm_bindgen::JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        let ExtensionSessionRequestAdmission(request) = request;
        request.decoded()
    };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_extension_event_log_record(
    record: &tsify::Ts<ExtensionEventLogRecordAdmission>,
) -> Result<tsify::Ts<nook_companion_core::ExtensionEventLogRecord>, wasm_bindgen::JsError> {
    let record = record
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        let ExtensionEventLogRecordAdmission(record) = record;
        record
    };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen owns the decoded ABI value.
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_extension_session_status_response(
    response: &tsify::Ts<ExtensionSessionStatusAdmission>,
) -> Result<nook_companion_core::ExtensionSessionStatusAvailability, wasm_bindgen::JsError> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        let ExtensionSessionStatusAdmission(response) = response;
        ExtensionSessionStatusAvailability::decode_extension_session_status_response(&response)
    };
    Ok(result)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_website_login_options(
    response: &tsify::Ts<WebsiteLoginOptionsAdmission>,
) -> Result<tsify::Ts<nook_companion_core::WebsiteLoginOptions>, wasm_bindgen::JsError> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let WebsiteLoginOptionsAdmission(response) = response;
    let result = WebsiteLoginOptions::from_wire(response)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_website_passkey_account_list(
    response: wasm_bindgen::JsValue,
) -> Result<tsify::Ts<nook_companion_core::WebsitePasskeyAccountList>, wasm_bindgen::JsError> {
    let result = {
        serde_wasm_bindgen::from_value(response).map_or_else(
            |_| WebsitePasskeyAccountList::invalid(),
            WebsitePasskeyAccountList::from_wire,
        )
    };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_website_login_save_offer_response(
    response: &tsify::Ts<WebsiteLoginSaveOfferAdmission>,
) -> Result<tsify::Ts<nook_companion_core::WebsiteLoginSaveOfferResponse>, wasm_bindgen::JsError> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let WebsiteLoginSaveOfferAdmission(response) = response;
    let result = response
        .validate()
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_website_login_save_pending_response(
    response: &tsify::Ts<WebsiteLoginSavePendingAdmission>,
) -> Result<tsify::Ts<nook_companion_core::WebsiteLoginSavePendingResponse>, wasm_bindgen::JsError>
{
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let WebsiteLoginSavePendingAdmission(response) = response;
    let result = response
        .validate()
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_website_login_save_action_response(
    response: &tsify::Ts<WebsiteLoginSaveActionAdmission>,
) -> Result<tsify::Ts<nook_companion_core::WebsiteLoginSaveActionResponse>, wasm_bindgen::JsError> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let WebsiteLoginSaveActionAdmission(response) = response;
    let result = response
        .validate()
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_login_picker_open_response(
    response: &tsify::Ts<LoginPickerOpenAdmission>,
) -> Result<tsify::Ts<nook_companion_core::LoginPickerOpenResponse>, wasm_bindgen::JsError> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let LoginPickerOpenAdmission(response) = response;
    let result = LoginPickerOpenResponse::decode_login_picker_open_response(response)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_authenticator_picker_open_response(
    response: &tsify::Ts<AuthenticatorPickerOpenAdmission>,
) -> Result<tsify::Ts<nook_companion_core::AuthenticatorPickerOpenResponse>, wasm_bindgen::JsError>
{
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let AuthenticatorPickerOpenAdmission(response) = response;
    let result = AuthenticatorPickerOpenResponse::from_wire(response)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_authentication_outcome_response(
    response: &tsify::Ts<AuthenticationOutcomeAdmission>,
) -> Result<tsify::Ts<nook_companion_core::AuthenticationOutcomeResponse>, wasm_bindgen::JsError> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let AuthenticationOutcomeAdmission(response) = response;
    let result = AuthenticationOutcomeResponse::decode_authentication_outcome_response(response)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_generated_password_response(
    response: &tsify::Ts<GeneratedPasswordAdmission>,
) -> Result<tsify::Ts<nook_companion_core::GeneratedPasswordResponse>, wasm_bindgen::JsError> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let GeneratedPasswordAdmission(response) = response;
    let result = GeneratedPasswordResponse::from_wire(response)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_authenticator_options_response(
    response: &tsify::Ts<AuthenticatorOptionsAdmission>,
) -> Result<tsify::Ts<nook_companion_core::AuthenticatorOptionsResponse>, wasm_bindgen::JsError> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let AuthenticatorOptionsAdmission(response) = response;
    let result = AuthenticatorOptionsResponse::from_wire(response)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_authenticator_preview_response(
    response: &tsify::Ts<AuthenticatorPreviewAdmission>,
) -> Result<tsify::Ts<nook_companion_core::AuthenticatorPreviewResponse>, wasm_bindgen::JsError> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let AuthenticatorPreviewAdmission(response) = response;
    let result = AuthenticatorPreviewResponse::from_wire(response)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[cfg(test)]
mod admission_tests {
    use super::*;
    #[cfg(test)]
    use nook_companion_core::ExtensionEventLogRecord;

    #[test]
    fn runtime_response_admissions_declare_unknown_chrome_inputs() {
        for declaration in [
            WebsiteLoginOptionsAdmission::DECL,
            WebsiteLoginSaveOfferAdmission::DECL,
            WebsiteLoginSavePendingAdmission::DECL,
            WebsiteLoginSaveActionAdmission::DECL,
            LoginPickerOpenAdmission::DECL,
            AuthenticatorPickerOpenAdmission::DECL,
            AuthenticationOutcomeAdmission::DECL,
            AuthenticatorBackupAttachAdmission::DECL,
            AuthenticatorEnrollmentStageAdmission::DECL,
            AuthenticatorEnrollmentConfirmAdmission::DECL,
            GeneratedPasswordAdmission::DECL,
            AuthenticatorOptionsAdmission::DECL,
            AuthenticatorPreviewAdmission::DECL,
            ExtensionSessionStatusAdmission::DECL,
            ExtensionEventLogRecordAdmission::DECL,
        ] {
            assert!(declaration.ends_with(" = unknown;"));
        }
    }

    #[test]
    fn runtime_response_admissions_reject_non_contract_values() {
        assert!(serde_json::from_str::<WebsiteLoginOptionsAdmission>("null").is_err());
        assert!(serde_json::from_str::<WebsiteLoginSaveOfferAdmission>("null").is_err());
        assert!(serde_json::from_str::<WebsiteLoginSavePendingAdmission>("null").is_err());
        assert!(serde_json::from_str::<WebsiteLoginSaveActionAdmission>("null").is_err());
        assert!(serde_json::from_str::<LoginPickerOpenAdmission>("null").is_err());
        assert!(serde_json::from_str::<AuthenticatorPickerOpenAdmission>("null").is_err());
        assert!(serde_json::from_str::<AuthenticationOutcomeAdmission>("null").is_err());
        assert!(serde_json::from_str::<AuthenticatorBackupAttachAdmission>("null").is_err());
        assert!(serde_json::from_str::<AuthenticatorEnrollmentStageAdmission>("null").is_err());
        assert!(serde_json::from_str::<AuthenticatorEnrollmentConfirmAdmission>("null").is_err());
        assert!(serde_json::from_str::<GeneratedPasswordAdmission>("null").is_err());
        assert!(serde_json::from_str::<AuthenticatorOptionsAdmission>("null").is_err());
        assert!(serde_json::from_str::<AuthenticatorPreviewAdmission>("null").is_err());
        assert!(serde_json::from_str::<ExtensionSessionStatusAdmission>("null").is_err());
    }

    #[test]
    fn event_log_record_admission_decodes_the_complete_vault_event() -> Result<(), serde_json::Error>
    {
        assert!(ExtensionEventLogRecordAdmission::DECL.ends_with(" = unknown;"));
        assert!(ExtensionEventLogRecord::DECL.contains("eventId"));
        let valid = serde_json::json!({
            "eventId": "event-1",
            "path": "events/event-1.yaml",
            "event": {
                "schema_version": 2,
                "store_id": "store_testtoken11",
                "actor_id": format!("key_{}", "0".repeat(64)),
                "actor_signing_public_key": "0".repeat(64),
                "parents": [],
                "created_at": "2026-08-10T00:00:00Z",
                "key_epoch": "sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo",
                "operations": [{"type":"vault-cleared"}],
                "signature": format!("ed25519:{}", "0".repeat(128))
            }
        });
        let admission: ExtensionEventLogRecordAdmission = serde_json::from_value(valid)?;
        let decoded = admission.0;
        assert_eq!(decoded.event_id, "event-1");
        assert!(
            serde_json::from_str::<ExtensionEventLogRecordAdmission>(
                r#"{"eventId":"event-1","path":"events/event-1.yaml","event":{"schema_version":2}}"#
            )
            .is_err()
        );
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use nook_companion_core::ExtensionSessionRequestValidation;
    use nook_companion_core::ExtensionSessionStatusAvailability;
    #[cfg(all(test, target_arch = "wasm32"))]
    use nook_companion_core::WebsiteLoginSaveActionResponse;
    #[cfg(all(test, target_arch = "wasm32"))]
    use nook_companion_core::WebsiteLoginSaveOfferResponse;
    #[cfg(all(test, target_arch = "wasm32"))]
    use nook_companion_core::WebsiteLoginSavePendingResponse;
    use nook_companion_core::WebsitePasskeyAccountList;
    use serde::Serialize;
    use serde_wasm_bindgen::Serializer;
    use tsify::{Ts, Tsify};
    use wasm_bindgen::JsError;
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::wasm_bindgen_test;

    use super::*;

    fn js_error(error: impl std::fmt::Display) -> JsError {
        JsError::new(&error.to_string())
    }

    struct ResponseWireFixture {
        value: JsValue,
    }
    impl ResponseWireFixture {
        fn parse(serialized: &str) -> Result<Self, JsError> {
            let value: serde_json::Value = serde_json::from_str(serialized).map_err(js_error)?;
            let value = value
                .serialize(&Serializer::json_compatible())
                .map_err(js_error)?;
            Ok(Self { value })
        }
        fn into_typed<T: Tsify>(self) -> tsify::Ts<T> {
            Ts::new_unchecked(self.value)
        }
        fn from_typed<T: Tsify>(value: tsify::Ts<T>) -> Self {
            Self {
                value: value.js_value(),
            }
        }
        fn into_value(self) -> JsValue {
            self.value
        }
        fn into_json(self) -> Result<serde_json::Value, JsError> {
            serde_wasm_bindgen::from_value(self.value).map_err(js_error)
        }
    }

    #[wasm_bindgen_test]
    fn session_request_and_status_decoders_preserve_typed_states() -> Result<(), JsError> {
        let request = ResponseWireFixture::parse(
            r#"{"type":"nook:extension-session-status","payload":{"queue":{"kind":"message-default"}}}"#,
        )?.into_typed();
        assert_eq!(
            validate_extension_session_request(&request)?,
            ExtensionSessionRequestValidation::Accepted
        );

        for (serialized, expected) in [
            (
                r#"{"ok":false,"status":6}"#,
                ExtensionSessionStatusAvailability::Unavailable,
            ),
            (
                r#"{"ok":true,"status":4}"#,
                ExtensionSessionStatusAvailability::Locked,
            ),
            (
                r#"{"ok":true,"status":6,"device":{"deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing"}}"#,
                ExtensionSessionStatusAvailability::Unlocked,
            ),
        ] {
            assert_eq!(
                decode_extension_session_status_response(
                    &ResponseWireFixture::parse(serialized)?.into_typed()
                )?,
                expected
            );
        }
        Ok(())
    }

    #[wasm_bindgen_test]
    fn website_login_and_passkey_decoders_reject_incomplete_identity() -> Result<(), JsError> {
        let options = decode_website_login_options(&ResponseWireFixture::parse(
            r#"{"ok":true,"status":"ready","authorizationGeneration":"epoch-1","accounts":[{"vaultStoreId":"vault","vaultName":"Personal","secretId":"secret","username":"alice","websiteUrl":"https://example.test","websiteHost":"example.test"}]}"#,
        )?.into_typed())?;
        let actual = ResponseWireFixture::from_typed(options).into_json()?;
        assert_eq!(actual["kind"], serde_json::json!(0));
        assert_eq!(actual["accounts"].as_array().map(Vec::len), Some(1));
        assert!(
            decode_website_login_options(
                &ResponseWireFixture::parse(
                    r#"{"ok":true,"status":"ready","authorizationGeneration":" ","accounts":[]}"#,
                )?
                .into_typed()
            )
            .is_err()
        );

        let accounts = decode_website_passkey_account_list(ResponseWireFixture::parse(
            r#"{"ok":true,"accounts":[{"credentialId":"credential","userName":"alice@example.test","userDisplayName":"Alice"}]}"#,
        )?.into_value())?;
        let actual = ResponseWireFixture::from_typed(accounts).into_json()?;
        assert_eq!(
            actual["kind"],
            serde_json::to_value(WebsitePasskeyAccountListKind::Ready)?
        );
        assert_eq!(actual["accounts"].as_array().map(Vec::len), Some(1));
        assert_eq!(ResponseWireFixture::from_typed(decode_website_passkey_account_list(ResponseWireFixture::parse(
                r#"{"ok":true,"accounts":[{"credentialId":" ","userName":"alice@example.test","userDisplayName":"Alice"}]}"#,
            )?.into_value())?).into_json()?, serde_json::to_value(WebsitePasskeyAccountList::invalid())?);
        assert_eq!(
            ResponseWireFixture::from_typed(decode_website_passkey_account_list(
                JsValue::from_str("not-an-object")
            )?)
            .into_json()?,
            serde_json::to_value(WebsitePasskeyAccountList::invalid())?
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn login_save_decoders_preserve_closed_success_and_rejection_states() -> Result<(), JsError> {
        let offer = ResponseWireFixture::parse(
            r#"{"kind":"offer-available","offer":{"offerId":"offer","decision":0,"vaultStoreId":"vault","vaultName":"Personal"}}"#,
        )?.into_typed();
        assert!(matches!(
            decode_website_login_save_offer_response(&offer)?.to_rust()?,
            WebsiteLoginSaveOfferResponse::OfferAvailable { .. }
        ));
        assert!(
            decode_website_login_save_offer_response(
                &ResponseWireFixture::parse(r#"{"kind":"rejected","reason":" "}"#)?.into_typed()
            )
            .is_err()
        );

        assert!(matches!(
            decode_website_login_save_pending_response(
                &ResponseWireFixture::parse(r#"{"ok":true,"state":"unavailable"}"#)?.into_typed()
            )?
            .to_rust()?,
            WebsiteLoginSavePendingResponse::Available(_)
        ));
        assert!(
            decode_website_login_save_pending_response(
                &ResponseWireFixture::parse(r#"{"ok":false,"reason":" "}"#)?.into_typed()
            )
            .is_err()
        );

        assert!(matches!(
            decode_website_login_save_action_response(
                &ResponseWireFixture::parse(r#"{"kind":"completed"}"#)?.into_typed()
            )?
            .to_rust()?,
            WebsiteLoginSaveActionResponse::Completed {}
        ));
        assert!(
            decode_website_login_save_action_response(
                &ResponseWireFixture::parse(r#"{"kind":"rejected","reason":" "}"#)?.into_typed()
            )
            .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn picker_and_outcome_decoders_preserve_success_and_failure() -> Result<(), JsError> {
        let actual = ResponseWireFixture::from_typed(decode_login_picker_open_response(
            &ResponseWireFixture::parse(
                r#"{"ok":true,"status":"ready","requestId":"request","expiresAt":42}"#,
            )?
            .into_typed(),
        )?)
        .into_json()?;
        assert_eq!(actual["kind"], serde_json::json!(1));
        assert_eq!(actual["requestId"], "request");
        assert!(
            decode_login_picker_open_response(
                &ResponseWireFixture::parse(
                    r#"{"ok":true,"status":"ready","requestId":" ","expiresAt":42}"#
                )?
                .into_typed()
            )
            .is_err()
        );

        let actual = ResponseWireFixture::from_typed(decode_authenticator_picker_open_response(
            &ResponseWireFixture::parse(r#"{"ok":false,"reason":"picker-failed"}"#)?.into_typed(),
        )?)
        .into_json()?;
        assert_eq!(
            actual["kind"],
            serde_json::to_value(AuthenticatorPickerOpenResponseKind::Rejected)?
        );
        assert_eq!(actual["reason"], "picker-failed");
        assert!(
            decode_authenticator_picker_open_response(
                &ResponseWireFixture::parse(r#"{"ok":false,"reason":" "}"#)?.into_typed()
            )
            .is_err()
        );

        let actual = ResponseWireFixture::from_typed(decode_authentication_outcome_response(
            &ResponseWireFixture::parse(
                r#"{"ok":true,"verdict":{"verdict":0,"allowsCredentialCommit":true}}"#,
            )?
            .into_typed(),
        )?)
        .into_json()?;
        assert_eq!(
            actual["kind"],
            serde_json::to_value(AuthenticationOutcomeResponseKind::Completed)?
        );
        assert!(
            decode_authentication_outcome_response(
                &ResponseWireFixture::parse(r#"{"ok":false,"reason":" "}"#)?.into_typed()
            )
            .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn authenticator_mutation_decoders_reject_incomplete_outcomes() -> Result<(), JsError> {
        let actual = ResponseWireFixture::from_typed(decode_authenticator_backup_attach_response(
            &ResponseWireFixture::parse(r#"{"ok":true}"#)?.into_typed(),
        )?)
        .into_json()?;
        assert_eq!(
            actual["kind"],
            serde_json::to_value(AuthenticatorBackupAttachResponseKind::Completed)?
        );
        assert!(
            decode_authenticator_backup_attach_response(
                &ResponseWireFixture::parse(r#"{"ok":false}"#)?.into_typed()
            )
            .is_err()
        );

        let actual =
            ResponseWireFixture::from_typed(decode_authenticator_enrollment_stage_response(
                &ResponseWireFixture::parse(r#"{"ok":true,"stageId":"stage-1"}"#)?.into_typed(),
            )?)
            .into_json()?;
        assert_eq!(
            actual["kind"],
            serde_json::to_value(AuthenticatorEnrollmentStageResponseKind::Staged)?
        );
        assert_eq!(actual["stageId"], "stage-1");
        assert!(
            decode_authenticator_enrollment_stage_response(
                &ResponseWireFixture::parse(r#"{"ok":true,"stageId":" "}"#)?.into_typed()
            )
            .is_err()
        );

        let actual =
            ResponseWireFixture::from_typed(decode_authenticator_enrollment_confirm_response(
                &ResponseWireFixture::parse(r#"{"ok":true,"secretId":"secret-1"}"#)?.into_typed(),
            )?)
            .into_json()?;
        assert_eq!(
            actual["kind"],
            serde_json::to_value(AuthenticatorEnrollmentConfirmResponseKind::Completed)?
        );
        assert_eq!(actual["secretId"], "secret-1");
        assert!(
            decode_authenticator_enrollment_confirm_response(
                &ResponseWireFixture::parse(r#"{"ok":true,"secretId":" "}"#)?.into_typed()
            )
            .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn authenticator_read_decoders_preserve_available_and_invalid_states() -> Result<(), JsError> {
        let actual = ResponseWireFixture::from_typed(decode_generated_password_response(
            &ResponseWireFixture::parse(
                r#"{"ok":true,"password":"correct horse battery staple"}"#,
            )?
            .into_typed(),
        )?)
        .into_json()?;
        assert_eq!(
            actual["kind"],
            serde_json::to_value(GeneratedPasswordResponseKind::Generated)?
        );
        assert!(
            decode_generated_password_response(
                &ResponseWireFixture::parse(r#"{"ok":true,"password":""}"#)?.into_typed()
            )
            .is_err()
        );

        let actual = ResponseWireFixture::from_typed(decode_authenticator_options_response(
            &ResponseWireFixture::parse(r#"{"ok":true,"status":"unavailable"}"#)?.into_typed(),
        )?)
        .into_json()?;
        assert_eq!(
            actual["kind"],
            serde_json::to_value(AuthenticatorOptionsResponseKind::Unavailable)?
        );
        assert!(
            decode_authenticator_options_response(
                &ResponseWireFixture::parse(r#"{"ok":false,"status":"unavailable"}"#)?.into_typed()
            )
            .is_err()
        );

        let actual = ResponseWireFixture::from_typed(decode_authenticator_preview_response(
            &ResponseWireFixture::parse(r#"{"ok":true,"status":"unavailable"}"#)?.into_typed(),
        )?)
        .into_json()?;
        assert_eq!(
            actual["kind"],
            serde_json::to_value(AuthenticatorPreviewResponseKind::Unavailable)?
        );
        assert!(
            decode_authenticator_preview_response(
                &ResponseWireFixture::parse(r#"{"ok":false,"status":"unavailable"}"#)?.into_typed()
            )
            .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn authenticator_session_decoders_admit_complete_responses() -> Result<(), JsError> {
        assert!(
            decode_authenticator_code_session_response(
                ResponseWireFixture::parse(
                    r#"{"ok":true,"code":"012345","expiresAt":1700000030000}"#,
                )?
                .into_value()
            )
            .is_ok()
        );
        assert!(decode_authenticator_preview_session_response(ResponseWireFixture::parse(
            r#"{"ok":true,"preview":{"issuer":"Example","account":"alice@example.com","websiteUrl":"https://example.com","algorithm":"SHA1","digits":6,"period":30}}"#,
        )?.into_value())
        .is_ok());
        assert!(
            decode_authenticator_secret_session_response(
                ResponseWireFixture::parse(r#"{"ok":true,"secretId":"authenticator-1"}"#,)?
                    .into_value()
            )
            .is_ok()
        );
        assert!(decode_authenticator_backup_verification_session_response(ResponseWireFixture::parse(
            r#"{"ok":true,"secretId":"authenticator-1","backupCodesVerified":true,"reviewedInputPersisted":true}"#,
        )?.into_value())
        .is_ok());
        assert!(decode_authenticator_code_session_response(JsValue::from_str("invalid")).is_err());
        assert!(
            decode_authenticator_preview_session_response(JsValue::from_str("invalid")).is_err()
        );
        assert!(
            decode_authenticator_secret_session_response(JsValue::from_str("invalid")).is_err()
        );
        assert!(
            decode_authenticator_backup_verification_session_response(JsValue::from_str("invalid"))
                .is_err()
        );
        Ok(())
    }
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_authenticator_code_session_response(
    value: wasm_bindgen::JsValue,
) -> Result<tsify::Ts<nook_companion_core::AuthenticatorCodeSessionResponse>, wasm_bindgen::JsError>
{
    let wire: nook_companion_core::AuthenticatorCodeSessionWire =
        serde_wasm_bindgen::from_value(value)
            .map_err(|_| JsError::new("Extension session returned an invalid response."))?;
    let result = AuthenticatorCodeSessionResponse::try_from(wire).map_err(JsError::new)?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_authenticator_preview_session_response(
    value: wasm_bindgen::JsValue,
) -> Result<
    tsify::Ts<nook_companion_core::AuthenticatorPreviewSessionResponse>,
    wasm_bindgen::JsError,
> {
    let wire: nook_companion_core::AuthenticatorPreviewSessionWire =
        serde_wasm_bindgen::from_value(value)
            .map_err(|_| JsError::new("Extension session returned an invalid response."))?;
    let result = AuthenticatorPreviewSessionResponse::try_from(wire).map_err(JsError::new)?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_authenticator_secret_session_response(
    value: wasm_bindgen::JsValue,
) -> Result<tsify::Ts<nook_companion_core::AuthenticatorSecretSessionResponse>, wasm_bindgen::JsError>
{
    let wire: nook_companion_core::AuthenticatorSecretSessionWire =
        serde_wasm_bindgen::from_value(value)
            .map_err(|_| JsError::new("Extension session returned an invalid response."))?;
    let result = AuthenticatorSecretSessionResponse::try_from(wire).map_err(JsError::new)?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_authenticator_backup_verification_session_response(
    value: wasm_bindgen::JsValue,
) -> Result<
    tsify::Ts<nook_companion_core::VerifiedAuthenticatorBackupAttachResponse>,
    wasm_bindgen::JsError,
> {
    let wire: nook_companion_core::AuthenticatorBackupVerificationSessionWire =
        serde_wasm_bindgen::from_value(value)
            .map_err(|_| JsError::new("Extension session returned an invalid response."))?;
    let result = VerifiedAuthenticatorBackupAttachResponse::try_from(wire).map_err(JsError::new)?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[cfg(all(test, target_arch = "wasm32"))]
mod primitive_ingress_tests {
    use super::*;
    use tsify::Ts;
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::wasm_bindgen_test;
    #[wasm_bindgen_test]
    fn absent_credential_and_outcome_envelopes_cannot_be_admitted() {
        assert!(
            decode_website_login_save_offer_response(&Ts::new_unchecked(JsValue::NULL)).is_err()
        );
        assert!(
            decode_website_login_save_pending_response(&Ts::new_unchecked(JsValue::TRUE)).is_err()
        );
        assert!(
            decode_website_login_save_action_response(&Ts::new_unchecked(JsValue::NULL)).is_err()
        );
        assert!(decode_authentication_outcome_response(&Ts::new_unchecked(JsValue::TRUE)).is_err());
        assert!(decode_generated_password_response(&Ts::new_unchecked(JsValue::NULL)).is_err());
    }
}
