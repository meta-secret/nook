use serde_json::Value;
use std::ffi::OsStr;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

const COVERAGE_ARTIFACT_SCHEMA_VERSION: u64 = 1;
const COVERAGE_ARTIFACT_FILES: &[&str] = &[
    "summary.txt",
    "summary.json",
    "lcov.info",
    "coverage-floor.json",
];

#[derive(Debug, Eq, PartialEq)]
pub struct CoverageInputChanges {
    pub coverage_inputs_changed: bool,
    pub base_coverage_required: bool,
}

#[derive(Debug, PartialEq)]
pub struct CoverageReport {
    pub current: f64,
    pub base: f64,
    pub delta: f64,
    pub floor: f64,
    pub passed: bool,
}

#[derive(Debug, Eq, PartialEq)]
pub struct CoverageArtifactValidation {
    pub valid: bool,
    pub reason: Option<String>,
}

/// Classifies changed repository paths that affect native Rust coverage.
///
/// `coverage_inputs_changed` includes source plus Docker/Bake plumbing that can
/// alter the exported report. `base_coverage_required` is narrower: it is true
/// only when source or Rust workspace inputs can change measured coverage.
pub fn classify_coverage_inputs<I, P>(paths: I) -> CoverageInputChanges
where
    I: IntoIterator<Item = P>,
    P: AsRef<Path>,
{
    let mut coverage_inputs_changed = false;
    let mut base_coverage_required = false;

    for path in paths {
        let path = path.as_ref();
        coverage_inputs_changed |= is_coverage_input(path);
        base_coverage_required |= is_base_coverage_input(path);
    }

    CoverageInputChanges {
        coverage_inputs_changed,
        base_coverage_required,
    }
}

/// Reads changed paths from Git and classifies native coverage inputs.
///
/// # Errors
///
/// Returns an error when Git cannot calculate the diff or emits non-UTF-8
/// repository paths.
pub fn coverage_inputs_from_git(
    repository: &Path,
    base: &str,
    head: &str,
) -> io::Result<CoverageInputChanges> {
    let revision_range = format!("{base}...{head}");
    let output = Command::new("git")
        .arg("-C")
        .arg(repository)
        .args(["diff", "--name-only"])
        .arg(revision_range)
        .arg("--")
        .output()?;
    if !output.status.success() {
        return Err(io::Error::other(format!(
            "git diff failed with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    let paths = String::from_utf8(output.stdout)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?
        .lines()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    Ok(classify_coverage_inputs(paths))
}

/// Validates the schema, commit, and required files in a coverage artifact.
#[must_use]
pub fn validate_coverage_artifact(
    directory: &Path,
    expected_commit: &str,
) -> CoverageArtifactValidation {
    match validate_coverage_artifact_inner(directory, expected_commit) {
        Ok(()) => CoverageArtifactValidation {
            valid: true,
            reason: None,
        },
        Err(error) => CoverageArtifactValidation {
            valid: false,
            reason: Some(error.to_string()),
        },
    }
}

/// Builds a typed current/base coverage report from cargo-llvm-cov JSON.
///
/// # Errors
///
/// Returns an error when a report is missing, malformed, or contains an
/// invalid percentage.
pub fn coverage_report(
    current_directory: &Path,
    base_directory: &Path,
) -> io::Result<CoverageReport> {
    let current = line_percent(&current_directory.join("summary.json"))?;
    let base = line_percent(&base_directory.join("summary.json"))?;
    let floor = floor_percent(&current_directory.join("coverage-floor.json"))?;
    Ok(CoverageReport {
        current,
        base,
        delta: current - base,
        floor,
        passed: current >= floor,
    })
}

impl CoverageInputChanges {
    /// Appends this classification to a GitHub Actions output file.
    ///
    /// # Errors
    ///
    /// Returns an error when the output file cannot be written.
    pub fn write_github_outputs(&self, path: &Path) -> io::Result<()> {
        append_lines(
            path,
            &[
                (
                    "rust_coverage_inputs_changed",
                    self.coverage_inputs_changed.to_string(),
                ),
                (
                    "base_coverage_required",
                    self.base_coverage_required.to_string(),
                ),
            ],
        )
    }
}

impl CoverageArtifactValidation {
    /// Appends the artifact verdict to a GitHub Actions output file.
    ///
    /// # Errors
    ///
    /// Returns an error when the output file cannot be written.
    pub fn write_github_outputs(&self, path: &Path) -> io::Result<()> {
        append_lines(path, &[("valid", self.valid.to_string())])
    }
}

impl CoverageReport {
    #[must_use]
    pub fn markdown(&self) -> String {
        format!(
            "### nook-core + nook-auth2 coverage\n\
             \n\
             | Metric | Lines |\n\
             | --- | ---: |\n\
             | PR branch | {:.2}% |\n\
             | Base branch | {:.2}% |\n\
             | Delta | {:+.2}% |\n\
             | Required floor | {:.2}% |\n\
             \n\
             Artifact: `nook-core-coverage`\n",
            self.current, self.base, self.delta, self.floor
        )
    }

    /// Appends typed values to a GitHub Actions output file.
    ///
    /// # Errors
    ///
    /// Returns an error when the output file cannot be written.
    pub fn write_github_outputs(&self, path: &Path) -> io::Result<()> {
        append_lines(
            path,
            &[
                ("current", format!("{:.2}", self.current)),
                ("base", format!("{:.2}", self.base)),
                ("delta", format!("{:+.2}", self.delta)),
                ("floor", format!("{:.2}", self.floor)),
                (
                    "status",
                    if self.passed { "passed" } else { "failed" }.to_owned(),
                ),
            ],
        )
    }

    /// Writes the Markdown report to a new or existing file.
    ///
    /// # Errors
    ///
    /// Returns an error when the report cannot be written.
    pub fn write_markdown(&self, path: &Path) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, self.markdown())
    }

    /// Appends the Markdown report to a GitHub Actions step-summary file.
    ///
    /// # Errors
    ///
    /// Returns an error when the summary cannot be written.
    pub fn append_github_summary(&self, path: &Path) -> io::Result<()> {
        let mut output = OpenOptions::new().create(true).append(true).open(path)?;
        output.write_all(self.markdown().as_bytes())
    }
}

fn is_coverage_input(path: &Path) -> bool {
    is_base_coverage_input(path)
        || path == Path::new("nook-app/docker-bake.hcl")
        || path == Path::new("nook-app/nook-core/Dockerfile")
        || path == Path::new("nook-app/nook-core/docker-bake.hcl")
        || path
            .strip_prefix("nook-app/docker")
            .ok()
            .and_then(Path::file_name)
            .and_then(OsStr::to_str)
            .is_some_and(|name| {
                name.ends_with(".Dockerfile")
                    || (name.contains("docker-bake")
                        && Path::new(name)
                            .extension()
                            .is_some_and(|extension| extension.eq_ignore_ascii_case("hcl")))
            })
}

fn is_base_coverage_input(path: &Path) -> bool {
    path.starts_with("nook-app/.cargo")
        || path == Path::new("nook-app/Cargo.lock")
        || path == Path::new("nook-app/Cargo.toml")
        || path.starts_with("nook-app/nook-auth2")
        || (path.starts_with("nook-app/nook-core")
            && path != Path::new("nook-app/nook-core/Dockerfile")
            && path != Path::new("nook-app/nook-core/docker-bake.hcl"))
}

fn validate_coverage_artifact_inner(directory: &Path, expected_commit: &str) -> io::Result<()> {
    let manifest_path = directory.join("manifest.json");
    let manifest = read_json(&manifest_path)?;
    let schema_version = manifest
        .get("schema_version")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid_data(&manifest_path, "missing integer schema_version"))?;
    if schema_version != COVERAGE_ARTIFACT_SCHEMA_VERSION {
        return Err(invalid_data(
            &manifest_path,
            &format!(
                "schema_version {schema_version} does not match {COVERAGE_ARTIFACT_SCHEMA_VERSION}"
            ),
        ));
    }
    let commit = manifest
        .get("commit_sha")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid_data(&manifest_path, "missing string commit_sha"))?;
    if commit != expected_commit {
        return Err(invalid_data(
            &manifest_path,
            &format!("commit_sha {commit} does not match {expected_commit}"),
        ));
    }
    for file in COVERAGE_ARTIFACT_FILES {
        let path = directory.join(file);
        if !path.is_file() || path.metadata().is_ok_and(|metadata| metadata.len() == 0) {
            return Err(invalid_data(
                &path,
                "required artifact file is missing or empty",
            ));
        }
    }
    Ok(())
}

fn line_percent(path: &Path) -> io::Result<f64> {
    let report = read_json(path)?;
    let percent = report
        .pointer("/data/0/totals/lines/percent")
        .and_then(Value::as_f64)
        .ok_or_else(|| invalid_data(path, "missing numeric data[0].totals.lines.percent"))?;
    validate_percent(path, percent)
}

fn floor_percent(path: &Path) -> io::Result<f64> {
    let floor = read_json(path)?
        .get("lines_percent")
        .and_then(Value::as_f64)
        .ok_or_else(|| invalid_data(path, "missing numeric lines_percent"))?;
    validate_percent(path, floor)
}

fn validate_percent(path: &Path, percent: f64) -> io::Result<f64> {
    if percent.is_finite() && (0.0..=100.0).contains(&percent) {
        Ok(percent)
    } else {
        Err(invalid_data(
            path,
            &format!("invalid line percentage {percent}"),
        ))
    }
}

fn read_json(path: &Path) -> io::Result<Value> {
    let contents = fs::read(path)?;
    serde_json::from_slice(&contents).map_err(|error| invalid_data(path, &error.to_string()))
}

fn invalid_data(path: &Path, message: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!("{}: {message}", path.display()),
    )
}

fn append_lines(path: &Path, values: &[(&str, String)]) -> io::Result<()> {
    let mut output = OpenOptions::new().create(true).append(true).open(path)?;
    for (key, value) in values {
        writeln!(output, "{key}={value}")?;
    }
    Ok(())
}
