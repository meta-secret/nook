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

#[test]
fn hive_materializes_test_and_clippy_dependency_graphs_in_parallel() -> anyhow::Result<()> {
    let dockerfile = read("agentic-ai/minds/hive/Dockerfile");
    for required in [
        "FROM fetched-dependencies AS test-dependencies",
        "FROM fetched-dependencies AS clippy-dependencies",
        "FROM clippy-dependencies AS check-source",
        "FROM test-dependencies AS test-source",
        "COPY --from=test-dependencies /opt/nook/hive-test-dependencies",
        "COPY --from=clippy-dependencies /opt/nook/hive-clippy-dependencies",
    ] {
        assert!(
            dockerfile.contains(required),
            "Hive parallel verification cache topology is missing: {required}"
        );
    }
    assert!(
        !dockerfile.contains("AS verification-dependencies"),
        "Hive test and Clippy dependency graphs must not share a serial stage"
    );
    Ok(())
}

#[test]
fn sccache_uses_authenticated_seaweedfs_s3_without_docker_host_routing() -> anyhow::Result<()> {
    let app_tasks = read("nook-app/Taskfile.yml");
    for required in [
        "https://sccache.dev.nokey.sh",
        ".nook/cache/sccache-access-key",
        ".nook/cache/sccache-secret-key",
        "${HOME}/.nook/cache/sccache-access-key",
        "${HOME}/.nook/cache/sccache-secret-key",
        "no S3 credential; compiling without sccache",
        "SeaweedFS S3 is unavailable; compiling without remote sccache",
        "SeaweedFS S3 sccache is healthy",
        "--set '*.args.SCCACHE_ENDPOINT={{.SCCACHE_ENDPOINT}}'",
        "--set '*.args.SCCACHE_BUCKET={{.SCCACHE_BUCKET}}'",
        "--set '*.args.SCCACHE_S3_MODE={{.SCCACHE_S3_MODE}}'",
    ] {
        assert!(
            app_tasks.contains(required),
            "SeaweedFS sccache configuration is missing: {required}"
        );
    }
    assert!(
        !app_tasks.contains("print $4; exit") && !app_tasks.contains("print $2; exit"),
        "pipefail-safe Docker inspection must consume complete output instead of SIGPIPEing the producer"
    );
    assert!(
        !app_tasks.contains("SCCACHE_REDIS")
            && !app_tasks.contains("redis-password")
            && !app_tasks.contains("rediss://"),
        "Taskfile must not retain Redis sccache wiring"
    );
    let dockerignore = read(".dockerignore");
    assert!(
        dockerignore.lines().any(|line| line == ".nook"),
        "ignored local credentials must never enter a Docker build context"
    );
    for dockerfile_ignore in [
        "nook-app/nook-core/Dockerfile.dockerignore",
        "nook-app/nook-wasm/Dockerfile.dockerignore",
    ] {
        assert!(
            read(dockerfile_ignore)
                .lines()
                .any(|line| line == "**/docker-bake.hcl"),
            "{dockerfile_ignore} must keep Bake policy out of source-sensitive Rust COPY layers"
        );
    }

    let bake = read("nook-app/docker-bake.hcl");
    assert!(bake.contains("variable \"SCCACHE_ENDPOINT\""));
    assert!(bake.contains("variable \"SCCACHE_BUCKET\""));
    assert!(bake.contains("variable \"SCCACHE_S3_MODE\""));
    assert!(bake.contains("target \"_sccache\""));
    assert!(!bake.contains("extra-hosts"));
    assert!(!bake.contains("SCCACHE_REDIS"));

    let rust_base = read("nook-app/docker/base.Dockerfile");
    assert!(rust_base.contains("ARG SCCACHE_ENDPOINT=https://sccache.dev.nokey.sh"));
    assert!(rust_base.contains("ENV SCCACHE_ENDPOINT=${SCCACHE_ENDPOINT}"));
    assert!(rust_base.contains("ENV SCCACHE_BUCKET=${SCCACHE_BUCKET}"));
    assert!(rust_base.contains("NOOK_SCCACHE_S3_MODE=${SCCACHE_S3_MODE}"));
    assert!(rust_base.contains("SCCACHE_SERVER_UDS=/tmp/nook-sccache.sock"));

    for path in [
        "nook-app/Taskfile.yml",
        "nook-app/docker/Taskfile.yml",
        "nook-app/docker-bake.hcl",
        "nook-app/docker/base.Dockerfile",
    ] {
        assert!(
            !read(path).contains("host.docker.internal")
                && !read(path).contains("SCCACHE_REDIS_HOST_IP"),
            "{path} must not route the compiler cache through the Docker host"
        );
    }

    assert!(
        !repository_root()
            .join("nook-app/docker/resolve-docker-host-ip.sh")
            .exists()
    );
    Ok(())
}

#[test]
fn trusted_github_actions_share_compiler_objects_without_weakening_prs() -> anyhow::Result<()> {
    assert_hosted_docker_builds_connect_scoped_compiler_cache();
    assert_workflows_scope_cache_credentials();
    assert_rust_build_cache_boundary();
    Ok(())
}

fn assert_hosted_docker_builds_connect_scoped_compiler_cache() {
    let action = read(".github/actions/nook-docker-setup/action.yml");
    for required in [
        "sccache-access-key",
        "sccache-secret-key",
        "uses: ./.github/actions/nook-cache-connect",
        "isolated-cache-write",
    ] {
        assert!(
            action.contains(required),
            "hosted Docker cache configuration is missing: {required}"
        );
    }
    assert!(!action.contains("cache-redis-password"));
    assert!(!action.contains("hosted_buildkit_only"));
    assert!(!action.contains("cloudflare-client"));
    assert!(!action.contains("ssh -fNT") && !action.contains("CACHE_SSH_PRIVATE_KEY"));

    let cache_action = read(".github/actions/nook-cache-connect/action.yml");
    assert!(cache_action.contains("using: node24"));
    assert!(cache_action.contains("sccache-access-key"));
    assert!(cache_action.contains("sccache-secret-key"));
    assert!(!cache_action.contains("cloudflare"));
    let cache_action_main = read(".github/actions/nook-cache-connect/main.js");
    for required in [
        "mode: 0o700",
        "mode: 0o600",
        "delete process.env[accessKeyInput]",
        "delete process.env[secretKeyInput]",
        "SCCACHE_S3_ACCESS_KEY_FILE",
        "SCCACHE_S3_SECRET_KEY_FILE",
        "NOOK_SCCACHE_BACKEND=direct_compile",
        "NOOK_SCCACHE_BACKEND=remote",
        "NOOK_SCCACHE_BACKEND_REASON=persistent_s3_service",
        "hosted_secret_free_by_design",
        "credentials_unavailable",
    ] {
        assert!(
            cache_action_main.contains(required),
            "cache credential action is missing: {required}"
        );
    }
    assert!(!cache_action_main.contains("console."));
    assert!(!cache_action_main.contains("shell: true"));
    assert!(!cache_action_main.contains("process.stdout.write"));
    assert!(!cache_action_main.contains("spawnSync"));
    assert!(!cache_action_main.contains("cloudflare"));
    assert!(!cache_action_main.contains("REDIS"));
}

fn assert_workflows_scope_cache_credentials() {
    for path in [
        ".github/workflows/agent-implement.yml",
        ".github/workflows/e2e-pr.yml",
        ".github/workflows/pr.yml",
        ".github/workflows/release.yml",
        ".github/workflows/rust-dependency-updates.yml",
    ] {
        let workflow = read(path);
        for secret in [
            "NOOK_SCCACHE_ACCESS_KEY",
            "NOOK_SCCACHE_SECRET_KEY",
            "NOOK_CACHE_REDIS_PASSWORD",
            "NOOK_CLOUDFLARE_ACCESS",
        ] {
            assert!(
                !workflow.contains(secret),
                "untrusted or arbitrary-ref workflow {path} must not receive {secret}"
            );
        }
    }

    let main = read(".github/workflows/main.yml");
    assert!(
        main.matches("NOOK_SCCACHE_ACCESS_KEY").count() == 2
            && main.matches("NOOK_SCCACHE_SECRET_KEY").count() == 2
            && !main.contains("NOOK_CACHE_REDIS_PASSWORD"),
        "trusted Main Rust and WASM producers must populate SeaweedFS compiler objects"
    );
    assert!(!main.contains("NOOK_CLOUDFLARE_ACCESS"));

    let remote = read(".github/workflows/remote.yml");
    let selected_jobs = remote.matches("if: inputs.task == '").count();
    assert_eq!(
        remote.matches("NOOK_SCCACHE_REMOTE_ACCESS_KEY").count(),
        selected_jobs
    );
    assert_eq!(
        remote.matches("NOOK_SCCACHE_REMOTE_SECRET_KEY").count(),
        selected_jobs
    );
    assert_eq!(
        remote.matches("NOOK_SCCACHE_REMOTE_BUCKET").count(),
        selected_jobs
    );
    assert_eq!(
        remote.matches("NOOK_SCCACHE_ENDPOINT").count(),
        selected_jobs
    );
    assert_eq!(
        remote.matches("isolated-cache-write: \"true\"").count(),
        selected_jobs
    );

    let hive = read(".github/workflows/hive.yml");
    assert!(hive.contains("NOOK_SCCACHE_ACCESS_KEY"));
    assert!(hive.contains("NOOK_SCCACHE_SECRET_KEY"));
    assert!(!hive.contains("NOOK_CACHE_REDIS_PASSWORD"));
}

fn assert_rust_build_cache_boundary() {
    let bake = read("nook-app/docker-bake.hcl");
    let app_tasks = read("nook-app/Taskfile.yml");
    assert!(!bake.contains("SCCACHE_S3_ACCESS_KEY"));
    assert!(!bake.contains("secret =") && !bake.contains("SCCACHE_REDIS"));
    assert!(
        app_tasks.contains("--set '*.secrets=id=sccache_s3_access_key,src=$access_file'")
            && app_tasks.contains("--set '*.secrets+=id=sccache_s3_secret_key,src=$secret_file'")
            && app_tasks.contains("--allow=fs.read=$access_file")
            && app_tasks.contains("--allow=fs.read=$secret_file")
            && !app_tasks.contains("SCCACHE_REDIS_BAKE_ALLOW"),
        "Bake must receive compiler credentials through stable secret IDs and runner-local files"
    );
    assert!(!app_tasks.contains("--build-arg SCCACHE_S3_ACCESS_KEY"));
    assert!(!app_tasks.contains("--build-arg SCCACHE_S3_SECRET_KEY"));
    assert!(
        app_tasks.contains("s3api list-objects-v2 --bucket \"{{.SCCACHE_BUCKET}}\"")
            && app_tasks.contains("--continuation-token \"$continuation_token\"")
            && app_tasks.contains("Scanned $total_objects compiler-cache objects")
            && app_tasks.contains("Total Objects: $total_objects")
            && !app_tasks.contains("tail -n 2"),
        "sccache stats must paginate the full bucket and stream per-page progress"
    );

    let wrapper = read("nook-app/docker/sccache-wrapper.sh");
    assert!(wrapper.contains("/run/secrets/sccache_s3_access_key"));
    assert!(wrapper.contains("/run/secrets/sccache_s3_secret_key"));
    assert!(wrapper.contains("NOOK_SCCACHE_S3_MODE"));
    assert!(wrapper.contains("SCCACHE_S3_ENABLE_VIRTUAL_HOST_STYLE"));
    assert!(wrapper.contains("exec \"$@\""));
    assert!(wrapper.contains("exec /usr/local/bin/sccache \"$@\""));
    assert!(!wrapper.contains("REDIS"));

    let rust_base = read("nook-app/docker/base.Dockerfile");
    assert!(rust_base.contains("RUSTC_WRAPPER=/usr/local/bin/nook-sccache"));
    assert!(rust_base.contains("NOOK_SCCACHE_S3_MODE=${SCCACHE_S3_MODE}"));
    assert!(rust_base.contains("SCCACHE_IGNORE_SERVER_IO_ERROR=1"));

    assert!(bake.contains("SCCACHE_S3_MODE") && bake.contains("= SCCACHE_S3_MODE"));
    assert!(app_tasks.contains("--set '*.args.SCCACHE_S3_MODE={{.SCCACHE_S3_MODE}}'"));

    for path in [
        "nook-app/docker/base.Dockerfile",
        "nook-app/nook-core/Dockerfile",
        "nook-app/nook-wasm/Dockerfile",
    ] {
        let dockerfile = read(path);
        let reports = dockerfile.matches("nook-sccache-report ").count();
        assert!(
            reports > 0
                && dockerfile
                    .matches("--mount=type=secret,id=sccache_s3_access_key,required=false")
                    .count()
                    == reports
                && dockerfile
                    .matches("--mount=type=secret,id=sccache_s3_secret_key,required=false")
                    .count()
                    == reports,
            "every reported compiler vertex in {path} must use the same two optional secret mounts"
        );
        assert!(!dockerfile.contains("ARG SCCACHE_S3_ACCESS_KEY"));
        assert!(!dockerfile.contains("ARG SCCACHE_S3_SECRET_KEY"));
    }
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
    for fingerprint_input in [
        "nook-app/Cargo.toml",
        "nook-app/Cargo.lock",
        "nook-app/**/Cargo.toml",
        "nook-app/.cargo/**",
        "nook-app/.config/**",
        "nook-app/Taskfile.yml",
        "nook-app/docker-bake.hcl",
        "nook-app/**/docker-bake.hcl",
        "nook-app/docker/*.docker-bake.hcl",
        "nook-app/docker/base.Dockerfile",
        "nook-app/docker/Taskfile.yml",
        "nook-app/docker/sccache-wrapper.sh",
        "nook-app/docker/sccache-report.sh",
        "nook-app/nook-core/Dockerfile",
    ] {
        assert!(
            setup.contains(fingerprint_input),
            "WASM dependency scope fingerprint is missing {fingerprint_input}"
        );
    }
    assert!(
        setup.contains("GHA_RUST_WASM_DEPS_SCOPE=nook-rust-wasm-deps-v4-$wasm_deps_fingerprint")
    );
    assert!(setup.contains("GHA_CACHE_WRITE_ENABLED=$cache_write_enabled"));
    assert!(setup.contains("[ -z \"$read_only\" ]"));
    assert!(setup.contains("main-cache-only"));
    assert!(setup.contains("main-cache-only requires cache-write=false"));
    assert!(setup.contains("isolated-cache-write requires workflow_dispatch"));
    assert!(
        setup.contains(
            "branch_hash=\"$(printf '%s' \"$GITHUB_REF_NAME\" | sha256sum | cut -c1-20)\""
        )
    );
    assert!(setup.contains("task_hash=\"$(printf '%s' \"$task_name\" | sha256sum | cut -c1-12)\""));
    assert!(setup.contains("scope_suffix=\"-remote-$branch_hash-task-$task_hash\""));
    assert!(setup.contains("GHA_CACHE_SCOPE_SUFFIX=$scope_suffix"));
    assert!(setup.contains("GHA_CACHE_FALLBACK_ENABLED=$fallback_enabled"));
    assert!(setup.contains("HIVE_CACHE_FROM=$hive_remote_ref"));
    assert!(setup.contains("HIVE_CACHE_SEED_FROM=type=registry"));
    assert!(setup.contains("HIVE_CACHE_TO=$hive_remote_ref,mode=max"));
    assert!(!setup.contains("cache_total_count()"));

    assert_release_cache_fingerprint_contract()?;

    let bake = read("nook-app/docker-bake.hcl");
    assert!(bake.contains("variable \"GHA_CACHE_SCOPE_SUFFIX\""));
    assert!(bake.contains("variable \"GHA_CACHE_FALLBACK_ENABLED\""));
    assert!(bake.contains("variable \"GHA_CACHE_SEED_SCOPE_SUFFIX\""));
    assert!(bake.contains("variable \"GHA_RUST_WASM_DEPS_SCOPE\""));
    assert!(bake.contains("variable \"NOOK_REGISTRY_CACHE_HOST\""));
    assert!(bake.contains(
        "write_cache_repository = GHA_CACHE_SCOPE_SUFFIX != \"\" ? \"nook/remote-buildcache\" : \"nook/buildcache\""
    ));
    assert!(bake.contains("nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache"));
    assert!(bake.contains("rust_wasm_deps_write_scope"));
    assert!(bake.contains(
        "${write_cache_repository}/${rust_wasm_deps_write_scope}:buildcache,mode=max,timeout=10m"
    ));
    let wasm_source_cache = bake
        .split_once("rust_wasm_source_cache_from =")
        .context("bake file must define the WASM source cache inputs")?
        .1
        .split_once("rust_wasm_source_cache_to =")
        .context("bake file must delimit the WASM source cache inputs")?
        .0;
    assert!(
        wasm_source_cache
            .matches("nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache")
            .count()
            >= 1,
        "every WASM source cache path must directly import the fingerprinted dependency lineage"
    );
    let docker_tasks = read("nook-app/docker/Taskfile.yml");
    assert!(docker_tasks.contains(
        "nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE:?missing GHA_RUST_WASM_DEPS_SCOPE}:buildcache"
    ));
    assert!(!bake.contains("type=gha"));
    for fallback in [
        "nook/buildcache/nook-rust-base-v1:buildcache",
        "nook/buildcache/nook-rust-deps-v2:buildcache",
        "nook/buildcache/nook-rust-native-source-v2:buildcache",
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
        "nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}",
        "nook-rust-native-source-v2${GHA_CACHE_SCOPE_SUFFIX}",
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
        "${write_cache_repository}/nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
        "${write_cache_repository}/nook-rust-native-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
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
    assert!(
        bake.contains(
            "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-base-v1"
        ) && bake.contains("rust_wasm_deps_cache_from")
            && bake.contains("registry.dev.nokey.sh"),
        "WASM/native dependency restores must import registry.dev.nokey.sh cache refs including rust-base"
    );

    let wasm_bake = read("nook-app/nook-wasm/docker-bake.hcl");
    let focused_artifacts = wasm_bake
        .split_once("target \"focused-web-artifacts\"")
        .context("focused WASM artifact target must exist")?
        .1
        .split_once("\n}")
        .context("focused WASM artifact target must terminate")?
        .0;
    assert!(focused_artifacts.contains("cache-to   = rust_wasm_source_cache_to"));

    let focused_web = bake
        .split_once("target \"nook-web-focused\"")
        .context("focused web target must exist")?
        .1
        .split_once("\n}")
        .context("focused web target must terminate")?
        .0;
    assert!(focused_web.contains("cache-to   = web_cache_to"));

    let core_bake = read("nook-app/nook-core/docker-bake.hcl");
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
        wasm_dependencies.contains("dockerfile = \"nook-app/docker/base.Dockerfile\"")
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
    let reporter = read("nook-app/docker/sccache-report.sh");
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

    let rust_base = read("nook-app/docker/base.Dockerfile");
    assert!(rust_base.contains("sccache-report.sh /usr/local/bin/nook-sccache-report"));
    for path in [
        "nook-app/docker/base.Dockerfile",
        "nook-app/nook-core/Dockerfile",
        "nook-app/nook-wasm/Dockerfile",
    ] {
        assert!(
            read(path).contains("nook-sccache-report"),
            "{path} must report compiler cache outcomes"
        );
    }
    assert!(
        read("nook-app/docker/base.Dockerfile")
            .matches("nook-sccache-report")
            .count()
            >= 12
    );
    assert!(
        read("nook-app/nook-wasm/Dockerfile")
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
            "nook-app/nook-core/docker-bake.hcl",
            [
                "builder-deps",
                "builder-debug",
                "coverage-export",
                "_nook-rust-test-common",
            ]
            .as_slice(),
        ),
        (
            "nook-app/nook-wasm/docker-bake.hcl",
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
