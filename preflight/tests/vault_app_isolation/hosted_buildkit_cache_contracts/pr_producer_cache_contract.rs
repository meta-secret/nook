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
        assert_eq!(pr.matches("    runs-on:").count(), 1);
        for marker in [
            "GHA_CACHE_ENABLED=",
            "GHA_CACHE_WRITE_ENABLED=",
            "NOOK_REGISTRY_CACHE_LOCAL_PUBLISH=0",
        ] {
            assert!(
                pr.contains(marker),
                "PR cache transfers must be disabled: {marker}"
            );
        }
        for forbidden in [
            "type=registry",
            "nook-pr-rust:",
            "nook-pr-e2e:",
            "actions/download-artifact",
            "uses: ./.github/workflows/",
        ] {
            assert!(
                !pr.contains(forbidden),
                "PR steps must not introduce a cross-job handoff: {forbidden}"
            );
        }
        let validation = pr
            .find("run: task --silent ci:pr:validate\n")
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
        let wasm_dependencies = product
            .split_once("FROM chef-deps AS builder-wasm-deps")
            .and_then(|(_, tail)| tail.split_once("FROM builder-wasm-deps AS builder-core-deps"))
            .context("WASM build dependencies must be separate from native test dependencies")?
            .0;
        assert!(!wasm_dependencies.contains("cargo build --tests"));
        let proof = self.root.read("infra/tasks/pr-cache.yml");
        assert!(proof.contains("bake-cache:prove-pr:"));
        assert!(proof.contains("for temperature in cold warm"));
        assert!(proof.contains("for failure in verification tests"));
        Ok(())
    }
}
