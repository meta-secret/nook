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
                    Some(".git" | "node_modules" | "target" | "vendor")
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

fn is_automation_source(path: &Path) -> bool {
    let file_name = path.file_name().and_then(OsStr::to_str).unwrap_or_default();
    if file_name.starts_with("Dockerfile")
        || file_name.ends_with(".Dockerfile")
        || file_name.starts_with(".env.")
        || matches!(file_name, "Taskfile.yml" | "Taskfile.yaml" | "package.json")
        || path.extension().is_none()
    {
        return true;
    }
    matches!(
        path.extension().and_then(OsStr::to_str),
        Some(
            "bash"
                | "cjs"
                | "conf"
                | "cts"
                | "hcl"
                | "js"
                | "jsx"
                | "json"
                | "jsonc"
                | "mjs"
                | "mts"
                | "rb"
                | "rs"
                | "sh"
                | "toml"
                | "ts"
                | "tsx"
                | "yaml"
                | "yml"
                | "zsh"
        )
    )
}

#[test]
fn automation_source_inventory_covers_repository_manifest_conventions() {
    for path in [
        ".codex/hooks.json",
        ".env.development",
        "docker-bake.hcl",
        "product.Dockerfile",
        "service.conf",
        "src/runner.rs",
    ] {
        assert!(is_automation_source(Path::new(path)), "missing {path}");
    }
    for path in ["README.md", "fixtures/image.png", "wordlist.txt"] {
        assert!(!is_automation_source(Path::new(path)), "unexpected {path}");
    }
}

fn is_prohibited_path(path: &Path, script_extension: &str, interface_extension: &str) -> bool {
    let path_text = path.to_string_lossy();
    if path_text.ends_with(script_extension) || path_text.ends_with(interface_extension) {
        return true;
    }
    matches!(
        path.file_name().and_then(OsStr::to_str),
        Some("Pipfile" | "Pipfile.lock" | "poetry.lock" | "pyproject.toml" | "requirements.txt")
    )
}

fn repository_language_violations(root: &Path) -> anyhow::Result<Vec<String>> {
    let language = ["py", "thon"].concat();
    let script_extension = [".", "py"].concat();
    let interface_extension = [script_extension.as_str(), "i"].concat();
    let versioned_runtime = [language.as_str(), "3"].concat();
    let runtime_tokens = [language.as_str(), versioned_runtime.as_str()];
    let mut violations = Vec::new();

    for path in tracked_paths(root)? {
        let relative = path.strip_prefix(root).unwrap_or(&path);
        if is_prohibited_path(relative, &script_extension, &interface_extension) {
            violations.push(format!("{}: prohibited authored file", relative.display()));
            continue;
        }
        if !is_automation_source(relative) {
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
            let words = lowercase.split(|character: char| !character.is_ascii_alphanumeric());
            if words.into_iter().any(|word| runtime_tokens.contains(&word)) {
                violations.push(format!(
                    "{}:{}: prohibited runtime, dependency, or script reference",
                    relative.display(),
                    index + 1
                ));
            }
        }
    }
    Ok(violations)
}

#[test]
fn repository_automation_uses_only_typescript_rust_and_taskfiles() -> anyhow::Result<()> {
    let root = repository_root();
    let violations = repository_language_violations(&root)?;

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
fn sealed_repository_scan_prunes_only_generated_and_dependency_trees() -> anyhow::Result<()> {
    let fixture = std::env::temp_dir().join(format!(
        "nook-language-scan-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));
    fs::create_dir_all(fixture.join("nested"))?;
    fs::create_dir_all(fixture.join("rust-project/src/deep"))?;
    fs::create_dir_all(fixture.join("rust-project/target/generated"))?;
    fs::create_dir_all(fixture.join("node_modules/package"))?;
    fs::write(
        fixture.join("nested/contract.ts"),
        "export const ok = true;\n",
    )?;
    fs::write(fixture.join("rust-project/Cargo.toml"), "[package]\n")?;
    fs::write(fixture.join("rust-project/Taskfile.yml"), "version: '3'\n")?;
    fs::write(
        fixture.join("rust-project/src/deep/implementation.rs"),
        "pub fn value() -> bool { true }\n",
    )?;
    fs::write(
        fixture.join("rust-project/target/generated/ignored.rs"),
        "pub fn generated() -> bool { true }\n",
    )?;
    fs::write(
        fixture.join("node_modules/package/ignored.js"),
        "export const generated = true;\n",
    )?;
    let mut paths = tracked_paths(&fixture)?;
    paths.sort();
    assert_eq!(
        paths,
        vec![
            fixture.join("nested/contract.ts"),
            fixture.join("rust-project/Cargo.toml"),
            fixture.join("rust-project/Taskfile.yml"),
            fixture.join("rust-project/src/deep/implementation.rs"),
        ]
    );
    fs::remove_dir_all(fixture)?;
    Ok(())
}

#[test]
fn repository_language_scan_rejects_scripts_and_runtime_invocations() -> anyhow::Result<()> {
    let fixture = std::env::temp_dir().join(format!(
        "nook-language-violations-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));
    fs::create_dir_all(fixture.join("scripts"))?;
    fs::create_dir_all(fixture.join("rust-project/src"))?;
    fs::create_dir_all(fixture.join(".codex"))?;
    let script_extension = [".", "py"].concat();
    let runtime = ["py", "thon3"].concat();
    fs::write(
        fixture
            .join("scripts")
            .join(format!("fetch-comments{script_extension}")),
        "print('comments')\n",
    )?;
    fs::write(
        fixture.join("Taskfile.yml"),
        format!(
            "version: '3'\ntasks:\n  comments:\n    cmds: [{runtime} fetch-comments{script_extension}]\n"
        ),
    )?;
    fs::write(
        fixture.join("rust-project/src/runner.rs"),
        format!("fn command() {{ Command::new(\"{runtime}\"); }}\n"),
    )?;
    fs::write(
        fixture.join(".codex/hooks.json"),
        format!("{{\"command\": \"{runtime} tool\"}}\n"),
    )?;
    fs::write(
        fixture.join("scripts/product.Dockerfile"),
        format!("RUN {runtime} -m tool\n"),
    )?;
    fs::write(
        fixture.join("scripts/picture-in-picture.ts"),
        "export const pip = shape.pyramid;\n",
    )?;
    fs::write(fixture.join("pyproject.toml"), "[project]\n")?;
    let violations = repository_language_violations(&fixture)?;
    assert_eq!(violations.len(), 6);
    assert!(
        violations
            .iter()
            .any(|violation| violation.contains("prohibited authored file"))
    );
    assert!(
        violations
            .iter()
            .any(|violation| violation.contains("prohibited runtime"))
    );
    fs::remove_dir_all(fixture)?;
    Ok(())
}
