use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Portable vault readiness facts relevant to extension consent.
/// Browser reactivity remains responsible for producing the current fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionConsentVaultReadiness {
    Locked,
    Verifying,
    Saving,
    Ready,
}

/// The portable approval attempt stage. A failed attempt remains retryable once
/// the vault is ready; the browser owns the displayed explanation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionConsentPhase {
    AwaitingApproval,
    Approving,
    Approved,
    Failed { failure: ExtensionConsentFailure },
}

/// Stable failure stages for portable consent progression. Concrete browser
/// transport failures and localized presentation remain outside this type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionConsentFailure {
    Preparation,
    Delivery,
    Completion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionConsentApprovalAvailability {
    Available,
    VaultLocked,
    VaultBusy,
    ApprovalInProgress,
    AlreadyApproved,
    RetryAvailable {
        previous_failure: ExtensionConsentFailure,
    },
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
            (ExtensionConsentPhase::Approving, _) => {
                ExtensionConsentApprovalAvailability::ApprovalInProgress
            }
            (ExtensionConsentPhase::Approved, _) => {
                ExtensionConsentApprovalAvailability::AlreadyApproved
            }
            (
                ExtensionConsentPhase::AwaitingApproval | ExtensionConsentPhase::Failed { .. },
                ExtensionConsentVaultReadiness::Locked,
            ) => ExtensionConsentApprovalAvailability::VaultLocked,
            (
                ExtensionConsentPhase::AwaitingApproval | ExtensionConsentPhase::Failed { .. },
                ExtensionConsentVaultReadiness::Verifying | ExtensionConsentVaultReadiness::Saving,
            ) => ExtensionConsentApprovalAvailability::VaultBusy,
            (ExtensionConsentPhase::AwaitingApproval, ExtensionConsentVaultReadiness::Ready) => {
                ExtensionConsentApprovalAvailability::Available
            }
            (ExtensionConsentPhase::Failed { failure }, ExtensionConsentVaultReadiness::Ready) => {
                ExtensionConsentApprovalAvailability::RetryAvailable {
                    previous_failure: failure,
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionConsentEvent {
    ApprovalStarted,
    ApprovalFailed { failure: ExtensionConsentFailure },
    ApprovalCompleted,
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
                ExtensionConsentPhase::AwaitingApproval | ExtensionConsentPhase::Failed { .. },
                ExtensionConsentEvent::ApprovalStarted,
            ) => ExtensionConsentPhase::Approving,
            (
                ExtensionConsentPhase::Approving,
                ExtensionConsentEvent::ApprovalFailed { failure },
            ) => ExtensionConsentPhase::Failed { failure },
            (ExtensionConsentPhase::Approving, ExtensionConsentEvent::ApprovalCompleted) => {
                ExtensionConsentPhase::Approved
            }
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
                        ExtensionConsentPhase::AwaitingApproval,
                    ),
                    ExtensionConsentApprovalAvailability::Available,
                ),
                (
                    Self::observation(
                        ExtensionConsentVaultReadiness::Locked,
                        ExtensionConsentPhase::AwaitingApproval,
                    ),
                    ExtensionConsentApprovalAvailability::VaultLocked,
                ),
                (
                    Self::observation(
                        ExtensionConsentVaultReadiness::Verifying,
                        ExtensionConsentPhase::AwaitingApproval,
                    ),
                    ExtensionConsentApprovalAvailability::VaultBusy,
                ),
                (
                    Self::observation(
                        ExtensionConsentVaultReadiness::Saving,
                        ExtensionConsentPhase::AwaitingApproval,
                    ),
                    ExtensionConsentApprovalAvailability::VaultBusy,
                ),
                (
                    Self::observation(
                        ExtensionConsentVaultReadiness::Ready,
                        ExtensionConsentPhase::Approving,
                    ),
                    ExtensionConsentApprovalAvailability::ApprovalInProgress,
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
                        ExtensionConsentPhase::Failed {
                            failure: ExtensionConsentFailure::Delivery,
                        },
                    ),
                    ExtensionConsentApprovalAvailability::RetryAvailable {
                        previous_failure: ExtensionConsentFailure::Delivery,
                    },
                ),
            ];

            for (observation, expected) in cases {
                assert_eq!(observation.approval_availability(), expected);
            }
        }

        fn assert_legal_transitions() {
            let approving = ExtensionConsentTransitionRequest {
                phase: ExtensionConsentPhase::AwaitingApproval,
                event: ExtensionConsentEvent::ApprovalStarted,
            }
            .transition();
            assert_eq!(
                approving,
                ExtensionConsentTransitionOutcome::Transitioned {
                    phase: ExtensionConsentPhase::Approving,
                }
            );

            let failed = ExtensionConsentTransitionRequest {
                phase: ExtensionConsentPhase::Approving,
                event: ExtensionConsentEvent::ApprovalFailed {
                    failure: ExtensionConsentFailure::Completion,
                },
            }
            .transition();
            assert_eq!(
                failed,
                ExtensionConsentTransitionOutcome::Transitioned {
                    phase: ExtensionConsentPhase::Failed {
                        failure: ExtensionConsentFailure::Completion,
                    },
                }
            );

            let retrying = ExtensionConsentTransitionRequest {
                phase: ExtensionConsentPhase::Failed {
                    failure: ExtensionConsentFailure::Completion,
                },
                event: ExtensionConsentEvent::ApprovalStarted,
            }
            .transition();
            assert_eq!(
                retrying,
                ExtensionConsentTransitionOutcome::Transitioned {
                    phase: ExtensionConsentPhase::Approving,
                }
            );

            let approved = ExtensionConsentTransitionRequest {
                phase: ExtensionConsentPhase::Approving,
                event: ExtensionConsentEvent::ApprovalCompleted,
            }
            .transition();
            assert_eq!(
                approved,
                ExtensionConsentTransitionOutcome::Transitioned {
                    phase: ExtensionConsentPhase::Approved,
                }
            );
        }

        fn assert_illegal_transitions_are_rejected() {
            let cases = [
                ExtensionConsentTransitionRequest {
                    phase: ExtensionConsentPhase::AwaitingApproval,
                    event: ExtensionConsentEvent::ApprovalCompleted,
                },
                ExtensionConsentTransitionRequest {
                    phase: ExtensionConsentPhase::Approved,
                    event: ExtensionConsentEvent::ApprovalStarted,
                },
                ExtensionConsentTransitionRequest {
                    phase: ExtensionConsentPhase::Failed {
                        failure: ExtensionConsentFailure::Preparation,
                    },
                    event: ExtensionConsentEvent::ApprovalFailed {
                        failure: ExtensionConsentFailure::Delivery,
                    },
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
