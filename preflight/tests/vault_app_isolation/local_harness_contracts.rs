use super::*;

#[test]
fn local_native_verification_exports_preflight_into_the_repository_artifact_root()
-> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    let tasks = root.read("nook-app/ci/Taskfile.yml");
    let rust_host = taskfile_task_body(&tasks, "_ci:pr:rust:host")?;

    assert!(
        rust_host.contains(
            "CI_ARTIFACT_DIR: '{{default (printf \"%s/ci-artifacts/rust\" .REPO_ROOT) .CI_ARTIFACT_DIR}}'"
        ) && rust_host.contains("PREFLIGHT_OUTPUT_DIR: '{{.CI_ARTIFACT_DIR}}/tools'"),
        "local native verification must default the shared coverage and preflight export root to a writable repository-local directory"
    );
    Ok(())
}

#[test]
fn local_web_verification_assembles_the_ci_wasm_handoff_with_bounded_offline_inputs()
-> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    let tasks = root.read("nook-app/ci/Taskfile.yml");
    let web = taskfile_task_body(&tasks, "ci:pr:web")?;
    let local = taskfile_task_body(&tasks, "ci:pr:web:local")?;
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
    assert!(
        script.contains("$stage_command_label exceeded ${timeout_seconds}s; terminating")
            && !script.contains("$label exceeded ${timeout_seconds}s; terminating"),
        "timeout cleanup must use the initialized stage label before terminating the exact stage process group"
    );
    Ok(())
}
