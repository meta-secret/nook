use super::{ValidationError, ValidationResult, wasm_bindgen};
use serde::{Deserialize, Serialize};

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Default, Deserialize)]
#[serde(try_from = "String")]
#[serde(rename_all = "kebab-case")]
pub enum DeviceMode {
    /// Passkey PRF deterministically derives the local age/device identity.
    #[default]
    Standard,
    /// Passkey PRF unwraps a randomly generated age/device identity stored locally.
    AntiHacker,
}

impl DeviceMode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::AntiHacker => "anti-hacker",
        }
    }

    pub fn parse(value: &str) -> ValidationResult<Self> {
        match value {
            "" | "standard" => Ok(Self::Standard),
            "anti-hacker" => Ok(Self::AntiHacker),
            other => Err(ValidationError::UnknownDeviceMode {
                mode: other.to_owned(),
            }),
        }
    }
}

impl TryFrom<String> for DeviceMode {
    type Error = ValidationError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}
