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
        let verification = pr
            .find("run: task --silent ci:pr:verification\n")
            .context("missing verification")?;
        let tests = pr
            .find("run: task --silent ci:pr:tests\n")
            .context("missing tests")?;
        let heavy = pr
            .find("run: task --silent ci:pr:heavy\n")
            .context("missing heavy phase")?;
        assert!(verification < tests && tests < heavy);
        assert!(bake.contains("web-artifacts = \"target:pr-wasm-artifacts\""));
        assert!(bake.contains("output = [\"type=cacheonly\"]"));
        assert!(tasks.contains("coverage-export.output=type=local"));
        assert!(tasks.contains("pr-browser-artifacts.output=type=local"));
        assert!(tasks.contains(
            "test -e '{{.REPO_ROOT}}/nook-app/nook-web/node_modules' || ln -s nook-web-app/node_modules '{{.REPO_ROOT}}/nook-app/nook-web/node_modules'",
        ));
        assert!(tasks.contains(
            "'{{.REPO_ROOT}}/nook-app/nook-web/nook-web-app/node_modules/playwright-core/browsers.json'",
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
