use nook_companion_core::{ExtensionGrantAuthority, ExtensionGrantAuthorityRequest};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub fn decode_extension_grant_authority_response(
    response: nook_companion_core::GrantAuthorityResponseJson,
    requested: nook_companion_core::PairingVaultId,
) -> Result<ExtensionGrantAuthority, wasm_bindgen::JsError> {
    response
        .decode(requested)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[must_use]
pub fn classify_extension_grant_authority(
    input: ExtensionGrantAuthorityRequest,
) -> ExtensionGrantAuthority {
    input.classify()
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn generated_boundary_preserves_authority_variants() -> Result<(), wasm_bindgen::JsValue> {
        #[derive(serde::Deserialize)]
        struct Wire {
            kind: String,
        }
        for (json, expected) in [
            ("{}", "NoMatchingAuthority"),
            ("null", "InvalidStoredAuthority"),
        ] {
            let request = ExtensionGrantAuthorityRequest {
                stored_json: json.to_owned().into(),
                vault_store_id: "store-test".to_owned().into(),
                active_vault: nook_companion_core::ExtensionActiveVaultScope::NoActiveVault,
            };
            let result = classify_extension_grant_authority(request);
            let wire = serde_wasm_bindgen::to_value(&result)?;
            let decoded: Wire = serde_wasm_bindgen::from_value(wire)?;
            assert_eq!(decoded.kind, expected);
        }
        Ok(())
    }

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
