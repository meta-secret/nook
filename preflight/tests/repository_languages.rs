use serde::Deserialize;
use std::{
    collections::BTreeSet,
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

fn repository_paths(root: &Path) -> anyhow::Result<Vec<PathBuf>> {
    let mut files = BTreeSet::new();
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .follow_links(false)
        .git_exclude(false)
        .git_global(false)
        .hidden(false)
        .parents(false)
        .require_git(false)
        .filter_entry(|entry| entry.file_name() != OsStr::new(".git"))
        .sort_by_file_path(std::cmp::Ord::cmp);
    for entry in builder.build() {
        let entry = entry?;
        if entry.depth() == 0 {
            continue;
        }
        if entry
            .file_type()
            .is_some_and(|file_type| file_type.is_file() || file_type.is_symlink())
        {
            files.insert(entry.into_path());
        }
    }
    let git_metadata = root.join(".git");
    if git_metadata.is_dir() || git_metadata.is_file() {
        let output = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["ls-files", "--cached", "-z"])
            .output()?;
        anyhow::ensure!(
            output.status.success(),
            "failed to enumerate tracked repository paths"
        );
        for relative_bytes in output.stdout.split(|byte| *byte == 0) {
            if relative_bytes.is_empty() {
                continue;
            }
            let relative = std::str::from_utf8(relative_bytes)?;
            let path = root.join(relative);
            let file_type = fs::symlink_metadata(&path)?.file_type();
            if file_type.is_file() || file_type.is_symlink() {
                files.insert(path);
            }
        }
    }
    Ok(files.into_iter().collect())
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
                | "html"
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
                | "svelte"
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
        "index.html",
        "product.Dockerfile",
        "service.conf",
        "src/runner.rs",
        "src/view.svelte",
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

fn contains_command_action(line: &str, command_name: &str, actions: &[&str]) -> bool {
    let spans = ascii_word_spans(line);
    for (index, (command, _, command_end)) in spans.iter().copied().enumerate() {
        if !is_versioned_command(command, command_name) {
            continue;
        }
        for (action, action_start, _) in spans[index + 1..].iter().copied() {
            if !actions.contains(&action) {
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

fn logical_source_lines(source: &str, fold_shell_continuations: bool) -> Vec<(usize, String)> {
    let physical_lines = source.lines().collect::<Vec<_>>();
    let mut logical_lines = Vec::new();
    let mut pending = String::new();
    let mut pending_start = 0;
    let mut index = 0;
    while index < physical_lines.len() {
        let physical_line = physical_lines[index];
        if pending.is_empty() {
            pending_start = index;
        }
        let trimmed = physical_line.trim_end();
        let trailing_backslashes = trimmed
            .chars()
            .rev()
            .take_while(|character| *character == '\\')
            .count();
        let continued = fold_shell_continuations && trailing_backslashes % 2 == 1;
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

fn supports_shell_continuations(path: &Path) -> bool {
    let file_name = path.file_name().and_then(OsStr::to_str).unwrap_or_default();
    file_name.starts_with("Dockerfile")
        || file_name.ends_with(".Dockerfile")
        || matches!(
            path.extension().and_then(OsStr::to_str),
            Some("bash" | "sh" | "zsh")
        )
}

fn join_argv_strings<'a>(values: impl Iterator<Item = &'a str>) -> Option<String> {
    let values = values.collect::<Vec<_>>();
    (values.len() > 1
        && values
            .iter()
            .all(|value| !value.chars().any(char::is_whitespace)))
    .then(|| values.join(" "))
}

fn yaml_argv(value: &serde_yaml_ng::Value) -> Vec<&str> {
    if let Some(value) = value.as_str() {
        return vec![value];
    }
    value
        .as_sequence()
        .map(|sequence| {
            sequence
                .iter()
                .filter_map(serde_yaml_ng::Value::as_str)
                .collect()
        })
        .unwrap_or_default()
}

fn collect_yaml_strings(value: &serde_yaml_ng::Value, strings: &mut Vec<String>) {
    if let Some(value) = value.as_str() {
        strings.push(value.to_owned());
        return;
    }
    if let Some(sequence) = value.as_sequence() {
        if let Some(argv) =
            join_argv_strings(sequence.iter().filter_map(serde_yaml_ng::Value::as_str))
        {
            strings.push(argv);
        }
        for item in sequence {
            collect_yaml_strings(item, strings);
        }
        return;
    }
    if let Some(mapping) = value.as_mapping() {
        let command = mapping
            .iter()
            .find(|(key, _)| key.as_str() == Some("command"))
            .map(|(_, value)| yaml_argv(value))
            .unwrap_or_default();
        let arguments = mapping
            .iter()
            .find(|(key, _)| key.as_str() == Some("args"))
            .map(|(_, value)| yaml_argv(value))
            .unwrap_or_default();
        let combined = command.into_iter().chain(arguments).collect::<Vec<_>>();
        if combined.len() > 1 {
            strings.push(combined.join(" "));
        }
        for (key, item) in mapping {
            collect_yaml_strings(key, strings);
            collect_yaml_strings(item, strings);
        }
    }
}

fn json_argv(value: &serde_json::Value) -> Vec<&str> {
    if let Some(value) = value.as_str() {
        return vec![value];
    }
    value
        .as_array()
        .map(|sequence| {
            sequence
                .iter()
                .filter_map(serde_json::Value::as_str)
                .collect()
        })
        .unwrap_or_default()
}

fn yaml_source_strings(source: &str) -> anyhow::Result<Vec<String>> {
    let mut strings = Vec::new();
    for document in serde_yaml_ng::Deserializer::from_str(source) {
        let value = serde_yaml_ng::Value::deserialize(document)?;
        collect_yaml_strings(&value, &mut strings);
    }
    Ok(strings)
}

fn collect_json_strings(value: &serde_json::Value, strings: &mut Vec<String>) {
    if let Some(value) = value.as_str() {
        strings.push(value.to_owned());
        return;
    }
    if let Some(sequence) = value.as_array() {
        if let Some(argv) = join_argv_strings(sequence.iter().filter_map(serde_json::Value::as_str))
        {
            strings.push(argv);
        }
        for item in sequence {
            collect_json_strings(item, strings);
        }
        return;
    }
    if let Some(mapping) = value.as_object() {
        let command = mapping.get("command").map(json_argv).unwrap_or_default();
        let arguments = mapping.get("args").map(json_argv).unwrap_or_default();
        let combined = command.into_iter().chain(arguments).collect::<Vec<_>>();
        if combined.len() > 1 {
            strings.push(combined.join(" "));
        }
        for (key, item) in mapping {
            strings.push(key.clone());
            collect_json_strings(item, strings);
        }
    }
}

fn collect_toml_strings(value: &toml::Value, strings: &mut Vec<String>) {
    if let Some(value) = value.as_str() {
        strings.push(value.to_owned());
        return;
    }
    if let Some(sequence) = value.as_array() {
        if let Some(argv) = join_argv_strings(sequence.iter().filter_map(toml::Value::as_str)) {
            strings.push(argv);
        }
        for item in sequence {
            collect_toml_strings(item, strings);
        }
        return;
    }
    if let Some(mapping) = value.as_table() {
        for (key, item) in mapping {
            strings.push(key.clone());
            collect_toml_strings(item, strings);
        }
    }
}

fn source_strings(path: &Path, source: &str) -> anyhow::Result<Vec<String>> {
    match path.extension().and_then(OsStr::to_str) {
        Some("yaml" | "yml") => yaml_source_strings(source),
        Some("json" | "jsonc") => {
            let value = json5::from_str(source)?;
            let mut strings = Vec::new();
            collect_json_strings(&value, &mut strings);
            Ok(strings)
        }
        Some("toml") => {
            let value = toml::from_str(source)?;
            let mut strings = Vec::new();
            collect_toml_strings(&value, &mut strings);
            Ok(strings)
        }
        _ => Ok(vec![source.to_owned()]),
    }
}

fn contains_prohibited_output_path(line: &str, suffixes: &[String]) -> bool {
    let bytes = line.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'>' || bytes.get(index + 1) == Some(&b'=') {
            index += 1;
            continue;
        }
        index += usize::from(bytes.get(index + 1) == Some(&b'>')) + 1;
        while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        let quote = bytes
            .get(index)
            .copied()
            .filter(|byte| matches!(byte, b'\'' | b'"'));
        if quote.is_some() {
            index += 1;
        }
        let start = index;
        while let Some(byte) = bytes.get(index) {
            if quote.map_or_else(
                || byte.is_ascii_whitespace() || matches!(byte, b'<' | b'>' | b'&' | b';' | b'|'),
                |quote| *byte == quote,
            ) {
                break;
            }
            index += 1;
        }
        let candidate = line[start..index].to_ascii_lowercase();
        if suffixes.iter().any(|suffix| candidate.ends_with(suffix)) {
            return true;
        }
    }
    false
}

fn project_manager_actions<'a>(language: &'a str, package_installer: &'a str) -> Vec<&'a str> {
    vec![
        "run",
        language,
        package_installer,
        "tool",
        "venv",
        "add",
        "build",
        "export",
        "init",
        "lock",
        "publish",
        "remove",
        "sync",
        "tree",
    ]
}

fn repository_language_violations(root: &Path) -> anyhow::Result<Vec<String>> {
    let language = ["py", "thon"].concat();
    let script_extension = [".", "py"].concat();
    let mut source_suffixes = ["", "i", "c", "o", "w"]
        .map(|suffix| [script_extension.as_str(), suffix].concat())
        .to_vec();
    source_suffixes.extend([
        [script_extension.as_str(), "z"].concat(),
        [".", "pex"].concat(),
        [".", "whl"].concat(),
        [".", "egg"].concat(),
    ]);
    let package_installer = ["p", "ip"].concat();
    let isolated_installer = [package_installer.as_str(), "x"].concat();
    let project_manager = ["u", "v"].concat();
    let project_manager_actions =
        project_manager_actions(language.as_str(), package_installer.as_str());
    let interpreter_aliases = [
        ["py", "py"].concat(),
        ["micro", language.as_str()].concat(),
        ["jy", "thon"].concat(),
        ["iron", language.as_str()].concat(),
        ["i", language.as_str()].concat(),
    ];
    let ecosystem_identifiers = [
        ["py", "o3"].concat(),
        ["py", "odide"].concat(),
        ["rust", language.as_str()].concat(),
        ["c", language.as_str()].concat(),
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
        if fs::symlink_metadata(&path)?.file_type().is_symlink() {
            violations.push(format!(
                "{}: automation symlinks are prohibited",
                relative.display()
            ));
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
        for source_string in source_strings(relative, &source)? {
            for (index, line) in
                logical_source_lines(&source_string, supports_shell_continuations(relative))
            {
                let trimmed = line.trim_start();
                if trimmed.starts_with("//")
                    || (trimmed.starts_with('#') && !trimmed.starts_with("#!"))
                {
                    continue;
                }
                let lowercase = line.to_ascii_lowercase();
                let words = ascii_word_spans(&lowercase);
                if words.iter().any(|(word, _, _)| {
                    is_versioned_command(word, &language)
                        || interpreter_aliases
                            .iter()
                            .any(|alias| is_versioned_command(word, alias))
                        || ecosystem_identifiers
                            .iter()
                            .any(|identifier| word == identifier)
                }) || contains_command_action(&lowercase, &package_installer, &["install"])
                    || contains_command_action(&lowercase, &isolated_installer, &["install", "run"])
                    || contains_command_action(
                        &lowercase,
                        &project_manager,
                        &project_manager_actions,
                    )
                    || contains_prohibited_output_path(&lowercase, &source_suffixes)
                {
                    violations.push(format!(
                        "{}:{}: prohibited runtime, dependency, or script reference",
                        relative.display(),
                        index + 1
                    ));
                }
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
    fs::create_dir_all(fixture.join("dist"))?;
    fs::create_dir_all(fixture.join("rust-project/src/deep"))?;
    fs::create_dir_all(fixture.join("rust-project/target/generated"))?;
    fs::create_dir_all(fixture.join("node_modules/package"))?;
    fs::create_dir_all(fixture.join("infra/secrets"))?;
    fs::write(
        fixture.join(".gitignore"),
        "/dist/\n/infra/secrets/\n/node_modules/\n**/target/\n",
    )?;
    fs::write(
        fixture.join("nested/contract.ts"),
        "export const ok = true;\n",
    )?;
    let script_extension = [".", "py"].concat();
    let tracked_ignored = fixture
        .join("dist")
        .join(format!("runtime{script_extension}"));
    fs::write(&tracked_ignored, "print('tracked')\n")?;
    fs::write(fixture.join("build"), "#!/usr/bin/env bash\n")?;
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
    fs::write(
        fixture.join("infra/secrets/ignored.ts"),
        "export const ignored = true;\n",
    )?;
    let init = Command::new("git")
        .arg("init")
        .arg("--quiet")
        .arg(&fixture)
        .status()?;
    anyhow::ensure!(init.success(), "failed to initialize inventory fixture");
    let add = Command::new("git")
        .arg("-C")
        .arg(&fixture)
        .args(["add", "--force", "--"])
        .arg(tracked_ignored.strip_prefix(&fixture)?)
        .status()?;
    anyhow::ensure!(add.success(), "failed to stage ignored inventory fixture");
    let paths = repository_paths(&fixture)?;
    assert_eq!(
        paths,
        vec![
            fixture.join(".gitignore"),
            fixture.join("build"),
            tracked_ignored,
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
            "version: '3'\ntasks:\n  comments:\n    cmds:\n      - {runtime} fetch-comments{script_extension}\n      - cat > generated{script_extension} <<'EOF'\n"
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
        fixture.join("scripts/App.svelte"),
        format!("<script context=\"module\">exec(\"{runtime} tool\")</script>\n"),
    )?;
    fs::write(
        fixture.join("scripts/index.html"),
        format!("<script>exec(\"{runtime} tool\")</script>\n"),
    )?;
    fs::write(
        fixture.join("rust-project/src/comment-continuation.rs"),
        format!("// ordinary comment \\\nCommand::new(\"{runtime}\");\n"),
    )?;
    fs::write(
        fixture.join(".env.test"),
        format!("SCRIPT_RUNTIME={alternate_runtime}\n"),
    )?;
    fs::write(
        fixture.join("rust-project/src/dereference.rs"),
        format!("*command = Command::new(\"{runtime}\");\n"),
    )?;
    fs::write(
        fixture.join("scripts/picture-in-picture.ts"),
        "export const pip = shape.pyramid;\n",
    )?;
    fs::write(fixture.join("pyproject.toml"), "[project]\n")?;
    let violations = repository_language_violations(&fixture)?;
    assert_eq!(violations.len(), 12);
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
    fs::create_dir_all(fixture.join(".cursor"))?;
    let installer = ["p", "ip"].concat();
    let language = ["py", "thon"].concat();
    let script_extension = [".", "py"].concat();
    let rust_bridge = ["py", "o3"].concat();
    let browser_runtime = ["py", "odide"].concat();
    let project_manager = ["u", "v"].concat();
    let isolated_installer = [installer.as_str(), "x"].concat();
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
    fs::write(
        fixture.join("argv.yaml"),
        format!("command:\n  - {installer}\n  - install\n"),
    )?;
    fs::write(
        fixture.join("split-argv.yaml"),
        format!("command: [\"{installer}\"]\nargs: [\"install\", \"package\"]\n"),
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
        fixture.join("scripts/install.sh"),
        format!("{installer} \\\ninstall package\n"),
    )?;
    fs::write(
        fixture.join("scripts/managers.sh"),
        format!(
            "{project_manager} run tool\n{project_manager} {language} install 3\n{project_manager} {installer} install package\n{project_manager} add package\n{project_manager} sync\n{isolated_installer} install package\n"
        ),
    )?;
    for extension in ["whl", "pex", "egg"] {
        fs::write(
            fixture
                .join("scripts")
                .join(format!("vendored.{extension}")),
            [0xff],
        )?;
    }
    fs::write(
        fixture
            .join("scripts")
            .join(format!("application{script_extension}z")),
        [0xff],
    )?;
    fs::write(
        fixture.join("bun.lock"),
        format!("{{\"dependency\": \"{language}-shell\"}}\n"),
    )?;
    fs::write(
        fixture.join("Cargo.toml"),
        format!("[dependencies]\n\"\\u0070{}\" = \"1\"\n", &rust_bridge[1..]),
    )?;
    fs::write(
        fixture.join("package.json"),
        format!("{{\"dependencies\": {{\"{browser_runtime}\": \"1\"}}}}\n"),
    )?;
    let escaped_runtime = format!("\\u0070{}3", &language[1..]);
    fs::write(
        fixture.join(".cursor/mcp.json"),
        format!("{{\"command\": \"{escaped_runtime} tool\"}}\n"),
    )?;
    let violations = repository_language_violations(&fixture)?;
    assert_eq!(violations.len(), 26);
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

#[cfg(unix)]
#[test]
fn repository_language_scan_rejects_automation_symlinks() -> anyhow::Result<()> {
    let fixture = std::env::temp_dir().join(format!(
        "nook-language-symlink-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));
    fs::create_dir_all(&fixture)?;
    fs::write(fixture.join("target-script"), "#!/usr/bin/env bash\n")?;
    std::os::unix::fs::symlink("target-script", fixture.join("linked-script"))?;
    let violations = repository_language_violations(&fixture)?;
    assert_eq!(violations.len(), 1);
    assert!(violations[0].contains("symlinks are prohibited"));
    fs::remove_dir_all(fixture)?;
    Ok(())
}
