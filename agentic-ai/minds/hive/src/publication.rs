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
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum GitHubRequest {
    Bind {
        task_id: String,
        source_commit: String,
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
    workspace: PathBuf,
    token_path: PathBuf,
    private_home: PathBuf,
}

pub async fn bind_publication_task(socket: &Path, task: &ClaimedTask) -> anyhow::Result<()> {
    let response = request(
        socket,
        &GitHubRequest::Bind {
            task_id: task.id.to_string(),
            source_commit: task.source_commit.clone(),
        },
    )
    .await?;
    if !response.get("branch").is_some_and(Value::is_string) {
        anyhow::bail!("publication broker returned an invalid bind response");
    }
    Ok(())
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
        workspace,
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
            } => self.bind(task_id, source_commit).await,
            GitHubRequest::Publish { title, body } => self.publish(&title, &body).await,
            GitHubRequest::Inspect => self.inspect().await,
            GitHubRequest::ReplyThread { thread_id, body } => {
                self.reply_thread(&thread_id, &body).await
            }
            GitHubRequest::ResolveThread { thread_id } => self.resolve_thread(&thread_id).await,
            GitHubRequest::Merge { expected_head } => self.merge(&expected_head).await,
            GitHubRequest::VerifyMain { merge_commit } => self.verify_main(&merge_commit).await,
            GitHubRequest::CompletionStatus => {
                Ok(json!({ "verified": *self.verified_main.lock().await }))
            }
        }
    }

    async fn bind(&self, task_id: String, source_commit: String) -> anyhow::Result<Value> {
        if source_commit.len() != 40 || !source_commit.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            anyhow::bail!("publication source commit is invalid");
        }
        let candidate = BoundTask {
            branch: publication_branch_name(&task_id),
            id: task_id,
            source_commit: source_commit.to_ascii_lowercase(),
        };
        {
            let mut task = self.task.lock().await;
            if let Some(existing) = task.as_ref() {
                if existing.id != candidate.id || existing.source_commit != candidate.source_commit
                {
                    anyhow::bail!("publication broker is already bound to another task");
                }
            } else {
                *task = Some(candidate.clone());
            }
        }
        let recovered_merge_commit = self
            .pulls_for_branch(&candidate.branch, "all")
            .await?
            .as_array()
            .and_then(|pulls| pulls.first())
            .filter(|pull| pull.get("merged_at").is_some_and(|value| !value.is_null()))
            .and_then(|pull| pull.get("merge_commit_sha"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        if let Some(merge_commit) = recovered_merge_commit.as_ref() {
            *self.merged_commit.lock().await = Some(merge_commit.clone());
        }
        Ok(json!({
            "branch": candidate.branch,
            "merge_commit": recovered_merge_commit,
        }))
    }

    async fn bound_task(&self) -> anyhow::Result<BoundTask> {
        self.task
            .lock()
            .await
            .clone()
            .context("publication broker is not bound to a claimed task")
    }

    async fn publish(&self, title: &str, body: &str) -> anyhow::Result<Value> {
        let task = self.bound_task().await?;
        if title.trim().is_empty() || body.trim().is_empty() {
            anyhow::bail!("pull request title and body are required");
        }
        self.git(&["checkout", "-B", &task.branch]).await?;
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

        let existing = self.pulls_for_branch(&task.branch, "all").await?;
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
            .api(
                "GET",
                &format!("/repos/{REPOSITORY}/commits/{head}/check-runs?per_page=100"),
                None,
            )
            .await?;
        let reviews = self
            .api(
                "GET",
                &format!("/repos/{REPOSITORY}/pulls/{number}/reviews?per_page=100"),
                None,
            )
            .await?;
        let review_threads = self.review_threads(number).await?;
        Ok(json!({
            "pull_request": number,
            "url": pull.get("html_url"),
            "state": pull.get("state"),
            "draft": pull.get("draft"),
            "mergeable": pull.get("mergeable"),
            "mergeable_state": pull.get("mergeable_state"),
            "head_sha": head,
            "checks": checks.get("check_runs"),
            "reviews": reviews,
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
            (Ok(_), Err(error)) => Err(error).context(format!(
                "merged successfully but failed to release merge lock {lock}"
            )),
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
        if pull.pointer("/base/sha").and_then(Value::as_str)
            != main.pointer("/object/sha").and_then(Value::as_str)
        {
            anyhow::bail!("Main moved; update the repair branch and rerun exact-head checks");
        }
        let checks = self
            .api(
                "GET",
                &format!("/repos/{REPOSITORY}/commits/{head}/check-runs?per_page=100"),
                None,
            )
            .await?;
        let check_runs = checks
            .get("check_runs")
            .and_then(Value::as_array)
            .context("GitHub check-runs response is invalid")?;
        if check_runs.is_empty()
            || check_runs.iter().any(|check| {
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
                threads
                    .iter()
                    .any(|thread| thread.get("isResolved").and_then(Value::as_bool) != Some(true))
            });
        if unresolved {
            anyhow::bail!("pull request still has unresolved review threads");
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
        self.api(
            "POST",
            "/graphql",
            Some(json!({
                "query": "mutation($thread:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$thread,body:$body}){comment{id url}}}",
                "variables": { "thread": thread_id, "body": body },
            })),
        )
        .await
    }

    async fn resolve_thread(&self, thread_id: &str) -> anyhow::Result<Value> {
        if !thread_id.starts_with("PRRT_") {
            anyhow::bail!("a valid review thread id is required");
        }
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
        let runs = self
            .api(
                "GET",
                &format!(
                    "/repos/{REPOSITORY}/actions/workflows/main.yml/runs?branch=main&event=push&per_page=20"
                ),
                None,
            )
            .await?;
        let Some(run) = runs
            .get("workflow_runs")
            .and_then(Value::as_array)
            .and_then(|runs| {
                runs.iter()
                    .find(|run| run.get("head_sha").and_then(Value::as_str) == Some(merge_commit))
            })
        else {
            return Ok(json!({ "status": "pending", "reason": "Main run has not started" }));
        };
        let result = json!({
            "status": run.get("status"),
            "conclusion": run.get("conclusion"),
            "url": run.get("html_url"),
            "run_id": run.get("id"),
        });
        if run.get("status").and_then(Value::as_str) == Some("completed")
            && run.get("conclusion").and_then(Value::as_str) == Some("success")
        {
            *self.verified_main.lock().await = true;
        }
        Ok(result)
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

    async fn review_threads(&self, number: u64) -> anyhow::Result<Value> {
        let response = self
            .api(
                "POST",
                "/graphql",
                Some(json!({
                    "query": "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved comments(last:1){nodes{body url author{login}}}}}}}}",
                    "variables": {
                        "owner": "meta-secret",
                        "name": "nook",
                        "number": number,
                    }
                })),
            )
            .await?;
        if response.get("errors").is_some() {
            anyhow::bail!("GitHub rejected the review-thread query");
        }
        response
            .pointer("/data/repository/pullRequest/reviewThreads/nodes")
            .cloned()
            .context("GitHub review-thread response is invalid")
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
            .args(arguments)
            .current_dir(self.workspace.join("repository"))
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
            .args(arguments)
            .current_dir(self.workspace.join("repository"))
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

#[cfg(test)]
mod tests {
    use super::publication_branch_name;

    #[test]
    fn task_branch_is_deterministic_and_namespaced() {
        assert_eq!(
            publication_branch_name("main-failure-ABC_123"),
            "codex/hive-main-failure-abc-123"
        );
    }
}
