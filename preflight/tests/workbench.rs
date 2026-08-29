#![allow(clippy::unnecessary_wraps)]

#[path = "workbench/harness_neutral.rs"]
mod harness_neutral;

use anyhow::Context as _;
use std::{
    fs,
    path::{Path, PathBuf},
};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

fn read(path: &str) -> String {
    fs::read_to_string(repository_root().join(path))
        .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
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
fn agent_implementation_claims_only_explicit_workbench_records() -> anyhow::Result<()> {
    let workflow = read(".github/workflows/agent-implement.yml");
    let plan_script = read(".github/scripts/ci-agent-plan.sh");
    let record_validator = read(".github/scripts/workbench-records.cjs");

    for required in [
        "WORKBENCH_REPOSITORY: meta-secret/nook-workbench",
        "WORKBENCH_PLAN_FILE: .nook-workbench-plan.md",
        "WORKBENCH_SUMMARY_FILE: .nook-workbench-worklog.md",
        "CI_AGENT_TOOLING_ROOT: ${{ github.workspace }}",
        "major_change_authorized:",
        "MAJOR_CHANGE_AUTHORIZED=$MAJOR_CHANGE_AUTHORIZED",
        "CI_AGENT_TIMEOUT_MS: \"18000000\"",
        "status: ready",
        "automation: agent",
        "status: in_progress",
        "gizmo_id",
        "const stackMetadataKeys = ['stack_branch', 'stack_predecessor_branch']",
        "new RegExp(`^\\\\s*${key}\\\\s*:`, 'm').test(frontmatter)",
        "presentStackMetadata.length > 0",
        "Stacked successor dispatch requires the later runtime support; retry after it lands.",
        "const rawGizmoId = gizmoIdRows[0]?.[1].trim() || ''",
        "const assignedGizmoId = rawGizmoId === 'null' ? '' : rawGizmoId",
        "stack_branch",
        "stack_predecessor_branch",
        "must provide both stack_branch and stack_predecessor_branch",
        "stack_branch must exist in the Nook repository",
        "stack_branch must have exactly one same-repository open PR",
        "recorded predecessor must exist while it remains the live PR base",
        "successor PR must target its recorded predecessor or main",
        "ISSUE_STACK_BRANCH: ${{ steps.workbench.outputs.stack_branch }}",
        "ISSUE_STACK_LIVE_BASE_BRANCH: ${{ steps.workbench.outputs.stack_live_base_branch }}",
        "ISSUE_STACK_PREDECESSOR_BRANCH: ${{ steps.workbench.outputs.stack_predecessor_branch }}",
        "AGENT_PR_BASE_BRANCH=$base_branch",
        "AGENT_PR_TARGET_KIND=$target_kind",
        "Checkout trusted workflow tooling",
        "ref: ${{ github.workflow_sha }}",
        "Prepare isolated implementation worktree",
        "IMPLEMENTATION_REPO_ROOT=$implementation_root",
        "REPO_ROOT: ${{ env.IMPLEMENTATION_REPO_ROOT }}",
        "task ci-agent:host:run CI_AGENT_CMD=implement",
        "Rejected unsafe implementation worklog artifact.",
        "ASSIGNED_GIZMO_ID: ${{ steps.workbench.outputs.gizmo_id }}",
        "assignedGizmoId: process.env.ASSIGNED_GIZMO_ID",
        "const currentGizmoIdMatch = /^- Current Gizmo ID:\\s*([a-z0-9]+(?:-[a-z0-9]+)*)\\s*$/m",
        "const currentGizmoId = currentGizmoIdMatch?.[1]",
        "Validated Workbench task plan is missing its Current Gizmo ID.",
        "`gizmo_id: ${currentGizmoId}`",
        "assignedGizmoId && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(assignedGizmoId)",
        "frontmatter.matchAll(/^gizmo_id:\\s*(.*)$/gm)",
        "gizmoIdRows.length > 1",
        "continuing_owner:",
        "A prompt-backed run requires continuing_owner.",
        "continuing_owner must be a lowercase GitHub login.",
        "must name a continuing GitHub owner before automation can claim it",
        "## Ownership",
        "CONTINUING_AGENT_OWNER",
        "Validate continuing GitHub owner",
        "getCollaboratorPermissionLevel",
        "addAssignees",
        "issues.createComment",
        "Supply exactly one of issue_path or prompt.",
        "[ -z \"$PROMPT\" ] && [ -z \"$ISSUE_PATH\" ]",
        "[ -n \"$PROMPT\" ] && [ -n \"$ISSUE_PATH\" ]",
        "const path = requestedPath",
        "github.rest.repos.getContent({ owner, repo, path, ref: 'main' })",
        "Claim ready Workbench issue",
        "Run task-planning agent",
        "task ci-agent:plan",
        "uses: ./.github/actions/nook-node-setup",
        "uses: go-task/setup-task@v2",
        "Validate and publish Workbench task plan",
        "Publish Workbench result",
        "MULTI_PR_PLAN: ${{ steps.plan.outputs.multi_pr }}",
        "Materialize the feature and ordered focused issues",
        "steps.workbench.outputs.found == 'true'",
        "validateAgentRecord",
        "if: steps.plan.outcome == 'success'",
        "steps.plan.outputs.authorization_blocked != 'true'",
        "Rejected architectural authorization blocker",
        "validateAgentRecord(blocker, 'worklog', secrets, process.env.AGENT_PROMPT)",
        "validateAgentRecord(candidate, 'worklog', secrets, process.env.AGENT_PROMPT)",
        "`plan: ${process.env.PLAN_PATH || 'null'}`",
        "publishing trusted fallback metadata",
        "## Decisions",
        "worklogs/${feature}/",
    ] {
        assert!(
            workflow.contains(required),
            "Workbench agent workflow is missing: {required}"
        );
    }
    assert!(
        workflow
            .matches("ASSIGNED_GIZMO_ID: ${{ steps.workbench.outputs.gizmo_id }}")
            .count()
            == 2
            && !workflow.contains("ASSIGNED_GIZMO_ID: ${{ env.ASSIGNED_GIZMO_ID }}"),
        "planning and validation must consume the trusted claim-step Gizmo ID output"
    );
    assert!(
        !workflow.contains("value(frontmatter, 'gizmo_id')"),
        "Gizmo IDs must retain their raw frontmatter scalar spelling"
    );
    let canonical_gizmo_id = |gizmo_id: &str| {
        gizmo_id.split('-').all(|segment| {
            !segment.is_empty()
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
    };
    fn assigned_gizmo_id(raw: &str) -> &str {
        if raw == "null" { "" } else { raw }
    }
    for accepted in ["2fa-slice", "123", "true", "false"] {
        assert!(
            canonical_gizmo_id(assigned_gizmo_id(accepted)),
            "rejected: {accepted}"
        );
    }
    for rejected in ["null", "", "slice--one", "slice-"] {
        assert!(
            !canonical_gizmo_id(assigned_gizmo_id(rejected)),
            "unexpected assignment: {rejected}"
        );
    }
    assert!(
        !workflow.contains("`gizmo_id: ${process.env.ASSIGNED_GIZMO_ID || 'null'}`"),
        "published plan frontmatter must persist the validated Current Gizmo ID"
    );
    assert!(
        workflow.matches("uses: actions/checkout@v7").count() == 1
            && !workflow.contains("ref: ${{ steps.task.outputs.checkout_ref }}"),
        "unreviewed implementation source must not replace the trusted workflow checkout"
    );
    for required in [
        "git -C \"$IMPLEMENTATION_REPO_ROOT\" worktree add --detach",
        "REPO_ROOT=\"$planning_root\" task ci-agent:host:run CI_AGENT_CMD=agent",
        "artifact_ready",
        "[ ! -L \"$1\" ]",
    ] {
        assert!(
            plan_script.contains(required),
            "Workbench planning script is missing: {required}"
        );
    }
    for required in [
        "content contains a workflow credential",
        "content resembles a transcript, credential, environment dump, or raw log",
        "content contains a verbatim source-task excerpt",
        "containsSourceTaskExcerpt",
    ] {
        assert!(
            record_validator.contains(required),
            "Workbench record validator is missing: {required}"
        );
    }

    assert!(
        !workflow.contains("\n  issues:"),
        "GitHub issue events must not trigger Nook implementation agents"
    );
    assert!(
        !workflow.contains("\n  schedule:")
            && !workflow.contains("\nconcurrency:")
            && !workflow.contains("github.rest.git.getTree")
            && !workflow.contains("recursive: 'true'")
            && !workflow.contains("for (const path of paths)"),
        "Workbench implementation must preserve each explicit dispatch without scheduled tree scanning or a collapsing concurrency group"
    );
    let dispatch_validation_position = workflow
        .find("Validate dispatch inputs")
        .context("the workflow must validate dispatch inputs")?;
    let checkout_position = workflow
        .find("Checkout")
        .context("the workflow must check out Nook")?;
    assert!(
        dispatch_validation_position < checkout_position,
        "invalid or ambiguous dispatches must fail before checkout"
    );
    let claim_position = workflow
        .find("Claim ready Workbench issue")
        .context("the workflow must claim the requested Workbench issue")?;
    let stack_guard_position = workflow
        .find("presentStackMetadata.length > 0")
        .context("the workflow must reject focused issues carrying stack metadata")?;
    let claim_mutation_position = workflow
        .find("github.rest.repos.createOrUpdateFileContents")
        .context("the workflow must claim the requested Workbench issue atomically")?;
    assert!(
        stack_guard_position < claim_mutation_position,
        "stacked focused issues must fail before the Workbench claim is mutated"
    );
    let docker_position = workflow
        .find("Docker setup")
        .context("the workflow must set up Docker")?;
    assert!(
        claim_position < docker_position,
        "the workflow must atomically claim a Workbench record before expensive setup"
    );
    let plan_position = workflow
        .find("Validate and publish Workbench task plan")
        .context("the workflow must validate and publish its Workbench plan")?;
    let trusted_plan_validation_position = workflow
        .find("const rejection = validateAgentRecord(candidate, 'plan'")
        .context("the workflow must validate the candidate plan with trusted context")?;
    let current_gizmo_position = workflow
        .find("const currentGizmoIdMatch")
        .context("the workflow must extract the validated Current Gizmo ID")?;
    let persisted_gizmo_position = workflow
        .find("`gizmo_id: ${currentGizmoId}`")
        .context("the workflow must persist the validated Current Gizmo ID")?;
    assert!(
        trusted_plan_validation_position < current_gizmo_position
            && current_gizmo_position < persisted_gizmo_position,
        "Current Gizmo ID must be extracted only after trusted validation and then persisted"
    );
    let implementation_position = workflow
        .find("Run ci-agent implement")
        .context("the workflow must run bounded implementation")?;
    assert!(
        plan_position < implementation_position,
        "the workflow must publish the interpreted task plan before implementation"
    );
    Ok(())
}

#[test]
fn agents_mutate_only_their_owned_feature_and_issue_set() -> anyhow::Result<()> {
    let agent_map = read(".cortex/AGENTS.md");
    let coding_workflow = read(".cortex/gizmo/workflows/mission-delivery.md");
    let issue_workflow = read(".cortex/gizmo/workflows/issues.md");
    let pull_request_workflow = read(".cortex/gizmo/workflows/pull-requests.md");
    let ownership_skill = read(".cortex/gizmo/dynamic-skills/agent-feature-ownership.md");

    for required in [
        "agents mutate only their owned feature",
        "Another active agent's work is read-only",
        "wait for an explicit user, owner, or orchestrator handoff",
    ] {
        assert!(
            agent_map.contains(required),
            "agent map is missing ownership guard: {required}"
        );
    }

    for required in [
        "Treat every other active task as read-only",
        "current task's owned feature and focused issue set",
        "Require an explicit handoff first",
    ] {
        assert!(
            coding_workflow.contains(required),
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
fn team_work_distinguishes_owner_vocabulary_from_implementation_expertise() -> anyhow::Result<()> {
    let agent_map = read(".cortex/AGENTS.md");
    let ownership = read(".cortex/gizmo/architecture/team-ownership.md");
    let document_map = read(".cortex/teams/ai/dynamic-skills/cortex-document-map.md");
    let workflow = read(".cortex/gizmo/workflows/team-oriented-development.md");
    let web_contract = read(".cortex/teams/web-dev/AGENTS.md");
    let sre_contract = read(".cortex/teams/sre/AGENTS.md");
    let security_contract = read(".cortex/teams/security/AGENTS.md");
    let security_graph = read(".cortex/teams/security/knowledge-graph.md");
    let security_architecture =
        read(".cortex/teams/security/architecture/security-architecture.md");
    let cryptography = read(".cortex/teams/security/references/cryptography.md");
    let web_graph = read(".cortex/teams/web-dev/knowledge-graph.md");
    let shared_graph = read(".cortex/shared/knowledge-graph.md");
    let agent_plan = read(".github/prompts/agent-plan.md");
    let issues_workflow = read(".cortex/gizmo/workflows/issues.md");
    let loom_tools = read(".cortex/teams/ai/references/loom-tools.md");
    let workbench_validator = read(".github/scripts/workbench-records.cjs");
    let normalized_agent_map = agent_map.split_whitespace().collect::<Vec<_>>().join(" ");
    let normalized_agent_plan = agent_plan.split_whitespace().collect::<Vec<_>>().join(" ");
    let normalized_web_contract = web_contract
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    for required in [
        "functional owner",
        "expertise provider",
        "explicit expertise contract",
        "named consumer-team code and tests",
        "smallest explicitly linked set of",
        "foreign-team skills as required read-only engineering policy",
        "read-only engineering policy",
        "only when the foreign team will change files",
    ] {
        assert!(
            normalized_agent_map.contains(required),
            "root agent routing is missing matrix ownership contract: {required}"
        );
    }

    assert!(
        document_map.contains("foreign-team implementation requirement")
            && document_map.contains("Skill consumption")
            && document_map.contains("does not require delegation")
            && document_map.contains("without opening the foreign team's graph"),
        "document navigation must distinguish read-only skill use from foreign-team implementation"
    );

    for required in [
        "## Ownership dimensions",
        "## Cross-team expertise protocol",
        "does not permanently transfer a file",
        "consumer-team Cortex",
        "capability semantics",
        "Skill ownership is separate from implementation delegation",
        "implementing its own capability",
    ] {
        assert!(
            ownership.contains(required),
            "team ownership is missing expertise boundary: {required}"
        );
    }

    for required in [
        "## Request another team's expertise",
        "exact code and test paths",
        "Return the result to the functional owner",
        "Skill consumption alone does not create an expertise provider",
    ] {
        assert!(
            workflow.contains(required),
            "team workflow is missing expertise delegation step: {required}"
        );
    }

    assert!(
        web_contract.contains("TypeScript and Svelte engineering expertise")
            && normalized_web_contract.contains(
                "bounded TypeScript implementation when web development is the expertise provider"
            )
            && web_contract.contains("does not authorize changes to consumer-team Cortex"),
        "web development must own TypeScript expertise without taking consumer capability authority"
    );
    assert!(
        web_graph.contains("direct functional-owner implementation")
            && web_graph.contains("read-only engineering policy"),
        "web TypeScript routing must include direct read-only consumption by functional owners"
    );
    for required in [
        "Security owns Nook's security architecture",
        "does not automatically transfer implementation files",
        "must not claim guarantees",
    ] {
        assert!(
            security_contract.contains(required),
            "security contract is missing ownership boundary: {required}"
        );
    }
    for required in [
        "Nook security architecture",
        "Identity, app keys, passkeys, and vault keys",
        "Cryptography and protected material",
        "Browser extension release security",
    ] {
        assert!(
            security_graph.contains(required),
            "security graph is missing authority: {required}"
        );
    }
    for required in [
        "## Trust boundaries",
        "## Key hierarchy and separation",
        "## Authorization and event history",
        "## Known limitations of this document",
    ] {
        assert!(
            security_architecture.contains(required),
            "security architecture is missing section: {required}"
        );
    }
    for required in [
        "AES-256-GCM",
        "HKDF-SHA256",
        "PBKDF2-SHA256",
        "Ed25519",
        "age X25519",
    ] {
        assert!(
            cryptography.contains(required),
            "cryptography inventory is missing mechanism: {required}"
        );
    }
    for required in [
        "- Mission controller:",
        "- Current Gizmo ID:",
        "- Ownership units:",
        "Functional owner:",
        "Gizmo ID:",
        "Expertise provider:",
        "Expertise allowed code paths:",
        "Expertise allowed test paths:",
        "Expertise forbidden paths:",
        "Expertise consumer interfaces:",
        "Expertise acceptance evidence:",
        "Capability acceptance evidence:",
    ] {
        assert!(
            agent_plan.contains(required)
                && issues_workflow.contains("Ownership units")
                && workbench_validator.contains(required.trim()),
            "automated planning must require expertise contract field: {required}"
        );
    }
    // The planning prompt carries the review policy for Gizmo Prime's delivery semantics.
    assert!(
        normalized_agent_plan.contains(
            "`Functional owner` to exactly `Gizmo Prime`, `AI`, `Development core`, `Security`, `SRE`, or `Web development`"
        ) && normalized_agent_plan.contains(
            "Use `Gizmo Prime` only for coordination, integration, or lifecycle capabilities"
        ) && normalized_agent_plan.contains(
                "An `Expertise provider` must be exactly `AI`, `Development core`, `Security`, `SRE`, or `Web development`"
            ) && normalized_agent_plan.contains("Gizmo Prime is never an expertise provider"),
        "planning review policy must reserve Gizmo Prime for coordination, integration, or lifecycle and exclude it from expertise provision"
    );
    // The JavaScript validator enforces only role vocabularies, not capability semantics.
    assert!(
        workbench_validator.contains("const functionalOwnerPattern =")
            && workbench_validator
                .contains("'Gizmo Prime|Gizmo|AI|Development core|Security|SRE|Web development'")
            && workbench_validator.contains("const expertiseProviderPattern =")
            && workbench_validator.contains("'AI|Development core|Security|SRE|Web development'")
            && workbench_validator.contains("(${functionalOwnerPattern})")
            && workbench_validator.contains("(None|${expertiseProviderPattern})"),
        "Workbench validation must include Gizmo in the functional-owner vocabulary and exclude it from the expertise-provider vocabulary"
    );

    for skill in [
        "typescript-domain-structure.md",
        "typescript-explicit-state.md",
    ] {
        assert!(
            sre_contract.contains(skill),
            "SRE JavaScript and TypeScript work must route read-only policy: {skill}"
        );
    }

    for skill in [
        "browser-extension-release-security.md",
        "user-facing-security-abstractions.md",
    ] {
        let security_path = repository_root()
            .join(".cortex/teams/security/dynamic-skills")
            .join(skill);
        let web_path = repository_root()
            .join(".cortex/teams/web-dev/dynamic-skills")
            .join(skill);
        assert!(security_path.is_file(), "security must own {skill}");
        assert!(
            !web_path.exists(),
            "web development must not retain security-owned skill {skill}"
        );
        assert!(
            security_graph.contains(skill) && !web_graph.contains(skill),
            "{skill} must be indexed only by the security graph"
        );
    }
    for skill in [
        "typescript-domain-structure.md",
        "typescript-explicit-state.md",
        "typescript-named-args.md",
        "typescript-no-unknown.md",
        "typescript-single-parameter.md",
    ] {
        assert!(
            loom_tools.contains(skill),
            "AI Loom work must route read-only TypeScript policy: {skill}"
        );
    }

    for skill in [
        "typescript-domain-structure.md",
        "typescript-explicit-state.md",
        "typescript-named-args.md",
        "typescript-no-unknown.md",
        "typescript-single-parameter.md",
    ] {
        let web_path = repository_root()
            .join(".cortex/teams/web-dev/dynamic-skills")
            .join(skill);
        let shared_path = repository_root()
            .join(".cortex/shared/dynamic-skills")
            .join(skill);
        assert!(web_path.is_file(), "web development must own {skill}");
        assert!(
            !shared_path.exists(),
            "shared Cortex must not retain web-owned skill {skill}"
        );
        assert!(
            web_graph.contains(skill) && !shared_graph.contains(skill),
            "{skill} must be indexed only by the web-development graph"
        );
    }

    Ok(())
}

#[test]
fn feature_slice_gizmos_are_passive_workbench_records() {
    let policy_paths = [
        ".cortex/AGENTS.md",
        ".cortex/knowledge-graph.md",
        ".cortex/gizmo/AGENTS.md",
        ".cortex/gizmo/workflows/issues.md",
        ".cortex/gizmo/workflows/mission-delivery.md",
        ".cortex/gizmo/workflows/pull-requests.md",
        ".cortex/gizmo/workflows/subagent-delegation.md",
        ".cortex/teams/ai/workflows/monorepo.md",
        ".github/prompts/agent-plan.md",
    ];
    let policy = policy_paths
        .iter()
        .map(|path| read(path))
        .collect::<Vec<_>>()
        .join("\n")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let normalized = policy.to_lowercase();

    for required in [
        "immutable typed Workbench slice record, not a process, agent, worker attempt, or controller",
        "routes tasks by assigned Gizmo ID",
        "receives existing typed handoffs directly",
        "existing typed handoff directly to Gizmo Prime",
        "introduces no new handoff transport",
        "changes require a superseding new immutable Workbench plan",
    ] {
        assert!(
            policy.contains(required),
            "feature-slice record policy is missing: {required}"
        );
    }

    for forbidden in [
        "feature-slice gizmo coordinates",
        "slice gizmo coordinates",
        "coordinates its required team agents",
        "returns a typed slice handoff",
        "return its typed slice handoff",
        "return the ai team agent handoff to the assigned feature-slice gizmo",
        "non-team slice controller",
        "that controller owns",
        "created and updated by gizmo prime",
    ] {
        assert!(
            !normalized.contains(forbidden),
            "feature-slice Gizmo must remain a passive record: {forbidden}"
        );
    }
}

#[test]
fn pr_workbench_suite_loads_split_contract_tests() {
    let pr_workflow = read(".github/workflows/pr.yml");
    let pr_suite = read(".github/scripts/workbench-records.test.cjs");
    let mapping_suite = read(".github/scripts/workbench-gizmo-mapping.test.cjs");

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
        mapping_suite.contains("rejects one-PR delivery with multiple Gizmos")
            && mapping_suite.contains("rejects an over-2,000 feature represented by one Gizmo"),
        "the transitively loaded suite must retain bounded Gizmo mapping regressions"
    );
}

#[test]
fn workbench_plans_bind_trusted_slices_and_bounded_independence() {
    let validator = read(".github/scripts/workbench-records.cjs");
    let prompt = read(".github/prompts/agent-plan.md");
    let pull_requests = read(".cortex/gizmo/workflows/pull-requests.md");
    let normalized_pull_requests = pull_requests
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    for required in [
        "validateTrustedGizmoAssignment",
        "trusted focused-issue Gizmo ID requires one-PR delivery",
        "the sole PR slice must use the trusted focused-issue Gizmo ID",
        "every ownership unit must use the trusted focused-issue Gizmo ID",
        "multi-PR delivery at or below 2,000 authored changed lines requires independent PRs",
    ] {
        assert!(
            validator.contains(required),
            "Workbench validator is missing bounded Gizmo enforcement: {required}"
        );
    }
    assert!(
        prompt.contains("At or below 2,000, stacked delivery is invalid")
            && prompt.contains("exactly one slice, and no other Gizmo ID")
            && normalized_pull_requests.contains("must not be registered as a stack")
            && normalized_pull_requests.contains("one PR, one slice"),
        "planning policy must require one trusted slice and predecessor-free bounded independence"
    );
}

#[test]
fn substantial_agent_tasks_use_curated_session_memory() -> anyhow::Result<()> {
    let gitignore = read(".gitignore");
    let agent_map = read(".cortex/AGENTS.md");
    let coding_workflow = read(".cortex/gizmo/workflows/mission-delivery.md");
    let pull_request_workflow = read(".cortex/gizmo/workflows/pull-requests.md");
    let self_improvement = read(".cortex/teams/ai/dynamic-skills/self-improvement.md");
    let agent_tasks = read(".task/agentic-ai.yml");
    let readiness_guard = read("agentic-ai/loom/src/commands/cortex-session-clean.ts");

    assert!(
        gitignore.lines().any(|line| line == ".cortex/.session/"),
        "temporary Cortex session memory must remain ignored"
    );
    assert!(
        agent_map.contains("dynamic-skills/self-improvement.md")
            && coding_workflow.contains("dynamic-skills/self-improvement.md")
            && pull_request_workflow.contains("dynamic-skills/self-improvement.md"),
        "agent entry points must invoke the canonical self-improvement skill"
    );
    assert!(
        pull_request_workflow.contains("completion contract"),
        "pull-request readiness must invoke the canonical completion contract"
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
        "task loom:agent-workflow:cortex-audit",
        "task loom:cortex-session-clean",
        "## Pull-request completion contract",
    ] {
        assert!(
            self_improvement.contains(required),
            "self-improvement skill is missing: {required}"
        );
    }
    assert!(
        self_improvement.contains("## Task lifecycle")
            && self_improvement.contains("Create one temporary file for every substantial task"),
        "the canonical skill must own the complete self-improvement lifecycle"
    );
    assert!(
        agent_tasks
            .matches("- task loom:cortex-session-clean")
            .count()
            == 2
            && readiness_guard
                .contains("PR readiness requires removing temporary Cortex session memory")
            && !repository_root()
                .join(".github/scripts/assert-cortex-session-clean.sh")
                .exists(),
        "host and Hive readiness must reject leftover temporary session memory"
    );
    Ok(())
}

#[test]
fn statistics_leave_the_product_repository() -> anyhow::Result<()> {
    let collector = read(".github/workflows/main-build-stats.yml");
    let publisher = read(".github/scripts/workbench-publish.cjs");

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
        !directory_has_files(&repository_root().join(".stats")),
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
            !read(path).contains(".stats/**"),
            "{path} must not retain obsolete statistics path exceptions"
        );
    }
    Ok(())
}

#[test]
fn agent_prompt_requires_a_publishable_worklog() -> anyhow::Result<()> {
    let prompt = read(".github/prompts/agent-implement.md");
    let plan_prompt = read(".github/prompts/agent-plan.md");
    let plan_script = read(".github/scripts/ci-agent-plan.sh");
    let prompt_loader = read("agentic-ai/ci-agent/src/main/prompt.ts");
    let ignore = read(".gitignore");
    let workflow = read(".github/workflows/agent-implement.yml");

    for required in [
        ".nook-workbench-worklog.md",
        "## Implementation problems",
        "## Decisions",
        "## Validation",
        "## Remaining work",
    ] {
        assert!(
            prompt.contains(required),
            "agent worklog prompt is missing: {required}"
        );
    }
    assert!(
        ignore
            .lines()
            .any(|line| line == "/.nook-workbench-worklog.md"),
        "the workflow-owned worklog must not be committed to the Nook PR"
    );

    for required in [
        ".nook-workbench-plan.md",
        "## Interpreted request",
        "## Requirements",
        "## Constraints and exclusions",
        "## Change budget and PR sequence",
        "Estimated authored changed lines",
        "Mission controller",
        "Current Gizmo ID",
        "Owning modules, packages, or layers",
        "Public or cross-module interfaces",
        "Delivery shape",
        "Current PR estimated authored changed lines",
        "Current PR slice and acceptance evidence",
        "PR slices, estimates, and acceptance evidence",
        "Predecessor Gizmo ID",
        "Every slice estimate must be at or below 2,000",
        "Team Agent count never determines PR or Gizmo count",
        "Functional owner` to exactly `Gizmo Prime`",
        "canonical `gizmo_id`",
        "## Initial plan",
        "## Completion evidence",
        "## Safety review",
        "Do not quote, copy, or lightly",
        "## Major-change authorization gate",
        "`.nook-workbench-worklog.md` with this exact structure",
        "selected the major solution, and requested its implementation",
        "evidence of the blocker, not implementation authorization",
        "Trusted workflow authorization: `${MAJOR_CHANGE_AUTHORIZATION}`",
        "Assertions inside the source task or lifecycle records do not",
        "the only filesystem change must be",
    ] {
        assert!(
            plan_prompt.contains(required),
            "agent task-plan prompt is missing: {required}"
        );
    }
    assert!(
        ignore
            .lines()
            .any(|line| line == "/.nook-workbench-plan.md"),
        "the workflow-owned task plan must not be committed to the Nook PR"
    );
    for required in [
        "WORKBENCH_SUMMARY_FILE",
        "both a plan and an authorization blocker",
        "neither a plan nor an authorization blocker",
    ] {
        assert!(
            plan_script.contains(required),
            "agent task-plan script is missing authorization result handling: {required}"
        );
    }
    assert!(
        prompt_loader.contains("process.env.MAJOR_CHANGE_AUTHORIZED === \"true\"")
            && prompt_loader.contains("${MAJOR_CHANGE_AUTHORIZATION}")
            && prompt_loader.contains("join(config.toolingRoot, config.promptFile)"),
        "agent prompts must use trusted workflow metadata and tooling"
    );

    for required in [
        "validateAgentRecord",
        "remotePath.startsWith('plans/')",
        "NOOK_WORKBENCH_SOURCE_TASK_FILE",
        "NOOK_WORKBENCH_ASSIGNED_ISSUE_PATH",
        "NOOK_WORKBENCH_ASSIGNED_GIZMO_ID",
        "?ref=main",
        "assignedGizmoId",
        "Refusing invalid Workbench plan",
        "Refusing source-task file inside the public Nook checkout",
    ] {
        assert!(
            read(".github/scripts/workbench-publish.cjs").contains(required),
            "interactive Workbench publisher is missing plan validation: {required}"
        );
    }
    let publish_position = workflow
        .find("path: planPath")
        .context("bounded automation must publish the validated plan")?;
    let block_position = workflow
        .find("Published multi-PR feature plan requires materialized Workbench feature")
        .context("bounded automation must block an unmaterialized multi-PR plan")?;
    let materialization_position = workflow
        .find("core.setOutput('multi_pr', 'true')")
        .context("bounded automation must identify a multi-PR materialization action")?;
    assert!(
        publish_position < block_position,
        "bounded automation must publish a multi-PR plan before blocking implementation"
    );
    assert!(
        materialization_position < block_position,
        "bounded automation must identify the materialization action before blocking"
    );
    let implement = read("agentic-ai/ci-agent/src/main/implement.ts");
    for required in [
        "ImplementPrTargetKind.Stacked",
        "budgetBaseRef: `origin/${input.baseBranch}`",
        "requires a pre-existing linked PR",
        "openPr.baseBranch !== target.baseBranch",
        "baseRef: target.budgetBaseRef",
        "target.baseBranch",
    ] {
        assert!(
            implement.contains(required),
            "bounded implementation is missing stacked-PR handling: {required}"
        );
    }
    let ordered = [
        "assertBudget()",
        "pushBranch()",
        "verifyBranch()",
        "findPr()",
        "createPr()",
    ]
    .map(|step| implement.find(step));
    assert!(
        ordered.iter().all(Option::is_some) && ordered.is_sorted(),
        "branch preservation sequence drifted"
    );
    let trusted_checkout_position = workflow
        .find("Checkout trusted workflow tooling")
        .context("bounded automation must check out its trusted tooling")?;
    let claim_position = workflow
        .find("Claim ready Workbench issue")
        .context("bounded automation must claim its focused issue")?;
    let implementation_position = workflow
        .find("Prepare isolated implementation worktree")
        .context("bounded automation must isolate implementation source")?;
    let local_action_position = workflow
        .find("uses: ./.github/actions/nook-docker-setup")
        .context("bounded automation must retain its trusted local setup action")?;
    assert!(
        trusted_checkout_position < claim_position
            && claim_position < implementation_position
            && trusted_checkout_position < local_action_position,
        "trusted tooling must remain separate from the validated implementation worktree"
    );
    Ok(())
}
