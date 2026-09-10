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

mod identity_completion;

use super::verified_access::VerifiedVaultAccessFlow;
use super::{NookVaultManager, VaultNameState};
use crate::IdentityDbEnsureLocalIdentityForAppKey;
use crate::NookDatabase;
use crate::VaultSnapshotLookup;
use crate::conversion::LoadedVault;
use crate::manager::device_protection::ExtensionIdentityPublication;
use crate::storage::identity_record::AuthorizerSigningUpdate;
use crate::storage::identity_record::IdentityDirectoryWrite;
use crate::storage::identity_record::SimpleGenesisProgress;
use crate::storage::identity_record::VerifiedPreviousEpoch;
#[cfg(test)]
use nook_core::AppKeyIdentityMembership;
use nook_core::MemberLabelState;
use nook_core::{DirectoryOwnedVaultOpening, IdentityCreation, IdentityVaultKeyOpening};

use crate::storage::identity_record::{PendingSimpleGenesis, SimpleGenesisCompletion};

use crate::storage::{event_db, identity_record, indexed_db};
use crate::{NookError, NookSecretRecord};
use nook_core::{AssessConnectAccessRequest, VaultMetaState};
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
    use crate::storage::identity_record::IdentityDirectoryWrite;
    use crate::storage::identity_record::SimpleGenesisProgress;

    use nook_core::{DirectoryOwnedVaultOpening, IdentityCreation, IdentityVaultKeyOpening};

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

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
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
        NookDatabase::clear_identity_directory_for_test().await?;
        let authorizer = AppKey::generate()?;
        let extension = AppKey::generate()?;
        let store_id = nook_core::StoreId::generate()?;
        let owner_key = authorizer.clone();
        let owner_store = store_id.clone();
        NookDatabase::update_identity_directory(move |mut directory| {
            let resolved_identity = directory
                .create_identity(IdentityCreation {
                    label: "Personal",
                    app_key: &owner_key,
                    member_label: MemberLabelState::Unnamed,
                })
                .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
            directory = resolved_identity.directory;
            let owner_id = resolved_identity.identity_id;
            let opened_identity = directory
                .open_or_generate_vault_dek_for_identity(DirectoryOwnedVaultOpening {
                    identity_id: &owner_id,
                    vault: IdentityVaultKeyOpening {
                        app_key: &owner_key,
                        store_id: owner_store,
                    },
                })
                .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
            directory = opened_identity.directory;
            Ok(IdentityDirectoryWrite::from(directory))
        })
        .await?;

        let (signing, signing_seed) = SigningIdentity::generate()?;
        let mut manager = NookVaultManager::new();
        manager.device.id = extension.device_id().as_str().to_owned();
        manager.device.identity_private_key = extension.secret_string().into_inner();
        manager.vault.store_id = store_id.to_string();
        manager.device.pending_extension_handoff =
            ExtensionIdentityPublication::Staged(PendingExtensionIdentityHandoff {
                enrollment: PendingExtensionIdentityEnrollment::PairedVault {
                    authorizer,
                    store_id,
                },
                authorizer_signing: AuthorizerSigningUpdate::RetainMembership,
                signing_public_key: signing.public_key(),
                handoff_signing_seed: signing_seed.as_str().to_owned(),
                persist_signing_seed: false,
                previous_session_signing_seed: String::new(),
            });
        assert!(manager.extension_identity_handoff_requires_connect());

        manager.ensure_identity_after_connect(&extension).await?;
        let deferred = NookDatabase::load_identity_directory().await?;
        assert_eq!(
            deferred.identity_for_app_key(&extension)?,
            AppKeyIdentityMembership::Unenrolled
        );

        manager
            .complete_connected_identity(&extension, SimpleGenesisProgress::NotPending)
            .await?;
        let committed = NookDatabase::load_identity_directory().await?;
        assert!(matches!(
            committed.identity_for_app_key(&extension)?,
            AppKeyIdentityMembership::Enrolled(_)
        ));
        assert!(matches!(
            &manager.device.pending_extension_handoff,
            ExtensionIdentityPublication::Idle
        ));
        NookDatabase::clear_identity_directory_for_test().await?;
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
        manager.device.pending_extension_handoff =
            ExtensionIdentityPublication::Staged(PendingExtensionIdentityHandoff {
                enrollment: PendingExtensionIdentityEnrollment::PairedVault {
                    authorizer: AppKey::generate()?,
                    store_id: staged_store_id,
                },
                authorizer_signing: AuthorizerSigningUpdate::RetainMembership,
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
        assert!(matches!(
            &manager.device.pending_extension_handoff,
            ExtensionIdentityPublication::Staged(_)
        ));
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
        manager.device.pending_extension_handoff =
            ExtensionIdentityPublication::Staged(PendingExtensionIdentityHandoff {
                enrollment: PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock {
                    store_id,
                },
                authorizer_signing: AuthorizerSigningUpdate::RetainMembership,
                signing_public_key: signing.public_key(),
                handoff_signing_seed: signing_seed.as_str().to_owned(),
                persist_signing_seed: false,
                previous_session_signing_seed: String::new(),
            });

        manager.finalize_paired_vault_handoff().await?;

        assert!(matches!(
            &manager.device.pending_extension_handoff,
            ExtensionIdentityPublication::Idle
        ));
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
                .any(|record| matches!(
                    (record).classify(),
                    Ok(nook_core::VaultMetaRecord::Auth(..))
                ))
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
                .any(|record| matches!(
                    (record).classify(),
                    Ok(nook_core::VaultMetaRecord::Auth(..))
                ))
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
                let status = VaultAccessStatus::from(VaultMetaState::assess_connect_access(
                    AssessConnectAccessRequest {
                        records: &self.stored_records_snapshot(),
                        identity: &identity,
                    },
                )?);
                let _ = self
                    .status
                    .tx
                    .send(format!("ASSESS_{}_{}", self.storage.mode, status));
                return Ok(status);
            }
            if let VaultSnapshotLookup::Stored(cached) =
                NookDatabase::load_vault_local_cache(&self.local_cache_ref()).await?
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
            VaultAccessStatus::from(VaultMetaState::assess_connect_access(
                AssessConnectAccessRequest {
                    records: &self.stored_records_snapshot(),
                    identity: &identity,
                },
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
        self.connect_internal(
            storage_mode,
            github_pat,
            github_repo,
            nook_core::VaultGenesisIntent::DetectExisting,
        )
        .await
    }

    /// Replace storage with a fresh genesis vault for this device.
    pub async fn connect_fresh(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        self.connect_internal(
            storage_mode,
            github_pat,
            github_repo,
            nook_core::VaultGenesisIntent::ForceFresh,
        )
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
        genesis_intent: nook_core::VaultGenesisIntent,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status.tx.send("CONNECT_START".to_owned());
        tracing::info!(
            scope = "wasm-connect",
            storage = %storage_mode,
            force_genesis = matches!(genesis_intent, nook_core::VaultGenesisIntent::ForceFresh),
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
            .discover_event_log_only_remote(genesis_intent, &content)
            .await?;

        let use_genesis = if event_log_only_remote {
            false
        } else {
            nook_core::VaultContent::new(&content).requires_genesis(genesis_intent)?
        };

        let completed_genesis = if use_genesis {
            SimpleGenesisProgress::Pending(self.bootstrap_genesis_connect(&identity).await?)
        } else if event_log_only_remote {
            self.connect_event_log_only_remote(&identity).await?;
            SimpleGenesisProgress::NotPending
        } else if !content.trim().is_empty() {
            self.connect_existing_content(&identity, &content).await?;
            SimpleGenesisProgress::NotPending
        } else {
            SimpleGenesisProgress::NotPending
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
            SimpleGenesisProgress::Pending(completed) => {
                Ok(SimpleGenesisProgress::Pending(completed))
            }
            SimpleGenesisProgress::NotPending => {
                PendingSimpleGenesis::load_for_store(&self.vault.store_id).await
            }
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

    async fn connect_existing_content(
        &mut self,
        identity: &nook_core::DeviceIdentity,
        content: &str,
    ) -> Result<(), JsError> {
        if self.event_log_has_events().await? || self.ensure_event_log_mode().await? {
            self.event_log.enabled = true;
            let cache = match NookDatabase::load_from_indexed_db().await? {
                VaultSnapshotLookup::Stored(cache) if !cache.trim().is_empty() => cache,
                VaultSnapshotLookup::Stored(_) | VaultSnapshotLookup::NotStored => {
                    content.to_owned()
                }
            };
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
            let cached = match NookDatabase::load_vault_local_cache(&self.local_cache_ref()).await?
            {
                VaultSnapshotLookup::Stored(cache) if !cache.trim().is_empty() => cache,
                VaultSnapshotLookup::Stored(_) | VaultSnapshotLookup::NotStored => {
                    return Err(NookError::Database(
                        "No local vault copy is available to recover.".to_owned(),
                    ));
                }
            };
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
        genesis_intent: nook_core::VaultGenesisIntent,
        content: &str,
    ) -> Result<bool, NookError> {
        if matches!(genesis_intent, nook_core::VaultGenesisIntent::ForceFresh)
            || !content.trim().is_empty()
            || self.storage.mode == StorageMode::Local
        {
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
        match VaultMetaState::assess_connect_access(AssessConnectAccessRequest {
            records: &records,
            identity: identity,
        })? {
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
