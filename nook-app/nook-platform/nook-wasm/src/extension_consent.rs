use nook_companion_core::{
    ExtensionConsentApprovalAvailability, ExtensionConsentEvent, ExtensionConsentObservation,
    ExtensionConsentPhase, ExtensionConsentTransitionOutcome, ExtensionConsentTransitionRequest,
    ExtensionConsentVaultReadiness,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NookExtensionConsentVaultReadiness {
    ManagerUnavailable,
    Locked,
    Verifying,
    Saving,
    Ready,
}

impl NookExtensionConsentVaultReadiness {
    const fn core(self) -> ExtensionConsentVaultReadiness {
        match self {
            Self::ManagerUnavailable => ExtensionConsentVaultReadiness::ManagerUnavailable,
            Self::Locked => ExtensionConsentVaultReadiness::Locked,
            Self::Verifying => ExtensionConsentVaultReadiness::Verifying,
            Self::Saving => ExtensionConsentVaultReadiness::Saving,
            Self::Ready => ExtensionConsentVaultReadiness::Ready,
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NookExtensionConsentPhaseState {
    AwaitingAuthorization,
    Authorizing,
    Approved,
    AuthorizationFailed,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NookExtensionConsentEvent {
    AuthorizationStarted,
    AuthorizationFailed,
    AuthorizationSucceeded,
}

impl NookExtensionConsentEvent {
    const fn core(self) -> ExtensionConsentEvent {
        match self {
            Self::AuthorizationStarted => ExtensionConsentEvent::AuthorizationStarted,
            Self::AuthorizationFailed => ExtensionConsentEvent::AuthorizationFailed,
            Self::AuthorizationSucceeded => ExtensionConsentEvent::AuthorizationSucceeded,
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NookExtensionConsentApprovalAvailabilityState {
    Available,
    ManagerUnavailable,
    VaultLocked,
    VaultBusy,
    AuthorizationInProgress,
    AlreadyApproved,
    RetryAvailable,
}

#[wasm_bindgen]
pub struct NookExtensionConsentApprovalAvailability(ExtensionConsentApprovalAvailability);

#[wasm_bindgen]
impl NookExtensionConsentApprovalAvailability {
    #[wasm_bindgen(getter)]
    pub fn state(&self) -> NookExtensionConsentApprovalAvailabilityState {
        match self.0 {
            ExtensionConsentApprovalAvailability::Available => {
                NookExtensionConsentApprovalAvailabilityState::Available
            }
            ExtensionConsentApprovalAvailability::ManagerUnavailable => {
                NookExtensionConsentApprovalAvailabilityState::ManagerUnavailable
            }
            ExtensionConsentApprovalAvailability::VaultLocked => {
                NookExtensionConsentApprovalAvailabilityState::VaultLocked
            }
            ExtensionConsentApprovalAvailability::VaultBusy => {
                NookExtensionConsentApprovalAvailabilityState::VaultBusy
            }
            ExtensionConsentApprovalAvailability::AuthorizationInProgress => {
                NookExtensionConsentApprovalAvailabilityState::AuthorizationInProgress
            }
            ExtensionConsentApprovalAvailability::AlreadyApproved => {
                NookExtensionConsentApprovalAvailabilityState::AlreadyApproved
            }
            ExtensionConsentApprovalAvailability::RetryAvailable => {
                NookExtensionConsentApprovalAvailabilityState::RetryAvailable
            }
        }
    }

    #[must_use]
    pub fn can_approve(&self) -> bool {
        matches!(
            self.0,
            ExtensionConsentApprovalAvailability::Available
                | ExtensionConsentApprovalAvailability::RetryAvailable
        )
    }
}

#[wasm_bindgen]
pub struct NookExtensionConsentPhase(ExtensionConsentPhase);

impl NookExtensionConsentPhase {
    const fn from_core(phase: ExtensionConsentPhase) -> Self {
        Self(phase)
    }
}

#[wasm_bindgen]
impl NookExtensionConsentPhase {
    pub fn awaiting_authorization() -> Self {
        Self(ExtensionConsentPhase::AwaitingAuthorization)
    }

    #[wasm_bindgen(getter)]
    pub fn state(&self) -> NookExtensionConsentPhaseState {
        match self.0 {
            ExtensionConsentPhase::AwaitingAuthorization => {
                NookExtensionConsentPhaseState::AwaitingAuthorization
            }
            ExtensionConsentPhase::Authorizing => NookExtensionConsentPhaseState::Authorizing,
            ExtensionConsentPhase::Approved => NookExtensionConsentPhaseState::Approved,
            ExtensionConsentPhase::AuthorizationFailed => {
                NookExtensionConsentPhaseState::AuthorizationFailed
            }
        }
    }

    pub fn approval_availability(
        &self,
        vault: NookExtensionConsentVaultReadiness,
    ) -> NookExtensionConsentApprovalAvailability {
        NookExtensionConsentApprovalAvailability(
            ExtensionConsentObservation {
                vault: vault.core(),
                phase: self.0,
            }
            .approval_availability(),
        )
    }

    pub fn transition(&self, event: NookExtensionConsentEvent) -> NookExtensionConsentTransition {
        NookExtensionConsentTransition(
            ExtensionConsentTransitionRequest {
                phase: self.0,
                event: event.core(),
            }
            .transition(),
        )
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NookExtensionConsentTransitionState {
    Transitioned,
    Rejected,
}

#[wasm_bindgen]
pub struct NookExtensionConsentTransition(ExtensionConsentTransitionOutcome);

#[wasm_bindgen]
impl NookExtensionConsentTransition {
    #[wasm_bindgen(getter)]
    pub fn state(&self) -> NookExtensionConsentTransitionState {
        match self.0 {
            ExtensionConsentTransitionOutcome::Transitioned { .. } => {
                NookExtensionConsentTransitionState::Transitioned
            }
            ExtensionConsentTransitionOutcome::Rejected { .. } => {
                NookExtensionConsentTransitionState::Rejected
            }
        }
    }

    pub fn phase(&self) -> Result<NookExtensionConsentPhase, JsError> {
        match self.0 {
            ExtensionConsentTransitionOutcome::Transitioned { phase } => {
                Ok(NookExtensionConsentPhase::from_core(phase))
            }
            ExtensionConsentTransitionOutcome::Rejected { .. } => {
                Err(JsError::new("extension consent transition was rejected"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct ConsentValueScenario;

    impl ConsentValueScenario {
        fn assert_generated_values_drive_consent_without_wire_literals() -> Result<(), JsError> {
            let awaiting = NookExtensionConsentPhase::awaiting_authorization();
            assert_eq!(
                awaiting.state(),
                NookExtensionConsentPhaseState::AwaitingAuthorization
            );
            assert!(
                awaiting
                    .approval_availability(NookExtensionConsentVaultReadiness::Ready)
                    .can_approve()
            );
            assert!(
                !awaiting
                    .approval_availability(NookExtensionConsentVaultReadiness::ManagerUnavailable)
                    .can_approve()
            );

            let started = awaiting.transition(NookExtensionConsentEvent::AuthorizationStarted);
            assert_eq!(
                started.state(),
                NookExtensionConsentTransitionState::Transitioned
            );
            let authorizing = started.phase()?;
            assert_eq!(
                authorizing.state(),
                NookExtensionConsentPhaseState::Authorizing
            );

            let approved = authorizing
                .transition(NookExtensionConsentEvent::AuthorizationSucceeded)
                .phase()?;
            assert_eq!(approved.state(), NookExtensionConsentPhaseState::Approved);
            assert_eq!(
                approved
                    .approval_availability(NookExtensionConsentVaultReadiness::Locked)
                    .state(),
                NookExtensionConsentApprovalAvailabilityState::AlreadyApproved
            );
            Ok(())
        }

        fn assert_rejected_transition_has_no_fabricated_phase() {
            let rejected = NookExtensionConsentPhase::awaiting_authorization()
                .transition(NookExtensionConsentEvent::AuthorizationSucceeded);
            assert_eq!(
                rejected.state(),
                NookExtensionConsentTransitionState::Rejected
            );
            assert!(matches!(
                rejected.0,
                ExtensionConsentTransitionOutcome::Rejected { .. }
            ));
        }
    }

    #[test]
    fn generated_values_drive_consent_without_wire_literals() -> Result<(), JsError> {
        ConsentValueScenario::assert_generated_values_drive_consent_without_wire_literals()
    }

    #[test]
    fn rejected_transition_does_not_fabricate_a_phase() {
        ConsentValueScenario::assert_rejected_transition_has_no_fabricated_phase();
    }
}
