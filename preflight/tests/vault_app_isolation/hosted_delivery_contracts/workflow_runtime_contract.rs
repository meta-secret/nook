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
