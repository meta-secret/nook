use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::io::{self, IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use codex::{
    AbsolutePathBuf, AltScreenMode, ApprovalsReviewer, Arg0DispatchPaths, AskForApproval,
    AuthCredentialsStoreMode, AuthManager, AutoCompactTokenLimitScope,
    CodexHomeUserInstructionsProvider, CodexThread, Config, ConfigLayerStack, Constrained,
    EnvironmentManager, EventMsg, ExecServerRuntimePaths, ExternalAuth, Features,
    GhostSnapshotConfig, History, MemoriesConfig, ModelAvailabilityNuxConfig, MultiAgentV2Config,
    NewThread, Notice, OAuthCredentialsStoreMode, OPENAI_PROVIDER_ID, Op, OtelConfig,
    PermissionProfile, Permissions, ProjectConfig, RealtimeAudioConfig, RealtimeConfig,
    SessionPickerViewMode, SessionSource, TerminalResizeReflowConfig, ThreadManager,
    ThreadStoreConfig, ToolSuggestConfig, TuiKeymap, TuiNotificationSettings, TuiPetAnchor,
    UriBasedFileOpener, UserInput, WebSearchMode, build_models_manager, built_in_model_providers,
    empty_extension_registry, find_codex_home, init_state_db,
    local_agent_graph_store_from_state_db, resolve_installation_id, thread_store_from_config,
};
use thiserror::Error;
use tokio::sync::mpsc;

use crate::model::TaskActivity;

mod activity;
mod progress;
use activity::{record_local_execution, task_activity_from_event};
use progress::*;

const OUTPUT_SCHEMA: &str = include_str!("planner-output.schema.json");
const TASK_OUTPUT_SCHEMA: &str = include_str!("task-output.schema.json");
pub const DEFAULT_CODEX_MODEL: &str = "gpt-5.6-terra";
pub const DEFAULT_CODEX_REASONING_EFFORT: &str = "low";

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
    pub github_token: Option<String>,
    pub activity_sender: Option<mpsc::UnboundedSender<TaskActivity>>,
}

impl CodexOptions {
    pub fn new(repo_root: PathBuf) -> Self {
        Self {
            repo_root,
            model: DEFAULT_CODEX_MODEL.to_owned(),
            reasoning_effort: DEFAULT_CODEX_REASONING_EFFORT.to_owned(),
            arg0_paths: Arg0DispatchPaths::default(),
            access: CodexAccess::ReadOnly,
            github_token: std::env::var("GH_TOKEN").ok(),
            activity_sender: None,
        }
    }

    pub fn with_workspace_write(mut self) -> Self {
        self.access = CodexAccess::WorkspaceWrite;
        self
    }

    pub fn with_activity_sender(mut self, sender: mpsc::UnboundedSender<TaskActivity>) -> Self {
        self.activity_sender = Some(sender);
        self
    }
}

pub trait CodexRunner {
    fn run<'a>(
        &'a self,
        prompt: &'a str,
    ) -> impl Future<Output = Result<String, CodexError>> + Send + 'a;
}

#[derive(Clone)]
pub struct InProcessCodexRunner {
    options: CodexOptions,
    external_auth: Option<Arc<dyn ExternalAuth>>,
}

impl InProcessCodexRunner {
    pub fn new(options: CodexOptions) -> Self {
        Self {
            options,
            external_auth: None,
        }
    }

    pub fn with_external_auth(options: CodexOptions, external_auth: Arc<dyn ExternalAuth>) -> Self {
        Self {
            options,
            external_auth: Some(external_auth),
        }
    }

    async fn run_turn(&self, prompt: &str, kind: TurnKind) -> Result<String, CodexError> {
        let config = new_config(&self.options)?;
        let state_db = init_state_db(&config).await;
        let auth_manager =
            AuthManager::shared_from_config(&config, /* enable_codex_api_key_env */ false).await;
        if let Some(external_auth) = &self.external_auth {
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
            EnvironmentManager::from_codex_home(config.codex_home.clone(), Some(runtime_paths))
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
            .start_thread(config)
            .await
            .map_err(|error| CodexError::Run(error.to_string()))?;

        let execution_log = matches!(&kind, TurnKind::Task(_)).then(|| {
            self.options
                .repo_root
                .parent()
                .unwrap_or(&self.options.repo_root)
                .join(".hive-local-executions.jsonl")
        });
        let turn_result = submit_and_wait(
            &thread,
            prompt,
            kind,
            execution_log.as_deref(),
            self.options.activity_sender.as_ref(),
        )
        .await;
        let shutdown_result = thread.shutdown_and_wait().await;
        let _ = thread_manager.remove_thread(&thread_id).await;

        let response = turn_result?;
        shutdown_result.map_err(|error| CodexError::Run(error.to_string()))?;
        Ok(response)
    }

    pub async fn execute_task(&self, task_id: &str, prompt: &str) -> Result<String, CodexError> {
        self.run_turn(prompt, TurnKind::Task(task_id.to_owned()))
            .await
    }
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
}

impl CodexRunner for InProcessCodexRunner {
    fn run<'a>(
        &'a self,
        prompt: &'a str,
    ) -> impl Future<Output = Result<String, CodexError>> + Send + 'a {
        self.run_turn(prompt, TurnKind::Planning)
    }
}

fn new_config(options: &CodexOptions) -> Result<Config, CodexError> {
    let codex_home =
        find_codex_home().map_err(|error| CodexError::Configuration(error.to_string()))?;
    let cwd = AbsolutePathBuf::from_absolute_path_checked(&options.repo_root)
        .map_err(|error| CodexError::Configuration(error.to_string()))?;
    let model_provider_id = OPENAI_PROVIDER_ID.to_string();
    let model_providers = built_in_model_providers(/* openai_base_url */ None);
    let model_provider = model_providers
        .get(&model_provider_id)
        .cloned()
        .ok_or_else(|| CodexError::Configuration("OpenAI model provider is unavailable".into()))?;
    let permission_profile = match options.access {
        CodexAccess::ReadOnly => PermissionProfile::read_only(),
        CodexAccess::WorkspaceWrite => PermissionProfile::Disabled,
    };
    let mut permissions = Permissions::from_approval_and_profile(
        Constrained::allow_any(AskForApproval::Never),
        Constrained::allow_any(permission_profile),
    )
    .map_err(|error| CodexError::Configuration(error.to_string()))?;
    if let Some(github_token) = &options.github_token {
        permissions
            .shell_environment_policy
            .r#set
            .insert("GH_TOKEN".to_owned(), github_token.clone());
        permissions
            .shell_environment_policy
            .r#set
            .insert("GITHUB_TOKEN".to_owned(), github_token.clone());
    }
    let model_reasoning_effort =
        serde_json::from_value(serde_json::Value::String(options.reasoning_effort.clone()))
            .map_err(|error| {
                CodexError::Configuration(format!(
                    "invalid reasoning effort `{}`: {error}",
                    options.reasoning_effort
                ))
            })?;

    let workspace_roots = vec![cwd.clone()];
    let mut config = Config {
        config_layer_stack: ConfigLayerStack::default(),
        startup_warnings: Vec::new(),
        bypass_hook_trust: false,
        model: Some(options.model.clone()),
        service_tier: None,
        review_model: None,
        model_context_window: None,
        model_auto_compact_token_limit: None,
        model_auto_compact_token_limit_scope: AutoCompactTokenLimitScope::Total,
        model_provider_id,
        model_provider,
        personality: None,
        permissions,
        explicit_permission_profile_mode: false,
        custom_permission_profiles: Vec::new(),
        approvals_reviewer: ApprovalsReviewer::User,
        enforce_residency: Constrained::allow_any(/* initial_value */ None),
        hide_agent_reasoning: false,
        show_raw_agent_reasoning: false,
        base_instructions: None,
        developer_instructions: None,
        guardian_policy_config: None,
        include_permissions_instructions: false,
        include_apps_instructions: false,
        include_collaboration_mode_instructions: false,
        include_skill_instructions: false,
        orchestrator_skills_enabled: false,
        orchestrator_mcp_enabled: false,
        include_environment_context: false,
        compact_prompt: None,
        notify: None,
        tui_notifications: TuiNotificationSettings::default(),
        animations: true,
        show_tooltips: true,
        model_availability_nux: ModelAvailabilityNuxConfig::default(),
        tui_alternate_screen: AltScreenMode::Auto,
        tui_status_line: None,
        tui_status_line_use_colors: true,
        tui_terminal_title: None,
        tui_theme: None,
        tui_raw_output_mode: false,
        tui_pet: None,
        tui_pet_anchor: TuiPetAnchor::Composer,
        terminal_resize_reflow: TerminalResizeReflowConfig::default(),
        tui_keymap: TuiKeymap::default(),
        tui_session_picker_view: SessionPickerViewMode::Dense,
        tui_vim_mode_default: false,
        cwd: cwd.clone(),
        workspace_roots,
        workspace_roots_explicit: true,
        cli_auth_credentials_store_mode: AuthCredentialsStoreMode::File,
        mcp_servers: Constrained::allow_any(HashMap::new()),
        mcp_oauth_credentials_store_mode: OAuthCredentialsStoreMode::File,
        mcp_oauth_callback_port: None,
        mcp_oauth_callback_url: None,
        model_providers,
        project_doc_max_bytes: 32 * 1024,
        project_doc_fallback_filenames: Vec::new(),
        tool_output_token_limit: None,
        agent_max_threads: Some(1),
        agent_job_max_runtime_seconds: None,
        agent_interrupt_message_enabled: false,
        agent_max_depth: 1,
        agent_roles: BTreeMap::new(),
        memories: MemoriesConfig::default(),
        sqlite_home: codex_home.to_path_buf(),
        log_dir: codex_home.join("log").to_path_buf(),
        config_lock_export_dir: None,
        config_lock_allow_codex_version_mismatch: false,
        config_lock_save_fields_resolved_from_model_catalog: true,
        config_lock_toml: None,
        codex_home,
        history: History::default(),
        ephemeral: true,
        extra_config: None,
        file_opener: UriBasedFileOpener::VsCode,
        codex_self_exe: options.arg0_paths.codex_self_exe.clone(),
        codex_linux_sandbox_exe: options.arg0_paths.codex_linux_sandbox_exe.clone(),
        main_execve_wrapper_exe: options.arg0_paths.main_execve_wrapper_exe.clone(),
        zsh_path: None,
        model_reasoning_effort: Some(model_reasoning_effort),
        plan_mode_reasoning_effort: None,
        model_reasoning_summary: None,
        model_catalog: None,
        model_verbosity: None,
        chatgpt_base_url: "https://chatgpt.com/backend-api/".to_string(),
        respect_system_proxy: false,
        apps_mcp_product_sku: None,
        realtime_audio: RealtimeAudioConfig::default(),
        experimental_realtime_ws_base_url: None,
        experimental_realtime_webrtc_call_base_url: None,
        experimental_realtime_ws_model: None,
        realtime: RealtimeConfig::default(),
        experimental_realtime_ws_backend_prompt: None,
        experimental_realtime_ws_startup_context: None,
        experimental_realtime_start_instructions: None,
        experimental_thread_config_endpoint: None,
        experimental_thread_store: ThreadStoreConfig::Local,
        forced_chatgpt_workspace_id: None,
        forced_login_method: None,
        web_search_mode: Constrained::allow_any(WebSearchMode::Disabled),
        web_search_config: None,
        experimental_request_user_input_enabled: true,
        code_mode: Default::default(),
        use_experimental_unified_exec_tool: false,
        background_terminal_max_timeout: 300_000,
        ghost_snapshot: GhostSnapshotConfig::default(),
        multi_agent_v2: MultiAgentV2Config::default(),
        token_budget: None,
        rollout_budget: None,
        current_time_reminder: None,
        features: Default::default(),
        suppress_unstable_features_warning: false,
        active_project: ProjectConfig { trust_level: None },
        notices: Notice::default(),
        check_for_update_on_startup: false,
        disable_paste_burst: false,
        analytics_enabled: Some(false),
        feedback_enabled: false,
        tool_suggest: ToolSuggestConfig::default(),
        otel: OtelConfig::default(),
    };
    config
        .features
        .set(Features::with_defaults())
        .map_err(|error| CodexError::Configuration(error.to_string()))?;
    Ok(config)
}

#[derive(Debug)]
enum TurnKind {
    Planning,
    Task(String),
}

async fn submit_and_wait(
    thread: &CodexThread,
    prompt: &str,
    kind: TurnKind,
    execution_log: Option<&Path>,
    activity_sender: Option<&mpsc::UnboundedSender<TaskActivity>>,
) -> Result<String, CodexError> {
    let schema = match &kind {
        TurnKind::Planning => OUTPUT_SCHEMA,
        TurnKind::Task(_) => TASK_OUTPUT_SCHEMA,
    };
    let output_schema = serde_json::from_str(schema).map_err(CodexError::OutputSchema)?;
    thread
        .submit(Op::UserInput {
            items: vec![UserInput::Text {
                text: prompt.to_owned(),
                text_elements: Vec::new(),
            }],
            final_output_json_schema: Some(output_schema),
            responsesapi_client_metadata: None,
            additional_context: Default::default(),
            thread_settings: Default::default(),
        })
        .await
        .map_err(|error| CodexError::Run(error.to_string()))?;

    let stderr = io::stderr();
    let decorate = stderr.is_terminal() && std::env::var_os("NO_COLOR").is_none();
    let mut progress = match kind {
        TurnKind::Planning => TurnProgress::Planning(ProgressReporter::new(stderr, decorate)),
        TurnKind::Task(task_id) => {
            TurnProgress::Task(TaskProgressReporter::new(stderr, decorate, task_id))
        }
    };
    loop {
        let event = thread
            .next_event()
            .await
            .map_err(|error| CodexError::Run(error.to_string()))?;
        progress
            .observe(&event.msg)
            .map_err(|error| CodexError::Run(format!("failed to write progress: {error}")))?;
        if let (Some(sender), Some(activity)) =
            (activity_sender, task_activity_from_event(&event.msg))
        {
            let _ = sender.send(activity);
        }
        if let (Some(path), EventMsg::ExecCommandEnd(execution)) = (execution_log, &event.msg) {
            record_local_execution(
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
                return event
                    .last_agent_message
                    .filter(|message| !message.trim().is_empty())
                    .ok_or(CodexError::EmptyResponse);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::HiveContext;

    #[test]
    fn configures_an_ephemeral_read_only_core_thread() -> crate::HiveResult<()> {
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
            github_token: None,
            activity_sender: None,
        };
        let config = new_config(&options)?;

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
    fn defaults_to_gpt_5_6_terra_with_light_reasoning() -> crate::HiveResult<()> {
        let repository = tempfile::tempdir()?;
        let options = CodexOptions::new(repository.path().to_owned());

        assert_eq!(options.model, DEFAULT_CODEX_MODEL);
        assert_eq!(options.reasoning_effort, DEFAULT_CODEX_REASONING_EFFORT);
        Ok(())
    }

    #[test]
    fn trusted_task_thread_receives_direct_github_access() -> crate::HiveResult<()> {
        let repository = tempfile::tempdir()?;
        let github_token = "test-token".to_owned();
        let mut options = CodexOptions::new(repository.path().to_owned()).with_workspace_write();
        options.github_token = Some(github_token.clone());
        let config = new_config(&options)?;

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
            .hive_context("task output schema must define blocker")?;
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

    #[test]
    fn trusted_execution_options_disable_the_inner_permission_profile() -> crate::HiveResult<()> {
        let repository = tempfile::tempdir()?;
        let options = CodexOptions::new(repository.path().to_owned()).with_workspace_write();
        let config = new_config(&options)?;

        assert_eq!(options.access, CodexAccess::WorkspaceWrite);
        assert_eq!(
            config.permissions.permission_profile(),
            &PermissionProfile::Disabled
        );
        Ok(())
    }

    #[test]
    fn progress_reporter_streams_reasoning_and_deduplicates_plan_status() -> crate::HiveResult<()> {
        let mut progress = ProgressReporter::new(Vec::new(), false);

        progress.reasoning_delta("Inspecting ")?;
        progress.reasoning_delta("the repository.\n")?;
        progress.announce_plan_output()?;
        progress.announce_plan_output()?;
        progress.finish_reasoning()?;

        assert_eq!(
            String::from_utf8(progress.writer)?,
            "  ↳ Inspecting the repository.\n  ◆  Building feature plan\n     Writing structured tasks and dependencies\n"
        );
        assert!(progress.plan_output_announced);
        Ok(())
    }

    #[test]
    fn inspection_progress_hides_shell_commands_behind_readable_steps() -> crate::HiveResult<()> {
        let mut progress = ProgressReporter::new(Vec::new(), false);
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
                "sed -n '1,220p' .cortex/ARCHITECTURE.md".into(),
            ],
        ];

        for command in commands {
            progress.inspection(&command)?;
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
        let mut progress = ProgressReporter::new(Vec::new(), false);
        let command = vec!["/bin/zsh".into(), "-lc".into(), "rg missing-file".into()];

        progress.failed_inspection(2, &command)?;
        let output = String::from_utf8(progress.writer)?;

        assert!(output.contains("Repository inspection failed (exit 2)"));
        assert!(output.contains("/bin/zsh -lc rg missing-file"));
        Ok(())
    }

    #[test]
    fn task_progress_logs_only_fixed_secret_safe_metadata() -> crate::HiveResult<()> {
        let mut progress = TaskProgressReporter::new(Vec::new(), false, "core-agent".into());

        progress.line("36", "●", "start", "Agent started")?;
        progress.command_finished(
            &["cargo".into(), "test".into(), "-p".into(), "core".into()],
            0,
            1.24,
        )?;
        progress.line("33", "!", "warning", "Embedded turn reported a warning")?;
        progress.announce_finalizing()?;
        progress.announce_finalizing()?;

        let output = String::from_utf8(progress.writer)?;
        assert!(output.contains("core-agent"));
        assert!(output.contains("result  · 1.2s · verification completed"));
        assert!(output.contains("Embedded turn reported a warning"));
        assert_eq!(output.matches("Finalizing task result").count(), 1);
        Ok(())
    }

    #[test]
    fn task_progress_does_not_reveal_failed_commands_or_output() -> crate::HiveResult<()> {
        let mut progress = TaskProgressReporter::new(Vec::new(), false, "ui-agent".into());

        progress.command_finished(
            &["secret-command".into(), "credential-value".into()],
            1,
            0.5,
        )?;

        let output = String::from_utf8(progress.writer)?;
        assert!(output.contains("failed  · Repository command exited with status 1"));
        assert!(!output.contains("secret-command"));
        assert!(!output.contains("credential-value"));
        Ok(())
    }
}
