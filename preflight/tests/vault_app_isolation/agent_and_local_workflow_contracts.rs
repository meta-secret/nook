use super::*;

#[test]
#[expect(
    clippy::unnecessary_wraps,
    reason = "integration contracts share a fallible test signature"
)]
fn ui_demo_rebuilds_the_preview_with_test_only_debug_hooks() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    let tasks = root.read("nook-app/nook-web/Taskfile.yml");
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
#[expect(
    clippy::unnecessary_wraps,
    reason = "integration contracts share a fallible test signature"
)]
fn local_https_material_lives_under_home_nook_across_worktrees() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    let app_tasks = root.read("nook-app/Taskfile.yml");
    let web_tasks = root.read("nook-app/nook-web/Taskfile.yml");
    let docker_tasks = root.read("nook-app/nook-web/docker/Taskfile.yml");

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
#[expect(
    clippy::unnecessary_wraps,
    reason = "integration contracts share a fallible test signature"
)]
fn local_https_generator_keeps_docker_arguments_in_one_shell_command() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    let web_tasks = root.read("nook-app/nook-web/Taskfile.yml");
    let https_generate = section(&web_tasks, "  web:https:generate:\n", "  _web:install:\n");

    for marker in [
        "{{.DOCKER}} build",
        "--file \"{{.REPO_ROOT}}/nook-app/nook-web/docker/mkcert.Dockerfile\"",
        "--tag \"{{.DOCKER_MKCERT_IMAGE}}\"",
        "{{.DOCKER}} run --rm",
        "-e CAROOT=/certs",
        "-v \"$https_dir:/certs\"",
        "\"{{.DOCKER_MKCERT_IMAGE}}\"",
        "-cert-file /certs/localhost.pem",
        "-key-file /certs/localhost-key.pem",
    ] {
        let line = https_generate
            .lines()
            .find(|line| line.contains(marker))
            .unwrap_or_else(|| panic!("HTTPS generator is missing Docker argument {marker}"));
        assert!(
            line.trim_end().ends_with('\\'),
            "Docker argument {marker} must escape the YAML shell-block newline"
        );
    }
    assert!(
        https_generate
            .lines()
            .any(|line| line.trim() == "\"{{.REPO_ROOT}}\";"),
        "Docker build must retain the repository context argument"
    );
    assert!(
        https_generate
            .lines()
            .any(|line| line.trim() == "localhost 127.0.0.1 ::1;"),
        "mkcert container must retain its certificate host arguments"
    );
    Ok(())
}
