use nook_companion_core::AuthenticatorCodeResponse;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

/// Decode the complete ephemeral authenticator-code response contract.
#[wasm_bindgen]
pub fn decode_authenticator_code_response(
    response: nook_companion_core::AuthenticatorCodeResponseWire,
) -> Result<nook_companion_core::AuthenticatorCodeResponse, JsError> {
    AuthenticatorCodeResponse::from_wire(response).map_err(|error| JsError::new(&error.to_string()))
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::JsError;
    use serde::{Deserialize, Serialize};
    use wasm_bindgen_test::wasm_bindgen_test;

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
    fn bridge_requires_and_returns_expiry() -> Result<(), JsError> {
        let expires_at = 1_725_000_030_000.0;
        let input = serde_wasm_bindgen::to_value(&AuthenticatorCodeFixture {
            ok: true,
            code: "123456",
            expires_at,
        })
        .map_err(|error| JsError::new(&error.to_string()))?;
        let wire = serde_wasm_bindgen::from_value(input)
            .map_err(|error| JsError::new(&error.to_string()))?;
        let response = super::decode_authenticator_code_response(wire)?;
        let output = serde_wasm_bindgen::to_value(&response)
            .map_err(|error| JsError::new(&error.to_string()))?;
        let result: AuthenticatorCodeResult = serde_wasm_bindgen::from_value(output)
            .map_err(|error| JsError::new(&error.to_string()))?;
        assert_eq!(result.expires_at, expires_at);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn bridge_rejects_a_non_numeric_authenticator_code() -> Result<(), JsError> {
        let input = serde_wasm_bindgen::to_value(&AuthenticatorCodeFixture {
            ok: true,
            code: "invalid",
            expires_at: 1_725_000_030_000.0,
        })
        .map_err(|error| JsError::new(&error.to_string()))?;
        let wire = serde_wasm_bindgen::from_value(input)
            .map_err(|error| JsError::new(&error.to_string()))?;
        assert!(super::decode_authenticator_code_response(wire).is_err());
        Ok(())
    }
}
