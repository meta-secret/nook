//! Portable client/session decisions shared by browser and future native hosts.
//!
//! Hosts own rendering, timers, storage queues, and browser ceremonies. This
//! module owns the state transitions and predicates that must behave the same
//! in every client.

use wasm_bindgen::prelude::wasm_bindgen;

mod connection;
mod sync_policy;

pub use connection::{
    ActiveVaultStore, JoinEnrollmentState, RemoteVaultAssessDecision, RemoteVaultRecoveryState,
    VaultConnectGateDecision, VaultConnectProbeDecision, VaultSwitchDecision,
};
pub use sync_policy::{
    UnauthenticatedSyncDecision, VaultAccessObservation, VaultStorageSyncDecision,
    VaultSyncTimerStartDecision, VaultSyncTimerTickDecision,
};

use crate::translate_from_catalog;

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

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeviceIdentityInitializationMode {
    RequireCompletedAuthorization,
    AllowPendingAuthorization,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExternalDeviceIdentityAuthorizationMode {
    ContinueInitialization,
    DeferInitialization,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderSyncVisibility {
    Visible,
    Quiet,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderSyncFailureHandling {
    Capture,
    Propagate,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderSyncFreshness {
    Scheduled,
    Forced,
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
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultEditDecision {
    Allowed,
    BlockedSecurityConflict,
    BlockedSyncConflict,
    BlockedByArchitecture,
}

impl VaultEditDecision {
    #[must_use]
    pub const fn translation_key(self) -> Option<&'static str> {
        match self {
            Self::Allowed => None,
            Self::BlockedSecurityConflict => {
                Some(crate::i18n_keys::AUTH_STORAGE_SECURITY_CONFLICT_EDITS)
            }
            Self::BlockedSyncConflict => Some(crate::i18n_keys::AUTH_STORAGE_SYNC_BLOCKED_EDITS),
            Self::BlockedByArchitecture => {
                Some(crate::i18n_keys::ARCHITECTURE_MODES_SENTINEL_SECRET_CREATION_BLOCKED)
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VaultClientPolicy;

impl VaultClientPolicy {
    #[must_use]
    pub const fn edit_block_reason(
        security_conflict_count: usize,
        has_sync_conflict: bool,
        architecture_allows_secret_creation: bool,
    ) -> VaultEditDecision {
        if security_conflict_count > 0 {
            return VaultEditDecision::BlockedSecurityConflict;
        }
        if has_sync_conflict {
            return VaultEditDecision::BlockedSyncConflict;
        }
        if !architecture_allows_secret_creation {
            return VaultEditDecision::BlockedByArchitecture;
        }
        VaultEditDecision::Allowed
    }

    #[must_use]
    pub const fn edits_blocked(
        security_conflict_count: usize,
        has_sync_conflict: bool,
        architecture_allows_secret_creation: bool,
    ) -> bool {
        !matches!(
            Self::edit_block_reason(
                security_conflict_count,
                has_sync_conflict,
                architecture_allows_secret_creation,
            ),
            VaultEditDecision::Allowed
        )
    }

    #[must_use]
    pub fn edit_block_message(
        security_conflict_count: usize,
        has_sync_conflict: bool,
        architecture_allows_secret_creation: bool,
        catalog_json: &str,
        locale: &str,
    ) -> Option<String> {
        let translation_key = Self::edit_block_reason(
            security_conflict_count,
            has_sync_conflict,
            architecture_allows_secret_creation,
        )
        .translation_key()?;
        Some(translate_from_catalog(
            catalog_json,
            locale,
            translation_key,
        ))
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edit_blocking_has_security_first_precedence() {
        assert_eq!(
            VaultClientPolicy::edit_block_reason(1, true, false),
            VaultEditDecision::BlockedSecurityConflict
        );
        assert_eq!(
            VaultClientPolicy::edit_block_reason(0, true, false),
            VaultEditDecision::BlockedSyncConflict
        );
        assert_eq!(
            VaultClientPolicy::edit_block_reason(0, false, false),
            VaultEditDecision::BlockedByArchitecture
        );
        assert_eq!(
            VaultClientPolicy::edit_block_reason(0, false, true),
            VaultEditDecision::Allowed
        );
        assert_eq!(
            VaultEditDecision::BlockedSecurityConflict.translation_key(),
            Some(crate::i18n_keys::AUTH_STORAGE_SECURITY_CONFLICT_EDITS)
        );
        assert_eq!(
            VaultEditDecision::BlockedSyncConflict.translation_key(),
            Some(crate::i18n_keys::AUTH_STORAGE_SYNC_BLOCKED_EDITS)
        );
        assert_eq!(
            VaultEditDecision::BlockedByArchitecture.translation_key(),
            Some(crate::i18n_keys::ARCHITECTURE_MODES_SENTINEL_SECRET_CREATION_BLOCKED)
        );
        assert_eq!(VaultEditDecision::Allowed.translation_key(), None);
        assert!(VaultClientPolicy::edits_blocked(1, false, true));
        assert!(!VaultClientPolicy::edits_blocked(0, false, true));
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
}
