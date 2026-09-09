//! Unknown extension messages enter typed passkey schemas at this JS boundary.
use nook_companion_core::{
    PasskeyByteMaterial, PasskeySetupMaterial, PasskeySetupMaterialResponse, PasskeyUnlockMaterial,
    PasskeyUnlockMaterialResponse,
};
use wasm_bindgen::{JsError, JsValue, prelude::wasm_bindgen};

#[wasm_bindgen]
pub fn decode_passkey_setup_material_response(
    value: JsValue,
) -> Result<PasskeySetupMaterial, JsError> {
    serde_wasm_bindgen::from_value::<PasskeySetupMaterialResponse>(value)
        .map_err(|_| JsError::new("Extension session returned malformed byte material."))?
        .setup
        .ok_or_else(|| JsError::new("Extension session returned a malformed setup response."))
}
#[wasm_bindgen]
pub fn decode_passkey_unlock_material_response(
    value: JsValue,
) -> Result<PasskeyUnlockMaterial, JsError> {
    serde_wasm_bindgen::from_value::<PasskeyUnlockMaterialResponse>(value)
        .map_err(|_| JsError::new("Extension session returned malformed byte material."))?
        .material
        .ok_or_else(|| JsError::new("Extension session returned a malformed unlock response."))
}
#[wasm_bindgen]
pub fn admit_passkey_byte_material(value: JsValue) -> Result<PasskeyByteMaterial, JsError> {
    serde_wasm_bindgen::from_value(value)
        .map_err(|_| JsError::new("Extension session received invalid key material."))
}
