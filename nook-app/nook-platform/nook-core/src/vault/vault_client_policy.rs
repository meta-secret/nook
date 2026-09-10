//! Portable client/session decisions shared by browser and future native hosts.
//!
//! Hosts own rendering, timers, storage queues, and browser ceremonies. This
//! module owns the state transitions and predicates that must behave the same
//! in every client.

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("unknown persisted device protection status")]
pub struct InvalidDeviceProtectionStatus;

impl DeviceProtectionStatus {
    #[must_use]
    pub fn from_persisted(value: &str) -> Result<Self, InvalidDeviceProtectionStatus> {
        match value {
            "missing" => Ok(Self::Missing),
            "plaintext" => Ok(Self::Plaintext),
            "passkey" => Ok(Self::Passkey),
            "pin" => Ok(Self::Pin),
            _ => Err(InvalidDeviceProtectionStatus),
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

#[derive(Debug, PartialEq, Eq)]
pub enum VaultEditMessage {
    Allowed,
    Blocked(String),
}
#[derive(Debug, PartialEq, Eq)]
pub enum VaultEditTranslation {
    Allowed,
    Blocked(&'static str),
}

impl VaultEditDecision {
    #[must_use]
    pub const fn translation_key(self) -> VaultEditTranslation {
        match self {
            Self::Allowed => VaultEditTranslation::Allowed,
            Self::BlockedSecurityConflict => {
                VaultEditTranslation::Blocked(i18n_keys::AUTH_STORAGE_SECURITY_CONFLICT_EDITS)
            }
            Self::BlockedSyncConflict => {
                VaultEditTranslation::Blocked(i18n_keys::AUTH_STORAGE_SYNC_BLOCKED_EDITS)
            }
            Self::BlockedByArchitecture => VaultEditTranslation::Blocked(
                i18n_keys::ARCHITECTURE_MODES_SENTINEL_SECRET_CREATION_BLOCKED,
            ),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VaultClientPolicy;

impl VaultClientPolicy {
    #[must_use]
    pub const fn edit_block_reason(request: crate::EditBlockReasonRequest) -> VaultEditDecision {
        if request.security_conflict_count.is_nonzero() {
            return VaultEditDecision::BlockedSecurityConflict;
        }
        if matches!(
            request.has_sync_conflict,
            crate::VaultSyncConflictState::Conflicted
        ) {
            return VaultEditDecision::BlockedSyncConflict;
        }
        if !matches!(
            request.architecture_allows_secret_creation,
            crate::VaultSecretCreationPermission::Allowed
        ) {
            return VaultEditDecision::BlockedByArchitecture;
        }
        VaultEditDecision::Allowed
    }

    #[must_use]
    pub const fn edits_blocked(request: crate::EditsBlockedRequest) -> bool {
        !matches!(
            Self::edit_block_reason(crate::EditBlockReasonRequest {
                security_conflict_count: request.security_conflict_count,
                has_sync_conflict: request.has_sync_conflict,
                architecture_allows_secret_creation: request.architecture_allows_secret_creation
            }),
            VaultEditDecision::Allowed
        )
    }

    #[must_use]
    pub fn edit_block_message(request: crate::EditBlockMessageRequest<'_>) -> VaultEditMessage {
        let translation = Self::edit_block_reason(crate::EditBlockReasonRequest {
            security_conflict_count: request.security_conflict_count,
            has_sync_conflict: request.has_sync_conflict,
            architecture_allows_secret_creation: request.architecture_allows_secret_creation,
        })
        .translation_key();
        let VaultEditTranslation::Blocked(translation_key) = translation else {
            return VaultEditMessage::Allowed;
        };
        VaultEditMessage::Blocked(TranslationCatalog::translate_from_catalog(
            TranslateFromCatalogRequest {
                catalog_json: request.catalog_json,
                locale: request.locale,
                key: translation_key,
            },
        ))
    }

    #[must_use]
    pub const fn should_use_join_provider_for_connect(
        request: crate::ShouldUseJoinProviderForConnectRequest,
    ) -> bool {
        !matches!(
            request.authenticated,
            crate::VaultAuthenticationState::Authenticated
        ) && request.sync_provider_count.is_nonzero()
            && !matches!(request.join_state, JoinEnrollmentState::None)
    }

    #[must_use]
    pub const fn should_auto_unlock(request: crate::ShouldAutoUnlockRequest) -> bool {
        !matches!(
            request.session_explicitly_locked,
            crate::VaultSessionLockIntent::ExplicitlyLocked
        ) && matches!(
            request.local_vault_present,
            crate::LocalVaultPresence::Present
        ) && request.password_entry_count.is_zero()
            && request.sync_provider_count.is_zero()
            && !matches!(
                request.provider_setup_active,
                crate::ProviderSetupState::Active
            )
            && !matches!(
                request.add_provider_open,
                crate::AddProviderPromptState::Open
            )
    }

    #[must_use]
    pub const fn should_show_login_vault_picker(
        request: crate::ShouldShowLoginVaultPickerRequest,
    ) -> bool {
        !matches!(
            request.authenticated,
            crate::VaultAuthenticationState::Authenticated
        ) && request.local_vault_count.is_multiple()
            && !matches!(request.vault_selected, crate::VaultSelectionState::Selected)
            && !matches!(
                request.provider_setup_active,
                crate::ProviderSetupState::Active
            )
            && !matches!(
                request.add_provider_open,
                crate::AddProviderPromptState::Open
            )
            && matches!(
                request.session_explicitly_locked,
                crate::VaultSessionLockIntent::ExplicitlyLocked
            )
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
    use nook_app_common::AppLocale;

    #[test]
    fn edit_blocking_has_security_first_precedence() {
        assert_eq!(
            VaultClientPolicy::edit_block_reason(crate::EditBlockReasonRequest {
                security_conflict_count: 1.into(),
                has_sync_conflict: (true).into(),
                architecture_allows_secret_creation: (false).into()
            }),
            VaultEditDecision::BlockedSecurityConflict
        );
        assert_eq!(
            VaultClientPolicy::edit_block_reason(crate::EditBlockReasonRequest {
                security_conflict_count: 0.into(),
                has_sync_conflict: (true).into(),
                architecture_allows_secret_creation: (false).into()
            }),
            VaultEditDecision::BlockedSyncConflict
        );
        assert_eq!(
            VaultClientPolicy::edit_block_reason(crate::EditBlockReasonRequest {
                security_conflict_count: 0.into(),
                has_sync_conflict: (false).into(),
                architecture_allows_secret_creation: (false).into()
            }),
            VaultEditDecision::BlockedByArchitecture
        );
        assert_eq!(
            VaultClientPolicy::edit_block_reason(crate::EditBlockReasonRequest {
                security_conflict_count: 0.into(),
                has_sync_conflict: (false).into(),
                architecture_allows_secret_creation: (true).into()
            }),
            VaultEditDecision::Allowed
        );
        assert_eq!(
            VaultEditDecision::BlockedSecurityConflict.translation_key(),
            VaultEditTranslation::Blocked(i18n_keys::AUTH_STORAGE_SECURITY_CONFLICT_EDITS)
        );
        assert_eq!(
            VaultEditDecision::BlockedSyncConflict.translation_key(),
            VaultEditTranslation::Blocked(i18n_keys::AUTH_STORAGE_SYNC_BLOCKED_EDITS)
        );
        assert_eq!(
            VaultEditDecision::BlockedByArchitecture.translation_key(),
            VaultEditTranslation::Blocked(
                i18n_keys::ARCHITECTURE_MODES_SENTINEL_SECRET_CREATION_BLOCKED
            )
        );
        assert_eq!(
            VaultEditDecision::Allowed.translation_key(),
            VaultEditTranslation::Allowed
        );
        assert!(VaultClientPolicy::edits_blocked(
            crate::EditsBlockedRequest {
                security_conflict_count: 1.into(),
                has_sync_conflict: (false).into(),
                architecture_allows_secret_creation: (true).into()
            }
        ));
        assert!(!VaultClientPolicy::edits_blocked(
            crate::EditsBlockedRequest {
                security_conflict_count: 0.into(),
                has_sync_conflict: (false).into(),
                architecture_allows_secret_creation: (true).into()
            }
        ));
        assert_eq!(
            VaultClientPolicy::edit_block_message(crate::EditBlockMessageRequest {
                security_conflict_count: 1.into(),
                has_sync_conflict: (true).into(),
                architecture_allows_secret_creation: (false).into(),
                catalog_json: AppLocale::get_translation_catalog("en"),
                locale: "en"
            }),
            VaultEditMessage::Blocked(
                "Security conflict detected. Sync from all devices before editing.".to_owned()
            )
        );
        assert_eq!(
            VaultClientPolicy::edit_block_message(crate::EditBlockMessageRequest {
                security_conflict_count: 0.into(),
                has_sync_conflict: (false).into(),
                architecture_allows_secret_creation: (true).into(),
                catalog_json: "{}",
                locale: "en"
            }),
            VaultEditMessage::Allowed
        );
    }

    #[test]
    fn auto_unlock_requires_an_unlocked_local_key_only_session() {
        assert!(VaultClientPolicy::should_auto_unlock(
            crate::ShouldAutoUnlockRequest {
                session_explicitly_locked: (false).into(),
                local_vault_present: (true).into(),
                password_entry_count: 0.into(),
                sync_provider_count: 0.into(),
                provider_setup_active: (false).into(),
                add_provider_open: (false).into()
            }
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
                crate::ShouldAutoUnlockRequest {
                    session_explicitly_locked: (blocked.0).into(),
                    local_vault_present: (blocked.1).into(),
                    password_entry_count: blocked.2.into(),
                    sync_provider_count: blocked.3.into(),
                    provider_setup_active: (blocked.4).into(),
                    add_provider_open: (blocked.5).into()
                }
            ));
        }
    }

    #[test]
    fn provider_connect_and_sync_guards_are_portable() {
        assert!(VaultClientPolicy::should_use_join_provider_for_connect(
            crate::ShouldUseJoinProviderForConnectRequest {
                authenticated: (false).into(),
                sync_provider_count: 1.into(),
                join_state: JoinEnrollmentState::Pending
            }
        ));
        assert!(!VaultClientPolicy::should_use_join_provider_for_connect(
            crate::ShouldUseJoinProviderForConnectRequest {
                authenticated: (true).into(),
                sync_provider_count: 1.into(),
                join_state: JoinEnrollmentState::Pending
            }
        ));
    }

    #[test]
    fn login_picker_is_only_for_explicitly_locked_multi_vault_sessions() {
        assert!(VaultClientPolicy::should_show_login_vault_picker(
            crate::ShouldShowLoginVaultPickerRequest {
                authenticated: (false).into(),
                local_vault_count: 2.into(),
                vault_selected: (false).into(),
                provider_setup_active: (false).into(),
                add_provider_open: (false).into(),
                session_explicitly_locked: (true).into()
            }
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            crate::ShouldShowLoginVaultPickerRequest {
                authenticated: (true).into(),
                local_vault_count: 2.into(),
                vault_selected: (false).into(),
                provider_setup_active: (false).into(),
                add_provider_open: (false).into(),
                session_explicitly_locked: (true).into()
            }
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            crate::ShouldShowLoginVaultPickerRequest {
                authenticated: (false).into(),
                local_vault_count: 1.into(),
                vault_selected: (false).into(),
                provider_setup_active: (false).into(),
                add_provider_open: (false).into(),
                session_explicitly_locked: (true).into()
            }
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            crate::ShouldShowLoginVaultPickerRequest {
                authenticated: (false).into(),
                local_vault_count: 2.into(),
                vault_selected: (true).into(),
                provider_setup_active: (false).into(),
                add_provider_open: (false).into(),
                session_explicitly_locked: (true).into()
            }
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            crate::ShouldShowLoginVaultPickerRequest {
                authenticated: (false).into(),
                local_vault_count: 2.into(),
                vault_selected: (false).into(),
                provider_setup_active: (true).into(),
                add_provider_open: (false).into(),
                session_explicitly_locked: (true).into()
            }
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            crate::ShouldShowLoginVaultPickerRequest {
                authenticated: (false).into(),
                local_vault_count: 2.into(),
                vault_selected: (false).into(),
                provider_setup_active: (false).into(),
                add_provider_open: (true).into(),
                session_explicitly_locked: (true).into()
            }
        ));
        assert!(!VaultClientPolicy::should_show_login_vault_picker(
            crate::ShouldShowLoginVaultPickerRequest {
                authenticated: (false).into(),
                local_vault_count: 2.into(),
                vault_selected: (false).into(),
                provider_setup_active: (false).into(),
                add_provider_open: (false).into(),
                session_explicitly_locked: (false).into()
            }
        ));
    }

    #[test]
    fn persisted_device_protection_status_is_parsed_once_in_core() {
        assert_eq!(
            DeviceProtectionStatus::from_persisted("passkey"),
            Ok(DeviceProtectionStatus::Passkey)
        );
        assert_eq!(
            DeviceProtectionStatus::from_persisted("pin"),
            Ok(DeviceProtectionStatus::Pin)
        );
        assert_eq!(
            DeviceProtectionStatus::from_persisted("future"),
            Err(InvalidDeviceProtectionStatus)
        );
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

mod login_unlock;
pub use login_unlock::*;

mod states;
pub use states::*;
mod requests;
pub use requests::*;
