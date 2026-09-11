//! Unknown extension messages enter typed passkey schemas at this JS boundary.
use nook_companion_core::{
    PasskeyByteMaterial, PasskeySetupAvailability, PasskeySetupMaterial,
    PasskeySetupMaterialResponse, PasskeyUnlockAvailability, PasskeyUnlockMaterial,
    PasskeyUnlockMaterialResponse,
};
use serde::Deserialize;
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

/// Typed admission boundary for an untrusted Chrome setup response.
#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown", from_wasm_abi)]
pub struct PasskeySetupMaterialAdmission(PasskeySetupMaterialResponse);

/// Typed admission boundary for an untrusted Chrome unlock response.
#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown", from_wasm_abi)]
pub struct PasskeyUnlockMaterialAdmission(PasskeyUnlockMaterialResponse);

/// Typed admission boundary for an untrusted Chrome session response.
#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown", from_wasm_abi)]
pub struct ExtensionSessionOperationAdmission(
    nook_companion_core::ExtensionSessionOperationResponseWire,
);

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_passkey_setup_material_response(
    value: PasskeySetupMaterialAdmission,
) -> Result<PasskeySetupMaterial, JsError> {
    let PasskeySetupMaterialAdmission(value) = value;
    match value.setup {
        PasskeySetupAvailability::Available(material) => Ok(material),
        PasskeySetupAvailability::Unavailable => Err(JsError::new(
            "Extension session returned a malformed setup response.",
        )),
    }
}
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_passkey_unlock_material_response(
    value: PasskeyUnlockMaterialAdmission,
) -> Result<PasskeyUnlockMaterial, JsError> {
    let PasskeyUnlockMaterialAdmission(value) = value;
    match value.material {
        PasskeyUnlockAvailability::Available(material) => Ok(material),
        PasskeyUnlockAvailability::Unavailable => Err(JsError::new(
            "Extension session returned a malformed unlock response.",
        )),
    }
}
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn admit_passkey_byte_material(value: PasskeyByteMaterial) -> PasskeyByteMaterial {
    value
}

/// Admit the full session device response at the unknown Chrome message boundary.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_extension_session_device_response(
    value: ExtensionSessionOperationAdmission,
) -> Result<nook_companion_core::ExtensionSessionDeviceResponse, JsError> {
    let ExtensionSessionOperationAdmission(value) = value;
    value.into_device().map_err(|error| JsError::new(&error))
}
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_extension_session_status_details(
    value: ExtensionSessionOperationAdmission,
) -> Result<nook_companion_core::ExtensionSessionStatus, JsError> {
    let ExtensionSessionOperationAdmission(value) = value;
    value.into_status().map_err(|error| JsError::new(&error))
}

/// Full configurations, not the identity-only metadata request projection.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn admit_extension_storage_providers(
    value: Vec<nook_core::StorageProvider>,
) -> Vec<nook_core::StorageProvider> {
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chrome_admissions_declare_unknown_inputs_with_real_rust_decoders() {
        assert!(
            PasskeySetupMaterialAdmission::DECL
                .ends_with("export type PasskeySetupMaterialAdmission = unknown;")
        );
        assert!(
            PasskeyUnlockMaterialAdmission::DECL
                .ends_with("export type PasskeyUnlockMaterialAdmission = unknown;")
        );
        assert!(
            ExtensionSessionOperationAdmission::DECL
                .ends_with("export type ExtensionSessionOperationAdmission = unknown;")
        );
    }

    #[test]
    fn chrome_admissions_accept_complete_typed_responses() -> anyhow::Result<()> {
        let setup = serde_json::from_str::<PasskeySetupMaterialAdmission>(
            r#"{"setup":{"userHandle":[1],"prfInput":[2]}}"#,
        )?;
        let setup = decode_passkey_setup_material_response(setup)
            .map_err(|_| anyhow::anyhow!("complete setup response must be admitted"))?;
        assert_eq!(setup.user_handle.as_bytes(), &[1]);
        assert_eq!(setup.prf_input.as_bytes(), &[2]);

        let unlock = serde_json::from_str::<PasskeyUnlockMaterialAdmission>(
            r#"{"material":{"credentialId":[3],"prfInput":[4]}}"#,
        )?;
        let unlock = decode_passkey_unlock_material_response(unlock)
            .map_err(|_| anyhow::anyhow!("complete unlock response must be admitted"))?;
        assert_eq!(unlock.credential_id.as_bytes(), &[3]);
        assert_eq!(unlock.prf_input.as_bytes(), &[4]);

        let status = serde_json::from_str::<ExtensionSessionOperationAdmission>(
            r#"{"ok":true,"status":1}"#,
        )?;
        assert!(matches!(
            decode_extension_session_status_details(status)
                .map_err(|_| anyhow::anyhow!("complete status response must be admitted"))?,
            nook_companion_core::ExtensionSessionStatus::Inactive { .. }
        ));
        Ok(())
    }

    #[test]
    fn chrome_admissions_reject_malformed_nested_values() {
        assert!(
            serde_json::from_str::<PasskeySetupMaterialAdmission>(
                r#"{"setup":{"userHandle":[256],"prfInput":[2]}}"#,
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<PasskeyUnlockMaterialAdmission>(
                r#"{"material":{"credentialId":[3],"prfInput":["4"]}}"#,
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<ExtensionSessionOperationAdmission>(
                r#"{"ok":true,"status":99}"#,
            )
            .is_err()
        );
    }
}
