use std::path::Path;

use crate::HiveContext;

use super::DeliveryPullRequest;
use super::command::gh_output;

pub(super) async fn validate_review_and_deployment_readiness(
    repository: &Path,
    pull_request: &DeliveryPullRequest,
) -> crate::HiveResult<()> {
    let number = pull_request.number.to_string();
    let repository_state: serde_json::Value = serde_json::from_str(
        &gh_output(repository, &["repo", "view", "--json", "nameWithOwner"]).await?,
    )
    .hive_context("GitHub returned invalid repository identity")?;
    let name_with_owner = repository_state
        .get("nameWithOwner")
        .and_then(serde_json::Value::as_str)
        .hive_context("GitHub repository identity omitted nameWithOwner")?;
    let (owner, name) = name_with_owner
        .split_once('/')
        .hive_context("GitHub repository identity is malformed")?;
    let mut unresolved = 0;
    let mut cursor: Option<String> = None;
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
        if let Some(value) = cursor.as_deref() {
            arguments.extend(["-F".to_owned(), format!("cursor={value}")]);
        }
        let references = arguments.iter().map(String::as_str).collect::<Vec<_>>();
        let review: serde_json::Value =
            serde_json::from_str(&gh_output(repository, &references).await?)
                .hive_context("GitHub returned invalid Hive review state")?;
        let threads = review
            .pointer("/data/repository/pullRequest/reviewThreads")
            .hive_context("GitHub review response omitted review threads")?;
        unresolved += threads
            .get("nodes")
            .and_then(serde_json::Value::as_array)
            .hive_context("GitHub review response omitted review thread nodes")?
            .iter()
            .filter(|thread| {
                thread
                    .get("isResolved")
                    .and_then(serde_json::Value::as_bool)
                    == Some(false)
            })
            .count();
        if threads
            .pointer("/pageInfo/hasNextPage")
            .and_then(serde_json::Value::as_bool)
            != Some(true)
        {
            break;
        }
        cursor = threads
            .pointer("/pageInfo/endCursor")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned);
        if cursor.is_none() {
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
    validate_non_thread_feedback(repository, pull_request.number).await?;

    let deployments: serde_json::Value = serde_json::from_str(
        &gh_output(
            repository,
            &[
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
        )
        .await?,
    )
    .hive_context("GitHub returned invalid deployment state")?;
    let mut state = None;
    for deployment_id in deployments
        .as_array()
        .hive_context("GitHub deployment response is not an array")?
        .iter()
        .filter_map(|deployment| deployment.get("id").and_then(serde_json::Value::as_u64))
    {
        let statuses: serde_json::Value = serde_json::from_str(
            &gh_output(
                repository,
                &[
                    "api",
                    "-X",
                    "GET",
                    &format!("repos/{{owner}}/{{repo}}/deployments/{deployment_id}/statuses"),
                    "-f",
                    "per_page=1",
                ],
            )
            .await?,
        )
        .hive_context("GitHub returned invalid deployment status")?;
        state = statuses
            .as_array()
            .and_then(|items| items.first())
            .and_then(|status| status.get("state"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned);
        if state.is_some() {
            break;
        }
    }
    if state.as_deref() != Some("success") {
        return Err(crate::HiveError::message(format!(
            "Hive repair delivery is incomplete: PR #{} exact-head github-pages deployment is {:?}",
            pull_request.number,
            state.as_deref()
        )));
    }
    Ok(())
}

async fn validate_non_thread_feedback(repository: &Path, number: u64) -> crate::HiveResult<()> {
    for surface in ["issues/{number}/comments", "pulls/{number}/reviews"] {
        let endpoint = format!(
            "repos/{{owner}}/{{repo}}/{}",
            surface.replace("{number}", &number.to_string())
        );
        let arguments = feedback_api_arguments(&endpoint);
        let references = arguments.iter().map(String::as_str).collect::<Vec<_>>();
        let bodies = gh_output(repository, &references).await?;
        if is_actionable_feedback(&bodies) {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: PR #{number} has actionable non-thread feedback"
            )));
        }
    }
    Ok(())
}

fn feedback_api_arguments(endpoint: &str) -> Vec<String> {
    ["api", "--paginate", "--jq", ".[].body", endpoint]
        .into_iter()
        .map(str::to_owned)
        .collect()
}

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

#[cfg(test)]
mod tests {
    use super::{feedback_api_arguments, is_actionable_feedback};

    #[test]
    fn paginated_feedback_bodies_preserve_actionable_markers() -> anyhow::Result<()> {
        let arguments = feedback_api_arguments("repos/{owner}/{repo}/issues/42/comments");
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
        assert!(is_actionable_feedback(bodies));
        assert!(!is_actionable_feedback(
            "Automated summary: checks passed.\nThis report is informational."
        ));
        Ok(())
    }
}
