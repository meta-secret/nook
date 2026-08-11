use super::*;

pub(super) async fn heartbeat_loop<S: TaskStore>(
    store: S,
    agent_id: AgentId,
    task: ClaimedTask,
    lease_seconds: i64,
    heartbeat_seconds: u64,
    mut stop: watch::Receiver<bool>,
) -> crate::HiveResult<()> {
    let mut interval = tokio::time::interval(Duration::from_secs(heartbeat_seconds));
    let mut renewal = 0_u64;
    interval.tick().await;
    loop {
        tokio::select! {
            changed = stop.changed() => {
                if changed.is_err() || *stop.borrow() {
                    return Ok(());
                }
            }
            _ = interval.tick() => {
                let accepted = store
                    .heartbeat(
                        &task.id,
                        &agent_id,
                        &task.lease_token,
                        lease_seconds,
                    )
                    .await?;
                if !accepted {
                    return Err(WorkerCancellationRequested.into());
                }
                renewal += 1;
                eprintln!(
                    "Hive lease heartbeat accepted task={} renewal={renewal}",
                    task.id
                );
            }
        }
    }
}

pub(super) async fn prepare_workspace(
    workspace: &Path,
    repository_url: &str,
    source_commit: &str,
    resume_branch: Option<&str>,
    dependency_artifacts: &[Artifact],
) -> crate::HiveResult<WorkspacePreparation> {
    tokio::fs::create_dir_all(workspace.join("task")).await?;
    tokio::fs::create_dir_all(workspace.join("output")).await?;
    tokio::fs::create_dir_all(workspace.join("temporary")).await?;
    let repository = workspace.join("repository");
    if repository.join(".git").is_dir() {
        return Err(crate::error::HiveError::message(
            "refusing to reuse a repository left by an earlier worker process",
        ));
    }
    tokio::fs::create_dir_all(&repository).await?;
    let status = Command::new("git")
        .arg("init")
        .arg("--quiet")
        .arg(&repository)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .await
        .hive_context("failed to initialize the task repository")?;
    if !status.success() {
        return Err(crate::error::HiveError::message(format!(
            "git init failed with status {status}"
        )));
    }
    run_git_status(
        &repository,
        &["remote", "add", "origin", repository_url],
        "configure the task repository remote",
    )
    .await?;
    run_git_status(
        &repository,
        &["fetch", "--depth=1", "origin", source_commit],
        "fetch the pinned task revision",
    )
    .await?;
    let mut did_resume = false;
    if let Some(branch) = resume_branch {
        let resumed = Command::new("git")
            .args([
                "fetch",
                "--depth=100",
                "origin",
                &format!("refs/heads/{branch}"),
            ])
            .current_dir(&repository)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await?;
        if resumed.success() {
            run_git_status(
                &repository,
                &["checkout", "--quiet", "-B", branch, "FETCH_HEAD"],
                "resume the durable Hive repair branch",
            )
            .await?;
            run_git_status(
                &repository,
                &["merge-base", "--is-ancestor", source_commit, "HEAD"],
                "verify the repair branch descends from its pinned revision",
            )
            .await?;
            did_resume = true;
        }
    }
    if !did_resume {
        run_git_status(
            &repository,
            &["checkout", "--quiet", "--detach", source_commit],
            "check out the pinned task revision",
        )
        .await?;
    }
    validate_dependency_artifacts(dependency_artifacts)?;
    let mut applied_dependency = false;
    for (index, artifact) in dependency_artifacts.iter().enumerate() {
        if did_resume && patch_is_already_applied(&repository, artifact).await? {
            continue;
        }
        let mut child = Command::new("git")
            .args(["apply", "--3way", "--index", "--binary", "-"])
            .current_dir(&repository)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .hive_context("failed to apply a dependency artifact")?;
        child
            .stdin
            .take()
            .hive_context("dependency patch stdin was unavailable")?
            .write_all(artifact.content.as_bytes())
            .await
            .hive_context("failed to stream a dependency patch")?;
        let status = child
            .wait()
            .await
            .hive_context("dependency patch process failed")?;
        if !status.success() {
            let unmerged = git_output(&repository, &["diff", "--name-only", "--diff-filter=U"])
                .await
                .hive_context("inspect dependency conflicts")?;
            if unmerged.trim().is_empty() {
                return Err(crate::error::HiveError::message(format!(
                    "dependency artifact {} failed to apply with status {status}",
                    artifact.id
                )));
            }
            let pending = repository.join(".hive-pending");
            tokio::fs::create_dir(&pending).await?;
            for (pending_index, pending_artifact) in
                dependency_artifacts.iter().enumerate().skip(index + 1)
            {
                tokio::fs::write(
                    pending.join(format!("{pending_index:04}.patch")),
                    pending_artifact.content.as_bytes(),
                )
                .await?;
            }
            return Ok(WorkspacePreparation {
                baseline: String::new(),
                conflicted: true,
                resumed: did_resume,
            });
        }
        applied_dependency = true;
    }
    if applied_dependency {
        let baseline = commit_dependency_baseline(&repository).await?;
        return Ok(WorkspacePreparation {
            baseline,
            conflicted: false,
            resumed: did_resume,
        });
    }
    Ok(WorkspacePreparation {
        baseline: git_output(&repository, &["rev-parse", "HEAD"]).await?,
        conflicted: false,
        resumed: did_resume,
    })
}

pub(super) fn validate_dependency_artifacts(
    dependency_artifacts: &[Artifact],
) -> crate::HiveResult<()> {
    for artifact in dependency_artifacts {
        if artifact.kind != "git-patch" {
            return Err(crate::error::HiveError::message(format!(
                "dependency artifact {} has unsupported kind {}",
                artifact.id, artifact.kind
            )));
        }
        let digest = Sha256::digest(artifact.content.as_bytes());
        let digest = format!(
            "sha256:{}",
            digest.iter().fold(
                String::with_capacity(digest.len() * 2),
                |mut encoded, byte| {
                    let _ = write!(encoded, "{byte:02x}");
                    encoded
                },
            )
        );
        if digest != artifact.digest {
            return Err(crate::error::HiveError::message(format!(
                "dependency artifact {} failed digest verification",
                artifact.id
            )));
        }
    }
    Ok(())
}

pub(super) async fn patch_is_already_applied(
    repository: &Path,
    artifact: &Artifact,
) -> crate::HiveResult<bool> {
    let mut child = Command::new("git")
        .args(["apply", "--reverse", "--check", "--binary", "-"])
        .current_dir(repository)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .hive_context("failed to inspect a resumed dependency artifact")?;
    child
        .stdin
        .take()
        .hive_context("dependency reverse-check stdin was unavailable")?
        .write_all(artifact.content.as_bytes())
        .await
        .hive_context("failed to stream a dependency reverse check")?;
    Ok(child
        .wait()
        .await
        .hive_context("dependency reverse-check process failed")?
        .success())
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct WorkspacePreparation {
    pub(super) baseline: String,
    pub(super) conflicted: bool,
    pub(super) resumed: bool,
}

pub(super) async fn ensure_dependencies_resolved(repository: &Path) -> crate::HiveResult<()> {
    let unmerged = git_output(repository, &["diff", "--name-only", "--diff-filter=U"]).await?;
    if !unmerged.trim().is_empty() {
        return Err(crate::error::HiveError::message(
            "dependency integration left unresolved Git conflicts",
        ));
    }
    if repository.join(".hive-pending").exists() {
        return Err(crate::error::HiveError::message(
            "dependency integration did not apply every pending patch",
        ));
    }
    Ok(())
}

pub(super) async fn commit_dependency_baseline(repository: &Path) -> crate::HiveResult<String> {
    run_git_status(
        repository,
        &["add", "--all", "--", "."],
        "stage dependency artifacts",
    )
    .await?;
    run_git_status(
        repository,
        &[
            "-c",
            "user.name=Hive",
            "-c",
            "user.email=hive@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "Apply completed Hive dependencies",
        ],
        "commit dependency artifact baseline",
    )
    .await?;
    git_output(repository, &["rev-parse", "HEAD"]).await
}

pub(super) async fn git_output(repository: &Path, arguments: &[&str]) -> crate::HiveResult<String> {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(repository)
        .stdin(Stdio::null())
        .output()
        .await
        .hive_context("failed to execute git")?;
    if !output.status.success() {
        return Err(crate::error::HiveError::message(format!(
            "git {:?} failed with status {}",
            arguments, output.status
        )));
    }
    String::from_utf8(output.stdout)
        .hive_context("git output is not UTF-8")
        .map(|value| value.trim().to_owned())
}

pub(super) async fn run_git_status(
    repository: &Path,
    arguments: &[&str],
    operation: &str,
) -> crate::HiveResult<()> {
    let status = Command::new("git")
        .args(arguments)
        .current_dir(repository)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .status()
        .await
        .with_hive_context(|| format!("failed to {operation}"))?;
    if !status.success() {
        return Err(crate::error::HiveError::message(format!(
            "{operation} failed with status {status}"
        )));
    }
    Ok(())
}

pub(super) async fn persistable_patch(
    repository: &Path,
    baseline: &str,
    task: &ClaimedTask,
    result: &TerminalResult,
    resumed: bool,
) -> crate::HiveResult<CompletionArtifact> {
    let add_status = Command::new("git")
        .args(["add", "--intent-to-add", "--", "."])
        .current_dir(repository)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .hive_context("failed to stage untracked files for patch persistence")?;
    if !add_status.success() {
        return Err(crate::error::HiveError::message(format!(
            "git add --intent-to-add failed with status {add_status}"
        )));
    }

    let output = Command::new("git")
        .args(["diff", "--binary", "--no-ext-diff", baseline, "--", "."])
        .current_dir(repository)
        .stdin(Stdio::null())
        .output()
        .await
        .hive_context("failed to collect the durable task patch")?;
    if !output.status.success() {
        return Err(crate::error::HiveError::message(format!(
            "git diff failed with status {}",
            output.status
        )));
    }
    if output.stdout.len() > MAX_PERSISTED_PATCH_BYTES {
        return Err(crate::error::HiveError::message(format!(
            "task patch exceeds the {} byte prototype limit",
            MAX_PERSISTED_PATCH_BYTES
        )));
    }
    if output.stdout.is_empty() {
        if !resumed && !result.changed_files().is_empty() {
            return Err(crate::error::HiveError::message(
                "Codex reported changed files but produced no persistable git patch",
            ));
        }
        return Ok(CompletionArtifact::NotProduced);
    }

    let content = String::from_utf8(output.stdout).hive_context("task patch is not UTF-8")?;
    let digest = Sha256::digest(content.as_bytes());
    let digest = digest.iter().fold(
        String::with_capacity(digest.len() * 2),
        |mut encoded, byte| {
            let _ = write!(encoded, "{byte:02x}");
            encoded
        },
    );
    let id = format!("{}:git-patch", task.attempt_id);
    Ok(CompletionArtifact::Produced(Artifact {
        uri: format!("hive://artifact/{id}"),
        id,
        kind: "git-patch".to_owned(),
        digest: format!("sha256:{digest}"),
        content,
    }))
}

#[cfg(test)]
mod tests {
    use std::fmt::Write as _;

    use super::{persistable_patch, prepare_workspace, validate_dependency_artifacts};
    use crate::model::{
        Artifact, AttemptId, ClaimedTask, CompletionArtifact, LeaseToken, TaskId, TerminalResult,
    };
    use sha2::{Digest, Sha256};

    #[test]
    fn every_dependency_artifact_is_verified_before_application() -> anyhow::Result<()> {
        let valid_content = "valid patch";
        let valid_digest = Sha256::digest(valid_content.as_bytes());
        let valid_digest = valid_digest.iter().fold(
            String::with_capacity(valid_digest.len() * 2),
            |mut encoded, byte| {
                let _ = write!(encoded, "{byte:02x}");
                encoded
            },
        );
        let artifacts = vec![
            Artifact {
                id: "first".to_owned(),
                kind: "git-patch".to_owned(),
                uri: "hive://artifact/first".to_owned(),
                digest: format!("sha256:{valid_digest}"),
                content: valid_content.to_owned(),
            },
            Artifact {
                id: "later-corrupt".to_owned(),
                kind: "git-patch".to_owned(),
                uri: "hive://artifact/later-corrupt".to_owned(),
                digest: "sha256:not-the-content-digest".to_owned(),
                content: "substituted patch".to_owned(),
            },
        ];

        let error = validate_dependency_artifacts(&artifacts)
            .err()
            .ok_or_else(|| {
                crate::error::HiveError::message(
                    "a corrupt later patch must fail before the first patch is applied",
                )
            })?;
        assert!(error.to_string().contains("later-corrupt"));
        Ok(())
    }

    #[tokio::test]
    async fn implementation_patch_is_durable_before_completion() -> crate::HiveResult<()> {
        let _git_process_guard = crate::GIT_PROCESS_TEST_LOCK.lock().await;
        let repository = tempfile::tempdir()?;
        let run_git = |arguments: &[&str]| -> std::io::Result<()> {
            let status = std::process::Command::new("git")
                .args(arguments)
                .current_dir(repository.path())
                .status()?;
            assert!(status.success());
            Ok(())
        };
        run_git(&["init", "--quiet"])?;
        std::fs::write(repository.path().join("tracked.txt"), "before\n")?;
        run_git(&["add", "tracked.txt"])?;
        run_git(&[
            "-c",
            "user.name=Hive Test",
            "-c",
            "user.email=hive@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "fixture",
        ])?;
        std::fs::write(repository.path().join("tracked.txt"), "after\n")?;
        std::fs::write(repository.path().join("new.txt"), "new\n")?;

        let baseline = std::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(repository.path())
            .output()?;
        let baseline = String::from_utf8(baseline.stdout)?;
        let baseline = baseline.trim();
        std::fs::write(repository.path().join("committed.txt"), "committed\n")?;
        run_git(&["add", "committed.txt"])?;
        run_git(&[
            "-c",
            "user.name=Hive Test",
            "-c",
            "user.email=hive@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "task commit",
        ])?;
        std::fs::write(repository.path().join("tracked.txt"), "after\n")?;
        run_git(&["add", "tracked.txt"])?;
        std::fs::write(repository.path().join("new.txt"), "new\n")?;

        let task = ClaimedTask {
            id: TaskId::new("task-1")?,
            kind: "code".to_owned(),
            prompt: "change files".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            attempt_id: AttemptId::new("attempt-1")?,
            attempt_number: 1,
            lease_token: LeaseToken::new("lease-1")?,
            owning_repairs: Vec::new(),
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };
        let result = TerminalResult::Completed {
            summary: "changed files".to_owned(),
            changed_files: vec!["tracked.txt".to_owned(), "new.txt".to_owned()],
            tests: Vec::new(),
            obsolete: false,
        };

        let artifact =
            persistable_patch(repository.path(), baseline, &task, &result, false).await?;
        let CompletionArtifact::Produced(artifact) = artifact else {
            return Err(crate::error::HiveError::message(
                "patch artifact must be produced",
            ));
        };

        assert_eq!(artifact.kind, "git-patch");
        assert!(artifact.digest.starts_with("sha256:"));
        assert!(artifact.content.contains("diff --git a/tracked.txt"));
        assert!(artifact.content.contains("diff --git a/new.txt"));
        assert!(artifact.content.contains("diff --git a/committed.txt"));
        Ok(())
    }

    #[tokio::test]
    async fn completed_dependency_patch_becomes_the_task_baseline() -> crate::HiveResult<()> {
        let _git_process_guard = crate::GIT_PROCESS_TEST_LOCK.lock().await;
        let source = tempfile::tempdir()?;
        let run_git = |arguments: &[&str]| -> std::io::Result<Vec<u8>> {
            let output = std::process::Command::new("git")
                .args(arguments)
                .current_dir(source.path())
                .output()?;
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            Ok(output.stdout)
        };
        run_git(&["init", "--quiet"])?;
        std::fs::write(source.path().join("dependency.txt"), "before\n")?;
        run_git(&["add", "dependency.txt"])?;
        run_git(&[
            "-c",
            "user.name=Hive Test",
            "-c",
            "user.email=hive@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "fixture",
        ])?;
        let source_commit = String::from_utf8(run_git(&["rev-parse", "HEAD"])?)?
            .trim()
            .to_owned();
        std::fs::write(source.path().join("dependency.txt"), "from dependency\n")?;
        let patch = String::from_utf8(run_git(&["diff", "--binary"])?)?;
        std::fs::write(source.path().join("dependency.txt"), "before\n")?;
        let digest = Sha256::digest(patch.as_bytes());
        let digest = digest.iter().fold(
            String::with_capacity(digest.len() * 2),
            |mut encoded, byte| {
                let _ = write!(encoded, "{byte:02x}");
                encoded
            },
        );
        let dependency = Artifact {
            id: "dependency:git-patch".to_owned(),
            kind: "git-patch".to_owned(),
            uri: "hive://artifact/dependency:git-patch".to_owned(),
            digest: format!("sha256:{digest}"),
            content: patch,
        };
        let resume_branch = "codex/hive-resume-test";
        run_git(&["checkout", "--quiet", "-b", resume_branch, &source_commit])?;
        std::fs::write(source.path().join("resumed.txt"), "durable branch\n")?;
        run_git(&["add", "resumed.txt"])?;
        run_git(&[
            "-c",
            "user.name=Hive Test",
            "-c",
            "user.email=hive@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "durable branch",
        ])?;
        let workspace = tempfile::tempdir()?;
        let preparation = prepare_workspace(
            workspace.path(),
            source
                .path()
                .to_str()
                .ok_or_else(|| std::io::Error::other("source path must be UTF-8"))?,
            &source_commit,
            None,
            std::slice::from_ref(&dependency),
        )
        .await?;
        assert!(!preparation.conflicted);
        let baseline = preparation.baseline;
        let repository = workspace.path().join("repository");
        assert_eq!(
            std::fs::read_to_string(repository.join("dependency.txt"))?,
            "from dependency\n"
        );
        let resumed_workspace = tempfile::tempdir()?;
        let resumed_preparation = prepare_workspace(
            resumed_workspace.path(),
            source
                .path()
                .to_str()
                .ok_or_else(|| std::io::Error::other("source path must be UTF-8"))?,
            &source_commit,
            Some(resume_branch),
            std::slice::from_ref(&dependency),
        )
        .await?;
        assert!(!resumed_preparation.conflicted);
        let resumed_repository = resumed_workspace.path().join("repository");
        assert_eq!(
            std::fs::read_to_string(resumed_repository.join("dependency.txt"))?,
            "from dependency\n"
        );
        assert_eq!(
            std::fs::read_to_string(resumed_repository.join("resumed.txt"))?,
            "durable branch\n"
        );
        std::fs::write(repository.join("task.txt"), "task result\n")?;
        let task = ClaimedTask {
            id: TaskId::new("task-2")?,
            kind: "code".to_owned(),
            prompt: "build on dependency".to_owned(),
            source_commit,
            attempt_id: AttemptId::new("attempt-2")?,
            attempt_number: 1,
            lease_token: LeaseToken::new("lease-2")?,
            owning_repairs: Vec::new(),
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };
        let result = TerminalResult::Completed {
            summary: "task complete".to_owned(),
            changed_files: vec!["task.txt".to_owned()],
            tests: Vec::new(),
            obsolete: false,
        };
        let artifact = persistable_patch(&repository, &baseline, &task, &result, false).await?;
        let CompletionArtifact::Produced(artifact) = artifact else {
            return Err(crate::error::HiveError::message(
                "task patch must be produced",
            ));
        };
        assert!(artifact.content.contains("diff --git a/task.txt"));
        assert!(!artifact.content.contains("dependency.txt"));
        Ok(())
    }
}
