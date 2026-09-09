use std::{
    fmt::{self, Display},
    num::TryFromIntError,
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PasswordCharacterCount(pub(crate) usize);
impl PasswordCharacterCount {
    pub const VAULT_MINIMUM: Self = Self(5);
    pub const RECOMMENDED_MINIMUM: Self = Self(8);
    pub const GENERATOR_MAXIMUM: Self = Self(128);
}
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct IdentityControlEpoch(pub(crate) u64);
impl IdentityControlEpoch {
    pub const INITIAL: Self = Self(1);

    #[must_use]
    pub const fn next(self) -> Self {
        Self(self.0.saturating_add(1))
    }
}
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
impl SentinelParticipantCount {
    pub(crate) fn try_from_len(value: usize) -> Result<Self, TryFromIntError> {
        u8::try_from(value).map(Self)
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SentinelShareCount(pub(crate) usize);
impl From<usize> for SentinelShareCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}
impl From<SentinelShareCount> for usize {
    fn from(value: SentinelShareCount) -> Self {
        value.0
    }
}
impl Display for SentinelShareCount {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_count_and_control_epoch_preserve_scalar_wires() -> anyhow::Result<()> {
        let count = PasswordCharacterCount::RECOMMENDED_MINIMUM;
        let epoch = IdentityControlEpoch::INITIAL.next();
        assert_eq!(serde_json::to_string(&count)?, "8");
        assert_eq!(serde_json::from_str::<PasswordCharacterCount>("8")?, count);
        assert_eq!(serde_json::to_string(&epoch)?, "2");
        assert_eq!(serde_json::from_str::<IdentityControlEpoch>("2")?, epoch);
        assert_eq!(IdentityControlEpoch::from(u64::MAX).next(), u64::MAX.into());
        Ok(())
    }
}

impl SentinelParticipantCount {
    pub const MIN_QUORUM: Self = Self(2);
    pub const MAX_QUORUM: Self = Self(16);
    pub const fn is_zero(self) -> bool {
        self.0 == 0
    }
    pub const fn is_supported_quorum(self) -> bool {
        self.0 >= Self::MIN_QUORUM.0 && self.0 <= Self::MAX_QUORUM.0
    }
    pub const fn has_reached(self, required: Self) -> bool {
        self.0 >= required.0
    }
    pub const fn fits_within(self, required: Self) -> bool {
        self.0 <= required.0
    }
    pub fn matches_share_count(self, actual: SentinelShareCount) -> bool {
        usize::from(self.0) == actual.0
    }
    pub fn supported_quorums() -> Vec<Self> {
        (Self::MIN_QUORUM.0..=Self::MAX_QUORUM.0)
            .map(Self)
            .collect()
    }
}
impl SentinelThreshold {
    pub const fn is_valid_for(self, participants: SentinelParticipantCount) -> bool {
        self.0 >= SentinelParticipantCount::MIN_QUORUM.0 && self.0 <= participants.0
    }
    pub fn supported_for(participants: SentinelParticipantCount) -> Vec<Self> {
        if participants.is_supported_quorum() {
            (SentinelParticipantCount::MIN_QUORUM.0..=participants.0)
                .map(Self)
                .collect()
        } else {
            Vec::new()
        }
    }
}
impl SentinelShareIndex {
    pub const fn belongs_to(self, participants: SentinelParticipantCount) -> bool {
        self.0 != 0 && self.0 <= participants.0
    }
}
impl TryFrom<usize> for SentinelParticipantCount {
    type Error = TryFromIntError;
    fn try_from(count: usize) -> Result<Self, Self::Error> {
        u8::try_from(count).map(Self)
    }
}
