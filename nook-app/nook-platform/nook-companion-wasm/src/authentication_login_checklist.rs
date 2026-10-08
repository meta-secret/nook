//! Typed projection adapter for observed login checklist progress.
use nook_companion_core::{
    AuthenticationLoginChecklistPresentation, AuthenticationLoginChecklistProjection,
};
use tsify::{Ts, Tsify};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn project_authentication_login_checklist(
    request: &Ts<AuthenticationLoginChecklistProjection>,
) -> Result<Ts<AuthenticationLoginChecklistPresentation>, JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    Tsify::into_ts(&request.project())
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))
}
