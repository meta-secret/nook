//! Numeric domains owned by portable companion behavior.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct AuthenticationOutcomeElapsedMilliseconds(u32);

impl AuthenticationOutcomeElapsedMilliseconds {
    pub(crate) const fn raw(self) -> u32 {
        self.0
    }
}

impl From<u32> for AuthenticationOutcomeElapsedMilliseconds {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct AuthenticationOutcomeTimeoutMilliseconds(u32);

impl AuthenticationOutcomeTimeoutMilliseconds {
    pub(crate) const fn from_raw(value: u32) -> Self {
        Self(value)
    }

    pub(crate) const fn raw(self) -> u32 {
        self.0
    }
}

impl From<u32> for AuthenticationOutcomeTimeoutMilliseconds {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct AuthenticationFieldCount(pub(crate) u32);

impl AuthenticationFieldCount {
    pub(crate) const fn raw(self) -> u32 {
        self.0
    }
}

impl From<u32> for AuthenticationFieldCount {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct AuthenticationSemanticSubmitControlCount(u32);

impl AuthenticationSemanticSubmitControlCount {
    pub(crate) const fn raw(self) -> u32 {
        self.0
    }
}

impl From<u32> for AuthenticationSemanticSubmitControlCount {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct AuthenticationPasskeyAccountCount(u32);

impl AuthenticationPasskeyAccountCount {
    pub(crate) const ZERO: Self = Self(0);

    pub(crate) const fn raw(self) -> u32 {
        self.0
    }
}

impl From<u32> for AuthenticationPasskeyAccountCount {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct AuthenticationSavedLoginAccountCount(u32);

impl AuthenticationSavedLoginAccountCount {
    pub const ZERO: Self = Self(0);
}

impl From<u32> for AuthenticationSavedLoginAccountCount {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct AuthenticationWorkflowCurrentStep(pub(crate) u8);

impl AuthenticationWorkflowCurrentStep {
    pub(crate) const fn raw(self) -> u8 {
        self.0
    }
}

impl From<u8> for AuthenticationWorkflowCurrentStep {
    fn from(value: u8) -> Self {
        Self(value)
    }
}

impl From<AuthenticationWorkflowCurrentStep> for u8 {
    fn from(value: AuthenticationWorkflowCurrentStep) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct AuthenticationWorkflowTotalSteps(pub(crate) u8);

impl AuthenticationWorkflowTotalSteps {
    pub(crate) const fn raw(self) -> u8 {
        self.0
    }
}

impl From<u8> for AuthenticationWorkflowTotalSteps {
    fn from(value: u8) -> Self {
        Self(value)
    }
}

impl From<AuthenticationWorkflowTotalSteps> for u8 {
    fn from(value: AuthenticationWorkflowTotalSteps) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct AuthenticationWorkflowObservationIndex(pub(crate) u32);

impl AuthenticationWorkflowObservationIndex {
    pub(crate) const fn raw(self) -> u32 {
        self.0
    }
}

impl From<u32> for AuthenticationWorkflowObservationIndex {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

impl From<AuthenticationWorkflowObservationIndex> for u32 {
    fn from(value: AuthenticationWorkflowObservationIndex) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct ExtensionSyncProviderCount(u32);

impl ExtensionSyncProviderCount {
    pub(crate) const fn raw(self) -> u32 {
        self.0
    }
}

impl From<u32> for ExtensionSyncProviderCount {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct ExtensionEventCount(u32);

impl ExtensionEventCount {
    pub(crate) const fn raw(self) -> u32 {
        self.0
    }
}

impl From<u32> for ExtensionEventCount {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timing_domains_preserve_scalar_json() -> anyhow::Result<()> {
        let elapsed = AuthenticationOutcomeElapsedMilliseconds::from(250);
        let timeout = AuthenticationOutcomeTimeoutMilliseconds::from(8_000);
        assert_eq!(serde_json::to_string(&elapsed)?, "250");
        assert_eq!(
            serde_json::from_str::<AuthenticationOutcomeElapsedMilliseconds>("250")?,
            elapsed
        );
        assert_eq!(serde_json::to_string(&timeout)?, "8000");
        assert_eq!(
            serde_json::from_str::<AuthenticationOutcomeTimeoutMilliseconds>("8000")?,
            timeout
        );
        Ok(())
    }
}
