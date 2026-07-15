use std::{
    fs,
    path::{Path, PathBuf},
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
    assert!(manifest.contains("https://simple.nokey.sh/*"));
    assert!(manifest.contains("exclude_matches: ['https://sentinel.nokey.sh/*']"));

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
fn coverage_dependencies_are_warmed_in_one_instrumented_build() {
    let root = repository_root();
    let dockerfile = read(&root, "nook-app/nook-core/Dockerfile");
    let warmup = section(
        &dockerfile,
        "# Also warm the COVERAGE-instrumented deps:",
        "# Warm the wasm32 DEBUG/TEST-profile dependencies",
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
fn delivery_ci_uses_runner_local_buildkit_cache_only() {
    let root = repository_root();
    for workflow in [
        ".github/workflows/main.yml",
        ".github/workflows/release.yml",
    ] {
        let content = read(&root, workflow);
        assert!(
            content.contains("runs-on: nook"),
            "{workflow} must reuse the persistent delivery runner's Docker layers"
        );
    }

    let bake = read(&root, "nook-app/docker-bake.hcl");
    for retired in [
        "type=registry",
        "TOOLCHAIN_REGISTRY",
        "TOOLCHAIN_PUSH",
        "toolchain-push",
        "buildcache",
        "${GIT_COMMIT_ID}",
    ] {
        assert!(
            !bake.contains(retired),
            "remote BuildKit cache transfer remains in bake configuration: {retired}"
        );
    }

    let setup = read(&root, ".github/actions/nook-docker-setup/action.yml");
    for retired in ["docker/login-action", "ghcr.io", "TOOLCHAIN_REGISTRY"] {
        assert!(
            !setup.contains(retired),
            "Docker setup must not authenticate or configure remote BuildKit caches: {retired}"
        );
    }

    let main = read(&root, ".github/workflows/main.yml");
    assert!(main.contains("          task ci:main\n"));
    for retired in ["ci:main:publish", "PUSH_TOOLCHAIN", "TOOLCHAIN_REGISTRY"] {
        assert!(
            !main.contains(retired),
            "main must not publish or import remote BuildKit caches: {retired}"
        );
    }

    let cleanup = read(&root, ".github/workflows/runner-cleanup.yml");
    assert!(
        cleanup.contains("--filter until=168h"),
        "runner cleanup must preserve the recent delivery cache"
    );
}
