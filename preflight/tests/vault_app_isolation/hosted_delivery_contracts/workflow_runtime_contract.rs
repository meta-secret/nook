use std::path::Path;

use super::*;

pub(super) struct WorkflowRuntimeContract<'a> {
    pub(super) root: &'a Path,
}

impl WorkflowRuntimeContract<'_> {
    pub(super) fn assert_contract(&self) {
        let root = self.root;
        for workflow in [
            ".github/workflows/pr.yml",
            ".github/workflows/main.yml",
            ".github/workflows/release.yml",
        ] {
            let content = root.read(workflow);
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
        let pr = root.read(".github/workflows/pr.yml");
        let main = root.read(".github/workflows/main.yml");
        let release = root.read(".github/workflows/release.yml");
        let ecosystem = root.read(".github/workflows/rust-ecosystem-checks.yml");
        let ecosystem_entry = root.read(".github/workflows/ci.yml");
        assert!(
            pr.contains("(vars.NOOK_RUNS_ON || 'nook-k0s') || 'ubuntu-latest'")
                && release.contains("runs-on: ${{ vars.NOOK_RUNS_ON || 'nook-k0s' }}")
                && release.contains("runs-on: nook-k0s-container")
                && pr
                    .matches("github.event.pull_request.head.repo.full_name == github.repository")
                    .count()
                    >= 3
                && ecosystem
                    .lines()
                    .filter(|line| line.trim_start().starts_with("runs-on:")
                        && line.contains(
                            "github.event.pull_request.head.repo.full_name == github.repository"
                        )
                        && line
                            .contains("github.event.pull_request.user.login != 'dependabot[bot]'")
                        && line.contains("(vars.NOOK_RUNS_ON || 'nook-k0s') || 'ubuntu-latest'"))
                    .count()
                    == 3
                && ecosystem.matches("github.event_name == 'schedule'").count() == 3
                && ecosystem
                    .matches("github.event_name == 'workflow_dispatch'")
                    .count()
                    == 3
                && ecosystem_entry.contains("github.event_name == 'schedule'")
                && ecosystem_entry.contains("github.event_name == 'workflow_dispatch'")
                && ecosystem_entry.contains("uses: ./.github/workflows/rust-ecosystem-checks.yml"),
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
        self.assert_untrusted_boundaries();
    }

    fn assert_untrusted_boundaries(&self) {
        let root = self.root;
        for workflow in [
            ".github/workflows/repository-policy.yml",
            ".github/workflows/hive.yml",
            ".github/workflows/web-research.yml",
        ] {
            let source = root.read(workflow);
            assert!(
                source.contains(
                    "isolated-cache-write: ${{ github.event_name == 'pull_request' && 'true' || 'false' }}",
                ) && !source.contains("isolated-cache-write: \"true\""),
                "{workflow} must not request PR-isolated cache writes for push or input-free manual events"
            );
        }
        let hive = root.read(".github/workflows/hive.yml");
        let research = root.read(".github/workflows/web-research.yml");
        let repository_policy = root.read(".github/workflows/repository-policy.yml");
        for (workflow, source) in [
            ("Hive", &hive),
            ("web research", &research),
            ("repository policy", &repository_policy),
        ] {
            assert!(
                source.contains("github.event.pull_request.user.login != 'dependabot[bot]'")
                    || source.contains("github.event.pull_request.user.login == 'dependabot[bot]'"),
                "{workflow} must preserve the Dependabot trust boundary"
            );
        }
        assert!(
            research.contains("validate-untrusted:")
                && research.contains("runs-on: ubuntu-latest")
                && research.contains("github.event.pull_request.user.login == 'dependabot[bot]'")
                && research.contains("task web:research:verify")
                && research.contains("without deployment credentials"),
            "untrusted research PRs must retain secret-free hosted validation"
        );
        let research_publish = research
            .split("      - name: Publish verified research web dependency cache\n")
            .nth(1)
            .unwrap_or("");
        let research_image = research
            .split("  image:\n")
            .nth(1)
            .and_then(|section| section.split("\n  deploy:\n").next())
            .unwrap_or("");
        assert!(
            research.contains("registry-username: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && secrets.NOOK_REGISTRY_USERNAME || secrets.NOOK_REGISTRY_REMOTE_USERNAME }}")
                && research.contains("registry-password: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && secrets.NOOK_REGISTRY_PASSWORD || secrets.NOOK_REGISTRY_REMOTE_PASSWORD }}")
                && research.contains("cache-write: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && 'true' || 'false' }}")
                && research.contains("main-cache-only: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && 'false' || 'true' }}")
                && research.contains("task web:e2e:kubernetes-image")
                && research_publish.contains("task ci:main:publish-web-cache")
                && research_publish.contains("GHA_CACHE_WRITE_ENABLED: \"1\"")
                && research_publish.contains("success() &&")
                && research_publish.contains("github.event_name == 'push' && github.ref == 'refs/heads/main'")
                && research_publish
                    .contains("github.event.pull_request.head.repo.full_name == github.repository")
                && research_publish
                    .contains("github.event.pull_request.user.login != 'dependabot[bot]'")
                && research_publish.contains("NOOK_ARC_RUNNER")
                && research_publish.contains("ARC keeps the verified research web graph local")
                && research_image.contains(
                    "ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}",
                )
                && research_image.contains("fetch-depth: 0")
                && research.contains("same-repository PRs retain the remote identity")
                && !research.contains("registry-username: ${{ secrets.NOOK_REGISTRY_USERNAME }}")
                && !research.contains("registry-password: ${{ secrets.NOOK_REGISTRY_PASSWORD }}"),
            "trusted Main and hosted PR research jobs must publish only authorized web cache scopes"
        );
        assert!(
            hive.contains("console-untrusted:")
                && hive.contains("name: Validate untrusted Hive Control Center source")
                && hive.contains("runs-on: ubuntu-latest")
                && hive
                    .contains("github.event.pull_request.head.repo.full_name != github.repository")
                && hive.contains("github.event.pull_request.user.login == 'dependabot[bot]'")
                && hive.contains("run: task hive:console:verify")
                && hive.contains("without private credentials"),
            "untrusted Hive console PRs must retain complete secret-free hosted validation"
        );
    }
}
