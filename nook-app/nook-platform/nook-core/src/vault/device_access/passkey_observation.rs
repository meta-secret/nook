use crate::IsoTimestamp;
use serde::de::{Error as DeserializeError, Visitor};
use serde::{Deserialize, Serialize};
use std::fmt;
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

/// Browser-reported authenticator identity evidence, never an authorization proof.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum AuthenticatorGuidEvidence {
    #[default]
    NotReported,
    Reported(String),
}
impl AuthenticatorGuidEvidence {
    pub fn is_unreported(&self) -> bool {
        matches!(self, Self::NotReported)
    }
}

/// Historical English metadata is admitted as string/null and immediately discarded.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DiscardedClientEnvironment;
impl<'de> Deserialize<'de> for DiscardedClientEnvironment {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(Self)
    }
}
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "serialization boundary: serde Visitor owns the inherited numeric method signatures"
    )
)]
impl<'de> Visitor<'de> for DiscardedClientEnvironment {
    type Value = Self;
    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a legacy client environment string or null")
    }
    fn visit_unit<E: DeserializeError>(self) -> Result<Self, E> {
        Ok(self)
    }
    fn visit_str<E: DeserializeError>(self, _: &str) -> Result<Self, E> {
        Ok(self)
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyBrowserObservation {
    pub attachment: PasskeyAuthenticatorAttachment,
    pub transports: Vec<PasskeyTransport>,
    pub backup_state: PasskeyBackupState,
    #[serde(
        default,
        skip_serializing_if = "AuthenticatorGuidEvidence::is_unreported"
    )]
    pub aaguid: AuthenticatorGuidEvidence,
    #[serde(default)]
    pub browser: PasskeyObservedBrowser,
    #[serde(default)]
    pub platform: PasskeyObservedPlatform,
    // Version 1 persisted an English `clientEnvironment` sentence. Accept and
    // discard it so old metadata remains readable without leaking presentation
    // text into localized UI.
    #[doc(hidden)]
    #[serde(default, alias = "clientEnvironment", skip_serializing)]
    pub legacy_client_environment: DiscardedClientEnvironment,
}

impl PasskeyBrowserObservation {
    #[must_use]
    pub fn merge_usage(mut self, usage: Self) -> Self {
        if self.attachment == PasskeyAuthenticatorAttachment::Unknown {
            self.attachment = usage.attachment;
        }
        if self.transports.is_empty() {
            self.transports = usage.transports;
        }
        if usage.backup_state != PasskeyBackupState::Unknown {
            self.backup_state = usage.backup_state;
        }
        if matches!(self.aaguid, AuthenticatorGuidEvidence::NotReported) {
            self.aaguid = usage.aaguid;
        }
        if usage.browser != PasskeyObservedBrowser::Unknown {
            self.browser = usage.browser;
        }
        if usage.platform != PasskeyObservedPlatform::Unknown {
            self.platform = usage.platform;
        }
        self
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

#[derive(Deserialize)]
#[serde(untagged)]
pub(super) enum PasskeyCreatedAtEvidenceWire {
    Explicit(PasskeyCreatedAtEvidence),
    LegacyTimestamp(IsoTimestamp),
    LegacyUnavailable,
}
impl Default for PasskeyCreatedAtEvidenceWire {
    fn default() -> Self {
        Self::LegacyUnavailable
    }
}
impl From<PasskeyCreatedAtEvidenceWire> for PasskeyCreatedAtEvidence {
    fn from(wire: PasskeyCreatedAtEvidenceWire) -> Self {
        match wire {
            PasskeyCreatedAtEvidenceWire::Explicit(evidence) => evidence,
            PasskeyCreatedAtEvidenceWire::LegacyTimestamp(timestamp) => Self::Known { timestamp },
            PasskeyCreatedAtEvidenceWire::LegacyUnavailable => Self::Unavailable,
        }
    }
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

#[derive(Deserialize)]
#[serde(untagged)]
pub(super) enum PasskeyLastUsedAtEvidenceWire {
    Explicit(PasskeyLastUsedAtEvidence),
    LegacyTimestamp(IsoTimestamp),
    LegacyUnavailable,
}
impl Default for PasskeyLastUsedAtEvidenceWire {
    fn default() -> Self {
        Self::LegacyUnavailable
    }
}
impl From<PasskeyLastUsedAtEvidenceWire> for PasskeyLastUsedAtEvidence {
    fn from(wire: PasskeyLastUsedAtEvidenceWire) -> Self {
        match wire {
            PasskeyLastUsedAtEvidenceWire::Explicit(evidence) => evidence,
            PasskeyLastUsedAtEvidenceWire::LegacyTimestamp(timestamp) => Self::Known { timestamp },
            PasskeyLastUsedAtEvidenceWire::LegacyUnavailable => Self::Unavailable,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_usage_preserves_creation_evidence_and_applies_observed_usage() {
        let mut creation = PasskeyBrowserObservation {
            attachment: PasskeyAuthenticatorAttachment::Platform,
            transports: vec![PasskeyTransport::Internal],
            backup_state: PasskeyBackupState::Eligible,
            aaguid: AuthenticatorGuidEvidence::Reported("aaguid-one".to_owned()),
            browser: PasskeyObservedBrowser::Safari,
            platform: PasskeyObservedPlatform::MacOs,
            legacy_client_environment: DiscardedClientEnvironment,
        };

        creation = creation.merge_usage(PasskeyBrowserObservation {
            backup_state: PasskeyBackupState::BackedUp,
            browser: PasskeyObservedBrowser::Firefox,
            platform: PasskeyObservedPlatform::Linux,
            ..PasskeyBrowserObservation::default()
        });

        assert_eq!(
            creation.attachment,
            PasskeyAuthenticatorAttachment::Platform
        );
        assert_eq!(creation.transports, [PasskeyTransport::Internal]);
        assert_eq!(creation.backup_state, PasskeyBackupState::BackedUp);
        assert_eq!(
            creation.aaguid,
            AuthenticatorGuidEvidence::Reported("aaguid-one".to_owned())
        );
        assert_eq!(creation.browser, PasskeyObservedBrowser::Firefox);
        assert_eq!(creation.platform, PasskeyObservedPlatform::Linux);
    }
}
