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
        for marker in [
            "Publish git-scoped native BuildKit cache",
            "Publish git-scoped WASM BuildKit cache",
            "Publish git-scoped web BuildKit cache",
            "task ci:main:publish-native-cache",
            "task ci:main:publish-wasm-cache",
            "task ci:main:publish-web-cache",
        ] {
            assert!(
                pr.contains(marker),
                "PR producers must publish warm local layers after verify: missing {marker}"
            );
        }
        let steps = PrProducerSteps::read(&pr)?;
        let ui_demo = section(&pr, "  ui-demo:\n", "\n  preview:\n");
        let full_e2e = section(&pr, "  full-e2e-shard:\n", "\n  full-e2e:\n");
        let browser_contract = PrBrowserContract { ui_demo, full_e2e };
        assert!(
            steps.cache_contract(&pr)? && browser_contract.is_satisfied()?,
            "PR producers must verify read-only, keep ARC graphs local, and hand exact browser images to container ARC consumers"
        );
        Ok(())
    }
}

struct PrProducerSteps {
    rust_verify: usize,
    rust_publish: usize,
    wasm_verify: usize,
    wasm_publish: usize,
    web_verify: usize,
    web_publish: usize,
}

impl PrProducerSteps {
    fn read(pr: &str) -> anyhow::Result<Self> {
        Ok(Self {
            rust_verify: pr
                .find("task ci:pr:rust")
                .context("PR Rust job must verify")?,
            rust_publish: pr
                .find("task ci:main:publish-native-cache")
                .context("PR Rust job must publish its cache")?,
            wasm_verify: pr
                .find("task ci:pr:wasm")
                .context("PR WASM job must verify")?,
            wasm_publish: pr
                .find("task ci:main:publish-wasm-cache")
                .context("PR WASM job must publish its cache")?,
            web_verify: pr
                .find("task ci:pr:web")
                .context("PR web job must verify")?,
            web_publish: pr
                .find("task ci:main:publish-web-cache")
                .context("PR web job must publish its cache")?,
        })
    }

    fn cache_contract(&self, pr: &str) -> anyhow::Result<bool> {
        Ok(self.rust_verify < self.rust_publish
            && pr
                .get(self.rust_verify..self.rust_publish)
                .context("PR Rust verification-to-publication section must have valid boundaries")?
                .contains("GHA_CACHE_WRITE_ENABLED=\"\"")
            && pr
                .get(..self.rust_publish)
                .context("PR Rust pre-publication section must have a valid boundary")?
                .contains(
                    "ARC keeps the verified native graph local; Main and sccache remain reusable",
                )
            && pr
                .get(self.rust_publish..)
                .context("PR Rust publication section must have a valid boundary")?
                .contains("GHA_CACHE_WRITE_ENABLED: \"1\"")
            && self.wasm_verify < self.wasm_publish
            && pr
                .get(self.wasm_verify..self.wasm_publish)
                .context("PR WASM verification-to-publication section must have valid boundaries")?
                .contains("GHA_CACHE_WRITE_ENABLED: \"\"")
            && pr
                .get(..self.wasm_publish)
                .context("PR WASM pre-publication section must have a valid boundary")?
                .contains(
                    "ARC keeps the verified WASM graph local; Main and sccache remain reusable",
                )
            && pr
                .get(self.wasm_publish..)
                .context("PR WASM publication section must have a valid boundary")?
                .contains("GHA_CACHE_WRITE_ENABLED: \"1\"")
            && self.web_verify < self.web_publish
            && pr
                .get(self.web_verify..self.web_publish)
                .context("PR web verification-to-publication section must have valid boundaries")?
                .contains("GHA_CACHE_WRITE_ENABLED: \"\"")
            && pr
                .get(..self.web_publish)
                .context("PR web pre-publication section must have a valid boundary")?
                .contains("ARC keeps the verified web graph local; Main remains reusable")
            && pr
                .get(self.web_publish..)
                .context("PR web publication section must have a valid boundary")?
                .contains("GHA_CACHE_WRITE_ENABLED: \"1\""))
    }
}

struct PrBrowserContract<'a> {
    ui_demo: &'a str,
    full_e2e: &'a str,
}

impl PrBrowserContract<'_> {
    fn is_satisfied(&self) -> anyhow::Result<bool> {
        let ui_demo_verify = self
            .ui_demo
            .find("task _web:test:ui-demo")
            .context("PR UI demo job must verify")?;
        let full_e2e_verify = self
            .full_e2e
            .find("task _ci:main:web:e2e-only")
            .context("each PR full-e2e shard must verify its browser half")?;
        Ok(self.ui_demo.contains("runs-on: nook-k0s-container")
            && self
                .ui_demo
                .contains("nook-pr-e2e:run-${{ github.run_id }}-${{ github.run_attempt }}")
            && self
                .ui_demo
                .get(..ui_demo_verify)
                .context("PR UI demo pre-verification section must have a valid boundary")?
                .contains("needs.verify.outputs.ui-demo-required == 'true'")
            && !self.ui_demo.contains("nook-docker-setup")
            && !self.ui_demo.contains("publish-web-e2e-cache")
            && self
                .full_e2e
                .get(..full_e2e_verify)
                .context("PR full E2E pre-verification section must have a valid boundary")?
                .contains("runs-on: nook-k0s-container")
            && self
                .full_e2e
                .contains("nook-pr-e2e:run-${{ github.run_id }}-${{ github.run_attempt }}")
            && self
                .full_e2e
                .contains("NOOK_E2E_SHARD: ${{ matrix.shard }}/2")
            && !self.full_e2e.contains("task ci:main:publish-web-e2e-cache"))
    }
}
