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
        "'no-restricted-syntax'",
        "CallExpression[arguments.length=1] > ObjectExpression",
        "named typed value first",
        "files: ['src/**/*.ts', 'tests/**/*.ts']",
        "Model a concrete domain type",
        "must be narrowed immediately",
    ] {
        assert!(
            eslint.contains(required),
            "Loom ESLint config must retain `{required}`"
        );
    }

    let guards = read(&root, "agentic-ai/loom/src/lib/guards.ts");
    for required in [
        "export type ExternalValue =",
        "export type ExternalObject =",
        "export type ExternalObjectBuilder =",
        "export function asExternalValue",
        "export function externalProperty",
        "export enum ExternalPropertyPresence",
    ] {
        assert!(
            guards.contains(required),
            "Loom guards must retain `{required}`"
        );
    }
    assert!(
        !guards.contains("UnknownRecord"),
        "Loom guards must not keep UnknownRecord after the ExternalObject rename"
    );

    let taskfile = read(&root, ".task/agentic-ai.yml");
    for required in ["loom:lint:", "bun run lint", "task: loom:lint"] {
        assert!(
            taskfile.contains(required),
            "Loom Taskfile wiring must retain `{required}`"
        );
    }
}
