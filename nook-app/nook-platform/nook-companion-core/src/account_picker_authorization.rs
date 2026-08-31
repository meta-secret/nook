enum AccountPickerAuthorizationPhase {
    Active,
    Cleaning {
        cleanup_count: u32,
        full_cleanup_required: bool,
    },
}

pub struct AccountPickerAuthorizationLifecycle {
    epoch: String,
    phase: AccountPickerAuthorizationPhase,
}

impl AccountPickerAuthorizationLifecycle {
    #[must_use]
    pub fn new(epoch: String) -> Self {
        Self {
            epoch,
            phase: AccountPickerAuthorizationPhase::Active,
        }
    }

    #[must_use]
    pub fn snapshot(&self) -> String {
        self.epoch.clone()
    }

    pub fn begin_cleanup(&mut self, next_epoch: String) -> String {
        match &mut self.phase {
            AccountPickerAuthorizationPhase::Active => {
                self.epoch = next_epoch;
                self.phase = AccountPickerAuthorizationPhase::Cleaning {
                    cleanup_count: 1,
                    full_cleanup_required: false,
                };
            }
            AccountPickerAuthorizationPhase::Cleaning { cleanup_count, .. } => {
                *cleanup_count = cleanup_count.saturating_add(1);
            }
        }
        self.snapshot()
    }

    pub fn complete_cleanup(&mut self, candidate: &str, full_cleanup_completed: bool) -> bool {
        if candidate != self.epoch {
            return false;
        }
        let finished = match &mut self.phase {
            AccountPickerAuthorizationPhase::Cleaning {
                cleanup_count,
                full_cleanup_required,
            } => {
                if full_cleanup_completed {
                    *full_cleanup_required = false;
                }
                if *cleanup_count > 1 {
                    *cleanup_count -= 1;
                    false
                } else if *cleanup_count == 1 && !*full_cleanup_required {
                    true
                } else if *cleanup_count == 1 {
                    *cleanup_count = 0;
                    false
                } else {
                    return false;
                }
            }
            AccountPickerAuthorizationPhase::Active => return false,
        };
        if finished {
            self.phase = AccountPickerAuthorizationPhase::Active;
        }
        finished
    }

    #[must_use]
    pub fn is_final_cleanup(&self, candidate: &str, full_cleanup_completed: bool) -> bool {
        candidate == self.epoch
            && matches!(
                self.phase,
                AccountPickerAuthorizationPhase::Cleaning {
                    cleanup_count: 1,
                    full_cleanup_required,
                } if !full_cleanup_required || full_cleanup_completed
            )
    }

    pub fn release_cleanup(&mut self, candidate: &str) {
        if candidate != self.epoch {
            return;
        }
        if let AccountPickerAuthorizationPhase::Cleaning {
            cleanup_count,
            full_cleanup_required,
        } = &mut self.phase
        {
            *cleanup_count = cleanup_count.saturating_sub(1);
            *full_cleanup_required = true;
        }
    }

    #[must_use]
    pub fn is_current(&self, candidate: &str) -> bool {
        candidate == self.epoch && matches!(self.phase, AccountPickerAuthorizationPhase::Active)
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
}
