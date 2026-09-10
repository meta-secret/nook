use crate::codex::activity::LocalExecutionRecord;
use std::collections::HashMap;
use std::env;
use std::future::Future;
use std::io::{self, IsTerminal, Write};
use std::path::PathBuf;
use std::sync::Arc;

use codex::{
    AbsolutePathBuf, Arg0DispatchPaths, AskForApproval, AuthManager, CodexAppsToolsCache,
    CodexHomeUserInstructionsProvider, CodexThread, Config, Constrained, EnvironmentManager,
    EventMsg, ExecServerRuntimePaths, ExternalAuth, Features, NewThread, OPENAI_PROVIDER_ID,
    PermissionProfile, Permissions, ProjectConfig, SessionSource, StartIfIdleSubmission,
    StartThreadOptions, ThreadManager, TurnInputRequest, TurnStartOptions, UserInput,
    WebSearchMode, build_models_manager, built_in_model_providers, empty_extension_registry,
    find_codex_home, init_state_db, local_agent_graph_store_from_state_db, resolve_installation_id,
    thread_store_from_config,
};
use thiserror::Error;
use tokio::sync::mpsc;

use crate::model::{TaskActivity, TerminalResult};
mod output;
use output::CodexTurnOutput;
pub use output::{
    PlannedFeature, PlannedTask, PlannedTaskPriority, PlannedTaskResources, PlannerOutput,
};

mod activity;
mod configuration;
pub use configuration::{ActivityReporting, GitHubCredential};
use configuration::{Authentication, ExecutionLogging};
mod progress;
mod progress_output;

use progress::*;

const OUTPUT_SCHEMA: &str = include_str!("planner-output.schema.json");
const TASK_OUTPUT_SCHEMA: &str = include_str!("task-output.schema.json");
pub const DEFAULT_CODEX_MODEL: &str = "gpt-5.6-sol";
pub const DEFAULT_CODEX_REASONING_EFFORT: &str = "medium";
pub const SOL_EXHAUSTED_CODEX_MODEL: &str = "gpt-5.3-codex-spark";
pub const SOL_EXHAUSTED_CODEX_REASONING_EFFORT: &str = "xhigh";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexAccess {
    ReadOnly,
    WorkspaceWrite,
}

#[derive(Debug, Clone)]
pub struct CodexOptions {
    pub repo_root: PathBuf,
    pub model: String,
    pub reasoning_effort: String,
    pub arg0_paths: Arg0DispatchPaths,
    pub access: CodexAccess,
    pub github_token: GitHubCredential,
    pub activity_sender: ActivityReporting,
}

impl CodexOptions {
    pub fn new(repo_root: PathBuf) -> Self {
        Self {
            repo_root,
            model: DEFAULT_CODEX_MODEL.to_owned(),
            reasoning_effort: DEFAULT_CODEX_REASONING_EFFORT.to_owned(),
            arg0_paths: Arg0DispatchPaths::default(),
            access: CodexAccess::ReadOnly,
            github_token: GitHubCredential::from_environment(),
            activity_sender: ActivityReporting::Disabled,
        }
    }

    pub fn with_workspace_write(mut self) -> Self {
        self.access = CodexAccess::WorkspaceWrite;
        self
    }

    pub fn with_activity_sender(mut self, sender: mpsc::UnboundedSender<TaskActivity>) -> Self {
        self.activity_sender = ActivityReporting::Enabled(sender);
        self
    }
}

pub trait CodexRunner {
    fn run<'a>(
        &'a self,
        prompt: &'a str,
    ) -> impl Future<Output = Result<PlannerOutput, CodexError>> + Send + 'a;
}

#[derive(Clone)]
pub struct InProcessCodexRunner {
    options: CodexOptions,
    external_auth: Authentication,
}

impl InProcessCodexRunner {
    pub fn new(options: CodexOptions) -> Self {
        Self {
            options,
            external_auth: Authentication::Local,
        }
    }

    pub fn with_external_auth(options: CodexOptions, external_auth: Arc<dyn ExternalAuth>) -> Self {
        Self {
            options,
            external_auth: Authentication::External(external_auth),
        }
    }

    async fn run_turn(&self, prompt: &str, kind: TurnKind) -> Result<CodexTurnOutput, CodexError> {
        let primary_result = self.attempt_turn(prompt, kind.clone(), &self.options).await;
        if let Err(error) = primary_result {
            if self.options.model != SOL_EXHAUSTED_CODEX_MODEL
                && CodexError::is_sol_exhausted_error(&error)
            {
                let mut fallback_options = self.options.clone();
                fallback_options.model = SOL_EXHAUSTED_CODEX_MODEL.to_owned();
                fallback_options.reasoning_effort = SOL_EXHAUSTED_CODEX_REASONING_EFFORT.to_owned();
                let fallback_result = self
                    .attempt_turn(prompt, kind, &fallback_options)
                    .await
                    .map_err(|fallback_error| CodexError::Run(format!(
                        "primary model `{}` failed, fallback to `{}` with xhigh effort also failed: {}; {}",
                        self.options.model,
                        SOL_EXHAUSTED_CODEX_MODEL,
                        error,
                        fallback_error
                    )))?;
                return Ok(fallback_result);
            }
            return Err(error);
        }
        primary_result
    }

    async fn attempt_turn(
        &self,
        prompt: &str,
        kind: TurnKind,
        options: &CodexOptions,
    ) -> Result<CodexTurnOutput, CodexError> {
        let config = CodexOptions::new_config(options).await?;
        let state_db = init_state_db(&config).await;
        let auth_manager =
            AuthManager::shared_from_config(&config, /* enable_codex_api_key_env */ false)
                .await
                .map_err(|error| CodexError::Run(error.to_string()))?;
        if let Authentication::External(external_auth) = &self.external_auth {
            auth_manager
                .set_external_auth(Arc::clone(external_auth))
                .await
                .map_err(|error| CodexError::Run(error.to_string()))?;
        }
        let runtime_paths = ExecServerRuntimePaths::from_optional_paths(
            config.codex_self_exe.clone(),
            config.codex_linux_sandbox_exe.clone(),
        )
        .map_err(|error| CodexError::Run(error.to_string()))?;
        let thread_store = thread_store_from_config(&config, state_db.clone());
        let environment_manager = Arc::new(
            EnvironmentManager::from_codex_home(
                config.codex_home.clone(),
                Some(runtime_paths),
                config.http_client_factory(),
            )
            .await
            .map_err(|error| CodexError::Run(error.to_string()))?,
        );
        let installation_id = resolve_installation_id(&config.codex_home)
            .await
            .map_err(|error| CodexError::Run(error.to_string()))?;
        let user_instructions_provider = Arc::new(CodexHomeUserInstructionsProvider::new(
            config.codex_home.clone(),
        ));
        let thread_manager = ThreadManager::new(
            &config,
            Arc::clone(&auth_manager),
            build_models_manager(&config, auth_manager),
            CodexAppsToolsCache::default(),
            SessionSource::Exec,
            environment_manager,
            empty_extension_registry::<Config>(),
            user_instructions_provider,
            /* analytics_events_client */ None,
            Arc::clone(&thread_store),
            local_agent_graph_store_from_state_db(state_db.as_ref()),
            installation_id,
            /* attestation_provider */ None,
            /* external_time_provider */ None,
        );
        let NewThread {
            thread_id, thread, ..
        } = thread_manager
            .start_thread(StartThreadOptions::new(config))
            .await
            .map_err(|error| CodexError::Run(error.to_string()))?;

        let execution_log = if matches!(&kind, TurnKind::Task(_)) {
            ExecutionLogging::File(
                options
                    .repo_root
                    .parent()
                    .unwrap_or(&options.repo_root)
                    .join(".hive-local-executions.jsonl"),
            )
        } else {
            ExecutionLogging::Disabled
        };
        let turn_result = (CodexTurn {
            thread: &thread,
            prompt,
            kind,
            execution_log: &execution_log,
            activity_sender: &options.activity_sender,
        })
        .submit_and_wait()
        .await;
        let shutdown_result = thread.shutdown_and_wait().await;
        let _ = thread_manager.remove_thread(&thread_id).await;

        let response = turn_result?;
        shutdown_result.map_err(|error| CodexError::Run(error.to_string()))?;
        Ok(response)
    }

    pub async fn execute_task(
        &self,
        task_id: &str,
        prompt: &str,
    ) -> Result<TerminalResult, CodexError> {
        match self
            .run_turn(prompt, TurnKind::Task(task_id.to_owned()))
            .await?
        {
            CodexTurnOutput::Task(result) => Ok(result),
            CodexTurnOutput::Planning(_) => Err(CodexError::UnexpectedOutput),
        }
    }
}

#[derive(Debug, Clone)]
enum TurnKind {
    Planning,
    Task(String),
}

#[derive(Debug, Error)]
pub enum CodexError {
    #[error("failed to configure the embedded Codex turn: {0}")]
    Configuration(String),
    #[error("the embedded Codex turn failed: {0}")]
    Run(String),
    #[error("Codex completed without a structured final response")]
    EmptyResponse,
    #[error("the embedded Codex output schema is invalid: {0}")]
    OutputSchema(#[source] serde_json::Error),
    #[error("Codex completed with an invalid structured response: {0}")]
    OutputDecode(#[source] serde_json::Error),
    #[error("Codex returned a response for a different turn kind")]
    UnexpectedOutput,
}

impl CodexError {
    fn is_sol_exhausted_error(error: &CodexError) -> bool {
        match error {
            CodexError::Run(message) => CodexError::is_sol_exhaustion_message(message),
            _ => false,
        }
    }
}

impl CodexError {
    fn is_sol_exhaustion_message(message: &str) -> bool {
        let message = message.to_ascii_lowercase();

        const SOL_EXHAUSTION_MARKERS: [&str; 8] = [
            "sol exhausted",
            "sol budget",
            "sol limit",
            "sol quota",
            "out of sol",
            "insufficient sol",
            "no sol",
            "usage limit",
        ];
        if SOL_EXHAUSTION_MARKERS
            .iter()
            .any(|marker| message.contains(marker))
        {
            return true;
        }

        if message.contains("quota")
            && (message.contains("exceed")
                || message.contains("exhaust")
                || message.contains("depleted")
                || message.contains("remaining"))
        {
            return true;
        }

        message.contains("rate limit")
            || message.contains("too many requests")
            || message.contains("not enough credits")
            || message.contains("insufficient credits")
            || message.contains("credits remaining")
            || message.contains("429")
    }
}

impl CodexRunner for InProcessCodexRunner {
    fn run<'a>(
        &'a self,
        prompt: &'a str,
    ) -> impl Future<Output = Result<PlannerOutput, CodexError>> + Send + 'a {
        async move {
            match self.run_turn(prompt, TurnKind::Planning).await? {
                CodexTurnOutput::Planning(plan) => Ok(plan),
                CodexTurnOutput::Task(_) => Err(CodexError::UnexpectedOutput),
            }
        }
    }
}

struct CodexTurn<'a> {
    thread: &'a CodexThread,
    prompt: &'a str,
    kind: TurnKind,
    execution_log: &'a ExecutionLogging,
    activity_sender: &'a ActivityReporting,
}
impl CodexTurn<'_> {
    async fn submit_and_wait(self) -> Result<CodexTurnOutput, CodexError> {
        let Self {
            thread,
            prompt,
            kind,
            execution_log,
            activity_sender,
        } = self;
        let schema = match &kind {
            TurnKind::Planning => OUTPUT_SCHEMA,
            TurnKind::Task(_) => TASK_OUTPUT_SCHEMA,
        };
        // The SDK requires an arbitrary JSON Schema document at this transport boundary.
        let output_schema = serde_json::from_str(schema).map_err(CodexError::OutputSchema)?;
        let request = TurnInputRequest::user_input(vec![UserInput::Text {
            text: prompt.to_owned(),
            text_elements: Vec::new(),
        }])
        .on_start(TurnStartOptions {
            final_output_json_schema: Some(output_schema),
            ..TurnStartOptions::default()
        });
        let submission = thread
            .start_turn_if_idle(request)
            .await
            .map_err(|error| CodexError::Run(error.to_string()))?;
        if let StartIfIdleSubmission::NotSubmitted { reason } = submission {
            return Err(CodexError::Run(format!(
                "Codex rejected the initial Hive turn: {reason:?}"
            )));
        }

        let stderr = io::stderr();
        let decorate = if stderr.is_terminal() && env::var_os("NO_COLOR").is_none() {
            ProgressDecoration::Ansi
        } else {
            ProgressDecoration::Plain
        };
        let mut progress = match &kind {
            TurnKind::Planning => TurnProgress::Planning(ProgressReporter::new(ProgressOutput {
                writer: stderr,
                decoration: decorate,
            })),
            TurnKind::Task(task_id) => {
                TurnProgress::Task(TaskProgressReporter::new(TaskProgressOutput {
                    output: ProgressOutput {
                        writer: stderr,
                        decoration: decorate,
                    },
                    task_id: task_id.clone(),
                }))
            }
        };
        loop {
            let event = thread
                .next_event()
                .await
                .map_err(|error| CodexError::Run(error.to_string()))?;
            let observed;
            (progress, observed) = progress.observe(&event.msg);
            observed
                .map_err(|error| CodexError::Run(format!("failed to write progress: {error}")))?;
            if let (
                ActivityReporting::Enabled(sender),
                activity::ActivityDisposition::Record(activity),
            ) = (
                activity_sender,
                TaskActivity::task_activity_from_event(&event.msg),
            ) {
                let _ = sender.send(activity);
            }
            if let (ExecutionLogging::File(path), EventMsg::ExecCommandEnd(execution)) =
                (execution_log, &event.msg)
            {
                LocalExecutionRecord::record_local_execution(
                    path,
                    &execution.command,
                    execution.exit_code,
                    execution.duration,
                )
                .await
                .map_err(|error| CodexError::Run(format!("record local execution: {error:#}")))?;
            }
            match event.msg {
                EventMsg::TurnComplete(event) => {
                    let text = event
                        .last_agent_message
                        .filter(|message| !message.trim().is_empty())
                        .ok_or(CodexError::EmptyResponse)?;
                    return CodexTurnOutput::decode(&kind, &text).map_err(CodexError::OutputDecode);
                }
                EventMsg::Error(event) => return Err(CodexError::Run(event.message)),
                EventMsg::TurnAborted(event) => {
                    return Err(CodexError::Run(format!("turn aborted: {:?}", event.reason)));
                }
                EventMsg::ExecApprovalRequest(_) | EventMsg::ApplyPatchApprovalRequest(_) => {
                    return Err(CodexError::Run(
                        "Codex turn unexpectedly requested approval".into(),
                    ));
                }
                EventMsg::RequestPermissions(_) => {
                    return Err(CodexError::Run(
                        "Codex turn requested additional permissions".into(),
                    ));
                }
                EventMsg::RequestUserInput(_) => {
                    return Err(CodexError::Run(
                        "Codex turn requested interactive user input".into(),
                    ));
                }
                EventMsg::DynamicToolCallRequest(_) => {
                    return Err(CodexError::Run(
                        "Codex turn requested an unsupported dynamic tool".into(),
                    ));
                }
                _ => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time;
    use tokio::fs as async_fs;

    #[derive(serde::Deserialize)]
    struct RecordedExecution {
        command: String,
        category: String,
        started_at: String,
        finished_at: String,
        duration_seconds: u64,
        outcome: String,
        reason: String,
    }

    #[tokio::test]
    async fn configures_an_ephemeral_read_only_core_thread() -> crate::HiveResult<()> {
        let repository = tempfile::tempdir()?;
        let options = CodexOptions {
            repo_root: repository.path().to_owned(),
            model: "test-model".into(),
            reasoning_effort: "low".into(),
            arg0_paths: Arg0DispatchPaths {
                codex_self_exe: Some(PathBuf::from("/bin/meta-agent")),
                codex_linux_sandbox_exe: Some(PathBuf::from("/bin/codex-linux-sandbox")),
                main_execve_wrapper_exe: Some(PathBuf::from("/bin/codex-execve-wrapper")),
            },
            access: CodexAccess::ReadOnly,
            github_token: GitHubCredential::InheritEnvironment,
            activity_sender: ActivityReporting::Disabled,
        };
        let config = CodexOptions::new_config(&options).await?;

        assert_eq!(config.model.as_deref(), Some("test-model"));
        assert_eq!(
            config
                .model_reasoning_effort
                .as_ref()
                .map(ToString::to_string)
                .as_deref(),
            Some("low")
        );
        assert_eq!(config.cwd.as_ref(), repository.path());
        assert_eq!(config.workspace_roots, vec![config.cwd.clone()]);
        assert!(config.workspace_roots_explicit);
        assert!(config.ephemeral);
        assert_eq!(config.agent_max_threads, Some(1));
        assert!(!config.include_permissions_instructions);
        assert!(!config.include_apps_instructions);
        assert!(!config.include_collaboration_mode_instructions);
        assert!(!config.include_skill_instructions);
        assert!(!config.include_environment_context);
        assert_eq!(
            config.codex_self_exe,
            Some(PathBuf::from("/bin/meta-agent"))
        );
        assert_eq!(
            config.permissions.permission_profile(),
            &PermissionProfile::read_only()
        );
        Ok(())
    }

    #[test]
    fn defaults_to_gpt_5_6_sol_with_medium_reasoning() -> crate::HiveResult<()> {
        let repository = tempfile::tempdir()?;
        let options = CodexOptions::new(repository.path().to_owned());

        assert_eq!(options.model, DEFAULT_CODEX_MODEL);
        assert_eq!(options.reasoning_effort, DEFAULT_CODEX_REASONING_EFFORT);
        Ok(())
    }

    #[test]
    fn detects_usage_limit_as_sol_exhaustion() {
        assert!(CodexError::is_sol_exhaustion_message(
            "embedded Codex execution failed: you've hit your usage limit. Visit the usage page"
        ));
        assert!(!CodexError::is_sol_exhaustion_message(
            "embedded Codex execution failed: unknown network timeout while reaching Codex"
        ));
    }

    #[tokio::test]
    async fn trusted_task_thread_receives_direct_github_access() -> crate::HiveResult<()> {
        let repository = tempfile::tempdir()?;
        let github_token = "test-token".to_owned();
        let mut options = CodexOptions::new(repository.path().to_owned()).with_workspace_write();
        options.github_token = GitHubCredential::Token(github_token.clone());
        let config = CodexOptions::new_config(&options).await?;

        assert_eq!(
            config.permissions.permission_profile(),
            &PermissionProfile::Disabled
        );
        assert_eq!(config.workspace_roots, vec![config.cwd.clone()]);
        assert_eq!(
            config
                .permissions
                .shell_environment_policy
                .r#set
                .get("GH_TOKEN")
                .map(String::as_str),
            Some(github_token.as_str())
        );
        assert_eq!(
            config
                .permissions
                .shell_environment_policy
                .r#set
                .get("GITHUB_TOKEN")
                .map(String::as_str),
            Some(github_token.as_str())
        );
        Ok(())
    }

    #[test]
    fn task_output_schema_uses_the_strict_structured_output_subset() -> crate::HiveResult<()> {
        let schema: serde_json::Value = serde_json::from_str(TASK_OUTPUT_SCHEMA)?;
        let serialized = serde_json::to_string(&schema)?;
        for unsupported in [
            "\"oneOf\"",
            "\"allOf\"",
            "\"not\"",
            "\"minLength\"",
            "\"maxLength\"",
            "\"pattern\"",
        ] {
            assert!(
                !serialized.contains(unsupported),
                "task output schema contains unsupported keyword {unsupported}"
            );
        }
        let blocker = schema
            .pointer("/properties/blocker")
            .ok_or_else(|| crate::HiveError::message("task output schema must define blocker"))?;
        assert_eq!(
            blocker.get("type").and_then(serde_json::Value::as_str),
            Some("object")
        );
        assert_eq!(
            blocker
                .get("required")
                .and_then(serde_json::Value::as_array)
                .map(Vec::len),
            Some(4)
        );
        Ok(())
    }

    #[tokio::test]
    async fn trusted_execution_options_disable_the_inner_permission_profile()
    -> crate::HiveResult<()> {
        let repository = tempfile::tempdir()?;
        let options = CodexOptions::new(repository.path().to_owned()).with_workspace_write();
        let config = CodexOptions::new_config(&options).await?;

        assert_eq!(options.access, CodexAccess::WorkspaceWrite);
        assert_eq!(
            config.permissions.permission_profile(),
            &PermissionProfile::Disabled
        );
        Ok(())
    }

    #[test]
    fn progress_reporter_streams_reasoning_and_deduplicates_plan_status() -> crate::HiveResult<()> {
        let mut progress = ProgressReporter::new(ProgressOutput {
            writer: Vec::new(),
            decoration: ProgressDecoration::Plain,
        });

        let outcome;
        (progress, outcome) = progress.reasoning_delta("Inspecting ");
        outcome?;
        let outcome;
        (progress, outcome) = progress.reasoning_delta("the repository.\n");
        outcome?;
        let outcome;
        (progress, outcome) = progress.announce_plan_output();
        outcome?;
        let outcome;
        (progress, outcome) = progress.announce_plan_output();
        outcome?;
        let outcome;
        (progress, outcome) = progress.finish_reasoning();
        outcome?;

        let announcement = progress.plan_output_announced();
        assert_eq!(
            String::from_utf8(progress.writer)?,
            "  ↳ Inspecting the repository.\n  ◆  Building feature plan\n     Writing structured tasks and dependencies\n"
        );
        assert!(matches!(announcement, Announcement::Announced));
        Ok(())
    }

    #[test]
    fn inspection_progress_hides_shell_commands_behind_readable_steps() -> crate::HiveResult<()> {
        let mut progress = ProgressReporter::new(ProgressOutput {
            writer: Vec::new(),
            decoration: ProgressDecoration::Plain,
        });
        let commands = [
            vec![
                "/bin/zsh".into(),
                "-lc".into(),
                "pwd && rg --files -g 'AGENTS.md' && sed -n '1,240p' .cortex/AGENTS.md".into(),
            ],
            vec![
                "/bin/zsh".into(),
                "-lc".into(),
                "rg -n -i 'onboard|simple vault' nook-app --glob '!target/**'".into(),
            ],
            vec![
                "/bin/zsh".into(),
                "-lc".into(),
                "sed -n '1,220p' .cortex/shared/architecture/system.md".into(),
            ],
        ];

        for command in commands {
            let outcome;
            (progress, outcome) = progress.inspection(&command);
            outcome?;
        }
        let output = String::from_utf8(progress.writer)?;

        assert!(output.contains("01  Discovering project instructions"));
        assert!(output.contains("02  Searching implementation"));
        assert!(output.contains("03  Reading architecture and project guidance"));
        assert!(output.contains(".cortex/AGENTS.md"));
        assert!(!output.contains("/bin/zsh"));
        assert!(!output.contains("rg -n"));
        Ok(())
    }

    #[test]
    fn failed_inspection_includes_the_command_for_debugging() -> crate::HiveResult<()> {
        let mut progress = ProgressReporter::new(ProgressOutput {
            writer: Vec::new(),
            decoration: ProgressDecoration::Plain,
        });
        let command = vec!["/bin/zsh".into(), "-lc".into(), "rg missing-file".into()];

        let outcome;
        (progress, outcome) = progress.failed_inspection(2, &command);
        outcome?;
        let output = String::from_utf8(progress.writer)?;

        assert!(output.contains("Repository inspection failed (exit 2)"));
        assert!(output.contains("/bin/zsh -lc rg missing-file"));
        Ok(())
    }

    #[test]
    fn task_progress_logs_only_fixed_secret_safe_metadata() -> crate::HiveResult<()> {
        let mut progress = TaskProgressReporter::new(TaskProgressOutput {
            output: ProgressOutput {
                writer: Vec::new(),
                decoration: ProgressDecoration::Plain,
            },
            task_id: "core-agent".into(),
        });

        let outcome;
        (progress, outcome) = progress.line("36", "●", "start", "Agent started");
        outcome?;
        let outcome;
        (progress, outcome) = progress.command_finished(
            &["cargo".into(), "test".into(), "-p".into(), "core".into()],
            0,
            1.24,
        );
        outcome?;
        let outcome;
        (progress, outcome) =
            progress.line("33", "!", "warning", "Embedded turn reported a warning");
        outcome?;
        let outcome;
        (progress, outcome) = progress.announce_finalizing();
        outcome?;
        let outcome;
        (progress, outcome) = progress.announce_finalizing();
        outcome?;

        let output = String::from_utf8(progress.writer)?;
        assert!(output.contains("core-agent"));
        assert!(output.contains("result  · 1.2s · verification completed"));
        assert!(output.contains("Embedded turn reported a warning"));
        assert_eq!(output.matches("Finalizing task result").count(), 1);
        Ok(())
    }

    #[test]
    fn task_progress_does_not_reveal_failed_commands_or_output() -> crate::HiveResult<()> {
        let mut progress = TaskProgressReporter::new(TaskProgressOutput {
            output: ProgressOutput {
                writer: Vec::new(),
                decoration: ProgressDecoration::Plain,
            },
            task_id: "ui-agent".into(),
        });

        let outcome;
        (progress, outcome) = progress.command_finished(
            &["secret-command".into(), "credential-value".into()],
            1,
            0.5,
        );
        outcome?;

        let output = String::from_utf8(progress.writer)?;
        assert!(output.contains("failed  · Repository command exited with status 1"));
        assert!(!output.contains("secret-command"));
        assert!(!output.contains("credential-value"));
        Ok(())
    }

    #[test]
    fn progress_helpers_bound_untrusted_text_and_classify_validation() {
        assert_eq!(
            (TaskProgressLabel {
                task_id: "short-task"
            })
            .compact_task_id(),
            "short-task"
        );
        let compact = (TaskProgressLabel {
            task_id: "a-very-long-task-identifier-that-must-be-bounded",
        })
        .compact_task_id();
        assert_eq!(compact.chars().count(), 30);
        assert!(compact.ends_with('…'));
        assert_eq!(
            (ProgressText {
                message: "  several   spaced words  "
            })
            .compact_text(40),
            "several spaced words"
        );
        assert_eq!(
            (ProgressText {
                message: "sensitive detail"
            })
            .compact_text(1),
            "…"
        );
        assert!(InspectionSummary::is_verification_command(&[
            "cargo".into(),
            "clippy".into()
        ]));
        assert!(InspectionSummary::is_verification_command(&[
            "bun".into(),
            "run".into(),
            "test".into()
        ]));
        assert!(!InspectionSummary::is_verification_command(&[
            "git".into(),
            "status".into()
        ]));
        assert!(matches!(
            (TaskProgressLabel {
                task_id: "worker-a"
            })
            .agent_color(),
            "36" | "35" | "34" | "33"
        ));

        let files = InspectionSummary::inspection_file_hints(
            "sed -n 1,20p src/lib.rs README.md config.toml",
        );
        assert_eq!(
            files,
            InspectionHints::Files("src/lib.rs · README.md · config.toml".to_owned())
        );
        assert_eq!(
            InspectionSummary::inspection_file_hints("git status"),
            InspectionHints::NoHints
        );
    }

    #[test]
    fn progress_rendering_closes_reasoning_and_supports_plain_and_decorated_output()
    -> crate::HiveResult<()> {
        let mut progress = ProgressReporter::new(ProgressOutput {
            writer: Vec::new(),
            decoration: ProgressDecoration::Plain,
        });
        let outcome;
        (progress, outcome) = progress.reasoning_delta("unfinished");
        outcome?;
        let outcome;
        (progress, outcome) =
            progress.phase("✓", "Complete", ProgressDetail::Detail("all checks passed"));
        outcome?;
        let outcome;
        (progress, outcome) = progress.note("first\n\n second ");
        outcome?;
        let outcome;
        (progress, outcome) = progress.alert("!", "Warning", "bounded detail", "33");
        outcome?;
        let output = String::from_utf8(progress.writer)?;
        assert!(output.contains("unfinished\n  ✓  Complete"));
        assert!(output.contains("↳ first\n  ↳ second"));
        assert!(output.contains("!  Warning"));

        let decorated = TaskProgressReporter::new(TaskProgressOutput {
            output: ProgressOutput {
                writer: Vec::new(),
                decoration: ProgressDecoration::Ansi,
            },
            task_id: "worker".into(),
        });
        assert_eq!(
            decorated.paint("31", "failure"),
            "\u{1b}[31mfailure\u{1b}[0m"
        );
        Ok(())
    }

    #[tokio::test]
    async fn local_execution_records_only_sanitized_validation_metadata() -> crate::HiveResult<()> {
        let root = tempfile::tempdir()?;
        let log = root.path().join("events.jsonl");
        LocalExecutionRecord::record_local_execution(
            &log,
            &["/bin/sh".into(), "-c".into(), "cargo test -p hive".into()],
            1,
            time::Duration::from_secs(3),
        )
        .await?;
        let line = async_fs::read_to_string(&log).await?;
        let record: RecordedExecution = serde_json::from_str(line.trim())?;
        assert_eq!(record.command, "cargo test");
        assert_eq!(record.category, "test");
        assert!(!record.started_at.is_empty());
        assert!(!record.finished_at.is_empty());
        assert_eq!(record.duration_seconds, 3);
        assert_eq!(record.outcome, "failed");
        assert_eq!(record.reason, "embedded_codex_validation");

        let absent = root.path().join("absent.jsonl");
        LocalExecutionRecord::record_local_execution(
            &absent,
            &["git".into(), "status".into()],
            0,
            time::Duration::ZERO,
        )
        .await?;
        assert!(!absent.exists());
        Ok(())
    }
}
