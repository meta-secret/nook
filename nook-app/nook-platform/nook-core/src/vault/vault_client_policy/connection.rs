use wasm_bindgen::prelude::wasm_bindgen;

use super::VaultClientPolicy;
use crate::VaultAccessStatus;

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

    #[must_use]
    pub const fn connect_confirmed(self) -> bool {
        matches!(self, Self::ConnectFromCache | Self::ConnectFresh)
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActiveVaultStore<'a> {
    Unselected,
    Selected(&'a str),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VaultSwitchDecision {
    NoChange,
    SwitchTo(String),
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
pub enum VaultConnectProbeDecision {
    UseConfiguredStorage,
    ReassessFirstSyncProvider,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultConnectGateDecision {
    Connect,
    PromptForPassword,
    RequestEnrollment,
    AwaitJoinApproval,
}

impl VaultClientPolicy {
    #[must_use]
    pub const fn existing_vault_identity_recovery_required(
        request: crate::ExistingVaultIdentityRecoveryRequiredRequest,
    ) -> bool {
        matches!(
            request.existing_vault_required,
            crate::VaultExistenceRequirement::ExistingRequired
        ) && matches!(
            request.provider_setup_active,
            crate::ProviderSetupState::Active
        ) && !matches!(
            request.device_protection_ready,
            crate::DeviceProtectionReadiness::Ready
        )
    }

    #[must_use]
    pub const fn remote_vault_assess_decision(
        request: crate::RemoteVaultAssessDecisionRequest,
    ) -> RemoteVaultAssessDecision {
        match request.access_status {
            VaultAccessStatus::RemoteMissingLocalCache => {
                RemoteVaultAssessDecision::PromptRecoveryFromCache
            }
            VaultAccessStatus::RemoteMissing
                if matches!(
                    request.existing_vault_required,
                    crate::VaultExistenceRequirement::ExistingRequired
                ) =>
            {
                RemoteVaultAssessDecision::RejectMissingExistingVault
            }
            VaultAccessStatus::RemoteMissing
                if matches!(
                    request.provider_setup_active,
                    crate::ProviderSetupState::Active
                ) =>
            {
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
    pub const fn vault_connect_probe_decision(
        request: crate::VaultConnectProbeDecisionRequest,
    ) -> VaultConnectProbeDecision {
        if !matches!(
            request.authenticated,
            crate::VaultAuthenticationState::Authenticated
        ) && request.sync_provider_count.is_nonzero()
            && matches!(
                request.access_status,
                VaultAccessStatus::NeedsEnrollment | VaultAccessStatus::JoinPending
            )
        {
            VaultConnectProbeDecision::ReassessFirstSyncProvider
        } else {
            VaultConnectProbeDecision::UseConfiguredStorage
        }
    }

    #[must_use]
    pub const fn vault_connect_gate_decision(
        access_status: VaultAccessStatus,
        password_entry_count: crate::VaultPasswordEntryCount,
    ) -> VaultConnectGateDecision {
        match (access_status, password_entry_count.is_nonzero()) {
            (VaultAccessStatus::NeedsEnrollment | VaultAccessStatus::JoinPending, true) => {
                VaultConnectGateDecision::PromptForPassword
            }
            (VaultAccessStatus::NeedsEnrollment, false) => {
                VaultConnectGateDecision::RequestEnrollment
            }
            (VaultAccessStatus::JoinPending, false) => VaultConnectGateDecision::AwaitJoinApproval,
            _ => VaultConnectGateDecision::Connect,
        }
    }

    #[must_use]
    pub const fn vault_connect_password_lookup_required(access_status: VaultAccessStatus) -> bool {
        matches!(
            access_status,
            VaultAccessStatus::NeedsEnrollment | VaultAccessStatus::JoinPending
        )
    }

    #[must_use]
    pub fn vault_switch_target(
        request: crate::VaultSwitchTargetRequest<'_>,
    ) -> VaultSwitchDecision {
        let requested_store_id = request.requested_store_id.trim();
        if matches!(request.verifying, crate::VaultVerificationState::Verifying)
            || requested_store_id.is_empty()
            || matches!(
                request.active_store_id,
                ActiveVaultStore::Selected(active) if active.trim() == requested_store_id
            )
        {
            return VaultSwitchDecision::NoChange;
        }
        VaultSwitchDecision::SwitchTo(requested_store_id.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_vault_import_recovers_identity_before_provider_connect() {
        assert!(
            VaultClientPolicy::existing_vault_identity_recovery_required(
                crate::ExistingVaultIdentityRecoveryRequiredRequest {
                    existing_vault_required: (true).into(),
                    provider_setup_active: (true).into(),
                    device_protection_ready: (false).into()
                }
            )
        );
        assert!(
            !VaultClientPolicy::existing_vault_identity_recovery_required(
                crate::ExistingVaultIdentityRecoveryRequiredRequest {
                    existing_vault_required: (false).into(),
                    provider_setup_active: (true).into(),
                    device_protection_ready: (false).into()
                }
            )
        );
        assert!(
            !VaultClientPolicy::existing_vault_identity_recovery_required(
                crate::ExistingVaultIdentityRecoveryRequiredRequest {
                    existing_vault_required: (true).into(),
                    provider_setup_active: (false).into(),
                    device_protection_ready: (false).into()
                }
            )
        );
        assert!(
            !VaultClientPolicy::existing_vault_identity_recovery_required(
                crate::ExistingVaultIdentityRecoveryRequiredRequest {
                    existing_vault_required: (true).into(),
                    provider_setup_active: (true).into(),
                    device_protection_ready: (true).into()
                }
            )
        );
    }

    #[test]
    fn remote_missing_policy_distinguishes_recovery_creation_and_open() {
        assert_eq!(
            VaultClientPolicy::remote_vault_assess_decision(
                crate::RemoteVaultAssessDecisionRequest {
                    access_status: VaultAccessStatus::RemoteMissingLocalCache,
                    existing_vault_required: (false).into(),
                    provider_setup_active: (false).into()
                }
            ),
            RemoteVaultAssessDecision::PromptRecoveryFromCache
        );
        assert_eq!(
            VaultClientPolicy::remote_vault_assess_decision(
                crate::RemoteVaultAssessDecisionRequest {
                    access_status: VaultAccessStatus::RemoteMissing,
                    existing_vault_required: (true).into(),
                    provider_setup_active: (false).into()
                }
            ),
            RemoteVaultAssessDecision::RejectMissingExistingVault
        );
        assert_eq!(
            VaultClientPolicy::remote_vault_assess_decision(
                crate::RemoteVaultAssessDecisionRequest {
                    access_status: VaultAccessStatus::RemoteMissing,
                    existing_vault_required: (false).into(),
                    provider_setup_active: (true).into()
                }
            ),
            RemoteVaultAssessDecision::Continue
        );
        assert_eq!(
            VaultClientPolicy::remote_vault_assess_decision(
                crate::RemoteVaultAssessDecisionRequest {
                    access_status: VaultAccessStatus::RemoteMissing,
                    existing_vault_required: (false).into(),
                    provider_setup_active: (false).into()
                }
            ),
            RemoteVaultAssessDecision::PromptMissingRemote
        );
    }

    #[test]
    fn connect_probe_uses_remote_only_for_unauthenticated_enrollment_states() {
        for status in [
            VaultAccessStatus::NeedsEnrollment,
            VaultAccessStatus::JoinPending,
        ] {
            assert_eq!(
                VaultClientPolicy::vault_connect_probe_decision(
                    crate::VaultConnectProbeDecisionRequest {
                        access_status: status,
                        authenticated: (false).into(),
                        sync_provider_count: 1.into()
                    }
                ),
                VaultConnectProbeDecision::ReassessFirstSyncProvider
            );
            assert_eq!(
                VaultClientPolicy::vault_connect_probe_decision(
                    crate::VaultConnectProbeDecisionRequest {
                        access_status: status,
                        authenticated: (true).into(),
                        sync_provider_count: 1.into()
                    }
                ),
                VaultConnectProbeDecision::UseConfiguredStorage
            );
            assert_eq!(
                VaultClientPolicy::vault_connect_probe_decision(
                    crate::VaultConnectProbeDecisionRequest {
                        access_status: status,
                        authenticated: (false).into(),
                        sync_provider_count: 0.into()
                    }
                ),
                VaultConnectProbeDecision::UseConfiguredStorage
            );
        }
        assert_eq!(
            VaultClientPolicy::vault_connect_probe_decision(
                crate::VaultConnectProbeDecisionRequest {
                    access_status: VaultAccessStatus::Ready,
                    authenticated: (false).into(),
                    sync_provider_count: 1.into()
                }
            ),
            VaultConnectProbeDecision::UseConfiguredStorage
        );
    }

    #[test]
    fn connect_gate_prioritizes_password_fallback_before_enrollment() {
        for status in [
            VaultAccessStatus::NeedsEnrollment,
            VaultAccessStatus::JoinPending,
        ] {
            assert_eq!(
                VaultClientPolicy::vault_connect_gate_decision(status, 1.into()),
                VaultConnectGateDecision::PromptForPassword
            );
        }
        assert_eq!(
            VaultClientPolicy::vault_connect_gate_decision(
                VaultAccessStatus::NeedsEnrollment,
                0.into(),
            ),
            VaultConnectGateDecision::RequestEnrollment
        );
        assert_eq!(
            VaultClientPolicy::vault_connect_gate_decision(
                VaultAccessStatus::JoinPending,
                0.into(),
            ),
            VaultConnectGateDecision::AwaitJoinApproval
        );
        assert_eq!(
            VaultClientPolicy::vault_connect_gate_decision(VaultAccessStatus::Ready, 1.into()),
            VaultConnectGateDecision::Connect
        );
        assert!(VaultClientPolicy::vault_connect_password_lookup_required(
            VaultAccessStatus::NeedsEnrollment
        ));
        assert!(VaultClientPolicy::vault_connect_password_lookup_required(
            VaultAccessStatus::JoinPending
        ));
        assert!(!VaultClientPolicy::vault_connect_password_lookup_required(
            VaultAccessStatus::Ready
        ));
    }

    #[test]
    fn remote_recovery_state_exposes_only_prompt_variants_to_the_ui() {
        assert!((RemoteVaultRecoveryState::PromptWithCache).prompt_visible());
        assert!((RemoteVaultRecoveryState::PromptMissingOnly).prompt_visible());
        assert!(!(RemoteVaultRecoveryState::ConnectFromCache).prompt_visible());
        assert!((RemoteVaultRecoveryState::PromptWithCache).prompt_has_cache());
        assert!(!(RemoteVaultRecoveryState::PromptMissingOnly).prompt_has_cache());
    }

    #[test]
    fn remote_recovery_connect_requires_an_explicit_confirmation_state() {
        for state in [
            RemoteVaultRecoveryState::None,
            RemoteVaultRecoveryState::PromptWithCache,
            RemoteVaultRecoveryState::PromptMissingOnly,
        ] {
            assert!(!(state).connect_confirmed());
        }
        for state in [
            RemoteVaultRecoveryState::ConnectFromCache,
            RemoteVaultRecoveryState::ConnectFresh,
        ] {
            assert!((state).connect_confirmed());
        }
    }

    #[test]
    fn vault_switch_target_is_trimmed_and_rejects_noops() {
        assert_eq!(
            VaultClientPolicy::vault_switch_target(crate::VaultSwitchTargetRequest {
                requested_store_id: " store-b ",
                active_store_id: ActiveVaultStore::Selected("store-a"),
                verifying: (false).into()
            }),
            VaultSwitchDecision::SwitchTo("store-b".to_owned())
        );
        assert_eq!(
            VaultClientPolicy::vault_switch_target(crate::VaultSwitchTargetRequest {
                requested_store_id: "store-a",
                active_store_id: ActiveVaultStore::Selected(" store-a "),
                verifying: (false).into()
            }),
            VaultSwitchDecision::NoChange
        );
        assert_eq!(
            VaultClientPolicy::vault_switch_target(crate::VaultSwitchTargetRequest {
                requested_store_id: "store-b",
                active_store_id: ActiveVaultStore::Selected("store-a"),
                verifying: (true).into()
            }),
            VaultSwitchDecision::NoChange
        );
    }
}
