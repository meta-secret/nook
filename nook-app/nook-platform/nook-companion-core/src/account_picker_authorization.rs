#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

mod state;

use state::{ActiveAuthorization, CleaningAuthorization, CleanupCompletion, CleanupEvidence};

enum AccountPickerAuthorizationPhase {
    Active(ActiveAuthorization),
    Cleaning(CleaningAuthorization),
}

/// Mutable host adapter over phase-specific authorization data.
///
/// The adapter checks its current phase on every call. Internal phase operations
/// have distinct owners; this façade retains its existing runtime API.
///
/// These examples compile the actual private phase implementation. The passing
/// control verifies that the imports and operations used by rejection examples
/// resolve independently of the intended compile failure.
///
/// ```
/// # mod state {
/// # include!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/account_picker_authorization/state.rs"));
/// # }
/// let active = state::ActiveAuthorization::new("opening".to_owned());
/// assert!(active.is_current("opening"));
/// let mut cleaning = state::CleaningAuthorization::new("cleanup".to_owned());
/// match cleaning.complete_cleanup("cleanup", state::CleanupEvidence::Partial) {
///     state::CleanupCompletion::Activated(active) => assert!(active.is_current("cleanup")),
///     state::CleanupCompletion::Pending => panic!("one completed cleanup should activate"),
/// }
/// ```
///
/// An active phase cannot complete cleanup.
///
/// ```compile_fail,E0599
/// # mod state {
/// # include!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/account_picker_authorization/state.rs"));
/// # }
/// let mut active = state::ActiveAuthorization::new("opening".to_owned());
/// active.complete_cleanup("opening", state::CleanupEvidence::Partial);
/// ```
///
/// A cleaning phase cannot authorize a current account-picker operation.
///
/// ```compile_fail,E0599
/// # mod state {
/// # include!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/account_picker_authorization/state.rs"));
/// # }
/// let cleaning = state::CleaningAuthorization::new("cleanup".to_owned());
/// cleaning.is_current("cleanup");
/// ```
///
/// A caller cannot overwrite private phase data to forge another epoch.
///
/// ```compile_fail,E0451
/// # mod state {
/// # include!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/account_picker_authorization/state.rs"));
/// # }
/// let cleaning = state::CleaningAuthorization::new("cleanup".to_owned());
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

    pub fn begin_cleanup(&mut self, next_epoch: String) -> String {
        match &mut self.phase {
            AccountPickerAuthorizationPhase::Active(_) => {
                self.phase = AccountPickerAuthorizationPhase::Cleaning(CleaningAuthorization::new(
                    next_epoch,
                ));
            }
            AccountPickerAuthorizationPhase::Cleaning(cleaning) => {
                cleaning.begin_overlapping_cleanup();
            }
        }
        self.snapshot()
    }

    pub fn complete_cleanup(&mut self, candidate: &str, full_cleanup_completed: bool) -> bool {
        let completion = match &mut self.phase {
            AccountPickerAuthorizationPhase::Cleaning(cleaning) => {
                cleaning.complete_cleanup(candidate, Self::cleanup_evidence(full_cleanup_completed))
            }
            AccountPickerAuthorizationPhase::Active(_) => return false,
        };
        match completion {
            CleanupCompletion::Pending => false,
            CleanupCompletion::Activated(active) => {
                self.phase = AccountPickerAuthorizationPhase::Active(active);
                true
            }
        }
    }

    #[must_use]
    pub fn is_final_cleanup(&self, candidate: &str, full_cleanup_completed: bool) -> bool {
        match &self.phase {
            AccountPickerAuthorizationPhase::Cleaning(cleaning) => {
                cleaning.is_final_cleanup(candidate, Self::cleanup_evidence(full_cleanup_completed))
            }
            AccountPickerAuthorizationPhase::Active(_) => false,
        }
    }

    pub fn release_cleanup(&mut self, candidate: &str) {
        if let AccountPickerAuthorizationPhase::Cleaning(cleaning) = &mut self.phase {
            cleaning.release_cleanup(candidate);
        }
    }

    #[must_use]
    pub fn is_current(&self, candidate: &str) -> bool {
        match &self.phase {
            AccountPickerAuthorizationPhase::Active(active) => active.is_current(candidate),
            AccountPickerAuthorizationPhase::Cleaning(_) => false,
        }
    }

    const fn cleanup_evidence(full_cleanup_completed: bool) -> CleanupEvidence {
        if full_cleanup_completed {
            CleanupEvidence::Full
        } else {
            CleanupEvidence::Partial
        }
    }
}

#[cfg(test)]
mod tests {
    use super::AccountPickerAuthorizationLifecycle;

    #[test]
    fn overlapping_cleanup_stays_invalid_until_every_attempt_finishes() {
        let mut state = AccountPickerAuthorizationLifecycle::new("opening".into());
        let cleanup = state.begin_cleanup("lock-1".into());
        assert_eq!(state.begin_cleanup("ignored".into()), cleanup);
        assert!(!state.is_current("opening") && !state.complete_cleanup(&cleanup, false));
        assert!(state.complete_cleanup(&cleanup, false) && state.is_current(&cleanup));

        let retry = state.begin_cleanup("lock-2".into());
        state.release_cleanup(&retry);
        state.begin_cleanup("ignored".into());
        assert!(!state.complete_cleanup(&retry, false));
        state.begin_cleanup("ignored".into());
        assert!(state.complete_cleanup(&retry, true));
    }

    #[test]
    fn active_phase_rejects_cleanup_completion_and_ignores_release() {
        let mut state = AccountPickerAuthorizationLifecycle::new("opening".into());
        assert!(!state.complete_cleanup("opening", true));
        assert!(!state.is_final_cleanup("opening", true));
        state.release_cleanup("opening");
        assert!(state.is_current("opening"));
        assert!(!state.is_current("stale"));
    }

    #[test]
    fn stale_epochs_cannot_finish_or_release_current_cleanup() {
        let mut state = AccountPickerAuthorizationLifecycle::new("opening".into());
        let epoch = state.begin_cleanup("cleanup".into());
        assert!(!state.is_current(&epoch));
        assert!(!state.is_final_cleanup("stale", true));
        assert!(!state.complete_cleanup("stale", true));
        state.release_cleanup("stale");
        assert!(state.complete_cleanup(&epoch, false));
        assert!(state.is_current(&epoch));
        assert!(!state.complete_cleanup(&epoch, true));
    }

    #[test]
    fn release_at_zero_preserves_the_full_cleanup_requirement() {
        let mut state = AccountPickerAuthorizationLifecycle::new("opening".into());
        let epoch = state.begin_cleanup("cleanup".into());
        state.release_cleanup(&epoch);
        state.release_cleanup(&epoch);
        assert!(!state.complete_cleanup(&epoch, false));
        assert!(!state.is_current(&epoch));
        assert!(!state.is_final_cleanup(&epoch, true));
        assert_eq!(state.begin_cleanup("ignored".into()), epoch);
        assert!(!state.is_final_cleanup(&epoch, false));
        assert!(state.is_final_cleanup(&epoch, true));
        assert!(!state.complete_cleanup("stale", true));
        assert!(!state.complete_cleanup(&epoch, false));
        assert!(!state.is_current(&epoch));
        state.begin_cleanup("still-ignored".into());
        assert!(state.complete_cleanup(&epoch, true));
    }

    #[test]
    fn full_evidence_at_zero_does_not_reactivate_without_a_cleanup_attempt() {
        let mut state = AccountPickerAuthorizationLifecycle::new("opening".into());
        let epoch = state.begin_cleanup("cleanup".into());
        state.release_cleanup(&epoch);
        assert!(!state.complete_cleanup(&epoch, true));
        assert!(!state.is_current(&epoch));
        assert!(!state.complete_cleanup(&epoch, false));
        // Full evidence clears the requirement even at zero, but a subsequent
        // attempt must still complete before the epoch becomes active.
        state.begin_cleanup("ignored".into());
        assert!(state.complete_cleanup(&epoch, false));
    }

    #[test]
    fn completion_rechecks_overlap_after_the_advisory_final_query() {
        let mut state = AccountPickerAuthorizationLifecycle::new("opening".into());
        let epoch = state.begin_cleanup("cleanup".into());
        assert!(state.is_final_cleanup(&epoch, false));
        assert_eq!(state.begin_cleanup("overlapping".into()), epoch);
        assert!(!state.complete_cleanup(&epoch, false));
        assert!(!state.is_current(&epoch));
        assert!(state.complete_cleanup(&epoch, false));
        assert!(state.is_current(&epoch));
        assert_eq!(state.snapshot(), epoch);
        assert_eq!(state.begin_cleanup("next".into()), "next");
        assert!(!state.is_current(&epoch));
    }
}
