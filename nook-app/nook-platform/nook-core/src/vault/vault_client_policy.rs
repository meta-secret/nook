//! Portable client/session decisions shared by browser and future native hosts.
//!
//! Hosts own rendering, timers, storage queues, and browser ceremonies. This
//! module owns the state transitions and predicates that must behave the same
//! in every client.

use nook_app_common::AppLocale;
use nook_app_common::TranslateFromCatalogRequest;
use nook_app_common::TranslationCatalog;
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

use crate::i18n_keys;

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
            Self::BlockedSecurityConflict => Some(i18n_keys::AUTH_STORAGE_SECURITY_CONFLICT_EDITS),
            Self::BlockedSyncConflict => Some(i18n_keys::AUTH_STORAGE_SYNC_BLOCKED_EDITS),
            Self::BlockedByArchitecture => {
                Some(i18n_keys::ARCHITECTURE_MODES_SENTINEL_SECRET_CREATION_BLOCKED)
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VaultClientPolicy;

impl VaultClientPolicy {
    #[must_use]
    pub const fn edit_block_reason(
        security_conflict_count: crate::VaultSecurityConflictCount,
        has_sync_conflict: bool,
        architecture_allows_secret_creation: bool,
    ) -> VaultEditDecision {
        if security_conflict_count.is_nonzero() {
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
        security_conflict_count: crate::VaultSecurityConflictCount,
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
        security_conflict_count: crate::VaultSecurityConflictCount,
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
        Some(TranslationCatalog::translate_from_catalog(
            TranslateFromCatalogRequest {
                catalog_json: catalog_json,
                locale: locale,
                key: translation_key,
            },
        ))
    }

    #[must_use]
    pub const fn should_use_join_provider_for_connect(
        authenticated: bool,
        sync_provider_count: crate::VaultSyncProviderCount,
        join_state: JoinEnrollmentState,
    ) -> bool {
        !authenticated
            && sync_provider_count.is_nonzero()
            && !matches!(join_state, JoinEnrollmentState::None)
    }

    #[must_use]
    #[allow(clippy::fn_params_excessive_bools)]
    pub const fn should_auto_unlock(
        session_explicitly_locked: bool,
        local_vault_present: bool,
        password_entry_count: crate::VaultPasswordEntryCount,
        sync_provider_count: crate::VaultSyncProviderCount,
        provider_setup_active: bool,
        add_provider_open: bool,
    ) -> bool {
        !session_explicitly_locked
            && local_vault_present
            && password_entry_count.is_zero()
            && sync_provider_count.is_zero()
            && !provider_setup_active
            && !add_provider_open
    }

    #[must_use]
    #[allow(clippy::fn_params_excessive_bools)]
    pub const fn should_show_login_vault_picker(
        authenticated: bool,
        local_vault_count: crate::LocalVaultCount,
        vault_selected: bool,
        provider_setup_active: bool,
        add_provider_open: bool,
        session_explicitly_locked: bool,
    ) -> bool {
        !authenticated
            && local_vault_count.is_multiple()
            && !vault_selected
            && !provider_setup_active
            && !add_provider_open
            && session_explicitly_locked
    }

    #[must_use]
    pub const fn normalized_secret_page_offset(
        total: crate::SecretRecordCount,
        requested_offset: crate::SecretPageOffset,
        page_size: crate::SecretPageLimit,
    ) -> crate::SecretPageOffset {
        requested_offset.normalized_for(total, page_size)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edit_blocking_has_security_first_precedence() {
        assert_eq!(
            VaultClientPolicy::edit_block_reason(1.into(), true, false),
            VaultEditDecision::BlockedSecurityConflict
        );
        assert_eq!(
            VaultClientPolicy::edit_block_reason(0.into(), true, false),
            VaultEditDecision::BlockedSyncConflict
        );
        assert_eq!(
            VaultClientPolicy::edit_block_reason(0.into(), false, false),
            VaultEditDecision::BlockedByArchitecture
        );
        assert_eq!(
            VaultClientPolicy::edit_block_reason(0.into(), false, true),
            VaultEditDecision::Allowed
        );
        assert_eq!(
            VaultEditDecision::BlockedSecurityConflict.translation_key(),
            Some(i18n_keys::AUTH_STORAGE_SECURITY_CONFLICT_EDITS)
        );
        assert_eq!(
            VaultEditDecision::BlockedSyncConflict.translation_key(),
            Some(i18n_keys::AUTH_STORAGE_SYNC_BLOCKED_EDITS)
        );
        assert_eq!(
            VaultEditDecision::BlockedByArchitecture.translation_key(),
            Some(i18n_keys::ARCHITECTURE_MODES_SENTINEL_SECRET_CREATION_BLOCKED)
        );
        assert_eq!(VaultEditDecision::Allowed.translation_key(), None);
        assert!(VaultClientPolicy::edits_blocked(1.into(), false, true));
        assert!(!VaultClientPolicy::edits_blocked(0.into(), false, true));
        assert_eq!(
            VaultClientPolicy::edit_block_message(
                1.into(),
                true,
                false,
                AppLocale::get_translation_catalog("en"),
                "en",
            )
            .as_deref(),
            Some("Security conflict detected. Sync from all devices before editing.")
        );
        assert_eq!(
            VaultClientPolicy::edit_block_message(0.into(), false, true, "{}", "en"),
            None
        );
    }

    #[test]
    fn auto_unlock_requires_an_unlocked_local_key_only_session() {
        assert!(VaultClientPolicy::should_auto_unlock(
            false,
            true,
            0.into(),
            0.into(),
            false,
            false
        ));
        for blocked in [
            (true, true, 0_usize, 0_usize, false, false),
            (false, false, 0, 0, false, false),
            (false, true, 1, 0, false, false),
            (false, true, 0, 1, false, false),
            (false, true, 0, 0, true, false),
            (false, true, 0, 0, false, true),
        ] {
            assert!(!VaultClientPolicy::should_auto_unlock(
                blocked.0,
                blocked.1,
                blocked.2.into(),
                blocked.3.into(),
                blocked.4,
                blocked.5
            ));
        }
    }

    #[test]
    fn provider_connect_and_sync_guards_are_portable() {
        assert!(VaultClientPolicy::should_use_join_provider_for_connect(
            false,
            1.into(),
            JoinEnrollmentState::Pending,
        ));
        assert!(!VaultClientPolicy::should_use_join_provider_for_connect(
            true,
            1.into(),
            JoinEnrollmentState::Pending,
        ));
    }

    #[test]
    fn login_picker_is_only_for_explicitly_locked_multi_vault_sessions() {
        assert!(VaultClientPolicy::should_show_login_vault_picker(
            false,
            2.into(),
            false,
            false,
            false,
            true
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            true,
            2.into(),
            false,
            false,
            false,
            true
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            false,
            1.into(),
            false,
            false,
            false,
            true
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            false,
            2.into(),
            true,
            false,
            false,
            true
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            false,
            2.into(),
            false,
            true,
            false,
            true
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            false,
            2.into(),
            false,
            false,
            true,
            true
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            false,
            2.into(),
            false,
            false,
            false,
            false
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
            usize::from(VaultClientPolicy::normalized_secret_page_offset(
                101.into(),
                150.into(),
                50.into()
            )),
            100
        );
        assert_eq!(
            usize::from(VaultClientPolicy::normalized_secret_page_offset(
                100.into(),
                100.into(),
                50.into()
            )),
            50
        );
        assert_eq!(
            usize::from(VaultClientPolicy::normalized_secret_page_offset(
                100.into(),
                50.into(),
                50.into()
            )),
            50
        );
        assert_eq!(
            usize::from(VaultClientPolicy::normalized_secret_page_offset(
                0.into(),
                50.into(),
                50.into()
            )),
            50
        );
        assert_eq!(
            usize::from(VaultClientPolicy::normalized_secret_page_offset(
                100.into(),
                100.into(),
                0.into()
            )),
            100
        );
    }
}
