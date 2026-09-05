use wasm_bindgen::prelude::wasm_bindgen;

use nook_core::{ActiveVaultStore, VaultClientPolicy, VaultSwitchDecision};

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, Default)]
pub struct NookVaultClientPolicy;

#[wasm_bindgen]
impl NookVaultClientPolicy {
    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `manual_sync_has_target` count through a JavaScript Number scalar"
        )
    )]
    pub fn manual_sync_has_target(
        &self,
        local_vault_present: bool,
        sync_provider_count: u32,
    ) -> bool {
        VaultClientPolicy::manual_sync_has_target(local_vault_present, sync_provider_count as usize)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn remote_recovery_prompt_visible(
        &self,
        state: nook_core::RemoteVaultRecoveryState,
    ) -> bool {
        VaultClientPolicy::remote_recovery_prompt_visible(state)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn remote_recovery_prompt_has_cache(
        &self,
        state: nook_core::RemoteVaultRecoveryState,
    ) -> bool {
        VaultClientPolicy::remote_recovery_prompt_has_cache(state)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn remote_recovery_connect_confirmed(
        &self,
        state: nook_core::RemoteVaultRecoveryState,
    ) -> bool {
        VaultClientPolicy::remote_recovery_connect_confirmed(state)
    }

    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `edit_block_reason` count through a JavaScript Number scalar"
        )
    )]
    pub fn edit_block_reason(
        &self,
        security_conflict_count: u32,
        has_sync_conflict: bool,
        architecture_allows_secret_creation: bool,
    ) -> nook_core::VaultEditDecision {
        VaultClientPolicy::edit_block_reason(
            security_conflict_count as usize,
            has_sync_conflict,
            architecture_allows_secret_creation,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `edits_blocked` count through a JavaScript Number scalar"
        )
    )]
    pub fn edits_blocked(
        &self,
        security_conflict_count: u32,
        has_sync_conflict: bool,
        architecture_allows_secret_creation: bool,
    ) -> bool {
        VaultClientPolicy::edits_blocked(
            security_conflict_count as usize,
            has_sync_conflict,
            architecture_allows_secret_creation,
        )
    }

    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `edit_block_message` count through a JavaScript Number scalar"
        )
    )]
    pub fn edit_block_message(
        &self,
        security_conflict_count: u32,
        has_sync_conflict: bool,
        architecture_allows_secret_creation: bool,
        catalog_json: &str,
        locale: &str,
    ) -> Result<String, wasm_bindgen::JsError> {
        VaultClientPolicy::edit_block_message(
            security_conflict_count as usize,
            has_sync_conflict,
            architecture_allows_secret_creation,
            catalog_json,
            locale,
        )
        .ok_or_else(|| JsError::new("blocked vault edit decision requires a message"))
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn is_sync_activity_visible(
        &self,
        fan_out_syncing: bool,
        provider_syncing: bool,
        syncing: bool,
        saving: bool,
    ) -> bool {
        VaultClientPolicy::sync_activity_visible(fan_out_syncing, provider_syncing, syncing, saving)
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `should_use_join_provider_for_connect` count through a JavaScript Number scalar"
        )
    )]
    pub fn should_use_join_provider_for_connect(
        &self,
        authenticated: bool,
        sync_provider_count: u32,
        join_state: nook_core::JoinEnrollmentState,
    ) -> bool {
        VaultClientPolicy::should_use_join_provider_for_connect(
            authenticated,
            sync_provider_count as usize,
            join_state,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `should_sync_from_providers` count through a JavaScript Number scalar"
        )
    )]
    pub fn should_sync_from_providers(
        &self,
        sync_blocked: bool,
        force: bool,
        verifying: bool,
        saving: bool,
        password_busy: bool,
        syncing: bool,
        sync_provider_count: u32,
    ) -> bool {
        VaultClientPolicy::should_sync_from_providers(
            sync_blocked,
            force,
            verifying,
            saving,
            password_busy,
            syncing,
            sync_provider_count as usize,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn vault_sync_timer_start_decision(
        &self,
        authenticated: bool,
        device_protection_ready: bool,
        join_state: nook_core::JoinEnrollmentState,
        awaiting_join_approval: bool,
    ) -> nook_core::VaultSyncTimerStartDecision {
        VaultClientPolicy::vault_sync_timer_start_decision(
            authenticated,
            device_protection_ready,
            join_state,
            awaiting_join_approval,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `vault_sync_timer_tick_decision` count through a JavaScript Number scalar"
        )
    )]
    pub fn vault_sync_timer_tick_decision(
        &self,
        verifying: bool,
        saving: bool,
        syncing: bool,
        password_busy: bool,
        authenticated: bool,
        join_state: nook_core::JoinEnrollmentState,
        awaiting_join_approval: bool,
        sync_provider_count: u32,
    ) -> nook_core::VaultSyncTimerTickDecision {
        VaultClientPolicy::vault_sync_timer_tick_decision(
            verifying,
            saving,
            syncing,
            password_busy,
            authenticated,
            join_state,
            awaiting_join_approval,
            sync_provider_count as usize,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `vault_storage_sync_decision` count through a JavaScript Number scalar"
        )
    )]
    pub fn vault_storage_sync_decision(
        &self,
        sync_blocked: bool,
        freshness: nook_core::ProviderSyncFreshness,
        verifying: bool,
        saving: bool,
        password_busy: bool,
        syncing: bool,
        authenticated: bool,
        sync_provider_count: u32,
        has_remote_credentials: bool,
        local_vault_present: bool,
    ) -> nook_core::VaultStorageSyncDecision {
        VaultClientPolicy::vault_storage_sync_decision(
            sync_blocked,
            freshness,
            verifying,
            saving,
            password_busy,
            syncing,
            authenticated,
            sync_provider_count as usize,
            has_remote_credentials,
            local_vault_present,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `should_auto_unlock` count through a JavaScript Number scalar"
        )
    )]
    pub fn should_auto_unlock(
        &self,
        session_explicitly_locked: bool,
        local_vault_present: bool,
        password_entry_count: u32,
        sync_provider_count: u32,
        provider_setup_active: bool,
        add_provider_open: bool,
    ) -> bool {
        VaultClientPolicy::should_auto_unlock(
            session_explicitly_locked,
            local_vault_present,
            password_entry_count as usize,
            sync_provider_count as usize,
            provider_setup_active,
            add_provider_open,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn existing_vault_identity_recovery_required(
        &self,
        existing_vault_required: bool,
        provider_setup_active: bool,
        device_protection_ready: bool,
    ) -> bool {
        VaultClientPolicy::existing_vault_identity_recovery_required(
            existing_vault_required,
            provider_setup_active,
            device_protection_ready,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `should_show_login_vault_picker` count through a JavaScript Number scalar"
        )
    )]
    pub fn should_show_login_vault_picker(
        &self,
        authenticated: bool,
        local_vault_count: u32,
        vault_selected: bool,
        provider_setup_active: bool,
        add_provider_open: bool,
        session_explicitly_locked: bool,
    ) -> bool {
        VaultClientPolicy::should_show_login_vault_picker(
            authenticated,
            local_vault_count as usize,
            vault_selected,
            provider_setup_active,
            add_provider_open,
            session_explicitly_locked,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn remote_vault_assess_decision(
        &self,
        access_status: nook_core::VaultAccessStatus,
        existing_vault_required: bool,
        provider_setup_active: bool,
    ) -> nook_core::RemoteVaultAssessDecision {
        VaultClientPolicy::remote_vault_assess_decision(
            access_status,
            existing_vault_required,
            provider_setup_active,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `vault_connect_probe_decision` count through a JavaScript Number scalar"
        )
    )]
    pub fn vault_connect_probe_decision(
        &self,
        access_status: nook_core::VaultAccessStatus,
        authenticated: bool,
        sync_provider_count: u32,
    ) -> nook_core::VaultConnectProbeDecision {
        VaultClientPolicy::vault_connect_probe_decision(
            access_status,
            authenticated,
            sync_provider_count as usize,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `vault_connect_gate_decision` count through a JavaScript Number scalar"
        )
    )]
    pub fn vault_connect_gate_decision(
        &self,
        access_status: nook_core::VaultAccessStatus,
        password_entry_count: u32,
    ) -> nook_core::VaultConnectGateDecision {
        VaultClientPolicy::vault_connect_gate_decision(access_status, password_entry_count as usize)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn vault_connect_password_lookup_required(
        &self,
        access_status: nook_core::VaultAccessStatus,
    ) -> bool {
        VaultClientPolicy::vault_connect_password_lookup_required(access_status)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn unauthenticated_sync_decision(
        &self,
        changed: bool,
        access_status_available: bool,
        access_status: nook_core::VaultAccessStatus,
        join_state: nook_core::JoinEnrollmentState,
        awaiting_join_approval: bool,
    ) -> nook_core::UnauthenticatedSyncDecision {
        VaultClientPolicy::unauthenticated_sync_decision(
            changed,
            if access_status_available {
                VaultAccessObservation::Available(access_status)
            } else {
                VaultAccessObservation::Unavailable
            },
            join_state,
            awaiting_join_approval,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn should_auto_connect_after_approval(
        &self,
        authenticated: bool,
        verifying: bool,
        password_prompt_open: bool,
        session_expired_by_idle: bool,
        session_explicitly_locked: bool,
    ) -> bool {
        VaultClientPolicy::should_auto_connect_after_approval(
            authenticated,
            verifying,
            password_prompt_open,
            session_expired_by_idle,
            session_explicitly_locked,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects `normalized_secret_page_offset` paging values through JavaScript Number scalars"
        )
    )]
    pub fn normalized_secret_page_offset(
        &self,
        total: u32,
        requested_offset: u32,
        page_size: u32,
    ) -> u32 {
        VaultClientPolicy::normalized_secret_page_offset(total, requested_offset, page_size)
    }

    #[wasm_bindgen]
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn vault_switch_target(
        &self,
        requested_store_id: &str,
        active_store_selected: bool,
        active_store_id: &str,
        verifying: bool,
    ) -> NookVaultSwitchDecision {
        NookVaultSwitchDecision(VaultClientPolicy::vault_switch_target(
            requested_store_id,
            if active_store_selected {
                ActiveVaultStore::Selected(active_store_id)
            } else {
                ActiveVaultStore::Unselected
            },
            verifying,
        ))
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookVaultSwitchState {
    NoChange,
    Switch,
}

#[wasm_bindgen]
pub struct NookVaultSwitchDecision(nook_core::VaultSwitchDecision);

#[wasm_bindgen]
impl NookVaultSwitchDecision {
    #[wasm_bindgen(getter)]
    pub fn state(&self) -> NookVaultSwitchState {
        match self.0 {
            VaultSwitchDecision::NoChange => NookVaultSwitchState::NoChange,
            VaultSwitchDecision::SwitchTo(..) => NookVaultSwitchState::Switch,
        }
    }

    pub fn target(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            VaultSwitchDecision::SwitchTo(target) => Ok(target.clone()),
            VaultSwitchDecision::NoChange => Err(JsError::new("vault switch was not requested")),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{NookClientRunMode, NookRuntimeConfig, NookVaultClientPolicy};

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
            policy.vault_connect_password_lookup_required(
                nook_core::VaultAccessStatus::NeedsEnrollment
            )
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
}
