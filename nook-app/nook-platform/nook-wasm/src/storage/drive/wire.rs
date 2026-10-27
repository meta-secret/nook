//! Drive's nullable metadata observations, before operation-specific admission.
use serde::Deserialize;

#[derive(Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub(crate) enum FileIdentity {
    Reported(String),
    #[default]
    Unreported,
}
#[derive(Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub(crate) enum FileName {
    Reported(String),
    #[default]
    Unreported,
}
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub(crate) enum PageCompletion {
    Continue(String),
    #[default]
    Complete,
}
/// Drive's `createdTime` for a listed file, when the listing asked for it.
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub(crate) enum CreatedTime {
    Reported(String),
    #[default]
    Unreported,
}

impl CreatedTime {
    /// The listed creation time; a reported value Drive did not format as
    /// RFC 3339 fails closed.
    pub(crate) fn provider_time(&self) -> Result<nook_core::ProviderVaultTime, crate::NookError> {
        match self {
            Self::Unreported => Ok(nook_core::ProviderVaultTime::Unreported),
            Self::Reported(raw) => Ok(nook_core::ProviderVaultTime::Reported {
                at: nook_core::ProviderInstant::parse_rfc3339(raw)?,
            }),
        }
    }
}
