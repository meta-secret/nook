use nook_preflight::coverage::{
    coverage_inputs_from_git, coverage_report, validate_coverage_artifact,
};
use std::collections::HashMap;
use std::env;
use std::ffi::OsString;
use std::io;
use std::path::PathBuf;

fn main() {
    if let Err(error) = run(env::args_os().skip(1)) {
        eprintln!("nook-preflight: {error}");
        std::process::exit(2);
    }
}

fn run(arguments: impl IntoIterator<Item = OsString>) -> io::Result<()> {
    let mut arguments = arguments.into_iter();
    let command = arguments
        .next()
        .and_then(|value| value.into_string().ok())
        .ok_or_else(|| usage("expected a command"))?;
    let options = parse_options(arguments)?;

    match command.as_str() {
        "coverage-inputs" => {
            let repository = required_path(&options, "--repository")?;
            let base = required_utf8(&options, "--base")?;
            let head = required_utf8(&options, "--head")?;
            let github_output = required_path(&options, "--github-output")?;
            coverage_inputs_from_git(&repository, base, head)?.write_github_outputs(&github_output)
        }
        "validate-coverage-artifact" => {
            let directory = required_path(&options, "--directory")?;
            let commit = required_utf8(&options, "--commit")?;
            let github_output = required_path(&options, "--github-output")?;
            let validation = validate_coverage_artifact(&directory, commit);
            if let Some(reason) = &validation.reason {
                eprintln!(
                    "::warning::Base coverage artifact is unavailable or invalid: {reason}; using coverage-only fallback"
                );
            }
            validation.write_github_outputs(&github_output)
        }
        "coverage-report" => {
            let current = required_path(&options, "--current")?;
            let base = required_path(&options, "--base")?;
            let github_output = required_path(&options, "--github-output")?;
            let github_summary = required_path(&options, "--github-summary")?;
            let markdown = required_path(&options, "--markdown")?;
            let report = coverage_report(&current, &base)?;
            report.write_github_outputs(&github_output)?;
            report.write_markdown(&markdown)?;
            report.append_github_summary(&github_summary)
        }
        _ => Err(usage(&format!("unknown command {command}"))),
    }
}

fn parse_options(
    arguments: impl IntoIterator<Item = OsString>,
) -> io::Result<HashMap<String, OsString>> {
    let mut arguments = arguments.into_iter();
    let mut options = HashMap::new();
    while let Some(flag) = arguments.next() {
        let flag = flag
            .into_string()
            .map_err(|_| usage("option names must be UTF-8"))?;
        if !flag.starts_with("--") {
            return Err(usage(&format!("expected an option, got {flag}")));
        }
        let value = arguments
            .next()
            .ok_or_else(|| usage(&format!("{flag} requires a value")))?;
        if options.insert(flag.clone(), value).is_some() {
            return Err(usage(&format!("{flag} was provided more than once")));
        }
    }
    Ok(options)
}

fn required<'a>(
    options: &'a HashMap<String, OsString>,
    name: &str,
) -> io::Result<&'a std::ffi::OsStr> {
    options
        .get(name)
        .map(OsString::as_os_str)
        .ok_or_else(|| usage(&format!("missing {name}")))
}

fn required_utf8<'a>(options: &'a HashMap<String, OsString>, name: &str) -> io::Result<&'a str> {
    required(options, name)?
        .to_str()
        .ok_or_else(|| usage(&format!("{name} must be UTF-8")))
}

fn required_path(options: &HashMap<String, OsString>, name: &str) -> io::Result<PathBuf> {
    required(options, name).map(PathBuf::from)
}

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
