use super::DeliveryPullRequest;
#[derive(Debug, PartialEq, Eq)]
pub(super) enum DeliveryGeneration {
    UnrelatedBranch,
    Generation(u64),
}
pub(super) enum DeliverySelection<'a> {
    NoDelivery,
    Delivery(&'a DeliveryPullRequest),
}
impl<'a> DeliverySelection<'a> {
    pub(super) fn require_delivery(
        self,
        context: &str,
    ) -> crate::HiveResult<&'a DeliveryPullRequest> {
        match self {
            Self::Delivery(value) => Ok(value),
            Self::NoDelivery => Err(crate::HiveError::message(context)),
        }
    }
}

pub(super) struct DeliveryGenerationSelection<'a> {
    pub(super) pull_requests: &'a [DeliveryPullRequest],
    pub(super) branch: &'a str,
}
impl<'a> DeliveryGenerationSelection<'a> {
    pub(super) fn latest_delivery_generation(self) -> crate::HiveResult<DeliverySelection<'a>> {
        let Self {
            pull_requests,
            branch,
        } = self;
        let mut generations = pull_requests
            .iter()
            .filter(|pull_request| !pull_request.is_cross_repository)
            .filter_map(|pull_request| {
                match DeliveryGenerationSelection::delivery_generation(
                    branch,
                    &pull_request.head_ref_name,
                ) {
                    DeliveryGeneration::Generation(generation) => Some((generation, pull_request)),
                    DeliveryGeneration::UnrelatedBranch => None,
                }
            })
            .collect::<Vec<_>>();
        generations.sort_by_key(|(generation, _)| *generation);
        let Some((latest_generation, latest)) = generations.last().copied() else {
            return Ok(DeliverySelection::NoDelivery);
        };
        if generations
            .iter()
            .rev()
            .skip(1)
            .any(|(generation, _)| *generation == latest_generation)
        {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is ambiguous: multiple PRs use generation {latest_generation}"
            )));
        }
        Ok(DeliverySelection::Delivery(latest))
    }
}

impl DeliveryGenerationSelection<'_> {
    fn delivery_generation(base: &str, candidate: &str) -> DeliveryGeneration {
        if candidate == base {
            return DeliveryGeneration::Generation(1);
        }
        match candidate
            .strip_prefix(&format!("{base}-g"))
            .and_then(|generation| generation.parse::<u64>().ok())
        {
            Some(generation) if generation >= 2 => DeliveryGeneration::Generation(generation),
            _ => DeliveryGeneration::UnrelatedBranch,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delivery::{DeliveryCommit, DeliveryMerge};
    #[test]
    fn latest_follow_up_generation_is_selected() -> crate::HiveResult<()> {
        let pull_requests = vec![
            DeliveryPullRequest::fixture(40, "codex/hive-task", "CLOSED", DeliveryMerge::Unmerged),
            DeliveryPullRequest::fixture(
                42,
                "codex/hive-task-g3",
                "MERGED",
                DeliveryMerge::Merged(DeliveryCommit {
                    oid: "abc123".to_owned(),
                }),
            ),
            DeliveryPullRequest::fixture(
                41,
                "codex/hive-task-g2",
                "CLOSED",
                DeliveryMerge::Unmerged,
            ),
            DeliveryPullRequest::fixture(
                99,
                "codex/hive-other",
                "MERGED",
                DeliveryMerge::Merged(DeliveryCommit {
                    oid: "unrelated".to_owned(),
                }),
            ),
        ];

        let latest = (DeliveryGenerationSelection {
            pull_requests: &pull_requests,
            branch: "codex/hive-task",
        })
        .latest_delivery_generation()?
        .require_delivery("latest delivery generation must be present")?;

        assert_eq!(latest.number, 42);
        assert_eq!(
            DeliveryGenerationSelection::delivery_generation(
                "codex/hive-task",
                "codex/hive-task-g1"
            ),
            DeliveryGeneration::UnrelatedBranch
        );
        Ok(())
    }

    #[test]
    fn duplicate_delivery_generations_are_rejected() -> anyhow::Result<()> {
        let pull_requests = vec![
            DeliveryPullRequest::fixture(
                41,
                "codex/hive-task-g2",
                "CLOSED",
                DeliveryMerge::Unmerged,
            ),
            DeliveryPullRequest::fixture(
                42,
                "codex/hive-task-g2",
                "MERGED",
                DeliveryMerge::Merged(DeliveryCommit {
                    oid: "abc123".to_owned(),
                }),
            ),
        ];

        let error = (DeliveryGenerationSelection {
            pull_requests: &pull_requests,
            branch: "codex/hive-task",
        })
        .latest_delivery_generation()
        .err()
        .ok_or_else(|| {
            crate::HiveError::message("duplicate generations cannot identify one delivery")
        })?;

        assert!(error.to_string().contains("multiple PRs use generation 2"));
        Ok(())
    }

    #[test]
    fn cross_repository_generation_is_ignored() -> crate::HiveResult<()> {
        let mut fork = DeliveryPullRequest::fixture(
            99,
            "codex/hive-task-g99",
            "OPEN",
            DeliveryMerge::Unmerged,
        );
        fork.is_cross_repository = true;
        let pull_requests = vec![
            DeliveryPullRequest::fixture(
                42,
                "codex/hive-task-g2",
                "MERGED",
                DeliveryMerge::Merged(DeliveryCommit {
                    oid: "abc123".to_owned(),
                }),
            ),
            fork,
        ];

        let latest = (DeliveryGenerationSelection {
            pull_requests: &pull_requests,
            branch: "codex/hive-task",
        })
        .latest_delivery_generation()?
        .require_delivery("same-repository delivery generation must be present")?;

        assert_eq!(latest.number, 42);
        Ok(())
    }
}
