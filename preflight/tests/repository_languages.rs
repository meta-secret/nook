use std::{
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

fn tracked_paths(root: &Path) -> anyhow::Result<Vec<PathBuf>> {
    if !root.join(".git").exists() {
        return filesystem_paths(root);
    }
    let output = Command::new("git")
        .args([
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ])
        .current_dir(root)
        .output()?;
    anyhow::ensure!(output.status.success(), "git ls-files failed");
    Ok(output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(|path| root.join(String::from_utf8_lossy(path).as_ref()))
        .filter(|path| path.is_file())
        .collect())
}

fn filesystem_paths(root: &Path) -> anyhow::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    let mut directories = vec![root.to_path_buf()];
    while let Some(directory) = directories.pop() {
        for entry in fs::read_dir(&directory)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                if !matches!(
                    path.file_name().and_then(OsStr::to_str),
                    Some(".git" | "node_modules" | "target")
                ) {
                    directories.push(path);
                }
            } else if path.is_file() {
                files.push(path);
            }
        }
    }
    Ok(files)
}

fn is_documentation(path: &Path) -> bool {
    matches!(path.extension().and_then(OsStr::to_str), Some("md" | "txt"))
}

#[test]
fn repository_automation_uses_only_typescript_rust_and_taskfiles() -> anyhow::Result<()> {
    let root = repository_root();
    let language = ["py", "thon"].concat();
    let script_extension = [".", "py"].concat();
    let interface_extension = [script_extension.as_str(), "i"].concat();
    let versioned_runtime = [language.as_str(), "3"].concat();
    let runtime_tokens = [language.as_str(), versioned_runtime.as_str()];
    let mut violations = Vec::new();

    for path in tracked_paths(&root)? {
        let relative = path.strip_prefix(&root).unwrap_or(&path);
        let relative_text = relative.to_string_lossy();
        if relative_text.ends_with(&script_extension)
            || relative_text.ends_with(&interface_extension)
        {
            violations.push(format!("{}: prohibited authored file", relative.display()));
            continue;
        }
        if is_documentation(&path) {
            continue;
        }
        let Ok(source) = fs::read_to_string(&path) else {
            continue;
        };
        for (index, line) in source.lines().enumerate() {
            let trimmed = line.trim_start();
            if trimmed.starts_with("//")
                || (trimmed.starts_with('#') && !trimmed.starts_with("#!"))
                || trimmed.starts_with('*')
            {
                continue;
            }
            let lowercase = line.to_ascii_lowercase();
            if runtime_tokens.iter().any(|token| {
                lowercase
                    .split(|character: char| !character.is_ascii_alphanumeric())
                    .any(|word| word == *token)
            }) {
                violations.push(format!(
                    "{}:{}: prohibited runtime or dependency reference",
                    relative.display(),
                    index + 1
                ));
            }
        }
    }

    assert!(
        violations.is_empty(),
        "P1 repository language violation. Automation must use Bun/TypeScript, Rust, or Taskfiles.\n{}",
        violations.join("\n")
    );
    Ok(())
}

#[test]
fn repository_language_rule_stays_wired_to_agent_guidance() -> anyhow::Result<()> {
    let root = repository_root();
    let language = ["Py", "thon"].concat();
    let agents = fs::read_to_string(root.join(".cortex/AGENTS.md"))?;
    let canonical = fs::read_to_string(
        root.join(".cortex/shared/dynamic-skills/typescript-rust-automation-only.md"),
    )?;
    for (name, source) in [
        ("agent operating contract", agents.as_str()),
        ("canonical language skill", canonical.as_str()),
    ] {
        assert!(
            source.contains(&language),
            "{name} must name the prohibited language"
        );
        assert!(source.contains("Bun") && source.contains("TypeScript"));
        assert!(source.contains("Rust") && source.contains("Taskfile"));
        assert!(source.contains("P1") || source.contains("hard rule"));
    }
    Ok(())
}

#[test]
fn sealed_repository_scan_does_not_require_git_metadata() -> anyhow::Result<()> {
    let fixture = std::env::temp_dir().join(format!(
        "nook-language-scan-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));
    fs::create_dir_all(fixture.join("nested"))?;
    fs::write(
        fixture.join("nested/contract.ts"),
        "export const ok = true;\n",
    )?;
    let paths = tracked_paths(&fixture)?;
    assert_eq!(paths, vec![fixture.join("nested/contract.ts")]);
    fs::remove_dir_all(fixture)?;
    Ok(())
}
