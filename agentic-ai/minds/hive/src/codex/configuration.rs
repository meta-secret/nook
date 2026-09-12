use super::*;
use serde::de::value::StringDeserializer;

#[derive(Debug, Clone)]
pub enum GitHubCredential {
    InheritEnvironment,
    Token(String),
}
impl GitHubCredential {
    pub(super) fn from_environment() -> Self {
        match env::var("GH_TOKEN") {
            Ok(token) => Self::Token(token),
            Err(_) => Self::InheritEnvironment,
        }
    }
}

#[derive(Debug, Clone)]
pub enum ActivityReporting {
    Disabled,
    Enabled(mpsc::UnboundedSender<TaskActivity>),
}
#[derive(Clone)]
pub(super) enum Authentication {
    Local,
    External(Arc<dyn ExternalAuth>),
}
pub(super) enum ExecutionLogging {
    Disabled,
    File(PathBuf),
}

impl CodexOptions {
    pub(super) async fn new_config(options: &CodexOptions) -> Result<Config, CodexError> {
        let codex_home =
            find_codex_home().map_err(|error| CodexError::Configuration(error.to_string()))?;
        let cwd = AbsolutePathBuf::from_absolute_path_checked(&options.repo_root)
            .map_err(|error| CodexError::Configuration(error.to_string()))?;
        let model_provider_id = OPENAI_PROVIDER_ID.to_string();
        let model_providers = built_in_model_providers(/* openai_base_url */ None);
        let model_provider = model_providers
            .get(&model_provider_id)
            .cloned()
            .ok_or_else(|| {
                CodexError::Configuration("OpenAI model provider is unavailable".into())
            })?;
        let permission_profile = match options.access {
            CodexAccess::ReadOnly => PermissionProfile::read_only(),
            CodexAccess::WorkspaceWrite => PermissionProfile::Disabled,
        };
        let mut permissions = Permissions::from_approval_and_profile(
            Constrained::allow_any(AskForApproval::Never),
            Constrained::allow_any(permission_profile),
        )
        .map_err(|error| CodexError::Configuration(error.to_string()))?;
        if let GitHubCredential::Token(github_token) = &options.github_token {
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
            serde::Deserialize::deserialize(StringDeserializer::<serde_json::Error>::new(
                options.reasoning_effort.clone(),
            ))
            .map_err(|error| {
                CodexError::Configuration(format!(
                    "invalid reasoning effort `{}`: {error}",
                    options.reasoning_effort
                ))
            })?;

        let mut config = Config::load_default_with_cli_overrides_for_codex_home(
            codex_home.to_path_buf(),
            Vec::new(),
        )
        .await
        .map_err(|error| CodexError::Configuration(error.to_string()))?;
        config.model = Some(options.model.clone());
        config.model_provider_id = model_provider_id;
        config.model_provider = model_provider;
        config.model_providers = model_providers;
        config.model_reasoning_effort = Some(model_reasoning_effort);
        config.permissions = permissions;
        config.cwd = cwd.clone();
        config.workspace_roots = vec![cwd];
        config.workspace_roots_explicit = true;
        config.mcp_servers = Constrained::allow_any(HashMap::new());
        config.non_prefixed_mcp_tool_servers = None;
        config.agents_enabled = false;
        config.agent_max_threads = Some(1);
        config.ephemeral = true;
        config.codex_self_exe = options.arg0_paths.codex_self_exe.clone();
        config.codex_linux_sandbox_exe = options.arg0_paths.codex_linux_sandbox_exe.clone();
        config.main_execve_wrapper_exe = options.arg0_paths.main_execve_wrapper_exe.clone();
        config.web_search_mode = Constrained::allow_any(WebSearchMode::Disabled);
        config.web_search_config = None;
        config.orchestrator_skills_enabled = false;
        config.orchestrator_mcp_enabled = false;
        config.include_permissions_instructions = false;
        config.include_apps_instructions = false;
        config.include_collaboration_mode_instructions = false;
        config.include_skill_instructions = false;
        config.include_environment_context = false;
        config.active_project = ProjectConfig { trust_level: None };
        config.check_for_update_on_startup = false;
        config.analytics_enabled = Some(false);
        config.feedback_enabled = false;
        config
            .features
            .set(Features::with_defaults())
            .map_err(|error| CodexError::Configuration(error.to_string()))?;
        Ok(config)
    }
}
