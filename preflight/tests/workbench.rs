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

struct PrWorkbenchScenario {
    root: RepositoryFixture,
}

impl PrWorkbenchScenario {
    fn repository() -> Self {
        Self {
            root: RepositoryFixture::repository_root(),
        }
    }

    fn task_body<'a>(&self, taskfile: &'a str, task: &str, next_task: &str) -> &'a str {
        let start_marker = format!("  {task}:\n");
        let end_marker = format!("  {next_task}:\n");
        let start = taskfile
            .find(&start_marker)
            .unwrap_or_else(|| panic!("missing task {task}"));
        let body = taskfile
            .get(start..)
            .unwrap_or_else(|| panic!("task {task} begins outside a UTF-8 boundary"));
        let end = body
            .find(&end_marker)
            .unwrap_or_else(|| panic!("missing following task {next_task}"));
        body.get(..end)
            .unwrap_or_else(|| panic!("task {task} ends outside a UTF-8 boundary"))
    }

    fn assert_issue_publisher_delivery_contract(&self) {
        let root = &self.root;
        let pr_workflow = root.read(".github/workflows/pr.yml");
        let pr_tasks = root.read("nook-app/ci/pr.yml");
        let publisher_suite = root.read(".github/scripts/workbench-publish.test.cjs");
        let product_tests = self.task_body(&pr_tasks, "ci:pr:validate", "ci:pr:checks");
        let delivery_helpers = self.task_body(&pr_tasks, "ci:pr:delivery-helpers", "ci:pr:bake");

        assert!(
            pr_workflow.contains("run: task --silent ci:pr:validate\n"),
            "PR CI must invoke the consolidated PR test phase"
        );
        assert!(
            product_tests.contains("- ci:pr:delivery-helpers",),
            "the consolidated PR test phase must fan out product tests through delivery helpers"
        );
        assert!(
            delivery_helpers.contains(
                "cd \"{{.REPO_ROOT}}\" && node --test .github/scripts/workbench-publish.test.cjs",
            ),
            "the consolidated PR test phase must invoke the issue publisher contract suite"
        );
        assert!(
            publisher_suite.contains("rejects non-issue Workbench destination")
                && publisher_suite.contains("requires the expected SHA")
                && publisher_suite.contains("rejects an issue update with a stale expected SHA"),
            "the publisher suite must guard issue-only paths and expected-SHA updates"
        );
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

#[test]
fn agents_mutate_only_their_owned_feature_and_issue_set() -> anyhow::Result<()> {
    let agent_map = RepositoryFixture::repository_root().read(".cortex/AGENTS.md");
    let coding_workflow = RepositoryFixture::repository_root()
        .read(".cortex/gizmo-prime/workflows/mission-delivery.md");
    let issue_workflow =
        RepositoryFixture::repository_root().read(".cortex/gizmo-prime/workflows/issues.md");
    let pull_request_workflow =
        RepositoryFixture::repository_root().read(".cortex/gizmo-prime/workflows/pull-requests.md");
    let ownership_skill = RepositoryFixture::repository_root()
        .read(".cortex/gizmo-prime/dynamic-skills/agent-feature-ownership.md");
    let normalized_agent_map = agent_map.split_whitespace().collect::<Vec<_>>().join(" ");
    let normalized_coding_workflow = coding_workflow
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    assert!(
        agent_map.contains("gizmo-prime/dynamic-skills/agent-feature-ownership.md")
            && normalized_agent_map.contains("Another active task remains read-only"),
        "root routing must preserve the universal ownership boundary and link its authority"
    );

    for required in [
        "local feature workflow",
        "workspace setup, worker completion, branch integration, and cleanup",
        "functional ownership and product acceptance requirements",
        "GitHub PR policy separate",
        "persistent Delivery Pipeline or PR Lifecycle Agent service, scheduler, or notification journal",
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
        ownership_skill.contains("reply to or resolve another task's review threads")
            && ownership_skill.contains("Do not close,")
            && ownership_skill.contains("reopen, or merge its pull request")
            && ownership_skill.contains("Recheck task ownership before each push")
            && ownership_skill.contains("prompt-backed run requires the `continuing_owner`"),
        "agent feature ownership skill must cover PR and review mutations"
    );
    Ok(())
}

#[test]
fn pr_workbench_suite_runs_issue_publisher_contract_tests() {
    PrWorkbenchScenario::repository().assert_issue_publisher_delivery_contract();
}

#[test]
fn cortex_promotions_use_optional_curated_session_memory() -> anyhow::Result<()> {
    let gitignore = RepositoryFixture::repository_root().read(".gitignore");
    let agent_map = RepositoryFixture::repository_root().read(".cortex/AGENTS.md");
    let coding_workflow = RepositoryFixture::repository_root()
        .read(".cortex/gizmo-prime/workflows/mission-delivery.md");
    let pull_request_workflow =
        RepositoryFixture::repository_root().read(".cortex/gizmo-prime/workflows/pull-requests.md");
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
        agent_tasks.contains("loom:cortex-session-clean:")
            && agent_tasks.contains("task loom:default FAMILY=cortexSessionClean")
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
fn workbench_stores_issues_without_build_statistics_publication() -> anyhow::Result<()> {
    let repository = RepositoryFixture::repository_root();
    let publisher = repository.read(".github/scripts/workbench-publish.cjs");
    assert!(
        publisher.contains("class WorkbenchIssuePublisher")
            && publisher.contains("issuePathPattern")
            && publisher.contains("meta-secret/nook-workbench")
            && publisher.contains("NOOK_WORKBENCH_EXPECTED_SHA"),
        "the Workbench publisher must be limited to issue records"
    );

    for path in [
        ".github/workflows/main-build-stats.yml",
        ".github/workflows/lib/main-build-stats.mjs",
        ".github/workflows/lib/main-build-stats-legacy.mjs",
        ".github/workflows/lib/main-build-stats-codecs.mjs",
        ".github/workflows/lib/main-build-stats.test.mjs",
    ] {
        assert!(
            !repository.join(path).exists(),
            "obsolete Main statistics publisher remains: {path}"
        );
    }
    for path in [".github/workflows/main.yml", ".github/workflows/pr.yml"] {
        assert!(
            !repository.read(path).contains("main-build-stats"),
            "{path} must not retain Main statistics collector wiring"
        );
    }
    Ok(())
}
