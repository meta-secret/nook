#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

mod state;

use serde::Serialize;
use tsify::Tsify;

use state::{ActiveAuthorization, CleaningAuthorization, CleanupCompletion};
pub use state::{CleanupEvidence, CleanupTransitionError};

enum AccountPickerAuthorizationPhase {
    Active(ActiveAuthorization),
    Cleaning(CleaningAuthorization),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind", content = "error", rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub enum CleanupTransitionOutcome {
    Started,
    Pending,
    Activated,
    Released,
    Rejected(CleanupTransitionError),
}

/// Owns the successor, including the unchanged state when a transition rejects.
#[must_use]
pub struct AccountPickerAuthorizationTransition {
    lifecycle: AccountPickerAuthorizationLifecycle,
    outcome: CleanupTransitionOutcome,
}

impl AccountPickerAuthorizationTransition {
    fn new(phase: AccountPickerAuthorizationPhase, outcome: CleanupTransitionOutcome) -> Self {
        Self {
            lifecycle: AccountPickerAuthorizationLifecycle { phase },
            outcome,
        }
    }

    #[must_use]
    pub const fn outcome(&self) -> CleanupTransitionOutcome {
        self.outcome
    }

    #[must_use]
    pub fn into_lifecycle(self) -> AccountPickerAuthorizationLifecycle {
        self.lifecycle
    }
}

/// Runtime phase adapter whose mutations transfer ownership to a successor.
///
/// A caller continues with the returned lifecycle, including after rejection.
///
/// ```
/// use nook_companion_core::{AccountPickerAuthorizationLifecycle, CleanupEvidence,
///     CleanupTransitionOutcome};
/// let active = AccountPickerAuthorizationLifecycle::new("opening".to_owned());
/// let started = active.begin_cleanup("cleanup".to_owned());
/// assert_eq!(started.outcome(), CleanupTransitionOutcome::Started);
/// let cleaning = started.into_lifecycle();
/// let completed = cleaning.complete_cleanup("cleanup", CleanupEvidence::Partial);
/// assert_eq!(completed.outcome(), CleanupTransitionOutcome::Activated);
/// assert!(completed.into_lifecycle().is_current("cleanup"));
/// ```
///
/// The old lifecycle cannot authorize actions after cleanup starts.
///
/// ```compile_fail,E0382
/// use nook_companion_core::AccountPickerAuthorizationLifecycle;
/// let active = AccountPickerAuthorizationLifecycle::new("opening".to_owned());
/// let started = active.begin_cleanup("cleanup".to_owned());
/// active.is_current("opening");
/// ```
///
/// These phase examples compile the actual implementation. The passing control
/// checks the same imports and operation names as the rejection examples.
///
/// ```
/// # mod state {
/// # include!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/account_picker_authorization/state.rs"));
/// # }
/// let active = state::ActiveAuthorization::new("opening".to_owned());
/// let cleaning = active.begin_cleanup("cleanup".to_owned());
/// let completed = cleaning.complete_cleanup("cleanup", state::CleanupEvidence::Partial);
/// assert!(matches!(completed, Ok(state::CleanupCompletion::Activated(active))
///     if active.is_current("cleanup")));
/// ```
///
/// Completing cleanup consumes the cleaning capability.
///
/// ```compile_fail,E0382
/// # mod state {
/// # include!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/account_picker_authorization/state.rs"));
/// # }
/// let cleaning = state::ActiveAuthorization::new("opening".to_owned())
///     .begin_cleanup("cleanup".to_owned());
/// let completed = cleaning.complete_cleanup("cleanup", state::CleanupEvidence::Partial);
/// cleaning.complete_cleanup("cleanup", state::CleanupEvidence::Partial);
/// ```
///
/// An active phase cannot complete cleanup.
///
/// ```compile_fail,E0599
/// # mod state {
/// # include!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/account_picker_authorization/state.rs"));
/// # }
/// let active = state::ActiveAuthorization::new("opening".to_owned());
/// active.complete_cleanup("opening", state::CleanupEvidence::Partial);
/// ```
///
/// A cleaning phase cannot authorize a current account-picker operation.
///
/// ```compile_fail,E0599
/// # mod state {
/// # include!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/account_picker_authorization/state.rs"));
/// # }
/// let cleaning = state::ActiveAuthorization::new("opening".to_owned())
///     .begin_cleanup("cleanup".to_owned());
/// cleaning.is_current("cleanup");
/// ```
///
/// A caller cannot forge another epoch by overwriting private phase data.
///
/// ```compile_fail,E0451
/// # mod state {
/// # include!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/account_picker_authorization/state.rs"));
/// # }
/// let cleaning = state::ActiveAuthorization::new("opening".to_owned())
///     .begin_cleanup("cleanup".to_owned());
/// let forged = state::CleaningAuthorization {
///     epoch: "another-epoch".to_owned(),
///     ..cleaning
/// };
/// ```
pub struct AccountPickerAuthorizationLifecycle {
    phase: AccountPickerAuthorizationPhase,
}

impl AccountPickerAuthorizationLifecycle {
    #[must_use]
    pub fn new(epoch: String) -> Self {
        Self {
            phase: AccountPickerAuthorizationPhase::Active(ActiveAuthorization::new(epoch)),
        }
    }

    #[must_use]
    pub fn snapshot(&self) -> String {
        match &self.phase {
            AccountPickerAuthorizationPhase::Active(active) => active.snapshot(),
            AccountPickerAuthorizationPhase::Cleaning(cleaning) => cleaning.snapshot(),
        }
    }

    pub fn begin_cleanup(self, next_epoch: String) -> AccountPickerAuthorizationTransition {
        let cleaning = match self.phase {
            AccountPickerAuthorizationPhase::Active(active) => active.begin_cleanup(next_epoch),
            AccountPickerAuthorizationPhase::Cleaning(cleaning) => {
                cleaning.begin_overlapping_cleanup()
            }
        };
        AccountPickerAuthorizationTransition::new(
            AccountPickerAuthorizationPhase::Cleaning(cleaning),
            CleanupTransitionOutcome::Started,
        )
    }

    pub fn complete_cleanup(
        self,
        candidate: &str,
        evidence: CleanupEvidence,
    ) -> AccountPickerAuthorizationTransition {
        match self.phase {
            AccountPickerAuthorizationPhase::Cleaning(cleaning) => {
                match cleaning.complete_cleanup(candidate, evidence) {
                    Ok(CleanupCompletion::Pending(cleaning)) => {
                        AccountPickerAuthorizationTransition::new(
                            AccountPickerAuthorizationPhase::Cleaning(cleaning),
                            CleanupTransitionOutcome::Pending,
                        )
                    }
                    Ok(CleanupCompletion::Activated(active)) => {
                        AccountPickerAuthorizationTransition::new(
                            AccountPickerAuthorizationPhase::Active(active),
                            CleanupTransitionOutcome::Activated,
                        )
                    }
                    Err(rejected) => AccountPickerAuthorizationTransition::new(
                        AccountPickerAuthorizationPhase::Cleaning(rejected.state),
                        CleanupTransitionOutcome::Rejected(rejected.error),
                    ),
                }
            }
            AccountPickerAuthorizationPhase::Active(active) => {
                AccountPickerAuthorizationTransition::new(
                    AccountPickerAuthorizationPhase::Active(active),
                    CleanupTransitionOutcome::Rejected(CleanupTransitionError::NotCleaning),
                )
            }
        }
    }

    #[must_use]
    pub fn is_final_cleanup(&self, candidate: &str, evidence: CleanupEvidence) -> bool {
        match &self.phase {
            AccountPickerAuthorizationPhase::Cleaning(cleaning) => {
                cleaning.is_final_cleanup(candidate, evidence)
            }
            AccountPickerAuthorizationPhase::Active(_) => false,
        }
    }

    pub fn release_cleanup(self, candidate: &str) -> AccountPickerAuthorizationTransition {
        match self.phase {
            AccountPickerAuthorizationPhase::Cleaning(cleaning) => {
                match cleaning.release_cleanup(candidate) {
                    Ok(cleaning) => AccountPickerAuthorizationTransition::new(
                        AccountPickerAuthorizationPhase::Cleaning(cleaning),
                        CleanupTransitionOutcome::Released,
                    ),
                    Err(rejected) => AccountPickerAuthorizationTransition::new(
                        AccountPickerAuthorizationPhase::Cleaning(rejected.state),
                        CleanupTransitionOutcome::Rejected(rejected.error),
                    ),
                }
            }
            AccountPickerAuthorizationPhase::Active(active) => {
                AccountPickerAuthorizationTransition::new(
                    AccountPickerAuthorizationPhase::Active(active),
                    CleanupTransitionOutcome::Rejected(CleanupTransitionError::NotCleaning),
                )
            }
        }
    }

    #[must_use]
    pub fn is_current(&self, candidate: &str) -> bool {
        match &self.phase {
            AccountPickerAuthorizationPhase::Active(active) => active.is_current(candidate),
            AccountPickerAuthorizationPhase::Cleaning(_) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AccountPickerAuthorizationLifecycle, AccountPickerAuthorizationTransition, CleanupEvidence,
        CleanupTransitionError, CleanupTransitionOutcome,
    };

    struct Fixture;

    impl Fixture {
        fn transition(
            transition: AccountPickerAuthorizationTransition,
            expected: CleanupTransitionOutcome,
        ) -> AccountPickerAuthorizationLifecycle {
            assert_eq!(transition.outcome(), expected);
            transition.into_lifecycle()
        }

        fn started(
            state: AccountPickerAuthorizationLifecycle,
            epoch: &str,
        ) -> AccountPickerAuthorizationLifecycle {
            Self::transition(
                state.begin_cleanup(epoch.into()),
                CleanupTransitionOutcome::Started,
            )
        }

        fn completed(
            state: AccountPickerAuthorizationLifecycle,
            epoch: &str,
            evidence: CleanupEvidence,
            expected: CleanupTransitionOutcome,
        ) -> AccountPickerAuthorizationLifecycle {
            Self::transition(state.complete_cleanup(epoch, evidence), expected)
        }

        fn released(
            state: AccountPickerAuthorizationLifecycle,
            epoch: &str,
        ) -> AccountPickerAuthorizationLifecycle {
            Self::transition(
                state.release_cleanup(epoch),
                CleanupTransitionOutcome::Released,
            )
        }
    }

    #[test]
    fn overlapping_cleanup_stays_invalid_until_every_attempt_finishes() {
        let state = AccountPickerAuthorizationLifecycle::new("opening".into());
        let state = Fixture::started(state, "lock-1");
        let cleanup = state.snapshot();
        let state = Fixture::started(state, "ignored");
        assert_eq!(state.snapshot(), cleanup);
        assert!(!state.is_current("opening"));
        let state = Fixture::completed(
            state,
            &cleanup,
            CleanupEvidence::Partial,
            CleanupTransitionOutcome::Pending,
        );
        let state = Fixture::completed(
            state,
            &cleanup,
            CleanupEvidence::Partial,
            CleanupTransitionOutcome::Activated,
        );
        assert!(state.is_current(&cleanup));

        let state = Fixture::started(state, "lock-2");
        let retry = state.snapshot();
        let state = Fixture::released(state, &retry);
        let state = Fixture::started(state, "ignored");
        let state = Fixture::completed(
            state,
            &retry,
            CleanupEvidence::Partial,
            CleanupTransitionOutcome::Pending,
        );
        let state = Fixture::started(state, "ignored");
        let state = Fixture::completed(
            state,
            &retry,
            CleanupEvidence::Full,
            CleanupTransitionOutcome::Activated,
        );
        assert!(state.is_current(&retry));
    }

    #[test]
    fn active_phase_rejects_cleanup_completion_and_release() {
        let state = AccountPickerAuthorizationLifecycle::new("opening".into());
        let state = Fixture::completed(
            state,
            "opening",
            CleanupEvidence::Full,
            CleanupTransitionOutcome::Rejected(CleanupTransitionError::NotCleaning),
        );
        assert!(!state.is_final_cleanup("opening", CleanupEvidence::Full));
        let state = Fixture::transition(
            state.release_cleanup("opening"),
            CleanupTransitionOutcome::Rejected(CleanupTransitionError::NotCleaning),
        );
        assert_eq!(state.snapshot(), "opening");
        assert!(state.is_current("opening"));
        assert!(!state.is_current("stale"));
    }

    #[test]
    fn stale_epochs_cannot_finish_or_release_current_cleanup() {
        let state = AccountPickerAuthorizationLifecycle::new("opening".into());
        let state = Fixture::started(state, "cleanup");
        let epoch = state.snapshot();
        assert!(!state.is_current(&epoch));
        assert!(!state.is_final_cleanup("stale", CleanupEvidence::Full));
        let state = Fixture::completed(
            state,
            "stale",
            CleanupEvidence::Full,
            CleanupTransitionOutcome::Rejected(CleanupTransitionError::StaleEpoch),
        );
        let state = Fixture::transition(
            state.release_cleanup("stale"),
            CleanupTransitionOutcome::Rejected(CleanupTransitionError::StaleEpoch),
        );
        assert_eq!(state.snapshot(), epoch);
        assert!(state.is_final_cleanup(&epoch, CleanupEvidence::Partial));
        let state = Fixture::completed(
            state,
            &epoch,
            CleanupEvidence::Partial,
            CleanupTransitionOutcome::Activated,
        );
        assert!(state.is_current(&epoch));
        let state = Fixture::completed(
            state,
            &epoch,
            CleanupEvidence::Full,
            CleanupTransitionOutcome::Rejected(CleanupTransitionError::NotCleaning),
        );
        assert!(state.is_current(&epoch));
    }

    #[test]
    fn release_at_zero_preserves_the_full_cleanup_requirement() {
        let state = AccountPickerAuthorizationLifecycle::new("opening".into());
        let state = Fixture::started(state, "cleanup");
        let epoch = state.snapshot();
        let state = Fixture::released(state, &epoch);
        let state = Fixture::released(state, &epoch);
        let state = Fixture::completed(
            state,
            &epoch,
            CleanupEvidence::Partial,
            CleanupTransitionOutcome::Pending,
        );
        assert!(!state.is_current(&epoch));
        assert!(!state.is_final_cleanup(&epoch, CleanupEvidence::Full));
        let state = Fixture::started(state, "ignored");
        assert_eq!(state.snapshot(), epoch);
        assert!(!state.is_final_cleanup(&epoch, CleanupEvidence::Partial));
        assert!(state.is_final_cleanup(&epoch, CleanupEvidence::Full));
        let state = Fixture::completed(
            state,
            "stale",
            CleanupEvidence::Full,
            CleanupTransitionOutcome::Rejected(CleanupTransitionError::StaleEpoch),
        );
        assert!(!state.is_final_cleanup(&epoch, CleanupEvidence::Partial));
        let state = Fixture::completed(
            state,
            &epoch,
            CleanupEvidence::Partial,
            CleanupTransitionOutcome::Pending,
        );
        assert!(!state.is_current(&epoch));
        let state = Fixture::started(state, "still-ignored");
        let state = Fixture::completed(
            state,
            &epoch,
            CleanupEvidence::Full,
            CleanupTransitionOutcome::Activated,
        );
        assert!(state.is_current(&epoch));
    }

    #[test]
    fn full_evidence_at_zero_does_not_reactivate_without_a_cleanup_attempt() {
        let state = AccountPickerAuthorizationLifecycle::new("opening".into());
        let state = Fixture::started(state, "cleanup");
        let epoch = state.snapshot();
        let state = Fixture::released(state, &epoch);
        let state = Fixture::completed(
            state,
            &epoch,
            CleanupEvidence::Full,
            CleanupTransitionOutcome::Pending,
        );
        assert!(!state.is_current(&epoch));
        let state = Fixture::completed(
            state,
            &epoch,
            CleanupEvidence::Partial,
            CleanupTransitionOutcome::Pending,
        );
        // Full evidence clears the requirement even at zero, but a subsequent
        // attempt must still complete before the epoch becomes active.
        let state = Fixture::started(state, "ignored");
        let state = Fixture::completed(
            state,
            &epoch,
            CleanupEvidence::Partial,
            CleanupTransitionOutcome::Activated,
        );
        assert!(state.is_current(&epoch));
    }

    #[test]
    fn completion_rechecks_overlap_after_the_advisory_final_query() {
        let state = AccountPickerAuthorizationLifecycle::new("opening".into());
        let state = Fixture::started(state, "cleanup");
        let epoch = state.snapshot();
        assert!(state.is_final_cleanup(&epoch, CleanupEvidence::Partial));
        let state = Fixture::started(state, "overlapping");
        assert_eq!(state.snapshot(), epoch);
        let state = Fixture::completed(
            state,
            &epoch,
            CleanupEvidence::Partial,
            CleanupTransitionOutcome::Pending,
        );
        assert!(!state.is_current(&epoch));
        let state = Fixture::completed(
            state,
            &epoch,
            CleanupEvidence::Partial,
            CleanupTransitionOutcome::Activated,
        );
        assert!(state.is_current(&epoch));
        assert_eq!(state.snapshot(), epoch);
        let state = Fixture::started(state, "next");
        assert_eq!(state.snapshot(), "next");
        assert!(!state.is_current(&epoch));
    }
    #[test]
    fn transition_outcomes_expose_the_typed_browser_contract() -> anyhow::Result<()> {
        let cases = [
            (CleanupTransitionOutcome::Started, r#"{"kind":"started"}"#),
            (CleanupTransitionOutcome::Pending, r#"{"kind":"pending"}"#),
            (
                CleanupTransitionOutcome::Activated,
                r#"{"kind":"activated"}"#,
            ),
            (CleanupTransitionOutcome::Released, r#"{"kind":"released"}"#),
            (
                CleanupTransitionOutcome::Rejected(CleanupTransitionError::StaleEpoch),
                r#"{"kind":"rejected","error":"staleEpoch"}"#,
            ),
            (
                CleanupTransitionOutcome::Rejected(CleanupTransitionError::NotCleaning),
                r#"{"kind":"rejected","error":"notCleaning"}"#,
            ),
        ];
        for (outcome, expected) in cases {
            assert_eq!(serde_json::to_string(&outcome)?, expected);
        }
        Ok(())
    }
}
