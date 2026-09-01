use regex::RegexSet;
use std::{
    collections::BTreeSet,
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::OnceLock,
};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

fn repository_paths(root: &Path, source_context: bool) -> anyhow::Result<Vec<PathBuf>> {
    let mut paths = BTreeSet::new();
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .follow_links(false)
        .git_exclude(false)
        .git_global(false)
        .git_ignore(!source_context)
        .hidden(false)
        .ignore(!source_context)
        .parents(false)
        .require_git(false)
        .filter_entry(|entry| entry.file_name() != OsStr::new(".git"))
        .sort_by_file_path(std::cmp::Ord::cmp);

    for entry in builder.build() {
        let entry = entry?;
        if entry.depth() > 0
            && entry
                .file_type()
                .is_some_and(|kind| kind.is_file() || kind.is_symlink())
        {
            paths.insert(entry.into_path());
        }
    }

    let git_metadata = root.join(".git");
    if !source_context && (git_metadata.is_dir() || git_metadata.is_file()) {
        let output = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["ls-files", "--cached", "-z"])
            .output()?;
        anyhow::ensure!(output.status.success(), "failed to enumerate tracked paths");
        for bytes in output.stdout.split(|byte| *byte == 0) {
            if bytes.is_empty() {
                continue;
            }
            let path = root.join(std::str::from_utf8(bytes)?);
            let kind = fs::symlink_metadata(&path)?.file_type();
            if kind.is_file() || kind.is_symlink() {
                paths.insert(path);
            }
        }
    }

    Ok(paths.into_iter().collect())
}

fn prohibited_path(path: &Path) -> bool {
    let text = path.to_string_lossy().to_ascii_lowercase();
    let name = path
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let suffixes = [
        ".py", ".pyi", ".pyc", ".pyo", ".pyw", ".pyz", ".pex", ".whl", ".egg", ".ipynb",
    ];
    if suffixes.iter().any(|suffix| text.ends_with(suffix)) {
        return true;
    }
    if matches!(
        name.as_str(),
        ".python-version"
            | "pipfile"
            | "pipfile.lock"
            | "pdm.lock"
            | "pdm.toml"
            | "poetry.lock"
            | "pyproject.toml"
            | "pytest.ini"
            | "setup.cfg"
            | "tox.ini"
            | "uv.lock"
    ) {
        return true;
    }
    matches!(path.extension().and_then(OsStr::to_str), Some("in" | "txt"))
        && (name.starts_with("constraints")
            || name.starts_with("requirements")
            || path
                .components()
                .any(|component| component.as_os_str() == "requirements"))
}

fn content_scan_candidate(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if name.starts_with("dockerfile")
        || name.ends_with(".dockerfile")
        || name.starts_with(".env.")
        || matches!(
            name.as_str(),
            "taskfile.yml" | "taskfile.yaml" | "package.json"
        )
        || path.extension().is_none()
    {
        return true;
    }

    let extension = path
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(
        extension.as_str(),
        "bash"
            | "conf"
            | "hcl"
            | "json"
            | "jsonc"
            | "lock"
            | "sh"
            | "toml"
            | "yaml"
            | "yml"
            | "zsh"
    ) {
        return true;
    }

    let automation_tree = path.components().any(|component| {
        matches!(
            component.as_os_str().to_str(),
            Some(".cortex" | ".github" | "agentic-ai" | "infra" | "preflight" | "scripts")
        )
    });
    let test_source = path.components().any(|component| {
        matches!(
            component.as_os_str().to_str(),
            Some("test" | "tests" | "fixture" | "fixtures")
        )
    });
    automation_tree
        && (matches!(
            extension.as_str(),
            "cjs" | "cts" | "js" | "jsx" | "mjs" | "mts" | "ts" | "tsx"
        ) || (extension == "rs" && !test_source))
}

fn prohibited_content() -> &'static Result<RegexSet, regex::Error> {
    static PATTERNS: OnceLock<Result<RegexSet, regex::Error>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        RegexSet::new([
            r"(?i)(?:^|[^a-z0-9_])(?:python|pypy|micropython|jython|ironpython|ipython)[0-9.]*\b",
            r"(?i)\b(?:pyo3|pyodide|rustpython|cpython)\b",
            r#"(?i)(?:^|[\s;&|(\[])(?:pip[0-9]*|pipx)(?:["',\s]+|-\s+)+(?:-[^\s]+[\s]+)*(?:install|run)\b"#,
            r#"(?i)(?:^|[\s;&|(\[])uv["',\s]+(?:-[^\s]+[\s]+)*(?:add|build|export|init|lock|pip|publish|python|remove|run|sync|tool|tree|venv)\b"#,
            r#"(?i)(?:>|>>)\s*["']?[^"';&|<>\s]+(?:\.py|\.pyi|\.pyw|\.pyz|\.pex)\b"#,
            r"(?im)^\s*(?:async\s+)?def\s+[a-z_]\w*\s*\([^)]*\)\s*:",
        ])
    })
}

fn repository_language_violations(
    root: &Path,
    source_context: bool,
) -> anyhow::Result<Vec<String>> {
    let mut violations = Vec::new();
    let patterns = prohibited_content()
        .as_ref()
        .map_err(|error| anyhow::anyhow!("invalid repository language pattern: {error}"))?;

    for path in repository_paths(root, source_context)? {
        let relative = path.strip_prefix(root).unwrap_or(&path);
        if prohibited_path(relative) {
            violations.push(format!("{}: prohibited authored file", relative.display()));
            continue;
        }
        if !content_scan_candidate(relative) {
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
        let source = std::str::from_utf8(&bytes).map_err(|_| {
            anyhow::anyhow!(
                "{}: automation source is not valid UTF-8",
                relative.display()
            )
        })?;
        if patterns.is_match(source) {
            violations.push(format!(
                "{}: prohibited runtime, dependency, or script reference",
                relative.display()
            ));
        }
    }
    Ok(violations)
}

#[test]
fn repository_automation_uses_only_typescript_rust_and_taskfiles() -> anyhow::Result<()> {
    let root = repository_root();
    let violations = repository_language_violations(
        &root,
        std::env::var_os("NOOK_REPOSITORY_SOURCE_CONTEXT").is_some(),
    )?;
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
    for path in [
        ".cortex/AGENTS.md",
        ".cortex/shared/dynamic-skills/typescript-rust-automation-only.md",
    ] {
        let source = fs::read_to_string(root.join(path))?;
        assert!(source.contains("Python"));
        assert!(source.contains("Bun") && source.contains("TypeScript"));
        assert!(source.contains("Rust") && source.contains("Taskfile"));
        assert!(source.contains("P1") || source.contains("hard rule"));
    }
    Ok(())
}

#[test]
fn inventory_prunes_local_dependencies_but_preserves_tracked_files() -> anyhow::Result<()> {
    let fixture = tempfile::tempdir()?;
    fs::create_dir_all(fixture.path().join("dist"))?;
    fs::create_dir_all(fixture.path().join("node_modules/package"))?;
    fs::write(
        fixture.path().join(".gitignore"),
        "/dist/\n/node_modules/\n",
    )?;
    fs::write(fixture.path().join("kept.ts"), "export {};\n")?;
    let tracked = fixture.path().join("dist/runtime.py");
    fs::write(&tracked, "print('tracked')\n")?;
    fs::write(
        fixture.path().join("node_modules/package/ignored.js"),
        "export {};\n",
    )?;
    anyhow::ensure!(
        Command::new("git")
            .arg("init")
            .arg("--quiet")
            .arg(fixture.path())
            .status()?
            .success()
    );
    anyhow::ensure!(
        Command::new("git")
            .arg("-C")
            .arg(fixture.path())
            .args(["add", "--force", "dist/runtime.py"])
            .status()?
            .success()
    );
    let host_paths = repository_paths(fixture.path(), false)?;
    assert!(host_paths.contains(&tracked));
    assert!(
        !host_paths
            .iter()
            .any(|path| path.to_string_lossy().contains("node_modules"))
    );
    assert!(repository_paths(fixture.path(), true)?.contains(&tracked));
    Ok(())
}

#[test]
fn language_gate_rejects_files_and_direct_invocations() -> anyhow::Result<()> {
    let fixture = tempfile::tempdir()?;
    fs::create_dir_all(fixture.path().join("scripts"))?;
    for path in [
        "scripts/fetch_comments.py",
        "scripts/tool.PY",
        "analysis.ipynb",
        "requirements-dev.txt",
    ] {
        let path = fixture.path().join(path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, "fixture\n")?;
    }
    fs::write(
        fixture.path().join("Taskfile.yml"),
        "version: '3'\ntasks:\n  comments:\n    cmds: [python3 scripts/fetch_comments.py]\n",
    )?;
    fs::write(
        fixture.path().join("scripts/install.sh"),
        "pip install package\nuv sync\n",
    )?;
    let violations = repository_language_violations(fixture.path(), false)?;
    assert_eq!(violations.len(), 6);
    Ok(())
}

#[test]
fn content_scan_avoids_product_code_false_positives() -> anyhow::Result<()> {
    let fixture = tempfile::tempdir()?;
    fs::create_dir_all(fixture.path().join("product"))?;
    fs::write(
        fixture.path().join("product/view.ts"),
        "const pip = pictureInPicture; const value = score > metrics.py;\n",
    )?;
    assert!(repository_language_violations(fixture.path(), false)?.is_empty());
    Ok(())
}

#[test]
fn content_scan_covers_nested_scripts_rust_and_yaml_vectors() -> anyhow::Result<()> {
    let fixture = tempfile::tempdir()?;
    fs::create_dir_all(fixture.path().join("product/scripts"))?;
    fs::create_dir_all(fixture.path().join("preflight/src"))?;
    fs::write(
        fixture.path().join("product/scripts/build.ts"),
        "Bun.spawn(['python3', 'tool.py']);\n",
    )?;
    fs::write(
        fixture.path().join("preflight/src/runner.rs"),
        "std::process::Command::new(\"python3\").status()?;\n",
    )?;
    fs::write(
        fixture.path().join("Taskfile.yml"),
        "tasks:\n  install:\n    cmd:\n      - pip\n      - install\n      - package\n",
    )?;
    assert_eq!(
        repository_language_violations(fixture.path(), false)?.len(),
        3
    );
    Ok(())
}

#[cfg(unix)]
#[test]
fn automation_symlinks_fail_closed() -> anyhow::Result<()> {
    let fixture = tempfile::tempdir()?;
    fs::write(fixture.path().join("target"), "#!/usr/bin/env bash\n")?;
    std::os::unix::fs::symlink("target", fixture.path().join("linked-script"))?;
    let violations = repository_language_violations(fixture.path(), false)?;
    assert_eq!(violations.len(), 1);
    assert!(violations[0].contains("symlinks are prohibited"));
    Ok(())
}
