use super::{wasm_bindgen, window};
use nook_core::{
    ActiveVaultStore, ClientRunMode, RuntimeConfigValue, VaultAccessObservation, VaultClientPolicy,
    VaultRuntimePolicy, VaultSwitchDecision,
};
use wasm_bindgen::JsError;

#[wasm_bindgen(typescript_custom_section)]
const WEB_TYPES: &'static str = r#"
export type NookAppLocale = 'en' | 'ru';
export type StoreId = string;
export type PasswordEntryId = string;
"#;

fn browser_language_tags() -> Vec<String> {
    let navigator = window().navigator();
    let mut tags = navigator
        .languages()
        .iter()
        .filter_map(|value| value.as_string())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();

    if tags.is_empty()
        && let Some(language) = navigator.language()
    {
        let language = language.trim();
        if !language.is_empty() {
            tags.push(language.to_owned());
        }
    }

    tags
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookBrowserLocale {
    language_tags: Vec<String>,
}

#[wasm_bindgen]
impl NookBrowserLocale {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            language_tags: browser_language_tags(),
        }
    }

    #[wasm_bindgen]
    pub fn from_tags(tags: Vec<String>) -> Self {
        Self {
            language_tags: tags,
        }
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn language_tags(&self) -> Vec<String> {
        self.language_tags.clone()
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn app_locale(&self) -> String {
        nook_core::resolve_app_locale_from_tags(self.language_tags.iter().map(String::as_str))
            .to_owned()
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookClientRunMode {
    Local,
    Dev,
    Prod,
}

impl From<NookClientRunMode> for nook_core::ClientRunMode {
    fn from(value: NookClientRunMode) -> Self {
        match value {
            NookClientRunMode::Local => Self::Local,
            NookClientRunMode::Dev => Self::Dev,
            NookClientRunMode::Prod => Self::Prod,
        }
    }
}

impl From<nook_core::ClientRunMode> for NookClientRunMode {
    fn from(value: nook_core::ClientRunMode) -> Self {
        match value {
            ClientRunMode::Local => Self::Local,
            ClientRunMode::Dev => Self::Dev,
            ClientRunMode::Prod => Self::Prod,
        }
    }
}

#[wasm_bindgen]
pub struct NookClientRunModeUtil;

#[wasm_bindgen]
impl NookClientRunModeUtil {
    pub fn parse(mode: &str) -> Result<NookClientRunMode, wasm_bindgen::JsError> {
        ClientRunMode::parse(mode)
            .map(Into::into)
            .map_err(|error| JsError::new(&error))
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookStorageConnectArgs {
    mode: String,
    pat: String,
    repo: String,
}

impl From<nook_core::StorageConnectArgs> for NookStorageConnectArgs {
    fn from(args: nook_core::StorageConnectArgs) -> Self {
        Self {
            mode: args.mode,
            pat: args.pat,
            repo: args.repo,
        }
    }
}

#[wasm_bindgen]
impl NookStorageConnectArgs {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn mode(&self) -> String {
        self.mode.clone()
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn pat(&self) -> String {
        self.pat.clone()
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn repo(&self) -> String {
        self.repo.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookGoogleDriveFolder {
    id: String,
    name: String,
}

impl NookGoogleDriveFolder {
    pub(crate) fn new(id: String, name: String) -> Self {
        Self { id, name }
    }
}

#[wasm_bindgen]
impl NookGoogleDriveFolder {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn id(&self) -> String {
        self.id.clone()
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn name(&self) -> String {
        self.name.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookRuntimeConfig {
    policy: nook_core::VaultRuntimePolicy,
}

/// Thin wasm adapter over portable vault client/session policy. Svelte keeps
/// reactive values; this object owns no browser state and only evaluates core
/// transitions and predicates.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, Default)]
pub struct NookVaultClientPolicy;

#[wasm_bindgen]
impl NookVaultClientPolicy {
    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `manual_sync_has_target` count through a JavaScript Number scalar"
        )
    )]
    pub fn manual_sync_has_target(
        &self,
        local_vault_present: bool,
        sync_provider_count: u32,
    ) -> bool {
        VaultClientPolicy::manual_sync_has_target(local_vault_present, sync_provider_count as usize)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn remote_recovery_prompt_visible(
        &self,
        state: nook_core::RemoteVaultRecoveryState,
    ) -> bool {
        VaultClientPolicy::remote_recovery_prompt_visible(state)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn remote_recovery_prompt_has_cache(
        &self,
        state: nook_core::RemoteVaultRecoveryState,
    ) -> bool {
        VaultClientPolicy::remote_recovery_prompt_has_cache(state)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn remote_recovery_connect_confirmed(
        &self,
        state: nook_core::RemoteVaultRecoveryState,
    ) -> bool {
        VaultClientPolicy::remote_recovery_connect_confirmed(state)
    }

    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `edit_block_reason` count through a JavaScript Number scalar"
        )
    )]
    pub fn edit_block_reason(
        &self,
        security_conflict_count: u32,
        has_sync_conflict: bool,
        architecture_allows_secret_creation: bool,
    ) -> nook_core::VaultEditDecision {
        VaultClientPolicy::edit_block_reason(
            security_conflict_count as usize,
            has_sync_conflict,
            architecture_allows_secret_creation,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `edits_blocked` count through a JavaScript Number scalar"
        )
    )]
    pub fn edits_blocked(
        &self,
        security_conflict_count: u32,
        has_sync_conflict: bool,
        architecture_allows_secret_creation: bool,
    ) -> bool {
        VaultClientPolicy::edits_blocked(
            security_conflict_count as usize,
            has_sync_conflict,
            architecture_allows_secret_creation,
        )
    }

    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `edit_block_message` count through a JavaScript Number scalar"
        )
    )]
    pub fn edit_block_message(
        &self,
        security_conflict_count: u32,
        has_sync_conflict: bool,
        architecture_allows_secret_creation: bool,
        catalog_json: &str,
        locale: &str,
    ) -> Result<String, wasm_bindgen::JsError> {
        VaultClientPolicy::edit_block_message(
            security_conflict_count as usize,
            has_sync_conflict,
            architecture_allows_secret_creation,
            catalog_json,
            locale,
        )
        .ok_or_else(|| JsError::new("blocked vault edit decision requires a message"))
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn is_sync_activity_visible(
        &self,
        fan_out_syncing: bool,
        provider_syncing: bool,
        syncing: bool,
        saving: bool,
    ) -> bool {
        VaultClientPolicy::sync_activity_visible(fan_out_syncing, provider_syncing, syncing, saving)
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `should_use_join_provider_for_connect` count through a JavaScript Number scalar"
        )
    )]
    pub fn should_use_join_provider_for_connect(
        &self,
        authenticated: bool,
        sync_provider_count: u32,
        join_state: nook_core::JoinEnrollmentState,
    ) -> bool {
        VaultClientPolicy::should_use_join_provider_for_connect(
            authenticated,
            sync_provider_count as usize,
            join_state,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `should_sync_from_providers` count through a JavaScript Number scalar"
        )
    )]
    pub fn should_sync_from_providers(
        &self,
        sync_blocked: bool,
        force: bool,
        verifying: bool,
        saving: bool,
        password_busy: bool,
        syncing: bool,
        sync_provider_count: u32,
    ) -> bool {
        VaultClientPolicy::should_sync_from_providers(
            sync_blocked,
            force,
            verifying,
            saving,
            password_busy,
            syncing,
            sync_provider_count as usize,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn vault_sync_timer_start_decision(
        &self,
        authenticated: bool,
        device_protection_ready: bool,
        join_state: nook_core::JoinEnrollmentState,
        awaiting_join_approval: bool,
    ) -> nook_core::VaultSyncTimerStartDecision {
        VaultClientPolicy::vault_sync_timer_start_decision(
            authenticated,
            device_protection_ready,
            join_state,
            awaiting_join_approval,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `vault_sync_timer_tick_decision` count through a JavaScript Number scalar"
        )
    )]
    pub fn vault_sync_timer_tick_decision(
        &self,
        verifying: bool,
        saving: bool,
        syncing: bool,
        password_busy: bool,
        authenticated: bool,
        join_state: nook_core::JoinEnrollmentState,
        awaiting_join_approval: bool,
        sync_provider_count: u32,
    ) -> nook_core::VaultSyncTimerTickDecision {
        VaultClientPolicy::vault_sync_timer_tick_decision(
            verifying,
            saving,
            syncing,
            password_busy,
            authenticated,
            join_state,
            awaiting_join_approval,
            sync_provider_count as usize,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `vault_storage_sync_decision` count through a JavaScript Number scalar"
        )
    )]
    pub fn vault_storage_sync_decision(
        &self,
        sync_blocked: bool,
        freshness: nook_core::ProviderSyncFreshness,
        verifying: bool,
        saving: bool,
        password_busy: bool,
        syncing: bool,
        authenticated: bool,
        sync_provider_count: u32,
        has_remote_credentials: bool,
        local_vault_present: bool,
    ) -> nook_core::VaultStorageSyncDecision {
        VaultClientPolicy::vault_storage_sync_decision(
            sync_blocked,
            freshness,
            verifying,
            saving,
            password_busy,
            syncing,
            authenticated,
            sync_provider_count as usize,
            has_remote_credentials,
            local_vault_present,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `should_auto_unlock` count through a JavaScript Number scalar"
        )
    )]
    pub fn should_auto_unlock(
        &self,
        session_explicitly_locked: bool,
        local_vault_present: bool,
        password_entry_count: u32,
        sync_provider_count: u32,
        provider_setup_active: bool,
        add_provider_open: bool,
    ) -> bool {
        VaultClientPolicy::should_auto_unlock(
            session_explicitly_locked,
            local_vault_present,
            password_entry_count as usize,
            sync_provider_count as usize,
            provider_setup_active,
            add_provider_open,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn existing_vault_identity_recovery_required(
        &self,
        existing_vault_required: bool,
        provider_setup_active: bool,
        device_protection_ready: bool,
    ) -> bool {
        VaultClientPolicy::existing_vault_identity_recovery_required(
            existing_vault_required,
            provider_setup_active,
            device_protection_ready,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `should_show_login_vault_picker` count through a JavaScript Number scalar"
        )
    )]
    pub fn should_show_login_vault_picker(
        &self,
        authenticated: bool,
        local_vault_count: u32,
        vault_selected: bool,
        provider_setup_active: bool,
        add_provider_open: bool,
        session_explicitly_locked: bool,
    ) -> bool {
        VaultClientPolicy::should_show_login_vault_picker(
            authenticated,
            local_vault_count as usize,
            vault_selected,
            provider_setup_active,
            add_provider_open,
            session_explicitly_locked,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn remote_vault_assess_decision(
        &self,
        access_status: nook_core::VaultAccessStatus,
        existing_vault_required: bool,
        provider_setup_active: bool,
    ) -> nook_core::RemoteVaultAssessDecision {
        VaultClientPolicy::remote_vault_assess_decision(
            access_status,
            existing_vault_required,
            provider_setup_active,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `vault_connect_probe_decision` count through a JavaScript Number scalar"
        )
    )]
    pub fn vault_connect_probe_decision(
        &self,
        access_status: nook_core::VaultAccessStatus,
        authenticated: bool,
        sync_provider_count: u32,
    ) -> nook_core::VaultConnectProbeDecision {
        VaultClientPolicy::vault_connect_probe_decision(
            access_status,
            authenticated,
            sync_provider_count as usize,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `vault_connect_gate_decision` count through a JavaScript Number scalar"
        )
    )]
    pub fn vault_connect_gate_decision(
        &self,
        access_status: nook_core::VaultAccessStatus,
        password_entry_count: u32,
    ) -> nook_core::VaultConnectGateDecision {
        VaultClientPolicy::vault_connect_gate_decision(access_status, password_entry_count as usize)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn vault_connect_password_lookup_required(
        &self,
        access_status: nook_core::VaultAccessStatus,
    ) -> bool {
        VaultClientPolicy::vault_connect_password_lookup_required(access_status)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn unauthenticated_sync_decision(
        &self,
        changed: bool,
        access_status_available: bool,
        access_status: nook_core::VaultAccessStatus,
        join_state: nook_core::JoinEnrollmentState,
        awaiting_join_approval: bool,
    ) -> nook_core::UnauthenticatedSyncDecision {
        VaultClientPolicy::unauthenticated_sync_decision(
            changed,
            if access_status_available {
                VaultAccessObservation::Available(access_status)
            } else {
                VaultAccessObservation::Unavailable
            },
            join_state,
            awaiting_join_approval,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn should_auto_connect_after_approval(
        &self,
        authenticated: bool,
        verifying: bool,
        password_prompt_open: bool,
        session_expired_by_idle: bool,
        session_explicitly_locked: bool,
    ) -> bool {
        VaultClientPolicy::should_auto_connect_after_approval(
            authenticated,
            verifying,
            password_prompt_open,
            session_expired_by_idle,
            session_explicitly_locked,
        )
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects `normalized_secret_page_offset` paging values through JavaScript Number scalars"
        )
    )]
    pub fn normalized_secret_page_offset(
        &self,
        total: u32,
        requested_offset: u32,
        page_size: u32,
    ) -> u32 {
        VaultClientPolicy::normalized_secret_page_offset(total, requested_offset, page_size)
    }

    #[wasm_bindgen]
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn vault_switch_target(
        &self,
        requested_store_id: &str,
        active_store_selected: bool,
        active_store_id: &str,
        verifying: bool,
    ) -> NookVaultSwitchDecision {
        NookVaultSwitchDecision(VaultClientPolicy::vault_switch_target(
            requested_store_id,
            if active_store_selected {
                ActiveVaultStore::Selected(active_store_id)
            } else {
                ActiveVaultStore::Unselected
            },
            verifying,
        ))
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookVaultSwitchState {
    NoChange,
    Switch,
}

#[wasm_bindgen]
pub struct NookVaultSwitchDecision(nook_core::VaultSwitchDecision);

#[wasm_bindgen]
impl NookVaultSwitchDecision {
    #[wasm_bindgen(getter)]
    pub fn state(&self) -> NookVaultSwitchState {
        match self.0 {
            VaultSwitchDecision::NoChange => NookVaultSwitchState::NoChange,
            VaultSwitchDecision::SwitchTo(..) => NookVaultSwitchState::Switch,
        }
    }

    pub fn target(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            VaultSwitchDecision::SwitchTo(target) => Ok(target.clone()),
            VaultSwitchDecision::NoChange => Err(JsError::new("vault switch was not requested")),
        }
    }
}

#[wasm_bindgen]
impl NookRuntimeConfig {
    #[wasm_bindgen(constructor)]
    pub fn new(run_mode: NookClientRunMode, e2e_expose_vault: bool) -> Self {
        Self {
            policy: VaultRuntimePolicy::new(run_mode.into(), e2e_expose_vault),
        }
    }

    #[wasm_bindgen(getter, js_name = runMode)]
    #[must_use]
    pub fn run_mode(&self) -> NookClientRunMode {
        self.policy.run_mode().into()
    }

    #[wasm_bindgen(getter, js_name = isLocal)]
    #[must_use]
    pub fn is_local(&self) -> bool {
        self.policy.run_mode() == ClientRunMode::Local
    }

    #[wasm_bindgen(getter, js_name = isDev)]
    #[must_use]
    pub fn is_dev(&self) -> bool {
        self.policy.run_mode() == ClientRunMode::Dev
    }

    #[wasm_bindgen(getter, js_name = isProd)]
    #[must_use]
    pub fn is_prod(&self) -> bool {
        self.policy.run_mode() == ClientRunMode::Prod
    }

    #[wasm_bindgen(getter, js_name = e2eExposeVault)]
    #[must_use]
    pub fn e2e_expose_vault(&self) -> bool {
        self.policy.expose_test_capabilities()
    }

    #[must_use]
    pub fn allow_fast_idle(&self) -> bool {
        self.policy.allow_fast_idle()
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn allow_fast_sync(&self) -> bool {
        self.policy.allow_fast_sync()
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn expose_debug_hooks(&self) -> bool {
        self.policy.expose_debug_hooks()
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `resolve_vault_idle_timeout_ms` timestamp or duration through a JavaScript Number scalar"
        )
    )]
    pub fn resolve_vault_idle_timeout_ms(&self, raw_timeout_ms: &str) -> u32 {
        self.policy
            .resolve_vault_idle_timeout_ms(RuntimeConfigValue::Set(raw_timeout_ms))
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `resolve_default_vault_idle_timeout_ms` timestamp or duration through a JavaScript Number scalar"
        )
    )]
    pub fn resolve_default_vault_idle_timeout_ms(&self) -> u32 {
        self.policy
            .resolve_vault_idle_timeout_ms(RuntimeConfigValue::Unset)
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `resolve_vault_idle_warning_ms` timestamp or duration through a JavaScript Number scalar"
        )
    )]
    pub fn resolve_vault_idle_warning_ms(&self, raw_warning_ms: &str) -> u32 {
        self.policy
            .resolve_vault_idle_warning_ms(RuntimeConfigValue::Set(raw_warning_ms))
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `resolve_default_vault_idle_warning_ms` timestamp or duration through a JavaScript Number scalar"
        )
    )]
    pub fn resolve_default_vault_idle_warning_ms(&self) -> u32 {
        self.policy
            .resolve_vault_idle_warning_ms(RuntimeConfigValue::Unset)
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `resolve_vault_sync_interval_ms` timestamp or duration through a JavaScript Number scalar"
        )
    )]
    pub fn resolve_vault_sync_interval_ms(&self, raw_interval_ms: &str) -> u32 {
        self.policy
            .resolve_vault_sync_interval_ms(RuntimeConfigValue::Set(raw_interval_ms))
    }

    #[wasm_bindgen]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `resolve_default_vault_sync_interval_ms` timestamp or duration through a JavaScript Number scalar"
        )
    )]
    pub fn resolve_default_vault_sync_interval_ms(&self) -> u32 {
        self.policy
            .resolve_vault_sync_interval_ms(RuntimeConfigValue::Unset)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locale_run_modes_and_storage_wrappers_project_successful_values() {
        let locale = NookBrowserLocale::from_tags(vec!["ru-RU".to_owned(), "en-US".to_owned()]);
        assert_eq!(locale.language_tags(), vec!["ru-RU", "en-US"]);
        assert_eq!(locale.app_locale(), "ru");

        assert_eq!(
            NookClientRunModeUtil::parse("local").expect("local mode"),
            NookClientRunMode::Local
        );
        assert_eq!(
            NookClientRunModeUtil::parse("dev").expect("dev mode"),
            NookClientRunMode::Dev
        );
        assert_eq!(
            NookClientRunModeUtil::parse("prod").expect("prod mode"),
            NookClientRunMode::Prod
        );

        let args = NookStorageConnectArgs::from(nook_core::StorageConnectArgs::local());
        assert_eq!(args.mode(), "local");
        assert_eq!(args.pat(), "");
        assert_eq!(args.repo(), "");

        let folder = NookGoogleDriveFolder::new("folder-1".to_owned(), "Vault".to_owned());
        assert_eq!(folder.id(), "folder-1");
        assert_eq!(folder.name(), "Vault");
    }

    #[test]
    fn runtime_config_projects_each_mode_and_resolved_defaults() {
        let local = NookRuntimeConfig::new(NookClientRunMode::Local, true);
        assert_eq!(local.run_mode(), NookClientRunMode::Local);
        assert!(local.is_local());
        assert!(!local.is_dev());
        assert!(!local.is_prod());
        assert!(local.e2e_expose_vault());

        let dev = NookRuntimeConfig::new(NookClientRunMode::Dev, false);
        assert_eq!(dev.run_mode(), NookClientRunMode::Dev);
        assert!(!dev.is_local());
        assert!(dev.is_dev());
        assert!(!dev.is_prod());
        assert!(!dev.e2e_expose_vault());

        let prod = NookRuntimeConfig::new(NookClientRunMode::Prod, false);
        assert_eq!(prod.run_mode(), NookClientRunMode::Prod);
        assert!(!prod.is_local());
        assert!(!prod.is_dev());
        assert!(prod.is_prod());
        assert_eq!(
            prod.resolve_vault_idle_timeout_ms("bad"),
            prod.resolve_default_vault_idle_timeout_ms()
        );
        assert_eq!(
            prod.resolve_vault_idle_warning_ms("bad"),
            prod.resolve_default_vault_idle_warning_ms()
        );
        assert_eq!(
            prod.resolve_vault_sync_interval_ms("bad"),
            prod.resolve_default_vault_sync_interval_ms()
        );
    }

    #[test]
    fn vault_policy_and_switch_wrappers_project_deterministic_decisions() {
        let policy = NookVaultClientPolicy::new();
        assert!(!policy.manual_sync_has_target(false, 0));
        assert!(policy.manual_sync_has_target(true, 1));

        assert!(
            policy.remote_recovery_prompt_visible(
                nook_core::RemoteVaultRecoveryState::PromptWithCache
            )
        );
        assert!(policy.remote_recovery_prompt_has_cache(
            nook_core::RemoteVaultRecoveryState::PromptWithCache
        ));
        assert!(
            policy.remote_recovery_connect_confirmed(
                nook_core::RemoteVaultRecoveryState::ConnectFresh
            )
        );
        assert!(policy.is_sync_activity_visible(false, false, false, true));
        assert!(policy.should_auto_connect_after_approval(true, false, false, false, false));
        assert_eq!(policy.normalized_secret_page_offset(10, 99, 5), 5);

        let switch = policy.vault_switch_target("remote", true, "local", false);
        assert_eq!(switch.state(), NookVaultSwitchState::Switch);
        assert_eq!(switch.target().expect("switch target"), "remote");

        let no_change = policy.vault_switch_target("local", true, "local", false);
        assert_eq!(no_change.state(), NookVaultSwitchState::NoChange);
    }
}
