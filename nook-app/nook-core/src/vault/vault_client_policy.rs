//! Portable client/session decisions shared by browser and future native hosts.
//!
//! Hosts own rendering, timers, storage queues, and browser ceremonies. This
//! module owns the state transitions and predicates that must behave the same
//! in every client.

use wasm_bindgen::prelude::wasm_bindgen;

use crate::{VaultAccessStatus, translate_from_catalog};

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DeviceProtectionStatus {
    #[default]
    Loading,
    Missing,
    Plaintext,
    Passkey,
    Pin,
    PinSetup,
    Unlocked,
    Error,
}

impl DeviceProtectionStatus {
    #[must_use]
    pub fn from_persisted(value: &str) -> Option<Self> {
        match value {
            "missing" => Some(Self::Missing),
            "plaintext" => Some(Self::Plaintext),
            "passkey" => Some(Self::Passkey),
            "pin" => Some(Self::Pin),
            _ => None,
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Loading => "loading",
            Self::Missing => "missing",
            Self::Plaintext => "plaintext",
            Self::Passkey => "passkey",
            Self::Pin => "pin",
            Self::PinSetup => "pin-setup",
            Self::Unlocked => "unlocked",
            Self::Error => "error",
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SentinelVaultUnlockState {
    #[default]
    NotSentinel,
    Unlocked,
    AwaitingShares,
    CeremonyRequired,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RemoteVaultRecoveryState {
    #[default]
    None,
    PromptWithCache,
    PromptMissingOnly,
    ConnectFromCache,
    ConnectFresh,
}

impl RemoteVaultRecoveryState {
    #[must_use]
    pub const fn prompt_visible(self) -> bool {
        matches!(self, Self::PromptWithCache | Self::PromptMissingOnly)
    }

    #[must_use]
    pub const fn prompt_has_cache(self) -> bool {
        matches!(self, Self::PromptWithCache)
    }
}

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

impl VaultEditBlockReason {
    #[must_use]
    pub const fn translation_key(self) -> &'static str {
        match self {
            Self::SecurityConflict => "auth_storage.security_conflict_edits",
            Self::SyncConflict => "auth_storage.sync_blocked_edits",
            Self::Architecture => "architecture_modes.sentinel_secret_creation_blocked",
        }
    }
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
    pub const fn remote_recovery_prompt_visible(state: RemoteVaultRecoveryState) -> bool {
        state.prompt_visible()
    }

    #[must_use]
    pub const fn remote_recovery_prompt_has_cache(state: RemoteVaultRecoveryState) -> bool {
        state.prompt_has_cache()
    }

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
    pub fn edit_block_message(
        security_conflict_count: usize,
        has_sync_conflict: bool,
        architecture_allows_secret_creation: bool,
        catalog_json: &str,
        locale: &str,
    ) -> Option<String> {
        let reason = Self::edit_block_reason(
            security_conflict_count,
            has_sync_conflict,
            architecture_allows_secret_creation,
        )?;
        Some(translate_from_catalog(
            catalog_json,
            locale,
            reason.translation_key(),
        ))
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
    pub const fn should_use_join_provider_for_connect(
        authenticated: bool,
        sync_provider_count: usize,
        join_state: JoinEnrollmentState,
    ) -> bool {
        !authenticated
            && sync_provider_count > 0
            && !matches!(join_state, JoinEnrollmentState::None)
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
    pub const fn existing_vault_identity_recovery_required(
        existing_vault_required: bool,
        provider_setup_active: bool,
        device_protection_ready: bool,
    ) -> bool {
        existing_vault_required && provider_setup_active && !device_protection_ready
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
        assert_eq!(
            VaultEditBlockReason::SecurityConflict.translation_key(),
            "auth_storage.security_conflict_edits"
        );
        assert_eq!(
            VaultEditBlockReason::SyncConflict.translation_key(),
            "auth_storage.sync_blocked_edits"
        );
        assert_eq!(
            VaultEditBlockReason::Architecture.translation_key(),
            "architecture_modes.sentinel_secret_creation_blocked"
        );
        assert_eq!(
            VaultClientPolicy::edit_block_message(
                1,
                true,
                false,
                crate::get_translation_catalog("en"),
                "en",
            )
            .as_deref(),
            Some("Security conflict detected. Sync from all devices before editing.")
        );
        assert_eq!(
            VaultClientPolicy::edit_block_message(0, false, true, "{}", "en"),
            None
        );
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
    fn provider_connect_and_sync_guards_are_portable() {
        assert!(VaultClientPolicy::should_use_join_provider_for_connect(
            false,
            1,
            JoinEnrollmentState::Pending,
        ));
        assert!(!VaultClientPolicy::should_use_join_provider_for_connect(
            true,
            1,
            JoinEnrollmentState::Pending,
        ));
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
    fn existing_vault_import_recovers_identity_before_provider_connect() {
        assert!(VaultClientPolicy::existing_vault_identity_recovery_required(true, true, false));
        assert!(!VaultClientPolicy::existing_vault_identity_recovery_required(false, true, false));
        assert!(!VaultClientPolicy::existing_vault_identity_recovery_required(true, false, false));
        assert!(!VaultClientPolicy::existing_vault_identity_recovery_required(true, true, true));
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
    fn remote_recovery_state_exposes_only_prompt_variants_to_the_ui() {
        assert!(VaultClientPolicy::remote_recovery_prompt_visible(
            RemoteVaultRecoveryState::PromptWithCache
        ));
        assert!(VaultClientPolicy::remote_recovery_prompt_visible(
            RemoteVaultRecoveryState::PromptMissingOnly
        ));
        assert!(!VaultClientPolicy::remote_recovery_prompt_visible(
            RemoteVaultRecoveryState::ConnectFromCache
        ));
        assert!(VaultClientPolicy::remote_recovery_prompt_has_cache(
            RemoteVaultRecoveryState::PromptWithCache
        ));
        assert!(!VaultClientPolicy::remote_recovery_prompt_has_cache(
            RemoteVaultRecoveryState::PromptMissingOnly
        ));
    }

    #[test]
    fn persisted_device_protection_status_is_parsed_once_in_core() {
        assert_eq!(
            DeviceProtectionStatus::from_persisted("passkey"),
            Some(DeviceProtectionStatus::Passkey)
        );
        assert_eq!(
            DeviceProtectionStatus::from_persisted("pin"),
            Some(DeviceProtectionStatus::Pin)
        );
        assert_eq!(DeviceProtectionStatus::from_persisted("future"), None);
        assert_eq!(DeviceProtectionStatus::Unlocked.as_str(), "unlocked");
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
