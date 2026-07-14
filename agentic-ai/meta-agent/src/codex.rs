use std::collections::{BTreeMap, HashMap};
use std::future::Future;
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

#[derive(Debug, Clone)]
pub struct CodexOptions {
    pub repo_root: PathBuf,
    pub model: Option<String>,
    pub arg0_paths: Arg0DispatchPaths,
}

impl CodexOptions {
    pub fn new(repo_root: PathBuf) -> Self {
        Self {
            repo_root,
            model: None,
            arg0_paths: Arg0DispatchPaths::default(),
        }
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

    async fn run_turn(&self, prompt: &str) -> Result<String, CodexError> {
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

        let turn_result = submit_and_wait(&thread, prompt).await;
        let shutdown_result = thread.shutdown_and_wait().await;
        let _ = thread_manager.remove_thread(&thread_id).await;

        let response = turn_result?;
        shutdown_result.map_err(|error| CodexError::Run(error.to_string()))?;
        Ok(response)
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
        self.run_turn(prompt)
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
    let permissions = Permissions::from_approval_and_profile(
        Constrained::allow_any(AskForApproval::Never),
        Constrained::allow_any(PermissionProfile::read_only()),
    )
    .map_err(|error| CodexError::Configuration(error.to_string()))?;

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
        model_reasoning_effort: None,
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

async fn submit_and_wait(thread: &CodexThread, prompt: &str) -> Result<String, CodexError> {
    let output_schema = serde_json::from_str(OUTPUT_SCHEMA).map_err(CodexError::OutputSchema)?;
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

    loop {
        let event = thread
            .next_event()
            .await
            .map_err(|error| CodexError::Run(error.to_string()))?;
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
                    "read-only planning turn unexpectedly requested approval".into(),
                ));
            }
            EventMsg::RequestPermissions(_) => {
                return Err(CodexError::Run(
                    "read-only planning turn requested additional permissions".into(),
                ));
            }
            EventMsg::RequestUserInput(_) => {
                return Err(CodexError::Run(
                    "planning turn requested interactive user input".into(),
                ));
            }
            EventMsg::DynamicToolCallRequest(_) => {
                return Err(CodexError::Run(
                    "planning turn requested an unsupported dynamic tool".into(),
                ));
            }
            _ => {}
        }
    }
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
            arg0_paths: Arg0DispatchPaths {
                codex_self_exe: Some(PathBuf::from("/bin/meta-agent")),
                codex_linux_sandbox_exe: Some(PathBuf::from("/bin/codex-linux-sandbox")),
                main_execve_wrapper_exe: Some(PathBuf::from("/bin/codex-execve-wrapper")),
            },
        };
        let config = new_config(&options).unwrap();

        assert_eq!(config.model.as_deref(), Some("test-model"));
        assert_eq!(config.cwd.as_ref(), repository.path());
        assert_eq!(config.workspace_roots, vec![config.cwd.clone()]);
        assert!(config.workspace_roots_explicit);
        assert!(config.ephemeral);
        assert_eq!(config.agent_max_threads, Some(1));
        assert_eq!(
            config.codex_self_exe,
            Some(PathBuf::from("/bin/meta-agent"))
        );
    }
}
