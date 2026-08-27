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
    let readme = fs::read_to_string(root.join("README.md"))?;
    let hooks = fs::read_to_string(root.join(".codex/hooks.json"))?;

    anyhow::ensure!(
        readme.contains("Project skill semantics live only in team-owned Markdown under `.cortex`")
            && readme.contains("task loom:cortex-audit"),
        "README must route project skill semantics and validation through Cortex and Loom"
    );
    for obsolete in [".agents/skills", "task skills:", "task impeccable:"] {
        anyhow::ensure!(
            !readme.contains(obsolete) && !hooks.contains(obsolete),
            "active root skill guidance must not reference obsolete `{obsolete}` machinery"
        );
    }
    Ok(())
}
