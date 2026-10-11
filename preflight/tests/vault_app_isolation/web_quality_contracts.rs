use super::RepositoryFixture;
use serde::Deserialize;

#[derive(Deserialize)]
struct TypeScriptLintProject {
    include: Vec<String>,
    exclude: Vec<String>,
}

#[test]
fn typed_lint_project_covers_authored_sources_and_excludes_generated_bindings() -> anyhow::Result<()>
{
    let root = RepositoryFixture::repository_root();
    let project: TypeScriptLintProject =
        serde_json::from_str(&root.read("nook-app/nook-web/tsconfig.eslint.json"))?;
    for required in ["**/*.ts", "**/*.svelte"] {
        assert!(
            project.include.iter().any(|pattern| pattern == required),
            "the typed lint project must cover authored sources matching {required}"
        );
    }
    for required in [
        "nook-web-shared/src/vault-app/lib/nook-wasm",
        "nook-web-shared/src/extension/nook-companion-wasm",
    ] {
        assert!(
            project.exclude.iter().any(|pattern| pattern == required),
            "the typed lint project must exclude generated bindings at {required}"
        );
    }
    assert!(
        !project
            .exclude
            .iter()
            .any(|pattern| pattern.contains("nook-web-extension")),
        "the typed lint project must not exclude authored extension sources"
    );
    Ok(())
}
