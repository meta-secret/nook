use std::{collections::BTreeSet, fs, path::PathBuf};

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
    let core_tasks = read("nook-app/.task/core.yml");
    let web_tasks = read("nook-app/nook-web/.task/web.yml");
    let extension_tasks = read("nook-app/nook-web/.task/extension.yml");
    let base_dockerfile = read("nook-app/docker/base.Dockerfile");
    let core_bake = read("nook-app/nook-core/docker-bake.hcl");
    let wasm_dockerfile = read("nook-app/nook-wasm/Dockerfile");
    let bake = read("nook-app/docker-bake.hcl");

    for required in [
        "setup:rust:test:",
        "nook-rust-test",
        "setup:web:focused:",
        "focused-web-artifacts",
        "nook-web-focused",
    ] {
        assert!(
            app_tasks.contains(required) || bake.contains(required),
            "focused sealed-image contract missing: {required}"
        );
    }
    assert!(core_tasks.contains("remote:rust:test:"));
    assert!(core_tasks.contains("remote:rust:lint:"));
    assert!(core_tasks.contains("remote:rust:coverage:"));
    assert!(web_tasks.contains("remote:web:check:"));
    assert!(web_tasks.contains("remote:web:test:"));
    assert!(extension_tasks.contains("remote:extension:check:"));
    assert!(base_dockerfile.contains("FROM builder-deps AS nook-rust-test"));
    assert!(base_dockerfile.contains("-type f -name '*.rs' -exec touch {} +"));
    assert!(base_dockerfile.contains("focused-native-test-compile"));
    assert!(base_dockerfile.contains("focused-rust-lint-compile"));
    assert!(base_dockerfile.contains("focused-rust-coverage-compile"));
    assert!(base_dockerfile.contains("--no-run"));
    for (target, compile_marker) in [
        ("nook-rust-test", "focused-native-test-compile"),
        ("nook-rust-lint", "focused-rust-lint-compile"),
        ("nook-rust-coverage", "focused-rust-coverage-compile"),
    ] {
        let stage = base_dockerfile
            .split(&format!("AS {target}\n"))
            .nth(1)
            .and_then(|remainder| remainder.split("\nFROM ").next())
            .unwrap_or_else(|| panic!("focused Dockerfile stage must exist: {target}"));
        let compile = stage
            .find(compile_marker)
            .unwrap_or_else(|| panic!("focused compile marker must exist: {compile_marker}"));
        let full_checkout = stage
            .find("COPY . .")
            .unwrap_or_else(|| panic!("focused stage must seal the full checkout: {target}"));
        assert!(
            compile < full_checkout,
            "{target} must compile from narrow Rust inputs before copying the full checkout"
        );
        assert!(
            stage[..compile].contains("COPY nook-app/Cargo.toml nook-app/Cargo.lock nook-app/")
        );
        assert!(stage[..compile].contains("COPY nook-app/.cargo nook-app/.cargo"));
        assert!(stage[..compile].contains("COPY nook-app/.config nook-app/.config"));
        assert!(stage[..compile].contains("COPY nook-app/nook-core nook-app/nook-core"));
    }
    assert!(wasm_dockerfile.contains("FROM builder-wasm-build AS focused-web-artifacts-source"));
    assert!(wasm_dockerfile.contains("FROM scratch AS focused-web-artifacts"));
    assert!(bake.contains("inherits = [\"_nook-rust-test-common\"]"));
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
        assert!(stage.contains("dockerfile = \"nook-app/docker/base.Dockerfile\""));
        assert!(!stage.contains("builder-deps = \"target:builder-deps\""));
    }
    assert!(bake.contains("inherits = [\"_nook-web-focused-common\"]"));
    assert!(!bake.contains("target \"nook-rust-test\" {\n  inherits = [\"_nook-rust-common\"]"));
    assert!(!bake.contains("target \"nook-web-focused\" {\n  inherits = [\"_nook-web-common\"]"));
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
        || read("nook-app/docker/Taskfile.yml").contains(required)
}
