use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Portable vault readiness facts relevant to extension consent.
/// Browser reactivity remains responsible for producing the current fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionConsentVaultReadiness {
    ManagerUnavailable,
    Locked,
    Verifying,
    Saving,
    Ready,
}

/// Durable authorization state. Browser delivery, export, refresh, and
/// presentation status are deliberately orthogonal to this phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionConsentPhase {
    AwaitingAuthorization,
    Authorizing,
    Approved,
    AuthorizationFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionConsentApprovalAvailability {
    Available,
    ManagerUnavailable,
    VaultLocked,
    VaultBusy,
    AuthorizationInProgress,
    AlreadyApproved,
    RetryAvailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ExtensionConsentObservation {
    pub vault: ExtensionConsentVaultReadiness,
    pub phase: ExtensionConsentPhase,
}

impl ExtensionConsentObservation {
    #[must_use]
    pub fn approval_availability(self) -> ExtensionConsentApprovalAvailability {
        match (self.phase, self.vault) {
            (ExtensionConsentPhase::Authorizing, _) => {
                ExtensionConsentApprovalAvailability::AuthorizationInProgress
            }
            (ExtensionConsentPhase::Approved, _) => {
                ExtensionConsentApprovalAvailability::AlreadyApproved
            }
            (
                ExtensionConsentPhase::AwaitingAuthorization
                | ExtensionConsentPhase::AuthorizationFailed,
                ExtensionConsentVaultReadiness::ManagerUnavailable,
            ) => ExtensionConsentApprovalAvailability::ManagerUnavailable,
            (
                ExtensionConsentPhase::AwaitingAuthorization
                | ExtensionConsentPhase::AuthorizationFailed,
                ExtensionConsentVaultReadiness::Locked,
            ) => ExtensionConsentApprovalAvailability::VaultLocked,
            (
                ExtensionConsentPhase::AwaitingAuthorization
                | ExtensionConsentPhase::AuthorizationFailed,
                ExtensionConsentVaultReadiness::Verifying | ExtensionConsentVaultReadiness::Saving,
            ) => ExtensionConsentApprovalAvailability::VaultBusy,
            (
                ExtensionConsentPhase::AwaitingAuthorization,
                ExtensionConsentVaultReadiness::Ready,
            ) => ExtensionConsentApprovalAvailability::Available,
            (ExtensionConsentPhase::AuthorizationFailed, ExtensionConsentVaultReadiness::Ready) => {
                ExtensionConsentApprovalAvailability::RetryAvailable
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionConsentEvent {
    AuthorizationStarted,
    AuthorizationFailed,
    AuthorizationSucceeded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ExtensionConsentTransitionRequest {
    pub phase: ExtensionConsentPhase,
    pub event: ExtensionConsentEvent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionConsentTransitionFailure {
    InvalidTransition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionConsentTransitionOutcome {
    Transitioned {
        phase: ExtensionConsentPhase,
    },
    Rejected {
        failure: ExtensionConsentTransitionFailure,
    },
}

impl ExtensionConsentTransitionRequest {
    #[must_use]
    pub fn transition(self) -> ExtensionConsentTransitionOutcome {
        let phase = match (self.phase, self.event) {
            (
                ExtensionConsentPhase::AwaitingAuthorization
                | ExtensionConsentPhase::AuthorizationFailed,
                ExtensionConsentEvent::AuthorizationStarted,
            ) => ExtensionConsentPhase::Authorizing,
            (ExtensionConsentPhase::Authorizing, ExtensionConsentEvent::AuthorizationFailed) => {
                ExtensionConsentPhase::AuthorizationFailed
            }
            (
                ExtensionConsentPhase::Authorizing | ExtensionConsentPhase::Approved,
                ExtensionConsentEvent::AuthorizationSucceeded,
            ) => ExtensionConsentPhase::Approved,
            _ => {
                return ExtensionConsentTransitionOutcome::Rejected {
                    failure: ExtensionConsentTransitionFailure::InvalidTransition,
                };
            }
        };
        ExtensionConsentTransitionOutcome::Transitioned { phase }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct ConsentScenario;

    impl ConsentScenario {
        fn observation(
            vault: ExtensionConsentVaultReadiness,
            phase: ExtensionConsentPhase,
        ) -> ExtensionConsentObservation {
            ExtensionConsentObservation { vault, phase }
        }

        fn assert_approval_availability() {
            let cases = [
                (
                    Self::observation(
                        ExtensionConsentVaultReadiness::Ready,
                        ExtensionConsentPhase::AwaitingAuthorization,
                    ),
                    ExtensionConsentApprovalAvailability::Available,
                ),
                (
                    Self::observation(
                        ExtensionConsentVaultReadiness::ManagerUnavailable,
                        ExtensionConsentPhase::AwaitingAuthorization,
                    ),
                    ExtensionConsentApprovalAvailability::ManagerUnavailable,
                ),
                (
                    Self::observation(
                        ExtensionConsentVaultReadiness::Locked,
                        ExtensionConsentPhase::AwaitingAuthorization,
                    ),
                    ExtensionConsentApprovalAvailability::VaultLocked,
                ),
                (
                    Self::observation(
                        ExtensionConsentVaultReadiness::Verifying,
                        ExtensionConsentPhase::AwaitingAuthorization,
                    ),
                    ExtensionConsentApprovalAvailability::VaultBusy,
                ),
                (
                    Self::observation(
                        ExtensionConsentVaultReadiness::Saving,
                        ExtensionConsentPhase::AwaitingAuthorization,
                    ),
                    ExtensionConsentApprovalAvailability::VaultBusy,
                ),
                (
                    Self::observation(
                        ExtensionConsentVaultReadiness::Ready,
                        ExtensionConsentPhase::Authorizing,
                    ),
                    ExtensionConsentApprovalAvailability::AuthorizationInProgress,
                ),
                (
                    Self::observation(
                        ExtensionConsentVaultReadiness::Locked,
                        ExtensionConsentPhase::Approved,
                    ),
                    ExtensionConsentApprovalAvailability::AlreadyApproved,
                ),
                (
                    Self::observation(
                        ExtensionConsentVaultReadiness::Ready,
                        ExtensionConsentPhase::AuthorizationFailed,
                    ),
                    ExtensionConsentApprovalAvailability::RetryAvailable,
                ),
            ];

            for (observation, expected) in cases {
                assert_eq!(observation.approval_availability(), expected);
            }
        }

        fn assert_legal_transitions() {
            let approving = ExtensionConsentTransitionRequest {
                phase: ExtensionConsentPhase::AwaitingAuthorization,
                event: ExtensionConsentEvent::AuthorizationStarted,
            }
            .transition();
            assert_eq!(
                approving,
                ExtensionConsentTransitionOutcome::Transitioned {
                    phase: ExtensionConsentPhase::Authorizing,
                }
            );

            let failed = ExtensionConsentTransitionRequest {
                phase: ExtensionConsentPhase::Authorizing,
                event: ExtensionConsentEvent::AuthorizationFailed,
            }
            .transition();
            assert_eq!(
                failed,
                ExtensionConsentTransitionOutcome::Transitioned {
                    phase: ExtensionConsentPhase::AuthorizationFailed,
                }
            );

            let retrying = ExtensionConsentTransitionRequest {
                phase: ExtensionConsentPhase::AuthorizationFailed,
                event: ExtensionConsentEvent::AuthorizationStarted,
            }
            .transition();
            assert_eq!(
                retrying,
                ExtensionConsentTransitionOutcome::Transitioned {
                    phase: ExtensionConsentPhase::Authorizing,
                }
            );

            let approved = ExtensionConsentTransitionRequest {
                phase: ExtensionConsentPhase::Authorizing,
                event: ExtensionConsentEvent::AuthorizationSucceeded,
            }
            .transition();
            assert_eq!(
                approved,
                ExtensionConsentTransitionOutcome::Transitioned {
                    phase: ExtensionConsentPhase::Approved,
                }
            );

            let remains_approved = ExtensionConsentTransitionRequest {
                phase: ExtensionConsentPhase::Approved,
                event: ExtensionConsentEvent::AuthorizationSucceeded,
            }
            .transition();
            assert_eq!(
                remains_approved,
                ExtensionConsentTransitionOutcome::Transitioned {
                    phase: ExtensionConsentPhase::Approved,
                }
            );
        }

        fn assert_illegal_transitions_are_rejected() {
            let cases = [
                ExtensionConsentTransitionRequest {
                    phase: ExtensionConsentPhase::AwaitingAuthorization,
                    event: ExtensionConsentEvent::AuthorizationSucceeded,
                },
                ExtensionConsentTransitionRequest {
                    phase: ExtensionConsentPhase::Approved,
                    event: ExtensionConsentEvent::AuthorizationStarted,
                },
                ExtensionConsentTransitionRequest {
                    phase: ExtensionConsentPhase::Approved,
                    event: ExtensionConsentEvent::AuthorizationFailed,
                },
                ExtensionConsentTransitionRequest {
                    phase: ExtensionConsentPhase::AuthorizationFailed,
                    event: ExtensionConsentEvent::AuthorizationFailed,
                },
            ];

            for request in cases {
                assert_eq!(
                    request.transition(),
                    ExtensionConsentTransitionOutcome::Rejected {
                        failure: ExtensionConsentTransitionFailure::InvalidTransition,
                    }
                );
            }
        }
    }

    #[test]
    fn approval_availability_is_derived_from_portable_vault_and_consent_state() {
        ConsentScenario::assert_approval_availability();
    }

    #[test]
    fn consent_phase_accepts_only_legal_transitions() {
        ConsentScenario::assert_legal_transitions();
        ConsentScenario::assert_illegal_transitions_are_rejected();
    }
}
