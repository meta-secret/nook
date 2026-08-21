#![allow(clippy::unnecessary_wraps)]

use std::{fs, path::PathBuf};

use anyhow::Context;

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

fn assert_delivery_cache_scope_contract() -> anyhow::Result<()> {
    let setup = read(".github/actions/nook-docker-setup/action.yml");
    assert!(setup.contains("cache-telemetry.cjs start"));
    assert!(setup.contains("NOOK_CACHE_TELEMETRY_BASELINE"));
    assert!(setup.contains("if [[ \"$pr_number\" =~ ^[0-9]+$ ]]"));
    assert!(setup.contains("Pull-request jobs are forced to restore Main's cache read-only"));
    assert!(setup.contains("GHA_CACHE_SCOPE_SUFFIX="));
    assert!(setup.contains("GHA_CACHE_FALLBACK_ENABLED="));
    assert!(setup.contains("GHA_CACHE_SEED_SCOPE_SUFFIX="));
    let fingerprint = read(".github/scripts/rust-deps-cache-fingerprint.sh");
    for fingerprint_input in [
        ".github/scripts/rust-deps-cache-fingerprint.sh",
        "nook-app/nook-platform/Cargo.toml",
        "nook-app/nook-platform/Cargo.lock",
        "'nook-app/**/Cargo.toml'",
        "'nook-app/nook-platform/.cargo/**'",
        "'nook-app/nook-platform/.config/**'",
        "nook-app/nook-platform/clippy.toml",
        "nook-app/nook-platform/docker/rust/product.Dockerfile",
        "nook-app/nook-platform/docker/rust/product.Dockerfile.dockerignore",
        "nook-app/nook-platform/docker/sccache-wrapper.sh",
        "nook-app/nook-platform/docker/sccache-report.sh",
    ] {
        assert!(
            fingerprint.contains(fingerprint_input),
            "Rust dependency scope fingerprint is missing {fingerprint_input}"
        );
    }
    for non_cook_fingerprint_input in [
        "nook-app/Taskfile.yml",
        "nook-app/docker-bake.hcl",
        "nook-app/**/docker-bake.hcl",
        "nook-app/nook-platform/docker/rust/docker-bake.hcl",
        "nook-app/nook-web/docker/*.docker-bake.hcl",
        "nook-app/nook-platform/docker/rust/**",
        "nook-app/nook-platform/docker/Taskfile.yml",
        "nook-app/nook-web/docker/Taskfile.yml",
        "nook-app/nook-web/docker/web.Dockerfile",
        "nook-app/nook-web/docker/toolchain.Dockerfile",
    ] {
        assert!(
            !fingerprint.contains(non_cook_fingerprint_input),
            "Rust deps fingerprint must not rotate on non-cook input {non_cook_fingerprint_input}"
        );
    }
    assert!(
        setup.contains(
            "rust_deps_fingerprint=\"$(bash .github/scripts/rust-deps-cache-fingerprint.sh)\""
        ) && setup.contains("NOOK_RUST_DEPS_INPUT_FINGERPRINT=$rust_deps_fingerprint")
            && setup
                .contains("GHA_RUST_WASM_DEPS_SCOPE=nook-rust-wasm-deps-v5-$rust_deps_fingerprint")
    );
    assert!(setup.contains("GHA_CACHE_WRITE_ENABLED=$cache_write_enabled"));
    assert!(setup.contains("[ -z \"$read_only\" ]"));
    assert!(setup.contains("main-cache-only"));
    assert!(setup.contains("main-cache-only requires cache-write=false"));
    assert!(
        setup.contains("isolated-cache-write requires main-cache-only=true and cache-write=false")
    );
    assert!(setup.contains("isolated-cache-write requires workflow_dispatch or pull_request"));
    assert!(setup.contains("scope_sha=\"${{ github.event.pull_request.head.sha }}\""));
    assert!(setup.contains("scope_sha=\"$(git rev-parse HEAD)\""));
    assert!(setup.contains("scope_suffix=\"-git-$scope_sha\""));
    assert!(setup.contains("isolated-cache-write requires a 40-char lowercase git SHA"));
    assert!(!setup.contains("scope_suffix=\"-pr-$pr_number\""));
    assert!(!setup.contains("scope_suffix=\"-remote-$branch_hash-task-$task_hash\""));
    assert!(setup.contains("GHA_CACHE_SCOPE_SUFFIX=$scope_suffix"));
    assert!(setup.contains("GHA_CACHE_FALLBACK_ENABLED=$fallback_enabled"));
    assert!(setup.contains("HIVE_CACHE_FROM=$hive_remote_ref"));
    assert!(setup.contains("HIVE_CACHE_SEED_FROM=$hive_seed"));
    assert!(setup.contains("docker buildx imagetools inspect"));
    assert!(setup.contains("HIVE_CACHE_TO=$hive_remote_ref,mode=max,timeout=15m"));
    assert!(!setup.contains("cache_total_count()"));

    assert_release_cache_fingerprint_contract()?;

    let app_bake = read("nook-app/docker-bake.hcl");
    let rust_bake = read("nook-app/nook-platform/docker/rust/docker-bake.hcl");
    let web_image_bake = read("nook-app/nook-web/docker/web.docker-bake.hcl");
    let web_toolchain_bake = read("nook-app/nook-web/docker/toolchain.docker-bake.hcl");
    let web_app_bake = read("nook-app/nook-web/nook-web-app/docker-bake.hcl");
    let bake =
        format!("{app_bake}\n{rust_bake}\n{web_image_bake}\n{web_toolchain_bake}\n{web_app_bake}");
    assert!(app_bake.contains("variable \"GHA_CACHE_SCOPE_SUFFIX\""));
    assert!(app_bake.contains("variable \"GHA_CACHE_FALLBACK_ENABLED\""));
    assert!(app_bake.contains("variable \"GHA_CACHE_SEED_SCOPE_SUFFIX\""));
    assert!(rust_bake.contains("variable \"GHA_RUST_WASM_DEPS_SCOPE\""));
    assert!(app_bake.contains("variable \"NOOK_REGISTRY_CACHE_HOST\""));
    assert!(app_bake.contains(
        "write_cache_repository = GHA_CACHE_SCOPE_SUFFIX != \"\" ? \"nook/remote-buildcache\" : \"nook/buildcache\""
    ));
    assert!(
        !app_bake.contains("web_deps_cache_from =")
            && !app_bake.contains("web_cache_from =")
            && !app_bake.contains("web_e2e_cache_from =")
            && web_toolchain_bake.contains("web_deps_cache_from =")
            && web_image_bake.contains("web_cache_from =")
            && web_image_bake.contains("web_e2e_cache_from ="),
        "web Zot cache scope definitions must live under nook-web/docker bake files"
    );
    assert!(rust_bake.contains("nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache"));
    assert!(rust_bake.contains("rust_wasm_deps_write_scope"));
    assert!(rust_bake.contains(
        "${write_cache_repository}/${rust_wasm_deps_write_scope}:buildcache,mode=max,timeout=10m"
    ));
    let wasm_source_cache = rust_bake
        .split_once("rust_wasm_source_cache_from =")
        .context("platform bake must define the WASM source cache inputs")?
        .1
        .split_once("rust_wasm_source_cache_to =")
        .context("platform bake must delimit the WASM source cache inputs")?
        .0;
    assert!(
        wasm_source_cache
            .matches("nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache")
            .count()
            >= 1,
        "every WASM source cache path must directly import the fingerprinted dependency lineage"
    );
    assert!(
        !wasm_source_cache.contains("nook-rust-base-v1")
            && !wasm_source_cache.contains("nook-rust-deps-v3"),
        "WASM source cache-from must not import shorter rust-base or native rust-deps parents"
    );
    let docker_tasks = read("nook-app/nook-platform/docker/Taskfile.yml");
    let platform_tasks = read("nook-app/nook-platform/Taskfile.yml");
    let wasm_cache_verifier = read(".github/scripts/verify-wasm-gha-cache.sh");
    assert!(
        wasm_cache_verifier.contains("GHA_RUST_WASM_DEPS_SCOPE:?missing GHA_RUST_WASM_DEPS_SCOPE")
            && wasm_cache_verifier.contains("nook/buildcache/$cache_scope:buildcache")
            && docker_tasks.contains(".github/scripts/verify-wasm-gha-cache.sh"),
        "Main WASM cache verify must require GHA_RUST_WASM_DEPS_SCOPE and import that buildcache ref"
    );
    let root_tasks = read("Taskfile.yml");
    assert!(
        root_tasks.contains("GHA_CACHE_ENABLED:")
            && root_tasks.contains("NOOK_REGISTRY_CACHE:-1")
            && root_tasks.contains("registry-remote-password")
            && root_tasks.contains("NOOK_REGISTRY_CACHE_LOCAL_PUBLISH:")
            && root_tasks.contains("NOOK_REGISTRY_CACHE_LOCAL_DEPS_PUBLISH:")
            && root_tasks.contains("NOOK_RUST_DEPS_INPUT_FINGERPRINT:")
            && root_tasks.contains("git-cache-scope.sh")
            && root_tasks.contains("rust-deps-cache-fingerprint.sh")
            && root_tasks.contains("git status --porcelain")
            && !root_tasks.contains("-pr-$pr")
            && !root_tasks.contains("-local-")
            && docker_tasks.contains("registry-cache:ensure")
            && docker_tasks.contains("registry-cache:publish:wasm")
            && docker_tasks.contains("git-cache-scope-publish-guard.sh")
            && docker_tasks.contains("rust-deps-cache-publish-guard.sh")
            && docker_tasks.contains("unsafe cache recipe; publication skipped")
            && docker_tasks.contains("builder-wasm-deps-input-publish")
            && docker_tasks.contains("builder-core-deps-input-publish")
            && docker_tasks.contains("login \"$host\"")
            && docker_tasks.contains("task: registry-cache:publish:wasm"),
        "Task Bake must enable clean git-commit publication plus dirty-safe formatter dependency publication"
    );
    assert!(
        platform_tasks.contains("${GITHUB_ACTIONS:-}")
            && platform_tasks.contains("${NOOK_ARC_RUNNER:-}")
            && platform_tasks
                .contains("tcp://nook-arc-buildkit.arc-runners.svc.cluster.local:1234")
            && platform_tasks
                .contains("the ARC BuildKit stages validate SeaweedFS without a Docker runtime"),
        "ARC sccache preflight must avoid a Docker runtime only on the cluster-local BuildKit path"
    );
    let git_scope = read(".github/scripts/git-cache-scope.sh");
    let publish_guard = read(".github/scripts/git-cache-scope-publish-guard.sh");
    let deps_publish_guard = read(".github/scripts/rust-deps-cache-publish-guard.sh");
    assert!(
        deps_publish_guard.contains("git -C \"$repo_root\" diff --quiet HEAD")
            && deps_publish_guard.contains("cache recipe is dirty")
            && deps_publish_guard.contains("fingerprint must be $expected"),
        "dirty-safe dependency publication must reject dirty cache infrastructure"
    );
    assert!(
        git_scope.contains("-git-$sha")
            && git_scope.contains("--require-clean")
            && publish_guard.contains("git-cache-scope.sh\" --require-clean")
            && publish_guard.contains("GHA_CACHE_SCOPE_SUFFIX must be"),
        "git-scoped cache helpers must emit -git-<sha> and refuse dirty local publish"
    );
    assert!(
        app_bake.contains("Local Task Bake sets this from root Taskfile env"),
        "shared bake comments must describe local registry-cache activation"
    );
    assert!(!bake.contains("type=gha"));
    for fallback in [
        "nook/buildcache/nook-rust-base-v1:buildcache",
        "nook/buildcache/nook-rust-deps-v3:buildcache",
        "nook/buildcache/nook-rust-native-source-v3:buildcache",
        "nook/buildcache/nook-rust-wasm-source-v2:buildcache",
        "nook/buildcache/nook-web-v1:buildcache",
    ] {
        assert!(
            bake.contains(fallback),
            "Main fallback cache ref is missing: {fallback}"
        );
    }
    for scope in [
        "nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}",
        "nook-rust-deps-v3${GHA_CACHE_SCOPE_SUFFIX}",
        "nook-rust-native-source-v3${GHA_CACHE_SCOPE_SUFFIX}",
        "nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX}",
        "nook-web-v1${GHA_CACHE_SCOPE_SUFFIX}",
    ] {
        assert!(
            bake.contains(scope),
            "delivery cache must isolate immutable PR job generations: {scope}"
        );
    }
    for write_scope in [
        "${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
        "${write_cache_repository}/nook-rust-deps-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
        "${write_cache_repository}/nook-rust-native-source-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
        "${write_cache_repository}/nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
        "${write_cache_repository}/nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
        "${write_cache_repository}/nook-web-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
        "${write_cache_repository}/nook-web-e2e-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
    ] {
        assert!(
            bake.contains(write_scope),
            "registry BuildKit write cache ref is missing: {write_scope}"
        );
    }
    for cold_isolated_import in [
        "${write_cache_repository}/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
        "${write_cache_repository}/nook-rust-deps-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
        "${write_cache_repository}/nook-rust-native-source-v3${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
        "${write_cache_repository}/nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
        "${write_cache_repository}/nook-rust-ecosystem-kani-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
        "${write_cache_repository}/nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
        "${write_cache_repository}/nook-web-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
        "${write_cache_repository}/nook-web-e2e-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true",
    ] {
        assert!(
            bake.contains(cold_isolated_import),
            "cold isolated cache-from must ignore missing remote-buildcache refs: {cold_isolated_import}"
        );
    }
    let wasm_deps_from = rust_bake
        .split_once("rust_wasm_deps_cache_from =")
        .context("platform bake must define the WASM deps cache inputs")?
        .1
        .split_once("rust_wasm_deps_cache_to =")
        .context("platform bake must delimit the WASM deps cache inputs")?
        .0;
    assert!(
        rust_bake.contains("rust_wasm_deps_cache_from")
            && app_bake.contains("registry.dev.nokey.sh"),
        "WASM dependency restores must import registry.dev.nokey.sh cache refs"
    );
    assert!(
        !wasm_deps_from.contains("nook-rust-base-v1")
            && !wasm_deps_from.contains("nook-rust-deps-v3")
            && wasm_deps_from.contains("nook-rust-wasm-source-v2"),
        "WASM deps cache-from must not import shorter rust-base or native rust-deps parents; longer source-v2 is the empty-fingerprint bootstrap"
    );
    let deps_from = rust_bake
        .split_once("rust_deps_cache_from =")
        .context("platform bake must define the native deps cache inputs")?
        .1
        .split_once("rust_deps_cache_to =")
        .context("platform bake must delimit the native deps cache inputs")?
        .0;
    let native_source_from = rust_bake
        .split_once("rust_native_source_cache_from =")
        .context("platform bake must define the native source cache inputs")?
        .1
        .split_once("rust_native_source_cache_to =")
        .context("platform bake must delimit the native source cache inputs")?
        .0;
    assert!(
        !deps_from.contains("nook-rust-base-v1")
            && !native_source_from.contains("nook-rust-base-v1")
            && deps_from.contains("nook-rust-deps-v3")
            && native_source_from.contains("nook-rust-native-source-v3")
            && native_source_from.contains("nook-rust-deps-v3"),
        "native deps must be own-scope v3; native source cold fallback may import deps but never rust-base"
    );
    assert!(
        rust_bake.contains(
            "rust_wasm_deps_write_scope = GHA_CACHE_SCOPE_SUFFIX != \"\" ? \"nook-rust-wasm-deps-v5${GHA_CACHE_SCOPE_SUFFIX}\""
        ) && wasm_deps_from.contains("GHA_CACHE_EXACT_RUST_WASM_DEPS_AVAILABLE")
            && wasm_deps_from.contains("${rust_wasm_deps_write_scope}:buildcache")
            && wasm_deps_from
                .contains("${GHA_RUST_WASM_DEPS_SCOPE}:buildcache,ignore-error=true"),
        "WASM deps must use the exact v5 scope alone when present and the fingerprinted Main scope only in cold fallback"
    );

    let wasm_bake = read("nook-app/nook-platform/nook-wasm/docker-bake.hcl");
    let focused_artifacts = wasm_bake
        .split_once("target \"focused-web-artifacts\"")
        .context("focused WASM artifact target must exist")?
        .1
        .split_once("\n}")
        .context("focused WASM artifact target must terminate")?
        .0;
    assert!(focused_artifacts.contains("cache-to   = rust_wasm_source_cache_to"));

    let focused_web = web_app_bake
        .split_once("target \"nook-web-focused\"")
        .context("focused web target must exist in nook-web-app bake")?
        .1
        .split_once("\n}")
        .context("focused web target must terminate")?
        .0;
    assert!(focused_web.contains("cache-to   = web_cache_to"));

    let core_bake = read("nook-app/nook-platform/nook-core/docker-bake.hcl");
    let wasm_dependencies = core_bake
        .split_once("target \"builder-wasm-deps\"")
        .context("core bake file must define the WASM dependency target")?
        .1
        .split_once("target \"builder-debug\"")
        .context("core bake file must delimit the WASM dependency target")?
        .0;
    assert!(
        wasm_dependencies.contains("cache-from = rust_wasm_deps_cache_from"),
        "WASM dependencies must restore Main's dedicated complete WASM dependency lineage"
    );
    assert!(
        wasm_dependencies
            .contains("dockerfile = \"nook-app/nook-platform/docker/rust/product.Dockerfile\"")
            && !wasm_dependencies.contains("rust-base = \"target:rust-base\""),
        "WASM dependency cache keys must extend rust-base inside one Dockerfile instead of through a volatile named-target image"
    );
    Ok(())
}

fn assert_release_cache_fingerprint_contract() -> anyhow::Result<()> {
    let release = read(".github/workflows/release.yml");
    let release_source = release
        .find("- name: Checkout release source")
        .context("release workflow must check out release source")?;
    let release_tooling = release
        .find("- name: Checkout release workflow tooling")
        .context("release workflow must check out workflow tooling")?;
    let release_docker_setup = release
        .find("- name: Docker setup")
        .context("release workflow must configure Docker")?;
    assert!(
        release_source < release_tooling && release_tooling < release_docker_setup,
        "release Docker setup must fingerprint the requested source after checkout"
    );
    assert!(release.contains("path: .nook/release-workflow"));
    assert!(release.contains("uses: ./.nook/release-workflow/.github/actions/nook-docker-setup"));
    Ok(())
}

#[test]
fn cache_hit_telemetry_distinguishes_compiler_and_buildkit_reuse() -> anyhow::Result<()> {
    let reporter = read("nook-app/nook-platform/docker/sccache-report.sh");
    for required in [
        "--show-stats --stats-format=json",
        "NOOK_SCCACHE_STATS",
        "compile_requests",
        "requests_executed",
        "cache_hits",
        "cache_misses",
        "cache_errors",
        "cache_writes",
    ] {
        assert!(
            reporter.contains(required),
            "sccache reporter is missing safe counter: {required}"
        );
    }
    for forbidden in [
        "cache_location",
        "SCCACHE_REDIS_PASSWORD",
        "SCCACHE_REDIS_ENDPOINT",
        "AWS_SECRET_ACCESS_KEY",
        "SCCACHE_SECRET",
    ] {
        assert!(
            !reporter.contains(forbidden),
            "sccache telemetry must not emit backend details: {forbidden}"
        );
    }

    let rust_base = read("nook-app/nook-platform/docker/rust/product.Dockerfile");
    assert!(rust_base.contains("sccache-report.sh /usr/local/bin/nook-sccache-report"));
    let product = read("nook-app/nook-platform/docker/rust/product.Dockerfile");
    assert!(
        product.contains("nook-sccache-report"),
        "product.Dockerfile must report compiler cache outcomes"
    );
    assert!(
        read("nook-app/nook-platform/docker/rust/product.Dockerfile")
            .matches("nook-sccache-report")
            .count()
            >= 12
    );
    assert!(
        read("nook-app/nook-platform/docker/rust/product.Dockerfile")
            .matches("nook-sccache-report")
            .count()
            >= 3
    );

    assert_delivery_cache_scope_contract()?;

    let telemetry_action = read(".github/actions/nook-cache-telemetry/action.yml");
    for required in [
        "cache-telemetry.cjs collect",
        "cache-telemetry-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}",
        "actions/upload-artifact@v7",
    ] {
        assert!(
            telemetry_action.contains(required),
            "cache telemetry action is missing: {required}"
        );
    }

    let pr = read(".github/workflows/pr.yml");
    assert!(
        pr.matches("uses: ./.github/actions/nook-cache-telemetry")
            .count()
            >= 5,
        "every Buildx-backed PR job must preserve cache telemetry"
    );
    let main = read(".github/workflows/main.yml");
    assert!(main.contains("uses: ./.github/actions/nook-cache-telemetry"));

    let main_stats = read(".github/workflows/main-build-stats.yml");
    for required in [
        "Download completed Main cache telemetry",
        "cache-telemetry-${{ github.event.workflow_run.id }}-${{ github.event.workflow_run.run_attempt }}-*",
        "cacheTelemetry",
    ] {
        assert!(
            main_stats.contains(required),
            "Main statistics must retain cache telemetry: {required}"
        );
    }
    Ok(())
}

#[test]
fn rust_build_targets_inherit_the_sccache_configuration() -> anyhow::Result<()> {
    for (path, targets) in [
        (
            "nook-app/nook-platform/nook-core/docker-bake.hcl",
            [
                "builder-core-deps",
                "builder-debug",
                "coverage-export",
                "_nook-rust-test-common",
            ]
            .as_slice(),
        ),
        (
            "nook-app/nook-platform/nook-wasm/docker-bake.hcl",
            [
                "builder-wasm",
                "web-artifacts",
                "_nook-rust-common",
                "_nook-rust-browser-common",
            ]
            .as_slice(),
        ),
    ] {
        let bake = read(path);
        for target in targets {
            let start = format!("target \"{target}\" {{");
            let body = bake
                .split_once(&start)
                .unwrap_or_else(|| panic!("missing target {target} in {path}"))
                .1
                .split_once("\n}")
                .unwrap_or_else(|| panic!("unterminated target {target} in {path}"))
                .0;
            assert!(
                body.contains("inherits") && body.contains("_sccache"),
                "{target} must inherit the sccache configuration"
            );
        }
    }
    Ok(())
}
