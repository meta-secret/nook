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
fn critical_architecture_rule_stays_wired_to_agent_guidance() -> anyhow::Result<()> {
    assert_eq!(AUTHORED_SOURCE_LINE_LIMIT, 1_000);
    let root = RepositoryFixture::repository_root();
    let agents = fs::read_to_string(root.join(".cortex/AGENTS.md"))?;
    let canonical =
        fs::read_to_string(root.join(".cortex/shared/dynamic-skills/source-file-size.md"))?;

    for (name, source) in [
        (".cortex/AGENTS.md", agents.as_str()),
        ("canonical source-size skill", canonical.as_str()),
    ] {
        assert!(
            source.contains("1,000"),
            "{name} must preserve the hard limit"
        );
        assert!(
            !source.contains("1,500"),
            "{name} must not preserve a larger Rust allowance"
        );
        assert!(
            source.contains("unit tests") && source.contains("integration tests"),
            "{name} must require unit-test colocation and preserve integration tests"
        );
        assert!(
            source.contains("domain") && source.contains("architectural"),
            "{name} must require domain or architectural decomposition"
        );
    }

    assert!(SOURCE_SIZE_REMEDIATION.contains("P1 hard source-size violation"));
    assert!(SOURCE_SIZE_REMEDIATION.contains("delivery remains blocked"));
    assert!(SOURCE_SIZE_REMEDIATION.contains("Review the oversized module"));
    assert!(SOURCE_SIZE_REMEDIATION.contains("Extracting tests alone is prohibited"));
    assert!(SOURCE_SIZE_REMEDIATION.contains("Arbitrary half-splits"));
    assert!(UNIT_TEST_COLOCATION_REMEDIATION.contains("unit tests must be inline"));
    assert!(UNIT_TEST_COLOCATION_REMEDIATION.contains("integration tests"));
    Ok(())
}

#[test]
fn source_architecture_gate_runs_for_every_pull_request_tree() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    let central_ci = fs::read_to_string(root.join(".github/workflows/ci.yml"))?;
    let workflow = fs::read_to_string(root.join(".github/workflows/repository-policy.yml"))?;
    let preflight_dockerfile = fs::read_to_string(root.join("preflight/Dockerfile"))?;
    let workflow_taskfile = fs::read_to_string(root.join(".task/ci-workflows.yml"))?;

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
    let policy_route = central_ci
        .split_once("\n  policy:\n")
        .and_then(|(_, remainder)| remainder.split_once("\n  pr:\n"))
        .map(|(route, _)| route)
        .ok_or_else(|| anyhow::anyhow!("central CI must define repository policy routing"))?;
    assert!(
        policy_route.contains("needs: scope")
            && policy_route.contains("uses: ./.github/workflows/repository-policy.yml")
            && !policy_route.contains("if:"),
        "central CI must call repository policy without a path or label condition"
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
    assert_dockerized_preflight_tools(&workflow, "repository-policy")?;
    assert!(
        preflight_dockerfile.contains("--test source_file_size"),
        "preflight:source-architecture must run the source_file_size test"
    );
    Ok(())
}

fn assert_dockerized_preflight_tools(workflow: &str, name: &str) -> anyhow::Result<()> {
    assert!(workflow.contains("uses: ./.github/actions/nook-docker-setup"));
    let buildkit = workflow
        .find("uses: docker/setup-buildx-action")
        .ok_or_else(|| anyhow::anyhow!("{name} must configure secret-free BuildKit"))?;
    let task = workflow
        .find("run: task ci:repository-policy:untrusted")
        .ok_or_else(|| anyhow::anyhow!("{name} must run the untrusted policy Task"))?;
    assert!(buildkit < task);
    for forbidden in ["dtolnay/rust-toolchain", "Swatinem/rust-cache"] {
        assert!(
            !workflow.contains(forbidden),
            "{name} must use Docker-owned Rust tooling"
        );
    }
    Ok(())
}
