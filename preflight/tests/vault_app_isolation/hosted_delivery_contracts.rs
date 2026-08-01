use super::*;
use anyhow::Context;

#[test]
fn delivery_ci_uses_github_hosted_runners_with_scoped_buildkit_caches() -> anyhow::Result<()> {
    let root = repository_root();
    assert_hosted_workflow_runtime_contract(&root);
    assert_hosted_buildkit_cache_contract(&root)?;
    assert_docker_setup_contract(&root);
    assert_pr_workflow_contract(&root)?;
    assert_artifact_backed_e2e_contract(&root)?;
    assert_release_and_main_delivery_contract(&root)?;
    Ok(())
}

fn assert_hosted_workflow_runtime_contract(root: &Path) {
    for workflow in [
        ".github/workflows/pr.yml",
        ".github/workflows/main.yml",
        ".github/workflows/release.yml",
    ] {
        let content = read(root, workflow);
        assert!(
            content.contains("runs-on: ubuntu-latest"),
            "{workflow} must use elastic GitHub-hosted capacity"
        );
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
}

fn assert_hosted_buildkit_cache_contract(root: &Path) -> anyhow::Result<()> {
    let bake = read(root, "nook-app/docker-bake.hcl");
    for required in [
        "GHA_CACHE_ENABLED",
        "GHA_CACHE_WRITE_ENABLED",
        "NOOK_REGISTRY_CACHE_HOST",
        "default = \"registry.dev.nokey.sh\"",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-base-v1",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-deps-v2",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-native-source-v2",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-wasm-source-v2",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-deps-v1",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-v1",
        "${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-web-e2e-v1",
        "type=registry,ref=",
        "mode=max,timeout=10m",
    ] {
        assert!(
            bake.contains(required),
            "hosted BuildKit cache contract is missing: {required}"
        );
    }
    assert!(
        read(root, "nook-app/docker/base.docker-bake.hcl")
            .contains("cache-to   = rust_base_cache_to"),
        "the Rust toolchain base must seed its own hosted cache before dependency scopes consume it"
    );
    assert!(
        !bake.contains("type=gha"),
        "delivery caches must use registry.dev.nokey.sh, not the GitHub Actions cache service"
    );
    assert_eq!(
        bake.matches("GHA_CACHE_WRITE_ENABLED != \"\" ?").count(),
        8,
        "every hosted cache exporter must honor the read-only workflow mode"
    );
    assert_rust_cache_export_hardening(&bake);

    let rust_bake = read(root, "nook-app/nook-wasm/docker-bake.hcl");
    assert!(
        rust_bake.contains("builder-wasm-deps = \"target:builder-wasm-deps\"")
            && rust_bake
                .matches("cache-to   = rust_wasm_source_cache_to")
                .count()
                == 2,
        "WASM export and joined web artifacts must persist the source-sensitive hosted lineage"
    );
    let core_bake = read(root, "nook-app/nook-core/docker-bake.hcl");
    assert!(
        core_bake.contains("cache-to   = rust_deps_cache_to")
            && core_bake.contains("cache-from = rust_native_source_cache_from")
            && core_bake.contains("cache-to   = rust_native_source_cache_to"),
        "native dependency and source-sensitive coverage layers need independent hosted caches"
    );
    assert_release_wasm_cache_contract(root);
    assert_parallel_web_pipeline(root);
    let web_bake = read(root, "nook-app/docker/toolchain.docker-bake.hcl");
    assert!(
        web_bake.contains("cache-to   = web_deps_cache_to"),
        "web dependencies need an independent cache scope"
    );
    let docker_tasks = read(root, "nook-app/docker/Taskfile.yml");
    assert!(
        docker_tasks.contains("for attempt in 1 2; do")
            && docker_tasks.contains("nook-web-ci")
            && !docker_tasks.contains("--set \"nook-web-ci.target=nook-web-verify\"")
            && docker_tasks
                .contains("task docker:ci:web:build: transient Bake failure; retrying in 2s",),
        "hosted web delivery must solve the joined validation/build target once and retry only the immediate BuildKit frontend flake"
    );
    let app_tasks = read(root, "nook-app/Taskfile.yml");
    assert!(
        app_tasks.contains("for attempt in 1 2; do")
            && app_tasks.contains(
                "task setup: transient $setup_target Bake failure; retrying final web solve in 2s",
            ),
        "the primary setup path must retry only its final web solve after the immediate BuildKit frontend flake"
    );
    assert!(
        app_tasks.contains("--set \"builder-wasm-deps.output=type=cacheonly\"")
            && app_tasks.contains("--set \"builder-deps.output=type=cacheonly\"")
            && app_tasks.contains("--set \"builder-debug.output=type=cacheonly\""),
        "selected dependency and native-source cache publishers must be explicit cache-only Bake outputs"
    );
    assert_main_producer_owned_cache_publish(root)?;
    assert_main_split_pipeline(root)?;
    Ok(())
}

fn assert_rust_cache_export_hardening(bake: &str) {
    assert!(
        !bake.contains(
            "nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,mode=max,ignore-error=true"
        ) && !bake.contains("${GHA_RUST_WASM_DEPS_SCOPE}:buildcache,mode=max,ignore-error=true",),
        "Rust dependency cache exporters must not ignore upload failures"
    );
    assert!(
        !bake.contains("group \"publish-gha-cache\"")
            && !bake.contains("group \"prepare-and-publish-cache\""),
        "BuildKit cache publication must not reconstruct completed producer graphs in a dedicated Bake"
    );
}

fn assert_main_producer_owned_cache_publish(root: &Path) -> anyhow::Result<()> {
    let main = read(root, ".github/workflows/main.yml");
    let rust = section(&main, "  rust:\n", "\n  wasm:\n");
    let wasm = section(&main, "  wasm:\n", "\n  web:\n");
    let web = section(&main, "  web:\n", "\n  web-e2e:\n");
    let rust_verify = rust
        .find("task ci:pr:rust")
        .context("Main Rust job must verify")?;
    let rust_publish = rust
        .find("task ci:main:publish-native-cache")
        .context("Main Rust job must publish its cache")?;
    let wasm_verify = wasm
        .find("task ci:pr:wasm")
        .context("Main WASM job must verify")?;
    let wasm_node = wasm
        .find("task ci:wasm:node-test")
        .context("Main WASM job must run Node tests")?;
    let wasm_publish = wasm
        .find("task ci:main:publish-wasm-cache")
        .context("Main WASM job must publish its cache")?;
    let web_verify = web
        .find("task ci:main:web:artifacts")
        .context("Main web job must build verified artifacts")?;
    let web_publish = web
        .find("task ci:main:publish-web-cache")
        .context("Main web job must publish its cache")?;
    assert!(
        rust_verify < rust_publish
            && rust[rust_verify..rust_publish].contains("GHA_CACHE_WRITE_ENABLED: \"\"")
            && rust[rust_publish..].contains("GHA_CACHE_WRITE_ENABLED: \"1\"")
            && wasm.contains("needs: [rust]")
            && wasm_verify < wasm_node
            && wasm_node < wasm_publish
            && wasm[wasm_verify..wasm_publish].contains("GHA_CACHE_WRITE_ENABLED: \"\"")
            && wasm[wasm_publish..].contains("GHA_CACHE_WRITE_ENABLED: \"1\"")
            && web_verify < web_publish
            && web[web_verify..web_publish].contains("GHA_CACHE_WRITE_ENABLED: \"\"")
            && web[web_publish..].contains("GHA_CACHE_WRITE_ENABLED: \"1\"")
            && !main.contains("\n  publish-cache:\n")
            && !main.contains("task ci:main:warm-gha-cache")
            && !main.contains("task ci:main:publish-gha-cache"),
        "Main producers must verify read-only, serialize native before WASM, and publish from their warm builders only after all lane validation succeeds"
    );
    let ci_tasks = read(root, "nook-app/.task/ci.yml");
    assert!(
        !ci_tasks.contains("warm-gha-cache")
            && !ci_tasks.contains("publish-gha-cache")
            && !root
                .join(".github/scripts/warm-buildkit-gha-cache.sh")
                .exists()
            && !root
                .join(".github/scripts/publish-buildkit-gha-cache.sh")
                .exists(),
        "obsolete deferred cache reconstruction commands and scripts must stay removed"
    );
    let docker_tasks = read(root, "nook-app/docker/Taskfile.yml");
    assert!(
        docker_tasks.contains("ci-rust builder-deps rust-base")
            && docker_tasks.contains("wasm-export builder-wasm-deps")
            && docker_tasks.contains("nook-web-ci web-deps")
            && docker_tasks.contains("docker:ci:cache:publish:native:")
            && docker_tasks.contains("docker:ci:cache:publish:wasm:")
            && docker_tasks.contains("docker:ci:cache:publish:web:")
            && docker_tasks.contains("--set \"builder-wasm-deps.cache-from=\"")
            && docker_tasks.contains(
                "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST:-registry.dev.nokey.sh}/nook/buildcache/"
            )
            && docker_tasks.contains("--set \"builder-wasm-deps.cache-to=\"")
            && docker_tasks.contains("--set \"wasm-export.cache-from=\"")
            && docker_tasks.contains(".github/scripts/verify-wasm-gha-cache.sh"),
        "producer-owned publishers must select local verified graphs, preserve the isolated no-import WASM dependency export, and verify it from a fresh builder"
    );
    let cache_verifier = read(root, ".github/scripts/verify-wasm-gha-cache.sh");
    assert!(
        cache_verifier.contains("docker-container")
            && cache_verifier.contains("builder-wasm-deps.cache-from=type=registry")
            && cache_verifier.contains("nook-sccache-report chef-wasm-release")
            && cache_verifier.contains("nook-sccache-report chef-wasm-clippy")
            && cache_verifier.contains("nook-sccache-report wasm-release-test-dependencies"),
        "Main must reject a published WASM cache until a fresh builder restores every dependency layer"
    );
    let base_dockerfile = read(root, "nook-app/docker/base.Dockerfile");
    assert!(
        base_dockerfile.contains("CARGO_CHEF_IMAGE=")
            && base_dockerfile.contains("@sha256:")
            && base_dockerfile.contains("FROM ${CARGO_CHEF_IMAGE} AS cargo-chef")
            && base_dockerfile.contains("FROM ${RUST_IMAGE} AS rust-base")
            && base_dockerfile.contains("FROM rust-base AS chef-planner")
            && base_dockerfile.contains("FROM rust-base AS builder-deps-common")
            && base_dockerfile.contains("NOOK_WASM_DEPS_CACHE_EPOCH=")
            && base_dockerfile.contains("/etc/nook-wasm-deps-cache-epoch")
            && !base_dockerfile.contains("cargo-chef:latest-rust-${RUST_VERSION}"),
        "Rust dependency stages must be self-contained on digest-pinned base images with an explicit reseed epoch"
    );
    Ok(())
}

fn assert_main_split_pipeline(root: &Path) -> anyhow::Result<()> {
    let main = read(root, ".github/workflows/main.yml");
    assert!(
        main.contains("\n  rust:\n")
            && main.contains("\n  wasm:\n")
            && main.contains("\n  web:\n")
            && main.contains("\n  web-e2e:\n")
            && main.contains("task ci:pr:rust")
            && main.contains("task ci:pr:wasm")
            && main.contains("task ci:main:web:artifacts")
            && main.contains("task ci:main:e2e:web:artifacts")
            && main.contains("needs: [web, web-e2e]"),
        "Main must split native Rust, WASM, web verify, and browser suites without a duplicate cache publisher"
    );
    let coverage_export = read(root, "nook-app/nook-core/docker-bake.hcl")
        .split("target \"coverage-export\" {")
        .nth(1)
        .context("core bake file must define the coverage export target")?
        .to_owned();
    assert!(
        coverage_export.contains("cache-to   = rust_native_source_cache_to"),
        "coverage-export must retain the native-source GHA exporter for the Main native producer"
    );
    Ok(())
}

fn assert_release_wasm_cache_contract(root: &Path) {
    let wasm_dockerfile = read(root, "nook-app/nook-wasm/Dockerfile");
    assert!(
        wasm_dockerfile.contains("FROM builder-wasm-deps AS builder-wasm-source")
            && wasm_dockerfile.contains("FROM builder-wasm-source AS builder-wasm-clippy")
            && wasm_dockerfile.contains("FROM builder-wasm-source AS builder-wasm-build")
            && wasm_dockerfile.contains("FROM builder-wasm-source AS builder-wasm-tests")
            && wasm_dockerfile.contains("FROM builder-wasm-tests AS builder-wasm")
            && wasm_dockerfile
                .contains("COPY --from=builder-wasm-clippy /opt/nook/wasm-clippy-passed")
            && wasm_dockerfile.contains(
                "CARGO_BUILD_TARGET=wasm32-unknown-unknown cargo build --tests --release -p nook-wasm -p nook-companion-wasm",
            )
            && wasm_dockerfile.contains(
                "cargo test --release --target wasm32-unknown-unknown --no-run -p nook-wasm -p nook-companion-wasm",
            )
            && wasm_dockerfile.contains("wasm-pack test --node --release nook-wasm")
            && wasm_dockerfile.contains("wasm-pack build nook-companion-wasm")
            && wasm_dockerfile.contains("COPY --from=builder-wasm-build")
            && wasm_dockerfile.contains("touch nook-app-common/src/i18n.rs")
            && wasm_dockerfile.contains("COPY --from=builder-debug /opt/nook/coverage /coverage"),
        "native verification, WASM clippy, package export, and release-test compilation must run as sibling branches, preserve locale rebuilds, and join only small outputs before release-profile Node tests"
    );
    let dependency_dockerfile = read(root, "nook-app/docker/base.Dockerfile");
    let core_dockerfile = read(root, "nook-app/nook-core/Dockerfile");
    assert!(
        !core_dockerfile.contains("wasm-dependency-test")
            && !core_dockerfile
                .contains("cargo test --target wasm32-unknown-unknown --no-run -p nook-wasm")
            && dependency_dockerfile.contains(
                "cargo build --tests --release --target wasm32-unknown-unknown -p nook-wasm -p nook-companion-wasm",
            ),
        "the manifest-only WASM boundary must prewarm release tests without compiling a second debug graph"
    );
    assert!(
        read(root, "nook-app/nook-web/.task/wasm.yml")
            .contains("wasm-pack test --node --release nook-wasm"),
        "the documented manual WASM test task must use the same release profile as hosted CI"
    );
}

fn assert_parallel_web_pipeline(root: &Path) {
    let web_dockerfile = read(root, "nook-app/nook-web/nook-web-app/Dockerfile");
    assert!(
        web_dockerfile.contains("FROM nook-web-source AS nook-web-verify")
            && web_dockerfile.contains("FROM nook-web-source AS nook-web-build")
            && web_dockerfile.contains("FROM nook-web-build AS nook-web-ci")
            && web_dockerfile.contains("COPY --from=nook-web-verify /opt/nook/web-verified"),
        "hosted PR web checks and production builds must be sibling stages joined by the CI target"
    );
}

fn assert_docker_setup_contract(root: &Path) {
    let setup = read(root, ".github/actions/nook-docker-setup/action.yml");
    for required in [
        "docker/setup-buildx-action@v3",
        "docker/login-action@v3",
        "registry-username",
        "registry-password",
        "registry.dev.nokey.sh",
        "NOOK_PR_BUILDX_BUILDER=${{ steps.buildx.outputs.name }}",
        "BUILDX_BUILDER=${{ steps.buildx.outputs.name }}",
        "GHA_CACHE_ENABLED=1",
        "NOOK_REGISTRY_CACHE_HOST=${{ inputs.registry-host }}",
        "cache_write_enabled=1",
        "GHA_CACHE_WRITE_ENABLED=$cache_write_enabled",
        "event_name=\"${{ github.event_name }}\"",
        "git_ref=\"${{ github.ref }}\"",
        "[ \"$event_name\" != \"push\" ] || [ \"$git_ref\" != \"refs/heads/main\" ]",
        "main-cache-only",
        "main-cache-only requires cache-write=false",
    ] {
        assert!(
            setup.contains(required),
            "GitHub-hosted Docker setup is missing: {required}"
        );
    }
    assert!(
        !setup.contains("crazy-max/ghaction-github-runtime")
            && !setup.contains("systemctl restart docker")
            && !setup.contains("/etc/docker/daemon.json"),
        "delivery setup must login to registry.dev.nokey.sh and must not reconfigure or restart Docker"
    );
}

fn assert_pr_workflow_contract(root: &Path) -> anyhow::Result<()> {
    let pr = read(root, ".github/workflows/pr.yml");
    for required in [
        "name: Native Rust verification",
        "name: WASM verification and artifact",
        "name: Verify and preview",
        "name: Rust coverage report",
        "uses: ./.github/workflows/pr-coverage.yml",
        "types: [labeled, closed]",
        "name: Validate explicit CI request",
        "name: Reject unsupported label events",
        "github.event.label.name == 'ci:validate'",
        "name: Full browser e2e (main fix)",
        "name: Full extension e2e (main fix)",
        "contains(github.event.pull_request.labels.*.name, 'ci:full-e2e')",
        "NOOK_EXTENSION_E2E_SIMPLE_VAULT_URL: http://127.0.0.1:5174/",
        "name: pr-wasm-${{ github.run_id }}",
        "task ci:pr:e2e:web:artifacts",
        "task ci:pr:e2e:extension:artifacts",
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
        "'nook-app/nook-app-common/**'",
        "'nook-app/nook-companion-core/**'",
        "'nook-app/nook-companion-wasm/**'",
        "'nook-app/nook-wasm/**'",
        "chmod +x \"$dir/tools/nook-preflight\"",
        "test -x \"$dir/tools/nook-preflight\"",
        "actions/runs/$GITHUB_RUN_ID/attempts/$GITHUB_RUN_ATTEMPT/jobs",
        "attempt $attempt/900",
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
    let wasm_job = section(&pr, "  wasm:\n", "  verify:\n");
    assert!(
        wasm_job.contains("task ci:pr:wasm")
            && wasm_job.contains("task ci:wasm:node-test")
            && wasm_job.contains("steps.trusted-wasm.outputs.found != 'true'")
            && wasm_job.contains("Upload built WASM handoff")
            && wasm_job.contains("nook-run-attempt")
            && wasm_job.contains("cache-write: \"false\"")
            && wasm_job.contains("main-cache-only: \"true\""),
        "PR CI must restore or build WASM once, publish the exact attempt, and finish Node tests"
    );
    assert!(
        native_job.contains("cache-write: \"false\"")
            && native_job.contains("main-cache-only: \"true\"")
            && native_job.contains("if: steps.trusted-native.outputs.found == 'true'")
            && native_job.contains("task preflight"),
        "native PR validation must read Main cache only and run explicit preflight only for an exact handoff"
    );
    assert!(
        !pr.contains("actions/cache/"),
        "PR-writable caches must never bypass required validation"
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
        "'WASM verification and artifact'",
        "'Verify and preview'",
        "producer_jobs_verified: true",
        "nook-validation-manifest.json",
        "nook-trusted-native-validation-v2-",
        "nook-trusted-wasm-validation-v2-",
        "'.github/actions/nook-cache-connect/**'",
        "'preflight/**'",
        "'nook-app/nook-app-common/**'",
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
            && trusted_handoff
                .contains("!hasSuccessfulJob('WASM verification and artifact', true)",)
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
    let verify_job = section(&pr, "  verify:\n", "  coverage:\n");
    assert!(
        verify_job.contains("github.event.action != 'closed'")
            && verify_job.contains("github.event.label.name == 'ci:validate'")
            && verify_job.contains("github.event.label.name == 'ci:full-e2e'")
            && verify_job.contains("needs: validation-request")
            && !verify_job.contains("needs: wasm")
            && verify_job.contains("name: Wait for built WASM handoff")
            && verify_job.contains("WASM verification completed with $wasm_conclusion")
            && verify_job.contains(
                "actions/runs/$GITHUB_RUN_ID/attempts/$GITHUB_RUN_ATTEMPT/jobs",
            )
            && verify_job.contains(
                "[ \"$artifact_attempt\" = \"$GITHUB_RUN_ATTEMPT\" ]",
            )
            && verify_job.contains("jobs?filter=all&per_page=100")
            && verify_job.contains("| .run_attempt")
            && verify_job.contains("grep -Fxq \"$artifact_attempt\"")
            && verify_job.contains("WASM artifact attempt $artifact_attempt did not complete successfully")
            && verify_job.contains("name: Require WASM producer success before preview")
            && verify_job.contains("attempt $attempt/900")
            && verify_job.contains("sleep 2")
            && !verify_job.contains("task ci:pr:wasm")
            && verify_job.contains(
            "NOOK_SIMPLE_VAULT_URL: https://pr-${{ github.event.pull_request.number }}.nokey-simple.pages.dev/",
        ),
        "PR preview must prepare in parallel, surface failed WASM verification, consume its artifact on success, and target the isolated Simple Vault alias"
    );
    let coverage_job = section(&pr, "  coverage:\n", "  full-e2e:\n");
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
    let full_e2e_job = section(&pr, "  full-e2e:\n", "  full-extension-e2e:\n");
    assert!(
        full_e2e_job.contains("needs: wasm")
            && full_e2e_job.contains("Download verified WASM handoff")
            && full_e2e_job.contains("cache-write: \"false\"")
            && full_e2e_job.contains("main-cache-only: \"true\"")
            && full_e2e_job.contains("task ci:pr:e2e:web:artifacts")
            && !full_e2e_job.contains("task ci:pr:e2e\n")
            && !full_e2e_job.contains("task ci:pr:wasm"),
        "Main-fix web e2e must consume verified WASM without rebuilding Rust"
    );
    let extension_e2e_job = pr
        .split_once("  full-extension-e2e:\n")
        .context("PR workflow must define full extension E2E")?
        .1;
    assert!(
        extension_e2e_job.contains("needs: wasm")
            && extension_e2e_job.contains("Download verified WASM handoff")
            && extension_e2e_job.contains("cache-write: \"false\"")
            && extension_e2e_job.contains("main-cache-only: \"true\"")
            && extension_e2e_job.contains("task ci:pr:e2e:extension:artifacts")
            && !extension_e2e_job.contains("task ci:pr:e2e\n")
            && !extension_e2e_job.contains("task ci:pr:wasm")
            && extension_e2e_job
                .contains("NOOK_EXTENSION_E2E_SIMPLE_VAULT_URL: http://127.0.0.1:5174/"),
        "Main-fix extension e2e must consume verified WASM without rebuilding Rust"
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
    let ci_tasks = read(root, "nook-app/.task/ci.yml");
    assert!(
        ci_tasks.contains("PREFLIGHT_OUTPUT_DIR: '{{.CI_ARTIFACT_DIR}}/tools'"),
        "native PR CI must export the preflight reporter with its coverage artifact"
    );
    let preflight_dockerfile = read(root, "preflight/Dockerfile");
    assert!(
        preflight_dockerfile.contains("FROM rust:1.96-bookworm AS build")
            && preflight_dockerfile.contains("FROM scratch AS cli-export")
            && preflight_dockerfile.contains("target/debug/nook-preflight /nook-preflight"),
        "the preflight reporter must share the tested Debian build graph and export as a stripped CI tool"
    );
    let preflight_tasks = read(root, "preflight/Taskfile.yml");
    assert!(
        preflight_tasks.contains("preflight:export:")
            && preflight_tasks.contains("--target cli-export"),
        "preflight must expose its reporter through an explicit export task"
    );
}

fn assert_artifact_backed_e2e_contract(root: &Path) -> anyhow::Result<()> {
    let pr = read(root, ".github/workflows/pr.yml");
    let ci_tasks = read(root, "nook-app/.task/ci.yml");
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
    let verify_job = section(&pr, "  verify:\n", "  coverage:\n");
    let coverage_job = section(&pr, "  coverage:\n", "  full-e2e:\n");
    let coverage_workflow = read(root, ".github/workflows/pr-coverage.yml");
    assert!(
        !verify_job.contains("Download Rust coverage handoff")
            && !verify_job.contains("Waiting for native coverage artifact")
            && coverage_job.contains("needs: rust")
            && coverage_job.contains("uses: ./.github/workflows/pr-coverage.yml")
            && coverage_workflow.contains("actions/download-artifact@v8")
            && coverage_workflow.contains("name: pr-rust-${{ github.run_id }}"),
        "Rust coverage must use a native-dependent artifact consumer instead of occupying the preview runner"
    );
    let wasm_handoff = section(
        &pr,
        "      - name: Wait for built WASM handoff\n",
        "      - name: Svelte checks, JS unit tests, lint, and preview build",
    );
    let wasm_job_lookup = wasm_handoff
        .find("wasm_job=\"$(")
        .context("PR workflow must resolve the WASM producer job")?;
    let artifact_lookup = wasm_handoff
        .find("actions/runs/$GITHUB_RUN_ID/artifacts")
        .context("PR workflow must resolve the WASM handoff artifact")?;
    assert!(
        wasm_job_lookup < artifact_lookup
            && wasm_handoff.contains("[ -z \"$wasm_job_id\" ]")
            && wasm_handoff.contains("nook-run-attempt")
            && wasm_handoff.contains("This failed-job rerun has no WASM producer"),
        "PR verification must consume only the current producer attempt and reuse prior output only when it is absent"
    );
    let deploy = section(
        &pr,
        "      - name: Deploy and verify Pages previews\n",
        "      - name: Comment preview URL on PR\n",
    );
    assert!(
        deploy.contains("id: deploy-all")
            && deploy.contains(">\"$deploy_dir/unified.log\" 2>&1 &")
            && deploy.contains(">\"$deploy_dir/site.log\" 2>&1 &")
            && deploy.contains(">\"$deploy_dir/simple.log\" 2>&1 &")
            && deploy.contains(">\"$deploy_dir/sentinel.log\" 2>&1 &")
            && deploy.contains("wait_for_deploy"),
        "independent Cloudflare preview uploads must run concurrently and all succeed before alias verification"
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
        "needs: [web, web-e2e]",
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
    let ci_tasks = read(root, "nook-app/.task/ci.yml");
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
    let cleanup = read(root, ".github/workflows/runner-cleanup.yml");
    assert!(
        cleanup.contains("--filter until=168h"),
        "runner cleanup must preserve the recent delivery cache"
    );
    Ok(())
}
