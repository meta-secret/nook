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
    pub const fn remote_recovery_prompt_visible(state: RemoteVaultRecoveryState) -> bool {
        state.prompt_visible()
    }

    #[must_use]
    pub const fn remote_recovery_prompt_has_cache(state: RemoteVaultRecoveryState) -> bool {
        state.prompt_has_cache()
    }

    #[must_use]
    pub const fn remote_recovery_connect_confirmed(state: RemoteVaultRecoveryState) -> bool {
        state.connect_confirmed()
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
    pub const fn vault_connect_probe_decision(
        access_status: VaultAccessStatus,
        authenticated: bool,
        sync_provider_count: usize,
    ) -> VaultConnectProbeDecision {
        if !authenticated
            && sync_provider_count > 0
            && matches!(
                access_status,
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
        password_entry_count: usize,
    ) -> VaultConnectGateDecision {
        match (access_status, password_entry_count > 0) {
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
        requested_store_id: &str,
        active_store_id: ActiveVaultStore<'_>,
        verifying: bool,
    ) -> VaultSwitchDecision {
        let requested_store_id = requested_store_id.trim();
        if verifying
            || requested_store_id.is_empty()
            || matches!(
                active_store_id,
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
        assert!(VaultClientPolicy::existing_vault_identity_recovery_required(true, true, false));
        assert!(!VaultClientPolicy::existing_vault_identity_recovery_required(false, true, false));
        assert!(!VaultClientPolicy::existing_vault_identity_recovery_required(true, false, false));
        assert!(!VaultClientPolicy::existing_vault_identity_recovery_required(true, true, true));
    }

    #[test]
    fn remote_missing_policy_distinguishes_recovery_creation_and_open() {
        assert_eq!(
            VaultClientPolicy::remote_vault_assess_decision(
                VaultAccessStatus::RemoteMissingLocalCache,
                false,
                false,
            ),
            RemoteVaultAssessDecision::PromptRecoveryFromCache
        );
        assert_eq!(
            VaultClientPolicy::remote_vault_assess_decision(
                VaultAccessStatus::RemoteMissing,
                true,
                false,
            ),
            RemoteVaultAssessDecision::RejectMissingExistingVault
        );
        assert_eq!(
            VaultClientPolicy::remote_vault_assess_decision(
                VaultAccessStatus::RemoteMissing,
                false,
                true,
            ),
            RemoteVaultAssessDecision::Continue
        );
        assert_eq!(
            VaultClientPolicy::remote_vault_assess_decision(
                VaultAccessStatus::RemoteMissing,
                false,
                false,
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
                VaultClientPolicy::vault_connect_probe_decision(status, false, 1),
                VaultConnectProbeDecision::ReassessFirstSyncProvider
            );
            assert_eq!(
                VaultClientPolicy::vault_connect_probe_decision(status, true, 1),
                VaultConnectProbeDecision::UseConfiguredStorage
            );
            assert_eq!(
                VaultClientPolicy::vault_connect_probe_decision(status, false, 0),
                VaultConnectProbeDecision::UseConfiguredStorage
            );
        }
        assert_eq!(
            VaultClientPolicy::vault_connect_probe_decision(VaultAccessStatus::Ready, false, 1,),
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
                VaultClientPolicy::vault_connect_gate_decision(status, 1),
                VaultConnectGateDecision::PromptForPassword
            );
        }
        assert_eq!(
            VaultClientPolicy::vault_connect_gate_decision(VaultAccessStatus::NeedsEnrollment, 0,),
            VaultConnectGateDecision::RequestEnrollment
        );
        assert_eq!(
            VaultClientPolicy::vault_connect_gate_decision(VaultAccessStatus::JoinPending, 0),
            VaultConnectGateDecision::AwaitJoinApproval
        );
        assert_eq!(
            VaultClientPolicy::vault_connect_gate_decision(VaultAccessStatus::Ready, 1),
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
    fn remote_recovery_connect_requires_an_explicit_confirmation_state() {
        for state in [
            RemoteVaultRecoveryState::None,
            RemoteVaultRecoveryState::PromptWithCache,
            RemoteVaultRecoveryState::PromptMissingOnly,
        ] {
            assert!(!VaultClientPolicy::remote_recovery_connect_confirmed(state));
        }
        for state in [
            RemoteVaultRecoveryState::ConnectFromCache,
            RemoteVaultRecoveryState::ConnectFresh,
        ] {
            assert!(VaultClientPolicy::remote_recovery_connect_confirmed(state));
        }
    }

    #[test]
    fn vault_switch_target_is_trimmed_and_rejects_noops() {
        assert_eq!(
            VaultClientPolicy::vault_switch_target(
                " store-b ",
                ActiveVaultStore::Selected("store-a"),
                false,
            ),
            VaultSwitchDecision::SwitchTo("store-b".to_owned())
        );
        assert_eq!(
            VaultClientPolicy::vault_switch_target(
                "store-a",
                ActiveVaultStore::Selected(" store-a "),
                false,
            ),
            VaultSwitchDecision::NoChange
        );
        assert_eq!(
            VaultClientPolicy::vault_switch_target(
                "store-b",
                ActiveVaultStore::Selected("store-a"),
                true,
            ),
            VaultSwitchDecision::NoChange
        );
    }
}
