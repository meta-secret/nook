// Self-contained phase data, also compiled by the lifecycle's contract examples.

use serde::Serialize;
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

pub(super) struct ActiveAuthorization {
    epoch: String,
}

pub(super) struct CleaningAuthorization {
    epoch: String,
    cleanup_count: u32,
    requirement: FullCleanupRequirement,
}

enum FullCleanupRequirement {
    NotRequired,
    Required,
}

/// Evidence reported by the cleanup operation, rechecked against current state.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CleanupEvidence {
    Partial,
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum CleanupTransitionError {
    #[error("cleanup epoch does not match the current epoch")]
    StaleEpoch,
    #[error("account picker is not being cleaned")]
    NotCleaning,
}

pub(super) enum CleanupCompletion {
    Pending(CleaningAuthorization),
    Activated(ActiveAuthorization),
}

pub(super) struct CleanupRejection {
    pub(super) state: CleaningAuthorization,
    pub(super) error: CleanupTransitionError,
}

impl ActiveAuthorization {
    pub(super) fn new(epoch: String) -> Self {
        Self { epoch }
    }

    pub(super) fn snapshot(&self) -> String {
        self.epoch.clone()
    }

    pub(super) fn is_current(&self, candidate: &str) -> bool {
        candidate == self.epoch
    }

    pub(super) fn begin_cleanup(self, next_epoch: String) -> CleaningAuthorization {
        // Cleanup retires the previously active epoch.
        drop(self.epoch);
        CleaningAuthorization {
            epoch: next_epoch,
            cleanup_count: 1,
            requirement: FullCleanupRequirement::NotRequired,
        }
    }
}

impl CleaningAuthorization {
    pub(super) fn snapshot(&self) -> String {
        self.epoch.clone()
    }

    pub(super) fn begin_overlapping_cleanup(mut self) -> Self {
        self.cleanup_count = self.cleanup_count.saturating_add(1);
        self
    }

    pub(super) fn complete_cleanup(
        mut self,
        candidate: &str,
        evidence: CleanupEvidence,
    ) -> Result<CleanupCompletion, CleanupRejection> {
        if candidate != self.epoch {
            return Err(CleanupRejection {
                state: self,
                error: CleanupTransitionError::StaleEpoch,
            });
        }
        if matches!(evidence, CleanupEvidence::Full) {
            self.requirement = FullCleanupRequirement::NotRequired;
        }
        if self.cleanup_count > 1 {
            self.cleanup_count -= 1;
        } else if self.cleanup_count == 1 {
            if matches!(self.requirement, FullCleanupRequirement::NotRequired) {
                return Ok(CleanupCompletion::Activated(ActiveAuthorization::new(
                    self.epoch,
                )));
            }
            self.cleanup_count = 0;
        }
        Ok(CleanupCompletion::Pending(self))
    }

    pub(super) fn is_final_cleanup(&self, candidate: &str, evidence: CleanupEvidence) -> bool {
        candidate == self.epoch
            && self.cleanup_count == 1
            && (matches!(self.requirement, FullCleanupRequirement::NotRequired)
                || matches!(evidence, CleanupEvidence::Full))
    }

    pub(super) fn release_cleanup(mut self, candidate: &str) -> Result<Self, CleanupRejection> {
        if candidate != self.epoch {
            return Err(CleanupRejection {
                state: self,
                error: CleanupTransitionError::StaleEpoch,
            });
        }
        self.cleanup_count = self.cleanup_count.saturating_sub(1);
        self.requirement = FullCleanupRequirement::Required;
        Ok(self)
    }
}
