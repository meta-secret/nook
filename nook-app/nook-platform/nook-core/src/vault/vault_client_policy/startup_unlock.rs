//! Companion-first startup selection; authorization remains with the handoff.

use crate::{LocalVaultPresence, VaultApplication, VaultClientPolicy};
use nook_companion_core::CompanionIdentityStatus;
use thiserror::Error;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Clone, Copy, Debug)]
pub struct VaultStartupUnlockRequest {
    pub application: VaultApplication,
    pub local_vault_present: LocalVaultPresence,
    pub companion_provider_present: CompanionProviderPresence,
}

#[derive(Clone, Copy, Debug)]
pub struct VaultExistingImportUnlockRequest {
    pub application: VaultApplication,
    pub companion_provider_present: CompanionProviderPresence,
}

/// Physical installed-provider capability observed before any discovery request.
/// Transport, decoding, and admission failures never mean absence.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(try_from = "u32")]
pub enum CompanionProviderPresence {
    Absent,
    Present,
}

#[derive(Debug, Error)]
#[error("invalid companion provider presence")]
pub struct InvalidCompanionProviderPresence;

impl TryFrom<u32> for CompanionProviderPresence {
    type Error = InvalidCompanionProviderPresence;

    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
            value if value == Self::Absent as u32 => Ok(Self::Absent),
            value if value == Self::Present as u32 => Ok(Self::Present),
            _ => Err(InvalidCompanionProviderPresence),
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultStartupUnlockDecision {
    DiscoverCompanion,
    WebsiteDevice,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultCompanionUnlockDecision {
    CompanionDevice,
    WebsiteDevice,
}

impl VaultClientPolicy {
    #[must_use]
    pub const fn startup_unlock_decision(
        request: VaultStartupUnlockRequest,
    ) -> VaultStartupUnlockDecision {
        if matches!(
            request.companion_provider_present,
            CompanionProviderPresence::Absent
        ) {
            return VaultStartupUnlockDecision::WebsiteDevice;
        }
        match request.local_vault_present {
            LocalVaultPresence::Absent => VaultStartupUnlockDecision::WebsiteDevice,
            LocalVaultPresence::Present => match request.application {
                VaultApplication::Simple | VaultApplication::UnifiedDevelopment => {
                    VaultStartupUnlockDecision::DiscoverCompanion
                }
                VaultApplication::Sentinel | VaultApplication::Extension => {
                    VaultStartupUnlockDecision::WebsiteDevice
                }
            },
        }
    }
}

/// Existing staged imports discover an installed companion even without a local vault.
impl VaultClientPolicy {
    #[must_use]
    pub const fn existing_vault_import_unlock_decision(
        request: VaultExistingImportUnlockRequest,
    ) -> VaultStartupUnlockDecision {
        match request.companion_provider_present {
            CompanionProviderPresence::Absent => VaultStartupUnlockDecision::WebsiteDevice,
            CompanionProviderPresence::Present => match request.application {
                VaultApplication::Simple | VaultApplication::UnifiedDevelopment => {
                    VaultStartupUnlockDecision::DiscoverCompanion
                }
                VaultApplication::Sentinel | VaultApplication::Extension => {
                    VaultStartupUnlockDecision::WebsiteDevice
                }
            },
        }
    }
}

/// Classifies an admitted discovery response, never a synthesized transport failure.
/// This selects the existing unlock path and grants no identity or vault access.
impl VaultClientPolicy {
    #[must_use]
    pub fn companion_unlock_decision(
        status: &CompanionIdentityStatus,
    ) -> VaultCompanionUnlockDecision {
        match status {
            CompanionIdentityStatus::Locked { .. } | CompanionIdentityStatus::Unlocked { .. } => {
                VaultCompanionUnlockDecision::CompanionDevice
            }
            CompanionIdentityStatus::Unavailable { .. }
            | CompanionIdentityStatus::DifferentVault { .. } => {
                VaultCompanionUnlockDecision::WebsiteDevice
            }
        }
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use nook_companion_core::{
        CompanionInstallationAppKey, CompanionUnlockedAppKey, ExtensionConnectScope,
    };

    #[test]
    fn local_simple_vault_discovers_companion_before_website_unlock() {
        for application in [
            VaultApplication::Simple,
            VaultApplication::UnifiedDevelopment,
        ] {
            assert_eq!(
                VaultClientPolicy::startup_unlock_decision(VaultStartupUnlockRequest {
                    application,
                    local_vault_present: LocalVaultPresence::Present,
                    companion_provider_present: CompanionProviderPresence::Present,
                }),
                VaultStartupUnlockDecision::DiscoverCompanion
            );
        }
    }

    #[test]
    fn isolated_and_empty_applications_keep_their_existing_website_path() {
        for application in [VaultApplication::Sentinel, VaultApplication::Extension] {
            assert_eq!(
                VaultClientPolicy::startup_unlock_decision(VaultStartupUnlockRequest {
                    application,
                    local_vault_present: LocalVaultPresence::Present,
                    companion_provider_present: CompanionProviderPresence::Present,
                }),
                VaultStartupUnlockDecision::WebsiteDevice
            );
        }
        for application in [
            VaultApplication::Simple,
            VaultApplication::UnifiedDevelopment,
            VaultApplication::Sentinel,
            VaultApplication::Extension,
        ] {
            assert_eq!(
                VaultClientPolicy::startup_unlock_decision(VaultStartupUnlockRequest {
                    application,
                    local_vault_present: LocalVaultPresence::Absent,
                    companion_provider_present: CompanionProviderPresence::Present,
                }),
                VaultStartupUnlockDecision::WebsiteDevice
            );
        }
    }

    #[test]
    fn absent_provider_preserves_local_browser_startup() {
        for application in [
            VaultApplication::Simple,
            VaultApplication::UnifiedDevelopment,
        ] {
            assert_eq!(
                VaultClientPolicy::startup_unlock_decision(VaultStartupUnlockRequest {
                    application,
                    local_vault_present: LocalVaultPresence::Present,
                    companion_provider_present: CompanionProviderPresence::Absent,
                }),
                VaultStartupUnlockDecision::WebsiteDevice
            );
        }
    }

    #[test]
    fn existing_import_discovers_companion_without_fabricating_local_presence() {
        for application in [
            VaultApplication::Simple,
            VaultApplication::UnifiedDevelopment,
        ] {
            assert_eq!(
                VaultClientPolicy::existing_vault_import_unlock_decision(
                    VaultExistingImportUnlockRequest {
                        application,
                        companion_provider_present: CompanionProviderPresence::Present
                    }
                ),
                VaultStartupUnlockDecision::DiscoverCompanion
            );
            assert_eq!(
                VaultClientPolicy::existing_vault_import_unlock_decision(
                    VaultExistingImportUnlockRequest {
                        application,
                        companion_provider_present: CompanionProviderPresence::Absent
                    }
                ),
                VaultStartupUnlockDecision::WebsiteDevice
            );
        }
        for application in [VaultApplication::Sentinel, VaultApplication::Extension] {
            assert_eq!(
                VaultClientPolicy::existing_vault_import_unlock_decision(
                    VaultExistingImportUnlockRequest {
                        application,
                        companion_provider_present: CompanionProviderPresence::Present
                    }
                ),
                VaultStartupUnlockDecision::WebsiteDevice
            );
        }
    }

    #[test]
    fn admitted_locked_and_unlocked_companions_keep_website_unlock_suppressed() {
        let locked = CompanionIdentityStatus::Locked {
            request_id: "startup-discovery".to_owned(),
            vault_store_id: "store_startup".to_owned(),
        };
        assert_eq!(
            VaultClientPolicy::companion_unlock_decision(&locked),
            VaultCompanionUnlockDecision::CompanionDevice
        );
        let unlocked = CompanionIdentityStatus::Unlocked {
            request_id: "startup-discovery".to_owned(),
            vault_store_id: "store_startup".to_owned(),
            app_key: CompanionUnlockedAppKey {
                extension_runtime_id: "startup-extension".to_owned(),
                app_key: CompanionInstallationAppKey {
                    app_id: "startup-app".to_owned(),
                    encryption_public_key: "startup-public-encryption-key".to_owned(),
                    signing_public_key: "startup-public-signing-key".to_owned(),
                    installation_label: "Browser companion".to_owned(),
                },
                nonce: "startup-nonce".to_owned(),
                scopes: vec![ExtensionConnectScope::VaultAccess],
            },
        };
        assert_eq!(
            VaultClientPolicy::companion_unlock_decision(&unlocked),
            VaultCompanionUnlockDecision::CompanionDevice
        );
    }

    #[test]
    fn admitted_absent_or_other_vault_companion_permits_existing_website_path() {
        let unavailable = CompanionIdentityStatus::Unavailable {
            request_id: "startup-discovery".to_owned(),
            vault_store_id: "store_startup".to_owned(),
        };
        assert_eq!(
            VaultClientPolicy::companion_unlock_decision(&unavailable),
            VaultCompanionUnlockDecision::WebsiteDevice
        );
        let different = CompanionIdentityStatus::DifferentVault {
            request_id: "startup-discovery".to_owned(),
            vault_store_id: "store_startup".to_owned(),
            connected_vault_store_id: "store_other".to_owned(),
            connected_vault_name: "Other vault".to_owned(),
        };
        assert_eq!(
            VaultClientPolicy::companion_unlock_decision(&different),
            VaultCompanionUnlockDecision::WebsiteDevice
        );
    }

    #[test]
    fn website_selection_preserves_explicit_session_lock() {
        assert_eq!(
            VaultClientPolicy::startup_unlock_decision(VaultStartupUnlockRequest {
                application: VaultApplication::Simple,
                local_vault_present: LocalVaultPresence::Present,
                companion_provider_present: CompanionProviderPresence::Absent,
            }),
            VaultStartupUnlockDecision::WebsiteDevice
        );
        let unavailable = CompanionIdentityStatus::Unavailable {
            request_id: "startup-discovery".to_owned(),
            vault_store_id: "store_startup".to_owned(),
        };
        assert_eq!(
            VaultClientPolicy::companion_unlock_decision(&unavailable),
            VaultCompanionUnlockDecision::WebsiteDevice
        );
        assert!(!VaultClientPolicy::should_auto_unlock(
            crate::ShouldAutoUnlockRequest {
                session_explicitly_locked: crate::VaultSessionLockIntent::ExplicitlyLocked,
                local_vault_present: LocalVaultPresence::Present,
                password_entry_count: crate::VaultPasswordEntryCount::from(0),
                sync_provider_count: crate::VaultSyncProviderCount::from(0),
                provider_setup_active: crate::ProviderSetupState::Inactive,
                add_provider_open: crate::AddProviderPromptState::Closed,
            }
        ));
    }
}
