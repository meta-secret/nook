//! Shared vault-package boundary for paired encrypted event-log admission.

use nook_companion_core::{
    ExtensionVaultEventLogResponse, ExtensionVaultEventLogResponseDecodeRequest,
};
use tsify::{Ts, Tsify};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_extension_vault_event_log_response(
    request: &Ts<ExtensionVaultEventLogResponseDecodeRequest>,
) -> Result<Ts<ExtensionVaultEventLogResponse>, JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Invalid extension event-log response."))?;
    let response = request
        .decode()
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&response).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_companion_core::{ExtensionVaultEventLogFailure, StoreId};
    use serde::Serialize;
    use serde_wasm_bindgen::Serializer;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[derive(Serialize)]
    struct ResponseFixture {
        response: ExtensionVaultEventLogResponse,
        vault_store_id: StoreId,
    }

    impl ResponseFixture {
        fn into_ts(self) -> Result<Ts<ExtensionVaultEventLogResponseDecodeRequest>, JsError> {
            Ok(Ts::new_unchecked(
                self.serialize(&Serializer::json_compatible())?,
            ))
        }
    }

    #[wasm_bindgen_test]
    fn vault_package_decoder_preserves_typed_rejection_and_rejects_foreign_store()
    -> Result<(), JsError> {
        let response = ExtensionVaultEventLogResponse::Rejected {
            reason: ExtensionVaultEventLogFailure::Locked,
        };
        let fixture = ResponseFixture {
            response: response.clone(),
            vault_store_id: StoreId::before_genesis_placeholder(),
        };
        assert_eq!(
            decode_extension_vault_event_log_response(&fixture.into_ts()?)?.to_rust()?,
            response
        );
        let fixture = ResponseFixture {
            response: ExtensionVaultEventLogResponse::Exported {
                vault_store_id: StoreId::parse("store_lmnopqrstuv")
                    .map_err(|error| JsError::new(&error.to_string()))?,
                event_log_records: Vec::new(),
            },
            vault_store_id: StoreId::before_genesis_placeholder(),
        };
        assert!(decode_extension_vault_event_log_response(&fixture.into_ts()?).is_err());
        assert!(
            decode_extension_vault_event_log_response(&Ts::new_unchecked(
                serde_wasm_bindgen::to_value(&())?
            ))
            .is_err()
        );
        Ok(())
    }
}
