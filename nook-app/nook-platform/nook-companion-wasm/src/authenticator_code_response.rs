use wasm_bindgen::prelude::wasm_bindgen;

/// Decode the complete ephemeral authenticator-code response contract.
#[wasm_bindgen]
pub fn decode_authenticator_code_response(
    response: nook_companion_core::AuthenticatorCodeResponseWire,
) -> Result<nook_companion_core::AuthenticatorCodeResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_authenticator_code_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use serde::{Deserialize, Serialize};
    use wasm_bindgen_test::wasm_bindgen_test;

    fn js_error(error: impl std::fmt::Display) -> wasm_bindgen::JsError {
        wasm_bindgen::JsError::new(&error.to_string())
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct AuthenticatorCodeFixture {
        ok: bool,
        code: &'static str,
        expires_at: f64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct AuthenticatorCodeResult {
        expires_at: f64,
    }

    #[wasm_bindgen_test]
    fn bridge_requires_and_returns_expiry() -> Result<(), wasm_bindgen::JsError> {
        let expires_at = 1_725_000_030_000.0;
        let input = serde_wasm_bindgen::to_value(&AuthenticatorCodeFixture {
            ok: true,
            code: "123456",
            expires_at,
        })
        .map_err(js_error)?;
        let wire = serde_wasm_bindgen::from_value(input).map_err(js_error)?;
        let response = super::decode_authenticator_code_response(wire)?;
        let output = serde_wasm_bindgen::to_value(&response).map_err(js_error)?;
        let result: AuthenticatorCodeResult =
            serde_wasm_bindgen::from_value(output).map_err(js_error)?;
        assert_eq!(result.expires_at, expires_at);
        Ok(())
    }
}
