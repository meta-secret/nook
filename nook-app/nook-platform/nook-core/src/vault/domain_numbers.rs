//! Numeric domains owned by vault storage, policy, paging, and synchronization.

use serde::{Deserialize, Serialize};
use std::fmt;
use tsify::Tsify;

/// Number of unresolved vault-storage security conflicts.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct VaultSecurityConflictCount(usize);

impl VaultSecurityConflictCount {
    pub(crate) const fn is_nonzero(self) -> bool {
        self.0 > 0
    }
}

impl From<usize> for VaultSecurityConflictCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<VaultSecurityConflictCount> for usize {
    fn from(value: VaultSecurityConflictCount) -> Self {
        value.0
    }
}

/// Number of password-unlock entries available for a vault.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct VaultPasswordEntryCount(usize);

impl VaultPasswordEntryCount {
    pub(crate) const fn is_zero(self) -> bool {
        self.0 == 0
    }

    pub(crate) const fn is_nonzero(self) -> bool {
        self.0 > 0
    }
}

impl From<usize> for VaultPasswordEntryCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<VaultPasswordEntryCount> for usize {
    fn from(value: VaultPasswordEntryCount) -> Self {
        value.0
    }
}

/// Number of configured vault synchronization providers.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct VaultSyncProviderCount(usize);

impl VaultSyncProviderCount {
    pub(crate) const fn is_zero(self) -> bool {
        self.0 == 0
    }

    pub(crate) const fn is_nonzero(self) -> bool {
        self.0 > 0
    }
}

impl From<usize> for VaultSyncProviderCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<VaultSyncProviderCount> for usize {
    fn from(value: VaultSyncProviderCount) -> Self {
        value.0
    }
}

/// Number of local vaults available for selection.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LocalVaultCount(usize);

impl LocalVaultCount {
    pub(crate) const fn is_multiple(self) -> bool {
        self.0 > 1
    }
}

impl From<usize> for LocalVaultCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<LocalVaultCount> for usize {
    fn from(value: LocalVaultCount) -> Self {
        value.0
    }
}

/// Number of devices enrolled for vault recovery.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EnrolledDeviceCount(usize);

impl From<usize> for EnrolledDeviceCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<EnrolledDeviceCount> for usize {
    fn from(value: EnrolledDeviceCount) -> Self {
        value.0
    }
}

/// Number of secret records matching a page query.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SecretRecordCount(usize);

impl From<usize> for SecretRecordCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<SecretRecordCount> for usize {
    fn from(value: SecretRecordCount) -> Self {
        value.0
    }
}

/// Zero-based offset into a secret-query result set.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SecretPageOffset(usize);

impl SecretPageOffset {
    pub(crate) const fn normalized_for(
        self,
        total: SecretRecordCount,
        page_size: SecretPageLimit,
    ) -> Self {
        if total.0 == 0 || page_size.0 == 0 || self.0 < total.0 {
            return self;
        }
        Self(((total.0 - 1) / page_size.0) * page_size.0)
    }
}

impl From<usize> for SecretPageOffset {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<SecretPageOffset> for usize {
    fn from(value: SecretPageOffset) -> Self {
        value.0
    }
}

/// Maximum number of secret records requested in one page.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SecretPageLimit(usize);

impl From<usize> for SecretPageLimit {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<SecretPageLimit> for usize {
    fn from(value: SecretPageLimit) -> Self {
        value.0
    }
}

/// Stable encrypted search-catalog bucket identifier.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SecretSearchCatalogBucket(u8);

impl From<u8> for SecretSearchCatalogBucket {
    fn from(value: u8) -> Self {
        Self(value)
    }
}

impl From<SecretSearchCatalogBucket> for u8 {
    fn from(value: SecretSearchCatalogBucket) -> Self {
        value.0
    }
}

/// Configured vault idle timeout in milliseconds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VaultIdleTimeoutMilliseconds(u32);

impl From<u32> for VaultIdleTimeoutMilliseconds {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

impl From<VaultIdleTimeoutMilliseconds> for u32 {
    fn from(value: VaultIdleTimeoutMilliseconds) -> Self {
        value.0
    }
}

/// Configured warning interval before vault idle locking, in milliseconds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VaultIdleWarningMilliseconds(u32);

impl From<u32> for VaultIdleWarningMilliseconds {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

impl From<VaultIdleWarningMilliseconds> for u32 {
    fn from(value: VaultIdleWarningMilliseconds) -> Self {
        value.0
    }
}

/// Configured vault synchronization interval in milliseconds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VaultSyncIntervalMilliseconds(u32);

impl From<u32> for VaultSyncIntervalMilliseconds {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

impl From<VaultSyncIntervalMilliseconds> for u32 {
    fn from(value: VaultSyncIntervalMilliseconds) -> Self {
        value.0
    }
}

/// Projection-cache schema version observed at the YAML boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VaultSchemaVersion(u32);

impl VaultSchemaVersion {
    pub const CURRENT: Self = Self(1);
}

impl From<u32> for VaultSchemaVersion {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

impl From<VaultSchemaVersion> for u32 {
    fn from(value: VaultSchemaVersion) -> Self {
        value.0
    }
}

impl fmt::Display for VaultSchemaVersion {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Monotonic revision of a persisted vault projection.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct VaultVersion(u64);

impl From<u64> for VaultVersion {
    fn from(value: u64) -> Self {
        Self(value)
    }
}

impl From<VaultVersion> for u64 {
    fn from(value: VaultVersion) -> Self {
        value.0
    }
}

impl fmt::Display for VaultVersion {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Signed database representation of a provider's last synchronized vault version.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct ProviderSyncedVaultVersionValue(i64);

impl From<i64> for ProviderSyncedVaultVersionValue {
    fn from(value: i64) -> Self {
        Self(value)
    }
}

impl From<ProviderSyncedVaultVersionValue> for i64 {
    fn from(value: ProviderSyncedVaultVersionValue) -> Self {
        value.0
    }
}
