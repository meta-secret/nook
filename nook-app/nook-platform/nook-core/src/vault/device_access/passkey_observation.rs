use crate::IsoTimestamp;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PasskeyObservedBrowser {
    #[default]
    Unknown,
    Edge,
    Firefox,
    Chrome,
    Safari,
    Other,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PasskeyObservedPlatform {
    #[default]
    Unknown,
    Android,
    AppleMobile,
    MacOs,
    Windows,
    Linux,
    Other,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, Deserialize, Ord, PartialEq, PartialOrd, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PasskeyTransport {
    Ble,
    Hybrid,
    Internal,
    Nfc,
    Usb,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PasskeyAuthenticatorAttachment {
    #[default]
    Unknown,
    Platform,
    CrossPlatform,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PasskeyBackupState {
    #[default]
    Unknown,
    NotEligible,
    Eligible,
    BackedUp,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyBrowserObservation {
    pub attachment: PasskeyAuthenticatorAttachment,
    pub transports: Vec<PasskeyTransport>,
    pub backup_state: PasskeyBackupState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aaguid: Option<String>,
    #[serde(default)]
    pub browser: PasskeyObservedBrowser,
    #[serde(default)]
    pub platform: PasskeyObservedPlatform,
    // Version 1 persisted an English `clientEnvironment` sentence. Accept and
    // discard it so old metadata remains readable without leaking presentation
    // text into localized UI.
    #[doc(hidden)]
    #[serde(default, alias = "clientEnvironment", skip_serializing)]
    pub legacy_client_environment: Option<String>,
}

impl PasskeyBrowserObservation {
    pub fn merge_usage(&mut self, usage: Self) {
        if self.attachment == PasskeyAuthenticatorAttachment::Unknown {
            self.attachment = usage.attachment;
        }
        if self.transports.is_empty() {
            self.transports = usage.transports;
        }
        if usage.backup_state != PasskeyBackupState::Unknown {
            self.backup_state = usage.backup_state;
        }
        if self.aaguid.is_none() {
            self.aaguid = usage.aaguid;
        }
        if usage.browser != PasskeyObservedBrowser::Unknown {
            self.browser = usage.browser;
        }
        if usage.platform != PasskeyObservedPlatform::Unknown {
            self.platform = usage.platform;
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PasskeyCreationCeremony {
    RegistrationOnly,
    RegistrationAndAssertion,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PasskeyCreatedAtEvidence {
    #[default]
    Unavailable,
    Known {
        timestamp: IsoTimestamp,
    },
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PasskeyLastUsedAtEvidence {
    NotYetObserved,
    #[default]
    Unavailable,
    Known {
        timestamp: IsoTimestamp,
    },
}

pub(super) fn deserialize_created_at_evidence<'de, D>(
    deserializer: D,
) -> Result<PasskeyCreatedAtEvidence, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum WireEvidence {
        Explicit(PasskeyCreatedAtEvidence),
        Legacy(Option<IsoTimestamp>),
    }

    Ok(match WireEvidence::deserialize(deserializer)? {
        WireEvidence::Explicit(evidence) => evidence,
        WireEvidence::Legacy(Some(timestamp)) => PasskeyCreatedAtEvidence::Known { timestamp },
        WireEvidence::Legacy(None) => PasskeyCreatedAtEvidence::Unavailable,
    })
}

pub(super) fn deserialize_last_used_at_evidence<'de, D>(
    deserializer: D,
) -> Result<PasskeyLastUsedAtEvidence, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum WireEvidence {
        Explicit(PasskeyLastUsedAtEvidence),
        Legacy(Option<IsoTimestamp>),
    }

    Ok(match WireEvidence::deserialize(deserializer)? {
        WireEvidence::Explicit(evidence) => evidence,
        WireEvidence::Legacy(Some(timestamp)) => PasskeyLastUsedAtEvidence::Known { timestamp },
        WireEvidence::Legacy(None) => PasskeyLastUsedAtEvidence::Unavailable,
    })
}
