#![allow(clippy::unnecessary_wraps)]

#[path = "sccache_s3/delivery_cache_contracts.rs"]
mod delivery_cache_contracts;

use std::{env, fs, path::PathBuf};

use anyhow::Context;

fn repository_root() -> PathBuf {
    env::var_os("NOOK_REPO_ROOT").map_or_else(
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
        "cargo test --locked --workspace --no-run",
        "cargo clippy --locked --workspace --all-targets -- -D warnings",
        "ENV CARGO_PROFILE_DEV_DEBUG=0",
        "ENV CARGO_PROFILE_TEST_DEBUG=0",
        "COPY graph.yaml graph.yaml",
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
fn hive_named_sccache_helper_context_never_uploads_nook_app() -> anyhow::Result<()> {
    let hive_tasks = read("agentic-ai/minds/hive/Taskfile.yml");
    let hive_dockerfile = read("agentic-ai/minds/hive/Dockerfile");
    let prepare = read("agentic-ai/minds/hive/prepare-sccache-context.sh");
    let infra_hive = read("infra/tasks/hive.yml");
    for required in [
        "prepare-sccache-context.sh",
        "prepare_nook_sccache_helpers_context",
        "nook-sccache-helpers=$NOOK_SCCACHE_HELPERS_CONTEXT",
    ] {
        assert!(
            hive_tasks.contains(required),
            "Hive tasks must stage a tiny sccache helper context: {required}"
        );
    }
    assert!(
        !hive_tasks.contains("NOOK_APP_CONTEXT")
            && !hive_tasks.contains("--build-context \"nook-app=")
            && !hive_tasks.contains("--build-context nook-app="),
        "Hive must not use a named BuildKit context rooted at nook-app"
    );
    for required in [
        "COPY --from=nook-sccache-helpers sccache-wrapper.sh",
        "COPY --from=nook-sccache-helpers sccache-report.sh",
    ] {
        assert!(
            hive_dockerfile.contains(required),
            "Hive Dockerfile must copy sccache helpers from the staged context: {required}"
        );
    }
    for required in [
        "nook-app/nook-platform/docker/sccache-wrapper.sh",
        "nook-app/nook-platform/docker/sccache-report.sh",
        "Refusing oversized sccache helper context",
        "Refusing sccache helper context that looks like nook-app",
    ] {
        assert!(
            prepare.contains(required),
            "sccache helper staging script is missing: {required}"
        );
    }
    assert!(
        infra_hive.contains(
            "--build-context \"nook-sccache-helpers=$remote_dir/nook-app/nook-platform/docker\""
        ),
        "remote Hive image builds must use the narrowed nook-sccache-helpers context"
    );
    Ok(())
}

#[test]
fn sccache_uses_authenticated_seaweedfs_s3_without_docker_host_routing() -> anyhow::Result<()> {
    let app_tasks = read("nook-app/Taskfile.yml");
    let platform_tasks = read("nook-app/nook-platform/Taskfile.yml");
    let sccache_tasks = format!("{app_tasks}\n{platform_tasks}");
    for required in [
        "https://sccache.dev.nokey.sh",
        "${HOME}/.nook/cache/sccache-access-key",
        "${HOME}/.nook/cache/sccache-secret-key",
        "~/.nook/cache/",
        "missing S3 credentials",
        "SCCACHE_OPTIONAL=1",
        "Refusing to compile without sccache",
        "SeaweedFS S3 is unavailable",
        "Refusing to compile without a healthy remote sccache backend",
        "SeaweedFS S3 sccache is healthy",
        "--set '*.args.SCCACHE_ENDPOINT={{.SCCACHE_ENDPOINT}}'",
        "--set '*.args.SCCACHE_BUCKET={{.SCCACHE_BUCKET}}'",
        "--set '*.args.SCCACHE_S3_MODE={{.SCCACHE_S3_MODE}}'",
    ] {
        assert!(
            sccache_tasks.contains(required),
            "SeaweedFS sccache configuration is missing: {required}"
        );
    }
    assert!(
        !sccache_tasks.contains("{{.REPO_ROOT}}/.nook/cache/")
            && !sccache_tasks.contains("repo .nook/cache"),
        "local sccache credentials must live only under ~/.nook/cache"
    );
    assert!(
        !sccache_tasks.contains("print $4; exit") && !sccache_tasks.contains("print $2; exit"),
        "pipefail-safe Docker inspection must consume complete output instead of SIGPIPEing the producer"
    );
    assert!(
        !sccache_tasks.contains("SCCACHE_REDIS")
            && !sccache_tasks.contains("redis-password")
            && !sccache_tasks.contains("rediss://"),
        "Taskfile must not retain Redis sccache wiring"
    );
    let dockerignore = read(".dockerignore");
    assert!(
        dockerignore.lines().any(|line| line == ".nook"),
        "ignored local credentials must never enter a Docker build context"
    );
    for dockerfile_ignore in [
        "nook-app/nook-platform/nook-core/Dockerfile.dockerignore",
        "nook-app/nook-platform/nook-wasm/Dockerfile.dockerignore",
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

    let rust_base = read("nook-app/nook-platform/docker/rust/product.Dockerfile");
    assert!(rust_base.contains("ARG SCCACHE_ENDPOINT=https://sccache.dev.nokey.sh"));
    assert!(rust_base.contains("ENV SCCACHE_ENDPOINT=${SCCACHE_ENDPOINT}"));
    assert!(rust_base.contains("ENV SCCACHE_BUCKET=${SCCACHE_BUCKET}"));
    assert!(rust_base.contains("NOOK_SCCACHE_S3_MODE=${SCCACHE_S3_MODE}"));
    assert!(rust_base.contains("SCCACHE_SERVER_UDS=/tmp/nook-sccache.sock"));

    for path in [
        "nook-app/Taskfile.yml",
        "nook-app/nook-platform/docker/Taskfile.yml",
        "nook-app/docker-bake.hcl",
        "nook-app/nook-platform/docker/rust/product.Dockerfile",
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
    assert_workflows_scope_cache_credentials()?;
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
        "delete process.env[\"INPUT_SCCACHE-ACCESS-KEY\"]",
        "delete process.env[\"INPUT_SCCACHE-SECRET-KEY\"]",
        "SCCACHE_S3_ACCESS_KEY_FILE",
        "SCCACHE_S3_SECRET_KEY_FILE",
        "NOOK_SCCACHE_BACKEND=direct_compile",
        "NOOK_SCCACHE_BACKEND=remote",
        "NOOK_SCCACHE_BACKEND_REASON=persistent_s3_service",
        "hosted_secret_free_by_design",
        "credentials_unavailable",
        "SCCACHE_OPTIONAL=1",
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

fn assert_workflows_scope_cache_credentials() -> anyhow::Result<()> {
    for path in [
        ".github/workflows/agent-implement.yml",
        ".github/workflows/e2e-pr.yml",
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
        main.matches("NOOK_SCCACHE_ACCESS_KEY").count() == 3
            && main.matches("NOOK_SCCACHE_SECRET_KEY").count() == 3
            && !main.contains("NOOK_CACHE_REDIS_PASSWORD"),
        "trusted Main Rust, WASM, and portable-proof jobs must populate SeaweedFS compiler objects"
    );
    assert!(!main.contains("NOOK_CLOUDFLARE_ACCESS"));

    let pr = read(".github/workflows/pr.yml");
    let pr_docker_setups = pr
        .matches("uses: ./.github/actions/nook-docker-setup")
        .count();
    let compiler_credentials = [
        "NOOK_SCCACHE_ACCESS_KEY",
        "NOOK_SCCACHE_SECRET_KEY",
        "NOOK_SCCACHE_ENDPOINT",
        "NOOK_SCCACHE_BUCKET",
    ];
    for (job_name, start, end) in [
        ("Native Rust verification", "\n  rust:\n", "\n  wasm:\n"),
        (
            "WASM build and artifact",
            "\n  wasm:\n",
            "\n  wasm-node-test:\n",
        ),
        ("WASM Node tests", "\n  wasm-node-test:\n", "\n  verify:\n"),
    ] {
        let job = pr
            .split_once(start)
            .and_then(|(_, tail)| tail.split_once(end))
            .map(|(job, _)| job)
            .with_context(|| format!("PR workflow must keep the {job_name} job"))?;
        for credential in compiler_credentials {
            assert!(
                job.contains(credential),
                "Rust-producing PR job {job_name} must receive {credential}"
            );
        }
    }
    for credential in compiler_credentials {
        assert_eq!(
            pr.matches(credential).count(),
            3,
            "only the three Rust-producing PR jobs may receive {credential}"
        );
    }
    assert_eq!(
        pr.matches("isolated-cache-write: \"true\"").count(),
        pr_docker_setups,
        "PR Docker jobs must write only isolated remote-buildcache scopes"
    );
    assert!(!pr.contains("NOOK_CACHE_REDIS_PASSWORD"));

    let ecosystem = read(".github/workflows/rust-ecosystem-checks.yml");
    let ecosystem_docker_setups = ecosystem
        .matches("uses: ./.github/actions/nook-docker-setup")
        .count();
    assert_eq!(
        ecosystem.matches("NOOK_SCCACHE_ACCESS_KEY").count(),
        ecosystem_docker_setups,
        "Rust ecosystem Docker jobs must mount SeaweedFS sccache"
    );
    assert!(ecosystem.contains("isolated-cache-write: ${{ inputs.isolated_cache_write }}"));
    let ecosystem_entry = read(".github/workflows/rust-ecosystem.yml");
    assert!(ecosystem_entry.contains(
        "isolated_cache_write: ${{ github.event_name == 'pull_request' && 'true' || 'false' }}"
    ));

    let remote = read(".github/workflows/remote.yml");
    let compiler_jobs = 2;
    assert!(remote.contains("if: inputs.task == 'rust-cache:promote'"));
    assert_eq!(
        remote.matches("NOOK_SCCACHE_REMOTE_ACCESS_KEY").count(),
        compiler_jobs
    );
    assert_eq!(
        remote.matches("NOOK_SCCACHE_REMOTE_SECRET_KEY").count(),
        compiler_jobs
    );
    assert_eq!(
        remote.matches("NOOK_SCCACHE_REMOTE_BUCKET").count(),
        compiler_jobs
    );
    assert_eq!(
        remote.matches("NOOK_SCCACHE_ENDPOINT").count(),
        compiler_jobs
    );
    assert!(remote.contains(
        "isolated-cache-write: ${{ (inputs.tasks || inputs.task) == 'hive:verify' && 'false' || 'true' }}"
    ));
    let remote_batch = read(".github/scripts/remote-task-batch.sh");
    assert!(remote_batch.contains("env HIVE_CACHE_TO= task hive:verify"));

    let hive = read(".github/workflows/hive.yml");
    assert!(hive.contains("NOOK_SCCACHE_ACCESS_KEY"));
    assert!(hive.contains("NOOK_SCCACHE_SECRET_KEY"));
    assert!(hive.contains("uses: ./.github/actions/nook-docker-setup"));
    assert!(hive.contains("runs-on: nook-k0s-hive"));
    assert!(hive.contains(
        "isolated-cache-write: ${{ github.event_name == 'pull_request' && 'true' || 'false' }}"
    ));
    assert!(!hive.contains("NOOK_CACHE_REDIS_PASSWORD"));
    Ok(())
}

fn assert_rust_build_cache_boundary() {
    let bake = read("nook-app/docker-bake.hcl");
    let app_tasks = read("nook-app/Taskfile.yml");
    let platform_tasks = read("nook-app/nook-platform/Taskfile.yml");
    let sccache_tasks = format!("{app_tasks}\n{platform_tasks}");
    assert!(!bake.contains("SCCACHE_S3_ACCESS_KEY"));
    assert!(!bake.contains("secret =") && !bake.contains("SCCACHE_REDIS"));
    assert!(
        sccache_tasks.contains("--set '*.secrets=id=sccache_s3_access_key,src=$access_file'")
            && sccache_tasks
                .contains("--set '*.secrets+=id=sccache_s3_secret_key,src=$secret_file'")
            && sccache_tasks.contains("--allow=fs.read=$access_file")
            && sccache_tasks.contains("--allow=fs.read=$secret_file")
            && !sccache_tasks.contains("SCCACHE_REDIS_BAKE_ALLOW"),
        "Bake must receive compiler credentials through stable secret IDs and runner-local files"
    );
    assert!(!sccache_tasks.contains("--build-arg SCCACHE_S3_ACCESS_KEY"));
    assert!(!sccache_tasks.contains("--build-arg SCCACHE_S3_SECRET_KEY"));
    assert!(
        platform_tasks.contains("s3api list-objects-v2 --bucket \"{{.SCCACHE_BUCKET}}\"")
            && platform_tasks.contains("--continuation-token \"$continuation_token\"")
            && platform_tasks.matches("--no-paginate").count() >= 2
            && platform_tasks.contains("Scanned $total_objects compiler-cache objects")
            && platform_tasks.contains("Total Objects: $total_objects")
            && !platform_tasks.contains("tail -n 2"),
        "sccache stats must paginate the full bucket and stream per-page progress"
    );

    let wrapper = read("nook-app/nook-platform/docker/sccache-wrapper.sh");
    assert!(wrapper.contains("/run/secrets/sccache_s3_access_key"));
    assert!(wrapper.contains("/run/secrets/sccache_s3_secret_key"));
    assert!(wrapper.contains("NOOK_SCCACHE_S3_MODE"));
    assert!(wrapper.contains("SCCACHE_S3_ENABLE_VIRTUAL_HOST_STYLE"));
    assert!(wrapper.contains("exec \"$@\""));
    assert!(wrapper.contains("exec /usr/local/bin/sccache \"$@\""));
    assert!(!wrapper.contains("REDIS"));

    let rust_base = read("nook-app/nook-platform/docker/rust/product.Dockerfile");
    assert!(rust_base.contains("RUSTC_WRAPPER=/usr/local/bin/nook-sccache"));
    assert!(rust_base.contains("NOOK_SCCACHE_S3_MODE=${SCCACHE_S3_MODE}"));
    assert!(rust_base.contains("SCCACHE_IGNORE_SERVER_IO_ERROR=1"));

    assert!(bake.contains("SCCACHE_S3_MODE") && bake.contains("= SCCACHE_S3_MODE"));
    assert!(app_tasks.contains("--set '*.args.SCCACHE_S3_MODE={{.SCCACHE_S3_MODE}}'"));

    let path = "nook-app/nook-platform/docker/rust/product.Dockerfile";
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
