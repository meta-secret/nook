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
        "CI_AGENT_TOOLING_ROOT=\"$GITHUB_WORKSPACE\"",
        "major_change_authorized:",
        "MAJOR_CHANGE_AUTHORIZED=$MAJOR_CHANGE_AUTHORIZED",
        "CI_AGENT_TIMEOUT_MS: \"18000000\"",
        "status: ready",
        "automation: agent",
        "status: in_progress",
        "gizmo_id",
        "const rawGizmoId = gizmoIdRows[0]?.[1].trim() || ''",
        "const assignedGizmoId = rawGizmoId === 'null' ? '' : rawGizmoId",
        "uses unsupported stacked-PR metadata",
        "AGENT_PR_BASE_BRANCH=$base_branch",
        "AGENT_PR_TARGET_KIND=$target_kind",
        "Checkout trusted workflow tooling",
        "ref: ${{ github.workflow_sha }}",
        "Prepare isolated implementation worktree",
        "IMPLEMENTATION_REPO_ROOT=$implementation_root",
        "REPO_ROOT: ${{ env.IMPLEMENTATION_REPO_ROOT }}",
        "node \"$GITHUB_WORKSPACE/agentic-ai/ci-agent/dist/main/main.js\" edit",
        "node \"$GITHUB_WORKSPACE/agentic-ai/ci-agent/dist/main/main.js\" deliver",
        "Rejected unsafe implementation worklog artifact.",
        "ASSIGNED_GIZMO_ID: ${{ steps.workbench.outputs.gizmo_id }}",
        "assignedGizmoId: process.env.ASSIGNED_GIZMO_ID",
        "const currentGizmoIdMatch = /^- Current Gizmo ID:\\s*([a-z0-9]+(?:-[a-z0-9]+)*)\\s*$/m",
        "const currentGizmoId = currentGizmoIdMatch?.[1]",
        "Validated Workbench task plan is missing its Current Gizmo ID.",
        "`gizmo_id: ${currentGizmoId}`",
        "!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(assignedGizmoId)",
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
        "bash \"$GITHUB_WORKSPACE/.github/scripts/ci-agent-plan.sh\"",
        "uses: ./.github/actions/nook-node-setup",
        "uses: oven-sh/setup-bun@v2",
        "uses: dtolnay/rust-toolchain@1.97.0",
        "npm ci --ignore-scripts --include=dev --prefix",
        "bun install --cwd",
        "Format implementation on trusted host",
        "Validate and publish Workbench task plan",
        "Resolve standalone prompt rerun",
        "if: steps.task.outputs.ready == 'true' && inputs.prompt != ''",
        "Multiple open PRs use standalone branch",
        "Existing standalone implementation PR has an unexpected repository or base",
        "state: 'all'",
        "github.rest.pulls.get",
        "pull.state === 'open'",
        "pull.merged",
        "was closed without merge; preserve it for explicit recovery",
        "github.rest.repos.getBranch",
        "exists without a PR; preserve it for explicit recovery",
        "error.status !== 404",
        "steps.rerun.outputs.terminal != 'true'",
        "Standalone implementation PR is $IMPLEMENTATION_TERMINAL_REASON; skipping rerun.",
        "Standalone implementation PR is $IMPLEMENTATION_TERMINAL_REASON; delivery is idempotently complete.",
        "Materialize validated implementation plan",
        "VALIDATED_PLAN_SHA256=$EXPECTED_PLAN_SHA256",
        "sha256sum \"$implementation_plan\"",
        "sha256sum \"$plan\"",
        "Publish Workbench result",
        "steps.workbench.outputs.found == 'true'",
        "validateAgentRecord",
        "if: steps.plan.outcome == 'success'",
        "steps.plan.outputs.planning_blocked != 'true'",
        "Rejected planning blocker",
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
        workflow.contains("uses unsupported stacked-PR metadata")
            && !workflow.contains("GET /repos/{owner}/{repo}/stacks"),
        "bounded automation must reject legacy stacked-PR metadata"
    );
    assert!(
        workflow.matches("uses: actions/checkout@v7").count() == 1
            && workflow.contains("persist-credentials: false")
            && !workflow.contains("ref: ${{ steps.task.outputs.checkout_ref }}"),
        "unreviewed implementation source must not replace the trusted workflow checkout"
    );
    for required in [
        "git -C \"$IMPLEMENTATION_REPO_ROOT\" worktree add --detach",
        "node \"$ROOT/agentic-ai/ci-agent/dist/main/main.js\" plan",
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
    let stack_rejection_position = workflow
        .find("uses unsupported stacked-PR metadata")
        .context("the workflow must reject legacy stack metadata")?;
    let claim_mutation_position = workflow
        .find("github.rest.repos.createOrUpdateFileContents")
        .context("the workflow must claim the requested Workbench issue atomically")?;
    assert!(
        stack_rejection_position < claim_mutation_position,
        "legacy stack metadata must be rejected before the Workbench claim is mutated"
    );
    let tooling_position = workflow
        .find("Prepare direct host tooling")
        .context("the workflow must prepare direct host tooling")?;
    assert!(
        claim_position < tooling_position,
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
        .find("Run sandboxed implementation agent")
        .context("the workflow must run bounded implementation")?;
    assert!(
        plan_position < implementation_position,
        "the workflow must publish the interpreted task plan before implementation"
    );
    Ok(())
}

#[test]
fn agent_implementation_publishes_prs_with_trusted_workbench_metadata() -> anyhow::Result<()> {
    let workflow = read(".github/workflows/agent-implement.yml");
    let plan_prompt = read(".github/prompts/agent-plan.md");
    let normalized_plan_prompt = plan_prompt.split_whitespace().collect::<Vec<_>>().join(" ");

    for required in [
        "must have a valid canonical gizmo_id before PR publication",
        "must have a trusted capability-oriented title before PR publication",
        "issues/unplanned/run-${context.runId}.md",
        "Existing manual focused issue does not match this trusted run",
        "Trusted PR publication requires a focused issue URL and canonical Gizmo ID.",
        "## Agent-task provenance",
        "- Harness: GitHub Actions `Agent implement`",
        "- Opaque task ID: [workflow run ${context.runId}](${runUrl})",
        "## Workbench authority",
        "Focused issue: [\\`${issuePath}\\`](${issueUrl})",
        "Immutable plan: [\\`${planPath}\\`](${planUrl})",
        "AGENT_PR_TITLE<<${delimiter}",
        "AGENT_PR_BODY<<${delimiter}",
        "ISSUE_PATH: ${{ steps.plan.outputs.issue_path }}",
        "core.setOutput('issue_path', claimedIssuePath)",
        "core.setOutput('issue_title', claimedIssueTitle)",
        "Gizmo name:\\\\s*(.+?)\\\\s*;\\\\s*Predecessor Gizmo ID:",
        "const worklogUrl = `https://github.com/${owner}/${repo}/blob/main/${worklogPath}`",
    ] {
        assert!(
            workflow.contains(required),
            "trusted PR publisher is missing: {required}"
        );
    }
    assert!(
        !workflow.contains("title=\"Agent implement (run ${RUN_ID})\"")
            && !workflow.contains("Owned scope: manual prompt run"),
        "PR metadata must not publish generic or private manual-prompt context"
    );
    assert!(
        workflow.contains("if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(assignedGizmoId))")
            && normalized_plan_prompt.contains(
                "When the task source is a focused Workbench issue, require canonical `gizmo_id` frontmatter."
            )
            && !normalized_plan_prompt.contains("Legacy standalone issues without `gizmo_id`"),
        "missing, null, and invalid focused-issue Gizmo IDs must fail before claim"
    );

    let claimed_issue_output_position = workflow
        .find("core.setOutput('issue_path', claimedIssuePath)")
        .context("the plan step must retain the claimed issue path")?;
    let planning_blocked_position = workflow
        .find("core.setOutput('planning_blocked', 'true')")
        .context("the plan step must report a validated planning blocker")?;
    assert!(
        claimed_issue_output_position < planning_blocked_position,
        "claimed issue metadata must survive the planning-blocked return"
    );

    let manual_issue_position = workflow
        .find("issues: establish agent run ${context.runId}")
        .context("manual dispatch must establish its focused issue")?;
    let plan_publication_position = workflow
        .find("message: `plan: agent run ${context.runId}`")
        .context("the workflow must publish the immutable plan")?;
    let pr_body_position = workflow
        .find("const prBody = [")
        .context("the workflow must construct trusted PR metadata")?;
    let delivery_position = workflow
        .find("Validate, commit, and publish implementation")
        .context("the workflow must retain its delivery step")?;
    let worklog_publication_position = workflow
        .find("path: worklogPath")
        .context("the workflow must publish its immutable worklog")?;
    let pr_worklog_update_position = workflow
        .find("github.rest.pulls.update")
        .context("the workflow must add the worklog URL to the PR body")?;
    assert!(
        manual_issue_position < plan_publication_position
            && plan_publication_position < pr_body_position
            && pr_body_position < delivery_position,
        "focused issue and immutable plan publication must precede PR metadata construction and delivery"
    );
    assert!(
        worklog_publication_position < pr_worklog_update_position
            && workflow.contains("const updatedPrBody = currentPrBody.replace("),
        "the published worklog URL must extend the existing PR metadata without replacing it"
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
    let normalized_agent_map = agent_map.split_whitespace().collect::<Vec<_>>().join(" ");

    assert!(
        agent_map.contains("gizmo/dynamic-skills/agent-feature-ownership.md")
            && normalized_agent_map.contains("Another active agent's work is read-only"),
        "root routing must preserve the universal ownership boundary and link its authority"
    );

    for required in [
        "Treat every other active task as read-only",
        "current checkout and current branch",
        "only one write-capable Team Agent at a time",
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
    let document_map = read(".cortex/teams/ai/dynamic-skills/cortex-document-map/SKILL.md");
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
    let normalized_workflow = workflow.split_whitespace().collect::<Vec<_>>().join(" ");
    let normalized_web_contract = web_contract
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    assert!(
        normalized_agent_map.contains("foreign-team skill as read-only engineering policy")
            && normalized_agent_map
                .contains("foreign-team writer requires an explicit expertise task")
            && normalized_agent_map.contains("gizmo/AGENTS.md"),
        "root routing must preserve the cross-team boundary and route operational details to Gizmo"
    );

    assert!(
        document_map.contains("foreign-team implementation requirement")
            && document_map.contains("Skill consumption")
            && document_map.contains("does not require delegation")
            && document_map.contains("without opening the foreign team's graph"),
        "document navigation must distinguish read-only skill use from foreign-team implementation"
    );

    for required in [
        "## Universal rules",
        "one functional engineering team",
        "File location is evidence of ownership",
        "A team stops at another team's boundary",
        "Security review does not transfer implementation ownership",
        "Team Agents edit the current shared checkout sequentially",
    ] {
        assert!(
            ownership.contains(required),
            "team ownership is missing expertise boundary: {required}"
        );
    }

    for required in [
        "## Cross-team dependencies",
        "reports foreign-team work to Gizmo",
        "does not implement the foreign capability",
        "assigns the dependency to its functional owner",
    ] {
        assert!(
            normalized_workflow.contains(required),
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
            "Use `Gizmo Prime` only for coordination, shared-branch sequencing, or delivery capabilities"
        ) && normalized_agent_plan.contains(
                "An `Expertise provider` must be exactly `AI`, `Development core`, `Security`, `SRE`, or `Web development`"
            ) && normalized_agent_plan.contains("Gizmo Prime is never an expertise provider"),
        "planning policy must reserve Gizmo Prime for delivery coordination and exclude it from expertise provision"
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
        "receives results directly",
        "Do not introduce a slice-process transport or intermediate agent",
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
        mapping_suite.contains("rejects multiple PR rows")
            && mapping_suite.contains("['Multiple PRs', 'Stacked PRs']"),
        "the transitively loaded suite must retain bounded Gizmo mapping regressions"
    );
}

#[test]
fn workbench_plans_bind_trusted_slices_to_one_pr() {
    let validator = read(".github/scripts/workbench-records.cjs");
    let prompt = read(".github/prompts/agent-plan.md");
    let pull_requests = read(".cortex/gizmo/workflows/pull-requests.md");
    let normalized_pull_requests = pull_requests
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let normalized_prompt = prompt.split_whitespace().collect::<Vec<_>>().join(" ");

    for required in [
        "validateTrustedGizmoAssignment",
        "trusted focused-issue Gizmo ID requires one-PR delivery",
        "the sole PR slice must use the trusted focused-issue Gizmo ID",
        "every ownership unit must use the trusted focused-issue Gizmo ID",
        "only one-PR delivery is supported",
    ] {
        assert!(
            validator.contains(required),
            "Workbench validator is missing bounded Gizmo enforcement: {required}"
        );
    }
    assert!(
        normalized_prompt
            .contains("Set `Delivery shape` and `PR sequence mode` to exactly `One PR`")
            && normalized_prompt.contains("a blocker. Report that the complete requested outcome")
            && normalized_prompt.contains("Do not create slices, successor PRs, or a stack")
            && normalized_pull_requests
                .contains("Do not split, stack, rebuild, or replace pull requests")
            && normalized_pull_requests.contains("One feature uses one PR"),
        "planning policy must require one bounded PR and prohibit stack recovery"
    );
}

#[test]
fn cortex_promotions_use_optional_curated_session_memory() -> anyhow::Result<()> {
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
        "${VALIDATED_PLAN}",
        "authoritative even if a workspace file is later changed",
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
        "The sole slice estimate must equal",
        "Team Agent count never determines",
        "Functional owner` to exactly `Gizmo Prime`",
        "canonical `gizmo_id`",
        "## Initial plan",
        "## Completion evidence",
        "## Safety review",
        "Do not quote, copy, or lightly",
        "## Major-change authorization gate",
        "`.nook-workbench-worklog.md` with this exact structure",
        "selected the major solution, and requested its implementation",
        "A typed planning blocker includes",
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
        "both a plan and a planning blocker",
        "neither a plan nor a planning blocker",
    ] {
        assert!(
            plan_script.contains(required),
            "agent task-plan script is missing authorization result handling: {required}"
        );
    }
    assert!(
        prompt_loader.contains("process.env.MAJOR_CHANGE_AUTHORIZED === \"true\"")
            && prompt_loader.contains("${MAJOR_CHANGE_AUTHORIZATION}")
            && prompt_loader
                .contains("Validated implementation plan hash changed before agent start")
            && prompt_loader.contains("join(config.toolingRoot, config.promptFile)")
            && prompt_loader.find(".replaceAll(\"${AGENT_TASK}\"")
                < prompt_loader.find(".replaceAll(\"${VALIDATED_PLAN}\""),
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
    let pre_push_task = read(".task/agentic-ai.yml");
    let budget_guard = read(".github/scripts/pr-authored-budget.ts");
    assert!(
        workflow.contains("uses unsupported stacked-PR metadata")
            && !workflow.contains("core.setOutput('multi_pr', 'true')")
            && !workflow.contains(
                "Published multi-PR feature plan requires materialized Workbench feature"
            ),
        "implementation automation must reject legacy stack metadata and omit multi-PR materialization"
    );
    assert!(
        pre_push_task.contains("bun .github/scripts/pr-authored-budget.ts \"{{.PR}}\"")
            && budget_guard.contains("PR_ADDITION_LIMIT = 2_000")
            && budget_guard.contains("summary.authoredLines += added")
            && !budget_guard.contains("REVIEW_GROWTH_STOP"),
        "pre-push must fail closed on the one-PR authored-addition budget"
    );
    Ok(())
}
