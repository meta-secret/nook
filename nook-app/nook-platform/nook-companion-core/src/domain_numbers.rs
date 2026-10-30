//! Event and provider counts owned by extension pairing protocol.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct ExtensionSyncProviderCount(u32);

impl From<u32> for ExtensionSyncProviderCount {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct ExtensionEventCount(u32);

impl From<u32> for ExtensionEventCount {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

impl ExtensionEventCount {
    #[must_use]
    pub const fn is_zero(self) -> bool {
        self.0 == 0
    }
}
