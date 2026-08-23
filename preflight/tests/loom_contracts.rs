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

fn read(root: &Path, path: &str) -> String {
    fs::read_to_string(root.join(path))
        .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
}

#[test]
fn loom_verify_enforces_loom_typescript_eslint_rules() {
    let root = repository_root();
    let manifest = read(&root, "agentic-ai/loom/package.json");
    for required in [
        "\"lint\": \"eslint src tests\"",
        "\"lint:tooling\":",
        "\"check\": \"tsc --noEmit && bun run lint:tooling\"",
        "\"verify\": \"bun run format:check && bun run lint && bun run check && bun test\"",
        "\"eslint\":",
    ] {
        assert!(
            manifest.contains(required),
            "Loom package.json must retain `{required}`"
        );
    }

    let eslint = format!(
        "{}\n{}",
        read(&root, "agentic-ai/loom/eslint.config.js"),
        read(&root, "tooling/eslint-rules/no-raw-object-arguments.js")
    );
    for required in [
        "'max-params': ['error', { max: 1 }]",
        "'@typescript-eslint/no-restricted-types'",
        "unknown:",
        "object:",
        "Object:",
        "'{}':",
        "'@typescript-eslint/no-explicit-any': 'error'",
        "'@typescript-eslint/no-empty-object-type': 'error'",
        "'no-raw-object-arguments': noRawObjectArguments",
        "'loom/no-raw-object-arguments': 'error'",
        "../../tooling/eslint-rules/no-raw-object-arguments.js",
        "transparentTypeScriptWrappers",
        "ConditionalExpression",
        "LogicalExpression",
        "SequenceExpression",
        "named typed value first",
        "files: ['src/**/*.ts', 'tests/**/*.ts']",
        "Model a concrete domain type",
        "generic object type",
        "must be narrowed immediately",
        "ExternalValue",
        "ExternalObject",
        "JsonValue",
        "GenericValue",
    ] {
        assert!(
            eslint.contains(required),
            "Loom ESLint config must retain `{required}`"
        );
    }

    let guards = read(&root, "agentic-ai/loom/src/lib/guards.ts");
    for required in [
        "export type UntrustedYamlNode =",
        "export type UntrustedYamlMap =",
        "export type UntrustedYamlMapBuilder =",
        "export function asUntrustedYamlNode",
        "export function untrustedYamlProperty",
        "export enum UntrustedYamlPropertyPresence",
    ] {
        assert!(
            guards.contains(required),
            "Loom guards must retain `{required}`"
        );
    }
    assert!(
        !guards.contains("UnknownRecord"),
        "Loom guards must not keep UnknownRecord after the UntrustedYamlMap rename"
    );
    assert!(
        !guards.contains("ExternalValue") && !guards.contains("ExternalObject"),
        "Loom must not restore generic external value aliases"
    );

    let taskfile = read(&root, ".task/agentic-ai.yml");
    for required in ["loom:lint:", "bun run lint", "task: loom:lint"] {
        assert!(
            taskfile.contains(required),
            "Loom Taskfile wiring must retain `{required}`"
        );
    }
}

#[test]
fn loom_workflow_audits_every_cortex_change() {
    let root = repository_root();
    let workflow = read(&root, ".github/workflows/repository-policy.yml");
    assert!(
        workflow.contains("fetch-depth: 2"),
        "Loom checkout must retain the baseline parent for migration-ledger shrink-only checks"
    );

    assert!(
        workflow.contains("      - .cortex/**") && workflow.contains(".cortex/* |"),
        "repository policy must classify Cortex PR changes and trigger on Cortex Main pushes"
    );
    assert!(
        workflow.contains("echo \"loom=$loom_changed\" >> \"$GITHUB_OUTPUT\"")
            && workflow.contains("git diff --no-renames --name-only HEAD^1 HEAD^2")
            && workflow
                .matches("if: steps.policy-paths.outputs.loom == 'true'")
                .count()
                == 5,
        "repository policy must classify rename sources and condition every Loom-only step"
    );
    assert!(
        workflow.contains("run: task loom:cortex-audit"),
        "Loom must run the mechanical Cortex audit"
    );
}

#[test]
fn mechanical_cortex_audit_timeout_covers_executable_skill_lifecycle() {
    let root = repository_root();
    let budgets = read(
        &root,
        "agentic-ai/loom/src/agent-workflow/executable-skill-budget.ts",
    );
    let lifecycle_budgets = read(&root, "agentic-ai/loom/src/executable-skills/budgets.ts");
    let workflow = read(
        &root,
        "agentic-ai/loom/src/agent-workflow/cortex-workflow.ts",
    );
    let validation = read(
        &root,
        "agentic-ai/loom/src/agent-workflow/executable-skill-timeout-validation.ts",
    );
    for required in [
        "executableSkillWorkflowMinimumTimeoutMs",
        "MAXIMUM_REGISTERED_EXECUTABLE_SKILL_TIMEOUT_MS",
    ] {
        assert!(
            budgets.contains(required),
            "mechanical Cortex audit budget must retain `{required}`"
        );
    }
    assert!(
        lifecycle_budgets.contains("EXECUTABLE_SKILL_WORKFLOW_ORCHESTRATION_MARGIN_MS"),
        "executable-skill workflow budget must retain an orchestration margin"
    );
    assert!(
        workflow.contains("timeoutMs: MECHANICAL_CORTEX_AUDIT_MINIMUM_TIMEOUT_MS"),
        "mechanical Cortex audit must use the executable-skill lifecycle budget"
    );
    assert!(
        validation.contains("WorkflowValidationIssueKind.InsufficientTimeout")
            && validation.contains("MECHANICAL_CORTEX_AUDIT_MINIMUM_TIMEOUT_MS"),
        "workflow validation must reject a mechanical audit timeout below the lifecycle budget"
    );
}
