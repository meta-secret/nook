use super::*;
use anyhow::Context;

#[test]
fn delivery_ci_scopes_buildkit_caches() -> anyhow::Result<()> {
    let root = repository_root();
    assert_hosted_buildkit_cache_contract(&root)?;
    Ok(())
}

fn assert_hosted_buildkit_cache_contract(root: &Path) -> anyhow::Result<()> {
    let app_bake = read(root, "nook-app/docker-bake.hcl");
    let rust_toolchain_bake = read(root, "nook-app/nook-platform/docker/rust/docker-bake.hcl");
    let web_image_bake = read(root, "nook-app/nook-web/docker/web.docker-bake.hcl");
    let web_app_bake = read(root, "nook-app/nook-web/nook-web-app/docker-bake.hcl");
    let web_image = read(root, "nook-app/nook-web/nook-web-app/Dockerfile");
    let web_toolchain_bake = read(root, "nook-app/nook-web/docker/toolchain.docker-bake.hcl");
    let preflight_bake = read(root, "preflight/docker-bake.hcl");
    let bake_retry = read(root, ".github/scripts/bake-with-frontend-flake-retry.sh");
    let bake = format!(
        "{app_bake}\n{rust_toolchain_bake}\n{web_image_bake}\n{web_toolchain_bake}\n{preflight_bake}"
    );
    for required in [
        "GHA_CACHE_ENABLED",
        "GHA_CACHE_WRITE_ENABLED",
        "NOOK_REGISTRY_CACHE_HOST",
        "default = \"registry.dev.nokey.sh\"",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-base-v1",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-ecosystem-dylint-v3",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-ecosystem-fuzz-v3",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-ecosystem-kani-v1",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-preflight-v1",
        "nook-rust-ecosystem-policy-tools-v4",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-ecosystem-deterministic-v1",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-deps-v3",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-native-source-v3",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-wasm-source-v2",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-deps-v1",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-v1",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-e2e-v1",
        "type=registry,ref=",
        "mode=max,timeout=10m",
    ] {
        assert!(
            bake.contains(required),
            "hosted BuildKit cache contract is missing: {required}"
        );
    }
    assert!(
        bake_retry.contains("nook-bake-flake.XXXXXX\"")
            && !bake_retry.contains("nook-bake-flake.XXXXXX.log"),
        "Bake retry logs must use a BSD/macOS-compatible mktemp template ending in XXXXXX"
    );
    assert!(
        web_app_bake.contains("NOOK_SOURCE_REVISION    = NOOK_EXTENSION_COMMIT")
            && web_image.contains("ARG NOOK_SOURCE_REVISION=")
            && web_image.contains("/opt/nook/source-revision")
            && web_image.find("/opt/nook/source-revision") < web_image.find("COPY . ."),
        "sealed web source COPY must have a commit-specific parent cache key"
    );
    assert!(
        rust_toolchain_bake.contains("target \"rust-base-publish\"")
            && rust_toolchain_bake.contains("target \"rust-base-restore\"")
            && rust_toolchain_bake.contains("cache-to   = rust_base_cache_to")
            && bake_target_assigns_cache_to(rust_toolchain_bake.as_str(), "rust-base-publish")
            && !bake_target_assigns_cache_to(rust_toolchain_bake.as_str(), "rust-base")
            && !bake_target_body(rust_toolchain_bake.as_str(), "rust-base")
                .lines()
                .any(|line| line.trim_start().starts_with("cache-from")),
        "rust-base-restore/publish own the rust-base scope; context rust-base has no cache-from/to"
    );
    assert!(
        rust_toolchain_bake.contains("cache-to   = rust_ecosystem_policy_tools_cache_to")
            && rust_toolchain_bake
                .matches("cache-to   = rust_ecosystem_policy_tools_cache_to")
                .count()
                == 1
            && !rust_toolchain_bake.contains("rust_ecosystem_policy_cache_to")
            && !rust_toolchain_bake.contains("target \"rust-dependency-policy\""),
        "ecosystem policy-tools must seed its hosted cache without an aggregate deny/audit Bake leaf"
    );
    assert!(
        !rust_toolchain_bake.contains("rust_ecosystem_nightly_cache_")
            && rust_toolchain_bake.contains("cache-to   = rust_ecosystem_dylint_cache_to")
            && rust_toolchain_bake.contains("cache-to   = rust_ecosystem_fuzz_cache_to"),
        "dylint/fuzz own full-graph leaf caches with no standalone nightly cache"
    );
    assert!(
        rust_toolchain_bake.contains("cache-to   = rust_ecosystem_deterministic_cache_to"),
        "ecosystem deterministic must seed its own hosted cache"
    );
    assert!(
        rust_toolchain_bake.contains("cache-to   = rust_ecosystem_kani_cache_to")
            && bake_target_assigns_cache_to(rust_toolchain_bake.as_str(), "rust-kani"),
        "Kani proofs must seed their full hosted toolchain and proof graph"
    );
    assert!(
        !app_bake.contains("preflight_cache_from =")
            && preflight_bake.contains("preflight_cache_from =")
            && preflight_bake.contains("preflight_cache_to =")
            && preflight_bake.contains("cache-from = preflight_cache_from")
            && preflight_bake.contains("cache-to   = preflight_cache_to"),
        "preflight must own its hosted chef/test cache scopes in preflight/docker-bake.hcl"
    );
    assert!(
        !bake.contains("type=gha"),
        "delivery caches must use registry.dev.nokey.sh, not the GitHub Actions cache service"
    );
    assert_eq!(
        bake.matches("GHA_CACHE_WRITE_ENABLED != \"\" ?").count(),
        15,
        "every hosted cache exporter must honor the read-only workflow mode"
    );
    assert_rust_cache_export_hardening(&bake);

    let rust_bake = read(root, "nook-app/nook-platform/nook-wasm/docker-bake.hcl");
    assert!(
        !rust_bake.contains("builder-wasm-deps = \"target:builder-wasm-deps\"")
            && rust_bake
                .contains("dockerfile = \"nook-app/nook-platform/docker/rust/product.Dockerfile\"",)
            && rust_bake
                .matches("cache-to   = rust_wasm_source_cache_to")
                .count()
                == 5 && rust_bake.contains("cache-to   = rust_wasm_node_cache_to"),
        "WASM leaves and the independent Node consumer must persist non-overlapping source-sensitive caches"
    );
    let core_bake = read(root, "nook-app/nook-platform/nook-core/docker-bake.hcl");
    let core_deps = bake_target_body(core_bake.as_str(), "builder-core-deps");
    let wasm_deps = bake_target_body(core_bake.as_str(), "builder-wasm-deps");
    assert!(
        core_bake.contains("target \"builder-core-deps-publish\"")
            && core_bake.contains("target \"builder-wasm-deps-publish\"")
            && core_bake.contains("target \"builder-core-deps-restore\"")
            && core_bake.contains("target \"builder-wasm-deps-restore\"")
            && core_bake.contains("cache-to   = rust_deps_cache_to")
            && core_bake.contains("cache-to   = rust_wasm_deps_cache_to")
            && core_bake.contains("cache-from = rust_native_source_cache_from")
            && core_bake.contains("cache-to   = rust_native_source_cache_to")
            && bake_target_assigns_cache_to(core_bake.as_str(), "builder-core-deps-publish")
            && bake_target_assigns_cache_to(core_bake.as_str(), "builder-wasm-deps-publish")
            && !bake_target_assigns_cache_to(core_bake.as_str(), "builder-core-deps")
            && !bake_target_assigns_cache_to(core_bake.as_str(), "builder-wasm-deps")
            && !core_deps.contains("cache-from")
            && !wasm_deps.contains("cache-from"),
        "native/wasm dependency targets stay bare while restore/publish targets own cache I/O"
    );
    assert_release_wasm_cache_contract(root);
    assert_parallel_web_pipeline(root);
    assert!(
        web_toolchain_bake.contains("target \"web-deps-publish\"")
            && web_toolchain_bake.contains("cache-to   = web_deps_cache_to")
            && web_toolchain_bake.contains("web_deps_cache_from =")
            && bake_target_assigns_cache_to(web_toolchain_bake.as_str(), "web-deps-publish")
            && !bake_target_assigns_cache_to(web_toolchain_bake.as_str(), "web-deps"),
        "web-deps-publish owns the web-deps scope; context web-deps has no cache-to"
    );
    assert!(
        web_image_bake.contains("web_cache_from =")
            && web_image_bake.contains("web_cache_to =")
            && web_image_bake.contains("web_e2e_cache_from =")
            && web_image_bake.contains("web_e2e_cache_to =")
            && web_image_bake.contains("target \"web-base\"")
            && web_image_bake.contains("target \"web-e2e-base\"")
            && web_app_bake.contains("target \"nook-web-e2e-publish\"")
            && bake_target_assigns_cache_to(web_app_bake.as_str(), "nook-web-e2e-publish")
            && !bake_target_assigns_cache_to(web_app_bake.as_str(), "nook-web-e2e"),
        "final web/e2e scopes must use a dedicated cache-only browser publisher"
    );
    let platform_docker_tasks = read(root, "nook-app/nook-platform/docker/Taskfile.yml");
    let web_docker_tasks = read(root, "nook-app/nook-web/docker/Taskfile.yml");
    let docker_tasks = format!("{platform_docker_tasks}\n{web_docker_tasks}");
    assert!(
        docker_tasks.contains("bake-with-frontend-flake-retry.sh")
            && docker_tasks.contains("nook-web-ci")
            && !docker_tasks.contains("--set \"nook-web-ci.target=nook-web-verify\""),
        "hosted web delivery must solve the joined validation/build target once and retry only the immediate BuildKit frontend flake"
    );
    let app_tasks = read(root, "nook-app/Taskfile.yml");
    assert!(
        app_tasks.contains("bake-with-frontend-flake-retry.sh")
            && app_tasks.contains("setup: $setup_target"),
        "the primary setup path must retry only its final web solve after the immediate BuildKit frontend flake"
    );
    for required in [
        "is_buildkit_frontend_flake",
        "failed to read dockerfile",
        "non-transient Bake failure; not retrying",
        "transient Bake failure; retrying in 2s...",
        "for attempt in 1 2; do",
    ] {
        assert!(
            bake_retry.contains(required),
            "Bake frontend-flake retry helper is missing: {required}"
        );
    }
    let isolation = read(
        root,
        "nook-app/nook-web/nook-web-app/scripts/verify-app-isolation.ts",
    );
    assert!(
        isolation.contains("await companionWasmReady")
            && isolation.contains("createManifest(productionManifestArgs)"),
        "verify:isolation must await companion WASM before createManifest"
    );
    assert!(
        app_tasks.contains("--set \"builder-wasm-deps.output=type=cacheonly\"")
            && app_tasks.contains("--set \"builder-core-deps.output=type=cacheonly\"")
            && app_tasks.contains("--set \"builder-debug.output=type=cacheonly\""),
        "selected dependency and native-source cache publishers must be explicit cache-only Bake outputs"
    );
    assert_main_producer_owned_cache_publish(root)?;
    assert_pr_producer_owned_cache_publish(root)?;
    assert_main_split_pipeline(root)?;
    Ok(())
}

fn assert_pr_producer_owned_cache_publish(root: &Path) -> anyhow::Result<()> {
    let pr = read(root, ".github/workflows/pr.yml");
    for marker in [
        "Publish git-scoped native BuildKit cache",
        "Publish git-scoped WASM BuildKit cache",
        "Publish git-scoped web BuildKit cache",
        "Publish verified browser BuildKit cache",
        "task ci:main:publish-native-cache",
        "task ci:main:publish-wasm-cache",
        "task ci:main:publish-web-cache",
        "task ci:main:publish-web-e2e-cache",
    ] {
        assert!(
            pr.contains(marker),
            "PR producers must publish warm local layers after verify: missing {marker}"
        );
    }
    let rust_verify = pr
        .find("task ci:pr:rust")
        .context("PR Rust job must verify")?;
    let rust_publish = pr
        .find("task ci:main:publish-native-cache")
        .context("PR Rust job must publish its cache")?;
    let wasm_verify = pr
        .find("task ci:pr:wasm")
        .context("PR WASM job must verify")?;
    let wasm_publish = pr
        .find("task ci:main:publish-wasm-cache")
        .context("PR WASM job must publish its cache")?;
    let web_verify = pr
        .find("task ci:pr:web")
        .context("PR web job must verify")?;
    let web_publish = pr
        .find("task ci:main:publish-web-cache")
        .context("PR web job must publish its cache")?;
    let ui_demo = section(&pr, "  ui-demo:\n", "\n  preview:\n");
    let ui_demo_verify = ui_demo
        .find("task ci:pr:ui-demo")
        .context("PR UI demo job must verify")?;
    let ui_demo_publish = ui_demo
        .find("task ci:main:publish-web-e2e-cache")
        .context("PR UI demo job must publish its cache")?;
    let full_e2e = section(&pr, "  full-e2e:\n", "\n  full-extension-e2e:\n");
    let full_e2e_verify = full_e2e
        .find("task ci:pr:e2e:web:artifacts")
        .context("PR full-e2e job must verify the browser image")?;
    let full_e2e_publish = full_e2e
        .find("task ci:main:publish-web-e2e-cache")
        .context("PR full-e2e job must publish its verified browser cache")?;
    assert!(
        rust_verify < rust_publish
            && pr[rust_verify..rust_publish].contains("GHA_CACHE_WRITE_ENABLED: \"\"")
            && pr[rust_publish..].contains("GHA_CACHE_WRITE_ENABLED: \"1\"")
            && wasm_verify < wasm_publish
            && pr[wasm_verify..wasm_publish].contains("GHA_CACHE_WRITE_ENABLED: \"\"")
            && pr[wasm_publish..].contains("GHA_CACHE_WRITE_ENABLED: \"1\"")
            && web_verify < web_publish
            && pr[web_verify..web_publish].contains("GHA_CACHE_WRITE_ENABLED: \"\"")
            && pr[web_publish..].contains("GHA_CACHE_WRITE_ENABLED: \"1\"")
            && ui_demo_verify < ui_demo_publish
            && ui_demo[ui_demo_verify..ui_demo_publish].contains("GHA_CACHE_WRITE_ENABLED: \"\"")
            && ui_demo[ui_demo_publish..].contains("GHA_CACHE_WRITE_ENABLED: \"1\"")
            && ui_demo[..ui_demo_publish]
                .contains("!contains(github.event.pull_request.labels.*.name, 'ci:full-e2e')")
            && full_e2e_verify < full_e2e_publish
            && full_e2e[full_e2e_verify..full_e2e_publish]
                .contains("GHA_CACHE_WRITE_ENABLED: \"\"")
            && full_e2e[full_e2e_publish..].contains("GHA_CACHE_WRITE_ENABLED: \"1\""),
        "PR producers must verify read-only, then publish from warm builders with writes enabled"
    );
    Ok(())
}

fn assert_rust_cache_export_hardening(bake: &str) {
    assert!(
        !bake.contains(
            "nook-rust-deps-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,ignore-error=true"
        ) && !bake.contains("${GHA_RUST_WASM_DEPS_SCOPE}:buildcache,mode=max,ignore-error=true",),
        "Rust dependency cache exporters must not ignore upload failures"
    );
    assert!(
        !bake.contains("group \"publish-gha-cache\"")
            && !bake.contains("group \"prepare-and-publish-cache\""),
        "BuildKit cache publication must not reconstruct completed producer graphs in a dedicated Bake"
    );
}

fn assert_main_producer_owned_cache_publish(root: &Path) -> anyhow::Result<()> {
    let main = read(root, ".github/workflows/main.yml");
    let rust = section(&main, "  rust:\n", "\n  wasm:\n");
    let wasm = section(&main, "  wasm:\n", "\n  web:\n");
    let web = section(&main, "  web:\n", "\n  web-e2e:\n");
    let ui_demo = section(&main, "  ui-demos:\n", "\n  deploy:\n");
    let rust_verify = rust
        .find("task ci:pr:rust")
        .context("Main Rust job must verify")?;
    let rust_publish = rust
        .find("task ci:main:publish-native-cache")
        .context("Main Rust job must publish its cache")?;
    let wasm_verify = wasm
        .find("task ci:pr:wasm")
        .context("Main WASM job must verify")?;
    let wasm_node = wasm
        .find("task ci:wasm:node-test")
        .context("Main WASM job must run Node tests")?;
    let wasm_publish = wasm
        .find("task ci:main:publish-wasm-cache")
        .context("Main WASM job must publish its cache")?;
    let web_verify = web
        .find("task ci:main:web:artifacts")
        .context("Main web job must build verified artifacts")?;
    let web_publish = web
        .find("task ci:main:publish-web-cache")
        .context("Main web job must publish its cache")?;
    let ui_demo_step = ui_demo
        .find("- name: Headless UI demos")
        .context("Main UI demo job must declare its verification step")?;
    let ui_demo_verify = ui_demo
        .find("task ci:main:ui-demo:artifacts")
        .context("Main UI demo job must verify the browser image")?;
    let ui_demo_publish = ui_demo
        .find("task ci:main:publish-web-e2e-cache")
        .context("Main UI demo job must publish its verified browser cache")?;
    assert!(
        rust_verify < rust_publish
            && rust[rust_verify..rust_publish].contains("GHA_CACHE_WRITE_ENABLED: \"\"")
            && rust[rust_publish..].contains("GHA_CACHE_WRITE_ENABLED: \"1\"")
            && wasm.contains("needs: [rust]")
            && wasm_verify < wasm_node
            && wasm_node < wasm_publish
            && wasm[wasm_verify..wasm_publish].contains("GHA_CACHE_WRITE_ENABLED: \"\"")
            && wasm[wasm_publish..].contains("GHA_CACHE_WRITE_ENABLED: \"1\"")
            && web_verify < web_publish
            && web[web_verify..web_publish].contains("GHA_CACHE_WRITE_ENABLED: \"\"")
            && web[web_publish..].contains("GHA_CACHE_WRITE_ENABLED: \"1\"")
            && ui_demo_step < ui_demo_verify
            && ui_demo_verify < ui_demo_publish
            && ui_demo[ui_demo_step..ui_demo_publish].contains("GHA_CACHE_WRITE_ENABLED: \"\"")
            && ui_demo[ui_demo_publish..].contains("GHA_CACHE_WRITE_ENABLED: \"1\"")
            && !main.contains("\n  publish-cache:\n")
            && !main.contains("task ci:main:warm-gha-cache")
            && !main.contains("task ci:main:publish-gha-cache"),
        "Main producers must verify read-only, serialize native before WASM, and publish from their warm builders only after all lane validation succeeds"
    );
    let ci_tasks = read(root, "nook-app/ci/Taskfile.yml");
    assert!(
        !ci_tasks.contains("warm-gha-cache")
            && !ci_tasks.contains("publish-gha-cache")
            && !root
                .join(".github/scripts/warm-buildkit-gha-cache.sh")
                .exists()
            && !root
                .join(".github/scripts/publish-buildkit-gha-cache.sh")
                .exists(),
        "obsolete deferred cache reconstruction commands and scripts must stay removed"
    );
    let docker_tasks = format!(
        "{}{}",
        read(root, "nook-app/nook-platform/docker/Taskfile.yml"),
        read(root, "nook-app/nook-web/docker/Taskfile.yml")
    );
    assert!(
        docker_tasks.contains("rust-format-check.output=type=cacheonly\" ci-rust'")
            && !docker_tasks.contains("ci-rust builder-core-deps")
            && !docker_tasks.contains("wasm-export builder-wasm-deps")
            && docker_tasks.contains("nook-web-ci web-deps")
            && docker_tasks.contains("docker:ci:cache:publish:rust-base:")
            && docker_tasks.contains("docker:ci:cache:publish:native:")
            && docker_tasks.contains("docker:ci:cache:publish:wasm:")
            && docker_tasks.contains("docker:ci:cache:publish:web:")
            && docker_tasks.contains("docker:ci:cache:publish:web-e2e:")
            && docker_tasks.contains("task: docker:ci:cache:publish:rust-base")
            && docker_tasks.contains("rust-base-publish")
            && docker_tasks.contains("builder-core-deps-publish")
            && docker_tasks.contains("builder-wasm-deps-publish")
            && docker_tasks.contains("web-deps-publish")
            && docker_tasks.contains("nook-web-e2e-publish")
            && docker_tasks.contains("preflight-test")
            && docker_tasks.contains(".github/scripts/verify-wasm-gha-cache.sh")
            && docker_tasks.contains("GHA_CACHE_SCOPE_SUFFIX"),
        "producer-owned publishers must bake scoped *-publish targets and verify Main WASM from a fresh builder"
    );
    assert_no_empty_cache_overrides(&docker_tasks);
    let native_publish = docker_tasks
        .split("docker:ci:cache:publish:native:")
        .nth(1)
        .and_then(|tail| tail.split("docker:ci:cache:publish:wasm:").next())
        .unwrap_or("");
    assert!(
        native_publish.contains("preflight-test")
            && native_publish.contains("task: docker:ci:cache:publish:rust-base")
            && native_publish.contains("builder-core-deps-publish")
            && native_publish.contains("builder-debug")
            && !native_publish.contains("builder-core-deps-publish builder-debug"),
        "native cache publish must stage rust-base, deps, source, then preflight as separate solves"
    );
    let wasm_publish = docker_tasks
        .split("docker:ci:cache:publish:wasm:")
        .nth(1)
        .and_then(|tail| tail.split("docker:rust-base:").next())
        .unwrap_or("");
    let wasm_deps_idx = wasm_publish
        .find("builder-wasm-deps-publish")
        .expect("wasm publish must bake builder-wasm-deps-publish");
    let wasm_source_idx = wasm_publish
        .find("wasm-export")
        .expect("wasm publish must bake wasm-export");
    let wasm_rust_base_idx = wasm_publish
        .find("task: docker:ci:cache:publish:rust-base")
        .expect("wasm publish must still seed rust-base after deps/source");
    assert!(
        wasm_deps_idx < wasm_source_idx && wasm_source_idx < wasm_rust_base_idx,
        "wasm cache publish must stage deps-publish, then source export, then rust-base (never rust-base first)"
    );
    let cache_verifier = read(root, ".github/scripts/verify-wasm-gha-cache.sh");
    assert!(
        cache_verifier.contains("docker-container")
            && cache_verifier.contains("--use")
            && !cache_verifier.contains("--builder")
            && cache_verifier.contains("builder-wasm-deps-restore.cache-from=type=registry")
            && cache_verifier.contains("builder-wasm-deps-restore 2>&1")
            && cache_verifier.contains("nook-sccache-report chef-wasm-release")
            && cache_verifier.contains("nook-sccache-report chef-wasm-clippy")
            && cache_verifier.contains("nook-sccache-report wasm-release-test-dependencies"),
        "Main must reject a published WASM cache until a fresh builder restores every dependency layer without --builder"
    );
    let base_dockerfile = read(
        root,
        "nook-app/nook-platform/docker/rust/product.Dockerfile",
    );
    assert!(
        base_dockerfile.contains("ARG RUST_VERSION=")
            && base_dockerfile.contains("ARG DEBIAN_RELEASE=")
            && base_dockerfile.contains("ARG RUST_DIGEST=sha256:")
            && base_dockerfile
                .contains("RUST_IMAGE=rust:${RUST_VERSION}-${DEBIAN_RELEASE}@${RUST_DIGEST}")
            && base_dockerfile.contains("FROM ${RUST_IMAGE} AS rust-base")
            && base_dockerfile.contains("FROM rust-base AS chef-deps")
            && base_dockerfile.contains("cargo chef prepare --recipe-path recipe.json")
            && base_dockerfile.contains(
                "cargo chef cook --release --target wasm32-unknown-unknown --recipe-path recipe.json",
            )
            && base_dockerfile.contains("NOOK_WASM_DEPS_CACHE_EPOCH=")
            && base_dockerfile.contains("/etc/nook-wasm-deps-cache-epoch")
            && base_dockerfile.contains("ARG CARGO_CHEF_VERSION=")
            && base_dockerfile.contains("ARG CARGO_CHEF_SHA256=")
            && base_dockerfile.contains(
                "https://github.com/LukeMathWalker/cargo-chef/releases/download/v${CARGO_CHEF_VERSION}/",
            )
            && base_dockerfile.contains("/usr/local/cargo/bin/cargo-chef")
            && !base_dockerfile.contains("AS chef-planner")
            && !base_dockerfile.contains("COPY --from=chef-planner")
            && !base_dockerfile.contains("lukemathwalker/cargo-chef")
            && !base_dockerfile.contains("FROM ${CARGO_CHEF_IMAGE}")
            && !base_dockerfile.contains("latest-rust-1.")
            && !base_dockerfile.contains("rust:1."),
        "Rust dependency stages must use a digest-pinned rust base and a single chef-deps prepare/cook stage"
    );
    let web_dockerfile = read(root, "nook-app/nook-web/docker/web.Dockerfile");
    let rust_bake = read(root, "nook-app/nook-platform/docker/rust/docker-bake.hcl");
    let web_bake = read(root, "nook-app/nook-web/docker/web.docker-bake.hcl");
    for (path, dockerfile) in [
        (
            "nook-app/nook-platform/docker/rust/product.Dockerfile",
            base_dockerfile.as_str(),
        ),
        (
            "nook-app/nook-web/docker/web.Dockerfile",
            web_dockerfile.as_str(),
        ),
    ] {
        assert!(
            dockerfile.contains("NODE_VERSION=")
                && dockerfile.contains("NODE_SHA256=")
                && dockerfile.contains("https://nodejs.org/dist/v${NODE_VERSION}/")
                && dockerfile.contains("sha256sum -c -")
                && dockerfile.contains("install -m 0755")
                && dockerfile.contains("/usr/local/bin/node")
                && !dockerfile.contains("NODE_IMAGE=")
                && !dockerfile.contains("playwright-node")
                && !dockerfile.contains("FROM node:"),
            "{path} must install a binary-only Node runtime via a pinned curl download"
        );
    }
    assert!(
        rust_bake
            .contains("dockerfile = \"nook-app/nook-platform/docker/rust/product.Dockerfile\"")
            && rust_bake.contains("target \"rust-base\"")
            && !rust_bake.contains("web.Dockerfile")
            && web_bake.contains("dockerfile = \"nook-app/nook-web/docker/web.Dockerfile\"")
            && web_bake.contains("target \"web-base\"")
            && web_bake.contains("target \"web-e2e-base\"")
            && !web_bake.contains("rust.Dockerfile")
            && !rust_bake.contains("base.Dockerfile")
            && !web_bake.contains("base.Dockerfile"),
        "Bake must split rust-base and web-base across rust/web docker-bake files"
    );
    Ok(())
}

fn assert_main_split_pipeline(root: &Path) -> anyhow::Result<()> {
    let main = read(root, ".github/workflows/main.yml");
    assert!(
        main.contains("\n  rust:\n")
            && main.contains("\n  wasm:\n")
            && main.contains("\n  web:\n")
            && main.contains("\n  web-e2e:\n")
            && main.contains("task ci:pr:rust")
            && main.contains("task ci:pr:wasm")
            && main.contains("task ci:main:web:artifacts")
            && main.contains("task ci:main:e2e:web:artifacts")
            && main.contains("needs: [web, web-e2e]"),
        "Main must split native Rust, WASM, web verify, and browser suites without a duplicate cache publisher"
    );
    let coverage_export = read(root, "nook-app/nook-platform/nook-core/docker-bake.hcl")
        .split("target \"coverage-export\" {")
        .nth(1)
        .context("core bake file must define the coverage export target")?
        .to_owned();
    assert!(
        coverage_export.contains("cache-to   = rust_native_source_cache_to"),
        "coverage-export must retain the native-source GHA exporter for the Main native producer"
    );
    Ok(())
}

fn assert_release_wasm_cache_contract(root: &Path) {
    let wasm_dockerfile = read(
        root,
        "nook-app/nook-platform/docker/rust/product.Dockerfile",
    );
    assert!(
        wasm_dockerfile.contains("FROM builder-wasm-deps AS builder-wasm-source")
            && wasm_dockerfile.contains("FROM builder-wasm-source AS builder-wasm-clippy")
            && wasm_dockerfile.contains("FROM builder-wasm-source AS builder-wasm-build")
            && wasm_dockerfile.contains("FROM builder-wasm-source AS builder-wasm-tests")
            && wasm_dockerfile.contains("FROM builder-wasm-tests AS builder-wasm")
            && wasm_dockerfile.contains("wasm-source-app-common")
            && wasm_dockerfile.contains("wasm-source-core")
            && wasm_dockerfile.contains("wasm-source-wasm")
            && wasm_dockerfile
                .contains("COPY --from=builder-wasm-clippy /opt/nook/wasm-clippy-passed")
            && wasm_dockerfile.contains(
                "CARGO_BUILD_TARGET=wasm32-unknown-unknown cargo build --tests --release -p nook-wasm -p nook-companion-wasm",
            )
            && wasm_dockerfile.contains(
                "cargo test --release --target wasm32-unknown-unknown --no-run -p nook-wasm -p nook-companion-wasm",
            )
            && wasm_dockerfile.contains("wasm-pack test --node --release nook-wasm")
            && wasm_dockerfile.contains("wasm-pack build nook-companion-wasm")
            && wasm_dockerfile.contains("COPY --from=builder-wasm-build")
            && wasm_dockerfile.contains("touch nook-app-common/src/i18n.rs")
            && wasm_dockerfile.contains("COPY --from=builder-debug /opt/nook/coverage /coverage"),
        "native verification, WASM clippy, package export, and release-test compilation must run as sibling branches, preserve locale rebuilds, and join only small outputs before release-profile Node tests"
    );
    let dependency_dockerfile = read(
        root,
        "nook-app/nook-platform/docker/rust/product.Dockerfile",
    );
    let core_dockerfile = dependency_dockerfile.as_str();
    assert!(
        !core_dockerfile.contains("wasm-dependency-test")
            && !core_dockerfile
                .contains("cargo test --target wasm32-unknown-unknown --no-run -p nook-wasm")
            && dependency_dockerfile.contains(
                "cargo build --tests --release --target wasm32-unknown-unknown -p nook-wasm -p nook-companion-wasm",
            ),
        "the manifest-only WASM boundary must prewarm release tests without compiling a second debug graph"
    );
    assert!(
        read(root, "nook-app/nook-platform/nook-wasm/Taskfile.yml")
            .contains("wasm-pack test --node --release nook-wasm"),
        "the documented manual WASM test task must use the same release profile as hosted CI"
    );
}

fn assert_parallel_web_pipeline(root: &Path) {
    let web_dockerfile = read(root, "nook-app/nook-web/nook-web-app/Dockerfile");
    assert!(
        web_dockerfile.contains("FROM nook-web-source AS nook-web-verify")
            && web_dockerfile.contains("FROM nook-web-source AS nook-web-build")
            && web_dockerfile.contains("FROM nook-web-build AS nook-web-ci")
            && web_dockerfile.contains("COPY --from=nook-web-verify /opt/nook/web-verified"),
        "hosted PR web checks and production builds must be sibling stages joined by the CI target"
    );
}

#[test]
fn bake_callers_never_clear_cache_from_or_cache_to() {
    let root = repository_root();
    let paths = [
        "nook-app/nook-platform/docker/Taskfile.yml",
        "nook-app/nook-web/docker/Taskfile.yml",
        "preflight/Taskfile.yml",
        ".github/scripts/verify-wasm-gha-cache.sh",
        ".github/scripts/bake-with-frontend-flake-retry.sh",
    ];
    for path in paths {
        let text = read(&root, path);
        assert_no_empty_cache_overrides_in(path, &text);
    }
}

fn assert_no_empty_cache_overrides(text: &str) {
    assert_no_empty_cache_overrides_in("docker Taskfiles", text);
}

fn assert_no_empty_cache_overrides_in(path: &str, text: &str) {
    for key in ["cache-from=", "cache-to="] {
        for (index, line) in text.lines().enumerate() {
            let Some(after) = line.split(key).nth(1) else {
                continue;
            };
            let rest = after.trim_start();
            let empty = rest.is_empty()
                || rest.starts_with('\\')
                || matches!(rest.chars().next(), Some('"' | '\''));
            assert!(
                !empty,
                "{path}:{} clears Bake {key}; empty cache overrides are prohibited — use scoped *-publish targets",
                index + 1
            );
        }
    }
}
