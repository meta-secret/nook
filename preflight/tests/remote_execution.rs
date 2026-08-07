use std::{collections::BTreeSet, fs, path::PathBuf, process::Command};

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

fn catalog_from_taskfile(taskfile: &str) -> BTreeSet<&str> {
    taskfile
        .split("case \"$requested_task\" in")
        .nth(1)
        .and_then(|content| content.split(") ;;").next())
        .unwrap_or_else(|| panic!("remote Taskfile must contain an allowlist case"))
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_else(|| panic!("remote Taskfile allowlist must not be empty"))
        .split('|')
        .collect()
}

#[test]
fn remote_task_catalog_is_allowlisted_and_exact_head_only() {
    let root_tasks = read("Taskfile.yml");
    let remote_tasks = read(".task/remote-execution.yml");

    assert!(root_tasks.contains("taskfile: .task/remote-execution.yml"));
    for required in [
        "requires:\n      vars: [TASK_NAME]",
        "requested_task=\"$REQUESTED_REMOTE_TASK\"",
        "git status --porcelain",
        "git ls-remote --refs origin",
        "if [ \"$remote_sha\" != \"$local_sha\" ]",
        "gh workflow run remote.yml",
        "--raw-field \"task=$requested_task\"",
        "task remote:list",
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
fn expensive_remote_validation_requires_the_current_base() -> std::io::Result<()> {
    let remote_tasks = read(".task/remote-execution.yml");
    assert!(remote_tasks.contains("web:e2e|extension:e2e|check|ci:pr|ci:pr:e2e)"));
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
fn hosted_workflow_matches_the_taskfile_catalog() {
    let remote_tasks = read(".task/remote-execution.yml");
    let workflow = read(".github/workflows/remote.yml");
    let task_catalog = catalog_from_taskfile(&remote_tasks);

    for task in &task_catalog {
        assert!(
            workflow.contains(&format!("          - {task}\n")),
            "remote workflow input is missing catalog task: {task}"
        );
        assert!(
            workflow.contains(&format!("if: inputs.task == '{task}'")),
            "remote workflow has no selected job for task: {task}"
        );
    }

    assert_eq!(
        workflow.matches("if: inputs.task == '").count(),
        task_catalog.len(),
        "every selected remote job must correspond to exactly one Taskfile allowlist entry"
    );
    assert_eq!(
        workflow.matches("runs-on: ubuntu-latest").count(),
        task_catalog.len(),
        "every catalog task must run on its own GitHub-hosted job"
    );
    assert!(!workflow.contains("runs-on: nook"));
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
    assert!(workflow.contains("group: remote-${{ github.ref }}-${{ inputs.task }}"));
    assert!(workflow.contains("cache-write: \"false\""));
    assert!(workflow.contains("main-cache-only: \"true\""));
    assert_eq!(
        workflow.matches("isolated-cache-write: \"true\"").count(),
        task_catalog.len(),
        "every Remote task must write only its branch-and-task Zot namespace"
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
            workflow.contains(&format!("- run: task {focused}")),
            "frequent remote task {requested} must use its narrow source-sealed route"
        );
    }
    assert_eq!(
        workflow.matches("- run: task remote:").count(),
        6,
        "only the mechanically reviewed focused routes may bypass their full local task"
    );
    assert!(!workflow.contains("- run: task rust:test\n"));
    assert!(!workflow.contains("- run: task rust:lint\n"));
    assert!(!workflow.contains("- run: task rust:coverage\n"));
    assert!(!workflow.contains("- run: task web:check\n"));
    assert!(!workflow.contains("- run: task web:test\n"));
    assert!(!workflow.contains("- run: task extension:check\n"));
}

#[test]
fn frequent_remote_checks_use_narrow_source_sealed_images() {
    let app_tasks = read("nook-app/Taskfile.yml");
    let core_tasks = read("nook-app/nook-platform/Taskfile.yml");
    let web_tasks = read("nook-app/nook-web/Taskfile.yml");
    let extension_tasks = read("nook-app/nook-web/nook-web-extension/Taskfile.yml");
    let lineage_dockerfile = read("nook-app/nook-platform/docker/rust/lineage.Dockerfile");
    let test_dockerfile = read("nook-app/nook-platform/docker/rust/nook-rust-test.Dockerfile");
    let lint_dockerfile = read("nook-app/nook-platform/docker/rust/nook-rust-lint.Dockerfile");
    let coverage_dockerfile =
        read("nook-app/nook-platform/docker/rust/nook-rust-coverage.Dockerfile");
    let base_dockerignore =
        read("nook-app/nook-platform/docker/rust/nook-rust-test.Dockerfile.dockerignore");
    let lineage_dockerignore =
        read("nook-app/nook-platform/docker/rust/lineage.Dockerfile.dockerignore");
    let core_bake = read("nook-app/nook-platform/nook-core/docker-bake.hcl");
    let wasm_dockerfile = read("nook-app/nook-platform/nook-wasm/Dockerfile");
    let bake = read("nook-app/docker-bake.hcl");

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
        lineage_dockerfile.contains("FROM rust-base AS chef-deps")
            && lineage_dockerfile.contains("FROM builder-wasm-deps AS builder-core-deps")
            && lineage_dockerfile.contains("FROM builder-core-deps AS rust-platform")
            && lineage_dockerfile.contains("COPY nook-app/nook-platform/ nook-app/nook-platform/")
            && !lineage_dockerfile.contains("AS nook-rust-test")
            && !lineage_dockerfile.contains("AS nook-rust-lint")
            && !lineage_dockerfile.contains("AS nook-rust-coverage"),
        "lineage.Dockerfile must own deps + rust-platform without focused leaves"
    );
    for ignored in [
        "**/docker-bake.hcl",
        "nook-app/nook-platform/nook-core/Dockerfile",
        "nook-app/nook-platform/nook-core/coverage-floor.json",
        "nook-app/nook-platform/nook-wasm/Dockerfile",
        "nook-app/nook-platform/nook-wasm/LICENSE",
    ] {
        assert!(
            base_dockerignore.lines().any(|line| line == ignored),
            "focused Rust context must ignore non-compiler input: {ignored}"
        );
    }
    for ignored in [
        "nook-app/nook-platform/docker",
        "nook-app/nook-platform/Taskfile.yml",
        "**/target",
    ] {
        assert!(
            lineage_dockerignore.lines().any(|line| line == ignored),
            "rust-platform COPY context must ignore non-source input: {ignored}"
        );
    }
    assert!(
        core_bake.contains("target \"rust-platform\"")
            && core_bake.contains("builder-core-deps = \"target:builder-core-deps\""),
        "rust-platform Bake target must restore builder-core-deps via named context"
    );
    for (label, stage, compile_marker) in [
        (
            "test",
            test_dockerfile.as_str(),
            "focused-native-test-compile",
        ),
        (
            "lint",
            lint_dockerfile.as_str(),
            "focused-rust-lint-compile",
        ),
        (
            "coverage",
            coverage_dockerfile.as_str(),
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
    assert!(bake.contains("inherits = [\"_nook-rust-test-common\"]"));
    for (target, dockerfile) in [
        ("_nook-rust-test-common", "nook-rust-test.Dockerfile"),
        ("_nook-rust-lint-common", "nook-rust-lint.Dockerfile"),
        (
            "_nook-rust-coverage-common",
            "nook-rust-coverage.Dockerfile",
        ),
    ] {
        let stage = core_bake
            .split(&format!("target \"{target}\" {{\n"))
            .nth(1)
            .and_then(|remainder| remainder.split("\n}").next())
            .unwrap_or_else(|| panic!("focused Bake target must exist: {target}"));
        assert!(stage.contains(&format!(
            "dockerfile = \"nook-app/nook-platform/docker/rust/{dockerfile}\""
        )));
        assert!(
            stage.contains("builder-core-deps = \"target:builder-core-deps\""),
            "{target} must take builder-core-deps via Bake named context"
        );
    }
    assert!(bake.contains("inherits = [\"_nook-web-focused-common\"]"));
    assert!(!bake.contains("target \"nook-rust-test\" {\n  inherits = [\"_nook-rust-common\"]"));
    assert!(!bake.contains("target \"nook-web-focused\" {\n  inherits = [\"_nook-web-common\"]"));
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
fn complete_pr_validation_is_explicit_and_exact_head_bound() {
    let remote_tasks = read(".task/remote-execution.yml");
    let pr = read(".github/workflows/pr.yml");
    let remote_doc = read(".cortex/workflows/remote-execution.md");

    assert!(pr.contains("types: [labeled, closed]"));
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
    assert_eq!(
        pr.matches("contains(github.event.pull_request.labels.*.name, 'ci:full-e2e')")
            .count(),
        2,
        "a persistent Main-fix label must keep both full e2e jobs active"
    );
    for required in [
        "E2E_ARTIFACT_DIR=${{ runner.temp }}/nook-e2e-artifacts",
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
        "Any later push changes the PR head",
    ] {
        assert!(
            remote_tasks.contains(required) || remote_doc.contains(required),
            "remote execution contract missing: {required}"
        );
    }
}

fn workflow_or_remote_tasks(required: &str) -> bool {
    read(".github/workflows/remote.yml").contains(required)
        || read("nook-app/nook-platform/docker/Taskfile.yml").contains(required)
        || read("nook-app/nook-web/docker/Taskfile.yml").contains(required)
}
