//! WASM exports that decode session and response wire contracts.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[must_use]
pub fn validate_extension_session_request(
    request: nook_companion_core::ExtensionSessionRequestWire,
) -> nook_companion_core::ExtensionSessionRequestValidation {
    drop(request);
    nook_companion_core::ExtensionSessionRequestValidation::Accepted
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen owns the decoded ABI value.
pub fn decode_extension_session_status_response(
    response: nook_companion_core::ExtensionSessionStatusResponseWire,
) -> nook_companion_core::ExtensionSessionStatusAvailability {
    nook_companion_core::decode_extension_session_status_response(&response)
}

#[wasm_bindgen]
pub fn decode_website_login_options(
    response: nook_companion_core::WebsiteLoginOptionsWireValue,
) -> Result<nook_companion_core::WebsiteLoginOptions, wasm_bindgen::JsError> {
    nook_companion_core::decode_website_login_options(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[must_use]
pub fn decode_website_passkey_account_list(
    response: wasm_bindgen::JsValue,
) -> nook_companion_core::WebsitePasskeyAccountList {
    serde_wasm_bindgen::from_value(response).map_or_else(
        |_| nook_companion_core::WebsitePasskeyAccountList::invalid(),
        nook_companion_core::decode_website_passkey_account_list,
    )
}

#[wasm_bindgen]
pub fn decode_website_login_save_offer_response(
    response: nook_companion_core::WebsiteLoginSaveOfferResponse,
) -> Result<nook_companion_core::WebsiteLoginSaveOfferResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_website_login_save_offer_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_website_login_save_pending_response(
    response: nook_companion_core::WebsiteLoginSavePendingResponse,
) -> Result<nook_companion_core::WebsiteLoginSavePendingResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_website_login_save_pending_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_website_login_save_action_response(
    response: nook_companion_core::WebsiteLoginSaveActionResponse,
) -> Result<nook_companion_core::WebsiteLoginSaveActionResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_website_login_save_action_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_login_picker_open_response(
    response: nook_companion_core::LoginPickerOpenResponseWire,
) -> Result<nook_companion_core::LoginPickerOpenResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_login_picker_open_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authenticator_picker_open_response(
    response: nook_companion_core::AuthenticatorPickerOpenResponseWire,
) -> Result<nook_companion_core::AuthenticatorPickerOpenResponse, wasm_bindgen::JsError> {
    nook_companion_core::AuthenticatorPickerOpenResponse::from_wire(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authentication_outcome_response(
    response: nook_companion_core::AuthenticationOutcomeResponseWire,
) -> Result<nook_companion_core::AuthenticationOutcomeResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_authentication_outcome_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authenticator_backup_attach_response(
    response: nook_companion_core::AuthenticatorBackupAttachResponseWire,
) -> Result<nook_companion_core::AuthenticatorBackupAttachResponse, wasm_bindgen::JsError> {
    nook_companion_core::AuthenticatorBackupAttachResponse::from_wire(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authenticator_enrollment_stage_response(
    response: nook_companion_core::AuthenticatorEnrollmentStageResponseWire,
) -> Result<nook_companion_core::AuthenticatorEnrollmentStageResponse, wasm_bindgen::JsError> {
    nook_companion_core::AuthenticatorEnrollmentStageResponse::from_wire(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authenticator_enrollment_confirm_response(
    response: nook_companion_core::AuthenticatorEnrollmentConfirmResponseWire,
) -> Result<nook_companion_core::AuthenticatorEnrollmentConfirmResponse, wasm_bindgen::JsError> {
    nook_companion_core::AuthenticatorEnrollmentConfirmResponse::from_wire(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_generated_password_response(
    response: nook_companion_core::GeneratedPasswordResponseWire,
) -> Result<nook_companion_core::GeneratedPasswordResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_generated_password_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authenticator_options_response(
    response: nook_companion_core::AuthenticatorOptionsResponseWire,
) -> Result<nook_companion_core::AuthenticatorOptionsResponse, wasm_bindgen::JsError> {
    nook_companion_core::AuthenticatorOptionsResponse::from_wire(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authenticator_preview_response(
    response: nook_companion_core::AuthenticatorPreviewResponseWire,
) -> Result<nook_companion_core::AuthenticatorPreviewResponse, wasm_bindgen::JsError> {
    nook_companion_core::AuthenticatorPreviewResponse::from_wire(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}
