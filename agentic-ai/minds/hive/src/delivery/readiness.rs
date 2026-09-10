#[derive(Default, serde::Deserialize)]
#[serde(untagged)]
enum ReviewCursor {
    After(String),
    #[default]
    FirstPage,
}
enum DeploymentObservation {
    NoStatus,
    Status(String),
}
impl std::fmt::Debug for DeploymentObservation {
    fn fmt(&self, output: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoStatus => output.write_str("None"),
            Self::Status(status) => output.debug_tuple("Some").field(status).finish(),
        }
    }
}
pub struct DeliveryReadiness<'scan> {
    pub repository: &'scan Path,
    pub pull_request: &'scan DeliveryPullRequest,
}
use std::path::Path;

use crate::HiveContext;

use super::DeliveryPullRequest;
use super::command::DeliveryCommand;

impl DeliveryReadiness<'_> {
    pub async fn validate_review_and_deployment_readiness(self) -> crate::HiveResult<()> {
        let Self {
            repository,
            pull_request,
        } = self;
        let number = pull_request.number.to_string();
        let repository_state: GithubRepositoryIdentity = serde_json::from_str(
            &(DeliveryCommand {
                repository: repository,
                arguments: &["repo", "view", "--json", "nameWithOwner"],
            })
            .gh_output()
            .await?,
        )
        .hive_context("GitHub returned invalid repository identity")?;
        let name_with_owner = repository_state.name_with_owner;
        let (owner, name) = name_with_owner
            .split_once('/')
            .ok_or_else(|| crate::HiveError::message("GitHub repository identity is malformed"))?;
        let mut unresolved = 0;
        let mut cursor = ReviewCursor::FirstPage;
        loop {
            let review_query = format!(
                "query($number:Int!,$cursor:String){{repository(owner:\"{owner}\",name:\"{name}\"){{pullRequest(number:$number){{reviewThreads(first:100,after:$cursor){{nodes{{isResolved}} pageInfo{{hasNextPage endCursor}}}}}}}}}}"
            );
            let mut arguments = vec![
                "api".to_owned(),
                "graphql".to_owned(),
                "-F".to_owned(),
                format!("number={number}"),
                "-f".to_owned(),
                format!("query={review_query}"),
            ];
            if let ReviewCursor::After(value) = &cursor {
                arguments.extend(["-F".to_owned(), format!("cursor={value}")]);
            }
            let references = arguments.iter().map(String::as_str).collect::<Vec<_>>();
            let review: GithubReviewResponse = serde_json::from_str(
                &(DeliveryCommand {
                    repository: repository,
                    arguments: &references,
                })
                .gh_output()
                .await?,
            )
            .hive_context("GitHub returned invalid Hive review state")?;
            let threads = review.data.repository.pull_request.review_threads;
            unresolved += threads
                .nodes
                .iter()
                .filter(|thread| !thread.is_resolved)
                .count();
            if !threads.page_info.has_next_page {
                break;
            }
            cursor = threads.page_info.end_cursor;
            if matches!(cursor, ReviewCursor::FirstPage) {
                return Err(crate::HiveError::message(
                    "GitHub review pagination omitted its cursor",
                ));
            }
        }
        if unresolved > 0 {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: PR #{} has {} unresolved review thread(s)",
                pull_request.number, unresolved
            )));
        }
        DeliveryReadiness::validate_non_thread_feedback(repository, pull_request.number).await?;

        let deployments: Vec<GithubDeployment> = serde_json::from_str(
            &(DeliveryCommand {
                repository: repository,
                arguments: &[
                    "api",
                    "-X",
                    "GET",
                    "repos/{owner}/{repo}/deployments",
                    "-f",
                    "environment=github-pages",
                    "-f",
                    &format!("sha={}", pull_request.head_ref_oid),
                    "-f",
                    "per_page=20",
                ],
            })
            .gh_output()
            .await?,
        )
        .hive_context("GitHub returned invalid deployment state")?;
        let mut state = DeploymentObservation::NoStatus;
        for deployment_id in deployments.iter().map(|deployment| deployment.id) {
            let statuses: Vec<GithubDeploymentStatus> = serde_json::from_str(
                &(DeliveryCommand {
                    repository: repository,
                    arguments: &[
                        "api",
                        "-X",
                        "GET",
                        &format!("repos/{{owner}}/{{repo}}/deployments/{deployment_id}/statuses"),
                        "-f",
                        "per_page=1",
                    ],
                })
                .gh_output()
                .await?,
            )
            .hive_context("GitHub returned invalid deployment status")?;
            state = match statuses.into_iter().next() {
                Some(status) => DeploymentObservation::Status(status.state),
                None => DeploymentObservation::NoStatus,
            };
            if matches!(state, DeploymentObservation::Status(_)) {
                break;
            }
        }
        if !matches!(&state, DeploymentObservation::Status(status) if status == "success") {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: PR #{} exact-head github-pages deployment is {:?}",
                pull_request.number, state
            )));
        }
        Ok(())
    }
}

impl DeliveryReadiness<'_> {
    async fn validate_non_thread_feedback(repository: &Path, number: u64) -> crate::HiveResult<()> {
        for surface in ["issues/{number}/comments", "pulls/{number}/reviews"] {
            let endpoint = format!(
                "repos/{{owner}}/{{repo}}/{}",
                surface.replace("{number}", &number.to_string())
            );
            let arguments = DeliveryReadiness::feedback_api_arguments(&endpoint);
            let references = arguments.iter().map(String::as_str).collect::<Vec<_>>();
            let bodies = (DeliveryCommand {
                repository: repository,
                arguments: &references,
            })
            .gh_output()
            .await?;
            if DeliveryReadiness::is_actionable_feedback(&bodies) {
                return Err(crate::HiveError::message(format!(
                    "Hive repair delivery is incomplete: PR #{number} has actionable non-thread feedback"
                )));
            }
        }
        Ok(())
    }
}

impl DeliveryReadiness<'_> {
    fn feedback_api_arguments(endpoint: &str) -> Vec<String> {
        ["api", "--paginate", "--jq", ".[].body", endpoint]
            .into_iter()
            .map(str::to_owned)
            .collect()
    }
}

impl DeliveryReadiness<'_> {
    fn is_actionable_feedback(body: &str) -> bool {
        [
            "[P0",
            "[P1",
            "[P2",
            "[P3",
            "changes requested",
            "request changes",
        ]
        .iter()
        .any(|marker| {
            body.to_ascii_lowercase()
                .contains(&marker.to_ascii_lowercase())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::DeliveryReadiness;

    #[test]
    fn paginated_feedback_bodies_preserve_actionable_markers() -> anyhow::Result<()> {
        let arguments =
            DeliveryReadiness::feedback_api_arguments("repos/{owner}/{repo}/issues/42/comments");
        let bodies =
            "Automated summary: looks good.\n[P1] Resolve the delivery race.\nMore detail.";

        assert_eq!(
            arguments,
            [
                "api",
                "--paginate",
                "--jq",
                ".[].body",
                "repos/{owner}/{repo}/issues/42/comments"
            ]
        );
        assert!(!arguments.iter().any(|argument| argument == "--slurp"));
        assert!(DeliveryReadiness::is_actionable_feedback(bodies));
        assert!(!DeliveryReadiness::is_actionable_feedback(
            "Automated summary: checks passed.\nThis report is informational."
        ));
        Ok(())
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubRepositoryIdentity {
    name_with_owner: String,
}
#[derive(serde::Deserialize)]
struct GithubReviewResponse {
    data: GithubReviewData,
}
#[derive(serde::Deserialize)]
struct GithubReviewData {
    repository: GithubReviewRepository,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubReviewRepository {
    pull_request: GithubReviewPullRequest,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubReviewPullRequest {
    review_threads: GithubReviewThreads,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubReviewThreads {
    nodes: Vec<GithubReviewThread>,
    page_info: GithubReviewPage,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubReviewThread {
    is_resolved: bool,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubReviewPage {
    has_next_page: bool,
    #[serde(default)]
    end_cursor: ReviewCursor,
}
#[derive(serde::Deserialize)]
struct GithubDeployment {
    id: u64,
}
#[derive(serde::Deserialize)]
struct GithubDeploymentStatus {
    state: String,
}

#[cfg(test)]
mod typed_response_tests {
    use super::*;
    #[test]
    fn malformed_review_resolution_cannot_count_as_resolved() {
        assert!(serde_json::from_str::<GithubReviewResponse>(r#"{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[{"isResolved":"false"}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}"#).is_err());
    }
    #[test]
    fn deployment_identifiers_must_be_numeric() {
        assert!(serde_json::from_str::<Vec<GithubDeployment>>(r#"[{"id":"123"}]"#).is_err());
    }
}
