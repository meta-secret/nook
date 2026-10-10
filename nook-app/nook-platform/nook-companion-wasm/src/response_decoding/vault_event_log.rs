//! Typed admission for paired-vault encrypted event delivery.

use nook_companion_core::ExtensionVaultEventLogResponse;
pub use nook_companion_core::{
    ExtensionVaultEventLogResponseAdmission, ExtensionVaultEventLogResponseDecodeRequest,
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
    let result = request
        .decode()
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_extension_vault_event_log_grant(
    request: &Ts<nook_companion_core::ExtensionVaultEventLogGrantDecodeRequest>,
) -> Result<Ts<nook_companion_core::ExtensionVaultEventLogGrantDecision>, JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Invalid extension grant response."))?;
    let result = request
        .decode()
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_companion_core::{ExtensionVaultEventLogFailure, PairingVaultId, StoreId};
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
    fn exported_decoder_preserves_rejection_and_not_paired() -> Result<(), JsError> {
        for response in [
            ExtensionVaultEventLogResponse::NotPaired,
            ExtensionVaultEventLogResponse::Rejected {
                reason: ExtensionVaultEventLogFailure::Locked,
            },
        ] {
            let fixture = ResponseFixture {
                response: response.clone(),
                vault_store_id: StoreId::before_genesis_placeholder(),
            };
            assert_eq!(
                decode_extension_vault_event_log_response(&fixture.into_ts()?)?.to_rust()?,
                response
            );
        }
        Ok(())
    }

    #[wasm_bindgen_test]
    fn exported_decoder_rejects_foreign_vault_and_malformed_response() -> Result<(), JsError> {
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

    #[derive(Serialize)]
    struct GrantFixture {
        authority_response: nook_companion_core::GrantAuthorityResponseJson,
        vault_store_id: PairingVaultId,
    }

    #[wasm_bindgen_test]
    fn exported_grant_decoder_distinguishes_absent_and_broken_authority() -> Result<(), JsError> {
        use nook_companion_core::{ExtensionGrantAuthority, ExtensionVaultEventLogGrantDecision};
        for authority in [
            ExtensionGrantAuthority::NoMatchingAuthority,
            ExtensionGrantAuthority::MissingActiveAuthority,
            ExtensionGrantAuthority::InvalidStoredAuthority,
        ] {
            let fixture = GrantFixture {
                authority_response: serde_json::to_string(&authority)?.into(),
                vault_store_id: PairingVaultId::before_genesis_placeholder(),
            };
            let request = Ts::new_unchecked(fixture.serialize(&Serializer::json_compatible())?);
            let actual = decode_extension_vault_event_log_grant(&request)?;
            assert_eq!(
                serde_wasm_bindgen::from_value::<serde_json::Value>(actual.js_value())?,
                serde_json::to_value(ExtensionVaultEventLogGrantDecision::from(authority))?
            );
        }
        Ok(())
    }
}
