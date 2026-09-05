use super::{wasm_bindgen, window};
use nook_core::{ClientRunMode, RuntimeConfigValue, VaultRuntimePolicy};
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
}
