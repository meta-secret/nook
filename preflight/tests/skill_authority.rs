use std::{fs, path::PathBuf};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

#[test]
fn active_root_guidance_uses_cortex_skill_authority() -> anyhow::Result<()> {
    let root = repository_root();
    let inputs = [
        ("README.md", fs::read_to_string(root.join("README.md"))?),
        (
            ".codex/hooks.json",
            fs::read_to_string(root.join(".codex/hooks.json"))?,
        ),
        (
            "skills-lock.json",
            fs::read_to_string(root.join("skills-lock.json"))?,
        ),
        ("CODEX.md", fs::read_to_string(root.join("CODEX.md"))?),
        (
            ".cursor/rules.md",
            fs::read_to_string(root.join(".cursor/rules.md"))?,
        ),
    ];
    let readme = &inputs[0].1;

    anyhow::ensure!(
        readme.contains("Project skill semantics live only in team-owned Markdown under `.cortex`")
            && readme.contains("task loom:cortex-audit"),
        "README must route project skill semantics and validation through Cortex and Loom"
    );
    for obsolete in [
        ".agents/skills",
        "task skills:",
        "task impeccable:",
        "design-taste-frontend",
    ] {
        for (path, content) in &inputs {
            anyhow::ensure!(
                !content.contains(obsolete),
                "active authority input {path} references obsolete `{obsolete}` machinery"
            );
        }
    }
    Ok(())
}
