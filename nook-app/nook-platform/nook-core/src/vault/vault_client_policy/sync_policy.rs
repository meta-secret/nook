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
    pub const fn manual_sync_has_target(
        local_vault_present: bool,
        sync_provider_count: usize,
    ) -> bool {
        local_vault_present || sync_provider_count > 0
    }

    #[must_use]
    #[allow(clippy::fn_params_excessive_bools)]
    pub const fn sync_activity_visible(
        fan_out_syncing: bool,
        provider_syncing: bool,
        syncing: bool,
        saving: bool,
    ) -> bool {
        fan_out_syncing || provider_syncing || syncing || saving
    }

    #[must_use]
    #[allow(clippy::fn_params_excessive_bools)]
    pub const fn should_sync_from_providers(
        sync_blocked: bool,
        force: bool,
        verifying: bool,
        saving: bool,
        password_busy: bool,
        syncing: bool,
        sync_provider_count: usize,
    ) -> bool {
        !sync_blocked
            && (force || (!verifying && !saving && !password_busy && !syncing))
            && sync_provider_count > 0
    }

    #[must_use]
    pub const fn unauthenticated_sync_decision(
        changed: bool,
        access_status: VaultAccessObservation,
        join_state: JoinEnrollmentState,
        awaiting_join_approval: bool,
    ) -> UnauthenticatedSyncDecision {
        if !changed {
            return UnauthenticatedSyncDecision::Ignore;
        }
        match (access_status, join_state, awaiting_join_approval) {
            (
                VaultAccessObservation::Available(VaultAccessStatus::Ready),
                JoinEnrollmentState::Pending,
                _,
            ) => UnauthenticatedSyncDecision::Approved,
            (VaultAccessObservation::Available(VaultAccessStatus::Ready), _, true) => {
                UnauthenticatedSyncDecision::AutoConnect
            }
            (
                VaultAccessObservation::Available(VaultAccessStatus::JoinPending),
                JoinEnrollmentState::None,
                _,
            ) => UnauthenticatedSyncDecision::MarkJoinPending,
            _ => UnauthenticatedSyncDecision::Ignore,
        }
    }

    #[must_use]
    #[allow(clippy::fn_params_excessive_bools)]
    pub const fn should_auto_connect_after_approval(
        authenticated: bool,
        verifying: bool,
        password_prompt_open: bool,
        session_expired_by_idle: bool,
        session_explicitly_locked: bool,
    ) -> bool {
        !authenticated
            && !verifying
            && !password_prompt_open
            && !session_expired_by_idle
            && !session_explicitly_locked
    }

    #[must_use]
    pub const fn vault_sync_timer_start_decision(
        authenticated: bool,
        device_protection_ready: bool,
        join_state: JoinEnrollmentState,
        awaiting_join_approval: bool,
    ) -> VaultSyncTimerStartDecision {
        if authenticated && !device_protection_ready {
            return VaultSyncTimerStartDecision::SkipDeviceProtectionLocked;
        }
        if authenticated
            || !matches!(join_state, JoinEnrollmentState::None)
            || awaiting_join_approval
        {
            VaultSyncTimerStartDecision::Start
        } else {
            VaultSyncTimerStartDecision::SkipNoRemoteUpdates
        }
    }

    #[must_use]
    #[allow(clippy::too_many_arguments, clippy::fn_params_excessive_bools)]
    pub const fn vault_sync_timer_tick_decision(
        verifying: bool,
        saving: bool,
        syncing: bool,
        password_busy: bool,
        authenticated: bool,
        join_state: JoinEnrollmentState,
        awaiting_join_approval: bool,
        sync_provider_count: usize,
    ) -> VaultSyncTimerTickDecision {
        if verifying || saving || syncing || password_busy {
            return VaultSyncTimerTickDecision::SkipBusy;
        }
        if !authenticated
            && matches!(join_state, JoinEnrollmentState::None)
            && !awaiting_join_approval
        {
            return VaultSyncTimerTickDecision::SkipNoRemoteUpdates;
        }
        if authenticated
            && sync_provider_count == 0
            && matches!(join_state, JoinEnrollmentState::None)
        {
            return VaultSyncTimerTickDecision::SkipLocalOnly;
        }
        VaultSyncTimerTickDecision::Sync
    }

    #[must_use]
    #[allow(clippy::too_many_arguments, clippy::fn_params_excessive_bools)]
    pub const fn vault_storage_sync_decision(
        sync_blocked: bool,
        freshness: ProviderSyncFreshness,
        verifying: bool,
        saving: bool,
        password_busy: bool,
        syncing: bool,
        authenticated: bool,
        sync_provider_count: usize,
        has_remote_credentials: bool,
        local_vault_present: bool,
    ) -> VaultStorageSyncDecision {
        let forced = matches!(freshness, ProviderSyncFreshness::Forced);
        if sync_blocked || (!forced && (verifying || saving || password_busy || syncing)) {
            return VaultStorageSyncDecision::Skip;
        }
        if !authenticated && sync_provider_count > 0 {
            return VaultStorageSyncDecision::SyncFirstProviderUnauthenticated;
        }
        if !has_remote_credentials {
            return VaultStorageSyncDecision::Skip;
        }
        if authenticated && local_vault_present && sync_provider_count > 0 {
            return VaultStorageSyncDecision::SyncProviders;
        }
        VaultStorageSyncDecision::SyncConfiguredStorage
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manual_sync_requires_a_vault_or_explicit_provider_target() {
        assert!(!VaultClientPolicy::manual_sync_has_target(false, 0));
        assert!(VaultClientPolicy::manual_sync_has_target(true, 0));
        assert!(VaultClientPolicy::manual_sync_has_target(false, 1));
    }

    #[test]
    fn provider_sync_guard_respects_busy_and_forced_states() {
        assert!(VaultClientPolicy::should_sync_from_providers(
            false, false, false, false, false, false, 1,
        ));
        assert!(!VaultClientPolicy::should_sync_from_providers(
            false, false, false, true, false, false, 1,
        ));
        assert!(VaultClientPolicy::should_sync_from_providers(
            false, true, false, true, true, true, 1,
        ));
        assert!(!VaultClientPolicy::should_sync_from_providers(
            true, true, false, false, false, false, 1,
        ));
    }

    #[test]
    fn join_sync_transition_preserves_approval_semantics() {
        assert_eq!(
            VaultClientPolicy::unauthenticated_sync_decision(
                false,
                VaultAccessObservation::Available(VaultAccessStatus::Ready),
                JoinEnrollmentState::Pending,
                true
            ),
            UnauthenticatedSyncDecision::Ignore
        );
        assert_eq!(
            VaultClientPolicy::unauthenticated_sync_decision(
                true,
                VaultAccessObservation::Available(VaultAccessStatus::Ready),
                JoinEnrollmentState::Pending,
                true
            ),
            UnauthenticatedSyncDecision::Approved
        );
        assert_eq!(
            VaultClientPolicy::unauthenticated_sync_decision(
                true,
                VaultAccessObservation::Available(VaultAccessStatus::Ready),
                JoinEnrollmentState::None,
                true
            ),
            UnauthenticatedSyncDecision::AutoConnect
        );
        assert_eq!(
            VaultClientPolicy::unauthenticated_sync_decision(
                true,
                VaultAccessObservation::Available(VaultAccessStatus::JoinPending),
                JoinEnrollmentState::None,
                false
            ),
            UnauthenticatedSyncDecision::MarkJoinPending
        );
    }

    #[test]
    fn sync_timer_start_requires_an_unlocked_remote_update_target() {
        assert_eq!(
            VaultClientPolicy::vault_sync_timer_start_decision(
                true,
                false,
                JoinEnrollmentState::None,
                false,
            ),
            VaultSyncTimerStartDecision::SkipDeviceProtectionLocked
        );
        assert_eq!(
            VaultClientPolicy::vault_sync_timer_start_decision(
                false,
                true,
                JoinEnrollmentState::None,
                false,
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
                    authenticated,
                    true,
                    join_state,
                    awaiting,
                ),
                VaultSyncTimerStartDecision::Start
            );
        }
    }

    #[test]
    fn scheduled_sync_tick_distinguishes_busy_idle_and_remote_work() {
        assert_eq!(
            VaultClientPolicy::vault_sync_timer_tick_decision(
                true,
                false,
                false,
                false,
                true,
                JoinEnrollmentState::None,
                false,
                1,
            ),
            VaultSyncTimerTickDecision::SkipBusy
        );
        assert_eq!(
            VaultClientPolicy::vault_sync_timer_tick_decision(
                false,
                false,
                false,
                false,
                false,
                JoinEnrollmentState::None,
                false,
                1,
            ),
            VaultSyncTimerTickDecision::SkipNoRemoteUpdates
        );
        assert_eq!(
            VaultClientPolicy::vault_sync_timer_tick_decision(
                false,
                false,
                false,
                false,
                true,
                JoinEnrollmentState::None,
                false,
                0,
            ),
            VaultSyncTimerTickDecision::SkipLocalOnly
        );
        assert_eq!(
            VaultClientPolicy::vault_sync_timer_tick_decision(
                false,
                false,
                false,
                false,
                false,
                JoinEnrollmentState::Pending,
                true,
                1,
            ),
            VaultSyncTimerTickDecision::Sync
        );
    }

    #[test]
    fn storage_sync_route_preserves_host_execution_order() {
        assert_eq!(
            VaultClientPolicy::vault_storage_sync_decision(
                false,
                ProviderSyncFreshness::Scheduled,
                false,
                true,
                false,
                false,
                true,
                1,
                true,
                true,
            ),
            VaultStorageSyncDecision::Skip
        );
        assert_eq!(
            VaultClientPolicy::vault_storage_sync_decision(
                false,
                ProviderSyncFreshness::Forced,
                false,
                true,
                true,
                true,
                false,
                1,
                false,
                false,
            ),
            VaultStorageSyncDecision::SyncFirstProviderUnauthenticated
        );
        assert_eq!(
            VaultClientPolicy::vault_storage_sync_decision(
                false,
                ProviderSyncFreshness::Forced,
                false,
                false,
                false,
                false,
                true,
                2,
                true,
                true,
            ),
            VaultStorageSyncDecision::SyncProviders
        );
        assert_eq!(
            VaultClientPolicy::vault_storage_sync_decision(
                false,
                ProviderSyncFreshness::Forced,
                false,
                false,
                false,
                false,
                false,
                0,
                true,
                false,
            ),
            VaultStorageSyncDecision::SyncConfiguredStorage
        );
        assert_eq!(
            VaultClientPolicy::vault_storage_sync_decision(
                false,
                ProviderSyncFreshness::Forced,
                false,
                false,
                false,
                false,
                true,
                0,
                false,
                true,
            ),
            VaultStorageSyncDecision::Skip
        );
    }
}
