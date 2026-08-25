use super::*;
use anyhow::Context;

#[test]
fn delivery_ci_uses_configured_runners_with_scoped_buildkit_caches() -> anyhow::Result<()> {
    let root = repository_root();
    assert_workflow_runtime_contract(&root);
    assert_docker_setup_contract(&root);
    assert_pr_workflow_contract(&root)?;
    assert_artifact_backed_e2e_contract(&root)?;
    assert_release_and_main_delivery_contract(&root)?;
    Ok(())
}

fn assert_workflow_runtime_contract(root: &Path) {
    for workflow in [
        ".github/workflows/pr.yml",
        ".github/workflows/main.yml",
        ".github/workflows/release.yml",
    ] {
        let content = read(root, workflow);
        for run_scoped_image in [
            "DOCKER_IMAGE: nook-web:run-${{ github.run_id }}-${{ github.run_attempt }}",
            "DOCKER_E2E_IMAGE: nook-web-e2e:run-${{ github.run_id }}-${{ github.run_attempt }}",
        ] {
            assert!(
                content.contains(run_scoped_image),
                "{workflow} must isolate its loaded runtime image: {run_scoped_image}"
            );
        }
    }
    let pr = read(root, ".github/workflows/pr.yml");
    let main = read(root, ".github/workflows/main.yml");
    let release = read(root, ".github/workflows/release.yml");
    let ecosystem = read(root, ".github/workflows/rust-ecosystem-checks.yml");
    assert!(
        pr.contains("(vars.NOOK_RUNS_ON || 'nook-k0s') || 'ubuntu-latest'")
            && release.contains("runs-on: ${{ vars.NOOK_RUNS_ON || 'nook-k0s' }}")
            && release.contains("runs-on: nook-k0s-container")
            && pr
                .matches("github.event.pull_request.head.repo.full_name == github.repository")
                .count()
                >= 3
            && ecosystem
                .matches("github.event.pull_request.head.repo.full_name == github.repository")
                .count()
                == 5,
        "trusted PR and release jobs must select ARC while forks retain hosted isolation"
    );
    assert!(
        !main.contains("runs-on: ubuntu-latest")
            && main
                .matches("runs-on: ${{ vars.NOOK_RUNS_ON || 'nook-k0s' }}")
                .count()
                >= 5
            && main.matches("runs-on: nook-k0s-container").count() >= 3
            && main.contains("name: Portable WASM cache publication proof")
            && main.contains("bash .github/scripts/verify-wasm-gha-cache.sh"),
        "Main build, browser, deployment, and portable cache-proof jobs must all use ARC"
    );
}

fn assert_docker_setup_contract(root: &Path) {
    let setup = read(root, ".github/actions/nook-docker-setup/action.yml");
    let pr = read(root, ".github/workflows/pr.yml");
    let arc_values = read(root, "infra/k0s/manifests/arc/runner-scale-set-values.yaml");
    for required in [
        "docker/setup-buildx-action@v4",
        "Preload hosted BuildKit from Zot",
        "docker pull \"${{ inputs.registry-host }}/moby/buildkit:buildx-stable-1\"",
        "driver-opts: image=${{ inputs.registry-host }}/moby/buildkit:buildx-stable-1",
        "docker/login-action@v4",
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
        pr.contains("name: Publish git-scoped native BuildKit cache")
            && pr.contains("task ci:main:publish-native-cache")
            && pr.contains("GHA_CACHE_WRITE_ENABLED=\"\"")
            && pr.contains(
                "ARC keeps the verified native graph local; Main and sccache remain reusable"
            ),
        "trusted ARC PR native verification must remain read-only while hosted fallback can publish its exact cache"
    );
    assert_eq!(
        pr.matches("if [ \"${NOOK_ARC_RUNNER:-}\" = \"1\" ]; then")
            .count(),
        4,
        "every general PR cache publisher must explicitly keep ARC verification graphs local"
    );
    for local_graph_message in [
        "ARC keeps the verified native graph local; Main and sccache remain reusable",
        "ARC keeps the verified WASM graph local; Main and sccache remain reusable",
        "ARC keeps the verified web graph local; Main remains reusable",
    ] {
        assert!(
            pr.contains(local_graph_message),
            "PR CI is missing the ARC-local cache contract: {local_graph_message}"
        );
    }
    assert!(
        !setup.contains("crazy-max/ghaction-github-runtime")
            && !setup.contains("systemctl restart docker")
            && !setup.contains("/etc/docker/daemon.json"),
        "delivery setup must login to registry.dev.nokey.sh and must not reconfigure or restart Docker"
    );
    for required in [
        "automountServiceAccountToken: false",
        "name: install-docker-client",
        "registry.dev.nokey.sh/library/docker:29.1.3-cli@sha256:",
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
    let pr = read(root, ".github/workflows/pr.yml");
    for required in [
        "name: Native Rust verification",
        "name: WASM build and artifact",
        "name: WASM Node tests",
        "name: Web verification",
        "name: Headless UI demo",
        "name: Verify and preview",
        "always() &&",
        "needs: [rust, wasm, verify, wasm-node-test, ui-demo]",
        "name: Enforce required verification results",
        "NATIVE_RESULT: ${{ needs.rust.result }}",
        "WASM_RESULT: ${{ needs.wasm.result }}",
        "WEB_RESULT: ${{ needs.verify.result }}",
        "WASM_NODE_RESULT: ${{ needs.wasm-node-test.result }}",
        "UI_DEMO_RESULT: ${{ needs.ui-demo.result }}",
        "name: Rust coverage report",
        "uses: ./.github/workflows/pr-coverage.yml",
        "types: [labeled]",
        "name: Validate explicit CI request",
        "name: Reject unsupported label events",
        "github.event.label.name == 'ci:validate'",
        "name: Full browser e2e (main fix)",
        "name: Full extension e2e (main fix)",
        "contains(github.event.pull_request.labels.*.name, 'ci:full-e2e')",
        "runs-on: nook-k0s-container",
        "nook-pr-e2e:run-${{ github.run_id }}-${{ github.run_attempt }}",
        "name: pr-wasm-${{ github.run_id }}",
        "task _ci:main:web:e2e-only",
        "task _extension:test:e2e",
        "task preflight",
        "task ci:pr:rust",
        "task ci:pr:wasm",
        "task ci:pr:web",
        "name: Locate trusted native handoff",
        "name: Locate trusted WASM handoff",
        "nook-trusted-native-validation-v2-",
        "nook-trusted-wasm-validation-v2-",
        "run.name === 'PR validation handoff'",
        "workflowPath === '.github/workflows/pr-validation-handoff.yml'",
        "steps.trusted-native.outputs.found != 'true'",
        "steps.trusted-wasm.outputs.found != 'true'",
        "'.github/actions/nook-cache-connect/**'",
        "'preflight/**'",
        "'nook-app/nook-platform/nook-app-common/**'",
        "'nook-app/nook-platform/nook-companion-core/**'",
        "'nook-app/nook-platform/nook-companion-wasm/**'",
        "'nook-app/nook-platform/nook-wasm/**'",
        "chmod +x \"$dir/tools/nook-preflight\"",
        "test -x \"$dir/tools/nook-preflight\"",
        "needs: [validation-request, wasm]",
        "needs: [rust, wasm, verify, wasm-node-test, ui-demo]",
        "name: Download built WASM handoff",
        "name: Upload preview dist handoff",
        "NOOK_HOST_PAGES_DEPLOY",
        "needs: rust",
    ] {
        assert!(
            pr.contains(required),
            "PR CI must keep its normal split gate and label-selected Main-fix e2e contract: {required}"
        );
    }

    let coverage = read(root, ".github/workflows/pr-coverage.yml");
    for required in [
        "workflow_call:",
        "name: Rust coverage report",
        "HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
        "name: pr-rust-${{ github.run_id }}",
        "path: coverage/current",
        ".github/scripts/base-coverage-artifact.cjs",
        "coverage/current/tools/nook-preflight coverage-inputs",
        "--repository \"$GITHUB_WORKSPACE\"",
        "--base \"$BASE_SHA\"",
        "--head \"$HEAD_SHA\"",
        "--github-output \"$GITHUB_OUTPUT\"",
        "coverage/current/tools/nook-preflight validate-coverage-artifact",
        "coverage/current/tools/nook-preflight coverage-report",
        "Exact base coverage is unavailable; enforcing current absolute coverage floors",
    ] {
        assert!(
            coverage.contains(required),
            "reusable PR coverage workflow is missing: {required}"
        );
    }
    assert!(
        !coverage.contains("git diff --name-only \"$BASE_SHA...$HEAD_SHA\" --"),
        "coverage input detection belongs in the typed Rust reporter, not workflow shell"
    );
    let native_job = section(&pr, "  rust:\n", "  wasm:\n");
    let wasm_job = section(&pr, "  wasm:\n", "  wasm-node-test:\n");
    let wasm_node_job = section(&pr, "  wasm-node-test:\n", "  verify:\n");
    let verify_job = section(&pr, "  verify:\n", "  ui-demo:\n");
    let ui_demo_job = section(&pr, "  ui-demo:\n", "  preview:\n");
    assert!(
        wasm_job.contains("task ci:pr:wasm")
            && !wasm_job.contains("task ci:wasm:node-test")
            && wasm_job.contains("steps.trusted-wasm.outputs.found != 'true'")
            && wasm_job.contains("Upload built WASM handoff")
            && wasm_job.contains("nook-run-attempt")
            && wasm_job.contains("run-node-tests")
            && wasm_job.contains("cache-write: \"false\"")
            && wasm_job.contains("main-cache-only: \"true\"")
            && wasm_job.contains("isolated-cache-write: \"true\"")
            && wasm_job.contains("NOOK_SCCACHE_ACCESS_KEY"),
        "PR CI must restore or build WASM once and publish the exact attempt before Node tests"
    );
    assert!(
        wasm_node_job.contains("needs: wasm")
            && wasm_node_job.contains("task ci:wasm:node-test")
            && wasm_node_job.contains("needs.wasm.outputs.run-node-tests == 'true'")
            && wasm_node_job.contains("GHA_CACHE_WRITE_ENABLED=\"\" task ci:wasm:node-test")
            && wasm_node_job.contains("GHA_CACHE_WRITE_ENABLED=1 task ci:wasm:node-test")
            && wasm_node_job.contains("Trusted handoff already covered Node tests"),
        "PR CI must finish WASM Node tests without exporting ARC graphs while preserving hosted exact-cache publication"
    );
    assert!(
        native_job.contains("cache-write: \"false\"")
            && native_job.contains("main-cache-only: \"true\"")
            && native_job.contains("isolated-cache-write: \"true\"")
            && native_job.contains("NOOK_SCCACHE_ACCESS_KEY")
            && native_job.contains("if: steps.trusted-native.outputs.found == 'true'")
            && native_job.contains("task preflight"),
        "native PR validation must use sccache, isolate BuildKit writes, and run explicit preflight only for an exact handoff"
    );
    assert!(
        !verify_job.contains("Record headless UI demo")
            && ui_demo_job.contains("needs: [validation-request, verify]")
            && ui_demo_job.contains("runs-on: nook-k0s-container")
            && ui_demo_job
                .contains("nook-pr-e2e:run-${{ github.run_id }}-${{ github.run_attempt }}")
            && ui_demo_job.contains("Enforce the UI demo contract")
            && ui_demo_job.contains("task _web:test:ui-demo")
            && !ui_demo_job.contains("nook-docker-setup")
            && ui_demo_job.contains("steps.ui-demo-contract.outputs.required == 'true'"),
        "changed PR demos must consume the exact browser image on container ARC without serializing web verification"
    );
    assert!(
        !pr.contains("actions/cache/"),
        "PR-writable caches must never bypass required validation"
    );
    assert!(
        !pr.contains("github.event.action != 'closed'") && !pr.contains("types: [labeled, closed]"),
        "PR close cancellation must not create a skipped PR source run"
    );

    let linear_ui_demo = read(root, ".github/workflows/linear-ui-demo.yml");
    assert!(
        linear_ui_demo.contains("format('pr-{0}', github.event.pull_request.number)")
            && linear_ui_demo.contains("cancel-in-progress: true"),
        "the trusted close workflow must cancel the shared PR concurrency group"
    );

    let trusted_handoff = read(root, ".github/workflows/pr-validation-handoff.yml");
    for required in [
        "name: PR validation handoff",
        "github.event.workflow_run.conclusion == 'success'",
        "workflowPath !== '.github/workflows/pr.yml'",
        "run.path?.replace(/@[^@]+$/, '')",
        "ref: ${{ steps.source.outputs.base-sha }}",
        "git merge-tree --write-tree HEAD \"$HEAD_SHA\"",
        "git read-tree --reset -u \"$merge_tree\"",
        "'Native Rust verification'",
        "'WASM build and artifact'",
        "'WASM Node tests'",
        "'Verify and preview'",
        "producer_jobs_verified: true",
        "nook-validation-manifest.json",
        "nook-trusted-native-validation-v2-",
        "nook-trusted-wasm-validation-v2-",
        "'.github/actions/nook-cache-connect/**'",
        "'preflight/**'",
        "'nook-app/nook-platform/nook-app-common/**'",
        "chmod +x \"$native/tools/nook-preflight\"",
        "test -x \"$native/tools/nook-preflight\"",
    ] {
        assert!(
            trusted_handoff.contains(required),
            "trusted validation promotion is missing: {required}"
        );
    }
    assert!(
        !trusted_handoff.contains("workflow_dispatch")
            && !trusted_handoff.contains("listPullRequestsAssociatedWithCommit"),
        "trusted validation promotion must require the immutable workflow-run PR snapshot"
    );
    assert!(
        trusted_handoff.contains("context.payload.workflow_run?.pull_requests?.[0]"),
        "trusted validation promotion must derive PR provenance from the immutable workflow-run event snapshot"
    );
    assert!(
        trusted_handoff.contains("filter: 'all'")
            && !trusted_handoff.contains("filter: 'latest'")
            && trusted_handoff.contains("const currentAttempt = run.run_attempt")
            && trusted_handoff.contains("!hasSuccessfulJob('Native Rust verification', true)",)
            && trusted_handoff.contains("!hasSuccessfulJob('WASM build and artifact', true)",)
            && trusted_handoff.contains("!hasSuccessfulJob('WASM Node tests', true)",)
            && trusted_handoff.contains("!hasSuccessfulJob('Verify and preview', false)")
            && trusted_handoff.contains("candidate.run_attempt < currentAttempt"),
        "trusted validation promotion must accept successful producers omitted from a failed-job rerun while requiring the current consumer attempt"
    );
    assert!(
        native_job.contains("run.event === 'workflow_run'")
            && wasm_job.contains("run.event === 'workflow_run'")
            && !native_job.contains("workflow_dispatch")
            && !wasm_job.contains("workflow_dispatch"),
        "trusted handoff consumers must accept only automatic workflow-run promotions"
    );
    assert_eq!(
        pr.matches("task ci:pr:wasm").count(),
        1,
        "PR CI must not duplicate the verified WASM producer"
    );
    let preview_job = section(&pr, "  preview:\n", "  coverage:\n");
    assert!(
        verify_job.contains("github.event.label.name == 'ci:validate'")
            && verify_job.contains("github.event.label.name == 'ci:full-e2e'")
            && verify_job.contains("needs: [validation-request, wasm]")
            && verify_job.contains("name: Download built WASM handoff")
            && verify_job.contains("name: Confirm WASM handoff shape")
            && verify_job.contains("name: Upload preview dist handoff")
            && verify_job.contains("actions/download-artifact@v8")
            && verify_job.contains("name: pr-wasm-${{ github.run_id }}")
            && !verify_job.contains("Wait for built WASM handoff")
            && !verify_job.contains("attempt $attempt/900")
            && !verify_job.contains("task ci:pr:deploy-and-verify-previews")
            && !verify_job.contains("task ci:pr:wasm")
            && verify_job.contains(
            "NOOK_SIMPLE_VAULT_URL: https://pr-${{ github.event.pull_request.number }}.nokey-simple.pages.dev/",
        ),
        "PR web verification must wait on the WASM build through needs, download its artifact, and export host dist"
    );
    assert!(
        preview_job.contains("needs: [rust, wasm, verify, wasm-node-test, ui-demo]")
            && preview_job.contains("always() &&")
            && preview_job.contains("name: Enforce required verification results")
            && preview_job.contains("NOOK_HOST_PAGES_DEPLOY: \"1\"")
            && preview_job.contains("bash .github/scripts/ci-pr-deploy-and-verify-previews.sh")
            && preview_job.contains("name: pr-web-dist-${{ github.run_id }}")
            && !preview_job.contains("attempt $attempt/900"),
        "PR preview must deploy only after Native Rust, WASM, web verification, WASM Node tests, and the UI demo succeed"
    );
    let coverage_job = section(&pr, "  coverage:\n", "  full-e2e-shard:\n");
    let coverage_workflow = read(root, ".github/workflows/pr-coverage.yml");
    assert!(
        coverage_job.contains("needs: rust")
            && coverage_job.contains("uses: ./.github/workflows/pr-coverage.yml")
            && coverage_workflow.contains("actions/download-artifact@v8")
            && coverage_workflow.contains("name: pr-rust-${{ github.run_id }}")
            && coverage_workflow.contains("path: coverage/current")
            && coverage_workflow.contains("findBaseCoverageArtifact")
            && coverage_workflow.contains("coverage/current/tools/nook-preflight coverage-report")
            && !coverage_workflow.contains("task docker:coverage:export")
            && !coverage_workflow.contains("Waiting for native coverage artifact"),
        "coverage reporting must consume the completed native artifact directly without blocking preview or rebuilding the base revision"
    );
    let full_e2e_job = section(&pr, "  full-e2e-shard:\n", "  full-e2e:\n");
    assert!(
        full_e2e_job.contains("needs: [verify, wasm-node-test]")
            && full_e2e_job.contains("runs-on: nook-k0s-container")
            && full_e2e_job
                .contains("nook-pr-e2e:run-${{ github.run_id }}-${{ github.run_attempt }}")
            && full_e2e_job.contains("task _ci:main:web:e2e-only")
            && !full_e2e_job.contains("nook-docker-setup")
            && !full_e2e_job.contains("task ci:pr:e2e\n")
            && !full_e2e_job.contains("task ci:pr:wasm"),
        "Main-fix web e2e must consume the exact browser image without rebuilding Rust"
    );
    let extension_e2e_job = pr
        .split_once("  full-extension-e2e:\n")
        .context("PR workflow must define full extension E2E")?
        .1;
    assert!(
        extension_e2e_job.contains("needs: [verify, wasm-node-test]")
            && extension_e2e_job.contains("runs-on: nook-k0s-container")
            && extension_e2e_job
                .contains("nook-pr-e2e:run-${{ github.run_id }}-${{ github.run_attempt }}")
            && extension_e2e_job.contains("task _extension:test:e2e")
            && !extension_e2e_job.contains("nook-docker-setup")
            && !extension_e2e_job.contains("task ci:pr:e2e\n")
            && !extension_e2e_job.contains("task ci:pr:wasm")
            && !extension_e2e_job.contains("NOOK_EXTENSION_E2E_SIMPLE_VAULT_URL"),
        "Main-fix extension e2e must consume the exact browser image without rebuilding Rust"
    );
    assert!(
        pr.contains("name: pr-wasm-${{ github.run_id }}")
            && !pr.contains("name: pr-wasm-${{ github.run_id }}-${{ github.run_attempt }}")
            && !pr
                .contains("ARTIFACT_NAME: pr-rust-${{ github.run_id }}-${{ github.run_attempt }}")
            && !pr.contains("needs: [rust, wasm]"),
        "split-CI handoffs must remain run-stable for failed-job reruns"
    );
    assert!(
        !verify_job.contains("read_lines_percent")
            && !verify_job.contains("awk ")
            && !verify_job.contains("| wc -l")
            && !verify_job.contains("jq -e --arg commit_sha"),
        "PR coverage reporting must consume structured JSON through the Rust preflight reporter"
    );
    assert_preflight_reporter_contract(root);
    Ok(())
}

fn assert_preflight_reporter_contract(root: &Path) {
    let ci_tasks = read(root, "nook-app/ci/Taskfile.yml");
    assert!(
        ci_tasks.contains("PREFLIGHT_OUTPUT_DIR: '{{.CI_ARTIFACT_DIR}}/tools'"),
        "native PR CI must export the preflight reporter with its coverage artifact"
    );
    let preflight_dockerfile = read(root, "preflight/Dockerfile");
    for required in [
        "FROM rust-base AS chef",
        "FROM rust-base AS deps",
        "FROM deps AS build",
        "cargo chef prepare --recipe-path recipe.json",
        "cargo chef cook --recipe-path recipe.json",
        "cargo chef cook --tests --recipe-path recipe.json",
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
    assert!(
        !preflight_dockerfile.contains("FROM rust:")
            && !preflight_dockerfile.contains("FROM rust@"),
        "preflight must reuse rust-base instead of installing a floating Rust tag"
    );
    let preflight_bake = read(root, "preflight/docker-bake.hcl");
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
    let preflight_tasks = read(root, "preflight/Taskfile.yml");
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
    let pr = read(root, ".github/workflows/pr.yml");
    let ci_tasks = read(root, "nook-app/ci/Taskfile.yml");
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
    let verify_job = section(&pr, "  verify:\n", "  preview:\n");
    let preview_job = section(&pr, "  preview:\n", "  coverage:\n");
    let coverage_job = section(&pr, "  coverage:\n", "  full-e2e:\n");
    let coverage_workflow = read(root, ".github/workflows/pr-coverage.yml");
    assert!(
        !verify_job.contains("Download Rust coverage handoff")
            && !verify_job.contains("Waiting for native coverage artifact")
            && !preview_job.contains("Download Rust coverage handoff")
            && coverage_job.contains("needs: rust")
            && coverage_job.contains("uses: ./.github/workflows/pr-coverage.yml")
            && coverage_workflow.contains("actions/download-artifact@v8")
            && coverage_workflow.contains("name: pr-rust-${{ github.run_id }}"),
        "Rust coverage must use a native-dependent artifact consumer instead of occupying the preview runner"
    );
    let wasm_handoff = section(
        &pr,
        "      - name: Download built WASM handoff\n",
        "      - name: Svelte checks, JS unit tests, lint, and preview build",
    );
    assert!(
        wasm_handoff.contains("actions/download-artifact@v8")
            && wasm_handoff.contains("name: pr-wasm-${{ github.run_id }}")
            && wasm_handoff.contains("nook-ci-artifacts/joined/nook-wasm")
            && !wasm_handoff.contains("gh api")
            && !wasm_handoff.contains("sleep 2"),
        "PR verification must download the WASM handoff through needs instead of polling GitHub"
    );
    let deploy = section(
        preview_job,
        "      - name: Deploy and verify Pages previews\n",
        "      - name: Comment preview URL on PR\n",
    );
    assert!(
        deploy.contains("id: deploy-all")
            && deploy.contains("bash .github/scripts/ci-pr-deploy-and-verify-previews.sh")
            && deploy.contains("NOOK_HOST_PAGES_DEPLOY: \"1\""),
        "PR preview deploy must invoke the host Pages script that owns concurrent uploads"
    );
    let deploy_script = read(root, ".github/scripts/ci-pr-deploy-and-verify-previews.sh");
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
    let host_deploy = read(root, ".github/scripts/ci-pr-host-pages-deploy.sh");
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
    let e2e_pr = read(root, ".github/workflows/e2e-pr.yml");
    assert!(
        e2e_pr.contains("cache-write: \"false\""),
        "manual PR-head e2e may restore shared caches but must not overwrite default-branch scopes"
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
    let e2e_builder = read(root, ".github/scripts/e2e-build-if-needed.sh");
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
    let release = read(root, ".github/workflows/release.yml");
    let release_source = release
        .find("- name: Checkout release source")
        .context("release workflow must check out release source")?;
    let release_tooling = release
        .find("- name: Checkout release workflow tooling")
        .context("release workflow must check out workflow tooling")?;
    let release_setup = release
        .find("uses: ./.nook/release-workflow/.github/actions/nook-docker-setup")
        .context("release workflow must configure Docker through preserved tooling")?;
    assert!(
        release_source < release_tooling && release_tooling < release_setup,
        "release must fingerprint its requested source with preserved workflow-ref Docker tooling"
    );
    assert!(release.contains("ref: ${{ github.sha }}"));
    assert!(release.contains("path: .nook/release-workflow"));
    let main = read(root, ".github/workflows/main.yml");
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
        "task ci:main:e2e:web:artifacts",
        "task ci:main:e2e:extension:artifacts",
        "task ci:main:ui-demo:artifacts",
        "main-wasm-${{ github.run_id }}",
    ] {
        assert!(
            main.contains(required),
            "main parallel delivery contract missing: {required}"
        );
    }
    assert!(
        !root.join(".github/scripts/main-post-web-e2e.sh").exists(),
        "same-runner Main suite coordinator was replaced by multi-job consumers"
    );
    let ci_tasks = read(root, "nook-app/ci/Taskfile.yml");
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
    let prune_script = read(root, ".github/scripts/docker-prune-stale.sh");
    assert!(
        prune_script.contains("--filter until=168h"),
        "runner cleanup must preserve the recent delivery cache"
    );
    Ok(())
}
