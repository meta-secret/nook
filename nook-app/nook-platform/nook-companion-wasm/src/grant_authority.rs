use nook_companion_core::ExtensionGrantAuthority;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
pub fn decode_extension_grant_authority_response(
    response: nook_companion_core::GrantAuthorityResponseJson,
    requested: nook_companion_core::PairingVaultId,
) -> Result<ExtensionGrantAuthority, JsError> {
    response
        .decode(requested)
        .map_err(|error| JsError::new(&error.to_string()))
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn generated_decoder_preserves_missing_active_authority() -> Result<(), wasm_bindgen::JsValue> {
        let result = decode_extension_grant_authority_response(
            r#"{"kind":"MissingActiveAuthority"}"#.to_owned().into(),
            "store-test".to_owned().into(),
        )?;
        assert_eq!(result, ExtensionGrantAuthority::MissingActiveAuthority);
        Ok(())
    }
}
