use crate::neo4j::Neo4jTaskStore;
use std::time::Duration;

use neo4rs::{Error as Neo4jDriverError, Neo4jErrorKind};
use rand::RngExt;

pub(super) const CLAIM_RETRY_LIMIT: usize = 5;

#[derive(Debug)]
pub(super) enum ClaimRetry {
    Stop,
    RetryAfter(Duration),
}

impl Neo4jTaskStore {
    fn is_transient_driver_error(error: &Neo4jDriverError) -> bool {
        match error {
            Neo4jDriverError::Neo4j(neo4j_error) => neo4j_error.kind() == Neo4jErrorKind::Transient,
            Neo4jDriverError::UnexpectedMessage(message) => message.contains("Neo.TransientError."),
            _ => false,
        }
    }
}

impl Neo4jTaskStore {
    fn is_transient_claim_error(error: &crate::HiveError) -> bool {
        match error {
            crate::HiveError::Neo4j(driver_error)
            | crate::HiveError::Neo4jOperation {
                source: driver_error,
                ..
            } => Neo4jTaskStore::is_transient_driver_error(driver_error),
            _ => false,
        }
    }
}

impl Neo4jTaskStore {
    pub(super) fn transient_claim_retry_delay(
        retry: usize,
        error: &crate::HiveError,
    ) -> ClaimRetry {
        if retry + 1 < CLAIM_RETRY_LIMIT && Neo4jTaskStore::is_transient_claim_error(error) {
            ClaimRetry::RetryAfter(Duration::from_millis(rand::rng().random_range(20..=80)))
        } else {
            ClaimRetry::Stop
        }
    }
}

#[cfg(test)]
mod tests {
    use neo4rs::Error as Neo4jDriverError;

    use super::{CLAIM_RETRY_LIMIT, Neo4jTaskStore};

    #[test]
    fn retries_transient_pull_failures_from_the_neo4j_driver() {
        let transient = crate::HiveError::from(Neo4jDriverError::UnexpectedMessage(
            "unexpected response for PULL: Neo.TransientError.Transaction.DeadlockDetected"
                .to_owned(),
        ));
        let permanent = crate::HiveError::from(Neo4jDriverError::UnexpectedMessage(
            "unexpected response for PULL: Neo.ClientError.Statement.SyntaxError".to_owned(),
        ));

        assert!(Neo4jTaskStore::is_transient_claim_error(&transient));
        assert!(!Neo4jTaskStore::is_transient_claim_error(&permanent));
        assert!(matches!(
            Neo4jTaskStore::transient_claim_retry_delay(0, &transient),
            super::ClaimRetry::RetryAfter(_)
        ));
        assert!(matches!(
            Neo4jTaskStore::transient_claim_retry_delay(CLAIM_RETRY_LIMIT - 2, &transient),
            super::ClaimRetry::RetryAfter(_)
        ));
        assert!(matches!(
            Neo4jTaskStore::transient_claim_retry_delay(CLAIM_RETRY_LIMIT - 1, &transient),
            super::ClaimRetry::Stop
        ));
        assert!(matches!(
            Neo4jTaskStore::transient_claim_retry_delay(0, &permanent),
            super::ClaimRetry::Stop
        ));
    }
}
