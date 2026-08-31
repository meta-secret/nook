fn is_regular_file(path: &std::path::Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_file())
}

fn is_regular_directory(path: &std::path::Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_dir())
}

fn is_kebab_slug(value: &str) -> bool {
    !value.is_empty()
        && value.split('-').all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit())
        })
}

fn is_valid_application_root(cortex_root: &std::path::Path, path: &std::path::Path) -> bool {
    let Ok(relative) = path.strip_prefix(cortex_root) else {
        return false;
    };
    let parts = relative
        .iter()
        .map(|part| part.to_string_lossy())
        .collect::<Vec<_>>();
    let (slug, canonical_owner) = match parts.as_slice() {
        [owner, dynamic, slug, scripts] => (
            slug.as_ref(),
            matches!(owner.as_ref(), "gizmo" | "shared")
                && dynamic == "dynamic-skills"
                && scripts == "scripts",
        ),
        [teams, team, dynamic, slug, scripts] => (
            slug.as_ref(),
            teams == "teams"
                && matches!(
                    team.as_ref(),
                    "ai" | "dev-core" | "security" | "sre" | "web-dev"
                )
                && dynamic == "dynamic-skills"
                && scripts == "scripts",
        ),
        _ => return false,
    };
    let skill_root = path.parent().unwrap_or(path);
    canonical_owner
        && is_kebab_slug(slug)
        && is_regular_file(&skill_root.join("SKILL.md"))
        && [
            ".gitignore",
            ".prettierrc",
            "eslint.config.js",
            "executable-skill.json",
            "package.json",
            "tsconfig.json",
        ]
        .iter()
        .all(|name| is_regular_file(&path.join(name)))
        && ["src", "tests"]
            .iter()
            .all(|name| is_regular_directory(&path.join(name)))
}

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
    let mut cortex_pending = vec![cortex_root.clone()];
    let mut application_roots = Vec::new();
    while let Some(directory) = cortex_pending.pop() {
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_symlink() || !file_type.is_dir() {
                continue;
            }
            let path = entry.path();
            let is_application_root = is_valid_application_root(&cortex_root, &path);
            if is_application_root {
                application_roots.push(path);
            } else {
                cortex_pending.push(path);
            }
        }
    }
    application_roots.sort();
    let taskfile = std::fs::read_to_string(root.join(".task/agentic-ai.yml"))?;
    anyhow::ensure!(
        !taskfile.contains("SKILL_APPLICATION_DIRS"),
        "skills tasks cannot maintain a manual executable-package inventory"
    );
    let package_gate = "agentic-ai/loom/src/executable-skills/package-gate-cli.ts";
    anyhow::ensure!(
        taskfile.matches(package_gate).count() == 3,
        "skills install, format, and verify must use canonical package discovery"
    );
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
