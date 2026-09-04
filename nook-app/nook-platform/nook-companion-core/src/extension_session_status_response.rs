//! Closed decoder for extension-session status responses.

use serde::{Deserialize, Deserializer, de::Error as _};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ExtensionSessionDeviceProtectionStatusWire {
    Loading,
    Missing,
    Plaintext,
    Passkey,
    Pin,
    PinSetup,
    Unlocked,
    Error,
    #[default]
    Unknown,
}

impl<'de> Deserialize<'de> for ExtensionSessionDeviceProtectionStatusWire {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        match u32::deserialize(deserializer)? {
            0 => Ok(Self::Loading),
            1 => Ok(Self::Missing),
            2 => Ok(Self::Plaintext),
            3 => Ok(Self::Passkey),
            4 => Ok(Self::Pin),
            5 => Ok(Self::PinSetup),
            6 => Ok(Self::Unlocked),
            7 => Ok(Self::Error),
            value => Err(D::Error::custom(format!(
                "invalid extension session device protection status: {value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExtensionSessionDeviceWire {
    #[serde(rename = "deviceId")]
    id: String,
    #[serde(rename = "devicePublicKey")]
    public_key: String,
    #[serde(rename = "deviceSigningPublicKey")]
    signing_public_key: String,
}

impl ExtensionSessionDeviceWire {
    fn is_complete(&self) -> bool {
        !self.id.trim().is_empty()
            && !self.public_key.trim().is_empty()
            && !self.signing_public_key.trim().is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(from_wasm_abi)]
pub struct ExtensionSessionStatusResponseWire {
    ok: bool,
    #[serde(default)]
    status: ExtensionSessionDeviceProtectionStatusWire,
    #[serde(default)]
    device: ExtensionSessionDeviceWire,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtensionSessionStatusAvailability {
    Unavailable,
    Locked,
    Unlocked,
}

#[must_use]
pub fn decode_extension_session_status_response(
    response: &ExtensionSessionStatusResponseWire,
) -> ExtensionSessionStatusAvailability {
    if !response.ok {
        return ExtensionSessionStatusAvailability::Unavailable;
    }
    match response.status {
        ExtensionSessionDeviceProtectionStatusWire::Missing
        | ExtensionSessionDeviceProtectionStatusWire::Plaintext
        | ExtensionSessionDeviceProtectionStatusWire::Passkey
        | ExtensionSessionDeviceProtectionStatusWire::Pin => {
            ExtensionSessionStatusAvailability::Locked
        }
        ExtensionSessionDeviceProtectionStatusWire::Unlocked if response.device.is_complete() => {
            ExtensionSessionStatusAvailability::Unlocked
        }
        ExtensionSessionDeviceProtectionStatusWire::Loading
        | ExtensionSessionDeviceProtectionStatusWire::PinSetup
        | ExtensionSessionDeviceProtectionStatusWire::Error
        | ExtensionSessionDeviceProtectionStatusWire::Unlocked
        | ExtensionSessionDeviceProtectionStatusWire::Unknown => {
            ExtensionSessionStatusAvailability::Unavailable
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(json: &str) -> anyhow::Result<ExtensionSessionStatusAvailability> {
        let wire = serde_json::from_str::<ExtensionSessionStatusResponseWire>(json)?;
        Ok(decode_extension_session_status_response(&wire))
    }

    #[test]
    fn classifies_only_supported_complete_session_states() -> anyhow::Result<()> {
        for unavailable in [
            r#"{"ok":false,"status":4}"#,
            r#"{"ok":true}"#,
            r#"{"ok":true,"status":0}"#,
            r#"{"ok":true,"status":5}"#,
            r#"{"ok":true,"status":7}"#,
            r#"{"ok":true,"status":6}"#,
            r#"{"ok":true,"status":6,"device":{"deviceId":"","devicePublicKey":"public","deviceSigningPublicKey":"signing"}}"#,
        ] {
            assert_eq!(
                decode(unavailable)?,
                ExtensionSessionStatusAvailability::Unavailable
            );
        }
        for locked in [1, 2, 3, 4] {
            let json = format!(r#"{{"ok":true,"status":{locked}}}"#);
            assert_eq!(decode(&json)?, ExtensionSessionStatusAvailability::Locked);
        }
        assert_eq!(
            decode(
                r#"{"ok":true,"status":6,"device":{"deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing"}}"#,
            )?,
            ExtensionSessionStatusAvailability::Unlocked
        );
        Ok(())
    }
}
