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
                == 5,
        "repository policy must classify rename sources and condition every Loom-only step"
    );
    assert!(
        workflow.contains("run: task loom:cortex-audit"),
        "Loom must run the mechanical Cortex audit"
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
    let format_step_start = workflow
        .find("      - name: Enforce shared source formatter contract\n")
        .expect("repository policy must contain the named formatter contract step");
    let format_step = &workflow[format_step_start..];
    let format_step_end = format_step[1..]
        .find("\n      - name:")
        .map_or(format_step.len(), |offset| offset + 1);
    let format_step = &format_step[..format_step_end];
    assert!(
        format_step.contains("run: task preflight:format-contract")
            && !format_step.contains("if:")
            && !format_step.contains("install"),
        "repository policy must always run the detached formatter contract"
    );
}
