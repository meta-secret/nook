use nook_preflight::coverage::{
    CoverageArtifact, CoverageArtifactValidation, CoverageInputChanges, CoverageReport,
    CoverageReportComparison, CoverageRevisionComparison,
};
use std::collections::HashMap;
use std::env;
use std::ffi::{OsStr, OsString};
use std::io;
use std::path::PathBuf;
use std::process;

fn main() {
    if let Err(error) = PreflightCommand::run(env::args_os().skip(1)) {
        eprintln!("nook-preflight: {error}");
        process::exit(2);
    }
}

struct PreflightCommand {
    command: String,
    options: HashMap<String, OsString>,
}
impl PreflightCommand {
    fn run(arguments: impl IntoIterator<Item = OsString>) -> io::Result<()> {
        let mut arguments = arguments.into_iter();
        let command = arguments
            .next()
            .and_then(|value| value.into_string().ok())
            .ok_or_else(|| PreflightCommand::usage("expected a command"))?;
        let options = PreflightCommand::parse_options(arguments)?;

        Self { command, options }.execute()
    }
    fn execute(self) -> io::Result<()> {
        let Self { command, options } = self;
        match command.as_str() {
            "coverage-inputs" => {
                let repository = PreflightCommand::required_path(&options, "--repository")?;
                let base = PreflightCommand::required_utf8(&options, "--base")?;
                let head = PreflightCommand::required_utf8(&options, "--head")?;
                let github_output = PreflightCommand::required_path(&options, "--github-output")?;
                CoverageInputChanges::coverage_inputs_from_git(CoverageRevisionComparison {
                    repository: &repository,
                    base,
                    head,
                })?
                .write_github_outputs(&github_output)
            }
            "validate-coverage-artifact" => {
                let directory = PreflightCommand::required_path(&options, "--directory")?;
                let commit = PreflightCommand::required_utf8(&options, "--commit")?;
                let github_output = PreflightCommand::required_path(&options, "--github-output")?;
                let validation = CoverageArtifact {
                    directory: &directory,
                    expected_commit: commit,
                }
                .validate();
                if let CoverageArtifactValidation::Invalid { reason } = &validation {
                    eprintln!(
                        "::warning::Base coverage artifact is unavailable or invalid: {reason}; using coverage-only fallback"
                    );
                }
                validation.write_github_outputs(&github_output)
            }
            "coverage-report" => {
                let current = PreflightCommand::required_path(&options, "--current")?;
                let base = PreflightCommand::required_path(&options, "--base")?;
                let github_output = PreflightCommand::required_path(&options, "--github-output")?;
                let github_summary = PreflightCommand::required_path(&options, "--github-summary")?;
                let markdown = PreflightCommand::required_path(&options, "--markdown")?;
                let report = CoverageReport::coverage_report(CoverageReportComparison {
                    current_directory: &current,
                    base_directory: &base,
                })?;
                report.write_github_outputs(&github_output)?;
                report.write_markdown(&markdown)?;
                report.append_github_summary(&github_summary)
            }
            _ => Err(PreflightCommand::usage(&format!(
                "unknown command {command}"
            ))),
        }
    }
}

impl PreflightCommand {
    fn parse_options(
        arguments: impl IntoIterator<Item = OsString>,
    ) -> io::Result<HashMap<String, OsString>> {
        let mut arguments = arguments.into_iter();
        let mut options = HashMap::new();
        while let Some(flag) = arguments.next() {
            let flag = flag
                .into_string()
                .map_err(|_| PreflightCommand::usage("option names must be UTF-8"))?;
            if !flag.starts_with("--") {
                return Err(PreflightCommand::usage(&format!(
                    "expected an option, got {flag}"
                )));
            }
            let value = arguments
                .next()
                .ok_or_else(|| PreflightCommand::usage(&format!("{flag} requires a value")))?;
            if options.insert(flag.clone(), value).is_some() {
                return Err(PreflightCommand::usage(&format!(
                    "{flag} was provided more than once"
                )));
            }
        }
        Ok(options)
    }
}

impl PreflightCommand {
    fn required<'a>(options: &'a HashMap<String, OsString>, name: &str) -> io::Result<&'a OsStr> {
        options
            .get(name)
            .map(OsString::as_os_str)
            .ok_or_else(|| PreflightCommand::usage(&format!("missing {name}")))
    }
}

impl PreflightCommand {
    fn required_utf8<'a>(
        options: &'a HashMap<String, OsString>,
        name: &str,
    ) -> io::Result<&'a str> {
        PreflightCommand::required(options, name)?
            .to_str()
            .ok_or_else(|| PreflightCommand::usage(&format!("{name} must be UTF-8")))
    }
}

impl PreflightCommand {
    fn required_path(options: &HashMap<String, OsString>, name: &str) -> io::Result<PathBuf> {
        PreflightCommand::required(options, name).map(PathBuf::from)
    }
}

impl PreflightCommand {
    fn usage(message: &str) -> io::Error {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "{message}\n\
             usage:\n\
             \x20 nook-preflight coverage-inputs --repository PATH --base SHA --head SHA --github-output PATH\n\
             \x20 nook-preflight validate-coverage-artifact --directory PATH --commit SHA --github-output PATH\n\
             \x20 nook-preflight coverage-report --current PATH --base PATH --github-output PATH --github-summary PATH --markdown PATH"
            ),
        )
    }
}
