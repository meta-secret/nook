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
pub enum CoverageArtifactValidation {
    Valid,
    Invalid { reason: String },
}

/// Classifies changed repository paths that affect native Rust coverage.
///
/// `coverage_inputs_changed` includes source plus Docker/Bake plumbing that can
/// alter the exported report. `base_coverage_required` is narrower: it is true
/// only when source or Rust workspace inputs can change measured coverage.
impl CoverageInputChanges {
    pub fn classify_coverage_inputs<I, P>(paths: I) -> CoverageInputChanges
    where
        I: IntoIterator<Item = P>,
        P: AsRef<Path>,
    {
        let mut coverage_inputs_changed = false;
        let mut base_coverage_required = false;

        for path in paths {
            let path = path.as_ref();
            coverage_inputs_changed |= CoverageInputChanges::is_coverage_input(path);
            base_coverage_required |= CoverageInputChanges::is_base_coverage_input(path);
        }

        CoverageInputChanges {
            coverage_inputs_changed,
            base_coverage_required,
        }
    }
}

/// Reads changed paths from Git and classifies native coverage inputs.
///
/// # Errors
///
/// Returns an error when Git cannot calculate the diff or emits non-UTF-8
/// repository paths.
impl CoverageInputChanges {
    pub fn coverage_inputs_from_git(
        request: CoverageRevisionComparison<'_>,
    ) -> io::Result<CoverageInputChanges> {
        let CoverageRevisionComparison {
            repository,
            base,
            head,
        } = request;
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
        Ok(CoverageInputChanges::classify_coverage_inputs(paths))
    }
}

/// Validates the schema, commit, and required files in a coverage artifact.
impl CoverageArtifact<'_> {
    pub fn validate(&self) -> CoverageArtifactValidation {
        match self.validate_contents() {
            Ok(()) => CoverageArtifactValidation::Valid,
            Err(error) => CoverageArtifactValidation::Invalid {
                reason: error.to_string(),
            },
        }
    }
}

/// Builds a typed current/base coverage report from cargo-llvm-cov JSON.
///
/// # Errors
///
/// Returns an error when a report is missing, malformed, or contains an
/// invalid percentage.
impl CoverageReport {
    pub fn coverage_report(request: CoverageReportComparison<'_>) -> io::Result<CoverageReport> {
        let CoverageReportComparison {
            current_directory,
            base_directory,
        } = request;
        let current = CoverageDocument {
            path: &current_directory.join("summary.json"),
        }
        .line_percent()?;
        let base = CoverageDocument {
            path: &base_directory.join("summary.json"),
        }
        .line_percent()?;
        let floor = CoverageDocument {
            path: &current_directory.join("coverage-floor.json"),
        }
        .floor_percent()?;
        Ok(CoverageReport {
            current,
            base,
            delta: current - base,
            floor,
            passed: current >= floor,
        })
    }
}

impl CoverageInputChanges {
    /// Appends this classification to a GitHub Actions output file.
    ///
    /// # Errors
    ///
    /// Returns an error when the output file cannot be written.
    pub fn write_github_outputs(&self, path: &Path) -> io::Result<()> {
        GithubOutput { path }.append_lines(&[
            (
                "rust_coverage_inputs_changed",
                self.coverage_inputs_changed.to_string(),
            ),
            (
                "base_coverage_required",
                self.base_coverage_required.to_string(),
            ),
        ])
    }
}

impl CoverageArtifactValidation {
    /// Appends the artifact verdict to a GitHub Actions output file.
    ///
    /// # Errors
    ///
    /// Returns an error when the output file cannot be written.
    pub fn write_github_outputs(&self, path: &Path) -> io::Result<()> {
        GithubOutput { path }.append_lines(&[("valid", matches!(self, Self::Valid).to_string())])
    }
}

impl CoverageReport {
    #[must_use]
    pub fn markdown(&self) -> String {
        format!(
            "### portable Rust crate coverage\n\
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
        GithubOutput { path }.append_lines(&[
            ("current", format!("{:.2}", self.current)),
            ("base", format!("{:.2}", self.base)),
            ("delta", format!("{:+.2}", self.delta)),
            ("floor", format!("{:.2}", self.floor)),
            (
                "status",
                if self.passed { "passed" } else { "failed" }.to_owned(),
            ),
        ])
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

impl CoverageInputChanges {
    fn is_coverage_input(path: &Path) -> bool {
        CoverageInputChanges::is_base_coverage_input(path)
            || path == Path::new("nook-app/docker-bake.hcl")
            || path == Path::new("nook-app/nook-platform/nook-core/docker-bake.hcl")
            || path
                .strip_prefix("nook-app/nook-platform/docker")
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
}

impl CoverageInputChanges {
    fn is_base_coverage_input(path: &Path) -> bool {
        path.starts_with("nook-app/nook-platform/.cargo")
            || path == Path::new("nook-app/nook-platform/Cargo.lock")
            || path == Path::new("nook-app/nook-platform/Cargo.toml")
            || path.starts_with("nook-app/nook-platform/nook-app-common")
            || path.starts_with("nook-app/nook-platform/nook-auth2")
            || path.starts_with("nook-app/nook-platform/nook-authenticator-domain")
            || path.starts_with("nook-app/nook-platform/nook-replication")
            || path.starts_with("nook-app/nook-platform/nook-event-log")
            || path.starts_with("nook-app/nook-platform/nook-companion-core")
            || (path.starts_with("nook-app/nook-platform/nook-core")
                && path != Path::new("nook-app/nook-platform/nook-core/docker-bake.hcl"))
    }
}

impl CoverageArtifact<'_> {
    fn validate_contents(&self) -> io::Result<()> {
        let directory = self.directory;
        let expected_commit = self.expected_commit;
        let manifest_path = directory.join("manifest.json");
        let manifest = CoverageDocument {
            path: &manifest_path,
        }
        .read_json()?;
        let schema_version = manifest
            .get("schema_version")
            .and_then(Value::as_u64)
            .ok_or_else(|| {
                CoverageDocument {
                    path: &manifest_path,
                }
                .invalid_data("missing integer schema_version")
            })?;
        if schema_version != COVERAGE_ARTIFACT_SCHEMA_VERSION {
            return Err(CoverageDocument {
                path: &manifest_path,
            }
            .invalid_data(&format!(
                "schema_version {schema_version} does not match {COVERAGE_ARTIFACT_SCHEMA_VERSION}"
            )));
        }
        let commit = manifest
            .get("commit_sha")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                CoverageDocument {
                    path: &manifest_path,
                }
                .invalid_data("missing string commit_sha")
            })?;
        if commit != expected_commit {
            return Err(CoverageDocument {
                path: &manifest_path,
            }
            .invalid_data(&format!(
                "commit_sha {commit} does not match {expected_commit}"
            )));
        }
        for file in COVERAGE_ARTIFACT_FILES {
            let path = directory.join(file);
            if !path.is_file() || path.metadata().is_ok_and(|metadata| metadata.len() == 0) {
                return Err(CoverageDocument { path: &path }
                    .invalid_data("required artifact file is missing or empty"));
            }
        }
        Ok(())
    }
}

impl CoverageDocument<'_> {
    fn line_percent(&self) -> io::Result<f64> {
        let path = self.path;
        let report = self.read_json()?;
        let percent = report
            .pointer("/data/0/totals/lines/percent")
            .and_then(Value::as_f64)
            .ok_or_else(|| {
                CoverageDocument { path: path }
                    .invalid_data("missing numeric data[0].totals.lines.percent")
            })?;
        self.validate_percent(percent)
    }
}

impl CoverageDocument<'_> {
    fn floor_percent(&self) -> io::Result<f64> {
        let path = self.path;
        let floor = self
            .read_json()?
            .get("lines_percent")
            .and_then(Value::as_f64)
            .ok_or_else(|| {
                CoverageDocument { path: path }.invalid_data("missing numeric lines_percent")
            })?;
        self.validate_percent(floor)
    }
}

impl CoverageDocument<'_> {
    fn validate_percent(&self, percent: f64) -> io::Result<f64> {
        let path = self.path;
        if percent.is_finite() && (0.0..=100.0).contains(&percent) {
            Ok(percent)
        } else {
            Err(CoverageDocument { path: path }
                .invalid_data(&format!("invalid line percentage {percent}")))
        }
    }
}

impl CoverageDocument<'_> {
    fn read_json(&self) -> io::Result<Value> {
        let path = self.path;
        let contents = fs::read(path)?;
        serde_json::from_slice(&contents)
            .map_err(|error| CoverageDocument { path: path }.invalid_data(&error.to_string()))
    }
}

impl CoverageDocument<'_> {
    fn invalid_data(&self, message: &str) -> io::Error {
        let path = self.path;
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("{}: {message}", path.display()),
        )
    }
}

impl GithubOutput<'_> {
    fn append_lines(&self, values: &[(&str, String)]) -> io::Result<()> {
        let path = self.path;
        let mut output = OpenOptions::new().create(true).append(true).open(path)?;
        for (key, value) in values {
            writeln!(output, "{key}={value}")?;
        }
        Ok(())
    }
}

pub struct CoverageRevisionComparison<'a> {
    pub repository: &'a Path,
    pub base: &'a str,
    pub head: &'a str,
}
pub struct CoverageReportComparison<'a> {
    pub current_directory: &'a Path,
    pub base_directory: &'a Path,
}
pub struct CoverageArtifact<'a> {
    pub directory: &'a Path,
    pub expected_commit: &'a str,
}
struct CoverageDocument<'a> {
    path: &'a Path,
}
struct GithubOutput<'a> {
    path: &'a Path,
}
