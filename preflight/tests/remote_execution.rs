use std::{
    env, fs, io,
    ops::Deref,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{self, Command},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};

struct RepositoryFixture {
    path: PathBuf,
}
impl RepositoryFixture {
    fn repository_root() -> Self {
        Self {
            path: env::var_os("NOOK_REPO_ROOT").map_or_else(
                || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
                PathBuf::from,
            ),
        }
    }
}
impl Deref for RepositoryFixture {
    type Target = PathBuf;
    fn deref(&self) -> &PathBuf {
        &self.path
    }
}
impl AsRef<Path> for RepositoryFixture {
    fn as_ref(&self) -> &Path {
        &self.path
    }
}

impl RepositoryFixture {
    fn read(&self, path: &str) -> String {
        fs::read_to_string(self.join(path))
            .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
    }
}

fn read_fallible(path: &str) -> Result<String> {
    fs::read_to_string(RepositoryFixture::repository_root().join(path))
        .with_context(|| format!("failed to read {path}"))
}

fn docker_stage<'a>(dockerfile: &'a str, stage: &str) -> &'a str {
    let marker = format!(" AS {stage}\n");
    let marker_start = dockerfile
        .find(&marker)
        .unwrap_or_else(|| panic!("Dockerfile stage must exist: {stage}"));
    let stage_start = dockerfile
        .get(..marker_start)
        .unwrap_or_else(|| panic!("Dockerfile marker must be a character boundary: {stage}"))
        .rfind("FROM ")
        .unwrap_or_else(|| panic!("Dockerfile stage must start with FROM: {stage}"));
    let remainder = dockerfile
        .get(stage_start..)
        .unwrap_or_else(|| panic!("Dockerfile stage must start on a character boundary: {stage}"));
    remainder
        .split_once("\nFROM ")
        .map_or(remainder, |(body, _)| body)
}

fn remote_batch_command(args: &[&str]) -> io::Result<process::Output> {
    Command::new("bash")
        .arg(RepositoryFixture::repository_root().join(".github/scripts/remote-task-batch.sh"))
        .args(args)
        .output()
}

#[test]
fn remote_task_dispatch_uses_named_tasks_and_exact_head_only() {
    let root_tasks = RepositoryFixture::repository_root().read("Taskfile.yml");
    let remote_tasks = RepositoryFixture::repository_root().read(".task/remote-execution.yml");

    assert!(root_tasks.contains("taskfile: .task/remote-execution.yml"));
    for required in [
        "TASK_NAMES=<a,b> or TASK_NAME=<a>",
        "git status --porcelain",
        "git ls-remote --refs origin",
        "if [ \"$remote_sha\" != \"$local_sha\" ]",
        "gh workflow run remote.yml",
        "requested_tasks=\"$REQUESTED_REMOTE_TASKS\"",
        "--raw-field \"tasks=$requested_tasks\"",
        "--raw-field \"source_sha=$local_sha\"",
        "[ \"$branch\" = \"dev\" ]",
        "build:compile is a feature-branch route",
        ".github/scripts/require-current-base.sh origin main",
    ] {
        assert!(
            remote_tasks.contains(required),
            "remote Taskfile contract missing: {required}"
        );
    }
    assert!(
        !remote_tasks.contains("--raw-field \"command="),
        "remote execution must dispatch a Task name, not arbitrary shell"
    );
}

#[test]
fn complete_validation_gates_optional_review_after_dispatch() -> Result<()> {
    let agentic_tasks = read_fallible(".task/agentic-ai.yml")?;
    let direct_validation = read_fallible(".task/remote-execution.yml")?;
    let readme = read_fallible("README.md")?;
    let current_base_position = direct_validation
        .find(".github/scripts/require-current-base.sh origin \"$base_ref\"")
        .context("direct validation must require a current base")?;
    let validation_label_position = direct_validation
        .find("gh pr edit \"$REQUESTED_PR\" --add-label \"$validation_label\"")
        .context("direct validation must apply its label")?;
    let review_opt_in_position = direct_validation
        .find("if [ \"$REQUEST_CODEX_REVIEW\" = \"1\" ]; then")
        .context("direct validation must gate review behind an explicit opt-in")?;
    let review_request_position = direct_validation
        .find("if review_request_output=\"$(task pr:review \\")
        .context("opted-in validation must request exact-head review")?;
    let dispatched_head_position = direct_validation
        .find("dispatched_pr_state=\"$(gh pr view \"$REQUESTED_PR\" --json headRefOid,baseRefName")
        .context("direct validation must recheck the head and base after label dispatch")?;
    let dispatched_base_position = direct_validation
        .find(".github/scripts/require-current-base.sh origin \"$dispatched_base_ref\"")
        .context("direct validation must recheck base freshness after label dispatch")?;
    assert!(
        current_base_position < validation_label_position
            && validation_label_position < review_opt_in_position
            && review_opt_in_position < review_request_position
            && review_request_position < dispatched_head_position,
        "complete validation must dispatch before an opted-in review and then reject a head change"
    );
    assert!(
        dispatched_head_position < dispatched_base_position,
        "complete validation must recheck target-branch freshness after dispatch"
    );
    for required in [
        "pr:review-local:",
        "codex review --base origin/main",
        "Cloud review remains Codex-only; hosted validation dispatch never waits for it.",
        "pr:review:",
        "CI_AGENT_CMD: pr-review",
        "pr:review:stabilize:",
        "CI_AGENT_CMD: pr-review-stabilize",
        "REVIEW_CIRCUIT_BREAKER_ACKNOWLEDGED: '{{default \"0\" .REVIEW_CIRCUIT_BREAKER_ACKNOWLEDGED}}'",
        "REVIEW_WAIT_SECONDS: '{{default \"0\" .REVIEW_WAIT_SECONDS}}'",
    ] {
        assert!(
            agentic_tasks.contains(required),
            "review delivery contract missing: {required}"
        );
    }
    assert!(
        !direct_validation.contains("pr:review:stabilize")
            && !direct_validation.contains("REQUEST_REVIEW_WAIT_SECONDS"),
        "complete validation must not wait for review before dispatch"
    );
    for required in [
        "REQUEST_CODEX_REVIEW: '{{default \"0\" .CODEX_REVIEW}}'",
        "CODEX_REVIEW must be 0 or 1.",
        "review_request_state=\"disabled\"",
        "review_request_state=\"not-requested\"",
        "grep -Fq '\"state\": \"requested\"'",
        "Keep this validation running; collect or retry review separately without restarting validation.",
        "Codex review opt-in: $REQUEST_CODEX_REVIEW.",
        "Exact-head review request state: $review_request_state.",
        "REVIEW_CIRCUIT_BREAKER_ACKNOWLEDGED=\"$REQUEST_REVIEW_CIRCUIT_BREAKER_ACKNOWLEDGED\"",
    ] {
        assert!(
            direct_validation.contains(required),
            "post-dispatch review partial-state contract missing: {required}"
        );
    }
    assert!(
        readme.contains(
            "task pr:review:stabilize PR=410 # one bounded feedback snapshot after validation dispatch"
        ),
        "public command catalog must place review stabilization after hosted dispatch"
    );
    assert!(
        direct_validation.contains(
            "changed head or base while validation was dispatched; removed $validation_label from the replacement state."
        ),
        "a head or base change during label dispatch must remove the replacement-state label"
    );
    assert!(
        !direct_validation.contains("gh run cancel"),
        "validation dispatch must leave cancellation to centralized native concurrency"
    );

    Ok(())
}

#[test]
fn remote_task_batches_dispatch_named_tasks() -> Result<()> {
    let arbitrary = remote_batch_command(&["--timeout", "arbitrary:task"])?;
    assert!(arbitrary.status.success());
    assert_eq!(String::from_utf8(arbitrary.stdout)?, "30\n");
    let build_compile = remote_batch_command(&["--timeout", "build:compile"])?;
    assert!(build_compile.status.success());
    assert_eq!(String::from_utf8(build_compile.stdout)?, "30\n");

    let batch_script =
        RepositoryFixture::repository_root().read(".github/scripts/remote-task-batch.sh");
    let workflow = RepositoryFixture::repository_root().read(".github/workflows/remote.yml");
    assert!(batch_script.contains("timeout --kill-after=1m"));
    assert!(!batch_script.contains("timeout --foreground"));
    assert!(!batch_script.contains("is_catalog_task"));
    assert!(!batch_script.contains("Unknown remote task"));
    assert!(batch_script.contains("task \"$1\""));
    for task in [
        "web:build",
        "web:e2e",
        "web:e2e:debug",
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
    assert!(batch_script.contains(
        "build:compile) run_with_timeout \"$timeout_minutes\" task build:compile"
    ));
    for direct_task in [
        "web:build) task _web:build",
        "web:e2e) task _ci:main:web:e2e-only",
        "web:e2e:debug) NOOK_REMOTE_E2E_DEBUG=1 task _web:test:e2e:debug",
        "extension:e2e) task _extension:test:e2e",
        "check) task _check",
        "ci:pr) task _ci:pr",
    ] {
        assert!(
            workflow.contains(direct_task),
            "container execution must call the internal daemonless task: {direct_task}"
        );
    }
    for suite_task in [
        "stable) task _web:test:e2e:stable",
        "unstable) task _web:test:e2e:unstable",
        "isolation) task _web:test:e2e:isolation",
        "extension) task _extension:test:e2e",
    ] {
        assert!(workflow.contains(suite_task));
    }
    assert!(workflow.contains("fail-fast: false"));
    assert!(workflow.contains("ref: ${{ inputs.source_sha || github.sha }}"));
    assert!(workflow.contains("name: Validate exact remote source"));
    assert!(workflow.contains("name: Confirm prepared build-only environment"));
    assert!(workflow.contains("build:compile is allowed only from a feature branch, never main or dev."));
    assert!(workflow.contains("needs: ci-pr-e2e-suite"));
    assert!(workflow.contains("needs.ci-pr-e2e-suite.result"));
    assert!(batch_script.contains("status == 124 || status == 137"));
    assert!(batch_script.contains("cleanup_timed_out_buildkit_work"));
    assert!(batch_script.contains("docker buildx inspect --bootstrap \"$builder\""));
    for forbidden in [
        "docker ps",
        "docker rm",
        "docker restart",
        "docker run",
        "docker create",
        "docker start",
        "docker exec",
    ] {
        assert!(
            !batch_script.contains(forbidden),
            "ARC batch helper must not control a container runtime: {forbidden}"
        );
    }
    assert!(batch_script.contains("git restore --source=HEAD --staged --worktree -- ."));
    assert!(batch_script.contains("git clean -fd"));
    Ok(())
}

#[test]
fn remote_task_batch_runs_every_selection_and_reports_failures() -> Result<()> {
    let fixture_nonce = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let fixture = env::temp_dir().join(format!(
        "nook-remote-task-batch-test-{}-{fixture_nonce}",
        process::id(),
    ));
    fs::create_dir_all(&fixture)?;

    let mock_task = fixture.join("task");
    fs::write(
        &mock_task,
        "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$TASK_LOG\"\n[[ \"$*\" != \"ci:pr:rust\" ]]\n",
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
    let system_path = env::var("PATH")?;
    let output = Command::new("bash")
        .arg(RepositoryFixture::repository_root().join(".github/scripts/remote-task-batch.sh"))
        .args(["--run", "preflight,rust:ci,arbitrary:task,hive:verify"])
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
        "preflight\nci:pr:rust\narbitrary:task\nhive:verify\n",
        "a failed task must not prevent later selections from running"
    );
    let summary = fs::read_to_string(&summary)?;
    assert!(summary.contains("| `preflight` | passed |"));
    assert!(summary.contains("| `rust:ci` | failed (exit 1) |"));
    assert!(summary.contains("| `arbitrary:task` | passed |"));
    assert!(summary.contains("| `hive:verify` | passed |"));

    fs::remove_dir_all(fixture)?;
    Ok(())
}

#[test]
fn remote_task_batch_rechecks_buildkit_after_both_timeout_statuses_and_continues() -> Result<()> {
    for timeout_status in [124, 137] {
        let fixture_nonce = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let fixture = env::temp_dir().join(format!(
            "nook-remote-timeout-test-{}-{timeout_status}-{fixture_nonce}",
            process::id(),
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
            "#!/usr/bin/env bash\nshift 2\n\"$@\"\nif [[ ! -e \"$TIMEOUT_MARKER\" ]]; then touch \"$TIMEOUT_MARKER\"; exit \"$MOCK_TIMEOUT_STATUS\"; fi\n",
        )?;
        fs::set_permissions(&mock_timeout, fs::Permissions::from_mode(0o755))?;

        let mock_docker = fixture.join("docker");
        fs::write(
            &mock_docker,
            "#!/usr/bin/env bash\nprintf 'docker %s\\n' \"$*\" >> \"$CLEANUP_LOG\"\n[[ \"$*\" = \"buildx inspect --bootstrap remote-builder\" ]]\n",
        )?;
        fs::set_permissions(&mock_docker, fs::Permissions::from_mode(0o755))?;

        let mock_git = fixture.join("git");
        fs::write(
            &mock_git,
            "#!/usr/bin/env bash\nprintf 'git %s\\n' \"$*\" >> \"$CLEANUP_LOG\"\n",
        )?;
        fs::set_permissions(&mock_git, fs::Permissions::from_mode(0o755))?;

        let task_log = fixture.join("task.log");
        let cleanup_log = fixture.join("cleanup.log");
        let timeout_marker = fixture.join("timeout.marker");
        let system_path = env::var("PATH")?;
        let output = Command::new("bash")
            .arg(RepositoryFixture::repository_root().join(".github/scripts/remote-task-batch.sh"))
            .args(["--run", "preflight,rust:ci"])
            .env("PATH", format!("{}:{system_path}", fixture.display()))
            .env("TASK_LOG", &task_log)
            .env("CLEANUP_LOG", &cleanup_log)
            .env("TIMEOUT_MARKER", &timeout_marker)
            .env("MOCK_TIMEOUT_STATUS", timeout_status.to_string())
            .env("NOOK_PR_BUILDX_BUILDER", "remote-builder")
            .output()?;

        assert!(!output.status.success());
        assert_eq!(
            fs::read_to_string(&task_log)?,
            "task preflight\ntask ci:pr:rust\n",
            "a timed-out task must not block the next selection"
        );
        let cleanup_log = fs::read_to_string(&cleanup_log)?;
        assert!(cleanup_log.contains("docker buildx inspect --bootstrap remote-builder"));
        assert!(cleanup_log.contains("git restore --source=HEAD --staged --worktree -- ."));
        assert!(cleanup_log.contains("git clean -fd"));

        fs::remove_dir_all(fixture)?;
    }
    Ok(())
}

#[test]
fn expensive_remote_validation_requires_the_current_base() -> Result<()> {
    let remote_tasks = RepositoryFixture::repository_root().read(".task/remote-execution.yml");
    assert!(remote_tasks.contains(
        "if [ \"$requested_tasks\" != \"build:compile\" ]; then\n          .github/scripts/require-current-base.sh origin main\n        fi"
    ));
    assert!(remote_tasks.contains("baseRefName"));

    let status = Command::new("bash")
        .arg(
            RepositoryFixture::repository_root()
                .join(".github/scripts/require-current-base.test.sh"),
        )
        .status()?;
    assert!(status.success(), "base freshness behavior tests must pass");
    Ok(())
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one ARC contract verifies the full named-task workflow"
)]
fn arc_workflow_runs_named_task_targets() -> Result<()> {
    let remote_tasks = RepositoryFixture::repository_root().read(".task/remote-execution.yml");
    let workflow = RepositoryFixture::repository_root().read(".github/workflows/remote.yml");
    let batch_script =
        RepositoryFixture::repository_root().read(".github/scripts/remote-task-batch.sh");

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
    let docker_setup_position = workflow
        .find("uses: ./.github/actions/nook-docker-setup")
        .context("Remote execution must install Task and configure BuildKit")?;
    let batch_position = workflow
        .find("remote-task-batch.sh --run \"$REQUESTED_REMOTE_TASKS\"")
        .context("remote execution must run the named task batch")?;
    assert!(docker_setup_position < batch_position);
    assert!(workflow.contains("(inputs.tasks || inputs.task) == 'loom:verify' && 'preflight'"));
    for forbidden in [
        "dtolnay/rust-toolchain",
        "Swatinem/rust-cache",
        "command -v cargo",
    ] {
        assert!(
            !workflow.contains(forbidden),
            "Remote Rust must use Docker: {forbidden}"
        );
    }
    assert!(batch_script.contains(
        "rust:ci) run_with_timeout \"$timeout_minutes\" env CI_ARTIFACT_DIR=\"$artifact_root/rust-ci\" task ci:pr:rust"
    ));
    assert!(
        batch_script.contains(
            "loom:verify) run_with_timeout \"$timeout_minutes\" task preflight:loom-verify"
        )
    );
    assert!(batch_script.contains("docker buildx use \"$builder\""));
    assert!(batch_script.contains("if ! restore_hosted_builder; then"));
    let docker_setup =
        RepositoryFixture::repository_root().read(".github/actions/nook-docker-setup/action.yml");
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
    Ok(())
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one remote-check contract verifies every narrow image route"
)]
fn frequent_remote_checks_use_narrow_source_sealed_images() -> Result<()> {
    let app_tasks = RepositoryFixture::repository_root().read("nook-app/Taskfile.yml");
    let core_tasks =
        RepositoryFixture::repository_root().read("nook-app/nook-platform/Taskfile.yml");
    let web_tasks = RepositoryFixture::repository_root().read("nook-app/nook-web/Taskfile.yml");
    let extension_tasks = RepositoryFixture::repository_root()
        .read("nook-app/nook-web/nook-web-extension/Taskfile.yml");
    let product_dockerfile = RepositoryFixture::repository_root()
        .read("nook-app/nook-platform/docker/rust/product.Dockerfile");
    let test_dockerfile = docker_stage(&product_dockerfile, "nook-rust-test");
    let lint_dockerfile = docker_stage(&product_dockerfile, "nook-rust-lint");
    let coverage_dockerfile = docker_stage(&product_dockerfile, "nook-rust-coverage");
    let product_dockerignore = RepositoryFixture::repository_root()
        .read("nook-app/nook-platform/docker/rust/product.Dockerfile.dockerignore");
    let core_bake = RepositoryFixture::repository_root()
        .read("nook-app/nook-platform/nook-core/docker-bake.hcl");
    let wasm_bake = RepositoryFixture::repository_root()
        .read("nook-app/nook-platform/nook-wasm/docker-bake.hcl");
    let web_app_bake =
        RepositoryFixture::repository_root().read("nook-app/nook-web/nook-web-app/docker-bake.hcl");
    let wasm_dockerfile = product_dockerfile.as_str();
    let shared_bake = RepositoryFixture::repository_root().read("nook-app/docker-bake.hcl");
    let bake = format!("{shared_bake}\n{core_bake}\n{wasm_bake}\n{web_app_bake}");

    let focused_web_setup = app_tasks
        .split("  setup:web:focused:\n")
        .nth(1)
        .context("focused web setup task must exist")?;
    assert!(
        focused_web_setup.contains("NOOK_EXTENSION_COMMIT: \"{{.NOOK_EXTENSION_COMMIT}}\"")
            && web_app_bake.contains("NOOK_SOURCE_REVISION    = NOOK_EXTENSION_COMMIT"),
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
    let bake = RepositoryFixture::repository_root().read("nook-app/docker-bake.hcl");
    let prepare = bake
        .split("group \"prepare\" {\n")
        .nth(1)
        .and_then(|remainder| remainder.split("\n}").next())
        .unwrap_or_else(|| panic!("prepare Bake group must exist"));
    assert!(
        prepare.contains("\"builder-debug\""),
        "broad setup must select builder-debug so its dedicated Zot exporter runs"
    );

    let pr = RepositoryFixture::repository_root().read(".github/workflows/pr.yml");
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
    let remote_tasks = RepositoryFixture::repository_root().read(".task/remote-execution.yml");
    let pr = RepositoryFixture::repository_root().read(".github/workflows/pr.yml");
    let remote_doc = RepositoryFixture::repository_root()
        .read(".cortex/teams/sre/workflows/remote-execution.md");

    assert!(pr.contains("workflow_call:"));
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
            pr.contains("inputs.validation_requested"),
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
        .map(|(_, job)| job)
        .context("PR workflow must keep the full browser e2e job")?;
    let full_extension_e2e = pr
        .split_once("\n  extension-e2e:\n")
        .and_then(|(_, tail)| tail.split_once("\n  preview:\n"))
        .map(|(job, _)| job)
        .context("PR workflow must keep the extension e2e job")?;
    let full_e2e_request = "inputs.full_e2e_requested";
    assert!(
        full_e2e.contains(full_e2e_request) && full_extension_e2e.contains(full_e2e_request),
        "the central full-e2e request must keep both full e2e jobs active"
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
        "pr_state=\"$(gh pr view \"$REQUESTED_PR\"",
        "if [ \"$local_sha\" != \"$pr_sha\" ]",
        "--remove-label \"$validation_label\"",
        "--add-label \"$validation_label\"",
        "task remote TASK_NAME=rust:ci",
        "task remote TASK_NAME=loom:verify",
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
    RepositoryFixture::repository_root()
        .read(".github/workflows/remote.yml")
        .contains(required)
        || RepositoryFixture::repository_root()
            .read("nook-app/nook-platform/docker/Taskfile.yml")
            .contains(required)
        || RepositoryFixture::repository_root()
            .read("nook-app/nook-web/docker/Taskfile.yml")
            .contains(required)
}
