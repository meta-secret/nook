// Self-contained phase data, also compiled by the lifecycle's contract examples.

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

#[derive(Clone, Copy)]
pub(super) enum CleanupEvidence {
    Partial,
    Full,
}

pub(super) enum CleanupCompletion {
    Pending,
    Activated(ActiveAuthorization),
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
}

impl CleaningAuthorization {
    pub(super) fn new(epoch: String) -> Self {
        Self {
            epoch,
            cleanup_count: 1,
            requirement: FullCleanupRequirement::NotRequired,
        }
    }

    pub(super) fn snapshot(&self) -> String {
        self.epoch.clone()
    }

    pub(super) fn begin_overlapping_cleanup(&mut self) {
        self.cleanup_count = self.cleanup_count.saturating_add(1);
    }

    pub(super) fn complete_cleanup(
        &mut self,
        candidate: &str,
        evidence: CleanupEvidence,
    ) -> CleanupCompletion {
        if candidate != self.epoch {
            return CleanupCompletion::Pending;
        }
        if matches!(evidence, CleanupEvidence::Full) {
            self.requirement = FullCleanupRequirement::NotRequired;
        }
        if self.cleanup_count > 1 {
            self.cleanup_count -= 1;
        } else if self.cleanup_count == 1 {
            if matches!(self.requirement, FullCleanupRequirement::NotRequired) {
                return CleanupCompletion::Activated(ActiveAuthorization::new(self.snapshot()));
            }
            self.cleanup_count = 0;
        }
        CleanupCompletion::Pending
    }

    pub(super) fn is_final_cleanup(&self, candidate: &str, evidence: CleanupEvidence) -> bool {
        candidate == self.epoch
            && self.cleanup_count == 1
            && (matches!(self.requirement, FullCleanupRequirement::NotRequired)
                || matches!(evidence, CleanupEvidence::Full))
    }

    pub(super) fn release_cleanup(&mut self, candidate: &str) {
        if candidate == self.epoch {
            self.cleanup_count = self.cleanup_count.saturating_sub(1);
            self.requirement = FullCleanupRequirement::Required;
        }
    }
}
