use wasm_bindgen::prelude::wasm_bindgen;

use super::{JoinEnrollmentState, ProviderSyncFreshness, VaultClientPolicy};
use crate::VaultAccessStatus;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultAccessObservation {
    Unavailable,
    Available(VaultAccessStatus),
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnauthenticatedSyncDecision {
    Ignore,
    MarkJoinPending,
    Approved,
    AutoConnect,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultSyncTimerStartDecision {
    Start,
    SkipDeviceProtectionLocked,
    SkipNoRemoteUpdates,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultSyncTimerTickDecision {
    Sync,
    SkipBusy,
    SkipNoRemoteUpdates,
    SkipLocalOnly,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultStorageSyncDecision {
    Skip,
    SyncFirstProviderUnauthenticated,
    SyncProviders,
    SyncConfiguredStorage,
}

impl VaultClientPolicy {
    /// Device-dependent manual sync is meaningful only after a local vault or
    /// an explicit sync-provider target exists.
    #[must_use]
    pub const fn manual_sync_has_target(request: crate::ManualSyncHasTargetRequest) -> bool {
        matches!(
            request.local_vault_present,
            crate::LocalVaultPresence::Present
        ) || request.sync_provider_count.is_nonzero()
    }

    #[must_use]
    pub const fn sync_activity_visible(request: crate::SyncActivityVisibleRequest) -> bool {
        matches!(
            request.fan_out_syncing,
            crate::VaultFanOutSyncState::Syncing
        ) || matches!(
            request.provider_syncing,
            crate::VaultProviderSyncState::Syncing
        ) || matches!(request.syncing, crate::VaultSyncActivity::Syncing)
            || matches!(request.saving, crate::VaultSaveActivity::Saving)
    }

    #[must_use]
    pub const fn should_sync_from_providers(
        request: crate::ShouldSyncFromProvidersRequest,
    ) -> bool {
        !matches!(request.sync_blocked, crate::VaultSyncPermission::Blocked)
            && (matches!(request.force, crate::VaultSyncIntent::Forced)
                || (!matches!(request.verifying, crate::VaultVerificationState::Verifying)
                    && !matches!(request.saving, crate::VaultSaveActivity::Saving)
                    && !matches!(request.password_busy, crate::VaultPasswordActivity::Busy)
                    && !matches!(request.syncing, crate::VaultSyncActivity::Syncing)))
            && request.sync_provider_count.is_nonzero()
    }

    #[must_use]
    pub const fn unauthenticated_sync_decision(
        request: crate::UnauthenticatedSyncDecisionRequest,
    ) -> UnauthenticatedSyncDecision {
        match request.changed {
            crate::VaultSyncChange::Unchanged => UnauthenticatedSyncDecision::Ignore,
            crate::VaultSyncChange::Changed => match (
                request.access_status,
                request.join_state,
                request.awaiting_join_approval,
            ) {
                (
                    VaultAccessObservation::Available(VaultAccessStatus::Ready),
                    JoinEnrollmentState::Pending,
                    _,
                ) => UnauthenticatedSyncDecision::Approved,
                (
                    VaultAccessObservation::Available(VaultAccessStatus::Ready),
                    _,
                    crate::VaultJoinApprovalWait::Waiting,
                ) => UnauthenticatedSyncDecision::AutoConnect,
                (
                    VaultAccessObservation::Available(VaultAccessStatus::JoinPending),
                    JoinEnrollmentState::None,
                    _,
                ) => UnauthenticatedSyncDecision::MarkJoinPending,
                _ => UnauthenticatedSyncDecision::Ignore,
            },
        }
    }

    #[must_use]
    pub const fn should_auto_connect_after_approval(
        request: crate::ShouldAutoConnectAfterApprovalRequest,
    ) -> bool {
        !matches!(
            request.authenticated,
            crate::VaultAuthenticationState::Authenticated
        ) && !matches!(request.verifying, crate::VaultVerificationState::Verifying)
            && !matches!(
                request.password_prompt_open,
                crate::VaultPasswordPromptState::Open
            )
            && !matches!(
                request.session_expired_by_idle,
                crate::VaultIdleExpiration::Expired
            )
            && !matches!(
                request.session_explicitly_locked,
                crate::VaultSessionLockIntent::ExplicitlyLocked
            )
    }

    #[must_use]
    pub const fn vault_sync_timer_start_decision(
        request: crate::VaultSyncTimerStartDecisionRequest,
    ) -> VaultSyncTimerStartDecision {
        match request.authenticated {
            crate::VaultAuthenticationState::Authenticated => match request.device_protection_ready
            {
                crate::DeviceProtectionReadiness::Locked => {
                    VaultSyncTimerStartDecision::SkipDeviceProtectionLocked
                }
                crate::DeviceProtectionReadiness::Ready => VaultSyncTimerStartDecision::Start,
            },
            crate::VaultAuthenticationState::Unauthenticated => {
                if !matches!(request.join_state, JoinEnrollmentState::None)
                    || matches!(
                        request.awaiting_join_approval,
                        crate::VaultJoinApprovalWait::Waiting
                    )
                {
                    VaultSyncTimerStartDecision::Start
                } else {
                    VaultSyncTimerStartDecision::SkipNoRemoteUpdates
                }
            }
        }
    }

    #[must_use]
    pub const fn vault_sync_timer_tick_decision(
        request: crate::VaultSyncTimerTickDecisionRequest,
    ) -> VaultSyncTimerTickDecision {
        if matches!(request.verifying, crate::VaultVerificationState::Verifying)
            || matches!(request.saving, crate::VaultSaveActivity::Saving)
            || matches!(request.syncing, crate::VaultSyncActivity::Syncing)
            || matches!(request.password_busy, crate::VaultPasswordActivity::Busy)
        {
            VaultSyncTimerTickDecision::SkipBusy
        } else {
            request.idle_target_decision()
        }
    }

    #[must_use]
    pub const fn vault_storage_sync_decision(
        request: crate::VaultStorageSyncDecisionRequest,
    ) -> VaultStorageSyncDecision {
        match request.sync_blocked {
            crate::VaultSyncPermission::Blocked => VaultStorageSyncDecision::Skip,
            crate::VaultSyncPermission::Allowed => request.allowed_sync_decision(),
        }
    }
}

impl crate::VaultSyncTimerTickDecisionRequest {
    const fn idle_target_decision(self) -> VaultSyncTimerTickDecision {
        match self.authenticated {
            crate::VaultAuthenticationState::Unauthenticated => {
                if matches!(self.join_state, JoinEnrollmentState::None)
                    && !matches!(
                        self.awaiting_join_approval,
                        crate::VaultJoinApprovalWait::Waiting
                    )
                {
                    VaultSyncTimerTickDecision::SkipNoRemoteUpdates
                } else {
                    VaultSyncTimerTickDecision::Sync
                }
            }
            crate::VaultAuthenticationState::Authenticated => {
                if self.sync_provider_count.is_zero()
                    && matches!(self.join_state, JoinEnrollmentState::None)
                {
                    VaultSyncTimerTickDecision::SkipLocalOnly
                } else {
                    VaultSyncTimerTickDecision::Sync
                }
            }
        }
    }
}

impl crate::VaultStorageSyncDecisionRequest {
    const fn allowed_sync_decision(self) -> VaultStorageSyncDecision {
        if !matches!(self.freshness, ProviderSyncFreshness::Forced)
            && (matches!(self.verifying, crate::VaultVerificationState::Verifying)
                || matches!(self.saving, crate::VaultSaveActivity::Saving)
                || matches!(self.password_busy, crate::VaultPasswordActivity::Busy)
                || matches!(self.syncing, crate::VaultSyncActivity::Syncing))
        {
            VaultStorageSyncDecision::Skip
        } else {
            self.storage_target_decision()
        }
    }

    const fn storage_target_decision(self) -> VaultStorageSyncDecision {
        match self.authenticated {
            crate::VaultAuthenticationState::Unauthenticated
                if self.sync_provider_count.is_nonzero() =>
            {
                VaultStorageSyncDecision::SyncFirstProviderUnauthenticated
            }
            crate::VaultAuthenticationState::Unauthenticated
            | crate::VaultAuthenticationState::Authenticated => self.credential_target_decision(),
        }
    }

    const fn credential_target_decision(self) -> VaultStorageSyncDecision {
        match self.has_remote_credentials {
            crate::RemoteVaultCredentialPresence::Absent => VaultStorageSyncDecision::Skip,
            crate::RemoteVaultCredentialPresence::Present => {
                if matches!(
                    self.authenticated,
                    crate::VaultAuthenticationState::Authenticated
                ) && matches!(self.local_vault_present, crate::LocalVaultPresence::Present)
                    && self.sync_provider_count.is_nonzero()
                {
                    VaultStorageSyncDecision::SyncProviders
                } else {
                    VaultStorageSyncDecision::SyncConfiguredStorage
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manual_sync_requires_a_vault_or_explicit_provider_target() {
        assert!(!VaultClientPolicy::manual_sync_has_target(
            crate::ManualSyncHasTargetRequest {
                local_vault_present: (false).into(),
                sync_provider_count: 0.into()
            }
        ));
        assert!(VaultClientPolicy::manual_sync_has_target(
            crate::ManualSyncHasTargetRequest {
                local_vault_present: (true).into(),
                sync_provider_count: 0.into()
            }
        ));
        assert!(VaultClientPolicy::manual_sync_has_target(
            crate::ManualSyncHasTargetRequest {
                local_vault_present: (false).into(),
                sync_provider_count: 1.into()
            }
        ));
    }

    #[test]
    fn provider_sync_guard_respects_busy_and_forced_states() {
        assert!(VaultClientPolicy::should_sync_from_providers(
            crate::ShouldSyncFromProvidersRequest {
                sync_blocked: (false).into(),
                force: (false).into(),
                verifying: (false).into(),
                saving: (false).into(),
                password_busy: (false).into(),
                syncing: (false).into(),
                sync_provider_count: 1.into()
            }
        ));
        assert!(!VaultClientPolicy::should_sync_from_providers(
            crate::ShouldSyncFromProvidersRequest {
                sync_blocked: (false).into(),
                force: (false).into(),
                verifying: (false).into(),
                saving: (true).into(),
                password_busy: (false).into(),
                syncing: (false).into(),
                sync_provider_count: 1.into()
            }
        ));
        assert!(VaultClientPolicy::should_sync_from_providers(
            crate::ShouldSyncFromProvidersRequest {
                sync_blocked: (false).into(),
                force: (true).into(),
                verifying: (false).into(),
                saving: (true).into(),
                password_busy: (true).into(),
                syncing: (true).into(),
                sync_provider_count: 1.into()
            }
        ));
        assert!(!VaultClientPolicy::should_sync_from_providers(
            crate::ShouldSyncFromProvidersRequest {
                sync_blocked: (true).into(),
                force: (true).into(),
                verifying: (false).into(),
                saving: (false).into(),
                password_busy: (false).into(),
                syncing: (false).into(),
                sync_provider_count: 1.into()
            }
        ));
    }

    #[test]
    fn join_sync_transition_preserves_approval_semantics() {
        assert_eq!(
            VaultClientPolicy::unauthenticated_sync_decision(
                crate::UnauthenticatedSyncDecisionRequest {
                    changed: (false).into(),
                    access_status: VaultAccessObservation::Available(VaultAccessStatus::Ready),
                    join_state: JoinEnrollmentState::Pending,
                    awaiting_join_approval: (true).into()
                }
            ),
            UnauthenticatedSyncDecision::Ignore
        );
        assert_eq!(
            VaultClientPolicy::unauthenticated_sync_decision(
                crate::UnauthenticatedSyncDecisionRequest {
                    changed: (true).into(),
                    access_status: VaultAccessObservation::Available(VaultAccessStatus::Ready),
                    join_state: JoinEnrollmentState::Pending,
                    awaiting_join_approval: (true).into()
                }
            ),
            UnauthenticatedSyncDecision::Approved
        );
        assert_eq!(
            VaultClientPolicy::unauthenticated_sync_decision(
                crate::UnauthenticatedSyncDecisionRequest {
                    changed: (true).into(),
                    access_status: VaultAccessObservation::Available(VaultAccessStatus::Ready),
                    join_state: JoinEnrollmentState::None,
                    awaiting_join_approval: (true).into()
                }
            ),
            UnauthenticatedSyncDecision::AutoConnect
        );
        assert_eq!(
            VaultClientPolicy::unauthenticated_sync_decision(
                crate::UnauthenticatedSyncDecisionRequest {
                    changed: (true).into(),
                    access_status: VaultAccessObservation::Available(
                        VaultAccessStatus::JoinPending
                    ),
                    join_state: JoinEnrollmentState::None,
                    awaiting_join_approval: (false).into()
                }
            ),
            UnauthenticatedSyncDecision::MarkJoinPending
        );
    }

    #[test]
    fn sync_timer_start_requires_an_unlocked_remote_update_target() {
        assert_eq!(
            VaultClientPolicy::vault_sync_timer_start_decision(
                crate::VaultSyncTimerStartDecisionRequest {
                    authenticated: (true).into(),
                    device_protection_ready: (false).into(),
                    join_state: JoinEnrollmentState::None,
                    awaiting_join_approval: (false).into()
                }
            ),
            VaultSyncTimerStartDecision::SkipDeviceProtectionLocked
        );
        assert_eq!(
            VaultClientPolicy::vault_sync_timer_start_decision(
                crate::VaultSyncTimerStartDecisionRequest {
                    authenticated: (false).into(),
                    device_protection_ready: (true).into(),
                    join_state: JoinEnrollmentState::None,
                    awaiting_join_approval: (false).into()
                }
            ),
            VaultSyncTimerStartDecision::SkipNoRemoteUpdates
        );
        for (authenticated, join_state, awaiting) in [
            (true, JoinEnrollmentState::None, false),
            (false, JoinEnrollmentState::NeedsRequest, false),
            (false, JoinEnrollmentState::None, true),
        ] {
            assert_eq!(
                VaultClientPolicy::vault_sync_timer_start_decision(
                    crate::VaultSyncTimerStartDecisionRequest {
                        authenticated: (authenticated).into(),
                        device_protection_ready: (true).into(),
                        join_state: join_state,
                        awaiting_join_approval: (awaiting).into()
                    }
                ),
                VaultSyncTimerStartDecision::Start
            );
        }
    }

    #[test]
    fn scheduled_sync_tick_distinguishes_busy_idle_and_remote_work() {
        assert_eq!(
            VaultClientPolicy::vault_sync_timer_tick_decision(
                crate::VaultSyncTimerTickDecisionRequest {
                    verifying: (true).into(),
                    saving: (false).into(),
                    syncing: (false).into(),
                    password_busy: (false).into(),
                    authenticated: (true).into(),
                    join_state: JoinEnrollmentState::None,
                    awaiting_join_approval: (false).into(),
                    sync_provider_count: 1.into()
                }
            ),
            VaultSyncTimerTickDecision::SkipBusy
        );
        assert_eq!(
            VaultClientPolicy::vault_sync_timer_tick_decision(
                crate::VaultSyncTimerTickDecisionRequest {
                    verifying: (false).into(),
                    saving: (false).into(),
                    syncing: (false).into(),
                    password_busy: (false).into(),
                    authenticated: (false).into(),
                    join_state: JoinEnrollmentState::None,
                    awaiting_join_approval: (false).into(),
                    sync_provider_count: 1.into()
                }
            ),
            VaultSyncTimerTickDecision::SkipNoRemoteUpdates
        );
        assert_eq!(
            VaultClientPolicy::vault_sync_timer_tick_decision(
                crate::VaultSyncTimerTickDecisionRequest {
                    verifying: (false).into(),
                    saving: (false).into(),
                    syncing: (false).into(),
                    password_busy: (false).into(),
                    authenticated: (true).into(),
                    join_state: JoinEnrollmentState::None,
                    awaiting_join_approval: (false).into(),
                    sync_provider_count: 0.into()
                }
            ),
            VaultSyncTimerTickDecision::SkipLocalOnly
        );
        assert_eq!(
            VaultClientPolicy::vault_sync_timer_tick_decision(
                crate::VaultSyncTimerTickDecisionRequest {
                    verifying: (false).into(),
                    saving: (false).into(),
                    syncing: (false).into(),
                    password_busy: (false).into(),
                    authenticated: (false).into(),
                    join_state: JoinEnrollmentState::Pending,
                    awaiting_join_approval: (true).into(),
                    sync_provider_count: 1.into()
                }
            ),
            VaultSyncTimerTickDecision::Sync
        );
    }

    #[test]
    fn storage_sync_route_preserves_host_execution_order() {
        assert_eq!(
            VaultClientPolicy::vault_storage_sync_decision(
                crate::VaultStorageSyncDecisionRequest {
                    sync_blocked: (false).into(),
                    freshness: ProviderSyncFreshness::Scheduled,
                    verifying: (false).into(),
                    saving: (true).into(),
                    password_busy: (false).into(),
                    syncing: (false).into(),
                    authenticated: (true).into(),
                    sync_provider_count: 1.into(),
                    has_remote_credentials: (true).into(),
                    local_vault_present: (true).into()
                }
            ),
            VaultStorageSyncDecision::Skip
        );
        assert_eq!(
            VaultClientPolicy::vault_storage_sync_decision(
                crate::VaultStorageSyncDecisionRequest {
                    sync_blocked: (false).into(),
                    freshness: ProviderSyncFreshness::Forced,
                    verifying: (false).into(),
                    saving: (true).into(),
                    password_busy: (true).into(),
                    syncing: (true).into(),
                    authenticated: (false).into(),
                    sync_provider_count: 1.into(),
                    has_remote_credentials: (false).into(),
                    local_vault_present: (false).into()
                }
            ),
            VaultStorageSyncDecision::SyncFirstProviderUnauthenticated
        );
        assert_eq!(
            VaultClientPolicy::vault_storage_sync_decision(
                crate::VaultStorageSyncDecisionRequest {
                    sync_blocked: (false).into(),
                    freshness: ProviderSyncFreshness::Forced,
                    verifying: (false).into(),
                    saving: (false).into(),
                    password_busy: (false).into(),
                    syncing: (false).into(),
                    authenticated: (true).into(),
                    sync_provider_count: 2.into(),
                    has_remote_credentials: (true).into(),
                    local_vault_present: (true).into()
                }
            ),
            VaultStorageSyncDecision::SyncProviders
        );
        assert_eq!(
            VaultClientPolicy::vault_storage_sync_decision(
                crate::VaultStorageSyncDecisionRequest {
                    sync_blocked: (false).into(),
                    freshness: ProviderSyncFreshness::Forced,
                    verifying: (false).into(),
                    saving: (false).into(),
                    password_busy: (false).into(),
                    syncing: (false).into(),
                    authenticated: (false).into(),
                    sync_provider_count: 0.into(),
                    has_remote_credentials: (true).into(),
                    local_vault_present: (false).into()
                }
            ),
            VaultStorageSyncDecision::SyncConfiguredStorage
        );
        assert_eq!(
            VaultClientPolicy::vault_storage_sync_decision(
                crate::VaultStorageSyncDecisionRequest {
                    sync_blocked: (false).into(),
                    freshness: ProviderSyncFreshness::Forced,
                    verifying: (false).into(),
                    saving: (false).into(),
                    password_busy: (false).into(),
                    syncing: (false).into(),
                    authenticated: (true).into(),
                    sync_provider_count: 0.into(),
                    has_remote_credentials: (false).into(),
                    local_vault_present: (true).into()
                }
            ),
            VaultStorageSyncDecision::Skip
        );
    }
}
