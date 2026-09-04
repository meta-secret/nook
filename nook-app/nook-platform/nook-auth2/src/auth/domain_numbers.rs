use std::fmt::{self, Display};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct IdentityControlEpoch(pub(crate) u64);
impl From<u64> for IdentityControlEpoch {
    fn from(value: u64) -> Self {
        Self(value)
    }
}
impl From<IdentityControlEpoch> for u64 {
    fn from(value: IdentityControlEpoch) -> Self {
        value.0
    }
}
impl IdentityControlEpoch {
    pub(crate) const fn next(self) -> Self {
        Self(self.0.saturating_add(1))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MockPasskeyCredentialCount(pub(crate) usize);
impl From<usize> for MockPasskeyCredentialCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}
impl From<MockPasskeyCredentialCount> for usize {
    fn from(value: MockPasskeyCredentialCount) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DeviceKeyDerivationIterations(pub(crate) u32);
impl From<u32> for DeviceKeyDerivationIterations {
    fn from(value: u32) -> Self {
        Self(value)
    }
}
impl From<DeviceKeyDerivationIterations> for u32 {
    fn from(value: DeviceKeyDerivationIterations) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EnrollmentKeyDerivationIterations(pub(crate) u32);
impl From<u32> for EnrollmentKeyDerivationIterations {
    fn from(value: u32) -> Self {
        Self(value)
    }
}
impl From<EnrollmentKeyDerivationIterations> for u32 {
    fn from(value: EnrollmentKeyDerivationIterations) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PasswordCharacterCount(pub(crate) usize);
impl From<usize> for PasswordCharacterCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}
impl From<PasswordCharacterCount> for usize {
    fn from(value: PasswordCharacterCount) -> Self {
        value.0
    }
}
impl Display for PasswordCharacterCount {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PasswordWorkFactor(pub(crate) u8);
impl From<u8> for PasswordWorkFactor {
    fn from(value: u8) -> Self {
        Self(value)
    }
}
impl From<PasswordWorkFactor> for u8 {
    fn from(value: PasswordWorkFactor) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SentinelParticipantCount(pub(crate) u8);
impl From<u8> for SentinelParticipantCount {
    fn from(value: u8) -> Self {
        Self(value)
    }
}
impl From<SentinelParticipantCount> for u8 {
    fn from(value: SentinelParticipantCount) -> Self {
        value.0
    }
}
impl Display for SentinelParticipantCount {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SentinelRecordCount(pub(crate) usize);
impl From<usize> for SentinelRecordCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}
impl From<SentinelRecordCount> for usize {
    fn from(value: SentinelRecordCount) -> Self {
        value.0
    }
}
impl Display for SentinelRecordCount {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SentinelShareIndex(pub(crate) u8);
impl From<u8> for SentinelShareIndex {
    fn from(value: u8) -> Self {
        Self(value)
    }
}
impl From<SentinelShareIndex> for u8 {
    fn from(value: SentinelShareIndex) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SentinelThreshold(pub(crate) u8);
impl From<u8> for SentinelThreshold {
    fn from(value: u8) -> Self {
        Self(value)
    }
}
impl From<SentinelThreshold> for u8 {
    fn from(value: SentinelThreshold) -> Self {
        value.0
    }
}
impl Display for SentinelThreshold {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}
