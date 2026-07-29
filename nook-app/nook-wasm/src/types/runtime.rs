use super::{wasm_bindgen, window};

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

    #[wasm_bindgen(js_name = fromTags)]
    pub fn from_tags(tags: Vec<String>) -> Self {
        Self {
            language_tags: tags,
        }
    }

    #[wasm_bindgen(js_name = languageTags)]
    #[must_use]
    pub fn language_tags(&self) -> Vec<String> {
        self.language_tags.clone()
    }

    #[wasm_bindgen(js_name = appLocale)]
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
            nook_core::ClientRunMode::Local => Self::Local,
            nook_core::ClientRunMode::Dev => Self::Dev,
            nook_core::ClientRunMode::Prod => Self::Prod,
        }
    }
}

#[wasm_bindgen]
pub struct NookClientRunModeUtil;

#[wasm_bindgen]
impl NookClientRunModeUtil {
    pub fn parse(mode: &str) -> Result<NookClientRunMode, wasm_bindgen::JsError> {
        nook_core::ClientRunMode::parse(mode)
            .map(Into::into)
            .map_err(|error| wasm_bindgen::JsError::new(&error))
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
    #[wasm_bindgen(js_name = manualSyncHasTarget)]
    #[must_use]
    pub fn manual_sync_has_target(
        &self,
        local_vault_present: bool,
        sync_provider_count: u32,
    ) -> bool {
        nook_core::VaultClientPolicy::manual_sync_has_target(
            local_vault_present,
            sync_provider_count as usize,
        )
    }

    #[wasm_bindgen(js_name = remoteRecoveryPromptVisible)]
    #[must_use]
    pub fn remote_recovery_prompt_visible(
        &self,
        state: nook_core::RemoteVaultRecoveryState,
    ) -> bool {
        nook_core::VaultClientPolicy::remote_recovery_prompt_visible(state)
    }

    #[wasm_bindgen(js_name = remoteRecoveryPromptHasCache)]
    #[must_use]
    pub fn remote_recovery_prompt_has_cache(
        &self,
        state: nook_core::RemoteVaultRecoveryState,
    ) -> bool {
        nook_core::VaultClientPolicy::remote_recovery_prompt_has_cache(state)
    }

    #[wasm_bindgen(js_name = remoteRecoveryConnectConfirmed)]
    #[must_use]
    pub fn remote_recovery_connect_confirmed(
        &self,
        state: nook_core::RemoteVaultRecoveryState,
    ) -> bool {
        nook_core::VaultClientPolicy::remote_recovery_connect_confirmed(state)
    }

    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    #[wasm_bindgen(js_name = editBlockReason)]
    #[must_use]
    pub fn edit_block_reason(
        &self,
        security_conflict_count: u32,
        has_sync_conflict: bool,
        architecture_allows_secret_creation: bool,
    ) -> nook_core::VaultEditDecision {
        nook_core::VaultClientPolicy::edit_block_reason(
            security_conflict_count as usize,
            has_sync_conflict,
            architecture_allows_secret_creation,
        )
    }

    #[wasm_bindgen(js_name = editsBlocked)]
    #[must_use]
    pub fn edits_blocked(
        &self,
        security_conflict_count: u32,
        has_sync_conflict: bool,
        architecture_allows_secret_creation: bool,
    ) -> bool {
        nook_core::VaultClientPolicy::edits_blocked(
            security_conflict_count as usize,
            has_sync_conflict,
            architecture_allows_secret_creation,
        )
    }

    #[wasm_bindgen(js_name = editBlockMessage)]
    pub fn edit_block_message(
        &self,
        security_conflict_count: u32,
        has_sync_conflict: bool,
        architecture_allows_secret_creation: bool,
        catalog_json: &str,
        locale: &str,
    ) -> Result<String, wasm_bindgen::JsError> {
        nook_core::VaultClientPolicy::edit_block_message(
            security_conflict_count as usize,
            has_sync_conflict,
            architecture_allows_secret_creation,
            catalog_json,
            locale,
        )
        .ok_or_else(|| wasm_bindgen::JsError::new("blocked vault edit decision requires a message"))
    }

    #[wasm_bindgen(js_name = isSyncActivityVisible)]
    #[must_use]
    pub fn is_sync_activity_visible(
        &self,
        fan_out_syncing: bool,
        provider_syncing: bool,
        syncing: bool,
        saving: bool,
    ) -> bool {
        nook_core::VaultClientPolicy::sync_activity_visible(
            fan_out_syncing,
            provider_syncing,
            syncing,
            saving,
        )
    }

    #[wasm_bindgen(js_name = shouldUseJoinProviderForConnect)]
    #[must_use]
    pub fn should_use_join_provider_for_connect(
        &self,
        authenticated: bool,
        sync_provider_count: u32,
        join_state: nook_core::JoinEnrollmentState,
    ) -> bool {
        nook_core::VaultClientPolicy::should_use_join_provider_for_connect(
            authenticated,
            sync_provider_count as usize,
            join_state,
        )
    }

    #[wasm_bindgen(js_name = shouldSyncFromProviders)]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
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
        nook_core::VaultClientPolicy::should_sync_from_providers(
            sync_blocked,
            force,
            verifying,
            saving,
            password_busy,
            syncing,
            sync_provider_count as usize,
        )
    }

    #[wasm_bindgen(js_name = shouldAutoUnlock)]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn should_auto_unlock(
        &self,
        session_explicitly_locked: bool,
        local_vault_present: bool,
        password_entry_count: u32,
        sync_provider_count: u32,
        provider_setup_active: bool,
        add_provider_open: bool,
    ) -> bool {
        nook_core::VaultClientPolicy::should_auto_unlock(
            session_explicitly_locked,
            local_vault_present,
            password_entry_count as usize,
            sync_provider_count as usize,
            provider_setup_active,
            add_provider_open,
        )
    }

    #[wasm_bindgen(js_name = existingVaultIdentityRecoveryRequired)]
    #[must_use]
    pub fn existing_vault_identity_recovery_required(
        &self,
        existing_vault_required: bool,
        provider_setup_active: bool,
        device_protection_ready: bool,
    ) -> bool {
        nook_core::VaultClientPolicy::existing_vault_identity_recovery_required(
            existing_vault_required,
            provider_setup_active,
            device_protection_ready,
        )
    }

    #[wasm_bindgen(js_name = shouldShowLoginVaultPicker)]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn should_show_login_vault_picker(
        &self,
        authenticated: bool,
        local_vault_count: u32,
        vault_selected: bool,
        provider_setup_active: bool,
        add_provider_open: bool,
        session_explicitly_locked: bool,
    ) -> bool {
        nook_core::VaultClientPolicy::should_show_login_vault_picker(
            authenticated,
            local_vault_count as usize,
            vault_selected,
            provider_setup_active,
            add_provider_open,
            session_explicitly_locked,
        )
    }

    #[wasm_bindgen(js_name = remoteVaultAssessDecision)]
    #[must_use]
    pub fn remote_vault_assess_decision(
        &self,
        access_status: nook_core::VaultAccessStatus,
        existing_vault_required: bool,
        provider_setup_active: bool,
    ) -> nook_core::RemoteVaultAssessDecision {
        nook_core::VaultClientPolicy::remote_vault_assess_decision(
            access_status,
            existing_vault_required,
            provider_setup_active,
        )
    }

    #[wasm_bindgen(js_name = unauthenticatedSyncDecision)]
    #[must_use]
    pub fn unauthenticated_sync_decision(
        &self,
        changed: bool,
        access_status_available: bool,
        access_status: nook_core::VaultAccessStatus,
        join_state: nook_core::JoinEnrollmentState,
        awaiting_join_approval: bool,
    ) -> nook_core::UnauthenticatedSyncDecision {
        nook_core::VaultClientPolicy::unauthenticated_sync_decision(
            changed,
            if access_status_available {
                nook_core::VaultAccessObservation::Available(access_status)
            } else {
                nook_core::VaultAccessObservation::Unavailable
            },
            join_state,
            awaiting_join_approval,
        )
    }

    #[wasm_bindgen(js_name = shouldAutoConnectAfterApproval)]
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
        nook_core::VaultClientPolicy::should_auto_connect_after_approval(
            authenticated,
            verifying,
            password_prompt_open,
            session_expired_by_idle,
            session_explicitly_locked,
        )
    }

    #[wasm_bindgen(js_name = normalizedSecretPageOffset)]
    #[must_use]
    pub fn normalized_secret_page_offset(
        &self,
        total: u32,
        requested_offset: u32,
        page_size: u32,
    ) -> u32 {
        nook_core::VaultClientPolicy::normalized_secret_page_offset(
            total,
            requested_offset,
            page_size,
        )
    }

    #[wasm_bindgen(js_name = vaultSwitchTarget)]
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn vault_switch_target(
        &self,
        requested_store_id: &str,
        active_store_selected: bool,
        active_store_id: &str,
        verifying: bool,
    ) -> NookVaultSwitchDecision {
        NookVaultSwitchDecision(nook_core::VaultClientPolicy::vault_switch_target(
            requested_store_id,
            if active_store_selected {
                nook_core::ActiveVaultStore::Selected(active_store_id)
            } else {
                nook_core::ActiveVaultStore::Unselected
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
            nook_core::VaultSwitchDecision::NoChange => NookVaultSwitchState::NoChange,
            nook_core::VaultSwitchDecision::SwitchTo(..) => NookVaultSwitchState::Switch,
        }
    }

    pub fn target(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            nook_core::VaultSwitchDecision::SwitchTo(target) => Ok(target.clone()),
            nook_core::VaultSwitchDecision::NoChange => {
                Err(wasm_bindgen::JsError::new("vault switch was not requested"))
            }
        }
    }
}

#[wasm_bindgen]
impl NookRuntimeConfig {
    #[wasm_bindgen(constructor)]
    pub fn new(run_mode: NookClientRunMode, e2e_expose_vault: bool) -> Self {
        Self {
            policy: nook_core::VaultRuntimePolicy::new(run_mode.into(), e2e_expose_vault),
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
        self.policy.run_mode() == nook_core::ClientRunMode::Local
    }

    #[wasm_bindgen(getter, js_name = isDev)]
    #[must_use]
    pub fn is_dev(&self) -> bool {
        self.policy.run_mode() == nook_core::ClientRunMode::Dev
    }

    #[wasm_bindgen(getter, js_name = isProd)]
    #[must_use]
    pub fn is_prod(&self) -> bool {
        self.policy.run_mode() == nook_core::ClientRunMode::Prod
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

    #[wasm_bindgen(js_name = allowFastSync)]
    #[must_use]
    pub fn allow_fast_sync(&self) -> bool {
        self.policy.allow_fast_sync()
    }

    #[wasm_bindgen(js_name = exposeDebugHooks)]
    #[must_use]
    pub fn expose_debug_hooks(&self) -> bool {
        self.policy.expose_debug_hooks()
    }

    #[wasm_bindgen(js_name = resolveVaultIdleTimeoutMs)]
    #[must_use]
    pub fn resolve_vault_idle_timeout_ms(&self, raw_timeout_ms: &str) -> u32 {
        self.policy
            .resolve_vault_idle_timeout_ms(nook_core::RuntimeConfigValue::Set(raw_timeout_ms))
    }

    #[wasm_bindgen(js_name = resolveDefaultVaultIdleTimeoutMs)]
    #[must_use]
    pub fn resolve_default_vault_idle_timeout_ms(&self) -> u32 {
        self.policy
            .resolve_vault_idle_timeout_ms(nook_core::RuntimeConfigValue::Unset)
    }

    #[wasm_bindgen(js_name = resolveVaultIdleWarningMs)]
    #[must_use]
    pub fn resolve_vault_idle_warning_ms(&self, raw_warning_ms: &str) -> u32 {
        self.policy
            .resolve_vault_idle_warning_ms(nook_core::RuntimeConfigValue::Set(raw_warning_ms))
    }

    #[wasm_bindgen(js_name = resolveDefaultVaultIdleWarningMs)]
    #[must_use]
    pub fn resolve_default_vault_idle_warning_ms(&self) -> u32 {
        self.policy
            .resolve_vault_idle_warning_ms(nook_core::RuntimeConfigValue::Unset)
    }

    #[wasm_bindgen(js_name = resolveVaultSyncIntervalMs)]
    #[must_use]
    pub fn resolve_vault_sync_interval_ms(&self, raw_interval_ms: &str) -> u32 {
        self.policy
            .resolve_vault_sync_interval_ms(nook_core::RuntimeConfigValue::Set(raw_interval_ms))
    }

    #[wasm_bindgen(js_name = resolveDefaultVaultSyncIntervalMs)]
    #[must_use]
    pub fn resolve_default_vault_sync_interval_ms(&self) -> u32 {
        self.policy
            .resolve_vault_sync_interval_ms(nook_core::RuntimeConfigValue::Unset)
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasskeySetup {
    user_handle: Vec<u8>,
    prf_input: Vec<u8>,
}

impl NookPasskeySetup {
    pub(crate) fn from_core(setup: &nook_core::DeviceKeyProtectionSetup) -> Self {
        Self {
            user_handle: setup.user_handle().to_vec(),
            prf_input: setup.prf_input().to_vec(),
        }
    }
}

#[wasm_bindgen]
impl NookPasskeySetup {
    #[wasm_bindgen(getter, js_name = userHandle)]
    pub fn user_handle(&self) -> Vec<u8> {
        self.user_handle.clone()
    }

    #[wasm_bindgen(getter, js_name = prfInput)]
    pub fn prf_input(&self) -> Vec<u8> {
        self.prf_input.clone()
    }

    #[wasm_bindgen(js_name = creationOptions)]
    pub fn creation_options(
        &self,
        rp_id: &str,
        rp_name: &str,
    ) -> Result<web_sys::CredentialCreationOptions, wasm_bindgen::JsError> {
        crate::passkey_browser::creation_options(
            rp_id,
            rp_name,
            crate::passkey_browser::DEFAULT_PASSKEY_LABEL,
            &self.user_handle,
            &self.prf_input,
        )
    }

    /// Build browser registration options with the label chosen by the caller.
    /// The browser ceremony remains in the presentation layer; this only
    /// prepares the typed `WebAuthn` request from Rust-owned setup material.
    #[wasm_bindgen(js_name = creationOptionsWithLabel)]
    pub fn creation_options_with_label(
        &self,
        rp_id: &str,
        rp_name: &str,
        passkey_label: &str,
    ) -> Result<web_sys::CredentialCreationOptions, wasm_bindgen::JsError> {
        crate::passkey_browser::creation_options(
            rp_id,
            rp_name,
            passkey_label,
            &self.user_handle,
            &self.prf_input,
        )
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasskeyUnlockOptions {
    credential_id: Vec<u8>,
    prf_input: Vec<u8>,
}

impl NookPasskeyUnlockOptions {
    pub(crate) fn from_core(
        record: &nook_core::WrappedDeviceIdentity,
    ) -> Result<Self, nook_core::DeviceKeyProtectionError> {
        let request = nook_core::passkey_assertion_request(record)?;
        Ok(Self {
            credential_id: request.credential_id().to_vec(),
            prf_input: request.prf_input().to_vec(),
        })
    }
}

#[wasm_bindgen]
impl NookPasskeyUnlockOptions {
    #[wasm_bindgen(getter, js_name = credentialId)]
    pub fn credential_id(&self) -> Vec<u8> {
        self.credential_id.clone()
    }

    #[wasm_bindgen(getter, js_name = prfInput)]
    pub fn prf_input(&self) -> Vec<u8> {
        self.prf_input.clone()
    }

    #[wasm_bindgen(js_name = requestOptions)]
    pub fn request_options(
        &self,
        rp_id: &str,
    ) -> Result<web_sys::CredentialRequestOptions, wasm_bindgen::JsError> {
        crate::passkey_browser::request_options(rp_id, &self.credential_id, &self.prf_input)
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookJoinRequest {
    device_id: String,
    public_key: String,
    requested_at: String,
}

#[wasm_bindgen]
impl NookJoinRequest {
    pub(crate) fn from_core(join: nook_core::JoinRequest) -> Self {
        Self {
            device_id: join.device_id.to_string(),
            public_key: join.public_key.as_str().to_owned(),
            requested_at: join.requested_at,
        }
    }

    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter, js_name = publicKey)]
    pub fn public_key(&self) -> String {
        self.public_key.clone()
    }

    #[wasm_bindgen(getter, js_name = requestedAt)]
    pub fn requested_at(&self) -> String {
        self.requested_at.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultMember {
    auth_id: String,
    device_id: String,
    public_key: String,
    enrolled_at: String,
    label: String,
}

#[wasm_bindgen]
impl NookVaultMember {
    pub(crate) fn from_core(member: nook_core::VaultMember) -> Self {
        Self {
            auth_id: member.auth_id.to_string(),
            device_id: member.device_id.to_string(),
            public_key: member.public_key.as_str().to_owned(),
            enrolled_at: member.enrolled_at,
            label: member.label.unwrap_or_default(),
        }
    }

    #[wasm_bindgen(getter, js_name = authId)]
    pub fn auth_id(&self) -> String {
        self.auth_id.clone()
    }

    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter, js_name = publicKey)]
    pub fn public_key(&self) -> String {
        self.public_key.clone()
    }

    #[wasm_bindgen(getter, js_name = enrolledAt)]
    pub fn enrolled_at(&self) -> String {
        self.enrolled_at.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasswordEntrySummary {
    id: String,
    label: String,
    created_at: String,
}

#[wasm_bindgen]
impl NookPasswordEntrySummary {
    pub(crate) fn from_core(entry: &nook_core::PasswordUnlockEntry) -> Self {
        Self {
            id: entry.id.clone(),
            label: entry.label.clone(),
            created_at: entry.created_at.clone(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    #[wasm_bindgen(getter, js_name = createdAt)]
    pub fn created_at(&self) -> String {
        self.created_at.clone()
    }
}

pub(crate) fn password_entries_to_vec(
    entries: &[nook_core::PasswordUnlockEntry],
) -> Vec<NookPasswordEntrySummary> {
    entries
        .iter()
        .map(NookPasswordEntrySummary::from_core)
        .collect()
}
