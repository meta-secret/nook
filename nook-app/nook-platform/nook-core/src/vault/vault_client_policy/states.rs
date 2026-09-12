//! Independent observations and intents for vault client policy.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultSyncConflictState {
    Clear,
    Conflicted,
}
impl From<bool> for VaultSyncConflictState {
    fn from(observed: bool) -> Self {
        if observed {
            Self::Conflicted
        } else {
            Self::Clear
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultSecretCreationPermission {
    Denied,
    Allowed,
}
impl From<bool> for VaultSecretCreationPermission {
    fn from(observed: bool) -> Self {
        if observed {
            Self::Allowed
        } else {
            Self::Denied
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultAuthenticationState {
    Unauthenticated,
    Authenticated,
}
impl From<bool> for VaultAuthenticationState {
    fn from(observed: bool) -> Self {
        if observed {
            Self::Authenticated
        } else {
            Self::Unauthenticated
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultSessionLockIntent {
    Automatic,
    ExplicitlyLocked,
}
impl From<bool> for VaultSessionLockIntent {
    fn from(observed: bool) -> Self {
        if observed {
            Self::ExplicitlyLocked
        } else {
            Self::Automatic
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalVaultPresence {
    Absent,
    Present,
}
impl From<bool> for LocalVaultPresence {
    fn from(observed: bool) -> Self {
        if observed {
            Self::Present
        } else {
            Self::Absent
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderSetupState {
    Inactive,
    Active,
}
impl From<bool> for ProviderSetupState {
    fn from(observed: bool) -> Self {
        if observed {
            Self::Active
        } else {
            Self::Inactive
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddProviderPromptState {
    Closed,
    Open,
}
impl From<bool> for AddProviderPromptState {
    fn from(observed: bool) -> Self {
        if observed { Self::Open } else { Self::Closed }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultSelectionState {
    Unselected,
    Selected,
}
impl From<bool> for VaultSelectionState {
    fn from(observed: bool) -> Self {
        if observed {
            Self::Selected
        } else {
            Self::Unselected
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultExistenceRequirement {
    MayCreate,
    ExistingRequired,
}
impl From<bool> for VaultExistenceRequirement {
    fn from(observed: bool) -> Self {
        if observed {
            Self::ExistingRequired
        } else {
            Self::MayCreate
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceProtectionReadiness {
    Locked,
    Ready,
}
impl From<bool> for DeviceProtectionReadiness {
    fn from(observed: bool) -> Self {
        if observed { Self::Ready } else { Self::Locked }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultVerificationState {
    Idle,
    Verifying,
}
impl From<bool> for VaultVerificationState {
    fn from(observed: bool) -> Self {
        if observed {
            Self::Verifying
        } else {
            Self::Idle
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultFanOutSyncState {
    Idle,
    Syncing,
}
impl From<bool> for VaultFanOutSyncState {
    fn from(observed: bool) -> Self {
        if observed { Self::Syncing } else { Self::Idle }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultProviderSyncState {
    Idle,
    Syncing,
}
impl From<bool> for VaultProviderSyncState {
    fn from(observed: bool) -> Self {
        if observed { Self::Syncing } else { Self::Idle }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultSyncActivity {
    Idle,
    Syncing,
}
impl From<bool> for VaultSyncActivity {
    fn from(observed: bool) -> Self {
        if observed { Self::Syncing } else { Self::Idle }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultSaveActivity {
    Idle,
    Saving,
}
impl From<bool> for VaultSaveActivity {
    fn from(observed: bool) -> Self {
        if observed { Self::Saving } else { Self::Idle }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultSyncPermission {
    Allowed,
    Blocked,
}
impl From<bool> for VaultSyncPermission {
    fn from(observed: bool) -> Self {
        if observed {
            Self::Blocked
        } else {
            Self::Allowed
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultSyncIntent {
    Scheduled,
    Forced,
}
impl From<bool> for VaultSyncIntent {
    fn from(observed: bool) -> Self {
        if observed {
            Self::Forced
        } else {
            Self::Scheduled
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultPasswordActivity {
    Idle,
    Busy,
}
impl From<bool> for VaultPasswordActivity {
    fn from(observed: bool) -> Self {
        if observed { Self::Busy } else { Self::Idle }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultSyncChange {
    Unchanged,
    Changed,
}
impl From<bool> for VaultSyncChange {
    fn from(observed: bool) -> Self {
        if observed {
            Self::Changed
        } else {
            Self::Unchanged
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultJoinApprovalWait {
    NotWaiting,
    Waiting,
}
impl From<bool> for VaultJoinApprovalWait {
    fn from(observed: bool) -> Self {
        if observed {
            Self::Waiting
        } else {
            Self::NotWaiting
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultPasswordPromptState {
    Closed,
    Open,
}
impl From<bool> for VaultPasswordPromptState {
    fn from(observed: bool) -> Self {
        if observed { Self::Open } else { Self::Closed }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultIdleExpiration {
    Active,
    Expired,
}
impl From<bool> for VaultIdleExpiration {
    fn from(observed: bool) -> Self {
        if observed {
            Self::Expired
        } else {
            Self::Active
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteVaultCredentialPresence {
    Absent,
    Present,
}
impl From<bool> for RemoteVaultCredentialPresence {
    fn from(observed: bool) -> Self {
        if observed {
            Self::Present
        } else {
            Self::Absent
        }
    }
}
