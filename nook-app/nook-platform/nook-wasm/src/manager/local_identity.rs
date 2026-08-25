//! Local identity creation, selection, and session adoption.

use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroize;

use super::{NookVaultManager, StorageSession};
use crate::NookError;

const DEFAULT_IDENTITY_LABEL: &str = "Personal";

fn local_identity_label(label: &str) -> Result<String, JsError> {
    let label = label.trim();
    if label.is_empty() {
        return Err(JsError::new("Identity label cannot be empty."));
    }
    Ok(label.to_owned())
}

async fn ensure_no_pending_vault_creation() -> Result<(), NookError> {
    let simple_pending = crate::storage::identity_record::pending_simple_genesis()
        .await?
        .is_some();
    let sentinel_pending = crate::storage::indexed_db::load_sentinel_genesis_finalization_pending()
        .await?
        .is_some();
    let recovery_cleanup_pending =
        crate::storage::identity_record::has_pending_identity_recovery_cleanup().await?;
    if simple_pending || sentinel_pending || recovery_cleanup_pending {
        return Err(NookError::Database(
            "Pending vault creation or recovery cleanup must finish before changing identities"
                .to_owned(),
        ));
    }
    Ok(())
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Stage a distinct local identity. No directory or keyring state is
    /// written until its browser-protection ceremony succeeds.
    #[wasm_bindgen]
    pub async fn begin_local_identity_creation(&mut self, label: &str) -> Result<(), JsError> {
        let label = local_identity_label(label)?;
        ensure_no_pending_vault_creation().await?;
        if crate::storage::identity_record::selected_legacy_signer_requires_authorization().await? {
            if self.device.identity_private_key.is_empty() {
                return Err(NookError::Decryption(
                    nook_core::i18n_keys::ERRORS_DEVICE_PROTECTION_AUTHORIZATION_REQUIRED
                        .to_owned(),
                )
                .into());
            }
            let app_key = self.device_identity()?;
            crate::storage::identity_record::load_or_create_signing_seed_for_app_key(&app_key)
                .await?;
        }
        self.device.pending_local_identity_label = Some(label);
        Ok(())
    }

    #[wasm_bindgen]
    pub fn cancel_local_identity_creation(&mut self) {
        self.device.pending_local_identity_label = None;
    }

    #[wasm_bindgen(getter)]
    pub fn local_identity_creation_pending(&self) -> bool {
        self.device.pending_local_identity_label.is_some()
    }

    /// Select a protected identity on this browser and lock the prior one.
    /// The selected identity must authenticate before it can open vaults.
    #[wasm_bindgen]
    pub async fn activate_local_identity(&mut self, identity_id: String) -> Result<(), JsError> {
        let identity_id = nook_core::IdentityId::parse(&identity_id)?;
        ensure_no_pending_vault_creation().await?;
        let selection = crate::storage::identity_record::select_local_identity(identity_id).await?;
        self.finish_local_identity_activation(&selection.selected_app_id);
        Ok(())
    }

    /// Select the protected local identity that owns an app key. Extension
    /// grants identify their installation by app ID rather than identity ID.
    #[wasm_bindgen]
    pub async fn activate_local_identity_for_app_id(
        &mut self,
        app_id: String,
    ) -> Result<String, JsError> {
        let app_id = nook_core::AppId::parse(&app_id)?;
        ensure_no_pending_vault_creation().await?;
        let changes_live_identity = self.device.public_app_id() != app_id.as_str();
        let entry = crate::storage::identity_record::load_entry_for_app_id(&app_id)
            .await?
            .ok_or_else(|| JsError::new("App key has no protected local identity."))?;
        let selection =
            crate::storage::identity_record::select_local_identity(entry.identity_id().clone())
                .await?;
        if changes_live_identity {
            self.finish_local_identity_activation(&selection.selected_app_id);
        }
        Ok(selection
            .previous_app_id
            .map(|app_id| app_id.to_string())
            .unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancelled_creation_leaves_no_pending_identity() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.device.pending_local_identity_label = Some(local_identity_label("Work")?);
        assert!(manager.local_identity_creation_pending());

        manager.cancel_local_identity_creation();

        assert!(!manager.local_identity_creation_pending());
        Ok(())
    }

    #[test]
    fn empty_identity_labels_are_rejected() {
        assert!(local_identity_label("   ").is_err());
    }

    #[test]
    fn identity_transition_clears_provider_session_state() {
        let mut manager = NookVaultManager::new();
        manager.storage.mode = nook_core::StorageMode::Github;
        manager.storage.access_token = "prior-identity-token".to_owned();
        manager.storage.remote_ref = "owner/repository".to_owned();
        manager.storage.remote_path = "events".to_owned();
        manager.sync_outbox.access_token = "prior-outbox-token".to_owned();

        manager.reset_local_identity_session();

        assert_eq!(manager.storage.mode, nook_core::StorageMode::Local);
        assert!(manager.storage.access_token.is_empty());
        assert!(manager.storage.remote_ref.is_empty());
        assert!(manager.storage.remote_path.is_empty());
        assert!(manager.sync_outbox.access_token.is_empty());
    }

    #[test]
    fn identity_transition_drops_pending_extension_authorization() -> Result<(), NookError> {
        let authorizer = nook_core::AppKey::generate()?;
        let (signing, signing_seed) = nook_core::SigningIdentity::generate()?;
        let mut manager = NookVaultManager::new();
        manager.device.extension_handoff_private_key = "handoff-private-key".to_owned();
        manager.device.pending_extension_handoff = Some(
            super::super::device_protection::PendingExtensionIdentityHandoff {
                enrollment:
                    super::super::device_protection::PendingExtensionIdentityEnrollment::PairedVault {
                        authorizer,
                        store_id: nook_core::generate_store_id()?,
                    },
                authorizer_signing: None,
                signing_public_key: signing.public_key(),
                handoff_signing_seed: signing_seed.into_inner(),
                persist_signing_seed: true,
                previous_session_signing_seed: "previous-session-signer".to_owned(),
            },
        );

        manager.reset_local_identity_session();

        assert!(manager.device.pending_extension_handoff.is_none());
        assert!(manager.device.extension_handoff_private_key.is_empty());
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn pending_recovery_cleanup_blocks_creation_before_browser_protection()
    -> Result<(), NookError> {
        crate::storage::indexed_db::idb_put_string(
            crate::storage::identity_record::PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY,
            "pending",
        )
        .await?;
        let mut manager = NookVaultManager::new();

        let result = manager.begin_local_identity_creation("Work").await;

        assert!(result.is_err());
        assert!(!manager.local_identity_creation_pending());
        crate::storage::indexed_db::idb_delete_key(
            crate::storage::identity_record::PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY,
        )
        .await
    }

    #[wasm_bindgen_test]
    async fn legacy_signer_migrates_before_identity_creation_is_staged() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager
            .delete_local_browser_data()
            .await
            .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
        manager
            .finish_pin_device_protection("personal identity pin".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("protect personal identity: {error:?}"))?;
        let app_key = manager.device_identity()?;
        let signing_seed = manager.event_log.signing_seed.clone();
        let protected = crate::storage::identity_record::load_selected_entry()
            .await?
            .ok_or_else(|| anyhow::anyhow!("selected identity is missing"))?;
        let mut keyring = crate::storage::identity_record::load_keyring().await?;
        keyring
            .replace(nook_core::LocalIdentityKeyringEntry::legacy(
                protected.identity_id().clone(),
                app_key.app_id().clone(),
                protected.wrapped_app_key().clone(),
            ))
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        crate::storage::indexed_db::idb_put_string(
            crate::storage::identity_record::LOCAL_IDENTITY_KEYRING_KEY,
            &serde_json::to_string(&keyring)?,
        )
        .await?;
        crate::storage::indexed_db::idb_put_string(
            crate::storage::event_db::SIGNING_SEED_KEY,
            &signing_seed,
        )
        .await?;
        let app_secret = manager.device.identity_private_key.clone();
        manager.device.identity_private_key.clear();

        assert!(manager.begin_local_identity_creation("Work").await.is_err());
        assert!(!manager.local_identity_creation_pending());

        manager.device.identity_private_key = app_secret;
        manager
            .begin_local_identity_creation("Work")
            .await
            .map_err(|error| anyhow::anyhow!("begin identity creation: {error:?}"))?;

        assert!(manager.local_identity_creation_pending());
        assert!(
            crate::storage::identity_record::load_selected_entry()
                .await?
                .ok_or_else(|| anyhow::anyhow!("migrated identity is missing"))?
                .has_signing_seed()
        );
        assert!(
            crate::storage::indexed_db::idb_get_string(crate::storage::event_db::SIGNING_SEED_KEY,)
                .await?
                .is_none()
        );
        manager
            .delete_local_browser_data()
            .await
            .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn app_activation_retains_target_after_another_tab_changes_selection()
    -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager
            .delete_local_browser_data()
            .await
            .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
        manager
            .finish_pin_device_protection("personal identity pin".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("protect personal identity: {error:?}"))?;
        let personal_app_id = manager.device.public_app_id();
        manager
            .begin_local_identity_creation("Work")
            .await
            .map_err(|error| anyhow::anyhow!("begin work identity: {error:?}"))?;
        manager
            .finish_pin_device_protection("work identity pin".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("protect work identity: {error:?}"))?;
        assert_ne!(manager.device.public_app_id(), personal_app_id);

        manager.device.id.clone_from(&personal_app_id);
        manager.device.identity_private_key.clear();
        let previous_app_id = manager
            .activate_local_identity_for_app_id(personal_app_id.clone())
            .await
            .map_err(|error| anyhow::anyhow!("activate personal identity: {error:?}"))?;

        assert_ne!(previous_app_id, personal_app_id);
        let selected = crate::storage::identity_record::load_selected_entry()
            .await?
            .ok_or_else(|| anyhow::anyhow!("selected identity is missing"))?;
        assert_eq!(selected.app_id().as_str(), personal_app_id);
        assert_eq!(manager.device.public_app_id(), personal_app_id);

        let work_identity_id = crate::storage::identity_record::load_keyring()
            .await?
            .entries()
            .iter()
            .find(|entry| entry.app_id().as_str() != personal_app_id)
            .map(|entry| entry.identity_id().clone())
            .ok_or_else(|| anyhow::anyhow!("work identity is missing"))?;
        crate::storage::identity_record::select_local_identity(work_identity_id).await?;

        assert_eq!(manager.device.public_app_id(), personal_app_id);
        assert!(manager.device.identity_private_key.is_empty());
        manager
            .delete_local_browser_data()
            .await
            .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
        Ok(())
    }
}

impl NookVaultManager {
    fn finish_local_identity_activation(&mut self, app_id: &nook_core::AppId) {
        self.reset_local_identity_session();
        self.lock_device_identity();
        self.device.id = app_id.to_string();
        self.device.pending_local_identity_label = None;
    }

    fn reset_local_identity_session(&mut self) {
        self.device.pending_extension_handoff = None;
        self.device.extension_handoff_private_key.zeroize();
        self.device.extension_handoff_private_key.clear();
        self.reset_vault_session();
        self.storage.access_token.zeroize();
        self.storage = StorageSession::default();
        self.event_log_sync_issue = super::EventLogSyncIssueState::Clear;
    }

    pub(in crate::manager) fn is_creating_local_identity(&self) -> bool {
        self.device.pending_local_identity_label.is_some()
    }

    pub(in crate::manager) async fn persist_and_adopt_local_identity(
        &mut self,
        app_key: nook_core::AppKey,
        record: &nook_core::WrappedDeviceIdentity,
    ) -> Result<String, NookError> {
        let pending_label = self.device.pending_local_identity_label.clone();
        let saved = match pending_label.as_deref() {
            Some(label) => {
                let prior_app_key = if self.device.identity_private_key.is_empty() {
                    None
                } else {
                    Some(self.device_identity()?)
                };
                crate::storage::auth_providers::migrate_legacy_auth_providers_for_selected_identity()
                    .await?;
                crate::storage::device_access::migrate_legacy_device_access_profile_for_selected_identity()
                    .await?;
                crate::storage::identity_record::save_new_protected_local_identity(
                    &app_key,
                    record,
                    prior_app_key.as_ref(),
                    label,
                )
                .await?
            }
            None => {
                crate::storage::identity_record::save_protected_local_identity(
                    &app_key,
                    record,
                    DEFAULT_IDENTITY_LABEL,
                )
                .await?
            }
        };
        if !saved.identity.has_app_id(app_key.app_id()) {
            return Err(NookError::Database(
                "Persisted local identity does not own its app key".to_owned(),
            ));
        }

        self.reset_local_identity_session();
        self.device.id = app_key.app_id().to_string();
        self.device.identity_private_key.zeroize();
        self.device.identity_private_key = app_key.secret_string().into_inner();
        self.event_log.signing_seed = saved.signing_seed;
        self.device.pending_local_identity_label = None;
        Ok(self.device.id.clone())
    }

    pub(in crate::manager) async fn adopt_unlocked_local_identity(
        &mut self,
        app_key: nook_core::AppKey,
        record: &nook_core::WrappedDeviceIdentity,
    ) -> Result<(), NookError> {
        let signing_seed =
            if crate::storage::identity_record::load_entry_for_app_id(app_key.app_id())
                .await?
                .is_some()
            {
                crate::storage::identity_record::load_or_create_signing_seed_for_app_key(&app_key)
                    .await?
            } else {
                crate::storage::identity_record::save_protected_local_identity(
                    &app_key,
                    record,
                    DEFAULT_IDENTITY_LABEL,
                )
                .await?
                .signing_seed
            };
        self.reset_local_identity_session();
        self.device.id = app_key.app_id().to_string();
        self.device.identity_private_key.zeroize();
        self.device.identity_private_key = app_key.secret_string().into_inner();
        self.event_log.signing_seed = signing_seed;
        Ok(())
    }
}
