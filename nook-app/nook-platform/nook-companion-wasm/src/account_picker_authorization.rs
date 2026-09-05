use nook_companion_core::{
    AccountPickerAuthorizationLifecycle as CoreLifecycle,
    AccountPickerAuthorizationTransition as CoreTransition, CleanupEvidence,
    CleanupTransitionOutcome,
};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub struct AccountPickerAuthorizationLifecycle {
    inner: CoreLifecycle,
}

#[wasm_bindgen]
pub struct AccountPickerAuthorizationTransition {
    inner: CoreTransition,
}

#[wasm_bindgen]
impl AccountPickerAuthorizationTransition {
    #[must_use]
    pub fn outcome(&self) -> CleanupTransitionOutcome {
        self.inner.outcome()
    }

    #[must_use]
    pub fn into_lifecycle(self) -> AccountPickerAuthorizationLifecycle {
        AccountPickerAuthorizationLifecycle {
            inner: self.inner.into_lifecycle(),
        }
    }
}

#[wasm_bindgen]
impl AccountPickerAuthorizationLifecycle {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(epoch: String) -> Self {
        Self {
            inner: CoreLifecycle::new(epoch),
        }
    }

    #[must_use]
    pub fn snapshot(&self) -> String {
        self.inner.snapshot()
    }

    #[must_use]
    pub fn begin_cleanup(self, next_epoch: String) -> AccountPickerAuthorizationTransition {
        AccountPickerAuthorizationTransition {
            inner: self.inner.begin_cleanup(next_epoch),
        }
    }

    #[must_use]
    pub fn complete_cleanup(
        self,
        candidate: &str,
        evidence: CleanupEvidence,
    ) -> AccountPickerAuthorizationTransition {
        AccountPickerAuthorizationTransition {
            inner: self.inner.complete_cleanup(candidate, evidence),
        }
    }

    #[must_use]
    pub fn is_final_cleanup(&self, candidate: &str, evidence: CleanupEvidence) -> bool {
        self.inner.is_final_cleanup(candidate, evidence)
    }

    #[must_use]
    pub fn release_cleanup(self, candidate: &str) -> AccountPickerAuthorizationTransition {
        AccountPickerAuthorizationTransition {
            inner: self.inner.release_cleanup(candidate),
        }
    }

    #[must_use]
    pub fn is_current(&self, candidate: &str) -> bool {
        self.inner.is_current(candidate)
    }
}

#[cfg(test)]
mod tests {
    use super::{AccountPickerAuthorizationLifecycle, CleanupEvidence, CleanupTransitionOutcome};
    use nook_companion_core::CleanupTransitionError;

    #[test]
    fn wrapper_returns_the_successor_after_activation_and_rejection() {
        let active = AccountPickerAuthorizationLifecycle::new("opening".to_owned());
        let started = active.begin_cleanup("cleanup".to_owned());
        assert_eq!(started.outcome(), CleanupTransitionOutcome::Started);
        let cleaning = started.into_lifecycle();
        assert!(!cleaning.is_current("opening"));
        let rejected = cleaning.complete_cleanup("stale", CleanupEvidence::Full);
        assert_eq!(
            rejected.outcome(),
            CleanupTransitionOutcome::Rejected(CleanupTransitionError::StaleEpoch)
        );
        let cleaning = rejected.into_lifecycle();
        assert_eq!(cleaning.snapshot(), "cleanup");
        let completed = cleaning.complete_cleanup("cleanup", CleanupEvidence::Partial);
        assert_eq!(completed.outcome(), CleanupTransitionOutcome::Activated);
        let active = completed.into_lifecycle();
        assert!(active.is_current("cleanup"));
        let rejected = active.release_cleanup("cleanup");
        assert_eq!(
            rejected.outcome(),
            CleanupTransitionOutcome::Rejected(CleanupTransitionError::NotCleaning)
        );
        assert!(rejected.into_lifecycle().is_current("cleanup"));
    }
}
