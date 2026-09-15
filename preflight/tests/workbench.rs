#![allow(clippy::unnecessary_wraps)]

#[path = "workbench/harness_neutral.rs"]
mod harness_neutral;

use std::{
    env, fs,
    ops::Deref,
    path::{Path, PathBuf},
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

impl RepositoryFixture {
    fn read(&self, path: &str) -> String {
        fs::read_to_string(self.join(path))
            .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
    }
}

fn directory_has_files(path: &Path) -> bool {
    fs::read_dir(path).is_ok_and(|entries| {
        entries.filter_map(Result::ok).any(|entry| {
            let path = entry.path();
            path.is_file() || (path.is_dir() && directory_has_files(&path))
        })
    })
}

#[test]
fn agents_mutate_only_their_owned_feature_and_issue_set() -> anyhow::Result<()> {
    let agent_map = RepositoryFixture::repository_root().read(".cortex/AGENTS.md");
    let coding_workflow =
        RepositoryFixture::repository_root().read(".cortex/gizmo/workflows/mission-delivery.md");
    let issue_workflow =
        RepositoryFixture::repository_root().read(".cortex/gizmo/workflows/issues.md");
    let pull_request_workflow =
        RepositoryFixture::repository_root().read(".cortex/gizmo/workflows/pull-requests.md");
    let ownership_skill = RepositoryFixture::repository_root()
        .read(".cortex/gizmo/dynamic-skills/agent-feature-ownership.md");
    let normalized_agent_map = agent_map.split_whitespace().collect::<Vec<_>>().join(" ");
    let normalized_coding_workflow = coding_workflow
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    assert!(
        agent_map.contains("gizmo/dynamic-skills/agent-feature-ownership.md")
            && normalized_agent_map.contains("Another active agent's work is read-only"),
        "root routing must preserve the universal ownership boundary and link its authority"
    );

    for required in [
        "Treat every other active task as read-only",
        "explicit parent feature/integration worktree",
        "one child worktree per Team Agent task from the parent frontier",
        "bounded task/attempt identity",
        "committed handoff before parent integration",
        "parent-owned integration/PR policy",
        "Preserve dependency order",
        "Grant one commit turn at a time",
        "Team Agent lifecycle service, scheduler, or Git-state machinery",
        "persistent PR Steward service, scheduler, or notification journal",
    ] {
        assert!(
            normalized_coding_workflow.contains(required),
            "coding workflow is missing ownership guard: {required}"
        );
    }

    assert!(
        issue_workflow.contains("Related scope does not transfer ownership")
            && issue_workflow.contains("mutate another active task's branch")
            && issue_workflow.contains("trigger another active task's checks")
            && issue_workflow.contains("change another active task's merge state"),
        "Workbench issue guidance must protect active task ownership"
    );
    assert!(
        pull_request_workflow
            .contains("Another active task's branch and pull request are read-only")
            && pull_request_workflow.contains("explicit handoff."),
        "pull-request workflow must reject foreign task mutation"
    );
    assert!(
        ownership_skill.contains("replying to or resolving its review threads")
            && ownership_skill.contains("closing, reopening, or merging its pull request")
            && ownership_skill.contains("Recheck ownership before every remote mutation")
            && ownership_skill.contains("prompt-backed run requires the `continuing_owner`"),
        "agent feature ownership skill must cover PR and review mutations"
    );
    Ok(())
}

#[test]
fn pr_workbench_suite_loads_sequential_contract_tests() {
    let pr_workflow = RepositoryFixture::repository_root().read(".github/workflows/pr.yml");
    let pr_suite =
        RepositoryFixture::repository_root().read(".github/scripts/workbench-records.test.cjs");
    let mapping_suite = RepositoryFixture::repository_root()
        .read(".github/scripts/workbench-gizmo-mapping.test.cjs");

    assert!(
        pr_workflow.contains("node --test .github/scripts/workbench-records.test.cjs"),
        "PR CI must invoke the Workbench record suite"
    );
    assert!(
        pr_suite.contains("require('./workbench-gizmo-mapping.test.cjs')"),
        "the PR-invoked Workbench suite must load Gizmo mapping tests"
    );
    assert!(
        pr_suite.contains("require('./workbench-publish.test.cjs')"),
        "the PR-invoked Workbench suite must load publisher tests"
    );
    assert!(
        mapping_suite.contains("accepts a strictly sequential multi-PR feature plan")
            && mapping_suite.contains("['Multiple PRs', 'Stacked PRs']")
            && mapping_suite.contains("immediately preceding Gizmo ID"),
        "the transitively loaded suite must enforce sequential Gizmo mapping"
    );
}

#[test]
fn cortex_promotions_use_optional_curated_session_memory() -> anyhow::Result<()> {
    let gitignore = RepositoryFixture::repository_root().read(".gitignore");
    let agent_map = RepositoryFixture::repository_root().read(".cortex/AGENTS.md");
    let coding_workflow =
        RepositoryFixture::repository_root().read(".cortex/gizmo/workflows/mission-delivery.md");
    let pull_request_workflow =
        RepositoryFixture::repository_root().read(".cortex/gizmo/workflows/pull-requests.md");
    let self_improvement = RepositoryFixture::repository_root()
        .read(".cortex/teams/ai/dynamic-skills/self-improvement.md");
    let agent_tasks = RepositoryFixture::repository_root().read(".task/agentic-ai.yml");
    let readiness_guard = RepositoryFixture::repository_root()
        .read("agentic-ai/loom/src/commands/cortex-session-clean.ts");

    assert!(
        gitignore.lines().any(|line| line == ".cortex/.session/"),
        "temporary Cortex session memory must remain ignored"
    );
    assert!(
        agent_map.contains("dynamic-skills/self-improvement.md")
            && coding_workflow.contains("dynamic-skills/self-improvement.md")
            && pull_request_workflow.contains("dynamic-skills/self-improvement.md"),
        "delivery entry points must link the canonical self-improvement skill"
    );
    assert!(
        pull_request_workflow.contains("self-improvement review")
            && pull_request_workflow.contains("No promotion is required"),
        "pull-request readiness must make evidence-backed promotion conditional"
    );
    for required in [
        "## Knowledge classification",
        "## Self-improvement review",
        "## Promotion criteria",
        "## Evidence and consistency",
        "No Cortex update is a valid outcome",
        "## Protocol evolution safety",
        "## Workflow improvement review",
        "### Instruction classification",
        "### Loom extraction procedure",
        "task loom:cortex-session-clean",
        "## Pull-request completion contract",
    ] {
        assert!(
            self_improvement.contains(required),
            "self-improvement skill is missing: {required}"
        );
    }
    assert!(self_improvement.contains("A session file is optional"));
    assert!(self_improvement.contains("No Cortex update is a valid outcome"));
    assert!(
        agent_tasks
            .matches("- task loom:cortex-session-clean")
            .count()
            == 1
            && readiness_guard
                .contains("PR readiness requires removing temporary Cortex session memory")
            && !RepositoryFixture::repository_root()
                .join(".github/scripts/assert-cortex-session-clean.sh")
                .exists(),
        "PR readiness must reject leftover temporary session memory"
    );
    Ok(())
}

#[test]
fn statistics_leave_the_product_repository() -> anyhow::Result<()> {
    let collector =
        RepositoryFixture::repository_root().read(".github/workflows/main-build-stats.yml");
    let publisher =
        RepositoryFixture::repository_root().read(".github/scripts/workbench-publish.cjs");

    for required in [
        "repository: meta-secret/nook-workbench",
        "workbench/stats/main-build/",
        "git -C workbench push origin HEAD:main",
    ] {
        assert!(
            collector.contains(required),
            "Main statistics collector is missing: {required}"
        );
    }
    assert!(
        !collector.contains("gh pr create")
            && !collector.contains("gh pr merge")
            && !collector.contains(".stats/"),
        "Main statistics must not create Nook bookkeeping PRs or files"
    );
    assert!(
        !directory_has_files(&RepositoryFixture::repository_root().join(".stats")),
        "statistics must live only in Nook Workbench"
    );
    assert!(
        publisher.contains("remotePath.startsWith('stats/')")
            && publisher.contains("Refusing to overwrite immutable Workbench record")
            && publisher.contains("NOOK_WORKBENCH_EXPECTED_SHA")
            && publisher.contains("Refusing stale Workbench update"),
        "the Workbench publisher must refuse to replace immutable statistics"
    );

    for path in [".github/workflows/main.yml", ".github/workflows/pr.yml"] {
        assert!(
            !RepositoryFixture::repository_root()
                .read(path)
                .contains(".stats/**"),
            "{path} must not retain obsolete statistics path exceptions"
        );
    }
    Ok(())
}
