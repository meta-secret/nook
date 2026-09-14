use super::*;

#[test]
fn local_native_verification_exports_preflight_into_the_repository_artifact_root() {
    let root = RepositoryFixture::repository_root();
    let tasks = root.read("nook-app/ci/Taskfile.yml");
    let rust_host = taskfile_task_body(&tasks, "_ci:pr:rust:host")
        .expect("native Rust CI must retain a host orchestration task");

    assert!(
        rust_host.contains(
            "CI_ARTIFACT_DIR: '{{default (printf \"%s/ci-artifacts/rust\" .REPO_ROOT) .CI_ARTIFACT_DIR}}'"
        ) && rust_host.contains("PREFLIGHT_OUTPUT_DIR: '{{.CI_ARTIFACT_DIR}}/tools'"),
        "local native verification must default the shared coverage and preflight export root to a writable repository-local directory"
    );
}

#[test]
fn local_web_verification_assembles_the_ci_wasm_handoff_with_bounded_offline_inputs() {
    let root = RepositoryFixture::repository_root();
    let tasks = root.read("nook-app/ci/Taskfile.yml");
    let web = taskfile_task_body(&tasks, "ci:pr:web").expect("ci:pr:web must remain a public task");
    let local = taskfile_task_body(&tasks, "ci:pr:web:local")
        .expect("ci:pr:web must expose a local verification route");
    let script = root.read(".github/scripts/ci-pr-web-local.sh");

    assert!(
        web.contains("GITHUB_ACTIONS")
            && web.contains("CI_ARTIFACT_DIR")
            && web.contains("ci:pr:web:local")
            && web.contains("with-remote-buildkit.sh")
            && web.contains("with-healthy-buildkit.sh")
            && web.contains("_ci:pr:web:host")
            && !web.contains("task --dir \"{{.REPO_ROOT}}\" _buildx:healthy")
            && web.contains("VITE_SITE_URL: '{{.VITE_SITE_URL}}'")
            && web.contains("NOOK_EXTENSION_COMMIT: '{{.NOOK_EXTENSION_COMMIT}}'"),
        "the public web route must select local assembly only when hosted CI has no handoff"
    );
    assert!(
        local.contains("ci-pr-web-local.sh"),
        "the local route must use one repository-owned orchestration script"
    );
    for required in [
        "ci:pr:wasm",
        "docker:ci:web:build",
        "with-healthy-buildkit.sh",
        "CI_ARTIFACT_DIR",
        "CI=1",
        "GITHUB_ACTIONS=",
        "NOOK_ARC_RUNNER=",
        "source_sha",
        "GIT_COMMIT_ID=\"$source_sha\"",
        "NOOK_EXTENSION_COMMIT=\"$source_sha\"",
        "NOOK_REGISTRY_CACHE=0",
        "SCCACHE_OPTIONAL=1",
        "NOOK_BUILDKIT_REMOTE=0",
        "NOOK_LOCAL_CI_TIMEOUT_SECONDS",
        "between 60 and 3600",
        "stage_command",
        "command_pid",
        "kill -TERM",
        "kill -KILL",
        "nook_wasm.js",
        "nook_wasm_bg.wasm",
        "nook_companion_wasm.js",
        "nook_companion_wasm_bg.wasm",
    ] {
        assert!(
            script.contains(required),
            "local web verification is missing bounded offline contract: {required}"
        );
    }
}

#[test]
fn hive_build_keeps_non_secret_sccache_prefix_out_of_docker_env_scanning() {
    let root = RepositoryFixture::repository_root();
    let dockerfile = root.read("agentic-ai/minds/hive/Dockerfile");
    let wrapper = root.read("nook-app/nook-platform/docker/sccache-wrapper.sh");

    assert!(
        !dockerfile.contains("ENV SCCACHE_S3_KEY_PREFIX"),
        "the non-secret cache namespace must not use a secret-shaped Docker ENV"
    );
    assert!(
        dockerfile.contains("ARG NOOK_BUILD_CACHE_NAMESPACE=nook-hive")
            && dockerfile.contains("ENV NOOK_BUILD_CACHE_NAMESPACE=${NOOK_BUILD_CACHE_NAMESPACE}"),
        "Hive build stages must retain their fixed cache namespace through a neutral ENV"
    );
    assert!(
        wrapper.contains("SCCACHE_S3_KEY_PREFIX=\"$NOOK_BUILD_CACHE_NAMESPACE\"")
            && wrapper.contains("export SCCACHE_S3_KEY_PREFIX"),
        "the shared sccache wrapper must apply the namespace to every compiler invocation"
    );
    assert!(
        dockerfile.contains("RUSTC_WRAPPER=/usr/local/bin/nook-sccache")
            && dockerfile.contains("ENTRYPOINT [\"/usr/local/bin/hive\"]"),
        "Hive compiler stages must use the shared wrapper and keep the normal runtime entrypoint"
    );
    assert!(
        dockerfile.contains("cargo llvm-cov show-env --sh")
            && !dockerfile.contains("cargo llvm-cov show-env --export-prefix"),
        "Hive must use cargo-llvm-cov's current shell export alias"
    );
}
