use anyhow::Context as _;

use super::read;

pub(super) fn assert_contract(workflow: &str) -> anyhow::Result<()> {
    let implement = read("agentic-ai/ci-agent/src/main/implement.ts");
    let run_agent = read("agentic-ai/ci-agent/src/main/run-agent.ts");
    for required in [
        "ImplementPrTargetKind.Stacked",
        "budgetBaseRef: input.baseSha",
        "Stacked continuation requires CURSOR_API_KEY",
        "Stacked continuation produced a clean working tree",
        "validateStackDeliveryState",
        "Live stacked predecessor must remain open and unmerged",
        "Stacked PR head or frozen live base changed before delivery",
        "Stacked publication did not advance the exact frozen PR head",
        "baseRef: target.budgetBaseRef",
        "target.baseBranch",
        "AgentIsolation.Strict",
    ] {
        assert!(
            implement.contains(required),
            "bounded implementation is missing stacked-PR handling: {required}"
        );
    }
    for required in [
        "sanitizeAgentEnvironment(process.env)",
        "AGENT_ENV_ALLOWLIST",
        "restoreHostEnvironment(hostEnvironment, process.env)",
        "readBoundary: \"workspace\"",
        "Implementation source must not provide Cursor sandbox policy",
        "disallowedTools: [\"task\", \"mcp\"]",
        "sandboxOptions: { enabled: true }",
        "sandboxOptions: { enabled: false }",
        "isolation: AgentIsolation = AgentIsolation.Legacy",
    ] {
        assert!(
            run_agent.contains(required),
            "implementation agent isolation is missing: {required}"
        );
    }
    let generic_fix = read("agentic-ai/ci-agent/src/main/fix.ts");
    let generic_agent = read("agentic-ai/ci-agent/src/main/main.ts");
    assert!(
        !generic_fix.contains("AgentIsolation.Strict")
            && generic_agent.contains("await runFixAgent(config, prompt);")
            && generic_agent.contains("await runFixAgent(config, prompt, AgentIsolation.Strict);"),
        "planning and implementation must be strict without changing generic or weekly fix behavior"
    );
    let plan_script = read(".github/scripts/ci-agent-plan.sh");
    assert!(
        plan_script.contains("CI_AGENT_CMD=plan") && !plan_script.contains("CI_AGENT_CMD=agent"),
        "the unreviewed-source planner must select the explicit strict command"
    );
    for required in [
        "state: 'all'",
        "pull.state === 'open'",
        "pull.merged",
        "was closed without merge; preserve it for explicit recovery",
        "github.rest.repos.getBranch",
        "exists without a PR; preserve it for explicit recovery",
        "core.setOutput('terminal', 'false')",
    ] {
        assert!(
            workflow.contains(required),
            "standalone rerun recovery is missing: {required}"
        );
    }
    let git = read("agentic-ai/ci-agent/src/main/git.ts");
    for required in [
        ".nook-workbench-plan.md",
        ".nook-workbench-worklog.md",
        "excludeAgentRuntimeArtifacts(repoRoot)",
        "...AGENT_RUNTIME_EXCLUSIONS",
    ] {
        assert!(
            git.contains(required),
            "trusted delivery must exclude runtime artifact: {required}"
        );
    }
    assert!(
        workflow.contains("Run sandboxed implementation agent")
            && workflow.contains("Validate, commit, and publish implementation")
            && workflow.contains("CI_AGENT_CMD=deliver")
            && !workflow.contains(
                "CURSOR_API_KEY: ${{ secrets.CURSOR_API_KEY }}\n          NOOK_GITHUB_PAT"
            ),
        "untrusted editing and credentialed delivery must be separate processes"
    );
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
    let rerun_position = workflow
        .find("Resolve standalone prompt rerun")
        .context("prompt reruns must resolve an existing PR before implementation")?;
    let local_action_position = workflow
        .find("uses: ./.github/actions/nook-docker-setup")
        .context("bounded automation must retain its trusted local setup action")?;
    assert!(
        trusted_checkout_position < claim_position
            && claim_position < implementation_position
            && rerun_position < implementation_position
            && trusted_checkout_position < local_action_position,
        "trusted tooling must remain separate from the validated implementation worktree"
    );
    Ok(())
}
