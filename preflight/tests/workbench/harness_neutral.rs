use anyhow::Context as _;
use std::{
    fs,
    path::{Path, PathBuf},
    process,
    sync::atomic::{AtomicU64, Ordering},
};

#[cfg(unix)]
use std::os::unix::fs::symlink;

const FORBIDDEN_AUTHORITY_REFERENCES: [&str; 6] = [
    "ai_team_agent",
    "development_core_team_agent",
    "security_team_agent",
    "sre_team_agent",
    "web_development_team_agent",
    ".codex/agents",
];
static TEMPORARY_DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TemporaryDirectory {
    path: PathBuf,
}

impl TemporaryDirectory {
    fn create(name: &str) -> anyhow::Result<Self> {
        let sequence = TEMPORARY_DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "nook-preflight-{name}-{}-{sequence}",
            process::id()
        ));
        fs::create_dir(&path)
            .with_context(|| format!("failed to create test directory {}", path.display()))?;
        Ok(Self { path })
    }
}

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _result = fs::remove_dir_all(&self.path);
    }
}

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

fn read(path: &str) -> String {
    fs::read_to_string(repository_root().join(path))
        .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
}

fn files_under(path: &Path) -> anyhow::Result<Vec<PathBuf>> {
    let root_metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(error).with_context(|| format!("failed to inspect {}", path.display()));
        }
    };
    anyhow::ensure!(
        !root_metadata.file_type().is_symlink(),
        "refusing to scan symlink {}",
        path.display()
    );
    if root_metadata.is_file() {
        return Ok(vec![path.to_path_buf()]);
    }
    anyhow::ensure!(
        root_metadata.is_dir(),
        "authority scan root is not a file or directory: {}",
        path.display()
    );

    let mut pending = vec![path.to_path_buf()];
    let mut files = Vec::new();
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory)
            .with_context(|| format!("failed to read {}", directory.display()))?
        {
            let entry = entry?;
            let file_type = entry.file_type()?;
            anyhow::ensure!(
                !file_type.is_symlink(),
                "refusing to scan symlink {}",
                entry.path().display()
            );
            if file_type.is_dir() {
                pending.push(entry.path());
            } else if file_type.is_file() {
                files.push(entry.path());
            }
        }
    }
    files.sort();
    Ok(files)
}

fn skill_wrapper_files(path: &Path) -> anyhow::Result<Vec<PathBuf>> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(error).with_context(|| format!("failed to inspect {}", path.display()));
        }
    };
    anyhow::ensure!(
        !metadata.file_type().is_symlink(),
        "refusing to scan symlink {}",
        path.display()
    );
    anyhow::ensure!(
        metadata.is_dir(),
        "skill wrapper root is not a directory: {}",
        path.display()
    );

    let mut wrappers = Vec::new();
    for entry in fs::read_dir(path)
        .with_context(|| format!("failed to read skill wrappers under {}", path.display()))?
    {
        let entry = entry?;
        if entry.file_name() == "node_modules" {
            continue;
        }
        let file_type = entry.file_type()?;
        anyhow::ensure!(
            !file_type.is_symlink(),
            "refusing to scan symlink {}",
            entry.path().display()
        );
        if !file_type.is_dir() {
            continue;
        }

        let wrapper = entry.path().join("SKILL.md");
        match fs::symlink_metadata(&wrapper) {
            Ok(metadata) => {
                anyhow::ensure!(
                    !metadata.file_type().is_symlink(),
                    "refusing to scan symlink {}",
                    wrapper.display()
                );
                anyhow::ensure!(
                    metadata.is_file(),
                    "skill wrapper is not a file: {}",
                    wrapper.display()
                );
                wrappers.push(wrapper);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("failed to inspect {}", wrapper.display()));
            }
        }
    }
    wrappers.sort();
    Ok(wrappers)
}

fn line_prescribes_native_model_override(line: &str) -> bool {
    let normalized = line
        .trim_start_matches(|character: char| {
            character.is_ascii_digit() || matches!(character, ' ' | '\t' | '-' | '*' | '.' | ')')
        })
        .to_ascii_lowercase();
    let is_configuration = ["model =", "model_reasoning_effort =", "reasoning_effort ="]
        .iter()
        .any(|prefix| normalized.starts_with(prefix));
    let is_directive = [
        "preserve ",
        "do not configure ",
        "do not request ",
        "do not set ",
        "must ",
        "set ",
        "configure ",
        "request ",
        "use ",
    ]
    .iter()
    .any(|prefix| normalized.starts_with(prefix));
    let targets_native_model_override = [
        "exact model",
        "model override",
        "model or reasoning-effort override",
        "model or reasoning effort override",
        "model_reasoning_effort",
        "reasoning-effort override",
        "reasoning effort override",
        "profile or spawn override",
        "spawn override",
    ]
    .iter()
    .any(|target| normalized.contains(target));

    is_configuration || (is_directive && targets_native_model_override)
}

fn harness_specific_authority_violations(authority: &str) -> Vec<String> {
    let mut violations = FORBIDDEN_AUTHORITY_REFERENCES
        .into_iter()
        .filter(|reference| authority.contains(reference))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    violations.extend(
        authority
            .lines()
            .enumerate()
            .filter(|(_index, line)| line_prescribes_native_model_override(line))
            .map(|(index, line)| {
                format!(
                    "native model override directive on line {}: {}",
                    index + 1,
                    line.trim()
                )
            }),
    );
    violations
}

#[test]
fn root_agents_routes_every_worker_to_cortex() {
    let root_agents = read("AGENTS.md");

    assert!(
        root_agents.contains("[`.cortex/AGENTS.md`](.cortex/AGENTS.md)")
            && root_agents.contains("[`.cortex/knowledge-graph.md`](.cortex/knowledge-graph.md)"),
        "root AGENTS.md must route every worker to the Cortex entry contract and knowledge graph"
    );
}

#[test]
fn gizmo_dispatches_complete_harness_neutral_team_contracts() {
    let authority = [
        read(".cortex/AGENTS.md"),
        read(".cortex/gizmo/AGENTS.md"),
        read(".cortex/gizmo/workflows/team-oriented-development.md"),
        read(".cortex/gizmo/workflows/subagent-delegation.md"),
    ]
    .join("\n")
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ");

    for (requirement, accepted_language) in [
        (
            "one functional team",
            &["one functional team", "exactly one team identity"][..],
        ),
        ("explicit team identity", &["team identity"][..]),
        ("exact baseline", &["exact baseline"][..]),
        ("allowed paths", &["allowed paths"][..]),
        ("forbidden paths", &["forbidden paths"][..]),
        ("expected result", &["expected result"][..]),
        ("acceptance evidence", &["acceptance evidence"][..]),
        (
            "parent-owned integration",
            &["parent-owned integration", "parent-owned join"][..],
        ),
    ] {
        assert!(
            accepted_language
                .iter()
                .any(|required| authority.contains(required)),
            "Gizmo authority must require every harness worker contract to supply: {requirement}"
        );
    }

    for team_path in ["ai", "dev-core", "security", "sre", "web-dev"] {
        assert!(
            authority.contains(&format!("teams/{team_path}/AGENTS.md"))
                && authority.contains(&format!("teams/{team_path}/knowledge-graph.md")),
            "Gizmo authority must identify the exact AGENTS.md and knowledge graph for {team_path}"
        );
    }
}

#[test]
fn repository_agent_authority_is_harness_neutral() -> anyhow::Result<()> {
    let root = repository_root();
    let mut authority_files = vec![root.join("AGENTS.md")];
    for authority_root in [".cortex", ".github/prompts"] {
        authority_files.extend(files_under(&root.join(authority_root))?);
    }
    authority_files.extend(skill_wrapper_files(&root.join(".agents/skills"))?);

    let mut findings = Vec::new();
    for path in authority_files {
        let authority = fs::read_to_string(&path)
            .with_context(|| format!("failed to read agent authority {}", path.display()))?;
        findings.extend(
            harness_specific_authority_violations(&authority)
                .into_iter()
                .map(|violation| format!("{}: {violation}", path.display())),
        );
    }

    assert!(
        findings.is_empty(),
        "repository agent authority must remain harness-neutral:\n{}",
        findings.join("\n")
    );
    Ok(())
}

#[test]
fn harness_neutral_authority_detector_rejects_negative_test_data() {
    let negative_test_data = format!(
        "{}\nPreserve Gizmo's exact model without a profile or spawn override.\nmodel_reasoning_effort = \"high\"",
        FORBIDDEN_AUTHORITY_REFERENCES.join("\n")
    );
    let violations = harness_specific_authority_violations(&negative_test_data);

    for forbidden in FORBIDDEN_AUTHORITY_REFERENCES {
        assert!(violations.contains(&forbidden.to_owned()));
    }
    assert!(
        violations
            .iter()
            .filter(|violation| violation.starts_with("native model override directive"))
            .count()
            == 2
    );
}

#[test]
fn harness_neutral_authority_detector_allows_harness_owned_explanation() {
    let explanatory_authority = "The active harness owns native worker labels or names and model inheritance or selection.\nThe repository task contract did not prescribe a native label or model.";

    assert!(
        harness_specific_authority_violations(explanatory_authority).is_empty(),
        "explanatory harness-ownership language must remain valid authority"
    );
}

#[test]
fn codex_agent_profiles_are_removed() -> anyhow::Result<()> {
    let profiles_root = repository_root().join(".codex").join("agents");
    let toml_files = files_under(&profiles_root)?
        .into_iter()
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "toml")
        })
        .collect::<Vec<_>>();

    assert!(
        toml_files.is_empty(),
        "Universal Cortex authority must not retain TOML profiles under {}: {toml_files:#?}",
        profiles_root.display()
    );
    Ok(())
}

#[cfg(unix)]
#[test]
fn recursive_scan_rejects_toml_profile_file_symlink() -> anyhow::Result<()> {
    let fixture = TemporaryDirectory::create("profile-file-symlink")?;
    let profiles_root = fixture.path.join(".codex").join("agents");
    fs::create_dir_all(&profiles_root)?;
    let profile_target = fixture.path.join("vendor-profile.toml");
    fs::write(&profile_target, "name = \"vendor\"\n")?;
    let profile_symlink = profiles_root.join("vendor-profile.toml");
    symlink(&profile_target, &profile_symlink)?;

    let error = files_under(&profiles_root)
        .err()
        .context("TOML profile symlink must fail the recursive scan")?;
    assert!(
        error.to_string().contains("refusing to scan symlink")
            && error.to_string().contains("vendor-profile.toml"),
        "unexpected TOML profile symlink error: {error:#}"
    );
    Ok(())
}

#[cfg(unix)]
#[test]
fn recursive_scan_rejects_directory_symlink() -> anyhow::Result<()> {
    let fixture = TemporaryDirectory::create("directory-symlink")?;
    let authority_root = fixture.path.join("authority");
    let target_directory = fixture.path.join("target-authority");
    fs::create_dir_all(&authority_root)?;
    fs::create_dir_all(&target_directory)?;
    fs::write(
        target_directory.join("AGENTS.md"),
        "# Untrusted authority\n",
    )?;
    let directory_symlink = authority_root.join("linked-authority");
    symlink(&target_directory, &directory_symlink)?;

    let error = files_under(&authority_root)
        .err()
        .context("directory symlink must fail the recursive scan")?;
    assert!(
        error.to_string().contains("refusing to scan symlink")
            && error.to_string().contains("linked-authority"),
        "unexpected directory symlink error: {error:#}"
    );
    Ok(())
}
