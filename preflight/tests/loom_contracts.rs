use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn repository_root() -> PathBuf {
    env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

fn read(root: &Path, path: &str) -> String {
    fs::read_to_string(root.join(path))
        .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
}

fn workflow_step<'a>(workflow: &'a str, name: &str) -> &'a str {
    let marker = format!("      - name: {name}\n");
    let start = workflow
        .find(&marker)
        .unwrap_or_else(|| panic!("repository policy must contain the named `{name}` step"));
    let step = &workflow[start..];
    let end = step[1..]
        .find("\n      - name:")
        .map_or(step.len(), |offset| offset + 1);
    &step[..end]
}

fn task_body<'a>(taskfile: &'a str, task: &str, next_task: &str) -> &'a str {
    let start_marker = format!("  {task}:\n");
    let end_marker = format!("  {next_task}:\n");
    let start = taskfile
        .find(&start_marker)
        .unwrap_or_else(|| panic!("missing task {task}"));
    let body = &taskfile[start..];
    let end = body
        .find(&end_marker)
        .unwrap_or_else(|| panic!("missing following task {next_task}"));
    &body[..end]
}

#[test]
fn loom_verify_enforces_loom_typescript_eslint_rules() {
    let root = repository_root();
    let manifest = read(&root, "agentic-ai/loom/package.json");
    for required in [
        "\"lint\": \"eslint src tests\"",
        "\"check\": \"tsc --noEmit\"",
        "\"verify\": \"bun run format:check && bun run lint && bun run check && bun test\"",
        "\"eslint\":",
    ] {
        assert!(
            manifest.contains(required),
            "Loom package.json must retain `{required}`"
        );
    }

    let eslint = read(&root, "agentic-ai/loom/eslint.config.js");
    for required in [
        "'max-params': ['error', { max: 1 }]",
        "'@typescript-eslint/no-restricted-types'",
        "unknown:",
        "object:",
        "Object:",
        "'{}':",
        "'@typescript-eslint/no-explicit-any': 'error'",
        "'@typescript-eslint/no-empty-object-type': 'error'",
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

    let skills_install = task_body(&taskfile, "skills:install", "skills:format");
    assert!(
        skills_install.contains("package-gate-cli.ts\" install")
            && skills_install.contains("{{.REPO_ROOT}}"),
        "executable applications must install their pinned workspace"
    );
    let skills_workspace = read(&root, ".cortex/package.json");
    for required in [
        "@nook/executable-skills-workspace",
        "gizmo/dynamic-skills/*/scripts",
        "shared/dynamic-skills/*/scripts",
        "teams/*/dynamic-skills/*/scripts",
    ] {
        assert!(
            skills_workspace.contains(required),
            "executable-skill workspace must retain `{required}`"
        );
    }
    let skills_bunfig = read(&root, ".cortex/bunfig.toml");
    assert!(
        skills_bunfig.contains("linker = \"hoisted\""),
        "executable-skill workspace must retain one hoisted dependency tree"
    );
    let skills_verify = task_body(&taskfile, "skills:verify", "loom:install");
    assert!(
        skills_verify.contains("deps: [skills:install]")
            && skills_verify.contains("package-gate-cli.ts\" verify"),
        "skills:verify must run every complete workspace package gate"
    );

    let loom_install = task_body(&taskfile, "loom:install", "loom:format");
    assert!(
        loom_install.contains("bun install --frozen-lockfile")
            && !loom_install.contains("skills:install"),
        "loom:install must install only Loom dependencies"
    );
    let loom_verify = task_body(&taskfile, "loom:verify", "loom:run");
    assert!(
        loom_verify.contains("task: skills:verify") && loom_verify.contains("task: loom:test"),
        "loom:verify must include executable applications and Loom"
    );
    let pre_push = task_body(&taskfile, "loom:pre-push", "loom:cortex-audit");
    assert!(
        pre_push.contains("deps: [loom:install]")
            && pre_push.contains("task loom:default FAMILY=prePush")
            && !pre_push.contains("skills:"),
        "loom:pre-push must retain Loom setup without a harness skill workspace"
    );

    let preflight = read(&root, "preflight/Taskfile.yml");
    let format_contract = task_body(&preflight, "preflight:format-contract", "preflight:export");
    assert!(
        format_contract
            .contains("bash \"{{.REPO_ROOT}}/.github/scripts/format-host-apply.test.sh\"")
            && !format_contract.contains("deps:")
            && !format_contract.contains("install")
            && !format_contract.contains("loom:"),
        "the formatter contract must be a detached, install-free preflight task"
    );

    let skills_manifest = read(
        &root,
        ".cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/package.json",
    );
    assert!(
        skills_manifest.contains("\"verify\":") && !skills_manifest.contains("\"dependencies\"")
    );
    let skills_eslint = read(
        &root,
        ".cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/eslint.config.js",
    );
    assert!(
        skills_eslint.contains("files: ['src/**/*.ts', 'tests/**/*.ts']")
            && skills_eslint.contains("'max-params': ['error', { max: 1 }]")
            && skills_eslint.contains("unknown:"),
        "executable applications must retain repository TypeScript rules"
    );
    let skills_typescript = read(
        &root,
        ".cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/tsconfig.json",
    );
    assert!(skills_typescript.contains("\"include\": [\"src/**/*.ts\", \"tests/**/*.ts\"]"));
    let source_gate = read(
        &root,
        "agentic-ai/loom/tests/skill-application-source-boundary.test.ts",
    );
    assert!(
        source_gate.contains("analyzeExecutableSkillSource")
            && source_gate
                .contains(".cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts")
            && source_gate.contains("readTrackedRepositoryFiles"),
        "loom:verify must AST-audit every tracked executable application source"
    );
    let tracked_inventory = read(&root, "agentic-ai/loom/src/executable-skills/repository.ts");
    assert!(
        tracked_inventory.contains("['ls-files', '--stage', '-z']")
            && tracked_inventory.contains("readTrackedRepositoryFiles"),
        "executable application gates must share the NUL-safe staged inventory"
    );
}

#[test]
fn loom_workflow_audits_every_cortex_change() {
    let root = repository_root();
    let workflow = read(&root, ".github/workflows/repository-policy.yml");
    assert!(
        workflow.contains("fetch-depth: 0"),
        "repository policy must retain full history for exact stacked-base availability"
    );

    assert!(
        workflow.contains("      - .cortex/**") && workflow.contains(".cortex/* |"),
        "repository policy must classify Cortex PR changes and trigger on Cortex Main pushes"
    );
    assert!(
        workflow.contains("      - .agents/skills/**")
            && workflow.contains(".agents/skills/* |")
            && workflow.contains("      - .cortex/**/dynamic-skills/*/scripts/**")
            && workflow.contains(".cortex/*/dynamic-skills/*/scripts/* |"),
        "repository policy must trigger for prohibited mirrors and canonical applications"
    );
    assert!(
        workflow.contains("echo \"loom=$loom_changed\" >> \"$GITHUB_OUTPUT\"")
            && workflow.contains("git diff --no-renames --name-only HEAD^1 HEAD^2")
            && workflow
                .matches("steps.policy-paths.outputs.loom == 'true'")
                .count()
                == 7,
        "repository policy must classify rename sources and condition every Loom-only step"
    );
    assert!(
        workflow.contains(".cortex/*.md) ;;")
            && workflow.contains("*) cortex_markdown_only=false ;;")
            && workflow.contains(
                "if [ \"$changed\" != \"true\" ]; then\n            cortex_markdown_only=false"
            )
            && workflow.contains(
                "echo \"cortex_markdown_only=$cortex_markdown_only\" >> \"$GITHUB_OUTPUT\"",
            ),
        "repository policy must classify only non-empty Cortex Markdown changes as lightweight"
    );
    for trigger_path in [
        ".github/formatting/**",
        ".github/scripts/format-host-apply.sh",
        ".github/scripts/format-host-apply.test.sh",
    ] {
        assert!(
            workflow.contains(trigger_path),
            "repository policy must trigger for formatter authority `{trigger_path}`"
        );
    }
    let format_step = workflow_step(&workflow, "Enforce shared source formatter contract");
    assert!(
        format_step.contains("run: task preflight:format-contract")
            && format_step
                .contains("if: steps.policy-paths.outputs.cortex_markdown_only != 'true'",)
            && !format_step.contains("install"),
        "repository policy must skip the detached formatter only for Cortex Markdown"
    );

    let cortex_audit_step = workflow_step(&workflow, "Audit Cortex document structure");
    assert!(
        cortex_audit_step.contains("if: steps.policy-paths.outputs.loom == 'true'")
            && cortex_audit_step.contains("run: task loom:cortex-audit")
            && !cortex_audit_step.contains("cortex_markdown_only"),
        "Loom must audit Cortex Markdown even when detached formatter work is skipped"
    );

    for (step_name, task) in [
        (
            "Enforce authored TypeScript state invariants",
            "task preflight:typescript-state",
        ),
        (
            "Enforce Loom single-parameter contract",
            "task preflight:loom-contracts",
        ),
    ] {
        let hosted_preflight_step = workflow_step(&workflow, step_name);
        assert!(
            hosted_preflight_step
                .contains("steps.policy-paths.outputs.cortex_markdown_only != 'true'")
                && hosted_preflight_step.contains("github.event_name == 'pull_request'")
                && hosted_preflight_step.contains(task),
            "hosted `{step_name}` must skip Cargo-backed preflight for Cortex Markdown only"
        );
    }
}
