use std::{
    collections::BTreeSet, fs, os::unix::fs::PermissionsExt, path::PathBuf, process::Command,
};

use anyhow::{Context, Result};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

fn read(path: &str) -> String {
    fs::read_to_string(repository_root().join(path))
        .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
}

fn read_fallible(path: &str) -> Result<String> {
    fs::read_to_string(repository_root().join(path))
        .with_context(|| format!("failed to read {path}"))
}

fn docker_stage<'a>(dockerfile: &'a str, stage: &str) -> &'a str {
    let marker = format!(" AS {stage}\n");
    let marker_start = dockerfile
        .find(&marker)
        .unwrap_or_else(|| panic!("Dockerfile stage must exist: {stage}"));
    let stage_start = dockerfile[..marker_start]
        .rfind("FROM ")
        .unwrap_or_else(|| panic!("Dockerfile stage must start with FROM: {stage}"));
    let remainder = &dockerfile[stage_start..];
    remainder
        .split_once("\nFROM ")
        .map_or(remainder, |(body, _)| body)
}

fn remote_batch_command(args: &[&str]) -> std::io::Result<std::process::Output> {
    Command::new("bash")
        .arg(repository_root().join(".github/scripts/remote-task-batch.sh"))
        .args(args)
        .output()
}

fn remote_catalog() -> Result<BTreeSet<String>> {
    let output = remote_batch_command(&["--list"])?;
    assert!(output.status.success(), "remote catalog must be readable");
    Ok(String::from_utf8(output.stdout)?
        .lines()
        .map(str::to_owned)
        .collect())
}

#[test]
fn remote_task_catalog_is_allowlisted_and_exact_head_only() {
    let root_tasks = read("Taskfile.yml");
    let remote_tasks = read(".task/remote-execution.yml");

    assert!(root_tasks.contains("taskfile: .task/remote-execution.yml"));
    for required in [
        "TASK_NAMES=<a,b> or TASK_NAME=<a>",
        "remote-task-batch.sh --validate",
        "git status --porcelain",
        "git ls-remote --refs origin",
        "if [ \"$remote_sha\" != \"$local_sha\" ]",
        "gh workflow run remote.yml",
        "--raw-field \"tasks=$requested_tasks\"",
        "remote:list:",
    ] {
        assert!(
            remote_tasks.contains(required),
            "remote Taskfile contract missing: {required}"
        );
    }
    assert!(
        !remote_tasks.contains("--raw-field \"command="),
        "remote execution must dispatch an allowlisted name, not arbitrary shell"
    );
}

#[test]
fn complete_validation_starts_before_non_blocking_review_request() -> Result<()> {
    let agentic_tasks = read_fallible(".task/agentic-ai.yml")?;
    let direct_validation = read_fallible(".task/remote-execution.yml")?;
    let direct_review_position = direct_validation
        .find("if ! task pr:review PR=\"$REQUESTED_PR\"; then")
        .context("direct validation must request review without making it a gate")?;
    let head_recheck_position = direct_validation
        .find(
            "pre_review_pr_sha=\"$(gh pr view \"$REQUESTED_PR\" --json headRefOid --jq .headRefOid)\"",
        )
        .context("direct validation must recheck the PR head before requesting review")?;
    let post_review_recheck_position = direct_validation
        .find(
            "post_review_pr_sha=\"$(gh pr view \"$REQUESTED_PR\" --json headRefOid --jq .headRefOid)\"",
        )
        .context("direct validation must recheck the PR head after requesting review")?;
    let validation_label_position = direct_validation
        .find("gh pr edit \"$REQUESTED_PR\" --add-label \"$validation_label\"")
        .context("direct validation must apply its label")?;
    assert!(
        validation_label_position < head_recheck_position
            && head_recheck_position < direct_review_position
            && direct_review_position < post_review_recheck_position,
        "validation must start before the non-blocking exact-head review request"
    );
    for required in [
        "pr:review-local:",
        "codex review --base origin/main",
        "Cloud review will request Cursor Bugbot if Codex reports a usage limit.",
        "pr:review:",
        "CI_AGENT_CMD: pr-review",
    ] {
        assert!(
            agentic_tasks.contains(required),
            "review delivery contract missing: {required}"
        );
    }
    assert!(
        direct_validation.contains("validation is already running"),
        "review-request failure must not block validation"
    );
    assert!(
        direct_validation.contains(
            "changed head after validation dispatch; validate the replacement head explicitly.\" >&2\n          exit 2"
        ),
        "a head change after dispatch must fail so the replacement head is validated"
    );
    assert!(
        direct_validation.contains(
            "changed head while requesting review; validate the replacement head explicitly.\" >&2\n          exit 2"
        ),
        "a head change during the review request must fail so the replacement head is validated"
    );
    Ok(())
}

#[test]
fn remote_task_batches_are_validated_and_keep_requested_order() -> Result<()> {
    let valid = remote_batch_command(&["--validate", "rust:test,web:check"])?;
    assert!(valid.status.success());
    assert_eq!(String::from_utf8(valid.stdout)?, "rust:test,web:check\n");

    for invalid in [
        "",
        "rust:test,",
        "rust:test,,web:check",
        "rust:test,rust:test",
        "rust:test,arbitrary:command",
        "rust:test, web:check",
        "rust:test,web:e2e",
        "rust:test,extension:e2e",
        "rust:test,web:build",
        "rust:test,check",
        "rust:test,ci:pr",
        "rust:test,ci:pr:e2e",
        "preflight,rust:test,rust:lint,rust:coverage,wasm:build,wasm:test,web:check,web:test,web:build",
    ] {
        assert!(
            !remote_batch_command(&["--validate", invalid])?
                .status
                .success(),
            "invalid remote batch must be rejected: {invalid:?}"
        );
    }

    let commands = remote_batch_command(&["--commands", "rust:test,web:check,wasm:test"])?;
    assert!(commands.status.success());
    assert_eq!(
        String::from_utf8(commands.stdout)?,
        "task remote:rust:test\ntask remote:web:check\ntask wasm:test\n"
    );
    let mixed_runtime = remote_batch_command(&["--validate", "arc:runtime,rust:test"])?;
    assert!(
        !mixed_runtime.status.success(),
        "ARC runtime smoke must be dispatched alone so workflow placement selects ARC"
    );
    for task in remote_catalog()? {
        let timeout = remote_batch_command(&["--timeout", &task])?;
        assert!(timeout.status.success(), "task timeout must exist: {task}");
        let minutes = String::from_utf8(timeout.stdout)?.trim().parse::<u8>()?;
        assert!(
            (15..=45).contains(&minutes),
            "task timeout must preserve the former bounded range: {task}"
        );
    }
    let batch_script = read(".github/scripts/remote-task-batch.sh");
    let workflow = read(".github/workflows/remote.yml");
    assert!(batch_script.contains("timeout --kill-after=1m"));
    assert!(!batch_script.contains("timeout --foreground"));
    for task in [
        "web:build",
        "web:e2e",
        "extension:e2e",
        "check",
        "ci:pr",
        "ci:pr:e2e",
    ] {
        assert!(
            workflow.contains(&format!("(inputs.tasks || inputs.task) != '{task}'"))
                && workflow.contains(&format!("(inputs.tasks || inputs.task) == '{task}'")),
            "runtime-backed remote task must bypass the daemonless batch: {task}"
        );
    }
    for direct_task in [
        "web:build) task _web:build",
        "web:e2e) task _web:test:e2e",
        "extension:e2e) task _extension:test:e2e",
        "check) task _check",
        "ci:pr) task _ci:pr",
        "ci:pr:e2e) task _ci:main",
    ] {
        assert!(
            workflow.contains(direct_task),
            "container execution must call the internal daemonless task: {direct_task}"
        );
    }
    assert!(batch_script.contains("snapshot_daemon_containers > \"$daemon_snapshot\""));
    assert!(batch_script.contains("status == 124 || status == 137"));
    assert!(batch_script.contains("docker rm -f \"$container\""));
    assert!(batch_script.contains("docker restart \"$container\""));
    assert!(batch_script.contains("docker buildx inspect --bootstrap \"$builder\""));
    assert!(batch_script.contains("git restore --source=HEAD --staged --worktree -- ."));
    assert!(batch_script.contains("git clean -fd"));
    Ok(())
}

#[test]
fn remote_task_batch_runs_every_selection_and_reports_failures() -> Result<()> {
    let fixture_nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_nanos();
    let fixture = std::env::temp_dir().join(format!(
        "nook-remote-task-batch-test-{}-{fixture_nonce}",
        std::process::id(),
    ));
    fs::create_dir_all(&fixture)?;

    let mock_task = fixture.join("task");
    fs::write(
        &mock_task,
        "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$TASK_LOG\"\n[[ \"$1\" != \"remote:web:check\" ]]\n",
    )?;
    fs::set_permissions(&mock_task, fs::Permissions::from_mode(0o755))?;

    let mock_docker = fixture.join("docker");
    fs::write(&mock_docker, "#!/usr/bin/env bash\n[[ \"$1\" = \"ps\" ]]\n")?;
    fs::set_permissions(&mock_docker, fs::Permissions::from_mode(0o755))?;

    let mock_timeout = fixture.join("timeout");
    fs::write(&mock_timeout, "#!/usr/bin/env bash\nshift 2\nexec \"$@\"\n")?;
    fs::set_permissions(&mock_timeout, fs::Permissions::from_mode(0o755))?;

    let task_log = fixture.join("task.log");
    let summary = fixture.join("summary.md");
    let system_path = std::env::var("PATH")?;
    let output = Command::new("bash")
        .arg(repository_root().join(".github/scripts/remote-task-batch.sh"))
        .args(["--run", "rust:test,web:check,wasm:test"])
        .env("PATH", format!("{}:{system_path}", fixture.display()))
        .env("TASK_LOG", &task_log)
        .env("GITHUB_STEP_SUMMARY", &summary)
        .output()?;

    assert!(
        !output.status.success(),
        "one failed task must fail the batch"
    );
    assert!(
        task_log.exists(),
        "remote batch did not invoke the task shim; stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        fs::read_to_string(&task_log)?,
        "remote:rust:test\nremote:web:check\nwasm:test\n",
        "a failed task must not prevent later selections from running"
    );
    let summary = fs::read_to_string(&summary)?;
    assert!(summary.contains("| `rust:test` | passed |"));
    assert!(summary.contains("| `web:check` | failed (exit 1) |"));
    assert!(summary.contains("| `wasm:test` | passed |"));

    fs::remove_dir_all(fixture)?;
    Ok(())
}

#[test]
fn remote_task_batch_cleans_up_both_timeout_statuses_and_continues() -> Result<()> {
    for timeout_status in [124, 137] {
        let fixture_nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos();
        let fixture = std::env::temp_dir().join(format!(
            "nook-remote-timeout-test-{}-{timeout_status}-{fixture_nonce}",
            std::process::id(),
        ));
        fs::create_dir_all(&fixture)?;

        let mock_task = fixture.join("task");
        fs::write(
            &mock_task,
            "#!/usr/bin/env bash\nprintf 'task %s\\n' \"$*\" >> \"$TASK_LOG\"\n",
        )?;
        fs::set_permissions(&mock_task, fs::Permissions::from_mode(0o755))?;

        let mock_timeout = fixture.join("timeout");
        fs::write(
            &mock_timeout,
            "#!/usr/bin/env bash\nshift 2\n\"$@\"\nif [[ ! -e \"$TIMEOUT_MARKER\" ]]; then touch \"$TIMEOUT_MARKER\" \"$LEAK_MARKER\"; exit \"$MOCK_TIMEOUT_STATUS\"; fi\n",
        )?;
        fs::set_permissions(&mock_timeout, fs::Permissions::from_mode(0o755))?;

        let mock_docker = fixture.join("docker");
        fs::write(
            &mock_docker,
            "#!/usr/bin/env bash\nprintf 'docker %s\\n' \"$*\" >> \"$DAEMON_LOG\"\nif [[ \"$*\" = \"ps -aq\" ]]; then echo existing; [[ -e \"$LEAK_MARKER\" ]] && echo leaked; fi\nif [[ \"$*\" = \"rm -f leaked\" ]]; then rm -f \"$LEAK_MARKER\"; fi\n",
        )?;
        fs::set_permissions(&mock_docker, fs::Permissions::from_mode(0o755))?;

        let mock_git = fixture.join("git");
        fs::write(
            &mock_git,
            "#!/usr/bin/env bash\nprintf 'git %s\\n' \"$*\" >> \"$DAEMON_LOG\"\n",
        )?;
        fs::set_permissions(&mock_git, fs::Permissions::from_mode(0o755))?;

        let task_log = fixture.join("task.log");
        let daemon_log = fixture.join("daemon.log");
        let timeout_marker = fixture.join("timeout.marker");
        let leak_marker = fixture.join("leak.marker");
        let system_path = std::env::var("PATH")?;
        let output = Command::new("bash")
            .arg(repository_root().join(".github/scripts/remote-task-batch.sh"))
            .args(["--run", "rust:test,wasm:test"])
            .env("PATH", format!("{}:{system_path}", fixture.display()))
            .env("TASK_LOG", &task_log)
            .env("DAEMON_LOG", &daemon_log)
            .env("TIMEOUT_MARKER", &timeout_marker)
            .env("LEAK_MARKER", &leak_marker)
            .env("MOCK_TIMEOUT_STATUS", timeout_status.to_string())
            .env_remove("NOOK_PR_BUILDX_BUILDER")
            .output()?;

        assert!(!output.status.success());
        assert_eq!(
            fs::read_to_string(&task_log)?,
            "task remote:rust:test\ntask wasm:test\n",
            "a timed-out task must not block the next selection"
        );
        let daemon_log = fs::read_to_string(&daemon_log)?;
        assert!(daemon_log.contains("docker rm -f leaked"));
        assert!(daemon_log.contains("git restore --source=HEAD --staged --worktree -- ."));
        assert!(daemon_log.contains("git clean -fd"));
        assert!(!leak_marker.exists());

        fs::remove_dir_all(fixture)?;
    }
    Ok(())
}

#[test]
fn expensive_remote_validation_requires_the_current_base() -> Result<()> {
    let remote_tasks = read(".task/remote-execution.yml");
    assert!(remote_tasks.contains("remote-task-batch.sh --requires-current-base"));
    for tasks in ["web:e2e", "extension:e2e", "ci:pr"] {
        assert!(
            remote_batch_command(&["--requires-current-base", tasks])?
                .status
                .success(),
            "expensive batch must require current base: {tasks}"
        );
    }
    assert!(
        !remote_batch_command(&["--requires-current-base", "rust:test,web:check"])?
            .status
            .success(),
        "cheap batch must remain available on a stale base"
    );
    assert_eq!(
        remote_tasks
            .matches(".github/scripts/require-current-base.sh")
            .count(),
        2,
        "focused expensive dispatch and complete PR validation must share the freshness guard"
    );
    assert!(remote_tasks.contains("baseRefName"));

    let status = Command::new("bash")
        .arg(repository_root().join(".github/scripts/require-current-base.test.sh"))
        .status()?;
    assert!(status.success(), "base freshness behavior tests must pass");
    Ok(())
}

#[test]
fn arc_workflow_matches_the_taskfile_catalog() -> Result<()> {
    let remote_tasks = read(".task/remote-execution.yml");
    let workflow = read(".github/workflows/remote.yml");
    let batch_script = read(".github/scripts/remote-task-batch.sh");
    let task_catalog = remote_catalog()?;

    for task in &task_catalog {
        assert!(
            batch_script.contains(&format!("    {task})")),
            "remote batch helper has no literal command mapping for task: {task}"
        );
    }

    assert_eq!(
        workflow.matches("runs-on: ubuntu-latest").count(),
        0,
        "trusted remote execution must not consume GitHub-hosted capacity"
    );
    assert!(
        workflow.contains("inputs.runner_label == 'nook-k0s-hive' || contains(format(',{0},', inputs.tasks || inputs.task), ',hive:verify,')")
            && workflow.contains("vars.NOOK_HIVE_RUNS_ON || 'nook-k0s-hive'")
            && workflow.contains("vars.NOOK_RUNS_ON || 'nook-k0s'")
            && workflow.contains("runs-on: nook-k0s-container"),
        "remote tasks must select the general, Hive, or container ARC scale set"
    );
    assert!(
        !workflow.contains("Start hosted Hive Neo4j service")
            && !workflow.contains("docker run --detach"),
        "ARC remote tasks must use the Hive scale set sidecar instead of a nested daemon"
    );
    assert!(
        workflow.contains("if: inputs.task == 'rust-cache:promote'")
            && workflow.contains("Remote / rust-cache:promote")
            && !remote_tasks.contains("rust-cache:promote"),
        "cache promotion must remain an internal parameterized broker, not an agent task"
    );
    assert!(
        workflow.contains("registry-username: ${{ secrets.NOOK_REGISTRY_REMOTE_USERNAME }}")
            && workflow.contains("registry-password: ${{ secrets.NOOK_REGISTRY_REMOTE_PASSWORD }}")
            && workflow
                .contains("sccache-access-key: ${{ secrets.NOOK_SCCACHE_REMOTE_ACCESS_KEY }}")
            && workflow
                .contains("sccache-secret-key: ${{ secrets.NOOK_SCCACHE_REMOTE_SECRET_KEY }}")
            && workflow.contains("sccache-endpoint: ${{ secrets.NOOK_SCCACHE_ENDPOINT }}")
            && workflow.contains("sccache-bucket: ${{ secrets.NOOK_SCCACHE_REMOTE_BUCKET }}"),
        "remote jobs must authenticate to Zot layers and SeaweedFS compiler objects"
    );
    let secret_refs = workflow.matches("${{ secrets.").count();
    assert_eq!(
        secret_refs,
        workflow
            .matches("secrets.NOOK_REGISTRY_REMOTE_USERNAME")
            .count()
            + workflow
                .matches("secrets.NOOK_REGISTRY_REMOTE_PASSWORD")
                .count()
            + workflow
                .matches("secrets.NOOK_SCCACHE_REMOTE_ACCESS_KEY")
                .count()
            + workflow
                .matches("secrets.NOOK_SCCACHE_REMOTE_SECRET_KEY")
                .count()
            + workflow.matches("secrets.NOOK_SCCACHE_ENDPOINT").count()
            + workflow
                .matches("secrets.NOOK_SCCACHE_REMOTE_BUCKET")
                .count(),
        "remote workflow may only use the Zot and scoped SeaweedFS cache credentials"
    );
    assert!(!workflow.contains("${{ inputs.command }}"));
    assert!(
        workflow.contains("group: remote-${{ github.ref }}-${{ inputs.tasks || inputs.task }}")
    );
    assert!(workflow.contains("remote-task-batch.sh --run \"$REQUESTED_REMOTE_TASKS\""));
    assert!(batch_script.contains(
        "rust:ci) run_with_timeout \"$timeout_minutes\" env CI_ARTIFACT_DIR=\"$artifact_root/rust-ci\" task ci:pr:rust"
    ));
    assert!(batch_script.contains("docker buildx use \"$builder\""));
    assert!(batch_script.contains("if ! restore_hosted_builder; then"));
    let docker_setup = read(".github/actions/nook-docker-setup/action.yml");
    assert!(docker_setup.contains(
        "NOOK_REMOTE_TASK_SELECTION: ${{ github.event.inputs.tasks || github.event.inputs.task }}"
    ));
    assert!(docker_setup.contains("if [ -z \"$NOOK_REMOTE_TASK_SELECTION\" ]"));
    assert!(workflow.contains("cache-write: \"false\""));
    assert!(workflow.contains("main-cache-only: \"true\""));
    assert!(workflow.contains(
        "REQUEST_INCLUDES_HIVE: ${{ contains(format(',{0},', inputs.tasks || inputs.task), ',hive:verify,') && 'true' || 'false' }}"
    ));
    assert!(workflow.contains(
        "isolated-cache-write: ${{ (inputs.tasks || inputs.task) == 'hive:verify' && 'false' || 'true' }}"
    ), "Remote Docker batches must preserve git-commit handoffs unless the selection is exactly Hive");
    assert!(batch_script.contains(
        "hive:verify) run_with_timeout \"$timeout_minutes\" env HIVE_CACHE_TO= task hive:verify ;;"
    ), "Hive must not publish a per-branch cache even when another task makes a mixed ARC batch writable");
    assert!(workflow.contains("env.REQUEST_INCLUDES_HIVE == 'true'"));
    assert_eq!(
        workflow
            .matches("env.REQUEST_INCLUDES_HIVE == 'true'")
            .count(),
        1,
        "Hive-containing batches must route to and wait for the Hive scale-set sidecar"
    );
    for (requested, focused) in [
        ("rust:test", "remote:rust:test"),
        ("rust:lint", "remote:rust:lint"),
        ("rust:coverage", "remote:rust:coverage"),
        ("web:check", "remote:web:check"),
        ("web:test", "remote:web:test"),
        ("extension:check", "remote:extension:check"),
    ] {
        assert!(
            batch_script.contains(&format!("{requested}) echo \"task {focused}\""))
                && batch_script.contains(&format!(
                    "{requested}) run_with_timeout \"$timeout_minutes\" task {focused}"
                )),
            "frequent remote task {requested} must use its narrow source-sealed route"
        );
    }
    assert_eq!(
        batch_script
            .matches(") run_with_timeout \"$timeout_minutes\" task remote:")
            .count(),
        6,
        "only the mechanically reviewed focused routes may bypass their full local task"
    );
    assert!(!batch_script.contains("rust:test) task rust:test"));
    assert!(!batch_script.contains("rust:lint) task rust:lint"));
    assert!(!batch_script.contains("rust:coverage) task rust:coverage"));
    assert!(!batch_script.contains("web:check) task web:check"));
    assert!(!batch_script.contains("web:test) task web:test"));
    assert!(!batch_script.contains("extension:check) task extension:check"));
    Ok(())
}

#[test]
fn frequent_remote_checks_use_narrow_source_sealed_images() -> Result<()> {
    let app_tasks = read("nook-app/Taskfile.yml");
    let core_tasks = read("nook-app/nook-platform/Taskfile.yml");
    let web_tasks = read("nook-app/nook-web/Taskfile.yml");
    let extension_tasks = read("nook-app/nook-web/nook-web-extension/Taskfile.yml");
    let product_dockerfile = read("nook-app/nook-platform/docker/rust/product.Dockerfile");
    let test_dockerfile = docker_stage(&product_dockerfile, "nook-rust-test");
    let lint_dockerfile = docker_stage(&product_dockerfile, "nook-rust-lint");
    let coverage_dockerfile = docker_stage(&product_dockerfile, "nook-rust-coverage");
    let product_dockerignore =
        read("nook-app/nook-platform/docker/rust/product.Dockerfile.dockerignore");
    let core_bake = read("nook-app/nook-platform/nook-core/docker-bake.hcl");
    let wasm_bake = read("nook-app/nook-platform/nook-wasm/docker-bake.hcl");
    let web_app_bake = read("nook-app/nook-web/nook-web-app/docker-bake.hcl");
    let wasm_dockerfile = product_dockerfile.as_str();
    let shared_bake = read("nook-app/docker-bake.hcl");
    let bake = format!("{shared_bake}\n{core_bake}\n{wasm_bake}\n{web_app_bake}");

    let focused_web_setup = app_tasks
        .split("  setup:web:focused:\n")
        .nth(1)
        .context("focused web setup task must exist")?;
    assert!(
        focused_web_setup.contains("NOOK_EXTENSION_COMMIT: '{{.NOOK_EXTENSION_COMMIT}}'"),
        "focused web setup must pass the exact commit to NOOK_SOURCE_REVISION through Bake"
    );

    for required in [
        "setup:rust:test:",
        "nook-rust-test",
        "setup:web:focused:",
        "focused-web-artifacts",
        "nook-web-focused",
    ] {
        assert!(
            app_tasks.contains(required)
                || core_tasks.contains(required)
                || bake.contains(required),
            "focused sealed-image contract missing: {required}"
        );
    }
    assert!(core_tasks.contains("remote:rust:test:"));
    assert!(core_tasks.contains("remote:rust:lint:"));
    assert!(core_tasks.contains("remote:rust:coverage:"));
    assert!(web_tasks.contains("remote:web:check:"));
    assert!(web_tasks.contains("remote:web:test:"));
    assert!(extension_tasks.contains("remote:extension:check:"));
    assert!(
        product_dockerfile.contains("FROM rust-base AS chef-deps")
            && product_dockerfile.contains("FROM builder-wasm-deps AS builder-core-deps")
            && product_dockerfile.contains("FROM builder-core-deps AS rust-platform")
            && product_dockerfile.contains("COPY nook-app/nook-platform/ nook-app/nook-platform/")
            && product_dockerfile.contains("AS nook-rust-test")
            && product_dockerfile.contains("AS nook-rust-lint")
            && product_dockerfile.contains("AS nook-rust-coverage"),
        "product.Dockerfile must own dependency, source, and focused leaf stages"
    );
    for ignored in [
        "**/docker-bake.hcl",
        "**/target",
        "**/node_modules",
        "**/dist",
    ] {
        assert!(
            product_dockerignore.lines().any(|line| line == ignored),
            "product Rust context must ignore generated input: {ignored}"
        );
    }
    assert!(
        core_bake.contains("target \"rust-platform\"")
            && core_bake
                .contains("dockerfile = \"nook-app/nook-platform/docker/rust/product.Dockerfile\"",)
            && !core_bake.contains("builder-core-deps = \"target:builder-core-deps\""),
        "rust-platform must resolve builder-core-deps as an internal product stage"
    );
    for (label, stage, compile_marker) in [
        ("test", test_dockerfile, "focused-native-test-compile"),
        ("lint", lint_dockerfile, "focused-rust-lint-compile"),
        (
            "coverage",
            coverage_dockerfile,
            "focused-rust-coverage-compile",
        ),
    ] {
        assert!(
            stage.contains(&format!("FROM builder-core-deps AS nook-rust-{label}"))
                && stage.contains(compile_marker)
                && stage.contains("COPY nook-app/nook-platform/nook-app-common nook-app-common")
                && stage.contains("COPY nook-app/nook-platform/nook-auth2 nook-auth2")
                && stage.contains("COPY nook-app/nook-platform/nook-replication nook-replication")
                && stage.contains("COPY nook-app/nook-platform/nook-event-log nook-event-log")
                && stage.contains(
                    "COPY nook-app/nook-platform/nook-companion-core nook-companion-core"
                )
                && stage.contains("COPY nook-app/nook-platform/nook-core nook-core"),
            "focused {label} must COPY+RUN per crate from builder-core-deps for layer cache"
        );
        let compile = stage
            .find(compile_marker)
            .unwrap_or_else(|| panic!("focused {label} compile marker must exist"));
        let full_checkout = stage
            .find("COPY . .")
            .unwrap_or_else(|| panic!("focused {label} must seal the full checkout"));
        assert!(
            compile < full_checkout,
            "nook-rust-{label} must finish per-crate work before copying the full checkout"
        );
        let common_copy = stage
            .find("COPY nook-app/nook-platform/nook-app-common nook-app-common")
            .unwrap_or_else(|| panic!("{label} must copy nook-app-common before its RUN"));
        let core_copy = stage
            .find("COPY nook-app/nook-platform/nook-core nook-core")
            .unwrap_or_else(|| panic!("{label} must copy nook-core before its RUN"));
        assert!(
            common_copy < core_copy && core_copy < compile,
            "{label} crate COPY order must follow the dependency edge"
        );
    }
    assert!(
        test_dockerfile.contains("--no-run")
            && test_dockerfile
                .contains("COPY nook-app/nook-platform/nook-companion-wasm nook-companion-wasm"),
        "focused test must compile nextest binaries per crate including companion-wasm"
    );
    assert!(
        lint_dockerfile
            .contains("COPY nook-app/nook-platform/nook-companion-wasm nook-companion-wasm")
            && lint_dockerfile.contains("COPY nook-app/nook-platform/nook-wasm nook-wasm")
            && lint_dockerfile.contains("wasm32-unknown-unknown"),
        "focused lint must clippy wasm crates after native crates"
    );
    assert!(wasm_dockerfile.contains("FROM builder-wasm-build AS focused-web-artifacts-source"));
    assert!(wasm_dockerfile.contains("FROM scratch AS focused-web-artifacts"));
    assert!(core_bake.contains("inherits = [\"_nook-rust-test-common\"]"));
    for target in [
        "_nook-rust-test-common",
        "_nook-rust-lint-common",
        "_nook-rust-coverage-common",
    ] {
        let stage = core_bake
            .split(&format!("target \"{target}\" {{\n"))
            .nth(1)
            .and_then(|remainder| remainder.split("\n}").next())
            .unwrap_or_else(|| panic!("focused Bake target must exist: {target}"));
        assert!(
            stage
                .contains("dockerfile = \"nook-app/nook-platform/docker/rust/product.Dockerfile\"")
        );
        assert!(
            !stage.contains("contexts ="),
            "{target} must resolve builder-core-deps as an internal stage"
        );
    }
    assert!(web_app_bake.contains("inherits   = [\"_nook-web-focused-common\"]"));
    assert!(
        !core_bake.contains("target \"nook-rust-test\" {\n  inherits = [\"_nook-rust-common\"]")
    );
    assert!(
        !web_app_bake
            .contains("target \"nook-web-focused\" {\n  inherits = [\"_nook-web-common\"]")
    );
    Ok(())
}

#[test]
fn broad_remote_tasks_export_native_layers_without_main_write_access() {
    let bake = read("nook-app/docker-bake.hcl");
    let prepare = bake
        .split("group \"prepare\" {\n")
        .nth(1)
        .and_then(|remainder| remainder.split("\n}").next())
        .unwrap_or_else(|| panic!("prepare Bake group must exist"));
    assert!(
        prepare.contains("\"builder-debug\""),
        "broad setup must select builder-debug so its dedicated Zot exporter runs"
    );

    let pr = read(".github/workflows/pr.yml");
    assert!(!pr.contains("secrets.NOOK_REGISTRY_USERNAME"));
    assert!(!pr.contains("secrets.NOOK_REGISTRY_PASSWORD"));
    assert!(pr.contains("secrets.NOOK_REGISTRY_REMOTE_USERNAME"));
    assert!(pr.contains("secrets.NOOK_REGISTRY_REMOTE_PASSWORD"));
    let pr_docker_setups = pr
        .matches("uses: ./.github/actions/nook-docker-setup")
        .count();
    assert_eq!(
        pr.matches("cache-write: \"false\"").count(),
        pr_docker_setups,
        "every PR registry login must keep Main buildcache exporters disabled"
    );
    assert_eq!(
        pr.matches("isolated-cache-write: \"true\"").count(),
        pr_docker_setups,
        "every PR Docker job must export only isolated remote-buildcache scopes"
    );
}

#[test]
fn complete_pr_validation_is_explicit_and_exact_head_bound() -> Result<()> {
    let remote_tasks = read(".task/remote-execution.yml");
    let pr = read(".github/workflows/pr.yml");
    let remote_doc = read(".cortex/workflows/remote-execution.md");

    assert!(pr.contains("types: [labeled]"));
    assert!(
        !pr.contains("types: [labeled, closed]"),
        "PR validation must not create a close-triggered source run"
    );
    for required in [
        "name: Validate explicit CI request",
        "name: Reject unsupported label events",
        "ci:validate|ci:full-e2e",
    ] {
        assert!(
            pr.contains(required),
            "PR workflow request guard missing: {required}"
        );
    }
    for label in ["ci:validate", "ci:full-e2e"] {
        assert!(
            pr.contains(&format!("github.event.label.name == '{label}'")),
            "PR workflow must gate workers on {label}"
        );
        assert!(
            remote_tasks.contains(label),
            "PR validation Task command must own {label}"
        );
    }
    let ui_demo = pr
        .split_once("\n  ui-demo:\n")
        .and_then(|(_, tail)| tail.split_once("\n  preview:\n"))
        .map(|(job, _)| job)
        .context("PR workflow must keep the UI demo job")?;
    let full_e2e = pr
        .split_once("\n  full-e2e:\n")
        .and_then(|(_, tail)| tail.split_once("\n  full-extension-e2e:\n"))
        .map(|(job, _)| job)
        .context("PR workflow must keep the full browser e2e job")?;
    let full_extension_e2e = pr
        .split_once("\n  full-extension-e2e:\n")
        .map(|(_, job)| job)
        .context("PR workflow must keep the full extension e2e job")?;
    let full_e2e_label = "contains(github.event.pull_request.labels.*.name, 'ci:full-e2e')";
    assert!(
        full_e2e.contains(full_e2e_label) && full_extension_e2e.contains(full_e2e_label),
        "a persistent Main-fix label must keep both full e2e jobs active"
    );
    assert!(ui_demo.contains("runs-on: nook-k0s-container"));
    for required in [
        "E2E_ARTIFACT_DIR: ${{ runner.temp }}/nook-e2e-artifacts",
        "name: Collect Playwright diagnostics",
        "name: Preserve Playwright diagnostics",
        "if: always()",
        "uses: actions/upload-artifact@v7",
    ] {
        assert!(
            workflow_or_remote_tasks(required),
            "remote e2e diagnostics contract missing: {required}"
        );
    }
    for required in [
        "pr_sha=\"$(gh pr view \"$REQUESTED_PR\"",
        "if [ \"$local_sha\" != \"$pr_sha\" ]",
        "--remove-label \"$validation_label\"",
        "--add-label \"$validation_label\"",
        "task remote TASK_NAME=rust:test",
        "task pr:validate PR=<number>",
        "becomes stale after any later push",
    ] {
        assert!(
            remote_tasks.contains(required) || remote_doc.contains(required),
            "remote execution contract missing: {required}"
        );
    }
    Ok(())
}

fn workflow_or_remote_tasks(required: &str) -> bool {
    read(".github/workflows/remote.yml").contains(required)
        || read("nook-app/nook-platform/docker/Taskfile.yml").contains(required)
        || read("nook-app/nook-web/docker/Taskfile.yml").contains(required)
}
