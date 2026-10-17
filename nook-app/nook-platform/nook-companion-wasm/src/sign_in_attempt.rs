//! Typed adapter for the Rust-owned sign-in attempt lifecycle.
//!
//! `JsError` is reserved for a malformed request DTO. A stored record that
//! fails strict decoding is a typed `SignInAttemptAdvance::RecordRejected`.
//! Error messages are fixed text and never include page or record content.
use nook_companion_core::{
    SignInAttemptAdvance, SignInAttemptAdvanceRequest, SignInAttemptBeginRequest,
    SignInAttemptTransition,
};
use tsify::{Ts, Tsify};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn begin_sign_in_attempt(
    request: &Ts<SignInAttemptBeginRequest>,
) -> Result<Ts<SignInAttemptTransition>, JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let transition = request
        .begin()
        .map_err(|_| JsError::new("Sign-in attempt request is invalid."))?;
    Tsify::into_ts(&transition)
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn advance_sign_in_attempt(
    request: &Ts<SignInAttemptAdvanceRequest>,
) -> Result<Ts<SignInAttemptAdvance>, JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let advance = request
        .advance()
        .map_err(|_| JsError::new("Sign-in attempt request is invalid."))?;
    Tsify::into_ts(&advance).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}
