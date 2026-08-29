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
        plan_script.contains("CI_AGENT_TOOLING_ROOT=\"$ROOT\"")
            && plan_script.contains("dist/main/main.js\" plan")
            && !plan_script.contains("CI_AGENT_CMD=agent")
            && !plan_script.contains("task ci-agent"),
        "the unreviewed-source planner must select the explicit strict command"
    );
    let change_detection = read(".github/scripts/ci-agent-change-detect.sh");
    for required in [
        "reset --quiet HEAD -- \"${artifacts[@]}\"",
        "status --porcelain --untracked-files=all",
        "':(exclude).nook-workbench-plan.md'",
        "':(exclude).nook-workbench-worklog.md'",
        "echo \"changed=true\" >> \"$GITHUB_OUTPUT\"",
        "echo \"changed=false\" >> \"$GITHUB_OUTPUT\"",
    ] {
        assert!(
            change_detection.contains(required),
            "trusted edit result classification is missing: {required}"
        );
    }
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
            && workflow.contains("dist/main/main.js\" edit")
            && workflow.contains("dist/main/main.js\" deliver")
            && workflow
                .matches("CI_AGENT_TOOLING_ROOT=\"$GITHUB_WORKSPACE\"")
                .count()
                == 2
            && !workflow.contains("dist/main/main.js\" implement")
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
        .find("uses: ./.github/actions/nook-node-setup")
        .context("bounded automation must retain its trusted local Node setup action")?;
    let format_position = workflow
        .find("Format implementation on trusted host")
        .context("trusted host formatting must follow sandboxed editing")?;
    let deliver_position = workflow
        .find("Validate, commit, and publish implementation")
        .context("trusted delivery must follow host formatting")?;
    assert!(
        trusted_checkout_position < claim_position
            && claim_position < implementation_position
            && rerun_position < implementation_position
            && trusted_checkout_position < local_action_position
            && implementation_position < format_position
            && format_position < deliver_position,
        "trusted tooling must remain separate from the validated implementation worktree"
    );
    for required in [
        "git -C \"$IMPLEMENTATION_REPO_ROOT\" diff --name-only -z HEAD",
        "NOOK_REPO_ROOT=\"$IMPLEMENTATION_REPO_ROOT\"",
        "NOOK_FORMATTER_ROOT=\"$GITHUB_WORKSPACE/.github/formatting\"",
        "bash \"$GITHUB_WORKSPACE/.github/formatting/format.sh\"",
        "bash \"$GITHUB_WORKSPACE/.github/scripts/ci-agent-change-detect.sh\"",
        "steps.agent_edit.outputs.changed == 'true'",
        "steps.format.outcome == 'success'",
        "always() &&\n          steps.rerun.outputs.terminal != 'true'",
    ] {
        assert!(
            workflow.contains(required),
            "trusted host formatting is missing: {required}"
        );
    }
    for forbidden in [
        "nook-docker-setup",
        "go-task/setup-task",
        "task setup",
        "run: task",
        "docker run",
        "podman",
        "CI_AGENT_CMD=implement",
        "CI_AGENT_CMD=deliver",
    ] {
        assert!(
            !workflow.contains(forbidden),
            "agent implementation ARC path must not use runtime dependency: {forbidden}"
        );
    }
    let prompt = read(".github/prompts/agent-implement.md");
    assert!(
        !prompt.contains("task format")
            && prompt.contains("The trusted harness applies the deterministic repository")
            && prompt.contains("formatter after the editor exits"),
        "sandboxed implementation must leave formatting to trusted host tooling"
    );
    Ok(())
}
