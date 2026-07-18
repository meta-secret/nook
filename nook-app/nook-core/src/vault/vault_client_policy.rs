//! Portable client/session decisions shared by browser and future native hosts.
//!
//! Hosts own rendering, timers, storage queues, and browser ceremonies. This
//! module owns the state transitions and predicates that must behave the same
//! in every client.

use wasm_bindgen::prelude::wasm_bindgen;

use crate::VaultAccessStatus;

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum JoinEnrollmentState {
    #[default]
    None,
    NeedsRequest,
    Pending,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultEditBlockReason {
    SecurityConflict,
    SyncConflict,
    Architecture,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RemoteVaultAssessDecision {
    Continue,
    PromptRecoveryFromCache,
    PromptMissingRemote,
    RejectMissingExistingVault,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnauthenticatedSyncDecision {
    Ignore,
    MarkJoinPending,
    Approved,
    AutoConnect,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VaultClientPolicy;

impl VaultClientPolicy {
    #[must_use]
    pub const fn edit_block_reason(
        security_conflict_count: usize,
        has_sync_conflict: bool,
        architecture_allows_secret_creation: bool,
    ) -> Option<VaultEditBlockReason> {
        if security_conflict_count > 0 {
            return Some(VaultEditBlockReason::SecurityConflict);
        }
        if has_sync_conflict {
            return Some(VaultEditBlockReason::SyncConflict);
        }
        if !architecture_allows_secret_creation {
            return Some(VaultEditBlockReason::Architecture);
        }
        None
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
    pub const fn has_password_envelope(
        password_entry_count: usize,
        password_unlock_mode: bool,
    ) -> bool {
        password_entry_count > 0 || password_unlock_mode
    }

    #[must_use]
    #[allow(clippy::fn_params_excessive_bools)]
    pub const fn should_auto_unlock(
        session_explicitly_locked: bool,
        local_vault_present: bool,
        password_entry_count: usize,
        sync_provider_count: usize,
        provider_setup_active: bool,
        add_provider_open: bool,
    ) -> bool {
        !session_explicitly_locked
            && local_vault_present
            && password_entry_count == 0
            && sync_provider_count == 0
            && !provider_setup_active
            && !add_provider_open
    }

    #[must_use]
    #[allow(clippy::fn_params_excessive_bools)]
    pub const fn should_show_login_vault_picker(
        authenticated: bool,
        local_vault_count: usize,
        vault_selected: bool,
        provider_setup_active: bool,
        add_provider_open: bool,
        session_explicitly_locked: bool,
    ) -> bool {
        !authenticated
            && local_vault_count > 1
            && !vault_selected
            && !provider_setup_active
            && !add_provider_open
            && session_explicitly_locked
    }

    #[must_use]
    pub const fn remote_vault_assess_decision(
        access_status: VaultAccessStatus,
        existing_vault_required: bool,
        provider_setup_active: bool,
    ) -> RemoteVaultAssessDecision {
        match access_status {
            VaultAccessStatus::RemoteMissingLocalCache => {
                RemoteVaultAssessDecision::PromptRecoveryFromCache
            }
            VaultAccessStatus::RemoteMissing if existing_vault_required => {
                RemoteVaultAssessDecision::RejectMissingExistingVault
            }
            VaultAccessStatus::RemoteMissing if provider_setup_active => {
                RemoteVaultAssessDecision::Continue
            }
            VaultAccessStatus::RemoteMissing => RemoteVaultAssessDecision::PromptMissingRemote,
            VaultAccessStatus::NewVault
            | VaultAccessStatus::Ready
            | VaultAccessStatus::NeedsEnrollment
            | VaultAccessStatus::JoinPending => RemoteVaultAssessDecision::Continue,
        }
    }

    #[must_use]
    pub const fn unauthenticated_sync_decision(
        changed: bool,
        access_status: Option<VaultAccessStatus>,
        join_state: JoinEnrollmentState,
        awaiting_join_approval: bool,
    ) -> UnauthenticatedSyncDecision {
        if !changed {
            return UnauthenticatedSyncDecision::Ignore;
        }
        match (access_status, join_state, awaiting_join_approval) {
            (Some(VaultAccessStatus::Ready), JoinEnrollmentState::Pending, _) => {
                UnauthenticatedSyncDecision::Approved
            }
            (Some(VaultAccessStatus::Ready), _, true) => UnauthenticatedSyncDecision::AutoConnect,
            (Some(VaultAccessStatus::JoinPending), JoinEnrollmentState::None, _) => {
                UnauthenticatedSyncDecision::MarkJoinPending
            }
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
    pub const fn normalized_secret_page_offset(
        total: u32,
        requested_offset: u32,
        page_size: u32,
    ) -> u32 {
        if total == 0 || page_size == 0 || requested_offset < total {
            return requested_offset;
        }
        ((total - 1) / page_size) * page_size
    }

    #[must_use]
    pub fn vault_switch_target(
        requested_store_id: &str,
        active_store_id: Option<&str>,
        verifying: bool,
    ) -> Option<String> {
        let requested_store_id = requested_store_id.trim();
        if verifying
            || requested_store_id.is_empty()
            || active_store_id.is_some_and(|active| active.trim() == requested_store_id)
        {
            return None;
        }
        Some(requested_store_id.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edit_blocking_has_security_first_precedence() {
        assert_eq!(
            VaultClientPolicy::edit_block_reason(1, true, false),
            Some(VaultEditBlockReason::SecurityConflict)
        );
        assert_eq!(
            VaultClientPolicy::edit_block_reason(0, true, false),
            Some(VaultEditBlockReason::SyncConflict)
        );
        assert_eq!(
            VaultClientPolicy::edit_block_reason(0, false, false),
            Some(VaultEditBlockReason::Architecture)
        );
        assert_eq!(VaultClientPolicy::edit_block_reason(0, false, true), None);
    }

    #[test]
    fn auto_unlock_requires_an_unlocked_local_key_only_session() {
        assert!(VaultClientPolicy::should_auto_unlock(
            false, true, 0, 0, false, false
        ));
        for blocked in [
            (true, true, 0, 0, false, false),
            (false, false, 0, 0, false, false),
            (false, true, 1, 0, false, false),
            (false, true, 0, 1, false, false),
            (false, true, 0, 0, true, false),
            (false, true, 0, 0, false, true),
        ] {
            assert!(!VaultClientPolicy::should_auto_unlock(
                blocked.0, blocked.1, blocked.2, blocked.3, blocked.4, blocked.5
            ));
        }
    }

    #[test]
    fn login_picker_is_only_for_explicitly_locked_multi_vault_sessions() {
        assert!(VaultClientPolicy::should_show_login_vault_picker(
            false, 2, false, false, false, true
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            true, 2, false, false, false, true
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            false, 1, false, false, false, true
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            false, 2, true, false, false, true
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            false, 2, false, true, false, true
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            false, 2, false, false, true, true
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            false, 2, false, false, false, false
        ));
    }

    #[test]
    fn remote_missing_policy_distinguishes_recovery_creation_and_open() {
        assert_eq!(
            VaultClientPolicy::remote_vault_assess_decision(
                VaultAccessStatus::RemoteMissingLocalCache,
                false,
                false
            ),
            RemoteVaultAssessDecision::PromptRecoveryFromCache
        );
        assert_eq!(
            VaultClientPolicy::remote_vault_assess_decision(
                VaultAccessStatus::RemoteMissing,
                true,
                false
            ),
            RemoteVaultAssessDecision::RejectMissingExistingVault
        );
        assert_eq!(
            VaultClientPolicy::remote_vault_assess_decision(
                VaultAccessStatus::RemoteMissing,
                false,
                true
            ),
            RemoteVaultAssessDecision::Continue
        );
        assert_eq!(
            VaultClientPolicy::remote_vault_assess_decision(
                VaultAccessStatus::RemoteMissing,
                false,
                false
            ),
            RemoteVaultAssessDecision::PromptMissingRemote
        );
    }

    #[test]
    fn join_sync_transition_preserves_approval_semantics() {
        assert_eq!(
            VaultClientPolicy::unauthenticated_sync_decision(
                false,
                Some(VaultAccessStatus::Ready),
                JoinEnrollmentState::Pending,
                true
            ),
            UnauthenticatedSyncDecision::Ignore
        );
        assert_eq!(
            VaultClientPolicy::unauthenticated_sync_decision(
                true,
                Some(VaultAccessStatus::Ready),
                JoinEnrollmentState::Pending,
                true
            ),
            UnauthenticatedSyncDecision::Approved
        );
        assert_eq!(
            VaultClientPolicy::unauthenticated_sync_decision(
                true,
                Some(VaultAccessStatus::Ready),
                JoinEnrollmentState::None,
                true
            ),
            UnauthenticatedSyncDecision::AutoConnect
        );
        assert_eq!(
            VaultClientPolicy::unauthenticated_sync_decision(
                true,
                Some(VaultAccessStatus::JoinPending),
                JoinEnrollmentState::None,
                false
            ),
            UnauthenticatedSyncDecision::MarkJoinPending
        );
    }

    #[test]
    fn secret_page_offset_moves_to_the_last_non_empty_page() {
        assert_eq!(
            VaultClientPolicy::normalized_secret_page_offset(101, 150, 50),
            100
        );
        assert_eq!(
            VaultClientPolicy::normalized_secret_page_offset(100, 100, 50),
            50
        );
        assert_eq!(
            VaultClientPolicy::normalized_secret_page_offset(100, 50, 50),
            50
        );
        assert_eq!(
            VaultClientPolicy::normalized_secret_page_offset(0, 50, 50),
            50
        );
        assert_eq!(
            VaultClientPolicy::normalized_secret_page_offset(100, 100, 0),
            100
        );
    }

    #[test]
    fn vault_switch_target_is_trimmed_and_rejects_noops() {
        assert_eq!(
            VaultClientPolicy::vault_switch_target(" store-b ", Some("store-a"), false),
            Some("store-b".to_owned())
        );
        assert_eq!(
            VaultClientPolicy::vault_switch_target("store-a", Some(" store-a "), false),
            None
        );
        assert_eq!(
            VaultClientPolicy::vault_switch_target("store-b", Some("store-a"), true),
            None
        );
    }
}
