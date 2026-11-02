//! The duplicate-detection key of a provider.
use std::fmt;
use zeroize::{Zeroize, ZeroizeOnDrop};

/// A provider's duplicate-detection key. It can hold a token, so it is
/// redacted in `Debug` and wiped when dropped.
#[derive(Clone, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
pub struct ProviderTargetKey(String);

impl From<String> for ProviderTargetKey {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Debug for ProviderTargetKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ProviderTargetKey([redacted])")
    }
}
