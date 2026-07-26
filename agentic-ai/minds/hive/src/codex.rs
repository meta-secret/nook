use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::io::{self, IsTerminal, Write};
use std::path::PathBuf;
use std::sync::Arc;

use codex::{
    AbsolutePathBuf, AltScreenMode, ApprovalsReviewer, Arg0DispatchPaths, AskForApproval,
    AuthCredentialsStoreMode, AuthManager, AutoCompactTokenLimitScope,
    CodexHomeUserInstructionsProvider, CodexThread, Config, ConfigLayerStack, Constrained,
    EnvironmentManager, EventMsg, ExecServerRuntimePaths, Features, GhostSnapshotConfig, History,
    MemoriesConfig, ModelAvailabilityNuxConfig, MultiAgentV2Config, NewThread, Notice,
    OAuthCredentialsStoreMode, OPENAI_PROVIDER_ID, Op, OtelConfig, PermissionProfile, Permissions,
    ProjectConfig, RealtimeAudioConfig, RealtimeConfig, SessionPickerViewMode, SessionSource,
    TerminalResizeReflowConfig, ThreadManager, ThreadStoreConfig, ToolSuggestConfig, TuiKeymap,
    TuiNotificationSettings, TuiPetAnchor, UriBasedFileOpener, UserInput, WebSearchMode,
    build_models_manager, built_in_model_providers, empty_extension_registry, find_codex_home,
    init_state_db, local_agent_graph_store_from_state_db, resolve_installation_id,
    thread_store_from_config,
};
use thiserror::Error;

const OUTPUT_SCHEMA: &str = include_str!("planner-output.schema.json");
const TASK_OUTPUT_SCHEMA: &str = include_str!("task-output.schema.json");
pub const DEFAULT_CODEX_MODEL: &str = "gpt-5.6-luna";
pub const DEFAULT_CODEX_REASONING_EFFORT: &str = "low";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexAccess {
    ReadOnly,
    WorkspaceWrite,
}

#[derive(Debug, Clone)]
pub struct CodexOptions {
    pub repo_root: PathBuf,
    pub model: Option<String>,
    pub reasoning_effort: String,
    pub arg0_paths: Arg0DispatchPaths,
    pub access: CodexAccess,
}

impl CodexOptions {
    pub fn new(repo_root: PathBuf) -> Self {
        Self {
            repo_root,
            model: Some(DEFAULT_CODEX_MODEL.to_owned()),
            reasoning_effort: DEFAULT_CODEX_REASONING_EFFORT.to_owned(),
            arg0_paths: Arg0DispatchPaths::default(),
            access: CodexAccess::ReadOnly,
        }
    }

    pub fn with_workspace_write(mut self) -> Self {
        self.access = CodexAccess::WorkspaceWrite;
        self
    }
}

pub trait CodexRunner {
    fn run<'a>(
        &'a self,
        prompt: &'a str,
    ) -> impl Future<Output = Result<String, CodexError>> + Send + 'a;
}

#[derive(Debug, Clone)]
pub struct InProcessCodexRunner {
    options: CodexOptions,
}

impl InProcessCodexRunner {
    pub fn new(options: CodexOptions) -> Self {
        Self { options }
    }

    async fn run_turn(&self, prompt: &str, kind: TurnKind) -> Result<String, CodexError> {
        let config = new_config(&self.options)?;
        let state_db = init_state_db(&config).await;
        let auth_manager =
            AuthManager::shared_from_config(&config, /* enable_codex_api_key_env */ false).await;
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

        let turn_result = submit_and_wait(&thread, prompt, kind).await;
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
        CodexAccess::WorkspaceWrite => PermissionProfile::workspace_write(),
    };
    let permissions = Permissions::from_approval_and_profile(
        Constrained::allow_any(AskForApproval::Never),
        Constrained::allow_any(permission_profile),
    )
    .map_err(|error| CodexError::Configuration(error.to_string()))?;
    let model_reasoning_effort =
        serde_json::from_value(serde_json::Value::String(options.reasoning_effort.clone()))
            .map_err(|error| {
                CodexError::Configuration(format!(
                    "invalid reasoning effort `{}`: {error}",
                    options.reasoning_effort
                ))
            })?;

    let mut config = Config {
        config_layer_stack: ConfigLayerStack::default(),
        startup_warnings: Vec::new(),
        bypass_hook_trust: false,
        model: options.model.clone(),
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
        workspace_roots: vec![cwd],
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

enum TurnProgress<W> {
    Planning(ProgressReporter<W>),
    Task(TaskProgressReporter<W>),
}

impl<W: Write> TurnProgress<W> {
    fn observe(&mut self, event: &EventMsg) -> io::Result<()> {
        match self {
            Self::Planning(progress) => progress.observe(event),
            Self::Task(progress) => progress.observe(event),
        }
    }
}

struct TaskProgressReporter<W> {
    writer: W,
    decorate: bool,
    task_id: String,
    step: usize,
    reasoning_buffer: String,
    reasoning_truncated: bool,
    reasoning_excerpts: usize,
    saw_reasoning_delta: bool,
    finalizing_announced: bool,
}

impl<W: Write> TaskProgressReporter<W> {
    fn new(writer: W, decorate: bool, task_id: String) -> Self {
        Self {
            writer,
            decorate,
            task_id,
            step: 0,
            reasoning_buffer: String::new(),
            reasoning_truncated: false,
            reasoning_excerpts: 0,
            saw_reasoning_delta: false,
            finalizing_announced: false,
        }
    }

    fn observe(&mut self, event: &EventMsg) -> io::Result<()> {
        match event {
            EventMsg::TurnStarted(_) => self.line("36", "●", "start", "Agent started"),
            EventMsg::ReasoningContentDelta(event) => self.reasoning_delta(&event.delta),
            EventMsg::AgentReasoning(event) if !self.saw_reasoning_delta => {
                self.reasoning_excerpt(&event.text)
            }
            EventMsg::AgentReasoningSectionBreak(_) => self.flush_reasoning(),
            EventMsg::ExecCommandBegin(event) => {
                self.flush_reasoning()?;
                self.step += 1;
                let summary = summarize_inspection(&event.command);
                let message = match summary.detail {
                    Some(detail) => format!("{:02} {} · {detail}", self.step, summary.title),
                    None => format!("{:02} {}", self.step, summary.title),
                };
                self.line("36", "↳", "action", &message)
            }
            EventMsg::ExecCommandEnd(event) => self.command_finished(
                &event.command,
                event.exit_code,
                &event.aggregated_output,
                event.duration.as_secs_f64(),
            ),
            EventMsg::PatchApplyBegin(event) => {
                self.flush_reasoning()?;
                let mut paths = event
                    .changes
                    .keys()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>();
                paths.sort();
                let detail = if paths.is_empty() {
                    "Applying code changes".to_owned()
                } else {
                    format!("Editing {}", paths.join(" · "))
                };
                self.line("35", "✎", "edit", &detail)
            }
            EventMsg::PatchApplyEnd(event) if !event.success => {
                self.line("31", "✗", "edit", "Code patch failed")
            }
            EventMsg::Warning(event) | EventMsg::GuardianWarning(event) => {
                self.line("33", "!", "warning", &event.message)
            }
            EventMsg::StreamError(event) => self.line(
                "33",
                "↻",
                "retry",
                &format!("Connection retry: {}", event.message),
            ),
            EventMsg::ModelReroute(event) => self.line(
                "36",
                "↪",
                "model",
                &format!("{} → {}", event.from_model, event.to_model),
            ),
            EventMsg::AgentMessageContentDelta(_) => self.announce_finalizing(),
            EventMsg::Error(event) => self.line("31", "✗", "error", &event.message),
            EventMsg::TurnAborted(event) => {
                self.line("31", "✗", "aborted", &format!("{:?}", event.reason))
            }
            EventMsg::TurnComplete(_) => self.flush_reasoning(),
            _ => Ok(()),
        }
    }

    fn reasoning_delta(&mut self, delta: &str) -> io::Result<()> {
        self.saw_reasoning_delta = true;
        self.reasoning_buffer.push_str(delta);
        const BUFFER_LIMIT: usize = 2_048;
        if self.reasoning_buffer.len() > BUFFER_LIMIT {
            let mut boundary = BUFFER_LIMIT;
            while !self.reasoning_buffer.is_char_boundary(boundary) {
                boundary -= 1;
            }
            self.reasoning_buffer.truncate(boundary);
            self.reasoning_truncated = true;
        }
        Ok(())
    }

    fn flush_reasoning(&mut self) -> io::Result<()> {
        let mut message = std::mem::take(&mut self.reasoning_buffer);
        if self.reasoning_truncated {
            message.push_str(" …");
            self.reasoning_truncated = false;
        }
        if message.trim().is_empty() {
            return Ok(());
        }
        self.reasoning_excerpt(&message)
    }

    fn reasoning_excerpt(&mut self, message: &str) -> io::Result<()> {
        const MAX_EXCERPTS: usize = 6;
        if self.reasoning_excerpts < MAX_EXCERPTS {
            self.reasoning_excerpts += 1;
            self.line("35", "◇", "think", message)
        } else if self.reasoning_excerpts == MAX_EXCERPTS {
            self.reasoning_excerpts += 1;
            self.line("35", "…", "think", "Additional reasoning summaries hidden")
        } else {
            Ok(())
        }
    }

    fn command_finished(
        &mut self,
        command: &[String],
        exit_code: i32,
        output: &str,
        duration_seconds: f64,
    ) -> io::Result<()> {
        if exit_code != 0 {
            let output = last_non_empty_line(output).unwrap_or("No command output");
            self.line("31", "✗", "failed", &format!("Exit {exit_code} · {output}"))?;
            let command = compact_text(&command.join(" "), 180);
            return self.line("2", "│", "command", &command);
        }
        if is_verification_command(command) {
            let output = last_non_empty_line(output).unwrap_or("completed successfully");
            return self.line(
                "32",
                "✓",
                "result",
                &format!("{duration_seconds:.1}s · {output}"),
            );
        }
        Ok(())
    }

    fn announce_finalizing(&mut self) -> io::Result<()> {
        self.flush_reasoning()?;
        if self.finalizing_announced {
            return Ok(());
        }
        self.finalizing_announced = true;
        self.line("36", "◆", "report", "Finalizing task result")
    }

    fn line(&mut self, color: &str, symbol: &str, kind: &str, message: &str) -> io::Result<()> {
        let symbol = self.paint(color, symbol);
        let task_id = compact_task_id(&self.task_id);
        let task_id = self.paint(agent_color(&self.task_id), &format!("{task_id:<30}"));
        let kind = self.paint("2", &format!("{kind:<7}"));
        let message = compact_text(message, 140);
        writeln!(self.writer, "    {symbol}  {task_id} {kind} · {message}")?;
        self.writer.flush()
    }

    fn paint(&self, code: &str, text: &str) -> String {
        if self.decorate {
            format!("\u{1b}[{code}m{text}\u{1b}[0m")
        } else {
            text.to_owned()
        }
    }
}

fn compact_task_id(task_id: &str) -> String {
    const WIDTH: usize = 30;
    if task_id.chars().count() <= WIDTH {
        return task_id.to_owned();
    }
    let prefix = task_id.chars().take(WIDTH - 1).collect::<String>();
    format!("{prefix}…")
}

fn agent_color(task_id: &str) -> &'static str {
    const COLORS: [&str; 4] = ["36", "35", "34", "33"];
    let index = task_id
        .bytes()
        .fold(0usize, |hash, byte| hash.wrapping_mul(31) + byte as usize)
        % COLORS.len();
    COLORS[index]
}

fn compact_text(message: &str, limit: usize) -> String {
    let normalized = message.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= limit {
        return normalized;
    }
    let prefix = normalized
        .chars()
        .take(limit.saturating_sub(1))
        .collect::<String>();
    format!("{prefix}…")
}

fn last_non_empty_line(output: &str) -> Option<&str> {
    output.lines().rev().find(|line| !line.trim().is_empty())
}

fn is_verification_command(command: &[String]) -> bool {
    let command = command.join(" ").to_ascii_lowercase();
    [
        "cargo test",
        "cargo clippy",
        "cargo fmt",
        "task ",
        "bun test",
        "bun run test",
        "npm test",
        "npm run test",
        "pytest",
        "go test",
    ]
    .iter()
    .any(|marker| command.contains(marker))
}

struct ProgressReporter<W> {
    writer: W,
    decorate: bool,
    inspection_step: usize,
    reasoning_open: bool,
    saw_reasoning_delta: bool,
    plan_output_announced: bool,
}

impl<W: Write> ProgressReporter<W> {
    fn new(writer: W, decorate: bool) -> Self {
        Self {
            writer,
            decorate,
            inspection_step: 0,
            reasoning_open: false,
            saw_reasoning_delta: false,
            plan_output_announced: false,
        }
    }

    fn observe(&mut self, event: &EventMsg) -> io::Result<()> {
        match event {
            EventMsg::TurnStarted(_) => self.phase(
                "●",
                "Planning started",
                Some("Loading repository instructions and project context"),
            ),
            EventMsg::ReasoningContentDelta(event) => self.reasoning_delta(&event.delta),
            EventMsg::AgentReasoning(event) if !self.saw_reasoning_delta => {
                self.note(event.text.trim())
            }
            EventMsg::AgentReasoningSectionBreak(_) => self.finish_reasoning(),
            EventMsg::ExecCommandBegin(event) => self.inspection(&event.command),
            EventMsg::ExecCommandEnd(event) if event.exit_code != 0 => {
                self.failed_inspection(event.exit_code, &event.command)
            }
            EventMsg::AgentMessageContentDelta(_) => self.announce_plan_output(),
            EventMsg::Warning(event) | EventMsg::GuardianWarning(event) => {
                self.alert("!", "Warning", &event.message, "33")
            }
            EventMsg::StreamError(event) => {
                self.alert("↻", "Connection retry", &event.message, "33")
            }
            EventMsg::ModelReroute(event) => self.phase(
                "↪",
                "Model rerouted",
                Some(&format!("{} → {}", event.from_model, event.to_model)),
            ),
            EventMsg::TurnComplete(_) => self.phase(
                "✓",
                "Plan ready",
                Some("Validating tasks and DAG dependencies"),
            ),
            _ => Ok(()),
        }
    }

    fn reasoning_delta(&mut self, delta: &str) -> io::Result<()> {
        self.saw_reasoning_delta = true;
        for part in delta.split_inclusive('\n') {
            if !self.reasoning_open {
                let prefix = self.paint("2", "  ↳ ");
                write!(self.writer, "{prefix}")?;
                self.reasoning_open = true;
            }
            write!(self.writer, "{part}")?;
            if part.ends_with('\n') {
                self.reasoning_open = false;
            }
        }
        self.writer.flush()
    }

    fn announce_plan_output(&mut self) -> io::Result<()> {
        if self.plan_output_announced {
            return Ok(());
        }
        self.plan_output_announced = true;
        self.phase(
            "◆",
            "Building feature plan",
            Some("Writing structured tasks and dependencies"),
        )
    }

    fn inspection(&mut self, command: &[String]) -> io::Result<()> {
        self.finish_reasoning()?;
        self.inspection_step += 1;
        let summary = summarize_inspection(command);
        let number = self.paint("36", &format!("{:02}", self.inspection_step));
        let title = self.paint("1", summary.title);
        writeln!(self.writer, "  {number}  {title}")?;
        if let Some(detail) = summary.detail {
            let detail = self.paint("2", &format!("      {detail}"));
            writeln!(self.writer, "{detail}")?;
        }
        self.writer.flush()
    }

    fn failed_inspection(&mut self, exit_code: i32, command: &[String]) -> io::Result<()> {
        self.finish_reasoning()?;
        let symbol = self.paint("31", "✗");
        let title = self.paint("1;31", "Repository inspection failed");
        writeln!(self.writer, "  {symbol}  {title} (exit {exit_code})")?;
        let command = self.paint("2", &format!("     {}", command.join(" ")));
        writeln!(self.writer, "{command}")?;
        self.writer.flush()
    }

    fn phase(&mut self, symbol: &str, title: &str, detail: Option<&str>) -> io::Result<()> {
        self.finish_reasoning()?;
        let color = if symbol == "✓" { "32" } else { "36" };
        let symbol = self.paint(color, symbol);
        let title = self.paint("1", title);
        writeln!(self.writer, "  {symbol}  {title}")?;
        if let Some(detail) = detail {
            let detail = self.paint("2", &format!("     {detail}"));
            writeln!(self.writer, "{detail}")?;
        }
        self.writer.flush()
    }

    fn note(&mut self, message: &str) -> io::Result<()> {
        self.finish_reasoning()?;
        for line in message.lines().filter(|line| !line.trim().is_empty()) {
            let line = self.paint("2", &format!("  ↳ {}", line.trim()));
            writeln!(self.writer, "{line}")?;
        }
        self.writer.flush()
    }

    fn alert(&mut self, symbol: &str, title: &str, detail: &str, color: &str) -> io::Result<()> {
        self.finish_reasoning()?;
        let symbol = self.paint(color, symbol);
        let title = self.paint(&format!("1;{color}"), title);
        writeln!(self.writer, "  {symbol}  {title}")?;
        let detail = self.paint("2", &format!("     {detail}"));
        writeln!(self.writer, "{detail}")?;
        self.writer.flush()
    }

    fn paint(&self, code: &str, text: &str) -> String {
        if self.decorate {
            format!("\u{1b}[{code}m{text}\u{1b}[0m")
        } else {
            text.to_owned()
        }
    }

    fn finish_reasoning(&mut self) -> io::Result<()> {
        if self.reasoning_open {
            writeln!(self.writer)?;
            self.reasoning_open = false;
        }
        Ok(())
    }
}

struct InspectionSummary {
    title: &'static str,
    detail: Option<String>,
}

fn summarize_inspection(command: &[String]) -> InspectionSummary {
    let command_text = command.join(" ");
    let title = if command_text.contains("AGENTS.md") {
        "Discovering project instructions"
    } else if command_text.contains(".cortex/") {
        "Reading architecture and project guidance"
    } else if command_text.contains("rg -n") || command_text.contains("rg --line-number") {
        "Searching implementation"
    } else if command_text.contains("rg --files") {
        "Mapping repository structure"
    } else if command_text.contains("sed -n") {
        "Reading implementation context"
    } else if command_text.contains("cargo ") || command_text.contains("task ") {
        "Checking repository behavior"
    } else {
        "Inspecting repository"
    };

    InspectionSummary {
        title,
        detail: inspection_file_hints(&command_text),
    }
}

fn inspection_file_hints(command: &str) -> Option<String> {
    let mut files = Vec::new();
    for token in command.split_whitespace() {
        let token = token.trim_matches(|character: char| {
            matches!(character, '\'' | '"' | ';' | ',' | '(' | ')' | ':' | '\\')
        });
        let looks_like_file = [".md", ".rs", ".ts", ".svelte", ".yml", ".yaml", ".toml"]
            .iter()
            .any(|extension| token.ends_with(extension));
        if looks_like_file
            && !token.starts_with('!')
            && !token.contains('*')
            && !files.contains(&token)
        {
            files.push(token);
        }
        if files.len() == 3 {
            break;
        }
    }

    (!files.is_empty()).then(|| files.join(" · "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configures_an_ephemeral_read_only_core_thread() {
        let repository = tempfile::tempdir().unwrap();
        let options = CodexOptions {
            repo_root: repository.path().to_owned(),
            model: Some("test-model".into()),
            reasoning_effort: "low".into(),
            arg0_paths: Arg0DispatchPaths {
                codex_self_exe: Some(PathBuf::from("/bin/meta-agent")),
                codex_linux_sandbox_exe: Some(PathBuf::from("/bin/codex-linux-sandbox")),
                main_execve_wrapper_exe: Some(PathBuf::from("/bin/codex-execve-wrapper")),
            },
            access: CodexAccess::ReadOnly,
        };
        let config = new_config(&options).unwrap();

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
    }

    #[test]
    fn defaults_to_luna_with_light_reasoning() {
        let repository = tempfile::tempdir().unwrap();
        let options = CodexOptions::new(repository.path().to_owned());

        assert_eq!(options.model.as_deref(), Some(DEFAULT_CODEX_MODEL));
        assert_eq!(options.reasoning_effort, DEFAULT_CODEX_REASONING_EFFORT);
    }

    #[test]
    fn execution_options_enable_workspace_write() {
        let repository = tempfile::tempdir().unwrap();
        let options = CodexOptions::new(repository.path().to_owned()).with_workspace_write();
        let config = new_config(&options).unwrap();

        assert_eq!(options.access, CodexAccess::WorkspaceWrite);
        assert_eq!(
            config.permissions.permission_profile(),
            &PermissionProfile::workspace_write()
        );
    }

    #[test]
    fn progress_reporter_streams_reasoning_and_deduplicates_plan_status() {
        let mut progress = ProgressReporter::new(Vec::new(), false);

        progress.reasoning_delta("Inspecting ").unwrap();
        progress.reasoning_delta("the repository.\n").unwrap();
        progress.announce_plan_output().unwrap();
        progress.announce_plan_output().unwrap();
        progress.finish_reasoning().unwrap();

        assert_eq!(
            String::from_utf8(progress.writer).unwrap(),
            "  ↳ Inspecting the repository.\n  ◆  Building feature plan\n     Writing structured tasks and dependencies\n"
        );
        assert!(progress.plan_output_announced);
    }

    #[test]
    fn inspection_progress_hides_shell_commands_behind_readable_steps() {
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
            progress.inspection(&command).unwrap();
        }
        let output = String::from_utf8(progress.writer).unwrap();

        assert!(output.contains("01  Discovering project instructions"));
        assert!(output.contains("02  Searching implementation"));
        assert!(output.contains("03  Reading architecture and project guidance"));
        assert!(output.contains(".cortex/AGENTS.md"));
        assert!(!output.contains("/bin/zsh"));
        assert!(!output.contains("rg -n"));
    }

    #[test]
    fn failed_inspection_includes_the_command_for_debugging() {
        let mut progress = ProgressReporter::new(Vec::new(), false);
        let command = vec!["/bin/zsh".into(), "-lc".into(), "rg missing-file".into()];

        progress.failed_inspection(2, &command).unwrap();
        let output = String::from_utf8(progress.writer).unwrap();

        assert!(output.contains("Repository inspection failed (exit 2)"));
        assert!(output.contains("/bin/zsh -lc rg missing-file"));
    }

    #[test]
    fn task_progress_shows_compact_labeled_agent_excerpts() {
        let mut progress = TaskProgressReporter::new(Vec::new(), false, "core-agent".into());

        progress.line("36", "●", "start", "Agent started").unwrap();
        progress
            .reasoning_delta(
                "Inspecting the lifecycle contract before changing the implementation.\n",
            )
            .unwrap();
        progress.flush_reasoning().unwrap();
        progress
            .command_finished(
                &["cargo".into(), "test".into(), "-p".into(), "core".into()],
                0,
                "running tests\ntest result: ok. 8 passed; 0 failed\n",
                1.24,
            )
            .unwrap();
        progress.announce_finalizing().unwrap();
        progress.announce_finalizing().unwrap();

        let output = String::from_utf8(progress.writer).unwrap();
        assert!(output.contains("core-agent"));
        assert!(output.contains("think   · Inspecting the lifecycle contract"));
        assert!(output.contains("result  · 1.2s · test result: ok. 8 passed; 0 failed"));
        assert_eq!(output.matches("Finalizing task result").count(), 1);
    }

    #[test]
    fn task_progress_limits_reasoning_noise_and_reveals_failed_commands() {
        let mut progress = TaskProgressReporter::new(Vec::new(), false, "ui-agent".into());

        for index in 0..8 {
            progress
                .reasoning_excerpt(&format!("Reasoning section {index}"))
                .unwrap();
        }
        progress
            .command_finished(
                &["bun".into(), "run".into(), "test".into()],
                1,
                "Tests failed in onboarding.spec.ts\n",
                0.5,
            )
            .unwrap();

        let output = String::from_utf8(progress.writer).unwrap();
        assert!(output.contains("Additional reasoning summaries hidden"));
        assert!(!output.contains("Reasoning section 7"));
        assert!(output.contains("failed  · Exit 1 · Tests failed"));
        assert!(output.contains("command · bun run test"));
    }
}
