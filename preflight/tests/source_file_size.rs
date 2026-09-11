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
    let workflow = fs::read_to_string(root.join(".github/workflows/repository-policy.yml"))?;
    let preflight_taskfile = fs::read_to_string(root.join("preflight/Taskfile.yml"))?;
    let workflow_taskfile = fs::read_to_string(root.join(".task/ci-workflows.yml"))?;

    assert!(
        !root
            .join(".github/workflows/source-architecture.yml")
            .exists()
            && !root.join(".github/workflows/loom.yml").exists(),
        "repository policy must remain the single automatic policy workflow"
    );
    assert!(workflow.contains("pull_request:"));
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
            && workflow_taskfile.contains("task: preflight:source-architecture"),
        "repository policy must route untrusted PR source architecture through Taskfile"
    );
    assert_hosted_preflight_rust_cache(&workflow, "repository-policy")?;
    assert!(
        preflight_taskfile.contains("--test source_file_size"),
        "preflight:source-architecture must run the source_file_size test"
    );
    Ok(())
}

fn assert_hosted_preflight_rust_cache(workflow: &str, name: &str) -> anyhow::Result<()> {
    assert!(
        workflow.contains(
            "      - name: Install Rust for repository policy\n        uses: dtolnay/rust-toolchain@stable"
        ),
        "{name} must provision Rust and rustfmt for trusted and untrusted policy paths"
    );
    let toolchain = workflow
        .find("uses: dtolnay/rust-toolchain@stable")
        .ok_or_else(|| anyhow::anyhow!("{name} must install the pinned stable Rust channel"))?;
    let cache = workflow
        .find("uses: Swatinem/rust-cache@v2")
        .ok_or_else(|| anyhow::anyhow!("{name} must restore its hosted Rust dependency cache"))?;
    let first_preflight_task = workflow
        .find("run: task ci:repository-policy:untrusted")
        .ok_or_else(|| anyhow::anyhow!("{name} must run the untrusted policy Task"))?;

    assert!(
        toolchain < cache && cache < first_preflight_task,
        "{name} must restore Rust dependencies after toolchain setup and before Cargo work"
    );
    for marker in [
        "shared-key: pr-preflight",
        "workspaces: preflight -> target",
    ] {
        assert!(
            workflow.contains(marker),
            "{name} Rust cache is missing `{marker}`"
        );
    }
    Ok(())
}
