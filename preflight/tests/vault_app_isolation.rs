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
fn production_vault_apps_are_separate_compile_time_capabilities() {
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

    let wasm_manifest = read(&root, "nook-app/nook-wasm/Cargo.toml");
    for feature in [
        "app-simple",
        "app-sentinel",
        "app-extension",
        "app-legacy-migration",
    ] {
        assert!(
            wasm_manifest.contains(feature),
            "missing WASM capability {feature}"
        );
    }
    let application = read(&root, "nook-app/nook-wasm/src/application.rs");
    assert!(application.contains("features are mutually exclusive"));

    let sentinel_config = read(
        &root,
        "nook-app/nook-web/nook-vault-sentinel/vite.config.ts",
    );
    assert!(sentinel_config.contains("nook-wasm-sentinel"));
    assert!(
        sentinel_config.contains("pathname ===") && sentinel_config.contains("/extension-connect")
    );
    assert!(!sentinel_config.contains("extension-connect.html"));

    let simple_config = read(&root, "nook-app/nook-web/nook-vault-simple/vite.config.ts");
    assert!(simple_config.contains("nook-wasm-simple"));
    assert!(simple_config.contains("extension-connect"));

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
    ] {
        assert!(
            release.contains(required),
            "release workflow missing {required}"
        );
    }
}

#[test]
fn development_and_release_wasm_build_modes_stay_separate() {
    let root = repository_root();
    let main = read(&root, ".github/workflows/main.yml");
    assert!(main.contains("WASM_BUILD_MODE=dev"));
    assert!(main.contains("WASM_BUILD_MODE: dev"));
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
fn ci_reuses_wasm_and_web_artifacts_instead_of_rebuilding_them() {
    let root = repository_root();
    let release = read(&root, ".github/workflows/release.yml");
    assert_eq!(
        release.matches("WASM_BUILD_MODE=prod").count(),
        1,
        "release must perform one optimized WASM build, not rebuild all five variants"
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
    assert!(e2e_builder.contains("bun run build:unified && bun run assemble:preview"));
    assert!(
        !e2e_builder.contains("&& bun run build)"),
        "e2e needs the unified harness, not every deployable production artifact"
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
        "nook-app/nook-web/nook-web-extension/e2e/extension-smoke.spec.ts",
    ] {
        assert!(
            read(&root, config).contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"),
            "{config} must use the e2e image's system Chromium"
        );
    }
}

#[test]
fn delivery_ci_reuses_local_layers_and_one_remote_cache_per_lineage() {
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
    for cache in ["rust-buildcache", "web-buildcache", "web-e2e-buildcache"] {
        assert_eq!(
            bake.matches(cache).count(),
            2,
            "{cache} must have exactly one import and one export"
        );
    }
    for retired in [
        ":buildcache",
        "rust-${GIT_COMMIT_ID}",
        "web-${GIT_COMMIT_ID}",
        "web-e2e-${GIT_COMMIT_ID}",
        ":${GIT_COMMIT_ID}",
    ] {
        assert!(
            !bake.contains(retired),
            "retired overlapping cache reference remains: {retired}"
        );
    }

    let cleanup = read(&root, ".github/workflows/runner-cleanup.yml");
    assert!(
        cleanup.contains("--filter until=168h"),
        "runner cleanup must preserve the recent delivery cache"
    );
}
