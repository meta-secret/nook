use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use anyhow::Context;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::model::ClaimedTask;

const REPOSITORY: &str = "meta-secret/nook";
const API_ROOT: &str = "https://api.github.com";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BoundTask {
    id: String,
    source_commit: String,
    branch: String,
    enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LocalExecutionCategory {
    Check,
    Test,
    Combined,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LocalExecutionEvent {
    command: String,
    category: LocalExecutionCategory,
    started_at: String,
    finished_at: String,
    duration_seconds: u64,
    outcome: String,
    reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum GitHubRequest {
    Bind {
        task_id: String,
        source_commit: String,
        enabled: bool,
    },
    Publish {
        title: String,
        body: String,
    },
    Inspect,
    ReplyThread {
        thread_id: String,
        body: String,
    },
    ReplyFeedback {
        feedback_id: String,
        body: String,
    },
    ResolveThread {
        thread_id: String,
    },
    Merge {
        expected_head: String,
    },
    VerifyMain {
        merge_commit: String,
    },
    CompletionStatus,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "result", content = "value", rename_all = "snake_case")]
enum GitHubResponse {
    Value(Value),
    Error(String),
}

#[derive(Clone)]
struct PublicationBroker {
    task: Arc<Mutex<Option<BoundTask>>>,
    merged_commit: Arc<Mutex<Option<String>>>,
    verified_main: Arc<Mutex<bool>>,
    verified_run: Arc<Mutex<Option<Value>>>,
    workbench_completed: Arc<Mutex<bool>>,
    source_workspace: PathBuf,
    workspace: PathBuf,
    token_path: PathBuf,
    private_home: PathBuf,
}

pub async fn bind_publication_task(
    socket: &Path,
    task: &ClaimedTask,
    enabled: bool,
) -> anyhow::Result<PublicationBinding> {
    let response = request(
        socket,
        &GitHubRequest::Bind {
            task_id: task.id.to_string(),
            source_commit: task.source_commit.clone(),
            enabled,
        },
    )
    .await?;
    let branch = response
        .get("branch")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .context("publication broker returned an invalid bind response")?;
    let merge_commit = response
        .get("merge_commit")
        .and_then(Value::as_str)
        .map(str::to_owned);
    Ok(PublicationBinding {
        branch,
        merge_commit,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicationBinding {
    pub branch: String,
    pub merge_commit: Option<String>,
}

pub async fn publication_delivery_verified(socket: &Path) -> anyhow::Result<bool> {
    Ok(request(socket, &GitHubRequest::CompletionStatus)
        .await?
        .get("verified")
        .and_then(Value::as_bool)
        .unwrap_or(false))
}

pub async fn run_publication_client(
    socket: &Path,
    request_value: GitHubRequest,
) -> anyhow::Result<()> {
    println!(
        "{}",
        serde_json::to_string(&request(socket, &request_value).await?)?
    );
    Ok(())
}

async fn request(socket: &Path, request_value: &GitHubRequest) -> anyhow::Result<Value> {
    let mut stream = None;
    for _ in 0..240 {
        match UnixStream::connect(socket).await {
            Ok(connected) => {
                stream = Some(connected);
                break;
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused
                ) =>
            {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
            Err(error) => {
                return Err(error).with_context(|| {
                    format!("connect to publication broker {}", socket.display())
                });
            }
        }
    }
    let mut stream = stream.with_context(|| {
        format!(
            "publication broker {} was unavailable for 120 seconds",
            socket.display()
        )
    })?;
    stream
        .write_all(&serde_json::to_vec(request_value)?)
        .await?;
    stream.write_all(b"\n").await?;
    stream.flush().await?;
    let mut response = String::new();
    BufReader::new(stream).read_line(&mut response).await?;
    match serde_json::from_str(&response).context("decode publication broker response")? {
        GitHubResponse::Value(value) => Ok(value),
        GitHubResponse::Error(error) => Err(anyhow::anyhow!(error)),
    }
}

pub async fn run_publication_broker(
    socket: PathBuf,
    workspace: PathBuf,
    token_path: PathBuf,
    private_home: PathBuf,
) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(&private_home).await?;
    if let Some(parent) = socket.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    match tokio::fs::remove_file(&socket).await {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let listener = UnixListener::bind(&socket)?;
    let broker = PublicationBroker {
        task: Arc::new(Mutex::new(None)),
        merged_commit: Arc::new(Mutex::new(None)),
        verified_main: Arc::new(Mutex::new(false)),
        verified_run: Arc::new(Mutex::new(None)),
        workbench_completed: Arc::new(Mutex::new(false)),
        source_workspace: workspace,
        workspace: private_home.join("repository"),
        token_path,
        private_home,
    };
    loop {
        let (stream, _) = listener.accept().await?;
        let broker = broker.clone();
        tokio::spawn(async move {
            if let Err(error) = serve_connection(&broker, stream).await {
                eprintln!("Hive publication request failed: {error:#}");
            }
        });
    }
}

async fn serve_connection(broker: &PublicationBroker, stream: UnixStream) -> anyhow::Result<()> {
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();
    while let Some(line) = lines.next_line().await? {
        let response = match serde_json::from_str::<GitHubRequest>(&line) {
            Ok(request_value) => broker
                .handle(request_value)
                .await
                .map(GitHubResponse::Value)
                .unwrap_or_else(|error| GitHubResponse::Error(format!("{error:#}"))),
            Err(error) => GitHubResponse::Error(format!("invalid publication request: {error}")),
        };
        writer.write_all(&serde_json::to_vec(&response)?).await?;
        writer.write_all(b"\n").await?;
        writer.flush().await?;
    }
    Ok(())
}

impl PublicationBroker {
    async fn handle(&self, request_value: GitHubRequest) -> anyhow::Result<Value> {
        match request_value {
            GitHubRequest::Bind {
                task_id,
                source_commit,
                enabled,
            } => self.bind(task_id, source_commit, enabled).await,
            GitHubRequest::Publish { title, body } => self.publish(&title, &body).await,
            GitHubRequest::Inspect => self.inspect().await,
            GitHubRequest::ReplyThread { thread_id, body } => {
                self.reply_thread(&thread_id, &body).await
            }
            GitHubRequest::ReplyFeedback { feedback_id, body } => {
                self.reply_feedback(&feedback_id, &body).await
            }
            GitHubRequest::ResolveThread { thread_id } => self.resolve_thread(&thread_id).await,
            GitHubRequest::Merge { expected_head } => self.merge(&expected_head).await,
            GitHubRequest::VerifyMain { merge_commit } => self.verify_main(&merge_commit).await,
            GitHubRequest::CompletionStatus => self.completion_status().await,
        }
    }

    async fn bind(
        &self,
        task_id: String,
        source_commit: String,
        enabled: bool,
    ) -> anyhow::Result<Value> {
        if source_commit.len() != 40 || !source_commit.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            anyhow::bail!("publication source commit is invalid");
        }
        let base_branch = publication_branch_name(&task_id);
        if !enabled {
            let candidate = BoundTask {
                branch: String::new(),
                id: task_id,
                source_commit: source_commit.to_ascii_lowercase(),
                enabled,
            };
            let mut task = self.task.lock().await;
            if task.is_some() {
                anyhow::bail!("publication broker is already bound");
            }
            *task = Some(candidate);
            return Ok(json!({ "branch": "" }));
        }
        let task_pulls = self.task_pulls(&base_branch).await?;
        let branch = task_pulls
            .iter()
            .max_by_key(|pull| pull.get("number").and_then(Value::as_u64).unwrap_or(0))
            .and_then(|pull| pull.pointer("/head/ref"))
            .and_then(Value::as_str)
            .unwrap_or(&base_branch)
            .to_owned();
        let candidate = BoundTask {
            branch,
            id: task_id,
            source_commit: source_commit.to_ascii_lowercase(),
            enabled,
        };
        {
            let mut task = self.task.lock().await;
            if let Some(existing) = task.as_ref() {
                if existing.id != candidate.id
                    || existing.source_commit != candidate.source_commit
                    || existing.enabled != candidate.enabled
                {
                    anyhow::bail!("publication broker is already bound to another task");
                }
            } else {
                *task = Some(candidate.clone());
            }
        }
        let recovered_merge_commit = task_pulls
            .iter()
            .filter(|pull| pull.get("merged_at").is_some_and(|value| !value.is_null()))
            .max_by_key(|pull| pull.get("number").and_then(Value::as_u64).unwrap_or(0))
            .and_then(|pull| pull.get("merge_commit_sha"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        if let Some(merge_commit) = recovered_merge_commit.as_ref() {
            *self.merged_commit.lock().await = Some(merge_commit.clone());
        }
        if candidate.id.starts_with("main-failure-") {
            self.ensure_workbench_plan(&candidate).await?;
            if recovered_merge_commit.is_some() {
                self.publish_merged_statistics(&candidate).await?;
            }
        }
        Ok(json!({
            "branch": candidate.branch,
            "merge_commit": recovered_merge_commit,
        }))
    }

    async fn bound_task(&self) -> anyhow::Result<BoundTask> {
        let task = self
            .task
            .lock()
            .await
            .clone()
            .context("publication broker is not bound to a claimed task")?;
        if !task.enabled {
            anyhow::bail!("publication is disabled for this task");
        }
        Ok(task)
    }

    async fn publish(&self, title: &str, body: &str) -> anyhow::Result<Value> {
        let mut task = self.bound_task().await?;
        if title.trim().is_empty() || body.trim().is_empty() {
            anyhow::bail!("pull request title and body are required");
        }
        let base_branch = publication_branch_name(&task.id);
        let task_pulls = self.task_pulls(&base_branch).await?;
        if let Some(open_branch) = task_pulls
            .iter()
            .find(|pull| pull.get("state").and_then(Value::as_str) == Some("open"))
            .and_then(|pull| pull.pointer("/head/ref"))
            .and_then(Value::as_str)
        {
            task.branch = open_branch.to_owned();
        } else if !task_pulls.is_empty() {
            let generation = task_pulls
                .iter()
                .filter_map(|pull| pull.pointer("/head/ref").and_then(Value::as_str))
                .filter_map(|branch| publication_branch_generation(&base_branch, branch))
                .max()
                .unwrap_or(1)
                + 1;
            task.branch = format!("{base_branch}-g{generation}");
        } else {
            task.branch.clone_from(&base_branch);
        }
        *self.task.lock().await = Some(task.clone());
        self.prepare_publication_workspace(&task).await?;
        self.git(&["add", "--all", "--", "."]).await?;
        if !self.git_success(&["diff", "--cached", "--quiet"]).await? {
            self.git(&[
                "-c",
                "user.name=Nook Hive",
                "-c",
                "user.email=hive@example.invalid",
                "commit",
                "-m",
                title,
            ])
            .await?;
        }
        let head = self.git_output(&["rev-parse", "HEAD"]).await?;
        if head == task.source_commit {
            anyhow::bail!("refusing to publish a repair branch without changes");
        }
        self.git(&[
            "push",
            "origin",
            &format!("HEAD:refs/heads/{}", task.branch),
        ])
        .await?;

        let existing = self.pulls_for_branch(&task.branch, "open").await?;
        let pull = if let Some(pull) = existing.as_array().and_then(|pulls| pulls.first()) {
            pull.clone()
        } else {
            self.api(
                "POST",
                &format!("/repos/{REPOSITORY}/pulls"),
                Some(json!({
                    "title": title,
                    "body": body,
                    "head": task.branch,
                    "base": "main",
                })),
            )
            .await?
        };
        if task.id.starts_with("main-failure-") {
            let number = pull
                .get("number")
                .and_then(Value::as_u64)
                .context("published Main repair has no pull-request number")?;
            self.api(
                "POST",
                &format!("/repos/{REPOSITORY}/issues/{number}/labels"),
                Some(json!({ "labels": ["ci:full-e2e"] })),
            )
            .await?;
        }
        Ok(json!({
            "branch": task.branch,
            "head_sha": head,
            "pull_request": pull.get("number"),
            "url": pull.get("html_url"),
        }))
    }

    async fn inspect(&self) -> anyhow::Result<Value> {
        let task = self.bound_task().await?;
        let pull = self.pull_for_branch(&task.branch).await?;
        let number = pull
            .get("number")
            .and_then(Value::as_u64)
            .context("pull request has no number")?;
        let head = pull
            .pointer("/head/sha")
            .and_then(Value::as_str)
            .context("pull request has no head SHA")?;
        let checks = self
            .paginated_api_object_array(
                &format!("/repos/{REPOSITORY}/commits/{head}/check-runs"),
                "check_runs",
            )
            .await?;
        let reviews = self
            .paginated_api_array(&format!("/repos/{REPOSITORY}/pulls/{number}/reviews"))
            .await?;
        let comments = self
            .paginated_api_array(&format!("/repos/{REPOSITORY}/issues/{number}/comments"))
            .await?;
        let review_threads = self.review_threads(number).await?;
        let feedback = review_feedback(&pull, &reviews, &comments);
        Ok(json!({
            "pull_request": number,
            "url": pull.get("html_url"),
            "state": pull.get("state"),
            "draft": pull.get("draft"),
            "mergeable": pull.get("mergeable"),
            "mergeable_state": pull.get("mergeable_state"),
            "head_sha": head,
            "checks": checks,
            "reviews": reviews,
            "comments": comments,
            "feedback": feedback,
            "review_threads": review_threads,
        }))
    }

    async fn merge(&self, expected_head: &str) -> anyhow::Result<Value> {
        let lock = self.acquire_merge_lock().await?;
        let result = self.merge_locked(expected_head).await;
        let release = self
            .api(
                "DELETE",
                &format!("/repos/{REPOSITORY}/git/refs/heads/hive-merge-lock"),
                None,
            )
            .await;
        match (result, release) {
            (Ok(merged), Ok(_)) => Ok(merged),
            (Err(error), _) => Err(error),
            (Ok(merged), Err(error)) => {
                eprintln!(
                    "Hive merge {lock} succeeded but lock cleanup will be retried by its \
                     expiration path: {error:#}"
                );
                Ok(merged)
            }
        }
    }

    async fn merge_locked(&self, expected_head: &str) -> anyhow::Result<Value> {
        let task = self.bound_task().await?;
        let pull = self.pull_for_branch(&task.branch).await?;
        let number = pull
            .get("number")
            .and_then(Value::as_u64)
            .context("pull request has no number")?;
        let head = pull
            .pointer("/head/sha")
            .and_then(Value::as_str)
            .context("pull request has no head SHA")?;
        if head != expected_head {
            anyhow::bail!("pull request head moved; inspect and verify the new exact head");
        }
        let main = self
            .api(
                "GET",
                &format!("/repos/{REPOSITORY}/git/ref/heads/main"),
                None,
            )
            .await?;
        let main_sha = main
            .pointer("/object/sha")
            .and_then(Value::as_str)
            .context("Main ref has no object SHA")?;
        let comparison = self
            .api(
                "GET",
                &format!("/repos/{REPOSITORY}/compare/{main_sha}...{head}"),
                None,
            )
            .await?;
        if !matches!(
            comparison.get("status").and_then(Value::as_str),
            Some("ahead" | "identical")
        ) {
            anyhow::bail!("Main moved; update the repair branch and rerun exact-head checks");
        }
        let check_runs = self
            .paginated_api_object_array(
                &format!("/repos/{REPOSITORY}/commits/{head}/check-runs"),
                "check_runs",
            )
            .await?;
        let repository_checks = check_runs
            .iter()
            .filter(|check| {
                check.pointer("/app/slug").and_then(Value::as_str) == Some("github-actions")
            })
            .collect::<Vec<_>>();
        if repository_checks.is_empty()
            || repository_checks.iter().any(|check| {
                check.get("status").and_then(Value::as_str) != Some("completed")
                    || !matches!(
                        check.get("conclusion").and_then(Value::as_str),
                        Some("success" | "neutral" | "skipped")
                    )
            })
        {
            anyhow::bail!("exact-head checks are not all complete and successful");
        }
        let unresolved = self
            .review_threads(number)
            .await?
            .as_array()
            .is_some_and(|threads| {
                threads.iter().any(|thread| {
                    thread.get("isResolved").and_then(Value::as_bool) != Some(true)
                        && thread.get("isOutdated").and_then(Value::as_bool) != Some(true)
                })
            });
        if unresolved {
            anyhow::bail!("pull request still has unresolved review threads");
        }
        let reviews = self
            .paginated_api_array(&format!("/repos/{REPOSITORY}/pulls/{number}/reviews"))
            .await?;
        let comments = self
            .paginated_api_array(&format!("/repos/{REPOSITORY}/issues/{number}/comments"))
            .await?;
        if review_feedback(&pull, &reviews, &comments)
            .iter()
            .any(|feedback| {
                feedback.get("actionable").and_then(Value::as_bool) == Some(true)
                    && feedback.get("addressed").and_then(Value::as_bool) != Some(true)
            })
        {
            anyhow::bail!("pull request still has unaddressed top-level review feedback");
        }
        let merged = self
            .api(
                "PUT",
                &format!("/repos/{REPOSITORY}/pulls/{number}/merge"),
                Some(json!({ "merge_method": "squash", "sha": head })),
            )
            .await?;
        if merged.get("merged").and_then(Value::as_bool) != Some(true) {
            anyhow::bail!(
                "GitHub rejected the squash merge: {}",
                merged
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown reason")
            );
        }
        let merge_commit = merged
            .get("sha")
            .and_then(Value::as_str)
            .context("merged pull request has no merge commit SHA")?;
        *self.merged_commit.lock().await = Some(merge_commit.to_owned());
        if let Err(error) = self.publish_merged_statistics(&task).await {
            eprintln!(
                "Hive merged PR #{number}, but immediate statistics publication failed and will \
                 be retried during post-merge recovery: {error:#}"
            );
        }
        Ok(merged)
    }

    async fn acquire_merge_lock(&self) -> anyhow::Result<String> {
        for attempt in 0..2 {
            let main = self
                .api(
                    "GET",
                    &format!("/repos/{REPOSITORY}/git/ref/heads/main"),
                    None,
                )
                .await?;
            let main_sha = main
                .pointer("/object/sha")
                .and_then(Value::as_str)
                .context("main ref has no SHA")?;
            let commit = self
                .api(
                    "GET",
                    &format!("/repos/{REPOSITORY}/git/commits/{main_sha}"),
                    None,
                )
                .await?;
            let tree = commit
                .pointer("/tree/sha")
                .and_then(Value::as_str)
                .context("main commit has no tree SHA")?;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs();
            let lock_commit = self
                .api(
                    "POST",
                    &format!("/repos/{REPOSITORY}/git/commits"),
                    Some(json!({
                        "message": format!("Hive merge lock {now}"),
                        "tree": tree,
                        "parents": [main_sha],
                    })),
                )
                .await?;
            let lock_sha = lock_commit
                .get("sha")
                .and_then(Value::as_str)
                .context("merge-lock commit has no SHA")?;
            match self
                .api(
                    "POST",
                    &format!("/repos/{REPOSITORY}/git/refs"),
                    Some(json!({
                        "ref": "refs/heads/hive-merge-lock",
                        "sha": lock_sha,
                    })),
                )
                .await
            {
                Ok(_) => return Ok(lock_sha.to_owned()),
                Err(error) if attempt == 0 => {
                    if !self.clear_stale_merge_lock(now).await? {
                        return Err(error).context("another Hive task owns the merge lock");
                    }
                }
                Err(error) => return Err(error).context("acquire the Hive merge lock"),
            }
        }
        unreachable!("bounded merge-lock attempts return")
    }

    async fn clear_stale_merge_lock(&self, now: u64) -> anyhow::Result<bool> {
        let lock = self
            .api(
                "GET",
                &format!("/repos/{REPOSITORY}/git/ref/heads/hive-merge-lock"),
                None,
            )
            .await?;
        let lock_sha = lock
            .pointer("/object/sha")
            .and_then(Value::as_str)
            .context("merge lock has no SHA")?;
        let commit = self
            .api(
                "GET",
                &format!("/repos/{REPOSITORY}/git/commits/{lock_sha}"),
                None,
            )
            .await?;
        let timestamp = commit
            .get("message")
            .and_then(Value::as_str)
            .and_then(|message| message.strip_prefix("Hive merge lock "))
            .and_then(|value| value.parse::<u64>().ok());
        if timestamp.is_none_or(|timestamp| now.saturating_sub(timestamp) < 30 * 60) {
            return Ok(false);
        }
        self.api(
            "DELETE",
            &format!("/repos/{REPOSITORY}/git/refs/heads/hive-merge-lock"),
            None,
        )
        .await?;
        Ok(true)
    }

    async fn reply_thread(&self, thread_id: &str, body: &str) -> anyhow::Result<Value> {
        if !thread_id.starts_with("PRRT_") || body.trim().is_empty() {
            anyhow::bail!("a review thread id and non-empty reply are required");
        }
        self.require_bound_review_thread(thread_id).await?;
        self.api(
            "POST",
            "/graphql",
            Some(json!({
                "query": "mutation($thread:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$thread,body:$body}){comment{id url}}}",
                "variables": {
                    "thread": thread_id,
                    "body": format!(
                        "<!-- hive-thread-reply:{thread_id} -->\n{}",
                        body.trim()
                    ),
                },
            })),
        )
        .await
    }

    async fn reply_feedback(&self, feedback_id: &str, body: &str) -> anyhow::Result<Value> {
        if !valid_feedback_id(feedback_id) || body.trim().is_empty() {
            anyhow::bail!("a feedback id and non-empty reply are required");
        }
        let task = self.bound_task().await?;
        let pull = self.pull_for_branch(&task.branch).await?;
        let number = pull
            .get("number")
            .and_then(Value::as_u64)
            .context("pull request has no number")?;
        let reviews = self
            .paginated_api_array(&format!("/repos/{REPOSITORY}/pulls/{number}/reviews"))
            .await?;
        let comments = self
            .paginated_api_array(&format!("/repos/{REPOSITORY}/issues/{number}/comments"))
            .await?;
        if !review_feedback(&pull, &reviews, &comments)
            .iter()
            .any(|feedback| {
                feedback.get("id").and_then(Value::as_str) == Some(feedback_id)
                    && feedback.get("actionable").and_then(Value::as_bool) == Some(true)
            })
        {
            anyhow::bail!("feedback id does not identify actionable feedback on this pull request");
        }
        self.api(
            "POST",
            &format!("/repos/{REPOSITORY}/issues/{number}/comments"),
            Some(json!({
                "body": format!("<!-- hive-feedback:{feedback_id} -->\n{}", body.trim()),
            })),
        )
        .await
    }

    async fn resolve_thread(&self, thread_id: &str) -> anyhow::Result<Value> {
        if !thread_id.starts_with("PRRT_") {
            anyhow::bail!("a valid review thread id is required");
        }
        self.require_bound_review_thread(thread_id).await?;
        self.require_bound_thread_reply(thread_id).await?;
        self.api(
            "POST",
            "/graphql",
            Some(json!({
                "query": "mutation($thread:ID!){resolveReviewThread(input:{threadId:$thread}){thread{id isResolved}}}",
                "variables": { "thread": thread_id },
            })),
        )
        .await
    }

    async fn verify_main(&self, merge_commit: &str) -> anyhow::Result<Value> {
        if self.merged_commit.lock().await.as_deref() != Some(merge_commit) {
            anyhow::bail!("Main verification must target the merge produced by this task");
        }
        let task = self.bound_task().await?;
        if task.id.starts_with("main-failure-") {
            self.publish_merged_statistics(&task).await?;
        }
        let runs = self
            .api(
                "GET",
                &format!(
                    "/repos/{REPOSITORY}/actions/workflows/main.yml/runs?branch=main&event=push&per_page=20"
                ),
                None,
            )
            .await?;
        let workflow_runs = runs
            .get("workflow_runs")
            .and_then(Value::as_array)
            .context("GitHub Main workflow listing is invalid")?;
        let exact = workflow_runs
            .iter()
            .find(|run| run.get("head_sha").and_then(Value::as_str) == Some(merge_commit));
        if let Some(run) = exact {
            let status = run.get("status").and_then(Value::as_str);
            let conclusion = run.get("conclusion").and_then(Value::as_str);
            if status != Some("completed") || conclusion == Some("success") {
                if conclusion == Some("success") {
                    *self.verified_main.lock().await = true;
                    *self.verified_run.lock().await = Some(run.clone());
                }
                return Ok(main_run_result(run, merge_commit, false));
            }
            if !matches!(conclusion, Some("cancelled" | "skipped" | "neutral")) {
                return Ok(main_run_result(run, merge_commit, false));
            }
        }
        for run in workflow_runs.iter().filter(|run| {
            run.get("status").and_then(Value::as_str) == Some("completed")
                && run.get("conclusion").and_then(Value::as_str) == Some("success")
        }) {
            let Some(head_sha) = run.get("head_sha").and_then(Value::as_str) else {
                continue;
            };
            let comparison = self
                .api(
                    "GET",
                    &format!("/repos/{REPOSITORY}/compare/{merge_commit}...{head_sha}"),
                    None,
                )
                .await?;
            if matches!(
                comparison.get("status").and_then(Value::as_str),
                Some("ahead" | "identical")
            ) {
                *self.verified_main.lock().await = true;
                *self.verified_run.lock().await = Some(run.clone());
                return Ok(main_run_result(run, merge_commit, true));
            }
        }
        Ok(json!({
            "status": "pending",
            "reason": if exact.is_some() {
                "the exact Main run was coalesced; waiting for a successful descendant"
            } else {
                "Main run has not started"
            },
        }))
    }

    async fn completion_status(&self) -> anyhow::Result<Value> {
        if !*self.verified_main.lock().await {
            return Ok(json!({ "verified": false }));
        }
        let task = self.bound_task().await?;
        if task.id.starts_with("main-failure-") && !*self.workbench_completed.lock().await {
            self.complete_workbench(&task).await?;
            *self.workbench_completed.lock().await = true;
        }
        Ok(json!({
            "verified": true,
            "workbench_completed": *self.workbench_completed.lock().await,
        }))
    }

    async fn ensure_workbench_plan(&self, task: &BoundTask) -> anyhow::Result<()> {
        let issue_path = workbench_issue_path(task);
        let issue = self.workbench_contents(&issue_path).await?;
        let issue_body = decode_base64(
            issue
                .get("content")
                .and_then(Value::as_str)
                .context("Workbench issue has no content")?,
        )
        .await?;
        let plan_path = workbench_plan_path(task, &issue_body);
        match self.workbench_contents(&plan_path).await {
            Ok(_) => return Ok(()),
            Err(error) if format!("{error:#}").contains("status exit status: 22") => {}
            Err(error) => return Err(error),
        }
        let created_at = frontmatter_value(&issue_body, "created_at")
            .context("Workbench incident has no created_at timestamp")?;
        let content = format!(
            "---\n\
             title: Repair failed Main verification for {short}\n\
             feature: hive-isolated-agent-platform\n\
             issue: {issue_path}\n\
             started_at: {created_at}\n\
             agent: nook-hive\n\
             ---\n\n\
             # Repair failed Main verification for {short}\n\n\
             ## Interpreted request\n\n\
             Diagnose the recorded Main failure, deliver its root-cause repair through a \
             reviewed pull request, squash-merge it, and verify the resulting Main lineage.\n\n\
             ## Requirements\n\n\
             - Preserve the incident SHA and its durable Workbench evidence.\n\
             - Use repository Taskfile commands for formatting and validation.\n\
             - Address every actionable review surface before merge.\n\
             - Do not push directly to Main or expose worker credentials.\n\n\
             ## Constraints and exclusions\n\n\
             - Keep credentials behind the existing auth and publication brokers.\n\
             - Do not include raw workflow logs or private environment details in Workbench.\n\n\
             ## Initial plan\n\n\
             1. Inspect the failed workflow and reproduce the bounded failure.\n\
             2. Implement the smallest repair with behavior-focused regression coverage.\n\
             3. Publish and review an exact-head PR, then squash-merge it.\n\
             4. Verify successful Main delivery and close the Workbench lifecycle.\n\n\
             ## Completion evidence\n\n\
             A merged repair PR, successful Main run containing the merge, completed incident, \
             and linked worklog.\n\n\
             ## Safety review\n\n\
             This plan contains no credentials, raw logs, private data, local paths, or prompt \
             transcript.\n",
            short = &task.source_commit[..12],
        );
        self.put_workbench_file(
            &plan_path,
            &content,
            &format!("plan: start Main repair {}", &task.source_commit[..12]),
            None,
        )
        .await?;
        Ok(())
    }

    async fn complete_workbench(&self, task: &BoundTask) -> anyhow::Result<()> {
        let issue_path = workbench_issue_path(task);
        let issue = self.workbench_contents(&issue_path).await?;
        let issue_sha = issue
            .get("sha")
            .and_then(Value::as_str)
            .context("Workbench issue has no blob SHA")?;
        let mut issue_body = decode_base64(
            issue
                .get("content")
                .and_then(Value::as_str)
                .context("Workbench issue has no content")?,
        )
        .await?;
        let pulls = self.task_pulls(&publication_branch_name(&task.id)).await?;
        let pull = pulls
            .iter()
            .filter(|pull| pull.get("merged_at").is_some_and(|value| !value.is_null()))
            .max_by_key(|pull| pull.get("number").and_then(Value::as_u64).unwrap_or(0))
            .context("completed Main repair has no merged pull request")?;
        let pull_number = pull
            .get("number")
            .and_then(Value::as_u64)
            .context("merged repair has no pull-request number")?;
        let pull_url = pull
            .get("html_url")
            .and_then(Value::as_str)
            .context("merged repair has no URL")?;
        let merge_commit = self
            .merged_commit
            .lock()
            .await
            .clone()
            .context("completed Main repair has no merge commit")?;
        let verified_run = self
            .verified_run
            .lock()
            .await
            .clone()
            .context("completed Main repair has no verified Main run")?;
        let main_url = verified_run
            .get("html_url")
            .and_then(Value::as_str)
            .context("verified Main run has no URL")?;
        let finished_at = utc_timestamp().await?;
        let plan_path = workbench_plan_path(task, &issue_body);
        let worklog_path = format!(
            "worklogs/hive-isolated-agent-platform/main-failure-{}.md",
            task.source_commit
        );
        let worklog = format!(
            "---\n\
             title: Restore Main after {short}\n\
             feature: hive-isolated-agent-platform\n\
             issue: {issue_path}\n\
             plan: {plan_path}\n\
             nook_pr: {pull_number}\n\
             status: completed\n\
             started_at: {started_at}\n\
             finished_at: {finished_at}\n\
             agent: nook-hive\n\
             ---\n\n\
             # Restore Main after {short}\n\n\
             ## Outcome\n\n\
             Delivered the Main repair through [Nook PR #{pull_number}]({pull_url}) and verified \
             a successful Main run containing merge `{merge_commit}`.\n\n\
             ## Progress\n\n\
             - Diagnosed the recorded Main failure and implemented its bounded repair.\n\
             - Addressed review feedback and squash-merged the exact verified head.\n\
             - Verified successful Main delivery: {main_url}\n\n\
             ## Implementation problems\n\n\
             - See the incident progress and repair PR for preserved diagnostic details.\n\n\
             ## Decisions\n\n\
             - Kept the repair on the normal reviewed PR path; no direct Main push was used.\n\n\
             ## Validation\n\n\
             - Exact-head repository-owned checks on PR #{pull_number}.\n\
             - Successful Main workflow containing `{merge_commit}`.\n\n\
             ## Remaining work\n\n\
             None.\n",
            short = &task.source_commit[..12],
            started_at =
                frontmatter_value(&issue_body, "created_at").unwrap_or(finished_at.as_str()),
        );
        match self.workbench_contents(&worklog_path).await {
            Ok(_) => {}
            Err(error) if format!("{error:#}").contains("status exit status: 22") => {
                self.put_workbench_file(
                    &worklog_path,
                    &worklog,
                    &format!(
                        "worklog: complete Main repair {}",
                        &task.source_commit[..12]
                    ),
                    None,
                )
                .await?;
            }
            Err(error) => return Err(error),
        }
        self.publish_agent_statistics(task, pull, &finished_at)
            .await?;
        issue_body = replace_frontmatter(&issue_body, "status", "done")?;
        issue_body = replace_frontmatter(&issue_body, "owner", "nook-hive")?;
        issue_body = replace_frontmatter(&issue_body, "updated_at", &finished_at)?;
        issue_body = append_related_pr(&issue_body, pull_number)?;
        issue_body = issue_body.replace("- [ ]", "- [x]");
        if !issue_body.contains("<!-- hive-delivery-complete -->") {
            issue_body.push_str(&format!(
                "\n\n## Completion\n\n\
                 <!-- hive-delivery-complete -->\n\
                 - Repair PR: [#{pull_number}]({pull_url})\n\
                 - Merge commit: `{merge_commit}`\n\
                 - Verified Main run: {main_url}\n\
                 - Worklog: [{worklog_path}](../../{worklog_path})\n"
            ));
        }
        self.put_workbench_file(
            &issue_path,
            &issue_body,
            &format!("issue: complete Main repair {}", &task.source_commit[..12]),
            Some(issue_sha),
        )
        .await?;
        Ok(())
    }

    async fn publish_agent_statistics(
        &self,
        task: &BoundTask,
        pull: &Value,
        measured_at: &str,
    ) -> anyhow::Result<()> {
        let number = pull
            .get("number")
            .and_then(Value::as_u64)
            .context("merged repair has no pull-request number")?;
        let path = format!("stats/ai-agent/{number}.yaml");
        match self.workbench_contents(&path).await {
            Ok(_) => return Ok(()),
            Err(error) if format!("{error:#}").contains("status exit status: 22") => {}
            Err(error) => return Err(error),
        }
        let issue = self.workbench_contents(&workbench_issue_path(task)).await?;
        let issue_body = decode_base64(
            issue
                .get("content")
                .and_then(Value::as_str)
                .context("Workbench issue has no content")?,
        )
        .await?;
        let started_at = frontmatter_value(&issue_body, "created_at").unwrap_or(measured_at);
        let opened_at = pull
            .get("created_at")
            .and_then(Value::as_str)
            .context("merged repair has no created_at timestamp")?;
        let merged_at = pull
            .get("merged_at")
            .and_then(Value::as_str)
            .context("merged repair has no merged_at timestamp")?;
        let merge_commit = self
            .merged_commit
            .lock()
            .await
            .clone()
            .context("completed Main repair has no merge commit")?;
        let elapsed_seconds = timestamp_delta(started_at, merged_at).await?;
        let open_to_merge_seconds = timestamp_delta(opened_at, merged_at).await?;

        let runs = self
            .api(
                "GET",
                &format!(
                    "/repos/{REPOSITORY}/actions/runs?event=pull_request&branch={}&per_page=100",
                    task.branch
                ),
                None,
            )
            .await?;
        let mut action_records = Vec::new();
        for run in runs
            .get("workflow_runs")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[])
        {
            let applies = run
                .get("pull_requests")
                .and_then(Value::as_array)
                .is_some_and(|pulls| {
                    pulls.iter().any(|candidate| {
                        candidate.get("number").and_then(Value::as_u64) == Some(number)
                    })
                });
            if !applies {
                continue;
            }
            let run_started_at = run
                .get("run_started_at")
                .and_then(Value::as_str)
                .or_else(|| run.get("created_at").and_then(Value::as_str))
                .context("workflow run has no start timestamp")?;
            let finished_at = run
                .get("updated_at")
                .and_then(Value::as_str)
                .context("workflow run has no completion timestamp")?;
            action_records.push(json!({
                "workflow": run.get("name"),
                "run_id": run.get("id"),
                "run_attempt": run.get("run_attempt"),
                "head_sha": run.get("head_sha"),
                "trigger": run.get("event"),
                "started_at": run_started_at,
                "finished_at": finished_at,
                "duration_seconds": timestamp_delta(run_started_at, finished_at).await?,
                "conclusion": run.get("conclusion"),
            }));
        }
        action_records.sort_by_key(|run| {
            run.get("run_id")
                .and_then(Value::as_u64)
                .unwrap_or_default()
        });
        let github_actions_seconds = action_records
            .iter()
            .filter_map(|run| run.get("duration_seconds").and_then(Value::as_i64))
            .sum::<i64>();
        let retriggers = action_records
            .iter()
            .skip(1)
            .map(|run| {
                json!({
                    "at": run.get("started_at"),
                    "kind": if run.get("run_attempt").and_then(Value::as_u64).unwrap_or(1) > 1 {
                        "manual_rerun"
                    } else {
                        "head_push"
                    },
                    "run_id": run.get("run_id"),
                    "head_sha": run.get("head_sha"),
                })
            })
            .collect::<Vec<_>>();
        let local_executions = self.local_executions().await?;
        let local_execution_seconds = local_executions
            .iter()
            .map(|execution| execution.duration_seconds)
            .sum::<u64>();
        let local_check_count = local_executions
            .iter()
            .filter(|execution| execution.category == LocalExecutionCategory::Check)
            .count();
        let local_test_count = local_executions
            .iter()
            .filter(|execution| execution.category == LocalExecutionCategory::Test)
            .count();
        let local_combined_count = local_executions
            .iter()
            .filter(|execution| execution.category == LocalExecutionCategory::Combined)
            .count();
        let inventory = self.test_inventory().await?;
        let baseline_prs = self.statistics_baselines(number).await?;
        let record = json!({
            "schema_version": 3,
            "source_pr": {
                "number": number,
                "url": pull.get("html_url"),
                "title": pull.get("title"),
                "change_surface": "main_repair",
                "head_sha": merge_commit,
                "started_at": started_at,
                "opened_at": opened_at,
                "merged_at": merged_at,
                "elapsed_seconds": elapsed_seconds,
                "open_to_merge_seconds": open_to_merge_seconds,
            },
            "summary": {
                "local_execution_count": local_executions.len(),
                "local_check_count": local_check_count,
                "local_test_count": local_test_count,
                "local_combined_count": local_combined_count,
                "local_execution_seconds": local_execution_seconds,
                "github_actions_run_count": action_records.len(),
                "github_actions_seconds": github_actions_seconds,
                "pr_retrigger_count": retriggers.len(),
                "agent_requested_rerun_count": 0,
                "merge_attempt_count": 1,
            },
            "test_inventory": {
                "measured_at": measured_at,
                "head_sha": merge_commit,
                "by_type": inventory,
                "total": inventory.values().sum::<u64>(),
            },
            "local_executions": local_executions,
            "github_actions_runs": action_records,
            "cache_telemetry": {
                "totals": {
                    "job_count": 0,
                    "remote_backend_job_count": 0,
                    "direct_compile_job_count": 0,
                    "sccache_compile_requests": 0,
                    "sccache_cache_hits": 0,
                    "sccache_cache_misses": 0,
                    "sccache_hit_rate_percent": Value::Null,
                    "buildkit_completed_steps": 0,
                    "buildkit_cached_steps": 0,
                    "buildkit_cache_hit_rate_percent": Value::Null,
                },
                "jobs": [],
                "collection": {
                    "complete": false,
                    "warnings": ["cache_telemetry_artifacts_require_a_follow-up_collector"],
                },
            },
            "pr_retriggers": retriggers,
            "merge_attempts": [{
                "at": merged_at,
                "method": "squash",
                "outcome": "success",
                "reason": "readiness_passed",
            }],
            "comparison": {
                "baseline_prs": baseline_prs,
                "baseline_quality": "weak",
                "baseline_note": "The trusted broker selected the newest non-current Workbench records; automated change-surface comparability is not yet available.",
                "elapsed_seconds_change_percent": Value::Null,
                "local_execution_seconds_change_percent": Value::Null,
                "github_actions_seconds_change_percent": Value::Null,
                "test_inventory_total_change": Value::Null,
                "regression": false,
                "regression_reasons": [],
            },
            "waste_assessment": {
                "wasteful": true,
                "findings": [
                    "Cache artifacts are retained by Actions but are not yet decoded by the broker.",
                ],
                "required_actions": [
                    "Add cache-artifact decoding to Hive statistics collection.",
                ],
            },
        });
        self.put_workbench_file(
            &path,
            &format!("{}\n", serde_json::to_string_pretty(&record)?),
            &format!("stats: record Nook PR {number}"),
            None,
        )
        .await?;
        Ok(())
    }

    async fn publish_merged_statistics(&self, task: &BoundTask) -> anyhow::Result<()> {
        let pulls = self.task_pulls(&publication_branch_name(&task.id)).await?;
        let pull = pulls
            .iter()
            .filter(|pull| pull.get("merged_at").is_some_and(|value| !value.is_null()))
            .max_by_key(|pull| pull.get("number").and_then(Value::as_u64).unwrap_or(0))
            .context("Main repair has no merged pull request for statistics")?;
        let measured_at = utc_timestamp().await?;
        self.publish_agent_statistics(task, pull, &measured_at)
            .await
    }

    async fn local_executions(&self) -> anyhow::Result<Vec<LocalExecutionEvent>> {
        let path = self.source_workspace.join(".hive-local-executions.jsonl");
        let contents = match tokio::fs::read_to_string(&path).await {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("read local execution events {}", path.display()));
            }
        };
        contents
            .lines()
            .filter(|line| !line.trim().is_empty())
            .enumerate()
            .map(|(index, line)| {
                serde_json::from_str::<LocalExecutionEvent>(line).with_context(|| {
                    format!(
                        "decode local execution event {} from {}",
                        index + 1,
                        path.display()
                    )
                })
            })
            .collect()
    }

    async fn test_inventory(&self) -> anyhow::Result<std::collections::BTreeMap<String, u64>> {
        let mut inventory = std::collections::BTreeMap::new();
        inventory.insert(
            "rust".to_owned(),
            self.count_source_tests(
                r"#\[(?:tokio::)?test",
                &["nook-app/nook-core", "nook-app/nook-auth2"],
                &["*.rs"],
            )
            .await?,
        );
        inventory.insert(
            "preflight".to_owned(),
            self.count_source_tests(r"#\[(?:tokio::)?test", &["preflight"], &["*.rs"])
                .await?,
        );
        inventory.insert(
            "web_unit".to_owned(),
            self.count_source_tests(
                r"\b(?:it|test)\s*\(",
                &["nook-app/nook-web"],
                &["*.test.ts", "*.test.js"],
            )
            .await?,
        );
        inventory.insert(
            "e2e".to_owned(),
            self.count_source_tests(r"\btest\s*\(", &["nook-app/nook-web"], &["*.spec.ts"])
                .await?,
        );
        Ok(inventory)
    }

    async fn count_source_tests(
        &self,
        pattern: &str,
        paths: &[&str],
        globs: &[&str],
    ) -> anyhow::Result<u64> {
        let mut command = Command::new("rg");
        command.args(["--count-matches", "--no-messages"]);
        for glob in globs {
            command.args(["--glob", glob]);
        }
        command
            .arg(pattern)
            .args(paths)
            .current_dir(&self.workspace);
        let output = command.output().await?;
        if !output.status.success() && output.status.code() != Some(1) {
            anyhow::bail!("failed to count repository test inventory");
        }
        String::from_utf8(output.stdout)?
            .lines()
            .try_fold(0_u64, |total, line| {
                let count = line
                    .rsplit_once(':')
                    .context("invalid ripgrep count output")?
                    .1
                    .parse::<u64>()?;
                Ok(total + count)
            })
    }

    async fn statistics_baselines(&self, current: u64) -> anyhow::Result<Vec<u64>> {
        let listing = self.workbench_contents("stats/ai-agent").await?;
        let mut numbers = listing
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[])
            .iter()
            .filter_map(|entry| entry.get("name").and_then(Value::as_str))
            .filter_map(|name| name.strip_suffix(".yaml"))
            .filter_map(|name| name.parse::<u64>().ok())
            .filter(|number| *number != current)
            .collect::<Vec<_>>();
        numbers.sort_unstable();
        numbers.reverse();
        numbers.truncate(2);
        Ok(numbers)
    }

    async fn workbench_contents(&self, path: &str) -> anyhow::Result<Value> {
        self.api(
            "GET",
            &format!("/repos/meta-secret/nook-workbench/contents/{path}?ref=main"),
            None,
        )
        .await
    }

    async fn put_workbench_file(
        &self,
        path: &str,
        content: &str,
        message: &str,
        sha: Option<&str>,
    ) -> anyhow::Result<Value> {
        let mut body = json!({
            "message": message,
            "content": encode_base64(content).await?,
            "branch": "main",
        });
        if let Some(sha) = sha {
            body["sha"] = Value::String(sha.to_owned());
        }
        self.api(
            "PUT",
            &format!("/repos/meta-secret/nook-workbench/contents/{path}"),
            Some(body),
        )
        .await
    }

    async fn pull_for_branch(&self, branch: &str) -> anyhow::Result<Value> {
        let pulls = self.pulls_for_branch(branch, "open").await?;
        pulls
            .as_array()
            .and_then(|pulls| pulls.first())
            .cloned()
            .context("no open pull request exists for this Hive task")
    }

    async fn pulls_for_branch(&self, branch: &str, state: &str) -> anyhow::Result<Value> {
        self.api(
            "GET",
            &format!("/repos/{REPOSITORY}/pulls?state={state}&head=meta-secret:{branch}"),
            None,
        )
        .await
    }

    async fn task_pulls(&self, base_branch: &str) -> anyhow::Result<Vec<Value>> {
        let pulls = self
            .paginated_api_array(&format!("/repos/{REPOSITORY}/pulls?state=all"))
            .await?;
        Ok(pulls
            .as_array()
            .context("GitHub pull-request listing is invalid")?
            .iter()
            .filter(|pull| {
                pull.pointer("/head/ref")
                    .and_then(Value::as_str)
                    .is_some_and(|branch| {
                        publication_branch_generation(base_branch, branch).is_some()
                    })
            })
            .cloned()
            .collect())
    }

    async fn review_threads(&self, number: u64) -> anyhow::Result<Value> {
        let mut cursor: Option<String> = None;
        let mut threads = Vec::new();
        loop {
            let response = self
                .api(
                    "POST",
                    "/graphql",
                    Some(json!({
                        "query": "query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$after){nodes{id isResolved isOutdated comments(last:1){nodes{body url author{login}}}} pageInfo{hasNextPage endCursor}}}}}",
                        "variables": {
                            "owner": "meta-secret",
                            "name": "nook",
                            "number": number,
                            "after": cursor.as_deref(),
                        }
                    })),
                )
                .await?;
            if response.get("errors").is_some() {
                anyhow::bail!("GitHub rejected the review-thread query");
            }
            let page = response
                .pointer("/data/repository/pullRequest/reviewThreads")
                .context("GitHub review-thread response is invalid")?;
            threads.extend(
                page.get("nodes")
                    .and_then(Value::as_array)
                    .context("GitHub review-thread nodes are invalid")?
                    .iter()
                    .cloned(),
            );
            if page
                .pointer("/pageInfo/hasNextPage")
                .and_then(Value::as_bool)
                != Some(true)
            {
                break;
            }
            cursor = Some(
                page.pointer("/pageInfo/endCursor")
                    .and_then(Value::as_str)
                    .context("GitHub review-thread page has no end cursor")?
                    .to_owned(),
            );
        }
        Ok(Value::Array(threads))
    }

    async fn paginated_api_array(&self, path: &str) -> anyhow::Result<Value> {
        let mut values = Vec::new();
        for page in 1.. {
            let separator = if path.contains('?') { '&' } else { '?' };
            let response = self
                .api(
                    "GET",
                    &format!("{path}{separator}per_page=100&page={page}"),
                    None,
                )
                .await?;
            let page_values = response
                .as_array()
                .context("GitHub paginated response is not an array")?;
            values.extend(page_values.iter().cloned());
            if page_values.len() < 100 {
                break;
            }
        }
        Ok(Value::Array(values))
    }

    async fn paginated_api_object_array(
        &self,
        path: &str,
        key: &str,
    ) -> anyhow::Result<Vec<Value>> {
        let mut values = Vec::new();
        for page in 1.. {
            let separator = if path.contains('?') { '&' } else { '?' };
            let response = self
                .api(
                    "GET",
                    &format!("{path}{separator}per_page=100&page={page}"),
                    None,
                )
                .await?;
            let page_values = response
                .get(key)
                .and_then(Value::as_array)
                .with_context(|| format!("GitHub paginated response has no {key} array"))?;
            values.extend(page_values.iter().cloned());
            if page_values.len() < 100 {
                break;
            }
        }
        Ok(values)
    }

    async fn require_bound_review_thread(&self, thread_id: &str) -> anyhow::Result<()> {
        let task = self.bound_task().await?;
        let pull = self.pull_for_branch(&task.branch).await?;
        let number = pull
            .get("number")
            .and_then(Value::as_u64)
            .context("pull request has no number")?;
        let belongs = self
            .review_threads(number)
            .await?
            .as_array()
            .is_some_and(|threads| {
                threads
                    .iter()
                    .any(|thread| thread.get("id").and_then(Value::as_str) == Some(thread_id))
            });
        if !belongs {
            anyhow::bail!("review thread does not belong to this task's pull request");
        }
        Ok(())
    }

    async fn require_bound_thread_reply(&self, thread_id: &str) -> anyhow::Result<()> {
        let task = self.bound_task().await?;
        let pull = self.pull_for_branch(&task.branch).await?;
        let pull_author = pull
            .pointer("/user/login")
            .and_then(Value::as_str)
            .context("pull request has no author")?;
        let marker = format!("<!-- hive-thread-reply:{thread_id} -->");
        let mut cursor: Option<String> = None;
        loop {
            let response = self
                .api(
                    "POST",
                    "/graphql",
                    Some(json!({
                        "query": "query($thread:ID!,$after:String){node(id:$thread){... on PullRequestReviewThread{comments(first:100,after:$after){nodes{body author{login}} pageInfo{hasNextPage endCursor}}}}}",
                        "variables": {
                            "thread": thread_id,
                            "after": cursor.as_deref(),
                        }
                    })),
                )
                .await?;
            if response.get("errors").is_some() {
                anyhow::bail!("GitHub rejected the review-thread reply query");
            }
            let comments = response
                .pointer("/data/node/comments")
                .context("GitHub review-thread reply response is invalid")?;
            let has_reply = comments
                .get("nodes")
                .and_then(Value::as_array)
                .context("GitHub review-thread comments are invalid")?
                .iter()
                .any(|comment| {
                    comment.pointer("/author/login").and_then(Value::as_str) == Some(pull_author)
                        && comment
                            .get("body")
                            .and_then(Value::as_str)
                            .is_some_and(|body| body.contains(&marker))
                });
            if has_reply {
                return Ok(());
            }
            if comments
                .pointer("/pageInfo/hasNextPage")
                .and_then(Value::as_bool)
                != Some(true)
            {
                anyhow::bail!("review thread cannot be resolved before the task reply is visible");
            }
            cursor = Some(
                comments
                    .pointer("/pageInfo/endCursor")
                    .and_then(Value::as_str)
                    .context("GitHub review-thread reply page has no end cursor")?
                    .to_owned(),
            );
        }
    }

    async fn api(&self, method: &str, path: &str, body: Option<Value>) -> anyhow::Result<Value> {
        let token = tokio::fs::read_to_string(&self.token_path)
            .await
            .context("read broker-only GitHub token")?;
        let mut command = Command::new("curl");
        command.args([
            "--fail-with-body",
            "--silent",
            "--show-error",
            "--request",
            method,
            "--header",
            "Accept: application/vnd.github+json",
            "--header",
            "X-GitHub-Api-Version: 2022-11-28",
            "--header",
            &format!("Authorization: Bearer {}", token.trim()),
        ]);
        if let Some(body) = body {
            command
                .args([
                    "--header",
                    "Content-Type: application/json",
                    "--data-binary",
                ])
                .arg(body.to_string());
        }
        let output = command.arg(format!("{API_ROOT}{path}")).output().await?;
        if !output.status.success() {
            anyhow::bail!(
                "GitHub API request failed with status {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stdout)
            );
        }
        if output.stdout.is_empty() {
            Ok(Value::Null)
        } else {
            serde_json::from_slice(&output.stdout).context("decode GitHub API response")
        }
    }

    async fn prepare_publication_workspace(&self, task: &BoundTask) -> anyhow::Result<()> {
        tokio::fs::create_dir_all(&self.workspace).await?;
        if !self.workspace.join(".git").is_dir() {
            self.git(&["init", "--initial-branch=main", "."]).await?;
            self.git(&[
                "remote",
                "add",
                "origin",
                "https://github.com/meta-secret/nook.git",
            ])
            .await?;
        }
        self.git(&[
            "fetch",
            "--force",
            "--no-tags",
            "origin",
            &task.source_commit,
        ])
        .await?;
        let remote_branch = format!("refs/heads/{}", task.branch);
        let private_remote = "refs/remotes/origin/hive-publication";
        let fetch_branch = format!("+{remote_branch}:{private_remote}");
        if self
            .git_success(&["fetch", "--force", "--no-tags", "origin", &fetch_branch])
            .await?
        {
            self.git(&["checkout", "-B", &task.branch, private_remote])
                .await?;
        } else {
            self.git(&["checkout", "-B", &task.branch, &task.source_commit])
                .await?;
        }
        self.git(&["reset", "--hard", "HEAD"]).await?;
        self.git(&["clean", "-fdx"]).await?;

        let source = format!("{}/", self.source_workspace.join("repository").display());
        let destination = format!("{}/", self.workspace.display());
        let status = Command::new("rsync")
            .args([
                "--archive",
                "--delete",
                "--exclude=.git/",
                "--exclude=node_modules/",
                "--exclude=target/",
                "--exclude=dist/",
                "--exclude=.svelte-kit/",
                "--exclude=.wrangler/",
                &source,
                &destination,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .context("copy worker tree into broker-owned publication checkout")?;
        if !status.success() {
            anyhow::bail!("copy worker tree into broker-owned publication checkout failed");
        }
        Ok(())
    }

    async fn git(&self, arguments: &[&str]) -> anyhow::Result<()> {
        if !self.git_success(arguments).await? {
            anyhow::bail!("git {:?} failed", arguments);
        }
        Ok(())
    }

    async fn git_success(&self, arguments: &[&str]) -> anyhow::Result<bool> {
        let askpass = self.private_home.join("git-askpass");
        if !askpass.exists() {
            tokio::fs::write(
                &askpass,
                format!(
                    "#!/bin/sh\ncase \"$1\" in\n  *Username*) printf '%s\\n' x-access-token ;;\n  *Password*) cat '{}' ;;\nesac\n",
                    self.token_path.display()
                ),
            )
            .await?;
            let mut permissions = tokio::fs::metadata(&askpass).await?.permissions();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                permissions.set_mode(0o700);
            }
            tokio::fs::set_permissions(&askpass, permissions).await?;
        }
        let status = Command::new("git")
            .args([
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "core.fsmonitor=false",
                "-c",
                "credential.helper=",
                "-c",
                "protocol.ext.allow=never",
            ])
            .args(arguments)
            .current_dir(&self.workspace)
            .env("GIT_ASKPASS", &askpass)
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await?;
        Ok(status.success())
    }

    async fn git_output(&self, arguments: &[&str]) -> anyhow::Result<String> {
        let output = Command::new("git")
            .args([
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "core.fsmonitor=false",
                "-c",
                "credential.helper=",
                "-c",
                "protocol.ext.allow=never",
            ])
            .args(arguments)
            .current_dir(&self.workspace)
            .stdin(Stdio::null())
            .output()
            .await?;
        if !output.status.success() {
            anyhow::bail!("git {:?} failed", arguments);
        }
        String::from_utf8(output.stdout)
            .context("git output is not UTF-8")
            .map(|value| value.trim().to_owned())
    }
}

pub fn publication_branch_name(task_id: &str) -> String {
    let slug = task_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    format!("codex/hive-{}", slug.trim_matches('-'))
}

fn review_feedback(pull: &Value, reviews: &Value, comments: &Value) -> Vec<Value> {
    let comment_values = comments.as_array().map(Vec::as_slice).unwrap_or(&[]);
    let pull_author = pull.pointer("/user/login").and_then(Value::as_str);
    let addressed = comment_values
        .iter()
        .filter(|comment| comment.pointer("/user/login").and_then(Value::as_str) == pull_author)
        .filter_map(|comment| comment.get("body").and_then(Value::as_str))
        .filter_map(|body| body.split("<!-- hive-feedback:").nth(1))
        .filter_map(|suffix| suffix.split(" -->").next())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let current_head = pull.pointer("/head/sha").and_then(Value::as_str);
    let mut feedback = Vec::new();
    for review in reviews.as_array().map(Vec::as_slice).unwrap_or(&[]) {
        let Some(id) = review.get("id").and_then(Value::as_u64) else {
            continue;
        };
        let feedback_id = format!("review-{id}");
        let body = review.get("body").and_then(Value::as_str).unwrap_or("");
        let state = review.get("state").and_then(Value::as_str).unwrap_or("");
        let standard_codex_summary = body.contains("### 💡 Codex Review")
            && body.contains("Here are some automated review suggestions");
        let current = review.get("commit_id").and_then(Value::as_str) == current_head;
        let actionable = current
            && (state == "CHANGES_REQUESTED"
                || (state == "COMMENTED" && !body.trim().is_empty() && !standard_codex_summary));
        feedback.push(json!({
            "id": feedback_id,
            "kind": "review",
            "body": body,
            "url": review.get("html_url"),
            "author": review.pointer("/user/login"),
            "state": state,
            "current_head": current,
            "actionable": actionable,
            "addressed": !actionable || addressed.iter().any(|value| value == &feedback_id),
        }));
    }
    for comment in comment_values {
        let Some(id) = comment.get("id").and_then(Value::as_u64) else {
            continue;
        };
        let feedback_id = format!("comment-{id}");
        let body = comment.get("body").and_then(Value::as_str).unwrap_or("");
        let author = comment.pointer("/user/login").and_then(Value::as_str);
        let bookkeeping = author.is_some_and(|login| {
            matches!(login, "github-actions" | "github-actions[bot]") || Some(login) == pull_author
        });
        let actionable =
            !bookkeeping && !body.trim().is_empty() && !body.contains("<!-- hive-feedback:");
        feedback.push(json!({
            "id": feedback_id,
            "kind": "comment",
            "body": body,
            "url": comment.get("html_url"),
            "author": author,
            "actionable": actionable,
            "addressed": !actionable || addressed.iter().any(|value| value == &feedback_id),
        }));
    }
    feedback
}

async fn timestamp_delta(start: &str, finish: &str) -> anyhow::Result<i64> {
    async fn epoch(value: &str) -> anyhow::Result<i64> {
        let output = Command::new("date")
            .args(["--date", value, "+%s"])
            .output()
            .await
            .context("failed to parse statistics timestamp")?;
        if !output.status.success() {
            anyhow::bail!("invalid statistics timestamp");
        }
        String::from_utf8(output.stdout)?
            .trim()
            .parse::<i64>()
            .context("statistics timestamp is outside the supported range")
    }
    Ok((epoch(finish).await? - epoch(start).await?).max(0))
}

fn workbench_issue_path(task: &BoundTask) -> String {
    format!("issues/hive-isolated-agent-platform/{}.md", task.id)
}

fn workbench_plan_path(task: &BoundTask, issue_body: &str) -> String {
    let timestamp = frontmatter_value(issue_body, "created_at")
        .unwrap_or("unknown-time")
        .replace(':', "-");
    format!(
        "plans/hive-isolated-agent-platform/{timestamp}-main-repair-{}.md",
        &task.source_commit[..12]
    )
}

fn frontmatter_value<'a>(body: &'a str, field: &str) -> Option<&'a str> {
    body.lines()
        .find_map(|line| line.strip_prefix(&format!("{field}: ")))
        .map(str::trim)
}

fn replace_frontmatter(body: &str, field: &str, value: &str) -> anyhow::Result<String> {
    let prefix = format!("{field}: ");
    let mut replaced = false;
    let updated = body
        .lines()
        .map(|line| {
            if line.starts_with(&prefix) {
                replaced = true;
                format!("{prefix}{value}")
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    if !replaced {
        anyhow::bail!("Workbench incident is missing {field}");
    }
    Ok(updated)
}

fn append_related_pr(body: &str, pull_number: u64) -> anyhow::Result<String> {
    let current = frontmatter_value(body, "related_prs")
        .context("Workbench incident is missing related_prs")?;
    if current
        .trim_matches(['[', ']'])
        .split(',')
        .any(|value| value.trim() == pull_number.to_string())
    {
        return Ok(body.to_owned());
    }
    let mut values = current
        .trim_matches(['[', ']'])
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    values.push(pull_number.to_string());
    replace_frontmatter(body, "related_prs", &format!("[{}]", values.join(", ")))
}

async fn encode_base64(value: &str) -> anyhow::Result<String> {
    base64_command(&["-w", "0"], value).await
}

async fn decode_base64(value: &str) -> anyhow::Result<String> {
    base64_command(&["--decode"], value).await
}

async fn base64_command(arguments: &[&str], value: &str) -> anyhow::Result<String> {
    let mut child = Command::new("base64")
        .args(arguments)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .context("start base64 codec")?;
    child
        .stdin
        .take()
        .context("base64 stdin was unavailable")?
        .write_all(value.as_bytes())
        .await?;
    let output = child.wait_with_output().await?;
    if !output.status.success() {
        anyhow::bail!("base64 codec failed with status {}", output.status);
    }
    String::from_utf8(output.stdout).context("base64 output is not UTF-8")
}

async fn utc_timestamp() -> anyhow::Result<String> {
    let output = Command::new("date")
        .args(["-u", "+%Y-%m-%dT%H:%M:%SZ"])
        .output()
        .await?;
    if !output.status.success() {
        anyhow::bail!("UTC timestamp command failed with status {}", output.status);
    }
    String::from_utf8(output.stdout)
        .context("UTC timestamp is not UTF-8")
        .map(|value| value.trim().to_owned())
}

fn valid_feedback_id(value: &str) -> bool {
    ["review-", "comment-"].iter().any(|prefix| {
        value
            .strip_prefix(prefix)
            .is_some_and(|id| !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit()))
    })
}

fn main_run_result(run: &Value, merge_commit: &str, descendant: bool) -> Value {
    json!({
        "status": run.get("status"),
        "conclusion": run.get("conclusion"),
        "url": run.get("html_url"),
        "run_id": run.get("id"),
        "verified_merge_commit": merge_commit,
        "verified_by_descendant": descendant,
        "verified_head_sha": run.get("head_sha"),
    })
}

fn publication_branch_generation(base_branch: &str, branch: &str) -> Option<u64> {
    if branch == base_branch {
        return Some(1);
    }
    branch
        .strip_prefix(&format!("{base_branch}-g"))
        .and_then(|generation| generation.parse().ok())
        .filter(|generation| *generation >= 2)
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::{
        publication_branch_generation, publication_branch_name, review_feedback, valid_feedback_id,
    };

    #[test]
    fn task_branch_is_deterministic_and_namespaced() {
        assert_eq!(
            publication_branch_name("main-failure-ABC_123"),
            "codex/hive-main-failure-abc-123"
        );
    }

    #[test]
    fn task_branch_generations_are_recoverable() {
        let base = "codex/hive-main-failure-abc-123";
        assert_eq!(publication_branch_generation(base, base), Some(1));
        assert_eq!(
            publication_branch_generation(base, "codex/hive-main-failure-abc-123-g2"),
            Some(2)
        );
        assert_eq!(
            publication_branch_generation(base, "codex/hive-main-failure-abc-123-other"),
            None
        );
    }

    #[test]
    fn actionable_top_level_feedback_requires_a_targeted_reply() {
        let pull = json!({
            "user": {"login": "nook-hive"},
            "head": {"sha": "current-head"}
        });
        let reviews = json!([{
            "id": 42,
            "state": "CHANGES_REQUESTED",
            "commit_id": "current-head",
            "body": "Please cover the recovery path.",
            "user": {"login": "reviewer"}
        }]);
        let comments = json!([{
            "id": 7,
            "body": "Also keep the cache read-only.",
            "user": {"login": "reviewer"}
        }]);
        let feedback = review_feedback(&pull, &reviews, &comments);
        assert!(
            feedback
                .iter()
                .filter(|item| item.get("actionable").and_then(Value::as_bool) == Some(true))
                .all(|item| item.get("addressed").and_then(Value::as_bool) == Some(false))
        );

        let comments = json!([
            {
                "id": 7,
                "body": "Also keep the cache read-only.",
                "user": {"login": "reviewer"}
            },
            {
                "id": 8,
                "body": "<!-- hive-feedback:review-42 -->\nSpoofed marker.",
                "user": {"login": "untrusted-commenter"}
            }
        ]);
        assert!(
            review_feedback(&pull, &reviews, &comments)
                .iter()
                .filter(|item| item.get("id").and_then(Value::as_str) == Some("review-42"))
                .all(|item| item.get("addressed").and_then(Value::as_bool) == Some(false))
        );

        let comments = json!([
            {
                "id": 7,
                "body": "Also keep the cache read-only.",
                "user": {"login": "reviewer"}
            },
            {
                "id": 9,
                "body": "<!-- hive-feedback:review-42 -->\nFixed with a recovery test.",
                "user": {"login": "nook-hive"}
            },
            {
                "id": 10,
                "body": "<!-- hive-feedback:comment-7 -->\nConfirmed read-only.",
                "user": {"login": "nook-hive"}
            }
        ]);
        assert!(
            review_feedback(&pull, &reviews, &comments)
                .iter()
                .all(|item| item.get("addressed").and_then(Value::as_bool) == Some(true))
        );
        assert!(valid_feedback_id("review-42"));
        assert!(!valid_feedback_id("review-not-a-number"));
    }

    #[test]
    fn review_bodies_from_older_heads_are_audit_context_only() {
        let pull = json!({
            "user": {"login": "nook-hive"},
            "head": {"sha": "current-head"}
        });
        let reviews = json!([{
            "id": 43,
            "state": "CHANGES_REQUESTED",
            "commit_id": "older-head",
            "body": "This was actionable before the repair changed.",
            "user": {"login": "reviewer"}
        }]);
        let feedback = review_feedback(&pull, &reviews, &json!([]));
        assert_eq!(
            feedback[0].get("actionable").and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn automated_reviewer_comments_remain_actionable() {
        let pull = json!({
            "user": {"login": "nook-hive"},
            "head": {"sha": "current-head"}
        });
        let comments = json!([
            {
                "id": 11,
                "body": "Please repair this security boundary.",
                "user": {"login": "security-reviewer[bot]"}
            },
            {
                "id": 12,
                "body": "Automated workflow bookkeeping.",
                "user": {"login": "github-actions[bot]"}
            }
        ]);
        let feedback = review_feedback(&pull, &json!([]), &comments);

        assert_eq!(
            feedback[0].get("actionable").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            feedback[1].get("actionable").and_then(Value::as_bool),
            Some(false)
        );
    }
}
