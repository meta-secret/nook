use std::path::{Path, PathBuf};
use std::{env, fs, ops::Deref};

use nook_preflight::source_size::{
    AUTHORED_SOURCE_LINE_LIMIT, SOURCE_SIZE_REMEDIATION, SourceRepository,
    UNIT_TEST_COLOCATION_REMEDIATION,
};

struct RepositoryFixture {
    path: PathBuf,
}
impl RepositoryFixture {
    fn repository_root() -> Self {
        Self {
            path: env::var_os("NOOK_REPO_ROOT").map_or_else(
                || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
                PathBuf::from,
            ),
        }
    }
}

struct SourceArchitectureScenario {
    root: RepositoryFixture,
}

enum PrPolicyTask {
    Policy,
    PolicyWithDeliveryHelpers,
}

impl SourceArchitectureScenario {
    fn repository() -> Self {
        Self {
            root: RepositoryFixture::repository_root(),
        }
    }

    fn pr_policy_task_body(&self, task: PrPolicyTask) -> anyhow::Result<String> {
        let taskfile = fs::read_to_string(self.root.join("nook-app/ci/pr.yml"))?;
        let body = match task {
            PrPolicyTask::Policy => {
                taskfile
                    .split_once("  ci:pr:tests:policy:\n")
                    .and_then(|(_, tail)| {
                        tail.split_once("  ci:pr:tests:policy-with-delivery-helpers:\n")
                    })
            }
            PrPolicyTask::PolicyWithDeliveryHelpers => taskfile
                .split_once("  ci:pr:tests:policy-with-delivery-helpers:\n")
                .and_then(|(_, tail)| tail.split_once("  ci:pr:delivery-helpers:\n")),
        }
        .map(|(body, _)| body)
        .ok_or_else(|| anyhow::anyhow!("PR policy tasks must retain their section boundaries"))?;
        Ok(body.to_owned())
    }

    fn assert_source_architecture_gate(&self) -> anyhow::Result<()> {
        let root = &self.root;
        let central_ci = fs::read_to_string(root.join(".github/workflows/ci.yml"))?;
        let workflow = fs::read_to_string(root.join(".github/workflows/repository-policy.yml"))?;
        let pr_workflow = fs::read_to_string(root.join(".github/workflows/pr.yml"))?;
        let preflight_dockerfile = fs::read_to_string(root.join("preflight/Dockerfile"))?;
        let workflow_taskfile = fs::read_to_string(root.join(".task/ci-workflows.yml"))?;
        let pr_taskfile = fs::read_to_string(root.join("nook-app/ci/pr.yml"))?;

        assert!(
            !root
                .join(".github/workflows/source-architecture.yml")
                .exists()
                && !root.join(".github/workflows/loom.yml").exists(),
            "repository policy must remain the single automatic policy workflow"
        );
        let pull_request_trigger = central_ci
            .split_once("  pull_request:\n")
            .and_then(|(_, remainder)| remainder.split_once("  push:\n"))
            .map(|(trigger, _)| trigger)
            .ok_or_else(|| anyhow::anyhow!("central CI must define PR before push triggers"))?;
        assert!(
            pull_request_trigger.contains("opened")
                && pull_request_trigger.contains("synchronize")
                && pull_request_trigger.contains("reopened")
                && !pull_request_trigger.contains("paths:")
                && !pull_request_trigger.contains("paths-ignore:")
                && central_ci.contains(
                    "contains(fromJSON('[\"opened\",\"synchronize\",\"reopened\"]'), github.event.action)",
                ),
            "central CI must route every authored PR tree to repository policy"
        );
        let pr_route = central_ci
            .split_once("\n  pr:\n")
            .and_then(|(_, remainder)| remainder.split_once("\n  main:\n"))
            .map(|(route, _)| route)
            .ok_or_else(|| anyhow::anyhow!("central CI must define consolidated PR routing"))?;
        assert!(
            pr_route.contains("uses: ./.github/workflows/pr.yml")
                && !pr_route.contains("paths:")
                && !pr_route.contains("paths-ignore:")
                && pr_workflow.contains("VALIDATION_REQUESTED: ${{ inputs.validation_requested }}")
                && pr_workflow.contains("*) validation=true ;;")
                && pr_workflow.contains("if: needs.scope.outputs.validation == 'true'")
                && pr_workflow.contains("run: task --silent ci:pr:verification:tooling\n")
                && pr_workflow.contains("run: task --silent ci:pr:verification\n")
                && pr_workflow
                    .contains("run: task --silent ci:pr:tests:policy-with-delivery-helpers\n")
                && pr_taskfile.contains("ci:pr:verification:tooling:")
                && pr_taskfile.contains("task: preflight:policy:run")
                && pr_taskfile.contains("ci:pr:tests:policy:"),
            "every consolidated PR route must execute repository policy in both product and policy-only paths"
        );
        let policy_only = self.pr_policy_task_body(PrPolicyTask::PolicyWithDeliveryHelpers)?;
        assert!(
            policy_only.contains("task --parallel ci:pr:tests:policy ci:pr:delivery-helpers")
                && self.pr_policy_task_body(PrPolicyTask::Policy)?.contains(
                    "task --taskfile \"{{.REPO_ROOT}}/Taskfile.yml\" preflight:repository-policy",
                ),
            "policy-only PR tests must delegate to the policy dependency and delivery helpers"
        );
        assert!(workflow.contains("workflow_call:"));
        assert!(
            workflow.contains("fetch-depth: 0")
                && !workflow.contains("BASELINE_SHA")
                && !workflow.contains("git diff")
                && !workflow.contains("policy-paths"),
            "repository policy must fetch identifier history while validating the full tree without inline base comparison or path classification"
        );
        assert!(
            workflow.contains("github.event.pull_request.head.repo.full_name != github.repository")
                && workflow.contains("run: task ci:repository-policy:untrusted")
                && workflow_taskfile.contains("task: preflight:repository-policy-untrusted"),
            "repository policy must route untrusted PR source architecture through Taskfile"
        );
        self.assert_dockerized_preflight_tools()?;
        assert!(
            preflight_dockerfile.contains("--test source_file_size"),
            "preflight:source-architecture must run the source_file_size test"
        );
        Ok(())
    }

    fn assert_dockerized_preflight_tools(&self) -> anyhow::Result<()> {
        let workflow =
            fs::read_to_string(self.root.join(".github/workflows/repository-policy.yml"))?;
        assert!(workflow.contains("uses: ./.github/actions/nook-docker-setup"));
        let buildkit = workflow
            .find("uses: docker/setup-buildx-action")
            .ok_or_else(|| {
                anyhow::anyhow!("repository-policy must configure secret-free BuildKit")
            })?;
        let task = workflow
            .find("run: task ci:repository-policy:untrusted")
            .ok_or_else(|| {
                anyhow::anyhow!("repository-policy must run the untrusted policy Task")
            })?;
        assert!(buildkit < task);
        for forbidden in ["dtolnay/rust-toolchain", "Swatinem/rust-cache"] {
            assert!(
                !workflow.contains(forbidden),
                "repository-policy must use Docker-owned Rust tooling"
            );
        }
        Ok(())
    }
}

impl Deref for RepositoryFixture {
    type Target = PathBuf;
    fn deref(&self) -> &PathBuf {
        &self.path
    }
}
impl AsRef<Path> for RepositoryFixture {
    fn as_ref(&self) -> &Path {
        &self.path
    }
}

#[test]
fn authored_source_files_stay_within_hard_limits() -> anyhow::Result<()> {
    assert_eq!(AUTHORED_SOURCE_LINE_LIMIT, 1_000);
    let violations =
        SourceRepository::new(&RepositoryFixture::repository_root()).source_size_violations()?;
    assert!(
        violations.is_empty(),
        "{SOURCE_SIZE_REMEDIATION}\n{violations:#?}"
    );
    Ok(())
}

#[test]
fn rust_unit_tests_stay_with_their_focused_implementation() -> anyhow::Result<()> {
    let violations = SourceRepository::new(&RepositoryFixture::repository_root())
        .external_rust_unit_test_modules()?;
    assert!(
        violations.is_empty(),
        "{UNIT_TEST_COLOCATION_REMEDIATION}\n{violations:#?}"
    );
    Ok(())
}

#[test]
fn source_architecture_gate_runs_for_every_pull_request_tree() -> anyhow::Result<()> {
    SourceArchitectureScenario::repository().assert_source_architecture_gate()
}
