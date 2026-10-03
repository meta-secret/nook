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
#[tsify(type = "unknown")]
pub struct PasskeySetupMaterialAdmission(PasskeySetupMaterialResponse);

/// Typed admission boundary for an untrusted Chrome unlock response.
#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct PasskeyUnlockMaterialAdmission(PasskeyUnlockMaterialResponse);

/// Typed admission boundary for an untrusted Chrome session response.
#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct ExtensionSessionOperationAdmission(
    nook_companion_core::ExtensionSessionOperationResponseWire,
);

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_passkey_setup_material_response(
    value: tsify::Ts<PasskeySetupMaterialAdmission>,
) -> Result<tsify::Ts<PasskeySetupMaterial>, wasm_bindgen::JsError> {
    let value = value
        .to_rust()
        .map_err(|_| wasm_bindgen::JsError::new("Typed WASM value could not be converted."))?;

    let PasskeySetupMaterialAdmission(value) = value;
    let result = match value.setup {
        PasskeySetupAvailability::Available(material) => Ok(material),
        PasskeySetupAvailability::Unavailable => Err(JsError::new(
            "Extension session returned a malformed setup response.",
        )),
    }?;
    tsify::Tsify::into_ts(&result)
        .map_err(|_| wasm_bindgen::JsError::new("Typed WASM value could not be converted."))
}
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_passkey_unlock_material_response(
    value: tsify::Ts<PasskeyUnlockMaterialAdmission>,
) -> Result<tsify::Ts<PasskeyUnlockMaterial>, wasm_bindgen::JsError> {
    let value = value
        .to_rust()
        .map_err(|_| wasm_bindgen::JsError::new("Typed WASM value could not be converted."))?;

    let PasskeyUnlockMaterialAdmission(value) = value;
    let result = match value.material {
        PasskeyUnlockAvailability::Available(material) => Ok(material),
        PasskeyUnlockAvailability::Unavailable => Err(JsError::new(
            "Extension session returned a malformed unlock response.",
        )),
    }?;
    tsify::Tsify::into_ts(&result)
        .map_err(|_| wasm_bindgen::JsError::new("Typed WASM value could not be converted."))
}
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn admit_passkey_byte_material(
    value: tsify::Ts<PasskeyByteMaterial>,
) -> Result<tsify::Ts<PasskeyByteMaterial>, wasm_bindgen::JsError> {
    let value = value
        .to_rust()
        .map_err(|_| wasm_bindgen::JsError::new("Typed WASM value could not be converted."))?;
    let result = { value };
    tsify::Tsify::into_ts(&result)
        .map_err(|_| wasm_bindgen::JsError::new("Typed WASM value could not be converted."))
}

/// Admit the full session device response at the unknown Chrome message boundary.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_extension_session_device_response(
    value: tsify::Ts<ExtensionSessionOperationAdmission>,
) -> Result<tsify::Ts<nook_companion_core::ExtensionSessionDeviceResponse>, wasm_bindgen::JsError> {
    let value = value
        .to_rust()
        .map_err(|_| wasm_bindgen::JsError::new("Typed WASM value could not be converted."))?;

    let ExtensionSessionOperationAdmission(value) = value;
    let result = value.into_device().map_err(|error| JsError::new(&error))?;
    tsify::Tsify::into_ts(&result)
        .map_err(|_| wasm_bindgen::JsError::new("Typed WASM value could not be converted."))
}
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_extension_session_status_details(
    value: tsify::Ts<ExtensionSessionOperationAdmission>,
) -> Result<tsify::Ts<nook_companion_core::ExtensionSessionStatus>, wasm_bindgen::JsError> {
    let value = value
        .to_rust()
        .map_err(|_| wasm_bindgen::JsError::new("Typed WASM value could not be converted."))?;

    let ExtensionSessionOperationAdmission(value) = value;
    let result = value.into_status().map_err(|error| JsError::new(&error))?;
    tsify::Tsify::into_ts(&result)
        .map_err(|_| wasm_bindgen::JsError::new("Typed WASM value could not be converted."))
}

/// Full configurations, not the identity-only metadata request projection.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn admit_extension_storage_providers(
    value: Vec<tsify::Ts<nook_core::StorageProvider>>,
) -> Result<Vec<tsify::Ts<nook_core::StorageProvider>>, wasm_bindgen::JsError> {
    let value = value
        .into_iter()
        .map(|value| value.to_rust())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| wasm_bindgen::JsError::new("Typed WASM value could not be converted."))?;
    let result = { value };
    result
        .iter()
        .map(tsify::Tsify::into_ts)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| wasm_bindgen::JsError::new("Typed WASM output could not be encoded."))
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
