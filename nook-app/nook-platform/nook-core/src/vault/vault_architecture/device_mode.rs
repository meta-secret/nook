use super::{ValidationError, ValidationResult, wasm_bindgen};
use serde::{Deserialize, Deserializer, Serialize, de::Error as DeError};

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Default)]
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

impl<'de> Deserialize<'de> for DeviceMode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).map_err(D::Error::custom)
    }
}
