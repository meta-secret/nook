use super::wasm_bindgen;
use crate::ConfiguredVaultApplication;
use crate::VaultSnapshotLookup;
use crate::storage::indexed_db::ImportVaultLabel;
use crate::storage::indexed_db::VaultUnlockHistory;
use crate::{ImportVaultBlobRequest, NookDatabase, SetLocalVaultLabelRequest};
use nook_core::ActiveVaultScope;
use nook_core::{VaultApplication, VaultConnectIntent, VaultType};
use wasm_bindgen::JsError;

impl ConfiguredVaultApplication {
    fn validate_configured_application_for_content(content: &str) -> Result<(), crate::NookError> {
        let architecture = nook_core::VaultFormatDocument::new(content).architecture()?;
        ConfiguredVaultApplication::configured_vault_application()
            .validate_session_access(architecture.vault_type)?;
        Ok(())
    }
}

/// Configure the immutable application capability for this browser realm.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn configure_vault_application(application: nook_core::VaultApplication) {
    ConfiguredVaultApplication::configure_vault_application(application);
}

/// Return the immutable capability configured by the current web app.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn configured_vault_application() -> nook_core::VaultApplication {
    ConfiguredVaultApplication::configured_vault_application()
}

/// Return the stable semantic application name used by browser debug hooks.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn configured_vault_application_name() -> String {
    ConfiguredVaultApplication::configured_vault_application()
        .as_str()
        .to_owned()
}

/// Return whether the configured application is the Simple Vault artifact.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn configured_vault_application_is_simple() -> bool {
    ConfiguredVaultApplication::configured_vault_application().is_simple()
}

/// Return whether the configured application is the Sentinel Vault artifact.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn configured_vault_application_is_sentinel() -> bool {
    ConfiguredVaultApplication::configured_vault_application().is_sentinel()
}

/// Return whether the configured application may offer extension integration.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn configured_vault_application_supports_extension() -> bool {
    ConfiguredVaultApplication::configured_vault_application().supports_extension()
}

/// Return the configured deployment-channel Simple Vault root URL.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn simple_vault_app_url(configured_url: &str) -> String {
    const DEFAULT_SIMPLE_VAULT_APP_URL: &str = "https://simple.nokey.sh";

    let configured_url = configured_url.trim();
    let root = if configured_url.is_empty() {
        DEFAULT_SIMPLE_VAULT_APP_URL
    } else {
        configured_url
    };
    format!("{}/", root.trim_end_matches('/'))
}

#[cfg(test)]
mod application_url_tests {
    use super::simple_vault_app_url;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn simple_vault_application_url_is_defaulted_and_normalized() {
        assert_eq!(
            simple_vault_app_url(""),
            "https://simple.nokey.sh/".to_owned()
        );
        assert_eq!(
            simple_vault_app_url("  https://preview-simple.example///  "),
            "https://preview-simple.example/".to_owned()
        );
    }
}

/// Return the Rust-owned empty-provider policy for a first-connect intent.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn vault_connect_intent_permits_empty_remote_genesis(
    intent_name: &str,
) -> Result<bool, JsError> {
    let intent = VaultConnectIntent::parse(intent_name).map_err(|error| JsError::new(&error))?;
    Ok(intent.permits_empty_remote_genesis())
}

/// Fail before persistence/session creation when encrypted vault content does
/// not belong to this artifact's compile-time application capability.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn validate_vault_content_for_application(content: &str) -> Result<(), JsError> {
    ConfiguredVaultApplication::validate_configured_application_for_content(content)
        .map_err(Into::into)
}

/// Validate extension pairing metadata through the Rust capability matrix.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn validate_extension_pairing_vault_type(vault_type: &str) -> Result<(), JsError> {
    let vault_type = VaultType::parse(vault_type)?;
    let application = ConfiguredVaultApplication::configured_vault_application();
    if application == VaultApplication::Extension {
        application.validate_session_access(vault_type)?;
    } else {
        application.validate_extension_approval(vault_type)?;
    }
    Ok(())
}

impl ConfiguredVaultApplication {
    async fn local_vault_matches_compiled_application(
        store_id: &str,
    ) -> Result<bool, crate::NookError> {
        let VaultSnapshotLookup::Stored(content) = NookDatabase::load_vault_blob(store_id).await?
        else {
            return Ok(false);
        };
        let architecture = nook_core::VaultFormatDocument::new(&content).architecture()?;
        Ok(ConfiguredVaultApplication::configured_vault_application()
            .permits_vault_type(architecture.vault_type))
    }
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn has_local_vault() -> Result<bool, JsError> {
    for entry in NookDatabase::list_vault_registry_entries().await? {
        if ConfiguredVaultApplication::local_vault_matches_compiled_application(&entry.store_id)
            .await?
        {
            return Ok(true);
        }
    }
    Ok(false)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn has_active_local_vault() -> Result<bool, JsError> {
    let ActiveVaultScope::StoreId(store_id) = NookDatabase::get_active_vault_id().await? else {
        return Ok(false);
    };
    Ok(ConfiguredVaultApplication::local_vault_matches_compiled_application(&store_id).await?)
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookLocalVaultEntry {
    pub(crate) store_id: String,
    pub(crate) label: String,
    pub(crate) last_unlocked_at: VaultUnlockHistory,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookLocalVaultUnlockState {
    NeverUnlocked,
    Unlocked,
}

#[wasm_bindgen]
impl NookLocalVaultEntry {
    #[wasm_bindgen(getter, js_name = storeId)]
    pub fn store_id(&self) -> String {
        self.store_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    #[wasm_bindgen]
    pub fn display_label(&self, fallback_label: &str) -> String {
        let label = self.label.trim();
        if label.is_empty() {
            fallback_label.to_owned()
        } else {
            label.to_owned()
        }
    }

    #[wasm_bindgen(getter, js_name = unlockState)]
    #[must_use]
    pub fn unlock_state(&self) -> NookLocalVaultUnlockState {
        match self.last_unlocked_at {
            VaultUnlockHistory::Unlocked(_) => NookLocalVaultUnlockState::Unlocked,
            VaultUnlockHistory::NeverUnlocked => NookLocalVaultUnlockState::NeverUnlocked,
        }
    }

    #[wasm_bindgen(getter, js_name = lastUnlockedAt)]
    pub fn last_unlocked_at(&self) -> Result<String, JsError> {
        match &self.last_unlocked_at {
            VaultUnlockHistory::Unlocked(timestamp) => Ok(timestamp.to_string()),
            VaultUnlockHistory::NeverUnlocked => {
                Err(JsError::new("local vault has never been unlocked"))
            }
        }
    }
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn list_local_vaults() -> Result<Vec<NookLocalVaultEntry>, JsError> {
    let mut matching = Vec::new();
    for entry in NookDatabase::list_vault_registry_entries().await? {
        if ConfiguredVaultApplication::local_vault_matches_compiled_application(&entry.store_id)
            .await?
        {
            matching.push(NookLocalVaultEntry {
                store_id: entry.store_id,
                label: entry.label,
                last_unlocked_at: entry.last_unlocked_at,
            });
        }
    }
    Ok(matching)
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookActiveVaultSelectionState {
    NotSelected,
    Selected,
}

#[wasm_bindgen]
pub struct NookActiveVaultSelection(pub(crate) ActiveVaultScope);

#[wasm_bindgen]
impl NookActiveVaultSelection {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookActiveVaultSelectionState {
        match &self.0 {
            ActiveVaultScope::StoreId(_) => NookActiveVaultSelectionState::Selected,
            ActiveVaultScope::Unselected => NookActiveVaultSelectionState::NotSelected,
        }
    }

    #[wasm_bindgen(getter, js_name = storeId)]
    pub fn store_id(&self) -> Result<String, JsError> {
        match &self.0 {
            ActiveVaultScope::StoreId(store_id) => Ok(store_id.clone()),
            ActiveVaultScope::Unselected => Err(JsError::new("no active local vault is selected")),
        }
    }
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn get_active_vault_selection() -> Result<NookActiveVaultSelection, JsError> {
    let ActiveVaultScope::StoreId(store_id) = NookDatabase::get_active_vault_id().await? else {
        return Ok(NookActiveVaultSelection(ActiveVaultScope::Unselected));
    };
    if ConfiguredVaultApplication::local_vault_matches_compiled_application(&store_id).await? {
        Ok(NookActiveVaultSelection(ActiveVaultScope::StoreId(
            store_id,
        )))
    } else {
        Ok(NookActiveVaultSelection(ActiveVaultScope::Unselected))
    }
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn set_active_vault(store_id: String) -> Result<(), JsError> {
    let content = match NookDatabase::load_vault_blob(&store_id).await? {
        VaultSnapshotLookup::Stored(content) => content,
        VaultSnapshotLookup::NotStored => {
            return Err(crate::NookError::Database("Local vault was not found.".to_owned()).into());
        }
    };
    ConfiguredVaultApplication::validate_configured_application_for_content(&content)?;
    NookDatabase::switch_active_vault(&store_id)
        .await
        .map_err(Into::into)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn set_local_vault_label(store_id: String, label: String) -> Result<(), JsError> {
    NookDatabase::set_local_vault_label(SetLocalVaultLabelRequest {
        store_id: &store_id,
        label: &label,
    })
    .await
    .map_err(Into::into)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn prepare_new_local_vault_slot() -> Result<(), JsError> {
    NookDatabase::prepare_new_local_vault_slot()
        .await
        .map_err(Into::into)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn import_local_vault_blob(content: String) -> Result<String, JsError> {
    ConfiguredVaultApplication::validate_configured_application_for_content(&content)?;
    NookDatabase::import_vault_blob(ImportVaultBlobRequest {
        content: &content,
        label: ImportVaultLabel::FromDocument,
    })
    .await
    .map_err(Into::into)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn import_named_local_vault_blob(
    content: String,
    label: String,
) -> Result<String, JsError> {
    ConfiguredVaultApplication::validate_configured_application_for_content(&content)?;
    NookDatabase::import_vault_blob(ImportVaultBlobRequest {
        content: &content,
        label: ImportVaultLabel::Override(&label),
    })
    .await
    .map_err(Into::into)
}
