use super::*;

#[test]
fn agent_prs_cannot_be_merged_automatically() -> anyhow::Result<()> {
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
    Ok(())
}

#[test]
fn ci_agent_docker_builds_are_not_hidden_by_image_existence() -> anyhow::Result<()> {
    let root = repository_root();
    let tasks = read(&root, ".task/agentic-ai.yml");
    let docker_build = section(
        &tasks,
        "  ci-agent:docker:build:\n",
        "  ci-agent:docker:run:\n",
    );

    assert!(docker_build.contains("agentic-ai/ci-agent/src/**/*"));
    assert!(docker_build.contains("{{.DOCKER}} build"));
    assert!(
        !docker_build.contains("status:"),
        "an existing image must not suppress rebuilds after ci-agent source changes"
    );
    Ok(())
}

#[test]
fn ui_demo_rebuilds_the_preview_with_test_only_debug_hooks() -> anyhow::Result<()> {
    let root = repository_root();
    let tasks = read(&root, "nook-app/nook-web/Taskfile.yml");
    let ui_demo = section(
        &tasks,
        "  _web:test:ui-demo:\n",
        "  _web:test:e2e:pr:parallel:\n",
    );

    assert!(ui_demo.contains("VITE_E2E_EXPOSE_VAULT: \"true\""));
    assert!(
        ui_demo.contains("VITE_VAULT_IDLE_TIMEOUT_MS: \"300000\""),
        "human-paced UI demos must not lock the vault during intentional pauses"
    );
    assert!(
        ui_demo.contains(
            "- task: _web:e2e:build-if-needed\n        vars:\n          E2E_VAULT_IDLE_TIMEOUT_MS: \"300000\"",
        ),
        "UI demos must rebuild the production-seeded dist with test-only browser hooks"
    );
    Ok(())
}

#[test]
fn local_https_material_lives_under_home_nook_across_worktrees() -> anyhow::Result<()> {
    let root = repository_root();
    let app_tasks = read(&root, "nook-app/Taskfile.yml");
    let web_tasks = read(&root, "nook-app/nook-web/Taskfile.yml");
    let docker_tasks = read(&root, "nook-app/nook-web/docker/Taskfile.yml");

    for required in [
        "${HOME}/.nook/https",
        "LOCAL_HTTPS_DIR",
        "LOCAL_HTTPS_CONTAINER_DIR",
        "/run/nook/https",
    ] {
        assert!(
            app_tasks.contains(required),
            "shared local HTTPS configuration is missing: {required}"
        );
    }
    for required in [
        "{{.LOCAL_HTTPS_DIR}}/localhost.pem",
        "{{.LOCAL_HTTPS_DIR}}/rootCA.pem",
        "legacy=\"{{.REPO_ROOT}}/.nook/https\"",
    ] {
        assert!(
            web_tasks.contains(required),
            "web HTTPS setup must use home-shared cert material: {required}"
        );
    }
    assert!(
        !web_tasks.contains("{{.REPO_ROOT}}/.nook/https/localhost.pem")
            && !web_tasks.contains("-v \"{{.REPO_ROOT}}/.nook/https:/certs\""),
        "local HTTPS must not generate or trust checkout-scoped certificate paths"
    );
    for required in [
        "-v \"{{.LOCAL_HTTPS_DIR}}:{{.LOCAL_HTTPS_CONTAINER_DIR}}:ro\"",
        "NOOK_LOCAL_HTTPS_CERT_PATH={{.LOCAL_HTTPS_CONTAINER_DIR}}/localhost.pem",
        "NOOK_LOCAL_HTTPS_KEY_PATH={{.LOCAL_HTTPS_CONTAINER_DIR}}/localhost-key.pem",
    ] {
        assert!(
            docker_tasks.contains(required),
            "web-dev containers must mount home-shared HTTPS material: {required}"
        );
    }
    assert!(
        !docker_tasks.contains("/meta-secret/nook/.nook/https/"),
        "web-dev containers must not read HTTPS material from the checkout mount"
    );
    Ok(())
}

#[test]
fn pr_audit_wrappers_accept_pat_only_authentication() -> anyhow::Result<()> {
    let root = repository_root();
    let tasks = read(&root, ".task/agentic-ai.yml");
    let token_fallback =
        r#"export GH_TOKEN="${NOOK_GITHUB_PAT:-${GITHUB_TOKEN:-${GH_TOKEN:-$(gh auth token)}}}";"#;

    assert_eq!(
        tasks.matches(token_fallback).count(),
        3,
        "preflight, readiness, and review wrappers must accept NOOK_GITHUB_PAT before consulting gh auth"
    );
    Ok(())
}
