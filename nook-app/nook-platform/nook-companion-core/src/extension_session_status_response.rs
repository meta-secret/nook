//! Closed decoder for extension-session status responses.

use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(try_from = "u32")]
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

impl TryFrom<u32> for ExtensionSessionDeviceProtectionStatusWire {
    type Error = String;
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: admits the existing numeric wire representation"
        )
    )]
    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Loading),
            1 => Ok(Self::Missing),
            2 => Ok(Self::Plaintext),
            3 => Ok(Self::Passkey),
            4 => Ok(Self::Pin),
            5 => Ok(Self::PinSetup),
            6 => Ok(Self::Unlocked),
            7 => Ok(Self::Error),
            value => Err(format!(
                "invalid extension session device protection status: {value}"
            )),
        }
    }
}

impl Serialize for ExtensionSessionDeviceProtectionStatusWire {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_u32(*self as u32)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize, Tsify)]
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

impl ExtensionSessionStatusAvailability {
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
            ExtensionSessionDeviceProtectionStatusWire::Unlocked
                if response.device.is_complete() =>
            {
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
}

/// Concrete success payload owned by the extension-session protocol.
#[derive(Debug, Clone, Serialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct ExtensionSessionDeviceResponse {
    pub device: ExtensionSessionDeviceWire,
}
#[derive(Debug, Clone, Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[tsify(into_wasm_abi)]
pub enum ExtensionSessionStatus {
    Inactive {
        status: ExtensionSessionDeviceProtectionStatusWire,
    },
    Active {
        status: ExtensionSessionDeviceProtectionStatusWire,
        device: ExtensionSessionDeviceWire,
    },
}

#[derive(Default, Deserialize)]
#[serde(untagged)]
enum SessionDeviceReport {
    Identity(ExtensionSessionDeviceWire),
    #[default]
    Unreported,
}
#[derive(Default, Deserialize)]
#[serde(untagged)]
enum SessionProtectionReport {
    Reported(ExtensionSessionDeviceProtectionStatusWire),
    #[default]
    Unreported,
}
#[derive(Default, Deserialize)]
#[serde(untagged)]
enum SessionFailureDiagnostic {
    Reported(String),
    #[default]
    Unreported,
}
/// Unknown browser responses are admitted before any success value is projected.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionSessionOperationResponseWire {
    ok: bool,
    #[serde(default)]
    device: SessionDeviceReport,
    #[serde(default)]
    status: SessionProtectionReport,
    #[serde(default)]
    error: SessionFailureDiagnostic,
    #[serde(default)]
    reason: SessionFailureDiagnostic,
}
impl ExtensionSessionOperationResponseWire {
    pub fn into_device(self) -> Result<ExtensionSessionDeviceResponse, String> {
        if !self.ok {
            return Err(match self.error {
                SessionFailureDiagnostic::Reported(error) => error,
                SessionFailureDiagnostic::Unreported => match self.reason {
                    SessionFailureDiagnostic::Reported(reason) => reason,
                    SessionFailureDiagnostic::Unreported => {
                        "Extension session operation failed.".to_owned()
                    }
                },
            });
        }
        let SessionDeviceReport::Identity(device) = self.device else {
            return Err("Extension session did not return device identity.".to_owned());
        };
        if device.id.is_empty()
            || device.public_key.is_empty()
            || device.signing_public_key.is_empty()
        {
            return Err("Extension session returned invalid device identity.".to_owned());
        }
        Ok(ExtensionSessionDeviceResponse { device })
    }
    pub fn into_status(self) -> Result<ExtensionSessionStatus, String> {
        if !self.ok {
            return Err(match self.error {
                SessionFailureDiagnostic::Reported(error) => error,
                SessionFailureDiagnostic::Unreported => match self.reason {
                    SessionFailureDiagnostic::Reported(reason) => reason,
                    SessionFailureDiagnostic::Unreported => {
                        "Extension session operation failed.".to_owned()
                    }
                },
            });
        }
        let SessionProtectionReport::Reported(status) = &self.status else {
            return Err("Unsupported extension device protection status.".to_owned());
        };
        let status = *status;
        if status == ExtensionSessionDeviceProtectionStatusWire::Unlocked {
            let response = self.into_device()?;
            Ok(ExtensionSessionStatus::Active {
                status,
                device: response.device,
            })
        } else {
            Ok(ExtensionSessionStatus::Inactive { status })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(json: &str) -> anyhow::Result<ExtensionSessionStatusAvailability> {
        let wire = serde_json::from_str::<ExtensionSessionStatusResponseWire>(json)?;
        Ok(ExtensionSessionStatusAvailability::decode_extension_session_status_response(&wire))
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
