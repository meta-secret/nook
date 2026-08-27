use super::*;

#[test]
fn fast_wasm_build_reuses_manifest_keyed_dependencies_outside_the_source_mount()
-> anyhow::Result<()> {
    let root = repository_root();
    let wasm_tasks = read(&root, "nook-app/nook-platform/nook-wasm/Taskfile.yml");
    assert!(
        wasm_tasks.contains("wasm:build:fast:")
            && wasm_tasks.contains("- setup:rust:fast")
            && !wasm_tasks
                .split("wasm:build:fast:")
                .nth(1)
                .unwrap_or_default()
                .split("wasm:build:prod:")
                .next()
                .unwrap_or_default()
                .contains("- setup:rust\n"),
        "the mounted fast path must not build the source-sealed Rust image"
    );

    let app_tasks = read(&root, "nook-app/Taskfile.yml");
    let platform_tasks = read(&root, "nook-app/nook-platform/Taskfile.yml");
    assert!(
        (app_tasks.contains("setup:rust:fast:") || platform_tasks.contains("setup:rust:fast:"))
            && (app_tasks.contains("nook-rust-fast") || platform_tasks.contains("nook-rust-fast")),
        "the fast setup must load the manifest-keyed development image"
    );
    let platform_docker_taskfile = read(&root, "nook-app/nook-platform/docker/Taskfile.yml");
    let web_docker_taskfile = read(&root, "nook-app/nook-web/docker/Taskfile.yml");
    let preflight_taskfile = read(&root, "preflight/Taskfile.yml");
    for (label, body) in [
        ("nook-app/Taskfile.yml", app_tasks.as_str()),
        (
            "nook-app/nook-platform/docker/Taskfile.yml",
            platform_docker_taskfile.as_str(),
        ),
        (
            "nook-app/nook-web/docker/Taskfile.yml",
            web_docker_taskfile.as_str(),
        ),
        ("preflight/Taskfile.yml", preflight_taskfile.as_str()),
    ] {
        assert!(
            !body.contains("buildx --builder")
                && !body.contains("BUILDX_BUILDER")
                && !body.contains("DOCKER_LOAD_BUILDER"),
            "{label} must never pass buildx --builder or keep BUILDX_BUILDER/DOCKER_LOAD_BUILDER vars"
        );
    }

    let docker_tasks = read(&root, "nook-app/nook-platform/docker/Taskfile.yml");
    assert!(
        docker_tasks.contains("CARGO_TARGET_DIR=/opt/nook/cargo-target")
            && docker_tasks.contains("{{.DOCKER_RUST_FAST_IMAGE}}"),
        "the mounted build must use the dependency image target directory outside the bind mount"
    );

    let dockerfile = read(
        &root,
        "nook-app/nook-platform/docker/rust/product.Dockerfile",
    );
    assert!(
        dockerfile.contains("FROM builder-wasm-deps AS nook-rust-fast")
            && dockerfile.contains(
                "mv /meta-secret/nook/nook-app/nook-platform/target /opt/nook/cargo-target",
            )
            && dockerfile.contains("ENV CARGO_TARGET_DIR=/opt/nook/cargo-target"),
        "the fast image must preserve its compiled dependency graph outside /meta-secret/nook"
    );
    Ok(())
}

#[test]
fn production_vault_apps_share_one_wasm_build() -> anyhow::Result<()> {
    let root = repository_root();
    assert_shared_wasm_build_contract(&root);
    Ok(())
}

#[test]
fn production_vault_wasm_is_preloaded_size_optimized_and_budgeted() {
    let root = repository_root();
    for manifest in [
        "nook-app/nook-platform/nook-wasm/Cargo.toml",
        "nook-app/nook-platform/nook-companion-wasm/Cargo.toml",
    ] {
        let cargo = read(&root, manifest);
        assert!(cargo.contains("[package.metadata.wasm-pack.profile.release]"));
        assert!(cargo.contains("wasm-opt = [\"-Oz\"]"));
    }

    let vite = read(&root, "nook-app/nook-web/nook-web-shared/vite-config.ts");
    for required in [
        "nook_wasm_bg",
        "rel: \"preload\"",
        "as: \"fetch\"",
        "type: \"application/wasm\"",
    ] {
        assert!(vite.contains(required));
    }

    let verifier = read(
        &root,
        "nook-app/nook-web/nook-web-app/scripts/verify-app-isolation.ts",
    );
    for required in [
        "VAULT_WASM_RAW_SIZE_LIMIT",
        "VAULT_WASM_BROTLI_SIZE_LIMIT",
        "nook_companion_wasm",
        "must contain exactly one vault WASM asset",
        "configureVaultExtensionConnectScopeRuntime",
        "extension_vault_access_scope",
        "is_extension_connect_scope",
    ] {
        assert!(verifier.contains(required));
    }

    let extension_scope = read(
        &root,
        "nook-app/nook-web/nook-web-shared/src/extension/extension-connect-scope.ts",
    );
    assert!(extension_scope.contains("configureExtensionConnectScopeRuntime"));
    assert!(extension_scope.contains("ExtensionConnectScope as RustExtensionConnectScope"));
    assert!(
        extension_scope.contains("export type ExtensionConnectScope = RustExtensionConnectScope")
    );
    assert!(!extension_scope.contains("extensionConnectScopeBrand"));

    let vault_wasm = read(&root, "nook-app/nook-platform/nook-wasm/src/lib.rs");
    for required in [
        "extension_vault_access_scope",
        "extension_password_filling_scope",
        "is_extension_connect_scope",
        ") -> nook_companion_core::ExtensionConnectScope",
    ] {
        assert!(vault_wasm.contains(required));
    }
}

fn assert_shared_wasm_build_contract(root: &Path) {
    for project in ["nook-vault-simple", "nook-vault-sentinel"] {
        assert!(
            root.join("nook-app/nook-web")
                .join(project)
                .join("package.json")
                .is_file(),
            "{project} must remain an independent web project"
        );
    }

    let workspace = read(root, "nook-app/nook-platform/Cargo.toml");
    assert!(
        !workspace.contains("nook-wasm/apps/"),
        "application wrappers must not recompile the shared WASM library"
    );
    let application = read(root, "nook-app/nook-platform/nook-wasm/src/application.rs");
    assert!(application.contains("compiles and optimizes one shared WASM library"));
    assert!(application.contains("cannot change it"));

    let wasm_dockerfile = read(
        root,
        "nook-app/nook-platform/docker/rust/product.Dockerfile",
    );
    assert!(
        wasm_dockerfile.matches("wasm-pack build nook-wasm").count() == 1,
        "delivery must compile and optimize nook-wasm exactly once"
    );
    assert!(
        wasm_dockerfile
            .matches("wasm-pack build nook-companion-wasm")
            .count()
            == 1,
        "delivery must compile the tiny companion WASM package exactly once"
    );
    for forbidden in [
        "nook-wasm/apps/",
        "nook-wasm-simple",
        "nook-wasm-sentinel",
        "nook-wasm-extension",
        "nook-wasm-migration",
    ] {
        assert!(
            !wasm_dockerfile.contains(forbidden),
            "WASM Dockerfile still contains retired artifact {forbidden}"
        );
    }
    let wasm_tasks = read(root, "nook-app/nook-platform/nook-wasm/Taskfile.yml");
    assert_eq!(
        wasm_tasks.matches("wasm-pack build nook-wasm").count(),
        1,
        "the fast rebuild path must compile the shared vault WASM package once"
    );
    assert_eq!(
        wasm_tasks
            .matches("wasm-pack build nook-companion-wasm")
            .count(),
        1,
        "the fast rebuild path must compile the companion WASM package once"
    );
    for forbidden in [
        "nook-wasm-simple",
        "nook-wasm-sentinel",
        "nook-wasm-extension",
        "nook-wasm-migration",
        "app-simple",
        "app-sentinel",
        "app-extension",
        "app-legacy-migration",
    ] {
        assert!(
            !wasm_tasks.contains(forbidden),
            "fast WASM rebuild still contains retired artifact or feature {forbidden}"
        );
    }
    let web_dockerfile = read(root, "nook-app/nook-web/nook-web-app/Dockerfile");
    assert_eq!(
        web_dockerfile
            .matches("COPY --from=web-artifacts /nook-wasm ")
            .count(),
        1,
        "web build must receive the nested WASM handoff once"
    );
    assert!(
        web_dockerfile.contains("nook-companion-wasm")
            && web_dockerfile.contains("extension/nook-companion-wasm"),
        "web build must split the companion package into the extension import root"
    );
}

#[test]
fn focused_playwright_task_runs_only_matching_projects() -> anyhow::Result<()> {
    let root = repository_root();
    let web_tasks = read(&root, "nook-app/nook-web/Taskfile.yml");
    let focused = section(
        &web_tasks,
        "  _web:test:e2e:file:",
        "  _web:test:e2e:pr:parallel:",
    );
    assert!(
        focused.contains("bun x playwright test ${E2E_SPEC}"),
        "focused e2e must invoke Playwright directly for the requested specs"
    );
    assert!(
        !focused.contains("bun run test:e2e --") && !focused.contains("--project=e2e"),
        "focused e2e must not expand into the full stable/unstable scripts or select a nonexistent project"
    );
    Ok(())
}

#[test]
fn extension_e2e_waits_for_a_persistent_x_server() -> anyhow::Result<()> {
    let root = repository_root();
    let wrapper = read(
        &root,
        "nook-app/nook-web/nook-web-extension/scripts/run-with-xvfb.sh",
    );
    for required in [
        "Xvfb -displayfd 3 -screen 0 1280x720x24 -noreset",
        "if [ -s \"$display_file\" ]",
        "kill -0 \"$xvfb_pid\"",
        "Xvfb exited while the browser suite was running",
    ] {
        assert!(
            wrapper.contains(required),
            "extension e2e Xvfb wrapper missing resilience contract: {required}"
        );
    }

    for script in ["test-e2e.sh", "test-hosted-smoke.sh"] {
        let contents = read(
            &root,
            &format!("nook-app/nook-web/nook-web-extension/scripts/{script}"),
        );
        assert!(
            contents.contains("bash scripts/run-with-xvfb.sh"),
            "{script} must use the readiness-checked Xvfb wrapper"
        );
    }

    let playwright = read(
        &root,
        "nook-app/nook-web/nook-web-extension/playwright.config.ts",
    );
    assert!(
        playwright.contains("...(isCi ? { workers: 1 } : {})"),
        "hosted headed extension tests must not compete for Chromium/Xvfb resources"
    );
    Ok(())
}

#[test]
fn main_failures_do_not_trigger_an_ai_repair_agent() -> anyhow::Result<()> {
    let root = repository_root();
    let main = read(&root, ".github/workflows/main.yml");
    assert!(
        !main.contains("\n  ci-fix:") && !main.contains("task ci-agent:fix"),
        "main failures must remain visible for manual handling"
    );
    Ok(())
}

#[test]
fn scheduled_nightly_live_sync_is_retired() -> anyhow::Result<()> {
    let root = repository_root();
    assert!(
        !root.join(".github/workflows/e2e-nightly.yml").exists(),
        "live-provider sync checks must not have a scheduled workflow"
    );

    let manual_e2e = read(&root, ".github/workflows/e2e-pr.yml");
    assert!(
        manual_e2e.contains("- sync-live")
            && manual_e2e.contains("NOOK_E2E_SYNC_PROVIDER: github")
            && manual_e2e.contains("task _web:test:e2e:sync-live:parallel")
            && manual_e2e.contains("- name: Clean up live-sync test repository")
            && manual_e2e.contains("if: >-\n          always() &&")
            && manual_e2e.contains("github.rest.users.getAuthenticated()")
            && manual_e2e.contains("github.rest.repos.delete({ owner: user.login, repo })"),
        "manual PR e2e must retain explicit GitHub live-provider validation with cancellation-safe cleanup"
    );
    Ok(())
}

#[test]
fn delivery_avoids_a_shared_buildkit_container() -> anyhow::Result<()> {
    let root = repository_root();
    let pr = read(&root, ".github/workflows/pr.yml");
    assert!(
        !pr.contains("docker buildx prune") && !pr.contains("BUILDX_BUILDER"),
        "PR workflow must delegate builder health and selection to the wrapper"
    );

    let ci = read(&root, "nook-app/ci/Taskfile.yml");
    for required in [
        "task: _buildx:healthy",
        "vars: { BUILD_TASK: _ci:pr:host }",
        "vars: { BUILD_TASK: _ci:pr:e2e:host }",
        "vars: { BUILD_TASK: _ci:main:host }",
        "vars: { BUILD_TASK: _ci:main:prepare-images:host }",
        "vars: { BUILD_TASK: _ci:main:web-e2e:host }",
        "job-scoped or daemon BuildKit",
    ] {
        assert!(
            ci.contains(required),
            "delivery CI must enter the health-checked BuildKit wrapper: {required}"
        );
    }

    let wrapper = read(&root, ".github/scripts/with-healthy-buildkit.sh");
    for required in [
        "builder=\"${NOOK_PR_BUILDX_BUILDER:-}\"",
        "refusing shared BuildKit builder name 'nook-pr'",
        "Using default docker buildx builder",
        "Taskfiles must not pass --builder",
        "NOOK_BUILDKIT_HEALTH_TIMEOUT_SECONDS:-60",
        "buildx inspect \"$builder\" --bootstrap",
        "buildx build",
        "--output type=cacheonly",
        "run_with_timeout \"$health_timeout\"",
        "set -m",
        "kill -TERM -- \"-$command_pid\"",
        "kill -KILL -- \"-$command_pid\"",
        "rm --force \"$container\"",
        "volume rm --force \"$state_volume\"",
        "--driver docker-container",
        "--bootstrap",
        "Using healthy job-scoped BuildKit builder",
        "buildx use \"$builder\"",
    ] {
        assert!(
            wrapper.contains(required),
            "health-checked BuildKit wrapper missing lifecycle contract: {required}"
        );
    }
    assert!(
        !wrapper.contains("NOOK_PR_BUILDX_BUILDER:-nook-pr")
            && !wrapper.contains("trap cleanup EXIT")
            && !wrapper.contains("BUILDX_BUILDER="),
        "delivery must not default to shared nook-pr or export BUILDX_BUILDER for Taskfiles"
    );
    Ok(())
}

#[test]
fn stuck_pr_buildkit_probe_is_killed_and_replaced_within_its_deadline() -> anyhow::Result<()> {
    let root = repository_root();
    let unique = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let temp = std::env::temp_dir().join(format!(
        "nook-buildkit-health-{}-{unique}",
        std::process::id()
    ));
    fs::create_dir_all(&temp)?;

    let fake_docker = temp.join("docker");
    let docker_log = temp.join("docker.log");
    let child_pid_file = temp.join("docker-child.pid");
    let command_marker = temp.join("command-ran");
    fs::write(
        &fake_docker,
        r#"#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
if [ "${1:-}" = buildx ] && [ "${2:-}" = inspect ]; then
  sleep 30 &
  child_pid=$!
  printf '%s\n' "$child_pid" > "$FAKE_DOCKER_CHILD_PID"
  wait "$child_pid"
fi
"#,
    )?;
    let mut permissions = fs::metadata(&fake_docker)?.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&fake_docker, permissions)?;

    let started = Instant::now();
    let output = Command::new("bash")
        .arg(root.join(".github/scripts/with-healthy-buildkit.sh"))
        .args(["bash", "-c", "printf ok > \"$1\"", "nook-test"])
        .arg(&command_marker)
        .env("DOCKER", &fake_docker)
        .env("FAKE_DOCKER_LOG", &docker_log)
        .env("FAKE_DOCKER_CHILD_PID", &child_pid_file)
        .env("NOOK_PR_BUILDX_BUILDER", "nook-pr-timeout-test")
        .env("NOOK_BUILDKIT_HEALTH_TIMEOUT_SECONDS", "1")
        .env("NOOK_BUILDKIT_CLEANUP_TIMEOUT_SECONDS", "2")
        .output()?;
    let elapsed = started.elapsed();

    assert!(
        output.status.success(),
        "wrapper failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        elapsed < Duration::from_secs(12),
        "one-second probe timeout took {elapsed:?}"
    );
    assert_eq!(fs::read_to_string(&command_marker)?, "ok");
    let child_pid = fs::read_to_string(&child_pid_file)?;
    assert!(
        !Command::new("kill")
            .args(["-0", child_pid.trim()])
            .output()?
            .status
            .success(),
        "timed Docker child {child_pid:?} survived process-group cleanup"
    );

    let calls = fs::read_to_string(&docker_log)?;
    for required in [
        "buildx inspect nook-pr-timeout-test --bootstrap",
        "rm --force buildx_buildkit_nook-pr-timeout-test0",
        "buildx rm --force nook-pr-timeout-test",
        "volume rm --force buildx_buildkit_nook-pr-timeout-test0_state",
        "buildx create --name nook-pr-timeout-test --driver docker-container --bootstrap",
        "buildx use nook-pr-timeout-test",
    ] {
        assert!(
            calls.contains(required),
            "missing recovery call: {required}"
        );
    }

    fs::remove_dir_all(temp)?;
    Ok(())
}

#[test]
fn local_delivery_uses_daemon_buildkit_instead_of_a_shared_container() -> anyhow::Result<()> {
    let root = repository_root();
    let unique = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let temp = std::env::temp_dir().join(format!(
        "nook-buildkit-daemon-{}-{unique}",
        std::process::id()
    ));
    fs::create_dir_all(&temp)?;

    let fake_docker = temp.join("docker");
    let docker_log = temp.join("docker.log");
    let command_marker = temp.join("command-ran");
    fs::write(&docker_log, "")?;
    fs::write(
        &fake_docker,
        r#"#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
"#,
    )?;
    let mut permissions = fs::metadata(&fake_docker)?.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&fake_docker, permissions)?;

    let output = Command::new("bash")
        .arg(root.join(".github/scripts/with-healthy-buildkit.sh"))
        .args(["bash", "-c", "printf ok > \"$1\"", "nook-test"])
        .arg(&command_marker)
        .env("DOCKER", &fake_docker)
        .env("FAKE_DOCKER_LOG", &docker_log)
        .env_remove("NOOK_PR_BUILDX_BUILDER")
        .env_remove("BUILDX_BUILDER")
        .output()?;

    assert!(
        output.status.success(),
        "wrapper failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(fs::read_to_string(&command_marker)?, "ok");
    let calls = fs::read_to_string(&docker_log)?;
    assert!(
        !calls.contains("buildx create")
            && !calls.contains("buildx inspect")
            && !calls.contains("buildx use"),
        "local delivery must not create, probe, or switch a docker-container BuildKit"
    );
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("Using default docker buildx builder"),
        "local delivery must advertise the default builder path"
    );

    let refused = Command::new("bash")
        .arg(root.join(".github/scripts/with-healthy-buildkit.sh"))
        .args(["true"])
        .env("DOCKER", &fake_docker)
        .env("NOOK_PR_BUILDX_BUILDER", "nook-pr")
        .output()?;
    assert!(
        !refused.status.success(),
        "shared nook-pr builder must be refused"
    );
    assert!(
        String::from_utf8_lossy(&refused.stderr).contains("refusing shared BuildKit builder name"),
        "refusal must name the shared builder hazard"
    );

    fs::remove_dir_all(temp)?;
    Ok(())
}

#[test]
fn rust_dependency_updates_are_coordinated_by_gizmo_and_delegated_to_teams() -> anyhow::Result<()> {
    let root = repository_root();
    let workflow = read(&root, ".github/workflows/rust-dependency-updates.yml");
    for required in [
        "- cron: '0 9 * * 1'",
        "cargo install cargo-outdated --version 0.19.0 --locked",
        "task rust:deps:outdated",
        "CI_AGENT_PROMPT_FILE: .github/prompts/rust-dependency-update-agent.md",
        "uses: ./.github/actions/nook-node-setup",
        "uses: go-task/setup-task@v2",
        "task ci-agent:fix",
    ] {
        assert!(
            workflow.contains(required),
            "dependency update workflow missing required contract: {required}"
        );
    }
    let audit_script = read(&root, ".github/scripts/ci-rust-deps-outdated.sh");
    for required in [
        "cargo outdated --workspace --root-deps-only --exit-code 1",
        "check_manifest nook-app/nook-platform",
        "check_manifest nook-app/nook-platform/fuzz",
        "check_manifest agentic-ai/minds",
        "check_manifest preflight",
    ] {
        assert!(
            audit_script.contains(required),
            "dependency update audit script missing required contract: {required}"
        );
    }

    let prompt = read(&root, ".github/prompts/rust-dependency-update-agent.md");
    for required in [
        "`nook-app/nook-platform/`",
        "`nook-app/nook-platform/fuzz/`",
        "`agentic-ai/minds/`",
        "`preflight/`",
        "all outdated direct Rust dependencies",
        "WASM_BUILD_MODE=prod task ci:pr:e2e VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000",
        "task docker:ecosystem:fuzz FUZZ_SECONDS=20",
        "task hive:verify",
        "every local-provider Playwright e2e spec, and the\n   extension e2e",
    ] {
        assert!(
            prompt.contains(required),
            "dependency update agent prompt missing required contract: {required}"
        );
    }
    Ok(())
}

#[test]
fn coverage_dependencies_are_warmed_in_one_instrumented_build() -> anyhow::Result<()> {
    let root = repository_root();
    let dependency_dockerfile = read(
        &root,
        "nook-app/nook-platform/docker/rust/product.Dockerfile",
    );
    let source_dockerfile = dependency_dockerfile.as_str();
    let warmup = dependency_dockerfile
        .split_once("FROM builder-wasm-deps AS builder-core-deps")
        .map(|(_, rest)| rest)
        .expect("builder-core-deps stage must exist in product.Dockerfile");

    assert_eq!(
        warmup
            .matches(
                "cargo llvm-cov nextest --no-report --profile ci -p nook-app-common -p nook-authenticator-domain -p nook-auth2 -p nook-replication -p nook-event-log -p nook-companion-core -p nook-core --no-tests=pass",
            )
            .count(),
        1,
        "coverage dependencies must be warmed in one instrumented build"
    );
    assert!(warmup.contains(
        "cargo llvm-cov nextest --no-report --profile ci -p nook-app-common -p nook-authenticator-domain -p nook-auth2 -p nook-replication -p nook-event-log -p nook-companion-core -p nook-core --no-tests=pass"
    ));
    assert!(
        source_dockerfile
            .contains("cargo llvm-cov nextest --no-clean --profile ci -p nook-app-common")
    );
    assert!(source_dockerfile.contains(
        "cargo llvm-cov nextest --no-clean --profile ci -p nook-authenticator-domain -p nook-auth2"
    ));
    assert!(
        source_dockerfile
            .contains("cargo llvm-cov nextest --no-clean --profile ci -p nook-replication")
    );
    assert!(
        source_dockerfile
            .contains("cargo llvm-cov nextest --no-clean --profile ci -p nook-event-log")
    );
    assert!(
        source_dockerfile
            .contains("cargo llvm-cov nextest --no-clean --profile ci -p nook-companion-core")
    );
    assert!(
        source_dockerfile
            .contains("cargo llvm-cov nextest --no-clean --profile ci -p nook-core --summary-only")
    );

    let wasm_task = read(&root, "nook-app/nook-platform/nook-wasm/Taskfile.yml");
    for required in [
        "\"Cargo.toml\" \"Cargo.lock\"",
        "\"nook-wasm/Cargo.toml\" \"nook-wasm/src\"",
        "\"nook-companion-wasm/Cargo.toml\" \"nook-companion-wasm/src\"",
        "\"nook-companion-core/Cargo.toml\" \"nook-companion-core/src\"",
        "\"nook-app-common/Cargo.toml\" \"nook-app-common/src\" \"nook-app-common/locales\"",
        "\"nook-core/Cargo.toml\" \"nook-core/src\"",
        "\"nook-authenticator-domain/Cargo.toml\" \"nook-authenticator-domain/src\"",
        "\"nook-auth2/Cargo.toml\" \"nook-auth2/src\"",
        "\"nook-replication/Cargo.toml\" \"nook-replication/src\"",
        "\"nook-event-log/Cargo.toml\" \"nook-event-log/src\"",
    ] {
        assert!(
            wasm_task.contains(required),
            "mounted WASM builds must hash portable source and manifests: {required}"
        );
    }
    Ok(())
}

#[test]
fn ci_reuses_wasm_and_web_artifacts_instead_of_rebuilding_them() -> anyhow::Result<()> {
    let root = repository_root();
    let release = read(&root, ".github/workflows/release.yml");
    assert_eq!(
        release.matches("WASM_BUILD_MODE: prod").count(),
        1,
        "release must perform one optimized WASM artifact batch"
    );
    assert!(
        release.contains("REPO_ROOT=\"$GITHUB_WORKSPACE/.nook/release-workflow\"\n          PREFLIGHT_SOURCE_ROOT=\"$GITHUB_WORKSPACE\"")
            && release.contains("task --taskfile \"$GITHUB_WORKSPACE/.nook/release-workflow/Taskfile.yml\"\n          preflight"),
        "release must run current repository preflight tooling against the immutable source before publishing its job image"
    );
    let manual_e2e = read(&root, ".github/workflows/e2e-pr.yml");
    assert!(
        manual_e2e.contains("WASM_BUILD_MODE: prod"),
        "manual PR e2e images must preserve the production WASM build mode"
    );
    assert!(
        !release.contains("Build stable Pages artifact") && !release.contains("run: task setup"),
        "release must extract the already-tested sealed image instead of running setup twice"
    );
    let preflight_bake = read(&root, "preflight/docker-bake.hcl");
    let preflight_dockerfile = read(&root, "preflight/Dockerfile");
    let preflight_tasks = read(&root, "preflight/Taskfile.yml");
    assert!(
        preflight_bake.contains("repository-source = PREFLIGHT_SOURCE_CONTEXT")
            && preflight_dockerfile.contains("COPY --from=repository-source / /meta-secret/nook")
            && preflight_tasks.contains("PREFLIGHT_SOURCE_CONTEXT=\"{{.PREFLIGHT_SOURCE_ROOT}}\""),
        "current preflight tooling must inspect a separately selected immutable source context"
    );
    for required in [
        "VITE_SITE_URL: ${{ env.CI_RELEASE_URL }}",
        "VITE_PUBLIC_APP_URL: ${{ env.CI_RELEASE_URL }}",
        "VITE_VAULT_SYNC_INTERVAL_MS: ${{ env.CI_RELEASE_VITE_VAULT_SYNC_INTERVAL_MS }}",
    ] {
        assert!(
            release.contains(required),
            "initial release build missing production input: {required}"
        );
    }

    let ci = read(&root, "nook-app/ci/Taskfile.yml");
    let web_host = section(&ci, "  _ci:pr:web:host:\n", "\n  ci:pr:ui-demo:");
    assert!(
        web_host.contains("task: docker:ci:web:build") && !web_host.contains("task: docker:task"),
        "hosted PR web verification must run inside the CI image build instead of serializing a second container"
    );
    let verify = section(&ci, "  _ci:pr:parallel:\n", "\n  _ci:main:build:");
    assert!(
        !verify.contains("_web:build:parallel"),
        "the sealed image already contains the validated production web build"
    );
    super::hosted_delivery_contracts::assert_main_web_e2e_core_contract(&ci);

    let web = read(&root, "nook-app/nook-web/Taskfile.yml");
    let e2e = section(
        &web,
        "  _web:test:e2e:parallel:\n",
        "\n  _web:e2e:build-if-needed:",
    );
    assert!(e2e.contains("_web:e2e:build-if-needed"));
    assert!(
        !e2e.contains("bun run build"),
        "the e2e task must rely on the freshness-checked build instead of rebuilding unconditionally"
    );

    super::hosted_delivery_contracts::assert_e2e_build_if_needed_contract(&root);

    let extension = read(&root, "nook-app/nook-web/nook-web-extension/Taskfile.yml");
    let extension_check = section(
        &extension,
        "  _extension:check:\n",
        "\n  _extension:test:e2e:",
    );
    assert!(extension_check.contains("bun run check"));
    assert!(
        !extension_check.contains("bun run build"),
        "extension setup already sealed a validated build"
    );

    let web_base = read(&root, "nook-app/nook-web/docker/web.Dockerfile");
    assert!(web_base.contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium"));
    assert!(web_base.contains("chromium ffmpeg xvfb"));
    assert!(
        !web_base.contains("playwright@${PLAYWRIGHT_VERSION} install"),
        "e2e must not download Playwright's duplicate Chromium and headless-shell bundle"
    );
    let web_image = read(&root, "nook-app/nook-web/nook-web-app/Dockerfile");
    let web_image_bake = read(&root, "nook-app/nook-web/nook-web-app/docker-bake.hcl");
    assert!(web_image.contains("FROM web-runtime AS nook-web-source"));
    assert!(web_image.contains("test -x \"$PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH\""));
    assert!(web_image_bake.contains("web-runtime   = \"target:web-base\""));
    assert_eq!(
        web_image_bake
            .matches("web-runtime = \"target:web-e2e-base\"")
            .count(),
        2,
        "both browser image targets must replace the distinct runtime context with Chromium"
    );
    assert!(
        !web_image_bake.contains("web-base = \"target:web-e2e-base\""),
        "a named context must not collide with the internal web-base Dockerfile stage"
    );
    assert!(web_image.contains("playwright-core/browsers.json"));
    assert!(web_image.contains("/usr/bin/ffmpeg"));
    for config in [
        "nook-app/nook-web/nook-web-app/playwright.config.ts",
        "nook-app/nook-web/nook-web-app/playwright.isolation.config.ts",
        "nook-app/nook-web/nook-web-research/playwright.config.ts",
        "agentic-ai/minds/hive-console/playwright.config.ts",
    ] {
        let playwright_config = read(&root, config);
        assert!(
            playwright_config.contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
                && playwright_config.contains("launchOptions"),
            "{config} must pass the e2e image's system Chromium through Playwright launch options"
        );
    }
    assert!(
        read(
            &root,
            "nook-app/nook-web/nook-web-extension/e2e/helpers/extension-smoke-runtime.ts",
        )
        .contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"),
        "extension browser helpers must launch the e2e image's system Chromium"
    );
    for workflow in [
        ".github/workflows/e2e-pr.yml",
        ".github/workflows/hive.yml",
        ".github/workflows/main.yml",
        ".github/workflows/pr.yml",
        ".github/workflows/release.yml",
        ".github/workflows/remote.yml",
        ".github/workflows/web-research.yml",
    ] {
        assert!(
            read(&root, workflow)
                .contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: /usr/bin/chromium"),
            "{workflow} must explicitly pass system Chromium through the ARC container hook"
        );
    }
    let hive_workflow = read(&root, ".github/workflows/hive.yml");
    let hive_global = section(&hive_workflow, "env:\n", "\njobs:\n");
    let hive_console = section(&hive_workflow, "  console:\n", "\n  console-untrusted:\n");
    assert!(
        !hive_global.contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
            && hive_console.contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: /usr/bin/chromium"),
        "Hive must scope system Chromium to the ARC container job so hosted validation uses Playwright Chromium"
    );
    let research_workflow = read(&root, ".github/workflows/web-research.yml");
    let research_global = section(&research_workflow, "env:\n", "\njobs:\n");
    let research_deploy = section(
        &research_workflow,
        "  deploy:\n",
        "\n      - name: Install dependencies",
    );
    assert!(
        !research_global.contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
            && research_deploy.contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: /usr/bin/chromium"),
        "research must scope system Chromium to the ARC container job so hosted validation uses Playwright Chromium"
    );
    let pr_workflow = read(&root, ".github/workflows/pr.yml");
    let pr_ui_demo = section(&pr_workflow, "  ui-demo:\n", "\n  preview:\n");
    assert!(
        !pr_ui_demo.contains("context.payload") && !pr_ui_demo.contains("context.issue"),
        "ARC container actions must receive PR identity explicitly instead of reading a missing event file"
    );
    assert!(
        !read(&root, ".github/workflows/web-research.yml").contains("context.payload"),
        "ARC research actions must receive event identity explicitly"
    );

    let main_workflow = read(&root, ".github/workflows/main.yml");
    let main_browser_image = section(
        &main_workflow,
        "      - name: Publish exact-source browser job image\n",
        "\n      - name: Preserve cache telemetry",
    );
    for required in [
        "VITE_BASE: ${{ env.CI_MAIN_VITE_BASE }}",
        "VITE_SITE_URL: ${{ env.CI_MAIN_DEV_URL }}",
        "VITE_PUBLIC_APP_URL: ${{ env.CI_MAIN_DEV_URL }}",
        "VITE_SIMPLE_APP_URL: ${{ env.CI_MAIN_SIMPLE_URL }}",
        "VITE_SENTINEL_APP_URL: ${{ env.CI_MAIN_SENTINEL_URL }}",
        "NOOK_EXTENSION_CHANNEL: development",
        "NOOK_EXTENSION_COMMIT: ${{ github.sha }}",
    ] {
        assert!(
            main_browser_image.contains(required),
            "Main browser image must preserve build configuration: {required}"
        );
    }

    let pr_browser_image = section(
        &pr_workflow,
        "      - name: Publish exact-source PR browser job image\n",
        "\n      - name: Upload preview dist handoff",
    );
    for required in [
        "VITE_SITE_URL: https://pr-${{ github.event.pull_request.number }}.nokey-sh.pages.dev",
        "VITE_PUBLIC_APP_URL: https://pr-${{ github.event.pull_request.number }}.nook-1n8.pages.dev",
        "VITE_SIMPLE_APP_URL: https://pr-${{ github.event.pull_request.number }}.nokey-simple.pages.dev",
        "VITE_SENTINEL_APP_URL: https://pr-${{ github.event.pull_request.number }}.nokey-sentinel.pages.dev",
        "NOOK_EXTENSION_CHANNEL: pr-${{ github.event.pull_request.number }}",
        "NOOK_EXTENSION_COMMIT: ${{ github.event.pull_request.head.sha }}",
    ] {
        assert!(
            pr_browser_image.contains(required),
            "PR browser image must preserve preview configuration: {required}"
        );
    }
    Ok(())
}
