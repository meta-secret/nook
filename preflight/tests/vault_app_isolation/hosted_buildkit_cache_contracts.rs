use super::*;
use anyhow::Context;

#[test]
fn delivery_ci_scopes_buildkit_caches() -> anyhow::Result<()> {
    let root = repository_root();
    assert_hosted_buildkit_cache_contract(&root)?;
    Ok(())
}

fn assert_hosted_buildkit_cache_contract(root: &Path) -> anyhow::Result<()> {
    let bake = read(root, "nook-app/docker-bake.hcl");
    for required in [
        "GHA_CACHE_ENABLED",
        "GHA_CACHE_WRITE_ENABLED",
        "NOOK_REGISTRY_CACHE_HOST",
        "default = \"registry.dev.nokey.sh\"",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-base-v1",
        "nook-rust-ecosystem-nightly-v4",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-ecosystem-dylint-v2",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-ecosystem-fuzz-v2",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-preflight-v1",
        "nook-rust-ecosystem-policy-tools-v4",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-ecosystem-policy-v1",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-ecosystem-deterministic-v1",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-deps-v2",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-native-source-v2",
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
    let rust_toolchain_bake = read(root, "nook-app/docker/rust.docker-bake.hcl");
    assert!(
        rust_toolchain_bake.contains("cache-to   = rust_base_cache_to"),
        "the Rust toolchain base must seed its own hosted cache before dependency scopes consume it"
    );
    assert!(
        rust_toolchain_bake.contains("cache-to   = rust_ecosystem_policy_tools_cache_to")
            && rust_toolchain_bake.contains("cache-to   = rust_ecosystem_policy_cache_to")
            && rust_toolchain_bake
                .matches("cache-to   = rust_ecosystem_policy_tools_cache_to")
                .count()
                == 1
            && rust_toolchain_bake
                .matches("cache-to   = rust_ecosystem_policy_cache_to")
                .count()
                == 1,
        "ecosystem policy-tools and dependency-policy must seed separate hosted caches"
    );
    assert!(
        rust_toolchain_bake.contains("cache-to   = rust_ecosystem_nightly_cache_to")
            && rust_toolchain_bake
                .matches("cache-to   = rust_ecosystem_nightly_cache_to")
                .count()
                == 1
            && rust_toolchain_bake.contains("cache-to   = rust_ecosystem_dylint_cache_to")
            && rust_toolchain_bake.contains("cache-to   = rust_ecosystem_fuzz_cache_to"),
        "ecosystem nightly writes the shared nightly cache; dylint/fuzz write leaf caches"
    );
    assert!(
        rust_toolchain_bake.contains("cache-to   = rust_ecosystem_deterministic_cache_to"),
        "ecosystem deterministic must seed its own hosted cache"
    );
    let preflight_bake = read(root, "preflight/docker-bake.hcl");
    assert!(
        preflight_bake.contains("cache-from = preflight_cache_from")
            && preflight_bake.contains("cache-to   = preflight_cache_to"),
        "preflight must seed its own hosted chef/test cache"
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
        rust_bake.contains("builder-wasm-deps = \"target:builder-wasm-deps\"")
            && rust_bake
                .matches("cache-to   = rust_wasm_source_cache_to")
                .count()
                == 5,
        "WASM exports, focused artifacts, task images, and browser task images must persist the source-sensitive hosted lineage"
    );
    let core_bake = read(root, "nook-app/nook-platform/nook-core/docker-bake.hcl");
    assert!(
        core_bake.contains("cache-to   = rust_deps_cache_to")
            && core_bake.contains("cache-from = rust_native_source_cache_from")
            && core_bake.contains("cache-to   = rust_native_source_cache_to"),
        "native dependency and source-sensitive coverage layers need independent hosted caches"
    );
    assert_release_wasm_cache_contract(root);
    assert_parallel_web_pipeline(root);
    let web_bake = read(root, "nook-app/docker/toolchain.docker-bake.hcl");
    assert!(
        web_bake.contains("cache-to   = web_deps_cache_to"),
        "web dependencies need an independent cache scope"
    );
    let docker_tasks = read(root, "nook-app/docker/Taskfile.yml");
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
    let bake_retry = read(root, ".github/scripts/bake-with-frontend-flake-retry.sh");
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
            && isolation.contains("createManifest('1.0.0')"),
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
        "Publish PR-scoped native BuildKit cache",
        "Publish PR-scoped WASM BuildKit cache",
        "Publish PR-scoped web BuildKit cache",
        "task ci:main:publish-native-cache",
        "task ci:main:publish-wasm-cache",
        "task ci:main:publish-web-cache",
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
    assert!(
        rust_verify < rust_publish
            && pr[rust_verify..rust_publish].contains("GHA_CACHE_WRITE_ENABLED: \"\"")
            && pr[rust_publish..].contains("GHA_CACHE_WRITE_ENABLED: \"1\"")
            && wasm_verify < wasm_publish
            && pr[wasm_verify..wasm_publish].contains("GHA_CACHE_WRITE_ENABLED: \"\"")
            && pr[wasm_publish..].contains("GHA_CACHE_WRITE_ENABLED: \"1\"")
            && web_verify < web_publish
            && pr[web_verify..web_publish].contains("GHA_CACHE_WRITE_ENABLED: \"\"")
            && pr[web_publish..].contains("GHA_CACHE_WRITE_ENABLED: \"1\""),
        "PR producers must verify read-only, then publish from warm builders with writes enabled"
    );
    Ok(())
}

fn assert_rust_cache_export_hardening(bake: &str) {
    assert!(
        !bake.contains(
            "nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,ignore-error=true"
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
            && !main.contains("\n  publish-cache:\n")
            && !main.contains("task ci:main:warm-gha-cache")
            && !main.contains("task ci:main:publish-gha-cache"),
        "Main producers must verify read-only, serialize native before WASM, and publish from their warm builders only after all lane validation succeeds"
    );
    let ci_tasks = read(root, "nook-app/.task/ci.yml");
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
    let docker_tasks = read(root, "nook-app/docker/Taskfile.yml");
    assert!(
        docker_tasks.contains("ci-rust builder-core-deps rust-base")
            && docker_tasks.contains("wasm-export builder-wasm-deps")
            && docker_tasks.contains("nook-web-ci web-deps")
            && docker_tasks.contains("docker:ci:cache:publish:rust-base:")
            && docker_tasks.contains("docker:ci:cache:publish:native:")
            && docker_tasks.contains("docker:ci:cache:publish:wasm:")
            && docker_tasks.contains("docker:ci:cache:publish:web:")
            && docker_tasks.contains("task: docker:ci:cache:publish:rust-base")
            && docker_tasks.contains("preflight-test")
            && docker_tasks.contains("--set \"builder-wasm-deps.cache-from=\"")
            && docker_tasks.contains(
                "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST:-registry.dev.nokey.sh}/nook/buildcache/"
            )
            && docker_tasks.contains("--set \"builder-wasm-deps.cache-to=\"")
            && docker_tasks.contains("--set \"wasm-export.cache-from=\"")
            && docker_tasks.contains(".github/scripts/verify-wasm-gha-cache.sh")
            && docker_tasks.contains("GHA_CACHE_SCOPE_SUFFIX"),
        "producer-owned publishers must stage rust-base before deps, keep PR WASM cache-from for remote re-export, clear Main WASM cache-from for fat trusted export, verify Main from a fresh builder, and write isolated PR scopes"
    );
    let native_publish = docker_tasks
        .split("docker:ci:cache:publish:native:")
        .nth(1)
        .and_then(|tail| tail.split("docker:ci:cache:publish:wasm:").next())
        .unwrap_or("");
    assert!(
        native_publish.contains("preflight-test")
            && native_publish.contains("--set \"rust-base.cache-to=\"")
            && native_publish.contains("task: docker:ci:cache:publish:rust-base")
            && native_publish.contains("builder-core-deps builder-debug"),
        "native cache publish must stage rust-base, then deps/debug, then preflight without rewriting rust-base"
    );
    let cache_verifier = read(root, ".github/scripts/verify-wasm-gha-cache.sh");
    assert!(
        cache_verifier.contains("docker-container")
            && cache_verifier.contains("--use")
            && !cache_verifier.contains("--builder")
            && cache_verifier.contains("builder-wasm-deps.cache-from=type=registry")
            && cache_verifier.contains("nook-sccache-report chef-wasm-release")
            && cache_verifier.contains("nook-sccache-report chef-wasm-clippy")
            && cache_verifier.contains("nook-sccache-report wasm-release-test-dependencies"),
        "Main must reject a published WASM cache until a fresh builder restores every dependency layer without --builder"
    );
    let base_dockerfile = read(root, "nook-app/docker/rust.Dockerfile");
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
    let web_dockerfile = read(root, "nook-app/docker/web.Dockerfile");
    let rust_bake = read(root, "nook-app/docker/rust.docker-bake.hcl");
    let web_bake = read(root, "nook-app/docker/web.docker-bake.hcl");
    for (path, dockerfile) in [
        ("nook-app/docker/rust.Dockerfile", base_dockerfile.as_str()),
        ("nook-app/docker/web.Dockerfile", web_dockerfile.as_str()),
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
        rust_bake.contains("dockerfile = \"nook-app/docker/rust.Dockerfile\"")
            && rust_bake.contains("target \"rust-base\"")
            && !rust_bake.contains("web.Dockerfile")
            && web_bake.contains("dockerfile = \"nook-app/docker/web.Dockerfile\"")
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
    let wasm_dockerfile = read(root, "nook-app/nook-platform/nook-wasm/Dockerfile");
    assert!(
        wasm_dockerfile.contains("FROM builder-wasm-deps AS builder-wasm-source")
            && wasm_dockerfile.contains("FROM builder-wasm-source AS builder-wasm-clippy")
            && wasm_dockerfile.contains("FROM builder-wasm-source AS builder-wasm-build")
            && wasm_dockerfile.contains("FROM builder-wasm-source AS builder-wasm-tests")
            && wasm_dockerfile.contains("FROM builder-wasm-tests AS builder-wasm")
            && wasm_dockerfile
                .contains("COPY --from=builder-wasm-clippy /opt/nook/wasm-clippy-passed")
            && wasm_dockerfile.contains(
                "CARGO_BUILD_TARGET=wasm32-unknown-unknown cargo build --tests --release -p nook-wasm -p nook-companion-wasm",
            )
            && wasm_dockerfile.contains(
                "cargo test --release --target wasm32-unknown-unknown --no-run -p nook-wasm -p nook-companion-wasm",
            )
            && wasm_dockerfile.contains("wasm-pack test --node --release nook-platform/nook-wasm")
            && wasm_dockerfile.contains("wasm-pack build nook-platform/nook-companion-wasm")
            && wasm_dockerfile.contains("COPY --from=builder-wasm-build")
            && wasm_dockerfile.contains("touch nook-platform/nook-app-common/src/i18n.rs")
            && wasm_dockerfile.contains("COPY --from=builder-debug /opt/nook/coverage /coverage"),
        "native verification, WASM clippy, package export, and release-test compilation must run as sibling branches, preserve locale rebuilds, and join only small outputs before release-profile Node tests"
    );
    let dependency_dockerfile = read(root, "nook-app/docker/rust.Dockerfile");
    let core_dockerfile = read(root, "nook-app/nook-platform/nook-core/Dockerfile");
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
        read(root, "nook-app/nook-web/.task/wasm.yml")
            .contains("wasm-pack test --node --release nook-platform/nook-wasm"),
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
