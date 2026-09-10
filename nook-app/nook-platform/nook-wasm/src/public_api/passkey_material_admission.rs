//! Unknown extension messages enter typed passkey schemas at this JS boundary.
use nook_companion_core::{
    PasskeyByteMaterial, PasskeySetupAvailability, PasskeySetupMaterial,
    PasskeySetupMaterialResponse, PasskeyUnlockAvailability, PasskeyUnlockMaterial,
    PasskeyUnlockMaterialResponse,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_passkey_setup_material_response(
    value: PasskeySetupMaterialResponse,
) -> Result<PasskeySetupMaterial, JsError> {
    match value.setup {
        PasskeySetupAvailability::Available(material) => Ok(material),
        PasskeySetupAvailability::Unavailable => Err(JsError::new(
            "Extension session returned a malformed setup response.",
        )),
    }
}
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_passkey_unlock_material_response(
    value: PasskeyUnlockMaterialResponse,
) -> Result<PasskeyUnlockMaterial, JsError> {
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
    value: nook_companion_core::ExtensionSessionOperationResponseWire,
) -> Result<nook_companion_core::ExtensionSessionDeviceResponse, JsError> {
    value.into_device().map_err(|error| JsError::new(&error))
}
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_extension_session_status_details(
    value: nook_companion_core::ExtensionSessionOperationResponseWire,
) -> Result<nook_companion_core::ExtensionSessionStatus, JsError> {
    value.into_status().map_err(|error| JsError::new(&error))
}

/// Full configurations, not the identity-only metadata request projection.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn admit_extension_storage_providers(
    value: Vec<nook_core::StorageProvider>,
) -> Vec<nook_core::StorageProvider> {
    value
}
