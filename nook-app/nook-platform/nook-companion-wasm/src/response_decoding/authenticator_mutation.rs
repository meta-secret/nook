//! Typed boundaries for the three authenticator mutation outcomes.
use nook_companion_core::{
    AuthenticatorBackupAttachResponse, AuthenticatorEnrollmentConfirmResponse,
    AuthenticatorEnrollmentStageResponse,
};
use serde::Deserialize;
use tsify::{Ts, Tsify};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct AuthenticatorBackupAttachAdmission(
    nook_companion_core::AuthenticatorBackupAttachResponseWire,
);

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_authenticator_backup_attach_response(
    response: &Ts<AuthenticatorBackupAttachAdmission>,
) -> Result<Ts<nook_companion_core::AuthenticatorBackupAttachResponse>, JsError> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let AuthenticatorBackupAttachAdmission(response) = response;
    let result = AuthenticatorBackupAttachResponse::from_wire(response)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct AuthenticatorEnrollmentStageAdmission(
    nook_companion_core::AuthenticatorEnrollmentStageResponseWire,
);

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_authenticator_enrollment_stage_response(
    response: &Ts<AuthenticatorEnrollmentStageAdmission>,
) -> Result<Ts<nook_companion_core::AuthenticatorEnrollmentStageResponse>, JsError> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let AuthenticatorEnrollmentStageAdmission(response) = response;
    let result = AuthenticatorEnrollmentStageResponse::from_wire(response)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct AuthenticatorEnrollmentConfirmAdmission(
    nook_companion_core::AuthenticatorEnrollmentConfirmResponseWire,
);

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_authenticator_enrollment_confirm_response(
    response: &Ts<AuthenticatorEnrollmentConfirmAdmission>,
) -> Result<Ts<nook_companion_core::AuthenticatorEnrollmentConfirmResponse>, JsError> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let AuthenticatorEnrollmentConfirmAdmission(response) = response;
    let result = AuthenticatorEnrollmentConfirmResponse::from_wire(response)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use tsify::Ts;
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::wasm_bindgen_test;
    #[wasm_bindgen_test]
    fn missing_authenticator_mutation_envelopes_cannot_commit() {
        assert!(
            decode_authenticator_backup_attach_response(&Ts::new_unchecked(JsValue::NULL)).is_err()
        );
        assert!(
            decode_authenticator_enrollment_stage_response(&Ts::new_unchecked(JsValue::TRUE))
                .is_err()
        );
        assert!(
            decode_authenticator_enrollment_confirm_response(&Ts::new_unchecked(JsValue::NULL))
                .is_err()
        );
    }
}
