//! Unknown extension messages enter typed passkey schemas at this JS boundary.
use nook_companion_core::{
    PasskeyByteMaterial, PasskeySetupAvailability, PasskeySetupMaterial,
    PasskeySetupMaterialResponse, PasskeyUnlockAvailability, PasskeyUnlockMaterial,
    PasskeyUnlockMaterialResponse,
};
use wasm_bindgen::{JsError, JsValue, prelude::wasm_bindgen};

#[wasm_bindgen]
pub fn decode_passkey_setup_material_response(
    value: JsValue,
) -> Result<PasskeySetupMaterial, JsError> {
    match serde_wasm_bindgen::from_value::<PasskeySetupMaterialResponse>(value)
        .map_err(|_| JsError::new("Extension session returned malformed byte material."))?
        .setup
    {
        PasskeySetupAvailability::Available(material) => Ok(material),
        PasskeySetupAvailability::Unavailable => Err(JsError::new(
            "Extension session returned a malformed setup response.",
        )),
    }
}
#[wasm_bindgen]
pub fn decode_passkey_unlock_material_response(
    value: JsValue,
) -> Result<PasskeyUnlockMaterial, JsError> {
    match serde_wasm_bindgen::from_value::<PasskeyUnlockMaterialResponse>(value)
        .map_err(|_| JsError::new("Extension session returned malformed byte material."))?
        .material
    {
        PasskeyUnlockAvailability::Available(material) => Ok(material),
        PasskeyUnlockAvailability::Unavailable => Err(JsError::new(
            "Extension session returned a malformed unlock response.",
        )),
    }
}
#[wasm_bindgen]
pub fn admit_passkey_byte_material(value: JsValue) -> Result<PasskeyByteMaterial, JsError> {
    serde_wasm_bindgen::from_value(value)
        .map_err(|_| JsError::new("Extension session received invalid key material."))
}

/// Admit the full session device response at the unknown Chrome message boundary.
#[wasm_bindgen]
pub fn decode_extension_session_device_response(
    value: JsValue,
) -> Result<nook_companion_core::ExtensionSessionDeviceResponse, JsError> {
    serde_wasm_bindgen::from_value::<nook_companion_core::ExtensionSessionOperationResponseWire>(
        value,
    )
    .map_err(|_| JsError::new("Extension session returned malformed device identity."))?
    .into_device()
    .map_err(|error| JsError::new(&error))
}
#[wasm_bindgen]
pub fn decode_extension_session_status_details(
    value: JsValue,
) -> Result<nook_companion_core::ExtensionSessionStatus, JsError> {
    serde_wasm_bindgen::from_value::<nook_companion_core::ExtensionSessionOperationResponseWire>(
        value,
    )
    .map_err(|_| JsError::new("Extension session returned malformed status."))?
    .into_status()
    .map_err(|error| JsError::new(&error))
}

/// Full configurations, not the identity-only metadata request projection.
#[wasm_bindgen]
pub fn admit_extension_storage_providers(
    value: JsValue,
) -> Result<Vec<nook_core::StorageProvider>, JsError> {
    serde_wasm_bindgen::from_value(value)
        .map_err(|_| JsError::new("Extension session received invalid provider configuration."))
}
