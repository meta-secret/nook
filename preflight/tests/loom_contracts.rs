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
#[expect(
    clippy::too_many_lines,
    reason = "one integration contract documents the complete Loom quality boundary"
)]
fn loom_verify_enforces_loom_typescript_eslint_rules() {
    let root = RepositoryFixture::repository_root();
    let manifest = root.read("agentic-ai/loom/package.json");
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

    let eslint = root.read("agentic-ai/loom/eslint.config.js");
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

    let guards = root.read("agentic-ai/loom/src/lib/guards.ts");
    for required in [
        "export type UntrustedYamlNode =",
        "export type UntrustedYamlMap =",
        "export type UntrustedYamlMapBuilder =",
        "export class UntrustedYamlBoundary",
        "static fromHost",
        "static property",
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

    let taskfile = root.read(".task/agentic-ai.yml");
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
    let skills_workspace = root.read(".cortex/package.json");
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
    let skills_bunfig = root.read(".cortex/bunfig.toml");
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
        pre_push.contains("deps: [loom:install, tooling:install]")
            && pre_push.contains("task loom:default FAMILY=prePush")
            && !pre_push.contains("skills:"),
        "loom:pre-push must retain Loom setup without a harness skill workspace"
    );

    let preflight = root.read("preflight/Taskfile.yml");
    let format_contract = task_body(&preflight, "preflight:format-contract", "preflight:export");
    assert!(
        format_contract
            .contains("bash \"{{.REPO_ROOT}}/.github/scripts/format-host-apply.test.sh\"")
            && !format_contract.contains("deps:")
            && !format_contract.contains("install")
            && !format_contract.contains("loom:"),
        "the formatter contract must be a detached, install-free preflight task"
    );

    let skills_manifest =
        root.read(".cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/package.json");
    assert!(
        skills_manifest.contains("\"verify\":")
            && skills_manifest.contains("\"zod\":")
            && skills_manifest.contains("\"neverthrow\":")
    );
    let skills_eslint = root
        .read(".cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/eslint.config.js");
    assert!(
        skills_eslint.contains("files: ['src/**/*.ts', 'tests/**/*.ts']")
            && skills_eslint.contains("'max-params': ['error', { max: 1 }]")
            && skills_eslint.contains("unknown:"),
        "executable applications must retain repository TypeScript rules"
    );
    let skills_typescript =
        root.read(".cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/tsconfig.json");
    assert!(skills_typescript.contains("\"include\": [\"src/**/*.ts\", \"tests/**/*.ts\"]"));
    let source_gate = root.read("agentic-ai/loom/tests/skill-application-source-boundary.test.ts");
    assert!(
        source_gate.contains("ExecutableSkillSource.analyze")
            && source_gate
                .contains(".cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts")
            && source_gate.contains("new ExecutableSkillCheckout(")
            && source_gate.contains(").readTrackedFiles()"),
        "loom:verify must AST-audit every tracked executable application source"
    );
    let tracked_inventory = root.read("agentic-ai/loom/src/executable-skills/repository.ts");
    assert!(
        tracked_inventory.contains("['ls-files', '--stage', '-z']")
            && tracked_inventory.contains("readTrackedFiles(): Result<"),
        "executable application gates must share the NUL-safe staged inventory"
    );
}

#[test]
fn loom_workflow_audits_every_cortex_change() {
    let root = RepositoryFixture::repository_root();
    let workflow = root.read(".github/workflows/repository-policy.yml");
    let taskfile = root.read(".task/ci-workflows.yml");
    assert!(
        workflow.contains("workflow_call:")
            && !workflow.contains("paths:")
            && !workflow.contains("paths-ignore:"),
        "repository policy must validate every PR and Main tree"
    );
    assert!(
        workflow.contains("fetch-depth: 0")
            && !workflow.contains("BASELINE_SHA")
            && !workflow.contains("BEFORE_SHA")
            && !workflow.contains("git diff")
            && !workflow.contains("policy-paths")
            && !workflow.contains("cortex_markdown_only"),
        "repository policy must fetch identifier history without inline base comparison or path classification"
    );
    assert!(
        !workflow.contains("arc-manifest-contract.ts")
            && !workflow.contains("runner_placement")
            && !workflow.contains("run: |")
            && !workflow.contains("run: bun ")
            && !workflow.contains("run: bash "),
        "repository policy must contain only Actions setup glue and thin Task invocations"
    );
    assert!(
        taskfile.contains("task: preflight:repository-policy"),
        "both trust domains must use the Docker policy Task surface"
    );
    let dockerfile = root.read("preflight/Dockerfile");
    for task in [
        "task loom:verify",
        "task preflight:format-contract",
        "task loom:cortex-audit",
    ] {
        assert!(
            dockerfile.contains(task),
            "Docker policy must retain `{task}`"
        );
    }
    assert!(
        workflow.contains("run: task ci:repository-policy:trusted")
            && workflow.contains("run: task ci:repository-policy:untrusted"),
        "trusted and untrusted workflow branches must delegate policy behavior to Taskfile"
    );
}
