//! `NookVaultManager` — the session state object that crosses the
//! wasm-bindgen boundary.
//!
//! The struct lives here; its public methods are spread across topic-based
//! submodules so each file holds one coherent concern:
//!
//! - [`connect`] — `connect` / `connect_fresh` / `assess_vault_connect` /
//!   genesis initialisation.
//! - [`sync`] — `sync_vault_from_storage` (periodic poll, mode-aware).
//! - [`password`] — set / remove / verify / `connect_with_password`.
//! - [`multi_device`] — `init_device`, `list_pending_joins`,
//!   `list_vault_members`, request/approve/enroll flows.
//! - [`secrets`] — `add_secret` / `delete_secret`, search, password & id
//!   generation, `next_status`.
//!
//! Cross-cutting plumbing (`prepare_storage`, `fetch_vault_content`,
//! `ensure_event_log_ready`, device-identity helpers, vault-key application) stays
//! in this file because every submodule depends on it.

use crate::AuthProviderDatabase;
use crate::DriveStorageClient;
use crate::GitHubStorageClient;
use crate::LoggerState;
use crate::NookDatabase;
use crate::VaultMemberProjectionRequest;
use crate::storage::local_folder::LocalFolderHandles;
use crate::storage::{auth_providers, indexed_db};
use crate::{NookError, logger};
use nook_core::{
    DeviceIdentity, DeviceIdentitySecret, DriveEventParent, ICloudEventTarget, MultiDeviceError,
    SelfRosterSync, SentinelGenesisPhase, StorageMode, SymmetricKey, VaultCrypto, VaultNameRef,
    VaultStoreIdentityRef, VaultType, VaultUnlock, VaultVersionWrite, i18n_keys,
};
use nook_core::{EnsureSelfInRosterRequest, VaultMember, VaultMetaState};
use std::mem;
mod authenticator_enrollment;
mod authenticator_fill;
mod companion_pairing;
mod companion_protocol;
mod connect;
mod device_protection;
mod diagnostics;
mod event_log;
mod genesis;
mod identity;
mod identity_handoff;
mod local_identity;
mod login_fill;
mod login_save;
mod member_lifecycle;
mod multi_device;
mod passkeys;
mod password;
mod password_unlock;
mod search_catalog;
mod secrets;
mod sentinel;
mod session;
mod sync;
mod verified_access;

pub use companion_pairing::{
    NookCompanionPairingApprovalAuthority, NookCompanionPairingCandidateFailure,
    NookCompanionPairingCandidateOutcome, NookCompanionPairingCandidateOutcomeState,
    NookCompanionPairingExtensionEndpoint, NookPreparedCompanionPairingActivation,
    NookPrevalidatedCompanionPairingApproval, NookStoredCompanionPairingActivationCandidate,
};
pub use companion_protocol::{
    NookCompanionExtensionEndpoint, NookDiscoveredCompanionExtensionEndpoint,
    NookPendingCompanionIdentityHandoff, admit_companion_handoff_response,
    admit_companion_identity_status,
};
pub(crate) use device_protection::PendingExtensionIdentityEnrollment;
pub use device_protection::{
    NookAdoptedExtensionIdentityHandoff, NookCommittedExtensionIdentityHandoff,
    NookExtensionIdentityHandoffContext, NookPendingExtensionIdentityHandoff,
};
pub use secrets::{
    NookEventLogRecords, NookEventLogStorageRecord, NookExtensionEventLogImportStatus,
    NookExternalEventLogRecords,
};
pub use session::{NookEventLogSyncIssueResult, NookVaultManager, NookVaultNameState};
mod grant_authority;

pub(in crate::manager) use session::{
    CeremonyState, EventLogSessionState, EventLogSyncIssueState, SearchCatalogRestore,
    SearchCatalogState, StorageSession, SyncOutboxState, VaultCryptoState, VaultNameState,
    VaultSessionState,
};

use crate::{NookJoinRequest, NookSecretRecord, NookVaultArchitecture, NookVaultMember};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroize;

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen]
    pub fn take_event_log_sync_issue(&mut self) -> NookEventLogSyncIssueResult {
        NookEventLogSyncIssueResult(mem::replace(
            &mut self.event_log_sync_issue,
            EventLogSyncIssueState::Clear,
        ))
    }

    #[wasm_bindgen(getter)]
    pub fn storage_mode(&self) -> String {
        self.storage.mode.to_string()
    }

    #[wasm_bindgen(getter, js_name = vaultApplication)]
    pub fn vault_application(&self) -> nook_core::VaultApplication {
        self.application
    }

    #[wasm_bindgen(getter, js_name = vaultStoreId)]
    pub fn vault_store_id(&self) -> String {
        self.vault.store_id.clone()
    }

    #[wasm_bindgen(getter, js_name = vaultVersion)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the vault version to JavaScript as a bigint"
        )
    )]
    pub fn vault_version(&self) -> u64 {
        self.vault.vault_version
    }

    #[wasm_bindgen(getter, js_name = vaultArchitecture)]
    pub fn vault_architecture(&self) -> NookVaultArchitecture {
        NookVaultArchitecture::from_core(self.vault.architecture.clone())
    }

    #[wasm_bindgen]
    pub fn set_vault_architecture(
        &mut self,
        architecture: &NookVaultArchitecture,
    ) -> Result<(), JsError> {
        let architecture = architecture.to_core();
        architecture
            .validate()
            .map_err(|error| JsError::new(&error.to_string()))?;
        self.application
            .validate_session_access(architecture.vault_type)
            .map_err(|error| JsError::new(&error.to_string()))?;
        if !self.vault.store_id.is_empty() && architecture != self.vault.architecture {
            return Err(JsError::new(
                "Vault architecture is immutable after vault creation.",
            ));
        }
        architecture
            .validate_records(&self.stored_records_snapshot())
            .map_err(|error| JsError::new(&error.to_string()))?;
        self.vault.architecture = architecture;
        Ok(())
    }

    #[wasm_bindgen]
    pub fn can_create_secret_for_vault_architecture(&self) -> bool {
        self.vault
            .architecture
            .can_create_secret_with_records(&self.stored_records_snapshot())
    }

    #[wasm_bindgen(getter, js_name = vaultNameState)]
    pub fn vault_name_state(&self) -> NookVaultNameState {
        match &self.vault.vault_name {
            VaultNameState::Unnamed => NookVaultNameState::Unnamed,
            VaultNameState::Named(_) => NookVaultNameState::Named,
        }
    }

    #[wasm_bindgen(getter, js_name = vaultName)]
    pub fn vault_name(&self) -> Result<String, JsError> {
        match &self.vault.vault_name {
            VaultNameState::Unnamed => Err(JsError::new("vault is unnamed")),
            VaultNameState::Named(name) => Ok(name.clone()),
        }
    }

    #[wasm_bindgen]
    pub async fn set_vault_name(&mut self, name: &str) -> Result<(), JsError> {
        let previous_name = self.vault.vault_name.clone();
        let previous_projection = if self.vault.last_synced_content.trim().is_empty() {
            NookDatabase::load_from_indexed_db()
                .await
                .map_err(|error| JsError::new(&error.to_string()))?
                .ok_or_else(|| JsError::new("Vault projection is not initialized."))?
        } else {
            self.vault.last_synced_content.clone()
        };
        self.assign_vault_name(name);
        if let Err(error) = self.persist_vault_change(Vec::new()).await {
            self.vault.vault_name = previous_name;
            self.vault.last_synced_content = previous_projection.clone();
            if let Err(rollback_error) =
                NookDatabase::save_to_indexed_db(&previous_projection).await
            {
                return Err(JsError::new(&format!(
                    "{error}; vault-name rollback failed: {rollback_error}"
                )));
            }
            return Err(JsError::new(&error.to_string()));
        }
        Ok(())
    }

    fn assign_vault_name(&mut self, name: &str) {
        let trimmed = name.trim();
        self.vault.vault_name = if trimmed.is_empty() {
            VaultNameState::Unnamed
        } else {
            VaultNameState::Named(trimmed.to_owned())
        };
    }

    #[wasm_bindgen(getter)]
    pub fn device_id(&self) -> String {
        self.device.id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn device_public_key(&self) -> String {
        if self.device.identity_private_key.is_empty() {
            return String::new();
        }
        DeviceIdentitySecret::parse(&self.device.identity_private_key)
            .ok()
            .and_then(|secret| DeviceIdentity::from_secret_str(&secret).ok())
            .map(|identity| identity.public_key().as_str().to_owned())
            .unwrap_or_default()
    }

    /// GitHub repo (`owner/name`) or Google Drive file id, depending on mode.
    #[wasm_bindgen(getter)]
    pub fn storage_remote_ref(&self) -> String {
        self.storage.remote_ref.clone()
    }

    /// Drop in-memory vault session state when switching storage providers.
    /// Device identity and configured storage credentials are preserved.
    #[wasm_bindgen]
    pub fn reset_vault_session(&mut self) {
        self.vault.reset();
        self.storage.github_root_empty = false;
        self.storage.use_local_cache_for_connect = false;
        self.event_log.reset();
        self.sentinel_genesis = CeremonyState::Inactive;
        self.sentinel_genesis_phase = SentinelGenesisPhase::Inactive;
        self.pending_sentinel_genesis_request = CeremonyState::Inactive;
        self.sentinel_unlock = CeremonyState::Inactive;
        self.sync_outbox.reset();
    }

    /// Clear the failed vault session while retaining the staged signer that a
    /// verified extension handoff needs when the caller retries connect.
    pub(in crate::manager) fn reset_vault_session_for_handoff_retry(&mut self) {
        let handoff_signing_seed = self
            .device
            .pending_extension_handoff
            .as_ref()
            .map(|pending| pending.handoff_signing_seed.clone());
        self.reset_vault_session();
        if let Some(seed) = handoff_signing_seed {
            self.event_log.signing_seed = seed;
        }
    }

    /// Zeroize the active session and clear every Nook-owned browser database.
    /// Remote sync replicas and platform authenticator credentials are not touched.
    #[wasm_bindgen]
    pub async fn delete_local_browser_data(&mut self) -> Result<(), JsError> {
        self.reset_vault_session();
        self.storage.access_token.zeroize();
        self.storage = StorageSession::default();
        self.device.id.clear();
        self.device.identity_private_key.zeroize();
        self.device.extension_handoff_private_key.zeroize();

        let mut errors = Vec::new();
        if let Err(error) = LoggerState::clear_logs_db().await {
            errors.push(error.to_string());
        }
        if let Err(error) = LocalFolderHandles::current().clear().await {
            errors.push(error.to_string());
        }
        if let Err(error) = AuthProviderDatabase::clear_auth_providers_db().await {
            errors.push(error.to_string());
        }
        if let Err(error) = NookDatabase::clear_vault_db().await {
            errors.push(error.to_string());
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(JsError::new(&format!(
                "Could not clear all local browser databases: {}",
                errors.join("; ")
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::{VaultNameRef, VaultStoreIdentityRef, VaultVersionWrite};
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn vault_name_assignment_trims_and_clears_blank_values() {
        let mut manager = NookVaultManager::new();

        manager.assign_vault_name("  Personal  ");
        assert!(matches!(
            manager.vault.vault_name,
            VaultNameState::Named(ref name) if name == "Personal"
        ));

        manager.assign_vault_name(" \t ");
        assert!(matches!(manager.vault.vault_name, VaultNameState::Unnamed));
    }

    #[wasm_bindgen_test]
    fn device_public_key_projects_only_a_valid_identity() -> Result<(), NookError> {
        let mut manager = NookVaultManager::new();
        assert!(manager.device_public_key().is_empty());

        let identity = DeviceIdentity::generate()?;
        let expected = identity.public_key().as_str().to_owned();
        manager.device.identity_private_key = identity.secret_string().into_inner();
        assert_eq!(manager.device_public_key(), expected);

        manager.device.identity_private_key = "malformed".to_owned();
        assert!(manager.device_public_key().is_empty());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn reset_session_keeps_device_and_provider_configuration() -> Result<(), NookError> {
        let mut manager = NookVaultManager::new();
        let identity = DeviceIdentity::generate()?;
        manager.device.id = "device-stable".to_owned();
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.storage.access_token = "provider-token".to_owned();
        manager.storage.remote_ref = "owner/repo".to_owned();
        manager.storage.remote_path = "vault.yaml".to_owned();
        manager.storage.github_root_empty = true;
        manager.storage.use_local_cache_for_connect = true;
        manager.vault.store_id = "store_sessionreset1".to_owned();
        manager.sync_outbox.provider_id = "provider-cache".to_owned();

        manager.reset_vault_session();

        assert_eq!(manager.device.id, "device-stable");
        assert!(!manager.device.identity_private_key.is_empty());
        assert_eq!(manager.storage.access_token, "provider-token");
        assert_eq!(manager.storage.remote_ref, "owner/repo");
        assert_eq!(manager.storage.remote_path, "vault.yaml");
        assert!(!manager.storage.github_root_empty);
        assert!(!manager.storage.use_local_cache_for_connect);
        assert!(manager.vault.store_id.is_empty());
        assert!(manager.sync_outbox.provider_id.is_empty());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn projection_serialization_requires_a_store_identity() {
        let manager = NookVaultManager::new();
        assert!(matches!(
            manager.serialize_current_projection_yaml(),
            Err(NookError::Database(message)) if message == "Vault store id is not initialized."
        ));
    }

    #[wasm_bindgen_test]
    fn capture_unlock_adopts_metadata_and_version() -> Result<(), NookError> {
        let mut manager = NookVaultManager::new();
        let store_id = nook_core::StoreId::generate()?;
        let yaml = nook_core::VaultRecordSet::serialize_yaml_with_unlock_name_architecture(
            &[],
            &VaultUnlock::Keys,
            &[],
            VaultStoreIdentityRef::Assigned(store_id.as_str()),
            VaultNameRef::Named("Captured"),
            VaultVersionWrite::Initial,
            &manager.vault.architecture,
        )?
        .into_inner();

        manager.capture_vault_unlock(&yaml)?;

        assert_eq!(manager.vault.store_id, store_id.as_str());
        assert!(matches!(
            manager.vault.vault_name,
            VaultNameState::Named(ref name) if name == "Captured"
        ));
        assert!(matches!(manager.vault.unlock, VaultUnlock::Keys));
        assert_eq!(manager.vault.vault_version, 0);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn ensure_device_identity_requires_authorization() -> Result<(), NookError> {
        let mut manager = NookVaultManager::new();
        assert!(manager.ensure_device_identity().is_err());

        let identity = DeviceIdentity::generate()?;
        manager.device.identity_private_key = identity.secret_string().into_inner();
        assert_eq!(
            manager.ensure_device_identity()?.device_id(),
            identity.device_id()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn local_cache_reference_tracks_provider_mode_and_path() {
        let mut manager = NookVaultManager::new();
        manager.storage.mode = StorageMode::Github;
        manager.storage.remote_ref = "owner/repo".to_owned();
        manager.storage.remote_path = "vault.yaml".to_owned();
        assert_eq!(
            manager.local_cache_ref(),
            StorageMode::Github.cache_ref("owner/repo", "vault.yaml")
        );
    }

    #[wasm_bindgen_test]
    fn stored_snapshot_and_genesis_requirement_follow_current_records() -> Result<(), NookError> {
        let manager = NookVaultManager::new();
        assert!(manager.stored_records_snapshot().is_empty());
        assert!(manager.needs_genesis_persist()?);
        Ok(())
    }
}

// ---- Cross-cutting private helpers ----------------------------------------
//
// These are called from multiple submodules of `manager` and therefore live
// here at the parent. Visibility is `pub(in crate::manager)` so the
// submodules can call them without leaking into the rest of the crate.

impl NookVaultManager {
    pub(crate) fn query_secret_page(
        &self,
        query: &str,
        secret_type_filter: nook_core::SecretTypeFilter,
        offset: u32,
        limit: u32,
    ) -> Result<nook_core::SecretPage, NookError> {
        let crypto = self.vault.crypto.get()?;
        let offset = usize::try_from(offset).unwrap_or(usize::MAX);
        let limit = usize::try_from(limit).unwrap_or(nook_core::DEFAULT_SECRET_PAGE_SIZE);
        if let session::SessionCatalogAvailability::Ready(catalog) =
            self.vault.catalog_availability()
        {
            return Ok(catalog.query(query, secret_type_filter, offset.into(), limit.into()));
        }
        Ok(
            nook_core::VaultSecretSession::new(&self.vault.meta.secrets, crypto).query(
                query,
                secret_type_filter,
                offset.into(),
                limit.into(),
            )?,
        )
    }

    /// Typed secret list for the active decrypted session.
    pub(crate) fn get_records(&self) -> Result<Vec<NookSecretRecord>, NookError> {
        let crypto = self.vault.crypto.get()?;
        NookSecretRecord::records_to_vec(
            self.vault
                .meta
                .secrets
                .keys()
                .map(|id| {
                    nook_core::VaultSecretSession::new(&self.vault.meta.secrets, crypto)
                        .decrypt(id)
                        .map_err(NookError::from)
                })
                .collect::<Result<Vec<_>, _>>()?,
        )
    }

    pub(crate) fn pending_joins(&self) -> Result<Vec<NookJoinRequest>, NookError> {
        NookJoinRequest::pending_joins_to_vec(&self.stored_records_snapshot())
    }

    pub(crate) fn vault_members(&self) -> Result<Vec<NookVaultMember>, NookError> {
        let roster = NookVaultMember::vault_members_to_vec(VaultMemberProjectionRequest {
            records: &self.stored_records_snapshot(),
            members_key: &self.vault.members_key,
        })?;
        if roster.len() >= self.vault.meta.enrolled_devices.len() {
            return Ok(roster);
        }
        let mut enrolled = Vec::new();
        for join in self.vault.meta.enrolled_devices.values() {
            enrolled.push(VaultMember::member_from_join(join)?);
        }
        Ok(NookVaultMember::members_to_vec(enrolled))
    }

    pub(in crate::manager) fn serialize_current_projection_yaml(
        &self,
    ) -> Result<String, NookError> {
        if self.vault.store_id.is_empty() {
            return Err(NookError::Database(
                "Vault store id is not initialized.".to_owned(),
            ));
        }
        let records = self.vault.meta.to_stored_records();
        Ok(
            nook_core::VaultRecordSet::serialize_yaml_with_unlock_name_architecture(
                &records,
                &self.vault.unlock,
                &self.vault.password_entries,
                VaultStoreIdentityRef::Assigned(self.vault.store_id.as_str()),
                match &self.vault.vault_name {
                    VaultNameState::Unnamed => VaultNameRef::Unnamed,
                    VaultNameState::Named(name) => VaultNameRef::Named(name),
                },
                VaultVersionWrite::Initial,
                &self.vault.architecture,
            )?
            .into_inner(),
        )
    }

    pub(in crate::manager) fn local_cache_ref(&self) -> String {
        self.storage
            .mode
            .cache_ref(&self.storage.remote_ref, &self.storage.remote_path)
    }

    pub(crate) fn device_identity(&self) -> Result<nook_core::DeviceIdentity, NookError> {
        Ok(DeviceIdentity::from_secret_str(
            &DeviceIdentitySecret::parse(&self.device.identity_private_key)?,
        )?)
    }

    #[cfg(all(test, target_arch = "wasm32"))]
    pub(crate) fn set_test_device_identity(&mut self, identity: &nook_core::DeviceIdentity) {
        self.device.id = identity.device_id().as_str().to_owned();
        self.device.identity_private_key = identity.secret_string().into_inner();
    }

    /// Pull the active unlock mode from a freshly-accepted vault YAML and
    /// stash it in session state.
    ///
    /// Callers should only invoke this with content they intend to adopt
    /// as the new authoritative state (e.g. after the first connect or
    /// after `sync_vault_from_storage` confirms the remote content
    /// differs from our last saved snapshot). Calling on every poll
    /// blindly is unsafe: GitHub is eventually-consistent, so a poll can
    /// race with our own write and return the pre-write YAML, which
    /// would clobber a freshly-set password envelope back to keys mode.
    pub(in crate::manager) fn capture_vault_unlock(
        &mut self,
        content: &str,
    ) -> Result<(), NookError> {
        let metadata = nook_core::VaultContent::new(content).capture_unlock()?;
        self.application
            .validate_session_access(metadata.architecture.vault_type)?;
        self.vault.unlock = metadata.unlock;
        self.vault.password_entries = metadata.password_entries;
        self.vault.store_id = metadata.store_id;
        self.vault.vault_name = VaultNameState::Named(metadata.vault_name);
        self.vault.vault_version = metadata.version.into();
        self.vault.architecture = metadata.architecture;
        Ok(())
    }

    pub(in crate::manager) fn apply_vault_keys(
        &mut self,
        secrets_key: &str,
        members_key: &str,
    ) -> Result<(), NookError> {
        self.vault.secrets_key = secrets_key.to_owned();
        self.vault.members_key = members_key.to_owned();
        let parsed_secrets = SymmetricKey::parse(secrets_key)?;
        self.vault.crypto = VaultCryptoState::Unlocked(VaultCrypto::new(&parsed_secrets)?);
        Ok(())
    }

    pub(in crate::manager) fn clear_vault_keys(&mut self) {
        self.vault.secrets_key.zeroize();
        self.vault.members_key.zeroize();
        self.vault.crypto = VaultCryptoState::Locked;
    }

    /// Restore `VaultCrypto` from the local projection-cache YAML when the in-memory
    /// session lost it (for example after switching sync providers).
    pub(in crate::manager) async fn ensure_vault_crypto_from_cache(
        &mut self,
    ) -> Result<(), NookError> {
        if self.vault.crypto.is_unlocked() {
            return Ok(());
        }
        if self.vault.architecture.vault_type == VaultType::Sentinel {
            return Err(MultiDeviceError::SentinelCeremonyRequired.into());
        }
        let identity = self.ensure_device_identity()?;
        if !self.vault.last_synced_content.trim().is_empty() {
            let (secrets_key, members_key) =
                nook_core::VaultProjectionCache::new(&self.vault.last_synced_content)
                    .unlock(&identity)?;
            self.apply_vault_keys(&secrets_key, &members_key)?;
            return Ok(());
        }
        if let Some(cache) = NookDatabase::load_from_indexed_db().await?
            && !cache.trim().is_empty()
        {
            let (secrets_key, members_key) =
                nook_core::VaultProjectionCache::new(&cache).unlock(&identity)?;
            self.apply_vault_keys(&secrets_key, &members_key)?;
            self.vault.last_synced_content = cache;
            return Ok(());
        }
        Err(NookError::Encryption(
            "Vault crypto not initialized.".to_owned(),
        ))
    }

    pub(in crate::manager) fn maybe_sync_self_into_roster(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<(), NookError> {
        let records = self.stored_records_snapshot();
        let members_key = self.vault.members_key.clone();
        if let SelfRosterSync::Updated(member_records) =
            VaultMetaState::ensure_self_in_roster(EnsureSelfInRosterRequest {
                records: &records,
                identity: identity,
                members_key: &SymmetricKey::parse(&members_key)?,
            })?
        {
            self.vault.meta.replace_member_records(&member_records)?;
        }
        Ok(())
    }

    /// Repair an empty device roster when this browser holds vault keys but no
    /// `members:` rows (event-log projection does not replay roster entries).
    pub(in crate::manager) async fn ensure_vault_roster_hydrated(
        &mut self,
    ) -> Result<bool, NookError> {
        if self.vault.members_key.is_empty() {
            let _ = self.ensure_vault_crypto_from_cache().await;
        }
        if self.vault.members_key.is_empty() {
            return Ok(false);
        }
        let identity = self.device_identity()?;
        let before = self.vault_members().map_or(0, |members| members.len());
        self.maybe_sync_self_into_roster(&identity)?;
        let after = self.vault_members().map_or(0, |members| members.len());
        if after > before {
            self.persist_projection_cache().await?;
            return Ok(true);
        }
        Ok(false)
    }

    pub(in crate::manager) fn stored_records_snapshot(&self) -> Vec<nook_core::StoredSecretRecord> {
        self.vault.meta.to_stored_records()
    }

    pub(in crate::manager) fn needs_genesis_persist(&self) -> Result<bool, NookError> {
        Ok(
            !nook_core::VaultRecordView::new(&self.stored_records_snapshot())
                .has_multi_device_records()?,
        )
    }

    pub(in crate::manager) async fn prepare_storage(
        &mut self,
        storage_mode: &str,
        github_pat: &str,
        github_repo_name: &str,
    ) -> Result<(), NookError> {
        // Parse the incoming tag once at the boundary so the rest of the
        // method pattern-matches on `StorageMode` instead of comparing
        // strings.
        let mode = StorageMode::parse(storage_mode)?;
        let previous_mode = self.storage.mode;
        let previous_remote_ref = self.storage.remote_ref.clone();
        self.storage.mode = mode;

        match mode {
            StorageMode::Local => {
                self.storage.access_token = String::new();
                self.storage.drive_event_parent = DriveEventParent::AppDataFolder;
                self.storage.icloud_event_target = ICloudEventTarget::Private;
            }
            StorageMode::Github => {
                self.storage.access_token = nook_core::GithubPat::parse(github_pat)?.to_string();
                let repo_name = nook_core::GithubRepoName::parse(github_repo_name)?;
                let _ = self.status.tx.send("GITHUB_USER_FETCH".to_owned());
                let username = GitHubStorageClient::new(&self.storage.access_token)
                    .fetch_github_username()
                    .await?;
                let new_repo = format!("{}/{}", username, repo_name);
                if self.storage.remote_ref != new_repo {
                    self.storage.github_root_empty = false;
                }
                self.storage.remote_ref = new_repo;
                self.storage.remote_path.clear();
                self.storage.drive_event_parent = DriveEventParent::AppDataFolder;
                self.storage.icloud_event_target = ICloudEventTarget::Private;
                let _ = self.status.tx.send("GITHUB_REPO_ENSURE".to_owned());
                GitHubStorageClient::new(&self.storage.access_token)
                    .ensure_github_repo_exists(&self.storage.remote_ref)
                    .await?;
            }
            StorageMode::GoogleDrive => {
                self.storage.access_token =
                    nook_core::OauthAccessToken::parse(github_pat)?.to_string();
                let (known_file_id, file_name) =
                    nook_core::DriveBackupName::parse_storage_ref(github_repo_name)?;
                self.storage.drive_event_parent = DriveEventParent::from_storage_id(&known_file_id);
                self.storage.remote_path = file_name.to_string();
                let _ = self.status.tx.send("DRIVE_VERIFY".to_owned());
                DriveStorageClient::new(&self.storage.access_token)
                    .verify_drive_access()
                    .await?;
                // Personal: optional vault yaml file id. Shared: folder id for events.
                self.storage.remote_ref = match &self.storage.drive_event_parent {
                    DriveEventParent::SharedFolder { folder_id } => folder_id.clone(),
                    DriveEventParent::AppDataFolder => known_file_id,
                };
                self.storage.icloud_event_target = ICloudEventTarget::Private;
            }
            StorageMode::ICloud => {
                self.storage.access_token =
                    nook_core::OauthAccessToken::parse(github_pat)?.to_string();
                let (known_target, file_name) =
                    nook_core::DriveBackupName::parse_storage_ref(github_repo_name)?;
                self.storage.remote_path = file_name.to_string();
                self.storage.icloud_event_target =
                    ICloudEventTarget::from_storage_id(&known_target)?;
                self.storage.remote_ref = if known_target.is_empty() {
                    file_name.to_string()
                } else {
                    known_target
                };
                self.storage.drive_event_parent = DriveEventParent::AppDataFolder;
            }
        }

        if previous_mode != self.storage.mode || previous_remote_ref != self.storage.remote_ref {
            self.vault.password_entries.clear();
            self.vault.unlock = VaultUnlock::Keys;
            self.vault.vault_name = VaultNameState::Unnamed;
        }

        if mode != StorageMode::Local {
            self.sync_outbox.provider_id = self.local_cache_ref();
            self.sync_outbox.storage_mode = mode;
            self.sync_outbox.access_token = self.storage.access_token.clone();
            self.sync_outbox.repo_arg = github_repo_name.to_owned();
        }

        Ok(())
    }

    pub(in crate::manager) async fn prepare_storage_preserving_vault_metadata(
        &mut self,
        storage_mode: &str,
        github_pat: &str,
        github_repo_name: &str,
    ) -> Result<(), NookError> {
        let password_entries = self.vault.password_entries.clone();
        let unlock = self.vault.unlock.clone();
        let vault_name = self.vault.vault_name.clone();
        self.prepare_storage(storage_mode, github_pat, github_repo_name)
            .await?;
        self.vault.password_entries = password_entries;
        self.vault.unlock = unlock;
        self.vault.vault_name = vault_name;
        Ok(())
    }

    pub(in crate::manager) fn ensure_device_identity(
        &mut self,
    ) -> Result<nook_core::DeviceIdentity, NookError> {
        if self.device.identity_private_key.is_empty() {
            return Err(NookError::Decryption(
                i18n_keys::ERRORS_DEVICE_PROTECTION_AUTHORIZATION_REQUIRED.to_owned(),
            ));
        }
        self.device_identity()
    }

    pub(in crate::manager) async fn fetch_vault_content(
        &mut self,
        remote_content_missing: &mut bool,
    ) -> Result<String, NookError> {
        let content = match self.storage.mode {
            StorageMode::Local => {
                let _ = self.status.tx.send("IDB_LOAD_START".to_owned());
                let stored = NookDatabase::load_from_indexed_db().await?;
                let _ = self.status.tx.send("IDB_LOAD_SUCCESS".to_owned());
                stored.unwrap_or_default()
            }
            StorageMode::Github | StorageMode::GoogleDrive | StorageMode::ICloud => {
                *remote_content_missing = true;
                String::new()
            }
        };
        Ok(content)
    }
}
