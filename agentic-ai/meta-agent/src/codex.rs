use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;

use tempfile::NamedTempFile;
use thiserror::Error;

const OUTPUT_SCHEMA: &str = include_str!("planner-output.schema.json");

#[derive(Debug, Clone)]
pub struct CodexOptions {
    pub binary: PathBuf,
    pub repo_root: PathBuf,
    pub model: Option<String>,
}

impl CodexOptions {
    pub fn new(repo_root: PathBuf) -> Self {
        Self {
            binary: PathBuf::from("codex"),
            repo_root,
            model: None,
        }
    }
}

pub trait CodexRunner {
    fn run(&self, prompt: &str) -> Result<String, CodexError>;
}

#[derive(Debug, Clone)]
pub struct ProcessCodexRunner {
    options: CodexOptions,
}

impl ProcessCodexRunner {
    pub fn new(options: CodexOptions) -> Self {
        Self { options }
    }
}

#[derive(Debug, Error)]
pub enum CodexError {
    #[error("failed to prepare Codex structured-output files: {0}")]
    TemporaryFile(#[source] std::io::Error),
    #[error("failed to start `{binary}`: {source}")]
    Start {
        binary: String,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to send the planning prompt to Codex: {0}")]
    Stdin(#[source] std::io::Error),
    #[error("failed while waiting for Codex: {0}")]
    Wait(#[source] std::io::Error),
    #[error("the Codex stderr forwarding thread stopped unexpectedly")]
    StderrThread,
    #[error("Codex exited with {status}: {stderr}")]
    Failed { status: String, stderr: String },
    #[error("Codex completed without a structured final response")]
    EmptyResponse,
    #[error("failed to read the Codex structured response: {0}")]
    ReadResponse(#[source] std::io::Error),
}

impl CodexRunner for ProcessCodexRunner {
    fn run(&self, prompt: &str) -> Result<String, CodexError> {
        let mut schema = NamedTempFile::new().map_err(CodexError::TemporaryFile)?;
        schema
            .write_all(OUTPUT_SCHEMA.as_bytes())
            .map_err(CodexError::TemporaryFile)?;
        schema.flush().map_err(CodexError::TemporaryFile)?;
        let response = NamedTempFile::new().map_err(CodexError::TemporaryFile)?;

        let mut command = Command::new(&self.options.binary);
        command
            .arg("exec")
            .arg("--ephemeral")
            .arg("--sandbox")
            .arg("read-only")
            .arg("--color")
            .arg("never")
            .arg("--output-schema")
            .arg(schema.path())
            .arg("--output-last-message")
            .arg(response.path())
            .arg("--cd")
            .arg(&self.options.repo_root);
        if let Some(model) = &self.options.model {
            command.arg("--model").arg(model);
        }
        command
            .arg("-")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());

        let binary = self.options.binary.display().to_string();
        let mut child = command
            .spawn()
            .map_err(|source| CodexError::Start { binary, source })?;
        child
            .stdin
            .take()
            .ok_or_else(|| {
                CodexError::Stdin(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "Codex stdin was unavailable",
                ))
            })?
            .write_all(prompt.as_bytes())
            .map_err(CodexError::Stdin)?;

        let mut stderr = child.stderr.take().ok_or(CodexError::StderrThread)?;
        let stderr_thread = thread::spawn(move || -> Result<Vec<u8>, std::io::Error> {
            let mut captured = Vec::new();
            let mut chunk = [0_u8; 8 * 1024];
            loop {
                let count = stderr.read(&mut chunk)?;
                if count == 0 {
                    break;
                }
                std::io::stderr().write_all(&chunk[..count])?;
                std::io::stderr().flush()?;
                captured.extend_from_slice(&chunk[..count]);
            }
            Ok(captured)
        });
        let status = child.wait().map_err(CodexError::Wait)?;
        let stderr = stderr_thread
            .join()
            .map_err(|_| CodexError::StderrThread)?
            .map_err(CodexError::Wait)?;
        if !status.success() {
            return Err(CodexError::Failed {
                status: status
                    .code()
                    .map_or_else(|| "a signal".into(), |code| format!("status {code}")),
                stderr: String::from_utf8_lossy(&stderr).trim().to_owned(),
            });
        }

        let response = fs::read_to_string(response.path()).map_err(CodexError::ReadResponse)?;
        if response.trim().is_empty() {
            return Err(CodexError::EmptyResponse);
        }
        Ok(response)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    #[test]
    fn invokes_codex_exec_with_read_only_structured_output() {
        let temporary = tempfile::tempdir().unwrap();
        let repository = temporary.path().join("repository");
        fs::create_dir(&repository).unwrap();
        let script = temporary.path().join("fake-codex");
        let log = temporary.path().join("invocation.log");
        fs::write(
            &script,
            format!(
                r#"#!/bin/sh
set -eu
log='{}'
output=''
printf '%s\n' "$@" > "$log"
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then
    shift
    output="$1"
  fi
  shift
done
printf '%s' '{{"ok":true}}' > "$output"
printf '%s\n' '--- prompt ---' >> "$log"
cat >> "$log"
"#,
                log.display()
            ),
        )
        .unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();

        let runner = ProcessCodexRunner::new(CodexOptions {
            binary: script,
            repo_root: repository.clone(),
            model: Some("test-model".into()),
        });
        let response = runner.run("Plan the feature").unwrap();

        assert_eq!(response, r#"{"ok":true}"#);
        let invocation = fs::read_to_string(log).unwrap();
        assert!(invocation.contains("exec\n--ephemeral\n--sandbox\nread-only"));
        assert!(invocation.contains("--output-schema"));
        assert!(invocation.contains(&format!("--cd\n{}", repository.display())));
        assert!(invocation.contains("--model\ntest-model\n-"));
        assert!(invocation.ends_with("--- prompt ---\nPlan the feature"));
    }
}
