use std::time::Duration;

use neo4rs::{Error as Neo4jDriverError, Neo4jErrorKind};
use rand::RngExt;

pub(super) const CLAIM_RETRY_LIMIT: usize = 5;

fn is_transient_driver_error(error: &Neo4jDriverError) -> bool {
    match error {
        Neo4jDriverError::Neo4j(neo4j_error) => neo4j_error.kind() == Neo4jErrorKind::Transient,
        Neo4jDriverError::UnexpectedMessage(message) => message.contains("Neo.TransientError."),
        _ => false,
    }
}

fn is_transient_claim_error(error: &crate::HiveError) -> bool {
    match error {
        crate::HiveError::Neo4j(driver_error)
        | crate::HiveError::Neo4jOperation {
            source: driver_error,
            ..
        } => is_transient_driver_error(driver_error),
        _ => false,
    }
}

pub(super) fn transient_claim_retry_delay(
    retry: usize,
    error: &crate::HiveError,
) -> Option<Duration> {
    (retry + 1 < CLAIM_RETRY_LIMIT && is_transient_claim_error(error))
        .then(|| Duration::from_millis(rand::rng().random_range(20..=80)))
}

#[cfg(test)]
mod tests {
    use neo4rs::Error as Neo4jDriverError;

    use super::{CLAIM_RETRY_LIMIT, is_transient_claim_error, transient_claim_retry_delay};

    #[test]
    fn retries_transient_pull_failures_from_the_neo4j_driver() {
        let transient = crate::HiveError::from(Neo4jDriverError::UnexpectedMessage(
            "unexpected response for PULL: Neo.TransientError.Transaction.DeadlockDetected"
                .to_owned(),
        ));
        let permanent = crate::HiveError::from(Neo4jDriverError::UnexpectedMessage(
            "unexpected response for PULL: Neo.ClientError.Statement.SyntaxError".to_owned(),
        ));

        assert!(is_transient_claim_error(&transient));
        assert!(!is_transient_claim_error(&permanent));
        assert!(transient_claim_retry_delay(0, &transient).is_some());
        assert!(transient_claim_retry_delay(CLAIM_RETRY_LIMIT - 2, &transient).is_some());
        assert!(transient_claim_retry_delay(CLAIM_RETRY_LIMIT - 1, &transient).is_none());
        assert!(transient_claim_retry_delay(0, &permanent).is_none());
    }
}
