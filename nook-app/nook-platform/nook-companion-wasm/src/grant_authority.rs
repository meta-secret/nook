use nook_companion_core::{ExtensionGrantAuthority, ExtensionGrantAuthorityRequest};
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

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn classify_extension_grant_authority(
    request: ExtensionGrantAuthorityRequest,
) -> ExtensionGrantAuthority {
    request.classify()
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use serde::Serialize;
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

    #[wasm_bindgen_test]
    fn generated_classifier_accepts_pairing_id_and_manager_scope() {
        assert_eq!(
            classify_extension_grant_authority(ExtensionGrantAuthorityRequest {
                stored_json: "{}".to_owned().into(),
                vault_store_id: nook_companion_core::StoreId::before_genesis_placeholder(),
                active_vault: nook_companion_core::ExtensionActiveVaultScope::Active(
                    nook_companion_core::ActiveExtensionVault {
                        vault_store_id: nook_companion_core::StoreId::before_genesis_placeholder(),
                    },
                ),
            },),
            ExtensionGrantAuthority::MissingActiveAuthority,
        );
    }

    #[wasm_bindgen_test]
    fn generated_classifier_admission_validates_store_ids() -> Result<(), wasm_bindgen::JsError> {
        let valid = serde_json::json!({
            "stored_json": "{}",
            "vault_store_id": "store_abcdefghijk",
            "active_vault": {
                "kind": "Active",
                "vault_store_id": "store_abcdefghijk",
            },
        })
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        let request: ExtensionGrantAuthorityRequest = serde_wasm_bindgen::from_value(valid)
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        assert_eq!(
            classify_extension_grant_authority(request),
            ExtensionGrantAuthority::MissingActiveAuthority,
        );

        let malformed = serde_json::json!({
            "stored_json": "{}",
            "vault_store_id": "not-a-store-id",
            "active_vault": { "kind": "NoActiveVault" },
        })
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        assert!(
            serde_wasm_bindgen::from_value::<ExtensionGrantAuthorityRequest>(malformed).is_err()
        );
        Ok(())
    }
}
