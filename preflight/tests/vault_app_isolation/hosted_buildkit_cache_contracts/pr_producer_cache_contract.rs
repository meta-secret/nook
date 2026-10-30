use std::path::Path;

use anyhow::Context;

use super::*;

pub(super) struct PrProducerCacheContract<'a> {
    root: &'a Path,
}

impl<'a> PrProducerCacheContract<'a> {
    pub(super) fn new(root: &'a Path) -> Self {
        Self { root }
    }

    pub(super) fn assert_contract(&self) -> anyhow::Result<()> {
        let pr = self.root.read(".github/workflows/pr.yml");
        let bake = self.root.read("nook-app/ci/pr.docker-bake.hcl");
        let tasks = self.root.read("nook-app/ci/pr.yml");
        assert_eq!(pr.matches("    runs-on:").count(), 5);
        assert_eq!(pr.matches("Connect trusted persistent BuildKit").count(), 2);
        for marker in [
            "GHA_CACHE_ENABLED=",
            "GHA_CACHE_WRITE_ENABLED=",
            "NOOK_REGISTRY_CACHE_LOCAL_PUBLISH=0",
        ] {
            assert_eq!(
                pr.matches(marker).count(),
                2,
                "PR cache transfers must be disabled: {marker}"
            );
        }
        for forbidden in [
            "type=registry",
            "nook-pr-rust:",
            "nook-pr-e2e:",
            "uses: ./.github/workflows/",
        ] {
            assert!(
                !pr.contains(forbidden),
                "PR browser fanout must retain read-only BuildKit: {forbidden}"
            );
        }
        assert!(pr.contains("needs: [scope, prepare, verify, browser]"));
        assert!(pr.contains("if: ${{ always() }}"));
        assert!(pr.contains("fail-fast: false"));
        assert!(pr.contains("suite: ${{ fromJSON(inputs.full_e2e_requested && '[\"web\",\"extension-1\",\"extension-2\",\"extension-3\"]' || '[\"web\"]') }}"));
        assert!(pr.contains("needs.scope.outputs.validation == 'true' && (inputs.full_e2e_requested || needs.scope.outputs.research == 'true')"));
        assert!(pr.contains("if: matrix.suite == 'web' && needs.scope.outputs.research == 'true'"));
        assert!(pr.contains("timeout-minutes: 10\n        run: task --silent web:research:e2e"));
        assert!(tasks.contains("if [ \"${PR_BROWSER_JOBS:-false}\" = true ]; then\n            task --silent web:research:source\n          else\n            task --silent web:research:verify"));
        assert!(pr.contains("pr-browser-${{ github.run_id }}-${{ github.run_attempt }}"));
        assert_eq!(
            pr.matches("name: ${{ needs.prepare.outputs.browser_artifact }}")
                .count(),
            2,
            "rerun consumers must use the successful producer's artifact identity"
        );
        assert!(pr.contains("test \"$SCOPE_RESULT\" = success"));
        assert!(pr.contains("test \"$VERIFY_RESULT\" = success"));
        assert!(pr.contains("test \"$PREPARE_RESULT\" = skipped"));
        assert!(pr.contains("test \"$PREPARE_RESULT\" = success"));
        assert!(pr.contains("test \"$BROWSER_RESULT\" = success"));
        assert!(pr.contains("test \"$BROWSER_RESULT\" = skipped"));
        let validation = pr
            .find("run: task --silent ci:pr:verification\n")
            .context("missing validation join")?;
        let publish = pr
            .find("uses: ./.github/actions/nook-pr-preview")
            .context("missing preview")?;
        assert!(validation < publish);
        let join = tasks
            .split_once("  ci:pr:validate:\n")
            .and_then(|(_, rest)| rest.split_once("\n  ci:pr:checks:"))
            .map(|(task, _)| task)
            .context("missing validation join task")?;
        for branch in [
            "ci:pr:verification:format",
            "ci:pr:verification:tooling",
            "docker:ecosystem:dependency-policy",
            "ci:pr:checks",
            "ci:pr:tests:policy",
            "ci:pr:delivery-helpers",
            "ci:pr:browser",
        ] {
            assert!(join.contains(&format!("      - {branch}\n")));
        }
        assert!(join.contains("deps:"));
        assert!(!join.contains("cmds:"));
        assert!(bake.contains("web-artifacts = \"target:pr-wasm-artifacts\""));
        assert!(bake.contains("output = [\"type=cacheonly\"]"));
        for target in [
            "pr-rust-verify",
            "pr-web-verification",
            "rust-dylint",
            "coverage-export",
            "builder-wasm",
            "pr-web-tests",
            "rust-ecosystem-deterministic",
            "rust-fuzz-smoke",
            "rust-kani",
        ] {
            assert!(bake.contains(&format!("\"{target}\"")));
        }
        let web = self.root.read("nook-app/nook-web/nook-web-app/Dockerfile");
        assert!(web.contains("FROM nook-web-source AS pr-web-tests"));
        assert!(!web.contains("FROM pr-web-verification AS pr-web-tests"));
        assert!(tasks.contains("coverage-export.output=type=cacheonly"));
        assert!(tasks.contains("pr-browser-artifacts.output=type=tar"));
        assert!(tasks.contains("tar -xf '{{.PR_ARTIFACT_DIR}}/browser.tar'"));
        assert!(tasks.contains(
            "test -e '{{.PR_ARTIFACT_DIR}}/runtime/nook-app/nook-web/node_modules' || ln -s nook-web-app/node_modules '{{.PR_ARTIFACT_DIR}}/runtime/nook-app/nook-web/node_modules'",
        ));
        assert!(tasks.contains(
            "'{{.PR_ARTIFACT_DIR}}/runtime/nook-app/nook-web/nook-web-app/node_modules/playwright-core/browsers.json'",
        ));
        let product = self
            .root
            .read("nook-app/nook-platform/docker/rust/base/Dockerfile");
        let (wasm_dependencies, _) = product
            .split_once("FROM platform-manifests AS builder-wasm-deps")
            .and_then(|(_, tail)| tail.split_once("FROM platform-manifests AS builder-core-deps"))
            .context("WASM build dependencies must be separate from native test dependencies")?;
        assert!(!wasm_dependencies.contains("cargo build --tests"));
        assert!(wasm_dependencies.contains(
            "cargo build --locked --release --target wasm32-unknown-unknown --workspace"
        ));
        assert!(wasm_dependencies.contains(
            "cargo clippy --locked --release --target wasm32-unknown-unknown --workspace"
        ));
        assert!(product.contains("FROM platform-manifests AS pr-rust-dependencies"));
        let proof = self.root.read("infra/tasks/pr-cache.yml");
        assert!(proof.contains("bake-cache:prove-pr:"));
        assert!(proof.contains("for temperature in cold warm"));
        assert!(proof.contains("for failure in verification tests"));
        Ok(())
    }
}
