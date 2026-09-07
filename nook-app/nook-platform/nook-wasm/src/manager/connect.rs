//! Vault connect / assess / genesis paths.
//!
//! - `assess_vault_connect` — pre-flight check the web layer runs before
//!   asking the user to confirm an unlock attempt.
//! - `connect` / `connect_fresh` / `connect_internal` — keys-mode unlock,
//!   with a clear short-circuit when the vault is in password mode.
//! - `initialize_empty` / `initialize_genesis_vault` — bootstrap a new
//!   vault file with this device as the genesis member.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::verified_access::VerifiedVaultAccessFlow;
use super::{NookVaultManager, VaultNameState};
use crate::NookError;
use crate::NookSecretRecord;
use crate::conversion::LoadedVault;
use crate::storage::event_db::load_local_event_store;
use crate::storage::identity_record::{PendingSimpleGenesis, SimpleGenesisCompletion};
use crate::storage::indexed_db::load_vault_local_cache;
use crate::storage::{event_db, identity_record, indexed_db};
use nook_core::{
    ConnectAccessStatus, EventGraphAuthorizationProjection, EventId, IdentityVaultDekEpoch,
    IdentityVaultEventId, StorageMode, StoreId, VaultAccessStatus, VaultUnlock,
};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

impl NookError {
    fn requires_sentinel_ceremony(&self) -> bool {
        match self {
            Self::Encryption(message) | Self::Database(message) => {
                message.contains("opened-share ceremony")
                    || message.contains("SentinelCeremonyRequired")
            }
            _ => false,
        }
    }
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;
    use crate::manager::PendingExtensionIdentityEnrollment;
    use crate::manager::VaultNameState;
    use crate::manager::device_protection::PendingExtensionIdentityHandoff;
    use nook_core::{AppKey, SigningIdentity};
    use wasm_bindgen::JsError;
    use wasm_bindgen_test::wasm_bindgen_test;

    struct CeremonyErrorScenario {
        error: NookError,
        expected: bool,
    }

    impl CeremonyErrorScenario {
        fn verify(self) {
            assert_eq!(self.error.requires_sentinel_ceremony(), self.expected);
        }
    }

    #[test]
    fn ceremony_error_classification_preserves_variants_and_case_sensitive_markers() {
        let variants: [fn(String) -> NookError; 2] = [NookError::Encryption, NookError::Database];
        for variant in variants {
            for (message, expected) in [
                ("requires opened-share ceremony now", true),
                ("cause: SentinelCeremonyRequired", true),
                ("ordinary database failure", false),
                ("Opened-share ceremony", false),
                ("sentinelceremonyrequired", false),
                ("", false),
            ] {
                CeremonyErrorScenario {
                    error: variant(message.to_owned()),
                    expected,
                }
                .verify();
            }
        }
        for marker in ["opened-share ceremony", "SentinelCeremonyRequired"] {
            CeremonyErrorScenario {
                error: NookError::Serialization(marker.to_owned()),
                expected: false,
            }
            .verify();
        }
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn rejected_provider_assessment_restores_local_storage_and_clears_outbox()
    -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.storage.mode = StorageMode::GoogleDrive;
        manager.storage.access_token = "rejected-token".to_owned();
        manager.sync_outbox.provider_id = "rejected-provider".to_owned();
        manager.sync_outbox.storage_mode = StorageMode::GoogleDrive;
        manager.sync_outbox.access_token = "rejected-token".to_owned();
        manager.sync_outbox.repo_arg = "rejected-file".to_owned();
        manager.vault.vault_name = VaultNameState::Named("Local vault".to_owned());

        manager.restore_local_after_provider_assessment().await?;

        assert_eq!(manager.storage.mode, StorageMode::Local);
        assert!(manager.storage.access_token.is_empty());
        assert!(manager.sync_outbox.provider_id.is_empty());
        assert_eq!(manager.sync_outbox.storage_mode, StorageMode::Local);
        assert!(manager.sync_outbox.access_token.is_empty());
        assert!(manager.sync_outbox.repo_arg.is_empty());
        assert!(matches!(
            &manager.vault.vault_name,
            VaultNameState::Named(name) if name == "Local vault"
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn remote_store_discovery_drops_stale_vault_session_state() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.vault.store_id = "store_stale12345".to_owned();
        manager.vault.vault_name = VaultNameState::Named("Stale vault".to_owned());

        let discovered = manager
            .discover_remote_vault_store_id("local".to_owned(), String::new(), String::new())
            .await?;

        assert!(discovered.is_empty());
        assert!(manager.vault.store_id.is_empty());
        assert!(matches!(manager.vault.vault_name, VaultNameState::Unnamed));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn verified_connect_finalizes_paired_identity_handoff() -> Result<(), JsError> {
        identity_record::clear_identity_directory_for_test().await?;
        let authorizer = AppKey::generate()?;
        let extension = AppKey::generate()?;
        let store_id = nook_core::StoreId::generate()?;
        let owner_key = authorizer.clone();
        let owner_store = store_id.clone();
        identity_record::update_identity_directory(move |directory| {
            let owner_id = directory.create_identity("Personal", &owner_key, None)?;
            let _ = directory.open_or_generate_vault_dek_for_identity(
                &owner_id,
                &owner_key,
                owner_store,
            )?;
            Ok(())
        })
        .await?;

        let (signing, signing_seed) = SigningIdentity::generate()?;
        let mut manager = NookVaultManager::new();
        manager.device.id = extension.device_id().as_str().to_owned();
        manager.device.identity_private_key = extension.secret_string().into_inner();
        manager.vault.store_id = store_id.to_string();
        manager.device.pending_extension_handoff = Some(PendingExtensionIdentityHandoff {
            enrollment: PendingExtensionIdentityEnrollment::PairedVault {
                authorizer,
                store_id,
            },
            authorizer_signing: None,
            signing_public_key: signing.public_key(),
            handoff_signing_seed: signing_seed.as_str().to_owned(),
            persist_signing_seed: false,
            previous_session_signing_seed: String::new(),
        });
        assert!(manager.extension_identity_handoff_requires_connect());

        manager.ensure_identity_after_connect(&extension).await?;
        let deferred = identity_record::load_identity_directory().await?;
        assert!(deferred.identity_for_app_key(&extension)?.is_none());

        manager
            .complete_connected_identity(&extension, None)
            .await?;
        let committed = identity_record::load_identity_directory().await?;
        assert!(committed.identity_for_app_key(&extension)?.is_some());
        assert!(manager.device.pending_extension_handoff.is_none());
        identity_record::clear_identity_directory_for_test().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn paired_identity_handoff_rejects_a_different_connected_vault() -> Result<(), JsError> {
        let extension = AppKey::generate()?;
        let staged_store_id = nook_core::StoreId::generate()?;
        let connected_store_id = nook_core::StoreId::generate()?;
        let (signing, signing_seed) = SigningIdentity::generate()?;
        let mut manager = NookVaultManager::new();
        manager.device.id = extension.device_id().as_str().to_owned();
        manager.device.identity_private_key = extension.secret_string().into_inner();
        manager.vault.store_id = connected_store_id.to_string();
        manager.device.pending_extension_handoff = Some(PendingExtensionIdentityHandoff {
            enrollment: PendingExtensionIdentityEnrollment::PairedVault {
                authorizer: AppKey::generate()?,
                store_id: staged_store_id,
            },
            authorizer_signing: None,
            signing_public_key: signing.public_key(),
            handoff_signing_seed: signing_seed.as_str().to_owned(),
            persist_signing_seed: false,
            previous_session_signing_seed: String::new(),
        });

        let Err(error) = manager.finalize_paired_vault_handoff().await else {
            return Err(JsError::new(
                "a paired handoff must verify its connected vault",
            ));
        };

        assert!(error.to_string().contains("different vault"));
        assert!(manager.device.pending_extension_handoff.is_some());
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn paired_session_unlock_clears_pending_without_enrolling() -> Result<(), JsError> {
        let extension = AppKey::generate()?;
        let store_id = nook_core::StoreId::generate()?;
        let (signing, signing_seed) = SigningIdentity::generate()?;
        let mut manager = NookVaultManager::new();
        manager.device.id = extension.device_id().as_str().to_owned();
        manager.device.identity_private_key = extension.secret_string().into_inner();
        manager.vault.store_id = store_id.to_string();
        manager.device.pending_extension_handoff = Some(PendingExtensionIdentityHandoff {
            enrollment: PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock { store_id },
            authorizer_signing: None,
            signing_public_key: signing.public_key(),
            handoff_signing_seed: signing_seed.as_str().to_owned(),
            persist_signing_seed: false,
            previous_session_signing_seed: String::new(),
        });

        manager.finalize_paired_vault_handoff().await?;

        assert!(manager.device.pending_extension_handoff.is_none());
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn local_assessment_reports_new_vault_and_connect_recovery_is_toggleable()
    -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.delete_local_browser_data().await?;
        let identity = nook_core::DeviceIdentity::generate()?;
        manager.device.id = identity.device_id().as_str().to_owned();
        manager.device.identity_private_key = identity.secret_string().into_inner();

        assert_eq!(
            manager
                .assess_vault_connect("local".to_owned(), String::new(), String::new())
                .await?,
            VaultAccessStatus::NewVault
        );
        manager.prepare_connect_from_local_cache();
        assert!(manager.storage.use_local_cache_for_connect);
        manager.clear_connect_recovery();
        assert!(!manager.storage.use_local_cache_for_connect);
        manager.restore_local_after_provider_assessment().await?;
        assert_eq!(manager.storage.mode, StorageMode::Local);

        manager.delete_local_browser_data().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    fn genesis_key_helpers_cover_simple_and_sentinel_architectures() -> Result<(), JsError> {
        let identity = nook_core::DeviceIdentity::generate()?;
        let mut simple = NookVaultManager::new();
        simple.initialize_genesis_vault(&identity)?;
        assert!(!simple.vault.secrets_key.is_empty());
        assert!(!simple.vault.members_key.is_empty());
        assert!(
            simple
                .stored_records_snapshot()
                .iter()
                .any(|record| nook_core::VaultMetaRecord::is_auth(record).unwrap_or(false))
        );
        assert!(
            simple
                .stored_records_snapshot()
                .iter()
                .any(|record| record.key.as_str().starts_with("member:"))
        );

        let mut sentinel = NookVaultManager::new();
        sentinel.vault.architecture = nook_core::VaultArchitecture::sentinel_personal(
            nook_core::DeviceMode::Standard,
            nook_core::SentinelPolicy {
                threshold: 2.into(),
                required_participants: 3.into(),
                ready_participants: 0.into(),
            },
        );
        sentinel.initialize_genesis_vault(&identity)?;
        assert!(!sentinel.vault.secrets_key.is_empty());
        assert!(!sentinel.vault.members_key.is_empty());
        assert!(
            !sentinel
                .stored_records_snapshot()
                .iter()
                .any(|record| nook_core::VaultMetaRecord::is_auth(record).unwrap_or(false))
        );
        assert!(
            sentinel
                .stored_records_snapshot()
                .iter()
                .any(|record| record.key.as_str().starts_with("member:"))
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn connect_fresh_local_bootstraps_genesis_and_can_be_assessed() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.delete_local_browser_data().await?;
        let identity = nook_core::DeviceIdentity::generate()?;
        manager.device.id = identity.device_id().as_str().to_owned();
        manager.device.identity_private_key = identity.secret_string().into_inner();

        let records = manager
            .connect_fresh("local".to_owned(), String::new(), String::new())
            .await?;
        assert!(records.is_empty());
        assert!(!manager.vault.store_id.is_empty());
        assert!(manager.event_log.enabled);
        assert_eq!(manager.vault.unlock, VaultUnlock::Keys);

        let mut resumed = NookVaultManager::new();
        resumed.device.id = identity.device_id().as_str().to_owned();
        resumed.device.identity_private_key = identity.secret_string().into_inner();
        let status = resumed
            .assess_vault_connect("local".to_owned(), String::new(), String::new())
            .await?;
        assert_ne!(status, VaultAccessStatus::NewVault);

        manager.delete_local_browser_data().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn connect_existing_local_content_rejects_legacy_without_event_log() -> Result<(), JsError>
    {
        let mut manager = NookVaultManager::new();
        manager.delete_local_browser_data().await?;
        let identity = nook_core::DeviceIdentity::generate()?;
        manager.device.id = identity.device_id().as_str().to_owned();
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.prepare_storage("local", "", "").await?;

        let _error = manager
            .connect_existing_content(&identity, "legacy vault content")
            .await
            .expect_err("legacy local content must require the event log");
        manager.delete_local_browser_data().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn initialize_empty_local_session_persists_a_ready_event_log() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.delete_local_browser_data().await?;
        let identity = nook_core::DeviceIdentity::generate()?;
        manager.device.id = identity.device_id().as_str().to_owned();
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.initialize_genesis_vault(&identity)?;

        let records = manager.initialize_empty().await?;
        assert!(records.is_empty());
        assert!(!manager.vault.store_id.is_empty());
        assert!(manager.event_log.enabled);
        assert!(!manager.vault.last_synced_content.is_empty());

        manager.delete_local_browser_data().await?;
        Ok(())
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Discover the single vault identity exposed by a staged sync provider
    /// without requiring or decrypting a device identity. Hosts use this only
    /// to bind an existing-vault import to an already-paired companion.
    #[wasm_bindgen]
    pub async fn discover_remote_vault_store_id(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<String, JsError> {
        self.reset_vault_session();
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        if self.storage.mode != StorageMode::Local {
            self.sync_events_from_current_provider().await?;
        }
        Ok(self.vault.store_id.clone())
    }

    /// Return the typed, core-owned connect status for the selected provider.
    pub async fn assess_vault_connect(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<nook_core::VaultAccessStatus, JsError> {
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let identity = self.ensure_device_identity()?;
        if self.storage.mode != StorageMode::Local {
            self.sync_events_from_current_provider().await?;
            if !self.vault.store_id.is_empty() && self.event_log_has_events().await? {
                let status = VaultAccessStatus::from(nook_core::assess_connect_access(
                    &self.stored_records_snapshot(),
                    &identity,
                )?);
                let _ = self
                    .status
                    .tx
                    .send(format!("ASSESS_{}_{}", self.storage.mode, status));
                return Ok(status);
            }
            if let Some(cached) = load_vault_local_cache(&self.local_cache_ref()).await?
                && !cached.trim().is_empty()
            {
                return Ok(VaultAccessStatus::RemoteMissingLocalCache);
            }
            return Ok(VaultAccessStatus::RemoteMissing);
        }
        let mut remote_content_missing = false;
        let content = self
            .fetch_vault_content(&mut remote_content_missing)
            .await?;

        if content.trim().is_empty() {
            self.vault.password_entries.clear();
            self.vault.unlock = VaultUnlock::Keys;
            self.vault.last_synced_content.clear();
            return Ok(VaultAccessStatus::NewVault);
        }

        // First boot for this session — adopt the remote unlock mode.
        self.capture_vault_unlock(&content)?;
        self.vault.last_synced_content = content.clone();
        // Prefer event-log membership when the local vault has events. A locked
        // import can leave a thin projection cache that would otherwise look like
        // a brand-new vault and skip NeedsEnrollment.
        let status = if self.event_log_has_events().await? {
            self.hydrate_locked_projection_from_events().await?;
            VaultAccessStatus::from(nook_core::assess_connect_access(
                &self.stored_records_snapshot(),
                &identity,
            )?)
        } else {
            nook_core::VaultContent::new(&content).access_status(&identity)?
        };
        let _ = self
            .status
            .tx
            .send(format!("ASSESS_{}_{}", self.storage.mode, status));
        tracing::info!(
            scope = "wasm-connect",
            status = %status,
            storage = %storage_mode,
            "assess_vault_connect"
        );
        Ok(status)
    }

    /// Return an authenticated local session to local storage after a staged
    /// provider assessment is rejected. The rejected provider must not remain
    /// the destination for later local event-log outbox entries.
    #[wasm_bindgen]
    pub async fn restore_local_after_provider_assessment(&mut self) -> Result<(), JsError> {
        self.prepare_storage_preserving_vault_metadata("local", "", "")
            .await?;
        self.sync_outbox.reset();
        Ok(())
    }

    // Connects to storage (loads, decrypts, and updates session state)
    // Returns js_sys::Array of NookSecretRecord on success
    pub async fn connect(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        self.connect_internal(storage_mode, github_pat, github_repo, false)
            .await
    }

    /// Replace storage with a fresh genesis vault for this device.
    pub async fn connect_fresh(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        self.connect_internal(storage_mode, github_pat, github_repo, true)
            .await
    }

    /// Next `connect` loads the browser-local vault cache and recreates the
    /// remote file after a successful unlock.
    #[wasm_bindgen]
    pub fn prepare_connect_from_local_cache(&mut self) {
        self.storage.use_local_cache_for_connect = true;
    }

    #[wasm_bindgen]
    pub fn clear_connect_recovery(&mut self) {
        self.storage.use_local_cache_for_connect = false;
    }

    async fn connect_internal(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
        force_genesis: bool,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status.tx.send("CONNECT_START".to_owned());
        tracing::info!(
            scope = "wasm-connect",
            storage = %storage_mode,
            force_genesis = force_genesis,
            "connect started"
        );
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let identity = self.ensure_device_identity()?;

        let (content, remote_content_missing) = self.load_connect_content().await?;

        // First boot for this session — adopt the remote unlock mode so
        // the mode-aware branches below see the right variant.
        if !content.trim().is_empty() {
            self.capture_vault_unlock(&content)?;
        }

        let event_log_only_remote = self
            .discover_event_log_only_remote(force_genesis, &content)
            .await?;

        let use_genesis = if event_log_only_remote {
            false
        } else {
            nook_core::VaultContent::new(&content).requires_genesis(force_genesis)?
        };

        let completed_genesis = if use_genesis {
            Some(self.bootstrap_genesis_connect(&identity).await?)
        } else if event_log_only_remote {
            self.connect_event_log_only_remote(&identity).await?;
            None
        } else if !content.trim().is_empty() {
            self.connect_existing_content(&identity, &content).await?;
            None
        } else {
            None
        };

        if use_genesis || remote_content_missing {
            self.flush_event_outbox().await?;
            let _ = self.status.tx.send("GITHUB_INIT_SUCCESS".to_owned());
        }

        self.purge_legacy_plaintext_search_catalog().await?;
        if let Err(error) = self.resume_pending_security_epoch_rotation(&identity).await {
            self.reset_vault_session_for_handoff_retry();
            return Err(error.into());
        }
        let records = VerifiedVaultAccessFlow::Connect
            .complete(
                self.get_records(),
                identity.device_id(),
                &self.vault.store_id,
            )
            .await?;
        let pending_cleanup = match match completed_genesis {
            Some(completed) => Ok(Some(completed)),
            None => PendingSimpleGenesis::load_for_store(&self.vault.store_id).await,
        } {
            Ok(pending) => pending,
            Err(error) => {
                self.reset_vault_session_for_handoff_retry();
                return Err(error.into());
            }
        };
        if let Err(error) = self
            .complete_connected_identity(&identity, pending_cleanup)
            .await
        {
            self.reset_vault_session_for_handoff_retry();
            return Err(error.into());
        }
        let _ = self.status.tx.send("READY".to_owned());
        tracing::info!(
            scope = "wasm-connect",
            storage = %storage_mode,
            genesis = use_genesis,
            secrets = records.len(),
            "connect complete"
        );
        Ok(records)
    }

    async fn complete_connected_identity(
        &mut self,
        identity: &nook_core::DeviceIdentity,
        pending_cleanup: Option<identity_record::PendingSimpleGenesis>,
    ) -> Result<(), NookError> {
        let staged_genesis = pending_cleanup
            .as_ref()
            .is_some_and(PendingSimpleGenesis::is_staged);
        if !staged_genesis {
            self.ensure_identity_after_connect(identity).await?;
        }
        self.finalize_existing_vault_import_handoff().await?;
        self.finalize_paired_vault_handoff().await?;
        let Some(completed) = pending_cleanup else {
            return Ok(());
        };
        let staged_handoff = completed.is_staged();
        let completion = if staged_handoff {
            SimpleGenesisCompletion::Staged {
                pending: &completed,
                signing_seed: self.event_log.signing_seed.as_str(),
            }
        } else {
            SimpleGenesisCompletion::Ordinary {
                pending: &completed,
            }
        };
        completion.clear_pending().await?;
        if staged_handoff {
            self.device.pending_extension_handoff = None;
        }
        Ok(())
    }

    /// Persist a first-class Identity after connect, synthesizing from vault auth when needed.
    pub(in crate::manager) async fn ensure_identity_after_connect(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<(), NookError> {
        if self.defers_identity_reconciliation_until_handoff() {
            return Ok(());
        }
        let label = match &self.vault.vault_name {
            VaultNameState::Named(name) if !name.trim().is_empty() => name.clone(),
            _ => "Personal".to_owned(),
        };
        if self.vault.store_id.is_empty() {
            let _ = identity_record::ensure_local_identity_for_app_key(identity, &label).await?;
            return Ok(());
        }
        let store_id = StoreId::parse(&self.vault.store_id)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let (key_epoch, committed_event_ids, checkpoint_ancestors, verified_previous_key_epoch) =
            if self.event_log.enabled {
                let key_epoch = self.ensure_key_epoch().await?;
                let checkpoint = self.ensure_causal_event_checkpoint().await?;
                let event_store = event_db::load_local_event_store(&self.vault.store_id).await?;
                let graph = event_store.load_graph(&self.vault.store_id)?;
                let checkpoint_event_id = EventId::parse(&checkpoint)
                    .map_err(|error| NookError::Database(error.to_string()))?;
                let ordered_event_ids = graph.topological_order()?;
                let key_epoch_event_id = EventId::parse(&key_epoch)
                    .map_err(|error| NookError::Database(error.to_string()))?;
                let verified_previous_key_epoch = graph
                    .get(&key_epoch_event_id)
                    .map(|event| event.body.key_epoch.clone())
                    .filter(|previous| previous != &key_epoch_event_id)
                    .map(|previous| IdentityVaultEventId::parse(previous.as_str()))
                    .transpose()
                    .map_err(|error| NookError::Database(error.to_string()))?;
                let committed_event_ids = ordered_event_ids
                    .iter()
                    .map(|event_id| IdentityVaultEventId::parse(event_id.as_str()))
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|error| NookError::Database(error.to_string()))?;
                let checkpoint_ancestors = ordered_event_ids
                    .iter()
                    .filter(|event_id| graph.is_ancestor(event_id, &checkpoint_event_id))
                    .map(|event_id| IdentityVaultEventId::parse(event_id.as_str()))
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|error| NookError::Database(error.to_string()))?;
                (
                    IdentityVaultDekEpoch::Known {
                        key_epoch: IdentityVaultEventId::parse(&key_epoch)
                            .map_err(|error| NookError::Database(error.to_string()))?,
                        checkpoint: IdentityVaultEventId::parse(&checkpoint)
                            .map_err(|error| NookError::Database(error.to_string()))?,
                    },
                    committed_event_ids,
                    checkpoint_ancestors,
                    verified_previous_key_epoch,
                )
            } else {
                (
                    IdentityVaultDekEpoch::LegacyUnknown,
                    Vec::new(),
                    Vec::new(),
                    None,
                )
            };
        if let Some(envelopes) = self.vault.meta.auth.get(&identity.auth_id()) {
            let authorized_auth_ids = if self.event_log.enabled {
                let store = load_local_event_store(store_id.as_str()).await?;
                let graph = store.load_graph(store_id.as_str())?;
                EventGraphAuthorizationProjection::new(&graph).active_auth_ids()?
            } else {
                self.vault.meta.auth.keys().cloned().collect()
            };
            let _ = identity_record::ensure_identity_from_legacy_vault(
                identity_record::LegacyVaultIdentityInput {
                    app_key: identity,
                    store_id: &store_id,
                    secrets_envelope: envelopes.secrets_key.clone(),
                    members_envelope: envelopes.members_key.clone(),
                    key_epoch,
                    verified_previous_key_epoch,
                    committed_event_ids,
                    checkpoint_ancestors,
                    authorized_auth_ids,
                    label: &label,
                },
            )
            .await?;
            return Ok(());
        }
        let _ = identity_record::ensure_local_identity_for_app_key(identity, &label).await?;
        Ok(())
    }

    async fn connect_existing_content(
        &mut self,
        identity: &nook_core::DeviceIdentity,
        content: &str,
    ) -> Result<(), JsError> {
        if self.event_log_has_events().await? || self.ensure_event_log_mode().await? {
            self.event_log.enabled = true;
            let cache = indexed_db::load_from_indexed_db()
                .await?
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| content.to_owned());
            match self.load_stored_vault_or_sentinel_ceremony(&cache, identity) {
                Ok(LoadedVault {
                    meta,
                    secrets_key,
                    members_key,
                    ..
                }) => {
                    self.apply_vault_keys(secrets_key.as_str(), members_key.as_str())?;
                    self.vault.meta = meta;
                    self.capture_vault_unlock(&cache)?;
                    self.sync_events_from_current_provider().await?;
                    self.apply_event_projection_to_session().await?;
                    Ok(())
                }
                Err(err) if err.requires_sentinel_ceremony() => {
                    self.prepare_sentinel_ceremony_session(&cache)?;
                    Err(err.into())
                }
                Err(err) => Err(err.into()),
            }
        } else {
            Err(NookError::Database("Vault event log is required.".to_owned()).into())
        }
    }

    async fn load_connect_content(&mut self) -> Result<(String, bool), NookError> {
        if self.storage.use_local_cache_for_connect {
            self.storage.use_local_cache_for_connect = false;
            let cached = load_vault_local_cache(&self.local_cache_ref())
                .await?
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    NookError::Database("No local vault copy is available to recover.".to_owned())
                })?;
            return Ok((cached, true));
        }

        if self.storage.mode != StorageMode::Local {
            self.sync_events_from_current_provider().await?;
            return Ok((String::new(), false));
        }

        let mut remote_content_missing = false;
        let content = self
            .fetch_vault_content(&mut remote_content_missing)
            .await?;
        Ok((content, remote_content_missing))
    }

    async fn bootstrap_genesis_connect(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<identity_record::PendingSimpleGenesis, NookError> {
        let pending = self
            .initialize_genesis_vault_with_identity(identity)
            .await?;
        if let Err(error) = self.bootstrap_simple_event_log_genesis(&pending).await {
            self.reset_vault_session();
            return Err(error);
        }
        self.maybe_sync_self_into_roster(identity)?;
        self.event_log.enabled = true;
        self.persist_projection_cache().await?;
        Ok(pending)
    }

    async fn discover_event_log_only_remote(
        &mut self,
        force_genesis: bool,
        content: &str,
    ) -> Result<bool, NookError> {
        if force_genesis || !content.trim().is_empty() || self.storage.mode == StorageMode::Local {
            return Ok(false);
        }
        self.sync_events_from_current_provider().await?;
        Ok(!self.vault.store_id.is_empty() && self.event_log_has_events().await?)
    }

    async fn connect_event_log_only_remote(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<(), NookError> {
        let records = self.stored_records_snapshot();
        match nook_core::assess_connect_access(&records, identity)? {
            ConnectAccessStatus::Ready => {}
            ConnectAccessStatus::JoinPending => {
                return Err(NookError::Database(
                    "Join request pending. An enrolled device must approve before you can connect. After approval, click Connect vault again.".to_owned(),
                ));
            }
            ConnectAccessStatus::NeedsEnrollment => {
                return Err(NookError::Database(
                    "This device is not enrolled yet. Request access from an enrolled device, then connect again.".to_owned(),
                ));
            }
        }
        let projection = self.serialize_current_projection_yaml()?;
        match self.load_stored_vault_or_sentinel_ceremony(&projection, identity) {
            Ok(loaded) => {
                let LoadedVault {
                    meta,
                    secrets_key,
                    members_key,
                } = loaded;
                self.apply_vault_keys(secrets_key.as_str(), members_key.as_str())?;
                self.vault.meta = meta;
                self.event_log.enabled = true;
                self.apply_event_projection_to_session().await?;
                self.persist_projection_cache().await?;
                let _ = self.status.tx.send("DECRYPT_SUCCESS".to_owned());
                Ok(())
            }
            Err(err) if err.requires_sentinel_ceremony() => {
                self.prepare_sentinel_ceremony_session(&projection)?;
                Err(err)
            }
            Err(err) => Err(err),
        }
    }
}
