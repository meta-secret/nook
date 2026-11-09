use wasm_bindgen::prelude::wasm_bindgen;

use super::VaultClientPolicy;
use crate::VaultAccessStatus;

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
pub enum VaultConnectProbeDecision {
    UseConfiguredStorage,
    ReassessFirstSyncProvider,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultConnectGateDecision {
    Connect,
    RequestEnrollment,
    AwaitJoinApproval,
}

impl VaultClientPolicy {
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
    ) -> VaultConnectGateDecision {
        match access_status {
            VaultAccessStatus::NeedsEnrollment => VaultConnectGateDecision::RequestEnrollment,
            VaultAccessStatus::JoinPending => VaultConnectGateDecision::AwaitJoinApproval,
            VaultAccessStatus::NewVault
            | VaultAccessStatus::Ready
            | VaultAccessStatus::RemoteMissing => VaultConnectGateDecision::Connect,
        }
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
            VaultSwitchDecision::NoChange
        } else {
            VaultSwitchDecision::SwitchTo(requested_store_id.to_owned())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn connect_gate_requests_enrollment_or_waits_for_approval() {
        assert_eq!(
            VaultClientPolicy::vault_connect_gate_decision(VaultAccessStatus::NeedsEnrollment),
            VaultConnectGateDecision::RequestEnrollment
        );
        assert_eq!(
            VaultClientPolicy::vault_connect_gate_decision(VaultAccessStatus::JoinPending),
            VaultConnectGateDecision::AwaitJoinApproval
        );
        assert_eq!(
            VaultClientPolicy::vault_connect_gate_decision(VaultAccessStatus::Ready),
            VaultConnectGateDecision::Connect
        );
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
