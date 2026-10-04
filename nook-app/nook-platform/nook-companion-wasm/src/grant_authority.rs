use nook_companion_core::PairingVaultId;
use nook_companion_core::{ExtensionGrantAuthority, ExtensionGrantAuthorityRequest};
use tsify::Tsify;
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
        PairingVaultId::parse(value)
            .map(Self)
            .map_err(|error| JsError::new(&error.to_string()))
    }

    #[wasm_bindgen(getter)]
    pub fn value(&self) -> String {
        self.0.as_str().to_owned()
    }
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_extension_grant_authority_response(
    response: &tsify::Ts<nook_companion_core::GrantAuthorityResponseJson>,
    requested: &NookPairingVaultId,
) -> Result<tsify::Ts<ExtensionGrantAuthority>, wasm_bindgen::JsError> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let result = response
        .decode(requested.as_core())
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn classify_extension_grant_authority(
    request: &tsify::Ts<ExtensionGrantAuthorityRequest>,
) -> Result<tsify::Ts<ExtensionGrantAuthority>, wasm_bindgen::JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { request.classify() };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_companion_core::{ActiveExtensionVault, ExtensionActiveVaultScope, StoreId};
    use serde::Serialize;
    use serde_wasm_bindgen::Serializer;
    use tsify::Ts;
    use wasm_bindgen::{JsError, JsValue};
    use wasm_bindgen_test::wasm_bindgen_test;

    struct GrantAuthorityFixture;

    impl GrantAuthorityFixture {
        fn assert_missing(result: Ts<ExtensionGrantAuthority>) -> Result<(), JsError> {
            // This output intentionally has no Deserialize implementation: inspect its wire.
            assert_eq!(
                serde_wasm_bindgen::from_value::<serde_json::Value>(result.js_value())?,
                serde_json::to_value(ExtensionGrantAuthority::MissingActiveAuthority)?,
            );
            Ok(())
        }

        fn active_request() -> Result<Ts<ExtensionGrantAuthorityRequest>, JsError> {
            // Deserialize-only input remains an untrusted JS fixture at the export edge.
            Ok(Ts::new_unchecked(
                serde_json::json!({
                    "stored_json": "{}",
                    "vault_store_id": StoreId::before_genesis_placeholder(),
                    "active_vault": ExtensionActiveVaultScope::Active(ActiveExtensionVault {
                        vault_store_id: StoreId::before_genesis_placeholder(),
                    }),
                })
                .serialize(&Serializer::json_compatible())?,
            ))
        }
    }

    #[wasm_bindgen_test]
    fn generated_decoder_preserves_missing_active_authority() -> Result<(), JsError> {
        let response = serde_json::to_string(&ExtensionGrantAuthority::MissingActiveAuthority)?;
        let result = decode_extension_grant_authority_response(
            &Ts::new_unchecked(JsValue::from_str(&response)),
            &NookPairingVaultId::new("store_abcdefghijk")?,
        )?;
        GrantAuthorityFixture::assert_missing(result)
    }

    #[wasm_bindgen_test]
    fn generated_pairing_vault_id_validates_and_projects_its_string_edge() -> Result<(), JsError> {
        let vault_id = NookPairingVaultId::new("store_abcdefghijk")?;
        assert_eq!(vault_id.value(), "store_abcdefghijk");
        assert!(NookPairingVaultId::new("vault").is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn generated_decoder_rejects_unknown_authority() -> Result<(), JsError> {
        let requested = NookPairingVaultId::new("store_abcdefghijk")?;
        assert!(
            decode_extension_grant_authority_response(
                &Ts::new_unchecked(JsValue::from_str(r#"{"kind":"Unknown"}"#)),
                &requested,
            )
            .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn generated_classifier_accepts_pairing_id_and_manager_scope() -> Result<(), JsError> {
        GrantAuthorityFixture::assert_missing(classify_extension_grant_authority(
            &GrantAuthorityFixture::active_request()?,
        )?)
    }

    #[wasm_bindgen_test]
    fn generated_classifier_admission_validates_store_ids() -> Result<(), JsError> {
        let request = GrantAuthorityFixture::active_request()?;
        // Keep direct decoder admission as well as the actual exported classification.
        request.to_rust()?;
        GrantAuthorityFixture::assert_missing(classify_extension_grant_authority(&request)?)?;
        let malformed: Ts<ExtensionGrantAuthorityRequest> = Ts::new_unchecked(
            serde_json::json!({
                "stored_json": "{}",
                "vault_store_id": "not-a-store-id",
                "active_vault": { "kind": "NoActiveVault" },
            })
            .serialize(&Serializer::json_compatible())?,
        );
        assert!(malformed.to_rust().is_err());
        assert!(classify_extension_grant_authority(&malformed).is_err());
        Ok(())
    }
}
