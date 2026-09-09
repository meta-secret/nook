use super::{CheckAcceptance, CheckConclusion, CheckExecution, DeliveryCheck, MainMergeEvidence};

enum CheckOutcome<'a> {
    Pending,
    Successful,
    Cancelled(&'a CheckConclusion),
    Skipped,
    Neutral,
    Failed(&'a CheckConclusion),
}
impl DeliveryCheck {
    fn outcome(&self) -> CheckOutcome<'_> {
        if self.status != CheckExecution::Completed {
            return CheckOutcome::Pending;
        }
        self.conclusion.completed_outcome()
    }
}
impl CheckConclusion {
    fn completed_outcome(&self) -> CheckOutcome<'_> {
        match self {
            CheckConclusion::Success => CheckOutcome::Successful,
            CheckConclusion::Cancelled => CheckOutcome::Cancelled(self),
            CheckConclusion::Skipped => CheckOutcome::Skipped,
            CheckConclusion::Neutral => CheckOutcome::Neutral,
            CheckConclusion::Other(_) => CheckOutcome::Failed(self),
        }
    }
}

pub(super) enum CheckAdmission {
    Accepted,
    Missing,
}
impl CheckAcceptance<'_> {
    pub(super) fn admit(self) -> CheckAdmission {
        let outcomes = self
            .checks
            .iter()
            .map(|check| check.outcome())
            .collect::<Vec<_>>();
        if outcomes
            .iter()
            .any(|outcome| matches!(outcome, CheckOutcome::Successful))
        {
            return CheckAdmission::Accepted;
        }
        if matches!(self.main_evidence, MainMergeEvidence::NotEstablished) {
            return CheckAdmission::Missing;
        }
        let mut cancelled = false;
        for outcome in outcomes {
            match outcome {
                CheckOutcome::Cancelled(_) => cancelled = true,
                CheckOutcome::Skipped | CheckOutcome::Neutral => {}
                CheckOutcome::Pending | CheckOutcome::Failed(_) => return CheckAdmission::Missing,
                CheckOutcome::Successful => return CheckAdmission::Accepted,
            }
        }
        if cancelled {
            CheckAdmission::Accepted
        } else {
            CheckAdmission::Missing
        }
    }
}

pub(super) struct RepositoryCheckSet<'a> {
    pub(super) name: &'a str,
    pub(super) checks: &'a [&'a DeliveryCheck],
}
impl RepositoryCheckSet<'_> {
    pub(super) fn validate(self) -> crate::HiveResult<()> {
        let outcomes = self
            .checks
            .iter()
            .map(|check| check.outcome())
            .collect::<Vec<_>>();
        if outcomes
            .iter()
            .any(|outcome| matches!(outcome, CheckOutcome::Successful))
        {
            return Ok(());
        }
        if outcomes
            .iter()
            .any(|outcome| matches!(outcome, CheckOutcome::Pending))
        {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: repository check \x60{}\x60 is still running",
                self.name
            )));
        }
        for outcome in outcomes {
            match outcome {
                CheckOutcome::Cancelled(conclusion) | CheckOutcome::Failed(conclusion) => {
                    return Err(crate::HiveError::message(format!(
                        "Hive repair delivery is incomplete: repository check \x60{}\x60 concluded {}",
                        self.name, conclusion
                    )));
                }
                CheckOutcome::Skipped
                | CheckOutcome::Neutral
                | CheckOutcome::Successful
                | CheckOutcome::Pending => {}
            }
        }
        Ok(())
    }
}
