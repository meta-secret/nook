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
            && readme.contains(
                "TypeScript projects co-located under the owning skill's `scripts/` directory"
            )
            && readme.contains("task loom:cortex-audit"),
        "README must distinguish Cortex semantics from executable applications"
    );
    let obsolete = [
        ".agents/skills",
        "agentic-ai/skills",
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
    let cortex_root = root.join(".cortex");
    let mut cortex_pending = vec![cortex_root];
    let mut application_roots = Vec::new();
    while let Some(directory) = cortex_pending.pop() {
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_symlink() || !file_type.is_dir() {
                continue;
            }
            let path = entry.path();
            let is_application_root = path.file_name().is_some_and(|name| name == "scripts")
                && path
                    .parent()
                    .is_some_and(|skill_root| skill_root.join("SKILL.md").is_file())
                && path
                    .parent()
                    .and_then(|skill_root| skill_root.parent())
                    .is_some_and(|owner_root| {
                        owner_root
                            .file_name()
                            .is_some_and(|name| name == "dynamic-skills")
                    });
            if is_application_root {
                application_roots.push(path);
            } else {
                cortex_pending.push(path);
            }
        }
    }
    let mut pending = vec![prompt_root.clone()];
    pending.extend(application_roots);
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            let path = entry.path();
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
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
