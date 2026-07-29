use super::*;

pub(super) fn establish_worker_lifecycle(
    workspace: &Path,
    pod_name: &str,
) -> crate::HiveResult<()> {
    std::fs::create_dir_all(workspace)?;
    let startup_marker = workspace.join(".hive-worker-started");
    let startup_file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&startup_marker);
    let mut startup_file = match startup_file {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            std::fs::write(workspace.join(".hive-task-finished"), pod_name)?;
            return Err(error)
                .hive_context("refusing to restart a Hive worker inside an existing Pod");
        }
        Err(error) => return Err(error).hive_context("failed to establish Hive worker lifecycle"),
    };
    startup_file.write_all(pod_name.as_bytes())?;
    startup_file.sync_all()?;
    Ok(())
}

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
        return Err(crate::hive_error!(
            "refusing to reuse a repository left by an earlier worker process"
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
        return Err(crate::hive_error!("git init failed with status {status}"));
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
                return Err(crate::hive_error!(
                    "dependency artifact {} failed to apply with status {status}",
                    artifact.id
                ));
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
            return Err(crate::hive_error!(
                "dependency artifact {} has unsupported kind {}",
                artifact.id,
                artifact.kind
            ));
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
            return Err(crate::hive_error!(
                "dependency artifact {} failed digest verification",
                artifact.id
            ));
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
        crate::hive_bail!("dependency integration left unresolved Git conflicts");
    }
    if repository.join(".hive-pending").exists() {
        crate::hive_bail!("dependency integration did not apply every pending patch");
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
        crate::hive_bail!("git {:?} failed with status {}", arguments, output.status);
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
        crate::hive_bail!("{operation} failed with status {status}");
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
        return Err(crate::hive_error!(
            "git add --intent-to-add failed with status {add_status}"
        ));
    }

    let output = Command::new("git")
        .args(["diff", "--binary", "--no-ext-diff", baseline, "--", "."])
        .current_dir(repository)
        .stdin(Stdio::null())
        .output()
        .await
        .hive_context("failed to collect the durable task patch")?;
    if !output.status.success() {
        return Err(crate::hive_error!(
            "git diff failed with status {}",
            output.status
        ));
    }
    if output.stdout.len() > MAX_PERSISTED_PATCH_BYTES {
        return Err(crate::hive_error!(
            "task patch exceeds the {} byte prototype limit",
            MAX_PERSISTED_PATCH_BYTES
        ));
    }
    if output.stdout.is_empty() {
        if !resumed && !result.changed_files().is_empty() {
            return Err(crate::hive_error!(
                "Codex reported changed files but produced no persistable git patch"
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
