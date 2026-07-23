use nook_preflight::coverage::{
    classify_coverage_inputs, coverage_report, validate_coverage_artifact,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TEMPORARY_DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[test]
fn classifies_source_and_build_only_coverage_inputs() {
    let source = classify_coverage_inputs([
        "README.md",
        "nook-app/nook-core/src/lib.rs",
        "nook-app/nook-core/Dockerfile",
    ]);
    assert!(source.coverage_inputs_changed);
    assert!(source.base_coverage_required);

    let build_only = classify_coverage_inputs([
        "nook-app/docker/base.Dockerfile",
        "nook-app/nook-core/docker-bake.hcl",
    ]);
    assert!(build_only.coverage_inputs_changed);
    assert!(!build_only.base_coverage_required);

    let unrelated = classify_coverage_inputs(["README.md", "nook-app/nook-web/package.json"]);
    assert!(!unrelated.coverage_inputs_changed);
    assert!(!unrelated.base_coverage_required);
}

#[test]
fn validates_commit_keyed_coverage_artifacts() {
    let root = temporary_directory();
    write_coverage_directory(&root, 92.5, 90.0);
    fs::write(
        root.join("manifest.json"),
        r#"{"schema_version":1,"commit_sha":"abc123"}"#,
    )
    .unwrap();

    assert_eq!(
        validate_coverage_artifact(&root, "abc123"),
        nook_preflight::coverage::CoverageArtifactValidation {
            valid: true,
            reason: None,
        }
    );

    let wrong_commit = validate_coverage_artifact(&root, "def456");
    assert!(!wrong_commit.valid);
    assert!(
        wrong_commit
            .reason
            .as_deref()
            .is_some_and(|reason| reason.contains("does not match def456"))
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reports_coverage_from_structured_json() {
    let root = temporary_directory();
    let current = root.join("current");
    let base = root.join("base");
    write_coverage_directory(&current, 92.625, 90.0);
    write_coverage_directory(&base, 91.125, 90.0);

    let report = coverage_report(&current, &base).unwrap();

    assert_close(report.current, 92.625);
    assert_close(report.base, 91.125);
    assert_close(report.delta, 1.5);
    assert_close(report.floor, 90.0);
    assert!(report.passed);
    assert_eq!(
        report.markdown(),
        "### nook-core + nook-auth2 coverage\n\
\n\
| Metric | Lines |\n\
| --- | ---: |\n\
| PR branch | 92.62% |\n\
| Base branch | 91.12% |\n\
| Delta | +1.50% |\n\
| Required floor | 90.00% |\n\
\n\
Artifact: `nook-core-coverage`\n"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_human_summary_text_in_place_of_llvm_cov_json() {
    let root = temporary_directory();
    let current = root.join("current");
    let base = root.join("base");
    write_coverage_directory(&current, 92.0, 90.0);
    write_coverage_directory(&base, 91.0, 90.0);
    fs::write(current.join("summary.json"), "TOTAL 123 120 92.00%\n").unwrap();

    let error = coverage_report(&current, &base).unwrap_err();

    assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    assert!(error.to_string().contains("summary.json"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn coverage_report_command_writes_github_outputs_and_markdown() {
    let root = temporary_directory();
    let current = root.join("current");
    let base = root.join("base");
    let github_output = root.join("github-output");
    let github_summary = root.join("github-summary");
    let markdown = root.join("coverage.md");
    write_coverage_directory(&current, 93.25, 90.0);
    write_coverage_directory(&base, 92.0, 90.0);

    let status = Command::new(env!("CARGO_BIN_EXE_nook-preflight"))
        .args(["coverage-report", "--current"])
        .arg(&current)
        .arg("--base")
        .arg(&base)
        .arg("--github-output")
        .arg(&github_output)
        .arg("--github-summary")
        .arg(&github_summary)
        .arg("--markdown")
        .arg(&markdown)
        .status()
        .unwrap();

    assert!(status.success());
    assert_eq!(
        fs::read_to_string(&github_output).unwrap(),
        "current=93.25\nbase=92.00\ndelta=+1.25\nfloor=90.00\nstatus=passed\n"
    );
    assert_eq!(
        fs::read_to_string(&markdown).unwrap(),
        fs::read_to_string(&github_summary).unwrap()
    );
    fs::remove_dir_all(root).unwrap();
}

fn write_coverage_directory(directory: &Path, percent: f64, floor: f64) {
    fs::create_dir_all(directory).unwrap();
    fs::write(
        directory.join("summary.json"),
        serde_json::json!({
            "data": [{
                "totals": {
                    "lines": {
                        "count": 100,
                        "covered": 90,
                        "percent": percent
                    }
                }
            }],
            "type": "llvm.coverage.json.export",
            "version": "2.0.1"
        })
        .to_string(),
    )
    .unwrap();
    fs::write(directory.join("summary.txt"), "summary").unwrap();
    fs::write(directory.join("lcov.info"), "lcov").unwrap();
    fs::write(
        directory.join("coverage-floor.json"),
        format!(r#"{{"lines_percent":{floor}}}"#),
    )
    .unwrap();
}

fn temporary_directory() -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let sequence = TEMPORARY_DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let process_id = std::process::id();
    let path = std::env::temp_dir().join(format!(
        "nook-preflight-coverage-{process_id}-{unique}-{sequence}"
    ));
    fs::create_dir(&path).unwrap();
    path
}

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < f64::EPSILON,
        "expected {expected}, got {actual}"
    );
}
