use super::*;
use anyhow::Context;

#[path = "hosted_delivery_contracts/workflow_runtime_contract.rs"]
mod workflow_runtime_contract;
use workflow_runtime_contract::WorkflowRuntimeContract;

#[test]
fn delivery_ci_uses_configured_runners_with_scoped_buildkit_caches() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    WorkflowRuntimeContract {
        root: root.as_ref(),
    }
    .assert_contract();
    assert_docker_setup_contract(&root);
    assert_pr_workflow_contract(&root)?;
    assert_artifact_backed_e2e_contract(&root)?;
    assert_release_and_main_delivery_contract(&root)?;
    Ok(())
}

#[test]
fn repository_delivery_policy_executes_only_the_trusted_default_branch_verifier() {
    let root = RepositoryFixture::repository_root();
    let workflow = root.read(".github/workflows/repository-delivery-policy.yml");
    let checkout = section(
        &workflow,
        "      - name: Checkout policy verifier\n",
        "      - name: Require policy inspection credential\n",
    );

    assert!(
        workflow.contains(
            "if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
        ),
        "manual policy verification must reject dispatches outside the trusted default branch"
    );
    assert!(
        checkout.contains("ref: ${{ github.event.repository.default_branch }}")
            && checkout.contains("persist-credentials: false"),
        "manual policy verification must check out verifier code from the trusted default branch"
    );
    assert!(
        !checkout.contains("NOOK_GITHUB_PAT") && !checkout.contains("token:"),
        "the admin-capable policy credential must not be exposed to checkout"
    );
    assert_eq!(
        workflow
            .matches("GH_TOKEN: ${{ secrets.NOOK_GITHUB_PAT }}")
            .count(),
        2,
        "the policy credential must be scoped only to the credential check and trusted verifier"
    );
    assert!(
        !workflow.contains("ref: ${{ github.ref }}")
            && !workflow.contains("ref: ${{ inputs.")
            && workflow.contains("run: bash .github/scripts/verify-github-delivery-policy.sh"),
        "a dispatched ref must not select executable verifier code, while trusted manual verification remains available"
    );
}

fn assert_docker_setup_contract(root: &Path) {
    let setup = (root).read(".github/actions/nook-docker-setup/action.yml");
    let pr = (root).read(".github/workflows/pr.yml");
    let arc_values = (root).read("infra/k0s/manifests/arc/runner-scale-set-values.yaml");
    let container_values =
        (root).read("infra/k0s/manifests/arc/container-runner-scale-set-values.yaml");
    let container_hook = (root).read("infra/k0s/manifests/arc/container-hook.yaml");
    for required in [
        "docker/setup-buildx-action@v4",
        "Preload hosted BuildKit from Zot",
        "docker pull \"${{ inputs.registry-host }}/moby/buildkit:buildx-stable-1\"",
        "driver-opts: image=${{ inputs.registry-host }}/moby/buildkit:buildx-stable-1",
        "--password-stdin",
        "registry-username",
        "registry-password",
        "registry.dev.nokey.sh",
        "id: hosted-buildx",
        "id: arc-buildx",
        "NOOK_SELECTED_BUILDER: ${{ steps.arc-buildx.outputs.name || steps.hosted-buildx.outputs.name }}",
        "echo \"NOOK_PR_BUILDX_BUILDER=$NOOK_SELECTED_BUILDER\"",
        "GHA_CACHE_ENABLED=1",
        "NOOK_REGISTRY_CACHE_HOST=${{ inputs.registry-host }}",
        "cache_write_enabled=1",
        "ARC skips general exact-SHA registry export; Main and sccache remain reusable",
        "${NOOK_ARC_RUNNER:-}",
        "GHA_CACHE_WRITE_ENABLED=$cache_write_enabled",
        "event_name=\"${{ github.event_name }}\"",
        "git_ref=\"${{ github.ref }}\"",
        "[ \"$event_name\" != \"push\" ] || [ \"$git_ref\" != \"refs/heads/main\" ]",
        "main-cache-only",
        "main-cache-only requires cache-write=false",
        "Connect ARC Buildx to the node-local BuildKit shard",
        "--driver remote",
        "tcp://nook-buildkit.arc-runners.svc.cluster.local:1234",
    ] {
        assert!(
            setup.contains(required),
            "GitHub-hosted Docker setup is missing: {required}"
        );
    }
    assert!(
        container_values.contains("name: ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER")
            && container_values.contains("value: \"true\"")
            && container_hook.contains("automountServiceAccountToken: false"),
        "container ARC must require declared job containers and withhold Kubernetes credentials from job Pods"
    );
    assert!(pr.contains("cache-write: \"false\""));
    assert!(pr.contains("GHA_CACHE_ENABLED="));
    assert!(pr.contains("GHA_CACHE_WRITE_ENABLED="));
    assert!(!pr.contains("PR_NATIVE_BUILD_OUTPUT"));
    assert!(container_hook.contains("name: install-docker-client"));
    assert!(container_hook.contains("name: NOOK_BUILDKIT_ADDR"));
    assert!(
        !setup.contains("crazy-max/ghaction-github-runtime")
            && !setup.contains("systemctl restart docker")
            && !setup.contains("/etc/docker/daemon.json"),
        "delivery setup must login to registry.dev.nokey.sh and must not reconfigure or restart Docker"
    );
    for required in [
        "automountServiceAccountToken: false",
        "name: install-docker-client",
        "registry.dev.nokey.sh/library/docker:29.2.1-cli@sha256:",
        "name: NOOK_BUILDKIT_REMOTE",
        "name: NOOK_BUILDKIT_ADDR",
        "value: tcp://nook-buildkit.arc-runners.svc.cluster.local:1234",
        "sizeLimit: 32Gi",
    ] {
        assert!(
            arc_values.contains(required),
            "general ARC runtime contract is missing: {required}"
        );
    }
    for prohibited in [
        "docker:dind",
        "dockerd",
        "docker.sock",
        "containerd.sock",
        "sysbox",
        "podman",
        "runtimeClassName:",
        "privileged: true",
        "hostPath:",
    ] {
        assert!(
            !arc_values.contains(prohibited),
            "general ARC runtime must not expose prohibited engine boundary: {prohibited}"
        );
    }
}

fn assert_pr_workflow_contract(root: &Path) -> anyhow::Result<()> {
    let pr = root.read(".github/workflows/pr.yml");
    let mut previous = 0;
    for phase in [
        "run: task ci:pr:verification\n",
        "run: task ci:pr:tests\n",
        "run: task ci:pr:heavy\n",
        "run: task ci:pr:browser:full\n",
        "uses: ./.github/actions/nook-pr-preview",
    ] {
        let position = pr
            .find(phase)
            .with_context(|| format!("missing PR phase: {phase}"))?;
        assert!(
            position > previous,
            "verification, tests, heavy work and preview must be ordered"
        );
        previous = position;
    }
    assert_eq!(pr.matches("    runs-on:").count(), 1);
    assert!(!pr.contains("    needs:"));
    assert!(!pr.contains("continue-on-error:"));
    assert!(!pr.contains("type=registry"));
    assert!(pr.contains("task ci:pr:browser:auth"));
    assert!(pr.contains("steps.browser-scope.outputs.auth == 'true'"));
    assert!(pr.contains("task web:research:verify"));
    assert!(pr.contains("uses: ./.github/actions/nook-pr-coverage"));
    assert!(pr.contains("require-sccache: \"true\""));
    assert!(pr.contains("run: node .github/workflows/lib/pr-cache-health.mjs"));
    assert!(pr.contains("NOOK_PR_CACHE_TELEMETRY_DIR:"));
    let coverage = root.read(".github/actions/nook-pr-coverage/action.yml");
    assert!(coverage.contains("coverage/current/tools/nook-preflight"));
    assert!(coverage.contains("base-coverage-artifact.cjs"));
    assert_preflight_reporter_contract(root);
    Ok(())
}

fn assert_preflight_reporter_contract(root: &Path) {
    let ci_tasks = (root).read("nook-app/ci/Taskfile.yml");
    assert!(
        ci_tasks.contains("PREFLIGHT_OUTPUT_DIR: '{{.CI_ARTIFACT_DIR}}/tools'"),
        "native PR CI must export the preflight reporter with its coverage artifact"
    );
    let preflight_dockerfile = (root).read("preflight/Dockerfile");
    for required in [
        "FROM rust-base AS chef",
        "FROM rust-base AS deps",
        "FROM deps AS coverage-deps",
        "FROM deps AS build",
        "cargo chef prepare --recipe-path recipe.json",
        "cargo chef cook --recipe-path recipe.json",
        "cargo chef cook --clippy --recipe-path recipe.json",
        "--mount=type=secret,id=sccache_s3_access_key,required=false",
        "nook-sccache-report preflight-chef",
        "nook-sccache-report preflight-build",
        "FROM scratch AS cli-export",
        "target/debug/nook-preflight /nook-preflight",
    ] {
        assert!(
            preflight_dockerfile.contains(required),
            "preflight Docker cache topology is missing: {required}"
        );
    }
    let recipe_normalizer = preflight_dockerfile
        .split_once("RUN <<'EOF'\n")
        .and_then(|(_, body)| body.split_once("\nEOF\n"))
        .map_or("", |(body, _)| body);
    assert!(
        recipe_normalizer.contains("cargo chef prepare --recipe-path recipe.json")
            && recipe_normalizer.contains(".skeleton.manifests")
            && preflight_dockerfile.contains("recipe.normalized.json"),
        "cargo-chef recipe normalization must remain inside one valid Docker heredoc RUN"
    );
    assert!(
        !preflight_dockerfile.contains("FROM rust:")
            && !preflight_dockerfile.contains("FROM rust@"),
        "preflight must reuse rust-base instead of installing a floating Rust tag"
    );
    let preflight_bake = (root).read("preflight/docker-bake.hcl");
    for required in [
        "target \"preflight-test\"",
        "target \"preflight-cli-export\"",
        "rust-base = \"target:rust-base\"",
        "inherits   = [\"_sccache\"]",
        "dockerfile = \"preflight/Dockerfile\"",
    ] {
        assert!(
            preflight_bake.contains(required),
            "preflight Bake wiring is missing: {required}"
        );
    }
    let preflight_tasks = (root).read("preflight/Taskfile.yml");
    for required in [
        "preflight:export:",
        "preflight-cli-export",
        "preflight-test",
        "PREFLIGHT_BAKE_FILES",
        "preflight/docker-bake.hcl",
        "nook-app/nook-platform/docker/rust/docker-bake.hcl",
        "SCCACHE_S3_BUILD_SECRETS",
        "deps:\n      - sccache:ensure",
        "PREFLIGHT_OUTPUT_PARENT:",
        "dirname \"{{.PREFLIGHT_OUTPUT_DIR}}\"",
        "--allow=\"fs.write={{.PREFLIGHT_OUTPUT_PARENT}}\"",
        "--allow=\"fs.write={{.PREFLIGHT_OUTPUT_DIR}}\"",
        "mkdir -p '{{.PREFLIGHT_OUTPUT_DIR}}'",
    ] {
        assert!(
            preflight_tasks.contains(required),
            "preflight Taskfile Bake/sccache wiring is missing: {required}"
        );
    }
    assert!(
        !preflight_tasks.contains("cache-to=\"") && !preflight_tasks.contains("cache-from=\""),
        "preflight Tasks must not clear Bake cache-to/cache-from; rust-base context has no cache-to"
    );
}

fn assert_artifact_backed_e2e_contract(root: &Path) -> anyhow::Result<()> {
    let pr = (root).read(".github/workflows/pr.yml");
    let ci_tasks = (root).read("nook-app/ci/Taskfile.yml");
    let rust_host = section(&ci_tasks, "  _ci:pr:rust:host:\n", "  ci:pr:wasm:\n");
    let preflight = rust_host
        .find("task: preflight")
        .context("native Rust CI must run preflight")?;
    let rust_export = rust_host
        .find("task: docker:ci:rust:export")
        .context("native Rust CI must export its artifacts")?;
    assert!(
        preflight < rust_export && rust_host.contains("cmds:") && !rust_host.contains("deps:"),
        "repository preflight must finish before the native app Docker solve begins"
    );
    let artifact_e2e = section(
        &ci_tasks,
        "  ci:pr:e2e:web:artifacts:\n",
        "  ci:pr:e2e:local:\n",
    );
    assert!(
        artifact_e2e.contains("task: docker:ci:web:e2e:build")
            && artifact_e2e.contains("vars: { TASK: _ci:main:web:e2e-only }")
            && artifact_e2e.contains("vars: { TASK: _extension:test:e2e }")
            && !artifact_e2e.contains("task: setup")
            && !artifact_e2e.contains("task: preflight"),
        "artifact-backed web and extension e2e must build only their browser images"
    );
    let e2e_only = section(
        &ci_tasks,
        "  _ci:main:web:e2e-only:\n",
        "  _ci:pr:prepare:\n",
    );
    assert!(
        e2e_only.contains("_web:test:e2e:parallel")
            && e2e_only.contains("_web:test:e2e:isolation")
            && !e2e_only.contains("internal: true")
            && !e2e_only.contains("_extension:test:e2e")
            && !e2e_only.contains("_ci:main:build"),
        "artifact-backed web e2e must not repeat verification or compete with extension e2e"
    );
    assert!(pr.contains("task ci:pr:browser:prepare"));
    assert!(pr.contains("uses: ./.github/actions/nook-pr-coverage"));
    assert!(!pr.contains("actions/download-artifact"));
    let deploy = root.read(".github/actions/nook-pr-preview/action.yml");
    assert!(deploy.contains("bash .github/scripts/ci-pr-deploy-and-verify-previews.sh"));
    assert!(deploy.contains("NOOK_HOST_PAGES_DEPLOY: \"1\""));
    let deploy_script = (root).read(".github/scripts/ci-pr-deploy-and-verify-previews.sh");
    assert!(
        deploy_script.contains("deploy_pages()")
            && deploy_script.contains("NOOK_HOST_PAGES_DEPLOY")
            && deploy_script.contains("npx --yes \"wrangler@${NOOK_WRANGLER_VERSION}\" --version",)
            && deploy_script.contains("ci-pr-host-pages-deploy.sh")
            && deploy_script.contains(">\"$log\" 2>&1 &")
            && deploy_script.contains("unified_pid=$!")
            && deploy_script.contains("site_pid=$!")
            && deploy_script.contains("simple_pid=$!")
            && deploy_script.contains("sentinel_pid=$!")
            && deploy_script.contains("\"$deploy_dir/unified.log\"")
            && deploy_script.contains("wait_for_deploy"),
        "independent Cloudflare preview uploads must prewarm pinned Wrangler, run concurrently, and all succeed before alias verification"
    );
    let host_deploy = (root).read(".github/scripts/ci-pr-host-pages-deploy.sh");
    assert!(
        host_deploy.contains("npx --yes \"wrangler@${wrangler_version}\"")
            && host_deploy.contains("NOOK_WRANGLER_VERSION:-4.114.0")
            && host_deploy.contains("pages deploy"),
        "host Pages deploy must pin wrangler and deploy from the extracted dist tree"
    );
    assert!(
        ci_tasks.contains("node \"{{.WEB_ROOT}}/node_modules/.bin/wrangler\"")
            && !ci_tasks.contains("bun add wrangler"),
        "preview deploys must use the dependency-locked Wrangler binary instead of installing it at runtime"
    );
    let e2e_pr = (root).read(".github/workflows/e2e-pr.yml");
    assert!(
        e2e_pr.contains("cache-write: \"false\"")
            && e2e_pr.contains(
                "pr.head.repo.full_name !== `${context.repo.owner}/${context.repo.repo}`"
            )
            && e2e_pr.contains("pr.user.login === 'dependabot[bot]'")
            && e2e_pr.contains("cannot run on private ARC"),
        "manual PR-head e2e must reject untrusted sources and must not overwrite default-branch scopes"
    );
    Ok(())
}

pub(super) fn assert_main_web_e2e_core_contract(ci: &str) {
    let main_core = section(ci, "  _ci:main:core:\n", "\n  _ci:main:\n");
    assert!(
        !main_core.contains("_web:e2e:build-dist"),
        "main must not request the same e2e build before the e2e task checks its stamp"
    );
    assert!(
        main_core.contains("_web:test:e2e:parallel")
            && main_core.contains("_web:e2e:restore-prod-dist")
            && !main_core.contains("_extension:test:e2e"),
        "main web e2e core must restore prod dist without serializing extension e2e"
    );
    let main = section(ci, "  _ci:main:\n", "\n  _ci:main:web:e2e-only:");
    assert!(
        main.contains("_ci:main:core") && main.contains("_extension:test:e2e"),
        "full main gate must keep extension e2e after the web core"
    );
}

pub(super) fn assert_e2e_build_if_needed_contract(root: &Path) {
    let e2e_builder = (root).read(".github/scripts/e2e-build-if-needed.sh");
    assert_eq!(
        e2e_builder.matches("bun run build:unified").count(),
        1,
        "e2e must compile the unified harness exactly once"
    );
    for required in [
        "site_source=\"$WEB_ROOT/dist-prod/site\"",
        "cp -a \"$site_source\" \"$DIST/site\"",
        "bun run assemble:preview",
    ] {
        assert!(
            e2e_builder.contains(required),
            "e2e assembly contract missing: {required}"
        );
    }
    assert!(
        !e2e_builder.contains("bun run build:simple")
            && !e2e_builder.contains("bun run build:sentinel"),
        "e2e must reuse the sealed Simple and Sentinel artifacts"
    );
}

fn assert_release_and_main_delivery_contract(root: &Path) -> anyhow::Result<()> {
    let release = (root).read(".github/workflows/release.yml");
    let release_source = release
        .find("- name: Checkout release source")
        .context("release workflow must check out release source")?;
    let release_setup = release
        .find("uses: ./.nook/release-workflow/.github/actions/nook-docker-setup")
        .context("release workflow must configure BuildKit from current side-checkout tooling")?;
    assert!(
        release_source < release_setup,
        "release must check out its requested source before connecting BuildKit"
    );
    assert!(release.contains(
        "ref: ${{ github.event_name == 'workflow_dispatch' && inputs.ref || github.ref }}"
    ));
    assert!(
        release.contains("release-sha: ${{ steps.release.outputs.sha }}")
            && release.contains("release-version: ${{ steps.release.outputs.version }}")
            && release.contains("ref: ${{ needs.prepare.outputs.release-sha }}")
            && release.contains("PREPARED_RELEASE_SHA: ${{ needs.prepare.outputs.release-sha }}")
            && release.contains("if [[ \"$sha\" != \"$PREPARED_RELEASE_SHA\" ]]")
            && release.matches("inputs.ref || github.ref }}").count() == 1,
        "release deployment must consume the immutable SHA prepared with its browser image"
    );
    assert!(
        release.contains("path: .nook/release-workflow")
            && release.contains(
                "task --taskfile \"$GITHUB_WORKSPACE/.nook/release-workflow/Taskfile.yml\""
            )
            && release.contains("REPO_ROOT=\"$GITHUB_WORKSPACE\""),
        "historical release refs must use current workflow tooling against the immutable source root"
    );
    let main = (root).read(".github/workflows/main.yml");
    let main_ui_demo_job = section(&main, "  ui-demos:\n", "  deploy:\n");
    for required in [
        "\n  rust:\n",
        "\n  wasm:\n",
        "\n  web:\n",
        "\n  web-e2e:\n",
        "\n  extension-e2e:\n",
        "\n  ui-demos:\n",
        "\n  deploy:\n",
        "needs: [wasm]",
        "needs: [web, web-e2e, wasm-cache-proof]",
        "task _ci:main:web:e2e-only",
        "task _extension:test:e2e",
        "task _web:test:ui-demo",
        "runs-on: nook-k0s-container",
        "nook-main-e2e:run-${{ github.run_id }}-${{ github.run_attempt }}",
        "main-wasm-${{ github.run_id }}",
        "task web:e2e:kubernetes-image:artifacts",
        "CI_ARTIFACT_DIR=${{ runner.temp }}/nook-ci-artifacts/joined",
    ] {
        assert!(
            main.contains(required),
            "main parallel delivery contract missing: {required}"
        );
    }
    assert!(
        main_ui_demo_job.contains("name: UI demos\n    if: ${{ false }}")
            && main_ui_demo_job.contains("task _web:test:ui-demo"),
        "the disabled Main UI demo job must retain its implementation for later re-enable"
    );
    assert!(
        !root.join(".github/scripts/main-post-web-e2e.sh").exists(),
        "same-runner Main suite coordinator was replaced by multi-job consumers"
    );
    let ci_tasks = (root).read("nook-app/ci/Taskfile.yml");
    let web_ci = section(
        &ci_tasks,
        "  ci:main:web-e2e:ci:\n",
        "\n  ci:main:web:artifacts:",
    );
    assert!(
        web_ci.contains("task: docker:e2e:run")
            && web_ci.contains("TASK: _ci:main:web:e2e-only")
            && !web_ci.contains("TASK: _ci:main:core"),
        "Main web e2e CI wrapper must run e2e-only without re-verifying the sealed build"
    );
    let web_e2e_artifacts = section(
        &ci_tasks,
        "  _ci:main:e2e:web:artifacts:host:\n",
        "\n  ci:main:e2e:extension:artifacts:",
    );
    assert!(
        web_e2e_artifacts.contains("task: docker:ci:web:e2e:build")
            && web_e2e_artifacts.contains("TASK: _ci:main:web:e2e-only"),
        "Main web e2e artifact consumer must bake the Chromium image then run e2e-only"
    );
    assert!(
        !root.join(".github/workflows/runner-cleanup.yml").exists(),
        "legacy registered-runner Docker cleanup must not return after ARC migration"
    );
    let prune_script = (root).read(".github/scripts/docker-prune-stale.sh");
    assert!(
        prune_script.contains("--filter until=168h"),
        "runner cleanup must preserve the recent delivery cache"
    );
    Ok(())
}

#[test]
fn release_deploy_trusts_only_exact_actions_workspace_before_git_resolution() -> anyhow::Result<()>
{
    let root = RepositoryFixture::repository_root();
    let release = root.read(".github/workflows/release.yml");
    let deploy = release
        .split_once("\n  deploy:\n")
        .context("release workflow must define the deploy job")?
        .1;
    let checkout = deploy
        .find("- name: Checkout release source")
        .context("release deploy must check out its immutable source")?;
    let exact_trust = r#"git config --global --add safe.directory "$GITHUB_WORKSPACE""#;
    let trust = deploy
        .find(exact_trust)
        .context("release deploy must trust the exact Actions workspace")?;
    let resolve = deploy
        .find("- name: Resolve and validate release")
        .context("release deploy must resolve and validate its source")?;

    assert!(
        checkout < trust && trust < resolve,
        "release deploy must trust the exact checked-out workspace before its first repository Git command"
    );
    assert_eq!(
        deploy.matches("safe.directory").count(),
        1,
        "release deploy must register exactly one scoped Git safe directory and never wildcard trust"
    );
    Ok(())
}
