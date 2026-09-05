#![cfg(not(target_arch = "wasm32"))]

use nook_wasm::{NookClientRunMode, NookRuntimeConfig, NookVaultClientPolicy};

#[test]
fn policy_wrappers_project_sync_and_connection_paths() {
    let policy = NookVaultClientPolicy::new();

    assert_eq!(
        policy.edit_block_reason(1, true, false),
        nook_core::VaultEditDecision::BlockedSecurityConflict
    );
    assert_eq!(
        policy.edit_block_reason(0, true, false),
        nook_core::VaultEditDecision::BlockedSyncConflict
    );
    assert!(policy.edits_blocked(0, false, false));
    assert!(!policy.edits_blocked(0, false, true));
    assert!(policy.should_use_join_provider_for_connect(
        false,
        1,
        nook_core::JoinEnrollmentState::Pending
    ));
    assert!(!policy.should_use_join_provider_for_connect(
        true,
        1,
        nook_core::JoinEnrollmentState::Pending
    ));

    assert!(policy.should_sync_from_providers(false, false, false, false, false, false, 1));
    assert!(policy.should_sync_from_providers(false, true, true, true, true, true, 1));
    assert!(!policy.should_sync_from_providers(true, true, false, false, false, false, 1));
    assert_eq!(
        policy.vault_sync_timer_start_decision(
            false,
            true,
            nook_core::JoinEnrollmentState::NeedsRequest,
            false,
        ),
        nook_core::VaultSyncTimerStartDecision::Start
    );
    assert_eq!(
        policy.vault_sync_timer_start_decision(
            true,
            false,
            nook_core::JoinEnrollmentState::None,
            false,
        ),
        nook_core::VaultSyncTimerStartDecision::SkipDeviceProtectionLocked
    );
    assert_eq!(
        policy.vault_sync_timer_tick_decision(
            false,
            false,
            false,
            false,
            false,
            nook_core::JoinEnrollmentState::None,
            false,
            0,
        ),
        nook_core::VaultSyncTimerTickDecision::SkipNoRemoteUpdates
    );
    assert_eq!(
        policy.vault_sync_timer_tick_decision(
            false,
            false,
            false,
            false,
            true,
            nook_core::JoinEnrollmentState::None,
            false,
            0,
        ),
        nook_core::VaultSyncTimerTickDecision::SkipLocalOnly
    );
    assert_eq!(
        policy.vault_sync_timer_tick_decision(
            false,
            false,
            false,
            false,
            false,
            nook_core::JoinEnrollmentState::Pending,
            true,
            1,
        ),
        nook_core::VaultSyncTimerTickDecision::Sync
    );
    assert_eq!(
        policy.vault_storage_sync_decision(
            false,
            nook_core::ProviderSyncFreshness::Scheduled,
            false,
            true,
            false,
            false,
            true,
            1,
            true,
            true,
        ),
        nook_core::VaultStorageSyncDecision::Skip
    );
    assert_eq!(
        policy.vault_storage_sync_decision(
            false,
            nook_core::ProviderSyncFreshness::Forced,
            false,
            false,
            false,
            false,
            false,
            1,
            false,
            false,
        ),
        nook_core::VaultStorageSyncDecision::SyncFirstProviderUnauthenticated
    );
    assert_eq!(
        policy.vault_storage_sync_decision(
            false,
            nook_core::ProviderSyncFreshness::Forced,
            false,
            false,
            false,
            false,
            true,
            1,
            true,
            true,
        ),
        nook_core::VaultStorageSyncDecision::SyncProviders
    );

    assert_eq!(
        policy.remote_vault_assess_decision(
            nook_core::VaultAccessStatus::RemoteMissing,
            true,
            false,
        ),
        nook_core::RemoteVaultAssessDecision::RejectMissingExistingVault
    );
    assert_eq!(
        policy.vault_connect_probe_decision(
            nook_core::VaultAccessStatus::NeedsEnrollment,
            false,
            1,
        ),
        nook_core::VaultConnectProbeDecision::ReassessFirstSyncProvider
    );
    assert_eq!(
        policy.vault_connect_gate_decision(nook_core::VaultAccessStatus::JoinPending, 0),
        nook_core::VaultConnectGateDecision::AwaitJoinApproval
    );
    assert!(
        policy
            .vault_connect_password_lookup_required(nook_core::VaultAccessStatus::NeedsEnrollment)
    );
    assert_eq!(
        policy.unauthenticated_sync_decision(
            true,
            false,
            nook_core::VaultAccessStatus::Ready,
            nook_core::JoinEnrollmentState::None,
            false,
        ),
        nook_core::UnauthenticatedSyncDecision::Ignore
    );
    assert_eq!(
        policy.unauthenticated_sync_decision(
            true,
            true,
            nook_core::VaultAccessStatus::JoinPending,
            nook_core::JoinEnrollmentState::None,
            false,
        ),
        nook_core::UnauthenticatedSyncDecision::MarkJoinPending
    );
}

#[test]
fn policy_wrappers_project_login_and_paging_paths() {
    let policy = NookVaultClientPolicy::new();

    assert!(policy.is_sync_activity_visible(true, false, false, false));
    assert!(policy.should_auto_unlock(false, true, 0, 0, false, false));
    assert!(!policy.should_auto_unlock(true, true, 0, 0, false, false));
    assert!(policy.should_show_login_vault_picker(false, 2, false, false, false, true));
    assert!(!policy.should_show_login_vault_picker(true, 2, false, false, false, true));
    assert!(!policy.should_auto_connect_after_approval(true, false, false, false, false));
    assert!(policy.should_auto_connect_after_approval(false, false, false, false, false));
    assert_eq!(policy.normalized_secret_page_offset(0, 20, 5), 20);
    assert_eq!(policy.normalized_secret_page_offset(10, 20, 5), 5);
    assert_eq!(policy.normalized_secret_page_offset(10, 4, 5), 4);
    for state in [
        nook_core::RemoteVaultRecoveryState::None,
        nook_core::RemoteVaultRecoveryState::PromptMissingOnly,
        nook_core::RemoteVaultRecoveryState::ConnectFromCache,
        nook_core::RemoteVaultRecoveryState::ConnectFresh,
    ] {
        let expected_visible = matches!(
            state,
            nook_core::RemoteVaultRecoveryState::PromptMissingOnly
                | nook_core::RemoteVaultRecoveryState::PromptWithCache
        );
        assert_eq!(
            policy.remote_recovery_prompt_visible(state),
            expected_visible
        );
    }
}

#[test]
fn runtime_config_projects_valid_overrides_and_debug_capabilities() {
    let local = NookRuntimeConfig::new(NookClientRunMode::Local, false);
    assert!(local.allow_fast_idle());
    assert!(local.allow_fast_sync());
    assert!(local.expose_debug_hooks());
    assert_eq!(local.resolve_vault_idle_timeout_ms("1200"), 1200);
    assert_eq!(local.resolve_vault_idle_warning_ms("0"), 0);
    assert_eq!(local.resolve_vault_sync_interval_ms("300"), 300);

    let prod = NookRuntimeConfig::new(NookClientRunMode::Prod, false);
    assert!(!prod.allow_fast_idle());
    assert!(!prod.allow_fast_sync());
    assert!(!prod.expose_debug_hooks());
    assert_eq!(prod.resolve_vault_idle_timeout_ms("1200"), 300_000);
    assert_eq!(prod.resolve_vault_idle_warning_ms("0"), 30_000);
    assert_eq!(prod.resolve_vault_sync_interval_ms("300"), 60_000);

    let test_prod = NookRuntimeConfig::new(NookClientRunMode::Prod, true);
    assert!(test_prod.allow_fast_idle());
    assert!(test_prod.allow_fast_sync());
    assert!(test_prod.expose_debug_hooks());
    assert_eq!(test_prod.resolve_vault_idle_timeout_ms("1000"), 1000);
    assert_eq!(test_prod.resolve_vault_sync_interval_ms("250"), 250);
}
