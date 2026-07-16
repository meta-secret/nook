use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
}

fn read(root: &Path, path: &str) -> String {
    fs::read_to_string(root.join(path))
        .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
}

#[test]
fn agent_prs_cannot_be_merged_automatically() {
    let root = repository_root();
    assert!(
        !root.join(".github/workflows/agent-pr-monitor.yml").exists(),
        "the retired agent PR monitor workflow must not be restored"
    );

    for (path, forbidden) in [
        (
            "agentic-ai/ci-agent/src/main/main.ts",
            &["pr-monitor", "pr-event"][..],
        ),
        (
            "agentic-ai/ci-agent/src/main/github.ts",
            &[
                "nook-agent-managed",
                "nook-agent-monitor-wake",
                "octokit.rest.pulls.merge",
            ][..],
        ),
        (
            ".task/agentic-ai.yml",
            &["pr:monitor", "CI_AGENT_CMD=pr-monitor"][..],
        ),
    ] {
        let source = read(&root, path);
        for token in forbidden {
            assert!(
                !source.contains(token),
                "{path} must not restore automatic PR merge control `{token}`"
            );
        }
    }
}

fn section<'a>(content: &'a str, start: &str, end: &str) -> &'a str {
    content
        .split_once(start)
        .unwrap_or_else(|| panic!("missing section start: {start}"))
        .1
        .split_once(end)
        .unwrap_or_else(|| panic!("missing section end: {end}"))
        .0
}

#[test]
fn production_vault_apps_share_one_wasm_build_and_keep_runtime_boundaries() {
    let root = repository_root();
    for project in ["nook-vault-simple", "nook-vault-sentinel"] {
        assert!(
            root.join("nook-app/nook-web")
                .join(project)
                .join("package.json")
                .is_file(),
            "{project} must remain an independent web project"
        );
    }

    let workspace = read(&root, "nook-app/Cargo.toml");
    assert!(
        !workspace.contains("nook-wasm/apps/"),
        "application wrappers must not recompile the shared WASM library"
    );
    let application = read(&root, "nook-app/nook-wasm/src/application.rs");
    assert!(application.contains("compiles and optimizes one shared WASM library"));
    assert!(application.contains("cannot change it"));

    let wasm_dockerfile = read(&root, "nook-app/nook-wasm/Dockerfile");
    assert!(
        wasm_dockerfile.matches("wasm-pack build nook-wasm").count() == 1,
        "delivery must compile and optimize nook-wasm exactly once"
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
    let wasm_tasks = read(&root, "nook-app/nook-web/.task/wasm.yml");
    assert_eq!(
        wasm_tasks.matches("wasm-pack build nook-wasm").count(),
        1,
        "the fast rebuild path must compile the shared WASM package once"
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
    let web_dockerfile = read(&root, "nook-app/nook-web/nook-web-app/Dockerfile");
    assert_eq!(
        web_dockerfile
            .matches("COPY --from=web-artifacts /nook-wasm ")
            .count(),
        1,
        "web build must receive one shared WASM package"
    );

    let sentinel_config = read(
        &root,
        "nook-app/nook-web/nook-vault-sentinel/vite.config.ts",
    );
    assert!(sentinel_config.contains("lib/nook-wasm/nook_wasm"));
    assert!(sentinel_config.contains("__NOOK_WASM_APPLICATION__"));
    assert!(sentinel_config.contains("JSON.stringify(\"sentinel\")"));
    assert!(
        sentinel_config.contains("pathname ===") && sentinel_config.contains("/extension-connect")
    );
    assert!(!sentinel_config.contains("extension-connect.html"));

    let simple_config = read(&root, "nook-app/nook-web/nook-vault-simple/vite.config.ts");
    assert!(simple_config.contains("lib/nook-wasm/nook_wasm"));
    assert!(simple_config.contains("__NOOK_WASM_APPLICATION__"));
    assert!(simple_config.contains("JSON.stringify(\"simple\")"));
    assert!(simple_config.contains("extension-connect"));

    let wasm_bridge = read(
        &root,
        "nook-app/nook-web/nook-web-shared/src/vault-app/lib/wasm-bootstrap.ts",
    );
    assert!(wasm_bridge.contains("configureVaultApplication(WASM_APPLICATION)"));
    for entry in [
        "nook-app/nook-web/nook-vault-simple/src/main.ts",
        "nook-app/nook-web/nook-vault-sentinel/src/main.ts",
    ] {
        let source = read(&root, entry);
        assert!(source.contains("await ensureAppWasm()"));
        assert!(source.contains("await import("));
    }

    let dockerignore = read(&root, ".dockerignore");
    assert!(
        dockerignore.contains("nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm*")
    );
    for ignored in [
        "**/target",
        "**/node_modules",
        "**/dist",
        "**/test-results",
        "**/playwright-report",
        "**/coverage",
    ] {
        assert!(
            dockerignore.lines().any(|line| line == ignored),
            "Docker context must recursively ignore {ignored}"
        );
    }
}

#[test]
fn extension_and_release_contract_preserve_origin_isolation() {
    let root = repository_root();
    let manifest = read(
        &root,
        "nook-app/nook-web/nook-web-extension/src/manifest.ts",
    );
    let vault_target = read(
        &root,
        "nook-app/nook-web/nook-web-extension/src/lib/simple-vault-target.ts",
    );
    assert!(manifest.contains("exclude_matches: ["));
    for required_contract in [
        "simpleVaultMatchPattern(simpleVaultBaseUrl)",
        "sentinelVaultMatchPatterns(simpleVaultBaseUrl)",
        "externally_connectable: {",
        "matches: [simpleVaultMatch]",
    ] {
        assert!(
            manifest.contains(required_contract),
            "extension manifest must preserve dynamic vault isolation through {required_contract}"
        );
    }
    for production_boundary in ["https://simple.nokey.sh/", "https://sentinel.nokey.sh/*"] {
        assert!(
            vault_target.contains(production_boundary),
            "extension vault targeting must preserve production boundary {production_boundary}"
        );
    }

    let release = read(&root, ".github/workflows/release.yml");
    for required in [
        "nook-vault-simple/dist",
        "nook-vault-sentinel/dist",
        "simple.nokey.sh:nokey-simple",
        "sentinel.nokey.sh:nokey-sentinel",
        "nook-app-kind",
        "node:24-trixie-slim",
        "uses: actions/github-script@v9",
    ] {
        assert!(
            release.contains(required),
            "release workflow missing {required}"
        );
    }
    assert!(
        !release.contains("gh release "),
        "release publication must not assume the self-hosted runner has the GitHub CLI"
    );
    let deploy = section(
        &release,
        "      - name: Deploy isolated Simple and Sentinel applications\n",
        "\n      - name: Attach and verify isolated production domains",
    );
    assert!(
        deploy.contains("docker run --rm")
            && deploy.contains("node:24-trixie-slim")
            && deploy.contains("npx --yes wrangler@4"),
        "Wrangler must run inside an explicit Node container on the self-hosted runner"
    );
}

#[test]
fn development_and_release_wasm_build_modes_stay_separate() {
    let root = repository_root();
    let main = read(&root, ".github/workflows/main.yml");
    assert!(main.contains("WASM_BUILD_MODE=dev"));
    assert!(
        !main.contains("WASM_BUILD_MODE=prod") && !main.contains("WASM_BUILD_MODE: prod"),
        "main must not serialize production wasm optimization for development artifacts"
    );

    let release = read(&root, ".github/workflows/release.yml");
    assert!(release.contains("WASM_BUILD_MODE=prod"));
    assert!(
        !release.contains("WASM_BUILD_MODE=dev"),
        "release artifacts must remain production-optimized"
    );
}

#[test]
fn development_cloudflare_deploy_preserves_isolated_origins() {
    let root = repository_root();
    let main = read(&root, ".github/workflows/main.yml");
    for required in [
        "deploy nokey-sh development nook-app/nook-web/nook-web-app/dist/site",
        "deploy nokey-simple development nook-app/nook-web/nook-vault-simple/dist",
        "deploy nokey-sentinel development nook-app/nook-web/nook-vault-sentinel/dist",
        "CI_MAIN_SIMPLE_DOMAIN: simple.dev.nokey.sh",
        "CI_MAIN_SENTINEL_DOMAIN: sentinel.dev.nokey.sh",
        "site_pages_host=\"development.nokey-sh.pages.dev\"",
        "simple_pages_host=\"development.nokey-simple.pages.dev\"",
        "sentinel_pages_host=\"development.nokey-sentinel.pages.dev\"",
        "grep -Fq '<title>Nook — Keys, not accounts</title>'",
        "grep -Fq '<meta name=\"nook-app-kind\" content=\"simple\"'",
        "grep -Fq '<meta name=\"nook-app-kind\" content=\"sentinel\"'",
        "zones/$zone_id/purge_cache",
        "Cloudflare zone administration was unavailable; verifying live domains",
        "cache_bust=\"nook_commit=${{ github.sha }}&attempt=$attempt\"",
        "extension.json?nook_commit=${{ github.sha }}",
        "https://$DEV_DOMAIN/site/",
        "https://$DEV_DOMAIN/simple/",
        "https://$DEV_DOMAIN/sentinel/",
        "[ \"$site_status\" = \"404\" ]",
        "[ \"$simple_status\" = \"404\" ]",
        "[ \"$sentinel_status\" = \"404\" ]",
        "[ \"$simple_extension_status\" = \"200\" ]",
        "[ \"$sentinel_extension_status\" = \"404\" ]",
    ] {
        assert!(
            main.contains(required),
            "main development deployment is missing isolation invariant: {required}"
        );
    }
    assert!(
        main.contains("VITE_SITE_URL=${{ env.CI_MAIN_DEV_URL }}")
            && main.contains("VITE_SIMPLE_APP_URL=${{ env.CI_MAIN_SIMPLE_URL }}")
            && main.contains("VITE_SENTINEL_APP_URL=${{ env.CI_MAIN_SENTINEL_URL }}"),
        "development artifacts must embed their stable isolated channel origins"
    );

    let docker_tasks = read(&root, "nook-app/docker/Taskfile.yml");
    assert!(
        docker_tasks.contains("-e CF_PAGES_DIST_DIR"),
        "the selected Cloudflare artifact directory must reach the sealed deploy container"
    );

    let ci_tasks = read(&root, "nook-app/.task/ci.yml");
    assert!(
        ci_tasks.contains("*) deploy_dir=\"{{.REPO_ROOT}}/$deploy_dir\" ;;"),
        "repo-relative Cloudflare artifact directories must resolve from the repository root"
    );
}

#[test]
fn main_failures_do_not_trigger_an_ai_repair_agent() {
    let root = repository_root();
    let main = read(&root, ".github/workflows/main.yml");
    assert!(
        !main.contains("\n  ci-fix:") && !main.contains("task ci-agent:fix"),
        "main failures must remain visible for manual handling"
    );
}

#[test]
fn delivery_reuses_a_health_checked_buildkit_daemon() {
    let root = repository_root();
    let pr = read(&root, ".github/workflows/pr.yml");
    assert!(
        !pr.contains("docker buildx prune") && !pr.contains("BUILDX_BUILDER"),
        "PR workflow must delegate builder health and selection to the wrapper"
    );

    let ci = read(&root, "nook-app/.task/ci.yml");
    for required in [
        "task: _buildx:healthy",
        "vars: { BUILD_TASK: _ci:pr:host }",
        "vars: { BUILD_TASK: _ci:main:host }",
    ] {
        assert!(
            ci.contains(required),
            "delivery CI must enter the health-checked BuildKit wrapper: {required}"
        );
    }

    let wrapper = read(&root, ".github/scripts/with-healthy-buildkit.sh");
    for required in [
        "NOOK_PR_BUILDX_BUILDER:-nook-pr",
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
        "BUILDX_BUILDER=\"$builder\" \"$@\"",
    ] {
        assert!(
            wrapper.contains(required),
            "health-checked BuildKit wrapper missing lifecycle contract: {required}"
        );
    }
    assert!(
        !wrapper.contains("trap cleanup EXIT"),
        "a healthy PR builder must survive successful invocations"
    );
}

#[test]
fn stuck_pr_buildkit_probe_is_killed_and_replaced_within_its_deadline() {
    let root = repository_root();
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock must follow the Unix epoch")
        .as_nanos();
    let temp = std::env::temp_dir().join(format!(
        "nook-buildkit-health-{}-{unique}",
        std::process::id()
    ));
    fs::create_dir_all(&temp).expect("create BuildKit health test directory");

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
    )
    .expect("write fake Docker command");
    let mut permissions = fs::metadata(&fake_docker)
        .expect("stat fake Docker command")
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&fake_docker, permissions).expect("make fake Docker executable");

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
        .output()
        .expect("run BuildKit health wrapper");
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
    assert_eq!(
        fs::read_to_string(&command_marker).expect("wrapped command marker"),
        "ok"
    );
    let child_pid = fs::read_to_string(&child_pid_file).expect("timed Docker child pid");
    assert!(
        !Command::new("kill")
            .args(["-0", child_pid.trim()])
            .output()
            .expect("check timed Docker child")
            .status
            .success(),
        "timed Docker child {child_pid:?} survived process-group cleanup"
    );

    let calls = fs::read_to_string(&docker_log).expect("fake Docker call log");
    for required in [
        "buildx inspect nook-pr-timeout-test --bootstrap",
        "rm --force buildx_buildkit_nook-pr-timeout-test0",
        "buildx rm --force nook-pr-timeout-test",
        "volume rm --force buildx_buildkit_nook-pr-timeout-test0_state",
        "buildx create --name nook-pr-timeout-test --driver docker-container --bootstrap",
    ] {
        assert!(
            calls.contains(required),
            "missing recovery call: {required}"
        );
    }

    fs::remove_dir_all(temp).expect("remove BuildKit health test directory");
}

#[test]
fn rust_dependency_updates_are_audited_and_fully_validated_by_the_ai_agent() {
    let root = repository_root();
    let workflow = read(&root, ".github/workflows/rust-dependency-updates.yml");
    for required in [
        "- cron: '0 9 * * 1'",
        "cargo install cargo-outdated --version 0.19.0 --locked",
        "cargo outdated --workspace --root-deps-only --exit-code 1",
        "check_manifest nook-app",
        "check_manifest preflight",
        "CI_AGENT_PROMPT_FILE: .github/prompts/rust-dependency-update-agent.md",
        "task ci-agent:fix",
    ] {
        assert!(
            workflow.contains(required),
            "dependency update workflow missing required contract: {required}"
        );
    }

    let prompt = read(&root, ".github/prompts/rust-dependency-update-agent.md");
    for required in [
        "every `Cargo.toml` under `nook-app/`\n   and `preflight/`",
        "all outdated direct Rust dependencies",
        "WASM_BUILD_MODE=prod task ci:pr:e2e VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000",
        "every local-provider Playwright e2e spec, and the\n   extension e2e",
    ] {
        assert!(
            prompt.contains(required),
            "dependency update agent prompt missing required contract: {required}"
        );
    }
}

#[test]
fn coverage_dependencies_are_warmed_in_one_instrumented_build() {
    let root = repository_root();
    let dockerfile = read(&root, "nook-app/nook-core/Dockerfile");
    let warmup = section(
        &dockerfile,
        "# Also warm the COVERAGE-instrumented deps:",
        "# --- Native verify warm-up",
    );

    assert_eq!(
        warmup.matches("RUN cargo llvm-cov nextest").count(),
        1,
        "coverage dependencies must be warmed in one instrumented build"
    );
    assert!(warmup.contains(
        "cargo llvm-cov nextest --no-report --profile ci -p nook-auth2 -p nook-core --no-tests=pass"
    ));
    assert!(
        dockerfile.contains("RUN cargo llvm-cov nextest --no-clean --profile ci -p nook-auth2")
    );
    assert!(
        dockerfile
            .contains("cargo llvm-cov nextest --no-clean --profile ci -p nook-core --summary-only")
    );
}

#[test]
fn ci_reuses_wasm_and_web_artifacts_instead_of_rebuilding_them() {
    let root = repository_root();
    let release = read(&root, ".github/workflows/release.yml");
    assert_eq!(
        release.matches("WASM_BUILD_MODE=prod").count(),
        1,
        "release must perform one optimized WASM artifact batch"
    );
    assert!(
        !release.contains("Build stable Pages artifact") && !release.contains("run: task setup"),
        "release must extract the already-tested sealed image instead of running setup twice"
    );
    for required in [
        "VITE_SITE_URL=${{ env.CI_RELEASE_URL }}",
        "VITE_PUBLIC_APP_URL=${{ env.CI_RELEASE_URL }}",
        "VITE_VAULT_SYNC_INTERVAL_MS=${{ env.CI_RELEASE_VITE_VAULT_SYNC_INTERVAL_MS }}",
    ] {
        assert!(
            release.contains(required),
            "initial release build missing production input: {required}"
        );
    }

    let ci = read(&root, "nook-app/.task/ci.yml");
    let verify = section(&ci, "  _ci:pr:parallel:\n", "\n  _ci:main:build:");
    assert!(
        !verify.contains("_web:build:parallel"),
        "the sealed image already contains the validated production web build"
    );
    let main = section(&ci, "  _ci:main:\n", "\n  _ci:nightly:e2e:");
    assert!(
        !main.contains("_web:e2e:build-dist"),
        "main must not request the same e2e build before the e2e task checks its stamp"
    );

    let web = read(&root, "nook-app/nook-web/.task/web.yml");
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

    let e2e_builder = read(&root, ".github/scripts/e2e-build-if-needed.sh");
    assert_eq!(
        e2e_builder.matches("bun run build:unified").count(),
        1,
        "e2e must compile the unified harness exactly once"
    );
    for required in [
        "site_source=\"$WEB_ROOT/dist-prod/site\"",
        "cp -a \"$site_source\" \"$DIST/site\"",
        "bun run assemble:preview",
    ] {
        assert!(
            e2e_builder.contains(required),
            "e2e assembly contract missing: {required}"
        );
    }
    assert!(
        !e2e_builder.contains("bun run build:simple")
            && !e2e_builder.contains("bun run build:sentinel"),
        "e2e must reuse the sealed Simple and Sentinel artifacts"
    );

    let extension = read(&root, "nook-app/nook-web/.task/extension.yml");
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

    let web_base = read(&root, "nook-app/docker/base.Dockerfile");
    assert!(web_base.contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium"));
    assert!(web_base.contains("chromium xvfb"));
    assert!(
        !web_base.contains("playwright@${PLAYWRIGHT_VERSION} install"),
        "e2e must not download Playwright's duplicate Chromium and headless-shell bundle"
    );
    for config in [
        "nook-app/nook-web/nook-web-app/playwright.config.ts",
        "nook-app/nook-web/nook-web-app/playwright.isolation.config.ts",
        "nook-app/nook-web/nook-web-extension/e2e/extension-smoke.spec.ts",
    ] {
        assert!(
            read(&root, config).contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"),
            "{config} must use the e2e image's system Chromium"
        );
    }
}

#[test]
fn delivery_ci_uses_github_hosted_runners_with_scoped_buildkit_caches() {
    let root = repository_root();
    for workflow in [
        ".github/workflows/pr.yml",
        ".github/workflows/main.yml",
        ".github/workflows/release.yml",
    ] {
        let content = read(&root, workflow);
        assert!(
            content.contains("runs-on: ubuntu-latest"),
            "{workflow} must use elastic GitHub-hosted capacity"
        );
        for run_scoped_image in [
            "DOCKER_IMAGE: nook-web:run-${{ github.run_id }}-${{ github.run_attempt }}",
            "DOCKER_E2E_IMAGE: nook-web-e2e:run-${{ github.run_id }}-${{ github.run_attempt }}",
        ] {
            assert!(
                content.contains(run_scoped_image),
                "{workflow} must isolate its loaded runtime image: {run_scoped_image}"
            );
        }
    }

    let bake = read(&root, "nook-app/docker-bake.hcl");
    for required in [
        "GHA_CACHE_ENABLED",
        "GHA_CACHE_WRITE_ENABLED",
        "type=gha,scope=nook-rust-base-v1",
        "type=gha,scope=nook-rust-deps-v2",
        "type=gha,scope=nook-rust-wasm-deps-v1",
        "type=gha,scope=nook-web-deps-v1",
        "type=gha,scope=nook-web-v1",
        "type=gha,scope=nook-web-e2e-v1",
        "mode=max,version=2",
    ] {
        assert!(
            bake.contains(required),
            "hosted BuildKit cache contract is missing: {required}"
        );
    }
    assert!(
        read(&root, "nook-app/docker/base.docker-bake.hcl")
            .contains("cache-to   = rust_base_cache_to"),
        "the Rust toolchain base must seed its own hosted cache before dependency scopes consume it"
    );
    assert!(
        !bake.contains("type=registry"),
        "delivery caches must use the GitHub Actions cache service, not registry manifests"
    );
    assert_eq!(
        bake.matches("GHA_CACHE_WRITE_ENABLED != \"\" ?").count(),
        6,
        "every hosted cache exporter must honor the read-only workflow mode"
    );

    let rust_bake = read(&root, "nook-app/nook-wasm/docker-bake.hcl");
    assert!(
        rust_bake.contains("builder-wasm-deps = \"target:builder-wasm-deps\"")
            && !rust_bake.contains("cache-to   = rust_artifacts_cache_to"),
        "WASM must branch from cached dependencies without exporting source-heavy snapshots"
    );
    let core_bake = read(&root, "nook-app/nook-core/docker-bake.hcl");
    assert!(
        core_bake.contains("cache-to   = rust_deps_cache_to")
            && !core_bake.contains("cache-to   = rust_debug_cache_to"),
        "only stable Rust dependency layers should be exported"
    );
    let wasm_dockerfile = read(&root, "nook-app/nook-wasm/Dockerfile");
    assert!(
        wasm_dockerfile.contains("FROM builder-wasm-deps AS builder-wasm")
            && wasm_dockerfile.contains("RUN touch nook-core/src/i18n.rs")
            && wasm_dockerfile.contains("COPY --from=builder-debug /opt/nook/coverage /coverage"),
        "native verification and WASM must run as sibling branches, preserve locale rebuilds, and join only small outputs"
    );
    let web_bake = read(&root, "nook-app/docker/toolchain.docker-bake.hcl");
    assert!(
        web_bake.contains("cache-to   = web_deps_cache_to"),
        "web dependencies need an independent cache scope"
    );
    let docker_tasks = read(&root, "nook-app/docker/Taskfile.yml");
    assert!(
        docker_tasks.contains("for attempt in 1 2; do")
            && docker_tasks
                .contains("task docker:ci:web:build: transient Bake failure; retrying in 2s",),
        "hosted web delivery must retry the immediate BuildKit frontend flake once"
    );

    let setup = read(&root, ".github/actions/nook-docker-setup/action.yml");
    for required in [
        "docker/setup-buildx-action@v3",
        "crazy-max/ghaction-github-runtime@v3",
        "NOOK_PR_BUILDX_BUILDER=${{ steps.buildx.outputs.name }}",
        "BUILDX_BUILDER=${{ steps.buildx.outputs.name }}",
        "GHA_CACHE_ENABLED=1",
        "GHA_CACHE_WRITE_ENABLED=1",
    ] {
        assert!(
            setup.contains(required),
            "GitHub-hosted Docker setup is missing: {required}"
        );
    }
    assert!(
        !setup.contains("systemctl restart docker") && !setup.contains("/etc/docker/daemon.json"),
        "delivery setup must not reconfigure or restart Docker"
    );

    let pr = read(&root, ".github/workflows/pr.yml");
    for required in [
        "name: Native Rust verification",
        "name: Verify and preview",
        "task ci:pr:rust",
        "task ci:pr:wasm",
        "task ci:pr:web",
        "ARTIFACT_NAME: pr-rust-${{ github.run_id }}",
        "actions/runs/$GITHUB_RUN_ID/attempts/$GITHUB_RUN_ATTEMPT/jobs",
        "Native Rust verification completed with $native_conclusion",
        "attempt $attempt/360",
    ] {
        assert!(
            pr.contains(required),
            "PR CI must keep native Rust parallel with the combined WASM/web runner: {required}"
        );
    }
    let native_job_lookup = pr
        .find("native_job=\"$(")
        .expect("PR verification must inspect the latest native job");
    let artifact_lookup = pr
        .find("actions/runs/$GITHUB_RUN_ID/artifacts")
        .expect("PR verification must inspect the Rust handoff artifact");
    assert!(
        native_job_lookup < artifact_lookup,
        "PR verification must prove the latest native attempt succeeded before accepting a run-stable artifact"
    );
    let e2e_pr = read(&root, ".github/workflows/e2e-pr.yml");
    assert!(
        e2e_pr.contains("cache-write: \"false\""),
        "manual PR-head e2e may restore shared caches but must not overwrite default-branch scopes"
    );
    let release = read(&root, ".github/workflows/release.yml");
    let release_setup = release
        .find("uses: ./.github/actions/nook-docker-setup")
        .expect("release must use the safe workflow-ref Docker setup");
    let release_source = release
        .find("- name: Checkout release source")
        .expect("release must checkout its requested source");
    assert!(
        release_setup < release_source,
        "release must initialize Docker from the workflow ref before checking out an older source"
    );
    assert!(
        !pr.contains("name: pr-wasm-${{ github.run_id }}-${{ github.run_attempt }}")
            && !pr
                .contains("ARTIFACT_NAME: pr-rust-${{ github.run_id }}-${{ github.run_attempt }}")
            && !pr.contains("needs: [rust, wasm]"),
        "PR CI must not round-trip WASM through a third runner or key Rust handoffs to a rerun attempt"
    );

    let main = read(&root, ".github/workflows/main.yml");
    assert!(main.contains("          task ci:main\n"));
    let cleanup = read(&root, ".github/workflows/runner-cleanup.yml");
    assert!(
        cleanup.contains("--filter until=168h"),
        "runner cleanup must preserve the recent delivery cache"
    );
}
