use std::time::Duration;

use neo4rs::{Error as Neo4jDriverError, Neo4jErrorKind};
use rand::RngExt;

pub(super) const CLAIM_RETRY_LIMIT: usize = 5;

fn is_transient_claim_error(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause
            .downcast_ref::<Neo4jDriverError>()
            .is_some_and(|driver_error| match driver_error {
                Neo4jDriverError::Neo4j(neo4j_error) => {
                    neo4j_error.kind() == Neo4jErrorKind::Transient
                }
                Neo4jDriverError::UnexpectedMessage(message) => {
                    message.contains("Neo.TransientError.")
                }
                _ => false,
            })
    })
}

pub(super) fn transient_claim_retry_delay(retry: usize, error: &anyhow::Error) -> Option<Duration> {
    (retry + 1 < CLAIM_RETRY_LIMIT && is_transient_claim_error(error))
        .then(|| Duration::from_millis(rand::rng().random_range(20..=80)))
}

#[cfg(test)]
mod tests {
    use neo4rs::Error as Neo4jDriverError;

    use super::{CLAIM_RETRY_LIMIT, is_transient_claim_error, transient_claim_retry_delay};

    #[test]
    fn retries_transient_pull_failures_from_the_neo4j_driver() {
        let transient = anyhow::Error::new(Neo4jDriverError::UnexpectedMessage(
            "unexpected response for PULL: Neo.TransientError.Transaction.DeadlockDetected"
                .to_owned(),
        ));
        let permanent = anyhow::Error::new(Neo4jDriverError::UnexpectedMessage(
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
