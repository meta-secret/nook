//! Browser display projection for known or unavailable access metadata.
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookDeviceAccessTextKind {
    Unknown,
    Known,
}

#[derive(Clone)]
pub(super) enum NookDeviceAccessTextValue {
    Unknown,
    Known(String),
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookDeviceAccessText(pub(super) NookDeviceAccessTextValue);

impl NookDeviceAccessText {
    pub(super) fn from_string(value: String) -> Self {
        if value.is_empty() {
            Self(NookDeviceAccessTextValue::Unknown)
        } else {
            Self(NookDeviceAccessTextValue::Known(value))
        }
    }
}

#[wasm_bindgen]
impl NookDeviceAccessText {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn kind(&self) -> NookDeviceAccessTextKind {
        match self.0 {
            NookDeviceAccessTextValue::Unknown => NookDeviceAccessTextKind::Unknown,
            NookDeviceAccessTextValue::Known(_) => NookDeviceAccessTextKind::Known,
        }
    }

    pub fn value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            NookDeviceAccessTextValue::Unknown => {
                Err(JsError::new("Device access value is unknown"))
            }
            NookDeviceAccessTextValue::Known(value) => Ok(value.clone()),
        }
    }
}
