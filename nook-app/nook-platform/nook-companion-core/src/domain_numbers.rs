//! Numeric domains owned by companion authentication outcome evidence.

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
