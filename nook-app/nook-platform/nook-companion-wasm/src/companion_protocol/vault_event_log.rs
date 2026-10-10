//! Public vault export requests contain no page-selected grant authority.

use nook_companion_core::ExtensionVaultEventLogRequestMessage;
use serde::Deserialize;
use tsify::{Ts, Tsify};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct ExtensionVaultEventLogRequestMessageAdmission(ExtensionVaultEventLogRequestMessage);

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_extension_vault_event_log_request_message(
    request: &Ts<ExtensionVaultEventLogRequestMessageAdmission>,
) -> Result<Ts<ExtensionVaultEventLogRequestMessage>, JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Invalid extension event-log request."))?;
    let ExtensionVaultEventLogRequestMessageAdmission(result) = request;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_companion_core::{ExtensionVaultEventLogRequest, StoreId};
    use serde::Serialize;
    use serde_wasm_bindgen::Serializer;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn exported_request_decoder_admits_only_the_typed_vault_request() -> Result<(), JsError> {
        let message = ExtensionVaultEventLogRequestMessage::ExportVaultEventLog(
            ExtensionVaultEventLogRequest {
                vault_store_id: StoreId::before_genesis_placeholder(),
            },
        );
        let admission = Ts::new_unchecked(message.serialize(&Serializer::json_compatible())?);
        assert_eq!(
            decode_extension_vault_event_log_request_message(&admission)?.to_rust()?,
            message
        );
        assert!(
            decode_extension_vault_event_log_request_message(&Ts::new_unchecked(
                serde_wasm_bindgen::to_value(&())?
            ))
            .is_err()
        );
        Ok(())
    }
}
