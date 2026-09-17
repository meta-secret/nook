use nook_companion_core::ExtensionGrantAuthority;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct NookPairingVaultId(nook_companion_core::PairingVaultId);

impl NookPairingVaultId {
    fn as_core(&self) -> &nook_companion_core::PairingVaultId {
        &self.0
    }
}

#[wasm_bindgen]
impl NookPairingVaultId {
    #[wasm_bindgen(constructor)]
    pub fn new(value: &str) -> Result<Self, JsError> {
        nook_companion_core::PairingVaultId::parse(value)
            .map(Self)
            .map_err(|error| JsError::new(&error.to_string()))
    }

    #[wasm_bindgen(getter)]
    pub fn value(&self) -> String {
        self.0.as_str().to_owned()
    }
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_extension_grant_authority_response(
    response: nook_companion_core::GrantAuthorityResponseJson,
    requested: &NookPairingVaultId,
) -> Result<ExtensionGrantAuthority, JsError> {
    response
        .decode(requested.as_core())
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
            &NookPairingVaultId::new("store_abcdefghijk")?,
        )?;
        assert_eq!(result, ExtensionGrantAuthority::MissingActiveAuthority);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn generated_pairing_vault_id_validates_and_projects_its_string_edge()
    -> Result<(), wasm_bindgen::JsValue> {
        let vault_id = NookPairingVaultId::new("store_abcdefghijk")?;
        assert_eq!(vault_id.value(), "store_abcdefghijk");
        assert!(NookPairingVaultId::new("vault").is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn generated_decoder_rejects_unknown_authority() -> Result<(), wasm_bindgen::JsValue> {
        let requested = NookPairingVaultId::new("store_abcdefghijk")?;
        assert!(
            decode_extension_grant_authority_response(
                r#"{"kind":"Unknown"}"#.to_owned().into(),
                &requested,
            )
            .is_err()
        );
        Ok(())
    }
}
