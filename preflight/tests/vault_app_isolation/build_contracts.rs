use super::*;
const TRUSTED_DOCKER_PATHS: [&str; 3] = [
    "/usr/local/bin/docker",
    "/usr/bin/docker",
    "/opt/homebrew/bin/docker",
];
const TRUSTED_BUILDX_PATHS: [&str; 6] = [
    "/usr/local/lib/docker/cli-plugins/docker-buildx",
    "/usr/local/libexec/docker/cli-plugins/docker-buildx",
    "/usr/lib/docker/cli-plugins/docker-buildx",
    "/usr/libexec/docker/cli-plugins/docker-buildx",
    "/opt/homebrew/lib/docker/cli-plugins/docker-buildx",
    "/Applications/Docker.app/Contents/Resources/cli-plugins/docker-buildx",
];
fn docker_script_fixture(
    root: &Path,
    relative: &str,
    directory: &Path,
    fake_docker: &Path,
) -> anyhow::Result<PathBuf> {
    let fake = fake_docker.to_string_lossy();
    let mut source = (root).read(relative);
    for candidate in TRUSTED_DOCKER_PATHS {
        anyhow::ensure!(source.matches(candidate).count() == 2);
        source = source.replace(candidate, &fake);
    }
    for candidate in TRUSTED_BUILDX_PATHS {
        anyhow::ensure!(source.matches(candidate).count() == 2);
        source = source.replace(candidate, &fake);
    }
    anyhow::ensure!(source.matches(fake.as_ref()).count() == 18);
    let fixture = directory.join("wrapper.sh");
    fs::write(&fixture, source)?;
    Ok(fixture)
}

#[test]
fn focused_playwright_task_runs_only_matching_projects() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    let web_tasks = root.read("nook-app/nook-web/Taskfile.yml");
    let focused = section(
        &web_tasks,
        "  _web:test:e2e:file:",
        "  _web:test:e2e:pr:parallel:",
    );
    assert!(
        focused.contains("bun x playwright test ${E2E_SPEC}"),
        "focused e2e must invoke Playwright directly for the requested specs"
    );
    assert!(
        !focused.contains("bun run test:e2e --") && !focused.contains("--project=e2e"),
        "focused e2e must not expand into the full stable/unstable scripts or select a nonexistent project"
    );
    Ok(())
}

#[test]
fn extension_e2e_waits_for_a_persistent_x_server() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    let wrapper = root.read("nook-app/nook-web/nook-web-extension/scripts/run-with-xvfb.sh");
    for required in [
        "Xvfb -displayfd 3 -screen 0 1280x720x24 -noreset",
        "if [ -s \"$display_file\" ]",
        "kill -0 \"$xvfb_pid\"",
        "Xvfb exited while the browser suite was running",
    ] {
        assert!(
            wrapper.contains(required),
            "extension e2e Xvfb wrapper missing resilience contract: {required}"
        );
    }

    for script in ["test-e2e.sh", "test-hosted-smoke.sh"] {
        let contents = root.read(&format!(
            "nook-app/nook-web/nook-web-extension/scripts/{script}"
        ));
        assert!(
            contents.contains("bash scripts/run-with-xvfb.sh"),
            "{script} must use the readiness-checked Xvfb wrapper"
        );
    }

    let playwright = root.read("nook-app/nook-web/nook-web-extension/playwright.config.ts");
    assert!(
        playwright.contains("workers: availableParallelism()"),
        "hosted extension files must use the process's available CPU capacity"
    );
    Ok(())
}

#[test]
fn scheduled_nightly_live_sync_is_retired() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    assert!(
        !root.join(".github/workflows/e2e-nightly.yml").exists(),
        "live-provider sync checks must not have a scheduled workflow"
    );
    let manual_e2e = root.read(".github/workflows/e2e-pr.yml");
    assert!(
        manual_e2e.contains("- sync-live")
            && manual_e2e.contains("NOOK_E2E_SYNC_PROVIDER: github")
            && manual_e2e.contains("task _web:test:e2e:sync-live:parallel")
            && manual_e2e.contains("- name: Clean up live-sync test repository")
            && manual_e2e.contains("if: >-\n          always() &&")
            && manual_e2e.contains("github.rest.users.getAuthenticated()")
            && manual_e2e.contains("github.rest.repos.delete({ owner: user.login, repo })"),
        "manual PR e2e must retain explicit GitHub live-provider validation with cancellation-safe cleanup"
    );
    Ok(())
}
#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one recovery contract verifies every stuck BuildKit transition"
)]
fn stuck_pr_buildkit_probe_is_killed_and_replaced_within_its_deadline() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    let unique = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let temp = env::temp_dir().join(format!("nook-buildkit-health-{}-{unique}", process::id()));
    fs::create_dir_all(&temp)?;
    let fake_docker = temp.join("docker");
    let docker_log = temp.join("docker.log");
    let child_pid_file = temp.join("docker-child.pid");
    let command_marker = temp.join("command-ran");
    fs::write(
        &fake_docker,
        r#"#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
if [ "${1:-}" = context ] && [ "${2:-}" = show ]; then
  printf '%s\n' desktop-linux
  exit 0
fi
if [ "${1:-}" = buildx ] && [ "${2:-}" = inspect ]; then
  sleep 30 &
  child_pid=$!
  printf '%s\n' "$child_pid" > "$FAKE_DOCKER_CHILD_PID"
  wait "$child_pid"
fi
"#,
    )?;
    let mut permissions = fs::metadata(&fake_docker)?.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&fake_docker, permissions)?;
    for utility in ["ln", "mktemp"] {
        unix_fs::symlink(&fake_docker, temp.join(utility))?;
    }
    let wrapper = docker_script_fixture(
        &root,
        ".github/scripts/with-healthy-buildkit.sh",
        &temp,
        &fake_docker,
    )?;
    let started = Instant::now();
    let output = Command::new("bash")
        .arg(&wrapper)
        .args([
            "bash",
            "-c",
            "test -z \"${BUILDX_BUILDER+x}${DOCKER_HOST+x}${DOCKER_CONTEXT+x}${BUILDKIT_HOST+x}\" && printf ok > \"$1\"",
            "nook-test",
        ])
        .arg(&command_marker)
        .env("DOCKER_CONFIG", temp.join("docker-config"))
        .env("FAKE_DOCKER_LOG", &docker_log)
        .env("FAKE_DOCKER_CHILD_PID", &child_pid_file)
        .env("NOOK_PR_BUILDX_BUILDER", "nook-pr-timeout-test")
        .env("NOOK_BUILDKIT_HEALTH_TIMEOUT_SECONDS", "1")
        .env("NOOK_BUILDKIT_CLEANUP_TIMEOUT_SECONDS", "2")
        .env("GITHUB_ACTIONS", "true")
        .env("BUILDX_BUILDER", "poisoned-builder")
        .env("DOCKER_HOST", "tcp://attacker.invalid:2375")
        .env("DOCKER_CONTEXT", "attacker")
        .env("BUILDKIT_HOST", "tcp://attacker.invalid:1234")
        .env("PATH", format!("{}:{}", temp.display(), env::var("PATH")?))
        .output()?;
    let elapsed = started.elapsed();
    assert!(
        output.status.success(),
        "wrapper failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        elapsed < Duration::from_secs(12),
        "one-second probe timeout took {elapsed:?}"
    );
    assert_eq!(fs::read_to_string(&command_marker)?, "ok");
    let child_pid = fs::read_to_string(&child_pid_file)?;
    let check = Command::new("bash")
        .args([
            "-c",
            r#"kill -0 "$1" 2>/dev/null || exit 1; state="$(ps -o stat= -p "$1")" || exit 2
case "$state" in Z*|X*) exit 1;; *) exit 0;; esac"#,
            "nook-process-check",
            child_pid.trim(),
        ])
        .status()?;
    match check.code() {
        Some(1) => {}
        Some(0) => panic!("timed Docker child {child_pid:?} survived process-group cleanup"),
        status => panic!("process inspection failed with status {status:?}"),
    }
    let calls = fs::read_to_string(&docker_log)?;
    assert!(
        !calls
            .lines()
            .any(|call| call.starts_with("-d ") || call.starts_with("-s "))
    );
    for required in [
        "buildx inspect nook-pr-timeout-test --bootstrap",
        "rm --force buildx_buildkit_nook-pr-timeout-test0",
        "buildx rm --force nook-pr-timeout-test",
        "volume rm --force buildx_buildkit_nook-pr-timeout-test0_state",
        "buildx create --name nook-pr-timeout-test --driver docker-container --driver-opt image=registry.dev.nokey.sh/moby/buildkit:buildx-stable-1 --bootstrap",
        "buildx use nook-pr-timeout-test",
    ] {
        assert!(
            calls.contains(required),
            "missing recovery call: {required}"
        );
    }
    let malicious_config = temp.join("malicious-docker-config");
    fs::create_dir_all(&malicious_config)?;
    fs::write(
        malicious_config.join("config.json"),
        "{\n\"\\u0063LIPLUGINSEXTRADIRS\"\n:\n[\"/tmp/untrusted\"],\n\"CrEdSsToRe\":\"untrusted\",\n\"CrEdHeLpErS\":{\"registry.dev.nokey.sh\":\"untrusted\"},\n\"PrOxIeS\":{\"default\":{\"httpsProxy\":\"https://proxy.invalid\"}},\n\"auths\":{}\n}",
    )?;
    let sanitized_plugin = Command::new("bash")
        .arg(&wrapper)
        .args([
            "bash",
            "-c",
            "grep -Fq '\"auths\": {}' \"$DOCKER_CONFIG/config.json\" && ! grep -Eqi 'currentcontext|clipluginsextradirs|u0063lipluginsextradirs|credsstore|credhelpers|proxies|proxy.invalid|untrusted' \"$DOCKER_CONFIG/config.json\"",
        ])
        .env("DOCKER_CONFIG", &malicious_config)
        .env("FAKE_DOCKER_LOG", &docker_log)
        .env("GITHUB_ACTIONS", "true")
        .output()?;
    assert!(
        sanitized_plugin.status.success(),
        "structural Docker config sanitizer failed: {}",
        String::from_utf8_lossy(&sanitized_plugin.stderr)
    );
    fs::write(
        malicious_config.join("config.json"),
        "{\"cliPluginsExtraDir\\u017f\":[\"/tmp/untrusted\"]}",
    )?;
    let unicode_folded = Command::new("bash")
        .arg(&wrapper)
        .arg("true")
        .env("DOCKER_CONFIG", &malicious_config)
        .env("GITHUB_ACTIONS", "true")
        .output()?;
    assert!(!unicode_folded.status.success());
    assert!(
        String::from_utf8_lossy(&unicode_folded.stderr).contains("non-ASCII Docker config key")
    );
    fs::remove_file(malicious_config.join("config.json"))?;
    unix_fs::symlink("/", malicious_config.join("contexts"))?;
    let linked_contexts = Command::new("bash")
        .arg(&wrapper)
        .arg("true")
        .env("DOCKER_CONFIG", &malicious_config)
        .output()?;
    assert!(!linked_contexts.status.success());
    assert!(String::from_utf8_lossy(&linked_contexts.stderr).contains("must not contain symlinks"));
    fs::remove_dir_all(temp)?;
    Ok(())
}
#[test]
fn local_delivery_uses_daemon_buildkit_instead_of_a_shared_container() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    let unique = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let temp = env::temp_dir().join(format!("nook-buildkit-daemon-{}-{unique}", process::id()));
    fs::create_dir_all(&temp)?;
    let fake_docker = temp.join("docker");
    let docker_log = temp.join("docker.log");
    let command_marker = temp.join("command-ran");
    fs::write(&docker_log, "")?;
    fs::write(
        &fake_docker,
        r#"#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
"#,
    )?;
    let mut permissions = fs::metadata(&fake_docker)?.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&fake_docker, permissions)?;
    let wrapper = docker_script_fixture(
        &root,
        ".github/scripts/with-healthy-buildkit.sh",
        &temp,
        &fake_docker,
    )?;
    let output = Command::new("bash")
        .arg(&wrapper)
        .args([
            "bash",
            "-c",
            "test -z \"${BUILDX_BUILDER+x}\" && printf ok > \"$1\"",
            "nook-test",
        ])
        .arg(&command_marker)
        .env("DOCKER_CONFIG", temp.join("docker-config"))
        .env("FAKE_DOCKER_LOG", &docker_log)
        .env_remove("NOOK_PR_BUILDX_BUILDER")
        .env("BUILDX_BUILDER", "poisoned-builder")
        .output()?;
    assert!(
        output.status.success(),
        "wrapper failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(fs::read_to_string(&command_marker)?, "ok");
    let calls = fs::read_to_string(&docker_log)?;
    assert!(
        !calls.contains("buildx create")
            && !calls.contains("buildx inspect")
            && !calls.contains("buildx use"),
        "local delivery must not create, probe, or switch a docker-container BuildKit"
    );
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("Using default docker buildx builder"),
        "local delivery must advertise the default builder path"
    );
    let refused = Command::new("bash")
        .arg(wrapper)
        .args(["true"])
        .env("DOCKER_CONFIG", temp.join("docker-config"))
        .env("NOOK_PR_BUILDX_BUILDER", "nook-pr")
        .output()?;
    assert!(
        !refused.status.success(),
        "shared nook-pr builder must be refused"
    );
    assert!(
        String::from_utf8_lossy(&refused.stderr).contains("refusing shared BuildKit builder name"),
        "refusal must name the shared builder hazard"
    );
    fs::remove_dir_all(temp)?;
    Ok(())
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one ARC contract verifies the complete remote client boundary"
)]
fn arc_delivery_uses_only_remote_buildkit_client_operations() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    let unique = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let temp = env::temp_dir().join(format!(
        "nook-remote-buildkit-health-{}-{unique}",
        process::id()
    ));
    fs::create_dir_all(&temp)?;

    let fake_docker = temp.join("docker");
    let docker_log = temp.join("docker.log");
    let command_marker = temp.join("command-ran");
    fs::write(
        &fake_docker,
        r#"#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
if [ "${FAIL_REMOTE_PROBE:-}" = 1 ] && [ "${1:-}" = buildx ] && [ "${2:-}" = inspect ]; then
  exit 19
fi
printf '%s\n' 'org.mobyproject.buildkit.worker.hostname: nook-buildkit-0'
"#,
    )?;
    let mut permissions = fs::metadata(&fake_docker)?.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&fake_docker, permissions)?;

    let wrapper = docker_script_fixture(
        &root,
        ".github/scripts/with-remote-buildkit.sh",
        &temp,
        &fake_docker,
    )?;
    let output = Command::new("bash")
        .arg(&wrapper)
        .args([
            "bash",
            "-c",
            "grep -Fq '\"Driver\":\"remote\"' \"$BUILDX_CONFIG/instances/nook-arc-run-1\" && grep -Fq '\"Endpoint\":\"tcp://nook-buildkit.arc-runners.svc.cluster.local:1234\"' \"$BUILDX_CONFIG/instances/nook-arc-run-1\" && printf ok > \"$1\"",
            "nook-test",
        ])
        .arg(&command_marker)
        .env("DOCKER_CONFIG", temp.join("docker-config"))
        .env("FAKE_DOCKER_LOG", &docker_log)
        .env("NOOK_PR_BUILDX_BUILDER", "nook-arc-run-1")
        .env(
            "NOOK_BUILDKIT_ADDR",
            "tcp://nook-buildkit.arc-runners.svc.cluster.local:1234",
        )
        .output()?;
    assert!(
        output.status.success(),
        "remote wrapper failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(fs::read_to_string(&command_marker)?, "ok");
    let calls = fs::read_to_string(&docker_log)?;
    for required in [
        "buildx inspect nook-arc-run-1 --bootstrap",
        "buildx build --builder nook-arc-run-1",
        "buildx use nook-arc-run-1",
    ] {
        assert!(
            calls.contains(required),
            "missing remote client call: {required}"
        );
    }
    for forbidden in [
        "buildx create",
        "buildx rm",
        "rm --force",
        "volume rm",
        "--driver docker-container",
    ] {
        assert!(
            !calls.contains(forbidden),
            "ARC remote wrapper attempted daemon recovery: {forbidden}"
        );
    }

    fs::write(&docker_log, "")?;
    fs::remove_file(&command_marker)?;
    let failed = Command::new("bash")
        .arg(&wrapper)
        .args(["bash", "-c", "printf bad > \"$1\"", "nook-test"])
        .arg(&command_marker)
        .env("DOCKER_CONFIG", temp.join("docker-config"))
        .env("FAKE_DOCKER_LOG", &docker_log)
        .env("FAIL_REMOTE_PROBE", "1")
        .env("NOOK_BUILDKIT_BACKEND", "home-worker-0")
        .env("NOOK_PR_BUILDX_BUILDER", "nook-arc-run-2")
        .env(
            "NOOK_BUILDKIT_ADDR",
            "tcp://nook-buildkit-home-worker-0.arc-runners.svc.cluster.local:1234",
        )
        .output()?;
    assert_eq!(failed.status.code(), Some(19));
    assert!(!command_marker.exists());
    let failed_calls = fs::read_to_string(&docker_log)?;
    assert!(failed_calls.contains("buildx inspect nook-arc-run-2 --bootstrap"));
    assert!(!failed_calls.contains("buildx create"));
    assert!(!failed_calls.contains("buildx rm"));
    assert!(
        String::from_utf8_lossy(&failed.stderr)
            .contains("refusing hosted or local daemon recovery from an ARC Pod")
    );

    fs::remove_dir_all(temp)?;
    Ok(())
}

#[test]
fn rust_dependency_updates_report_outdated_direct_dependencies() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    let workflow = root.read(".github/workflows/rust-dependency-updates.yml");
    for required in [
        "- cron: \"0 9 * * 1\"",
        "task rust:deps:outdated",
        "uses: actions/upload-artifact@v4",
        "name: rust-deps-outdated",
    ] {
        assert!(
            workflow.contains(required),
            "dependency audit workflow missing: {required}"
        );
    }
    assert!(!workflow.contains("CURSOR_API_KEY") && !workflow.contains("contents: write"));
    assert!(
        root.read(".github/docker/rust-maintenance.Dockerfile")
            .contains("cargo install cargo-outdated --version 0.19.0 --locked")
    );
    assert!(
        root.read(".github/docker/rust-maintenance.hcl")
            .contains("no-cache-filter = [\"audit\"]")
    );
    let audit_script = root.read(".github/scripts/ci-rust-deps-outdated.sh");
    for required in [
        "cargo outdated --workspace --root-deps-only --exit-code 1",
        "check_manifest nook-app/nook-platform",
        "check_manifest nook-app/nook-platform/fuzz",
        "check_manifest preflight",
    ] {
        assert!(
            audit_script.contains(required),
            "dependency update audit script missing required contract: {required}"
        );
    }
    Ok(())
}
