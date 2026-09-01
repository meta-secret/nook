use std::{
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

fn repository_paths(root: &Path) -> anyhow::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    let mut directories = vec![root.to_path_buf()];
    while let Some(directory) = directories.pop() {
        for entry in fs::read_dir(&directory)? {
            let entry = entry?;
            let path = entry.path();
            let file_type = entry.file_type()?;
            let ignored = matches!(
                path.file_name().and_then(OsStr::to_str),
                Some(
                    ".cache"
                        | ".git"
                        | ".svelte-kit"
                        | "build"
                        | "coverage"
                        | "dist"
                        | "node_modules"
                        | "target"
                        | "vendor"
                )
            );
            if file_type.is_symlink() || ignored {
                continue;
            }
            if file_type.is_dir() {
                directories.push(path);
            } else if file_type.is_file() {
                files.push(path);
            }
        }
    }
    files.sort();
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
                | "lock"
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

fn is_prohibited_path(path: &Path, source_suffixes: &[String]) -> bool {
    let path_text = path.to_string_lossy();
    if source_suffixes
        .iter()
        .any(|suffix| path_text.ends_with(suffix))
    {
        return true;
    }
    let file_name = path.file_name().and_then(OsStr::to_str).unwrap_or_default();
    let lowercase_name = file_name.to_ascii_lowercase();
    let version_file = [".", "py", "thon-version"].concat();
    if lowercase_name == version_file
        || matches!(
            lowercase_name.as_str(),
            "pipfile"
                | "pipfile.lock"
                | "pdm.lock"
                | "pdm.toml"
                | "poetry.lock"
                | "pyproject.toml"
                | "pytest.ini"
                | "setup.cfg"
                | "tox.ini"
                | "uv.lock"
        )
    {
        return true;
    }
    matches!(path.extension().and_then(OsStr::to_str), Some("in" | "txt"))
        && (lowercase_name.starts_with("constraints")
            || lowercase_name.starts_with("requirements")
            || path
                .components()
                .any(|component| component.as_os_str() == "requirements"))
}

fn ascii_word_spans(value: &str) -> Vec<(&str, usize, usize)> {
    let mut spans = Vec::new();
    let mut start = None;
    for (index, character) in value.char_indices() {
        if character.is_ascii_alphanumeric() {
            start.get_or_insert(index);
        } else if let Some(word_start) = start.take() {
            spans.push((&value[word_start..index], word_start, index));
        }
    }
    if let Some(word_start) = start {
        spans.push((&value[word_start..], word_start, value.len()));
    }
    spans
}

fn is_versioned_command(word: &str, command: &str) -> bool {
    word.strip_prefix(command)
        .is_some_and(|version| version.chars().all(|character| character.is_ascii_digit()))
}

fn contains_package_install(line: &str, installer: &str) -> bool {
    let spans = ascii_word_spans(line);
    for (index, (command, _, command_end)) in spans.iter().copied().enumerate() {
        if !is_versioned_command(command, installer) {
            continue;
        }
        for (action, action_start, _) in spans[index + 1..].iter().copied() {
            if action != "install" {
                continue;
            }
            let separator = &line[command_end..action_start];
            let direct = separator.chars().all(|character| {
                character.is_ascii_whitespace()
                    || matches!(character, '\'' | '"' | ',' | '[' | ']' | '(' | ')')
            });
            let options = separator.contains('-')
                && !separator
                    .chars()
                    .any(|character| matches!(character, ';' | '&' | '|'));
            if direct || options {
                return true;
            }
        }
    }
    false
}

fn is_folded_yaml_header(line: &str) -> bool {
    let trimmed = line.trim();
    let value = if let Some((_, value)) = trimmed.split_once(':') {
        value
    } else if let Some(value) = trimmed.strip_prefix("- ") {
        value
    } else {
        return false;
    };
    let marker = value.split('#').next().unwrap_or_default().trim();
    marker.strip_prefix('>').is_some_and(|suffix| {
        suffix
            .chars()
            .all(|character| matches!(character, '+' | '-' | '0'..='9'))
    })
}

fn leading_whitespace(line: &str) -> usize {
    line.len().saturating_sub(line.trim_start().len())
}

fn logical_source_lines(source: &str, fold_yaml: bool) -> Vec<(usize, String)> {
    let physical_lines = source.lines().collect::<Vec<_>>();
    let mut logical_lines = Vec::new();
    let mut pending = String::new();
    let mut pending_start = 0;
    let mut index = 0;
    while index < physical_lines.len() {
        let physical_line = physical_lines[index];
        if fold_yaml && is_folded_yaml_header(physical_line) {
            let header_indent = leading_whitespace(physical_line);
            let block_start = index;
            let mut folded = String::new();
            index += 1;
            while index < physical_lines.len() {
                let block_line = physical_lines[index];
                if !block_line.trim().is_empty() && leading_whitespace(block_line) <= header_indent
                {
                    break;
                }
                if !block_line.trim().is_empty() {
                    if !folded.is_empty() {
                        folded.push(' ');
                    }
                    folded.push_str(block_line.trim());
                }
                index += 1;
            }
            if !folded.is_empty() {
                logical_lines.push((block_start, folded));
            }
            continue;
        }
        if pending.is_empty() {
            pending_start = index;
        }
        let trimmed = physical_line.trim_end();
        let trailing_backslashes = trimmed
            .chars()
            .rev()
            .take_while(|character| *character == '\\')
            .count();
        let continued = trailing_backslashes % 2 == 1;
        let content = if continued {
            &trimmed[..trimmed.len().saturating_sub(1)]
        } else {
            physical_line
        };
        pending.push_str(content);
        if continued {
            pending.push(' ');
        } else {
            logical_lines.push((pending_start, std::mem::take(&mut pending)));
        }
        index += 1;
    }
    if !pending.is_empty() {
        logical_lines.push((pending_start, pending));
    }
    logical_lines
}

fn repository_language_violations(root: &Path) -> anyhow::Result<Vec<String>> {
    let language = ["py", "thon"].concat();
    let script_extension = [".", "py"].concat();
    let source_suffixes =
        ["", "i", "c", "o", "w"].map(|suffix| [script_extension.as_str(), suffix].concat());
    let package_installer = ["p", "ip"].concat();
    let interpreter_aliases = [
        ["py", "py"].concat(),
        ["micro", language.as_str()].concat(),
        ["jy", "thon"].concat(),
        ["iron", language.as_str()].concat(),
        ["i", language.as_str()].concat(),
    ];
    let mut violations = Vec::new();

    for path in repository_paths(root)? {
        let relative = path.strip_prefix(root).unwrap_or(&path);
        if is_prohibited_path(relative, &source_suffixes) {
            violations.push(format!("{}: prohibited authored file", relative.display()));
            continue;
        }
        if !is_automation_source(relative) {
            continue;
        }
        let bytes = fs::read(&path)?;
        if std::str::from_utf8(&bytes).is_err() {
            violations.push(format!(
                "{}: automation source is not valid UTF-8",
                relative.display()
            ));
        }
        let source = String::from_utf8_lossy(&bytes);
        let fold_yaml = matches!(
            relative.extension().and_then(OsStr::to_str),
            Some("yaml" | "yml")
        );
        for (index, line) in logical_source_lines(&source, fold_yaml) {
            let trimmed = line.trim_start();
            if trimmed.starts_with("//")
                || (trimmed.starts_with('#') && !trimmed.starts_with("#!"))
                || trimmed.starts_with('*')
            {
                continue;
            }
            let lowercase = line.to_ascii_lowercase();
            if ascii_word_spans(&lowercase).iter().any(|(word, _, _)| {
                is_versioned_command(word, &language)
                    || interpreter_aliases
                        .iter()
                        .any(|alias| is_versioned_command(word, alias))
            }) || contains_package_install(&lowercase, &package_installer)
            {
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
fn canonical_repository_inventory_prunes_generated_and_dependency_trees() -> anyhow::Result<()> {
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
    let paths = repository_paths(&fixture)?;
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
    let alternate_runtime = ["py", "py3"].concat();
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
        fixture.join(".env.test"),
        format!("SCRIPT_RUNTIME={alternate_runtime}\n"),
    )?;
    fs::write(
        fixture.join("scripts/picture-in-picture.ts"),
        "export const pip = shape.pyramid;\n",
    )?;
    fs::write(fixture.join("pyproject.toml"), "[project]\n")?;
    let violations = repository_language_violations(&fixture)?;
    assert_eq!(violations.len(), 7);
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

#[test]
fn repository_language_scan_rejects_prohibited_dependency_surfaces() -> anyhow::Result<()> {
    let fixture = std::env::temp_dir().join(format!(
        "nook-language-dependencies-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));
    fs::create_dir_all(fixture.join("requirements"))?;
    fs::create_dir_all(fixture.join("scripts"))?;
    let installer = ["p", "ip"].concat();
    let language = ["py", "thon"].concat();
    fs::write(
        fixture.join("Taskfile.yml"),
        format!(
            "version: '3'\ntasks:\n  install:\n    cmds:\n      - {installer} install package\n      - {installer}3 --no-cache-dir install package\n      - {installer} -q install package\n      - {installer} \\\n        install package\n"
        ),
    )?;
    fs::write(
        fixture.join("folded.yml"),
        format!("command: >-\n  {installer}\n  install package\n"),
    )?;
    fs::write(fixture.join("requirements-dev.txt"), "package==1\n")?;
    fs::write(fixture.join("requirements/base.txt"), "package==1\n")?;
    fs::write(fixture.join("constraints-dev.in"), "package==1\n")?;
    fs::write(
        fixture.join("scripts/picture-in-picture.ts"),
        format!("export const {installer} = install; export const pyramid = shape.pyramid;\n"),
    )?;
    fs::write(
        fixture.join("scripts/mixed-command.ts"),
        format!("export const {installer} = install; exec(\"{installer} install package\");\n"),
    )?;
    fs::write(
        fixture.join("bun.lock"),
        format!("{{\"dependency\": \"{language}-shell\"}}\n"),
    )?;
    let violations = repository_language_violations(&fixture)?;
    assert_eq!(violations.len(), 10);
    fs::remove_dir_all(fixture)?;
    Ok(())
}

#[test]
fn repository_language_scan_fails_closed_on_invalid_utf8() -> anyhow::Result<()> {
    let fixture = std::env::temp_dir().join(format!(
        "nook-language-encoding-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));
    fs::create_dir_all(&fixture)?;
    fs::write(fixture.join("automation.ts"), [0xff, b'\n'])?;
    let violations = repository_language_violations(&fixture)?;
    assert_eq!(violations.len(), 1);
    assert!(violations[0].contains("not valid UTF-8"));
    fs::remove_dir_all(fixture)?;
    Ok(())
}
