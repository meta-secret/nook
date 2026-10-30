use regex::RegexSet;
use std::{
    cmp::Ord,
    collections::BTreeSet,
    env,
    ffi::OsStr,
    fs,
    ops::Deref,
    os::unix::fs as unix_fs,
    path::{Path, PathBuf},
    process::Command,
    str,
    sync::OnceLock,
};

struct RepositoryFixture {
    path: PathBuf,
}
impl RepositoryFixture {
    fn repository_root() -> Self {
        Self {
            path: env::var_os("NOOK_REPO_ROOT").map_or_else(
                || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
                PathBuf::from,
            ),
        }
    }
}
impl Deref for RepositoryFixture {
    type Target = PathBuf;
    fn deref(&self) -> &PathBuf {
        &self.path
    }
}
impl AsRef<Path> for RepositoryFixture {
    fn as_ref(&self) -> &Path {
        &self.path
    }
}

fn is_generated_repository_component(component: &OsStr) -> bool {
    matches!(
        component.to_str(),
        Some(
            ".git"
                | "node_modules"
                | ".meta-cortex"
                | ".meta-cortex-source"
                | "target"
                | "dist"
                | "coverage"
                | "test-results"
                | "playwright-report"
        )
    )
}

fn has_generated_repository_component(path: &Path) -> bool {
    path.components()
        .any(|component| is_generated_repository_component(component.as_os_str()))
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
        .filter_entry(|entry| {
            entry.depth() == 0 || !is_generated_repository_component(entry.file_name())
        })
        .sort_by_file_path(Ord::cmp);

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
            let relative_path = Path::new(str::from_utf8(bytes)?);
            if has_generated_repository_component(relative_path) {
                continue;
            }
            let path = root.join(relative_path);
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

struct RepositoryLanguagePolicy {
    patterns: RegexSet,
}

#[derive(Debug, PartialEq, Eq)]
enum ContentPolicyDecision {
    Allowed,
    Prohibited,
}

impl RepositoryLanguagePolicy {
    fn compiled() -> anyhow::Result<&'static Self> {
        static POLICY: OnceLock<Result<RepositoryLanguagePolicy, regex::Error>> = OnceLock::new();
        POLICY
            .get_or_init(|| {
                RegexSet::new([
                    r"(?i)(?:^|[^a-z0-9_])(?:python|pypy|micropython|jython|ironpython|ipython)[0-9.]*\b",
                    r"(?i)\b(?:pyo3|pyodide|rustpython|cpython)\b",
                    r#"(?i)(?:^|[\s;&|(\[])(?:pip[0-9]*|pipx)(?:["',\s]+|-\s+)+(?:-[^\s]+[\s]+)*(?:install|run)\b"#,
                    r#"(?i)(?:^|[\s;&|(\[])uv["',\s]+(?:-[^\s]+[\s]+)*(?:add|build|export|init|lock|pip|publish|python|remove|run|sync|tool|tree|venv)\b"#,
                    r#"(?i)(?:>|>>)\s*["']?[^"';&|<>\s]+(?:\.py|\.pyi|\.pyw|\.pyz|\.pex)\b"#,
                    // A bare dollar-prefixed first parameter belongs to jq, while
                    // dollar signs and semicolons remain valid inside defaults.
                    r"(?im)^\s*(?:async\s+)?def\s+[a-z_]\w*\s*\(\s*(?:[^)\s$][^)]*)?\)\s*:",
                ])
                .map(|patterns| Self { patterns })
            })
            .as_ref()
            .map_err(|error| anyhow::anyhow!("invalid repository language pattern: {error}"))
    }

    fn classify(&self, source: &str) -> ContentPolicyDecision {
        match self.patterns.is_match(source) {
            true => ContentPolicyDecision::Prohibited,
            false => ContentPolicyDecision::Allowed,
        }
    }
}

fn repository_language_violations(
    root: &Path,
    source_context: bool,
) -> anyhow::Result<Vec<String>> {
    let mut violations = Vec::new();
    let policy = RepositoryLanguagePolicy::compiled()?;

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
        let source = str::from_utf8(&bytes).map_err(|_| {
            anyhow::anyhow!(
                "{}: automation source is not valid UTF-8",
                relative.display()
            )
        })?;
        match policy.classify(source) {
            ContentPolicyDecision::Allowed => (),
            ContentPolicyDecision::Prohibited => violations.push(format!(
                "{}: prohibited runtime, dependency, or script reference",
                relative.display()
            )),
        }
    }
    Ok(violations)
}

#[test]
fn jq_dollar_parameter_definitions_are_allowed() -> anyhow::Result<()> {
    let policy = RepositoryLanguagePolicy::compiled()?;
    for source in [
        "def measured_level($backend):",
        "def level_count($backend; $counter):",
        "def storage_count($backend; $counter; $single):",
        "  def measured_level(  $backend  ): count_values;",
        "def measured_level(\n\t\n  $backend\n): count_values;",
        "\n\tdef storage_count(\n  $backend;\n  $counter;\n  $single\n): count_values;",
    ] {
        assert_eq!(
            policy.classify(source),
            ContentPolicyDecision::Allowed,
            "jq dollar parameters must remain accepted: {source}"
        );
    }
    Ok(())
}

#[test]
fn ordinary_async_and_variadic_definitions_remain_prohibited() -> anyhow::Result<()> {
    let policy = RepositoryLanguagePolicy::compiled()?;
    for source in [
        "def gather():",
        "def gather( \t ):",
        "def gather(\n\t\n):",
        "async def gather():",
        "def gather(value):",
        "  def gather(value):",
        "async def gather(value):",
        "def gather(*args):",
        "def gather(**kwargs):",
        "async def gather(*args, **kwargs):",
        "def gather(value, /, *args, fallback=None, **kwargs):",
        "def gather(π):",
        r#"def gather(value="$backend") :"#,
        "def gather(value=';'):",
        r#"def gather(value="$backend; $counter"):"#,
        r#"async def gather(value="$;", *args, **kwargs):"#,
        r#"def gather(value="\"$;"):"#,
        r#"def gather(value: str = "$;"):"#,
        "def gather(\n  value='$',\n  marker=';'\n):",
        "def gather(\n  # currency $;\n  value\n):",
    ] {
        assert_eq!(
            policy.classify(source),
            ContentPolicyDecision::Prohibited,
            "valid prohibited definitions must still be detected: {source}"
        );
    }
    Ok(())
}

#[test]
fn jq_parameters_do_not_exempt_other_prohibited_content() -> anyhow::Result<()> {
    let policy = RepositoryLanguagePolicy::compiled()?;
    for source in [
        r#"def measured_level($backend): "python3";"#,
        "def level_count($backend; $counter): .; # pip install package",
        r#"def storage_count($backend; $counter; $single): "> build.py";"#,
    ] {
        assert_eq!(
            policy.classify(source),
            ContentPolicyDecision::Prohibited,
            "jq parameters must not exempt another prohibited reference: {source}"
        );
    }
    Ok(())
}

#[test]
fn repository_automation_uses_only_typescript_rust_and_taskfiles() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    let violations = repository_language_violations(
        &root,
        env::var_os("NOOK_REPOSITORY_SOURCE_CONTEXT").is_some(),
    )?;
    assert!(
        violations.is_empty(),
        "P1 repository language violation. Automation must use Bun/TypeScript, Rust, or Taskfiles.\n{}",
        violations.join("\n")
    );
    Ok(())
}

#[test]
fn inventory_prunes_generated_source_context_paths_and_preserves_tracked_files()
-> anyhow::Result<()> {
    let fixture = tempfile::tempdir()?;
    let cortex_scripts = Path::new(".cortex/teams/ai/dynamic-skills/example/scripts");
    let ignored_authored = cortex_scripts.join("authored.ts");
    let generated_roots = [
        PathBuf::from(".git"),
        PathBuf::from("node_modules"),
        PathBuf::from(".meta-cortex"),
        PathBuf::from(".meta-cortex-source"),
        cortex_scripts.join("node_modules"),
        PathBuf::from("nook-app/nook-platform/target"),
        PathBuf::from("nook-app/nook-platform/dist"),
        PathBuf::from("nook-app/nook-platform/coverage"),
        PathBuf::from("nook-app/nook-platform/test-results"),
        PathBuf::from("nook-app/nook-platform/playwright-report"),
    ];
    let generated_directories = [
        PathBuf::from("node_modules/package"),
        PathBuf::from(".meta-cortex/node_modules/package"),
        PathBuf::from(".meta-cortex-source/cache/package"),
        cortex_scripts.join("node_modules/package"),
        PathBuf::from("nook-app/nook-platform/target/debug/deps"),
        PathBuf::from("nook-app/nook-platform/dist/assets"),
        PathBuf::from("nook-app/nook-platform/coverage/artifacts"),
        PathBuf::from("nook-app/nook-platform/test-results/chromium"),
        PathBuf::from("nook-app/nook-platform/playwright-report/data"),
    ];
    for directory in &generated_directories {
        fs::create_dir_all(fixture.path().join(directory))?;
    }
    let generated_files: Vec<PathBuf> = generated_directories
        .iter()
        .map(|directory| directory.join("generated.js"))
        .collect();
    for path in &generated_files {
        fs::write(fixture.path().join(path), "export {};\n")?;
    }
    let external_dependency = tempfile::tempdir()?;
    let external_dependency_file = external_dependency.path().join("from-linked-dependency.js");
    fs::write(&external_dependency_file, "export {};\n")?;
    let dependency_symlink = cortex_scripts.join("node_modules/linked-dependency");
    unix_fs::symlink(
        external_dependency.path(),
        fixture.path().join(&dependency_symlink),
    )?;
    let gitignore = format!(
        "node_modules/\n.meta-cortex/\n.meta-cortex-source/\n{}/authored.ts\n",
        cortex_scripts.display()
    );
    fs::write(fixture.path().join(".gitignore"), gitignore)?;
    fs::write(fixture.path().join("kept.ts"), "export {};\n")?;
    let ignored_authored_path = fixture.path().join(&ignored_authored);
    fs::write(&ignored_authored_path, "export {};\n")?;
    anyhow::ensure!(
        Command::new("git")
            .arg("init")
            .arg("--quiet")
            .arg(fixture.path())
            .status()?
            .success()
    );
    let mut git_add = Command::new("git");
    git_add
        .arg("-C")
        .arg(fixture.path())
        .args(["add", "--force", "--"])
        .arg(&ignored_authored);
    for path in &generated_files {
        git_add.arg(path);
    }
    anyhow::ensure!(git_add.status()?.success());

    for source_context in [false, true] {
        let paths = repository_paths(fixture.path(), source_context)?;
        assert!(paths.contains(&fixture.path().join("kept.ts")));
        assert!(paths.contains(&ignored_authored_path));
        for generated_root in &generated_roots {
            let generated_path = fixture.path().join(generated_root);
            assert!(
                !paths.iter().any(|path| path.starts_with(&generated_path)),
                "generated path {} must be pruned in source_context={source_context}",
                generated_root.display()
            );
        }
        assert!(!paths.contains(&fixture.path().join(&dependency_symlink)));
        assert!(!paths.contains(&external_dependency_file));
    }
    assert!(
        repository_paths(fixture.path(), true)?.iter().any(|path| {
            path.strip_prefix(fixture.path())
                .is_ok_and(|relative| relative.starts_with(".cortex"))
        }),
        "source-context scanning must preserve the .cortex source tree"
    );
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
    unix_fs::symlink("target", fixture.path().join("linked-script"))?;
    let violations = repository_language_violations(fixture.path(), false)?;
    assert_eq!(violations.len(), 1);
    assert!(
        violations
            .first()
            .is_some_and(|violation| violation.contains("symlinks are prohibited"))
    );
    Ok(())
}
