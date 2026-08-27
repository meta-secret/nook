#[test]
fn active_root_guidance_uses_cortex_skill_authority() -> anyhow::Result<()> {
    let root = std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        std::path::PathBuf::from,
    );
    anyhow::ensure!(!root.join("skills-lock.json").exists());
    let readme = std::fs::read_to_string(root.join("README.md"))?;
    anyhow::ensure!(
        readme.contains("Project skill semantics live only in team-owned Markdown under `.cortex`")
            && readme
                .contains("ordinary Bun and\nTypeScript applications under `agentic-ai/skills`")
            && readme.contains("task loom:cortex-audit"),
        "README must distinguish Cortex semantics from executable applications"
    );
    let obsolete = [
        ".agents/skills",
        ".cursor/skills",
        ".claude/skills",
        "task impeccable:",
        "design-taste-frontend",
    ];
    for path in [
        "README.md",
        "AGENTS.md",
        ".codex/hooks.json",
        "CODEX.md",
        ".cursor/rules.md",
    ] {
        let content = std::fs::read_to_string(root.join(path))?;
        for marker in obsolete {
            anyhow::ensure!(
                !content.contains(marker),
                "{path} references obsolete `{marker}`"
            );
        }
    }
    let prompt_root = root.join(".github/prompts");
    let mut pending = vec![prompt_root.clone(), root.join("agentic-ai/skills")];
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(directory)? {
            let path = entry?.path();
            if path.is_dir() {
                if !path.ends_with("node_modules") {
                    pending.push(path);
                }
            } else if path.file_name().is_some_and(|name| name == "SKILL.md") {
                anyhow::bail!("executable applications cannot mirror skill cards");
            } else if path.starts_with(&prompt_root) {
                let content = std::fs::read_to_string(&path)?;
                for marker in obsolete {
                    anyhow::ensure!(
                        !content.contains(marker),
                        "hosted prompt references `{marker}`"
                    );
                }
            }
        }
    }
    Ok(())
}
