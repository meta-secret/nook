//! `NookVaultManager` — the session state object that crosses the
//! wasm-bindgen boundary.
//!
//! The struct lives here; its public methods are spread across topic-based
//! submodules so each file holds one coherent concern:
//!
//! - [`connect`] — `connect` / `connect_fresh` / `assess_vault_connect` /
//!   genesis initialisation.
//! - [`sync`] — `sync_vault_from_storage` (periodic poll, mode-aware).
//! - [`multi_device`] — `init_device`, `list_pending_joins`,
//!   `list_vault_members`, request/approve/enroll flows.
//! - [`secrets`] — `add_secret` / `delete_secret`, search, password & id
//!   generation, `next_status`.
//!
//! Cross-cutting plumbing (`prepare_storage`, `fetch_vault_content`,
//! `ensure_event_log_ready`, device-identity helpers, vault-key application) stays
//! in this file because every submodule depends on it.

use crate::VaultSnapshotLookup;

use crate::AuthProviderDatabase;
use crate::LoggerState;
use crate::NookDatabase;
use crate::NookError;
use crate::VaultMemberProjectionRequest;
use crate::storage::local_folder::LocalFolderHandles;
use nook_core::{
    DeviceIdentity, DeviceIdentitySecret, MultiDeviceError, SelfRosterSync, SentinelGenesisPhase,
    StorageConnection, StorageMode, SymmetricKey, VaultCrypto, VaultNameRef,
    VaultSessionProjection, VaultStoreIdentityRef, VaultType, VaultVersionWrite, i18n_keys,
};
use nook_core::{EnsureSelfInRosterRequest, VaultMetaState, VaultOperation};
use std::mem;
mod access_check;
mod authenticator_enrollment;
mod authenticator_fill;
mod companion_pairing;
mod connect;
mod device_protection;
mod diagnostics;
mod event_log;
mod genesis;
mod identity;
mod identity_control;
mod local_identity;
mod login_fill;
mod login_save;
mod member_lifecycle;
mod multi_device;
mod passkeys;
mod personal_fill;
mod prepared_provider;
mod remote_vault_choice;
mod search_catalog;
mod secrets;
mod self_enrollment;
mod sentinel;
mod session;
mod site_secret_listing;
mod sync;
mod verified_access;

pub use companion_pairing::{
    NookCompanionPairingApprovalAuthority, NookCompanionPairingCandidateFailure,
    NookCompanionPairingCandidateOutcome, NookCompanionPairingCandidateOutcomeState,
    NookCompanionPairingExtensionEndpoint, NookPreparedCompanionPairingActivation,
    NookPrevalidatedCompanionPairingApproval, NookStoredCompanionPairingActivationCandidate,
};
pub use secrets::{
    NookEventLogRecords, NookEventLogStorageRecord, NookExtensionEventLogImportStatus,
    NookExternalEventLogRecords,
};
pub use sentinel::NookSentinelStoredDeliveriesRequest;
pub use session::{NookEventLogSyncIssueResult, NookVaultManager, NookVaultNameState};
mod grant_authority;

#[cfg(test)]
pub(in crate::manager) use prepared_provider::ProviderCacheRef;
pub(in crate::manager) use prepared_provider::{
    NextConnect, PreparedProvider, PreparedRemote, ProviderPreparation, ProviderSwitch,
};
pub(in crate::manager) use session::{
    CeremonyState, ChosenProviderVault, EventLogSessionState, EventLogSyncIssueState, OutboxTarget,
    SearchCatalogRestore, SearchCatalogState, StorageSession, SyncOutbox, VaultCryptoState,
    VaultNameState, VaultSessionState,
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
        self.storage.mode().to_string()
    }

    #[wasm_bindgen(getter, js_name = vaultApplication)]
    pub fn vault_application(&self) -> nook_core::VaultApplication {
        self.application
    }

    #[wasm_bindgen(getter, js_name = vaultStoreId)]
    pub fn vault_store_id(&self) -> String {
        self.vault.store_id.clone()
    }

    #[wasm_bindgen(getter, js_name = vaultStoreIdPresence)]
    pub fn vault_store_id_presence(&self) -> Result<crate::NookStoreIdPresence, JsError> {
        crate::NookStoreIdPresence::from_raw(&self.vault.store_id)
            .map_err(|error| JsError::new(&error.to_string()))
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

    /// Name the open vault for every member: the name is recorded in the
    /// vault event log, encrypted under the vault key, and projected back.
    #[wasm_bindgen]
    pub async fn set_vault_name(&mut self, name: &str) -> Result<(), JsError> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(JsError::new("Vault name cannot be empty."));
        }
        self.ensure_vault_crypto_from_cache().await?;
        let ciphertext = self.vault.crypto.get()?.encrypt_value(trimmed)?;
        self.persist_vault_change(vec![VaultOperation::VaultNamed {
            name: nook_core::OpaqueCiphertext::from_trusted(ciphertext.as_str().to_owned()),
        }])
        .await?;
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

    /// Drop in-memory vault session state when switching storage providers.
    /// Device identity and configured storage credentials are preserved.
    #[wasm_bindgen]
    pub fn reset_vault_session(&mut self) {
        self.vault.reset();
        self.storage.next_connect = NextConnect::FromProvider;
        self.event_log.reset();
        self.sentinel_genesis = CeremonyState::Inactive;
        self.sentinel_genesis_phase = SentinelGenesisPhase::Inactive;
        self.pending_sentinel_genesis_request = CeremonyState::Inactive;
        self.sentinel_unlock = CeremonyState::Inactive;
        self.sync_outbox = SyncOutbox::Unbound;
    }

    /// Zeroize the active session and clear every Nook-owned browser database.
    /// Remote sync replicas and platform authenticator credentials are not touched.
    #[wasm_bindgen]
    pub async fn delete_local_browser_data(&mut self) -> Result<(), JsError> {
        self.reset_vault_session();
        // Replacing the session drops the prepared provider, whose
        // credential wipes itself.
        self.storage = StorageSession::default();
        self.device.id.clear();
        self.device.identity_private_key.zeroize();

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
            enrolled.push(NookVaultMember::from_enrolled_join(join)?);
        }
        Ok(enrolled)
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
            nook_core::VaultRecordSet::serialize_yaml_with_name_architecture(
                &records,
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
        self.storage.provider.cache_ref().as_str().to_owned()
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

    /// Pull the vault metadata from a freshly-accepted vault YAML and stash
    /// it in session state.
    ///
    /// Callers should only invoke this with content they intend to adopt
    /// as the new authoritative state (e.g. after the first connect or
    /// after `sync_vault_from_storage` confirms the remote content
    /// differs from our last saved snapshot). Calling on every poll
    /// blindly is unsafe: GitHub is eventually-consistent, so a poll can
    /// race with our own write and return the pre-write YAML, which
    /// would clobber freshly-written metadata.
    pub(in crate::manager) fn capture_vault_metadata(
        &mut self,
        content: &str,
    ) -> Result<(), NookError> {
        let metadata = nook_core::VaultContent::new(content).capture_metadata()?;
        self.application
            .validate_session_access(metadata.architecture.vault_type)?;
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
        self.vault.projection = VaultSessionProjection::Unhydrated;
        self.vault.secrets_key = secrets_key.to_owned();
        self.vault.members_key = members_key.to_owned();
        let parsed_secrets = SymmetricKey::parse(secrets_key)?;
        self.vault.crypto = VaultCryptoState::Unlocked(VaultCrypto::new(&parsed_secrets)?);
        Ok(())
    }

    pub(in crate::manager) fn clear_vault_keys(&mut self) {
        self.vault.projection = VaultSessionProjection::Unhydrated;
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
        if let VaultSnapshotLookup::Stored(cache) = NookDatabase::load_from_indexed_db().await?
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
                identity,
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
            drop(self.ensure_vault_crypto_from_cache().await);
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

    /// Prepare one connection as the session's storage. The prepared
    /// provider is assigned once, so a failed prepare keeps the previous one;
    /// the provider it replaces drops, and its credential wipes itself.
    pub(in crate::manager) async fn prepare_storage(
        &mut self,
        connection: &StorageConnection,
    ) -> Result<(), NookError> {
        let prepared = PreparedProvider::prepare(ProviderPreparation {
            connection,
            status: &self.status.tx,
        })
        .await?;
        let previous = mem::replace(&mut self.storage.provider, prepared);
        if let ProviderSwitch::OtherStorage = previous
            .cache_ref()
            .switch_to(&self.storage.provider.cache_ref())
        {
            self.vault.vault_name = VaultNameState::Unnamed;
        }
        if let PreparedProvider::Remote(remote) = &self.storage.provider {
            self.sync_outbox = SyncOutbox::Bound(OutboxTarget {
                provider: remote.cache_ref(),
                connection: connection.clone(),
            });
        }
        Ok(())
    }

    pub(in crate::manager) async fn prepare_storage_preserving_vault_metadata(
        &mut self,
        connection: &StorageConnection,
    ) -> Result<(), NookError> {
        let vault_name = self.vault.vault_name.clone();
        self.prepare_storage(connection).await?;
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
        let content = match self.storage.mode() {
            StorageMode::Local => {
                drop(self.status.tx.send("IDB_LOAD_START".to_owned()));
                let stored = NookDatabase::load_from_indexed_db().await?;
                drop(self.status.tx.send("IDB_LOAD_SUCCESS".to_owned()));
                match stored {
                    VaultSnapshotLookup::Stored(content) => content,
                    VaultSnapshotLookup::NotStored => String::new(),
                }
            }
            StorageMode::Github
            | StorageMode::GoogleDrive
            | StorageMode::ICloud
            | StorageMode::S3 => {
                *remote_content_missing = true;
                String::new()
            }
        };
        Ok(content)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures::WasmFixture;
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
    fn reset_session_keeps_device_and_provider_configuration() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        let identity = DeviceIdentity::generate()?;
        manager.device.id = "device-stable".to_owned();
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.storage.provider =
            PreparedProvider::github_fixture("provider-token", "owner/repo")?;
        manager.storage.next_connect = NextConnect::FromLocalCache;
        manager.vault.store_id = "store_sessionreset1".to_owned();
        manager.sync_outbox = SyncOutbox::Bound(OutboxTarget {
            provider: manager.storage.provider.cache_ref(),
            connection: StorageConnection::Local,
        });

        manager.reset_vault_session();

        assert_eq!(manager.device.id, "device-stable");
        assert!(!manager.device.identity_private_key.is_empty());
        assert_eq!(manager.local_cache_ref(), "github:owner/repo:");
        assert_eq!(manager.storage.next_connect, NextConnect::FromProvider);
        assert!(manager.vault.store_id.is_empty());
        assert!(matches!(manager.sync_outbox, SyncOutbox::Unbound));
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
    fn capture_metadata_adopts_metadata_and_version() -> Result<(), NookError> {
        let mut manager = NookVaultManager::new();
        let store_id = nook_core::StoreId::generate()?;
        let yaml = nook_core::VaultRecordSet::serialize_yaml_with_name_architecture(
            &[],
            VaultStoreIdentityRef::Assigned(store_id.as_str()),
            VaultNameRef::Named("Captured"),
            VaultVersionWrite::Initial,
            &manager.vault.architecture,
        )?
        .into_inner();

        manager.capture_vault_metadata(&yaml)?;

        assert_eq!(manager.vault.store_id, store_id.as_str());
        assert!(matches!(
            manager.vault.vault_name,
            VaultNameState::Named(ref name) if name == "Captured"
        ));
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
    /// The cache names stay the ones this browser has always stored under.
    fn local_cache_reference_names_each_prepared_storage() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        assert_eq!(manager.local_cache_ref(), "local");
        manager.storage.provider = PreparedProvider::github_fixture("token", "owner/repo")?;
        assert_eq!(manager.local_cache_ref(), "github:owner/repo:");
        manager.storage.provider = PreparedProvider::drive_fixture("token", "folder-a")?;
        assert_eq!(manager.local_cache_ref(), "drive:folder-a");
        manager.storage.provider = PreparedProvider::drive_fixture("token", "folder-b")?;
        assert_eq!(manager.local_cache_ref(), "drive:folder-b");
        manager.storage.provider = PreparedProvider::s3_fixture(WasmFixture::s3_connection()?);
        assert_eq!(
            manager.local_cache_ref(),
            "s3:http://127.0.0.1:8333/nook-dev/e2e"
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn s3_storage_is_prepared_from_its_connection_alone() -> anyhow::Result<()> {
        let connection = StorageConnection::S3 {
            connection: WasmFixture::s3_connection()?,
        };
        let mut manager = NookVaultManager::new();
        // Preparing S3 reads nothing yet: the first request signs with the key.
        manager
            .prepare_storage(&connection)
            .await
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        assert_eq!(manager.storage.mode(), StorageMode::S3);
        // The cache and the outbox name the location, never the key.
        assert_eq!(
            manager.local_cache_ref(),
            "s3:http://127.0.0.1:8333/nook-dev/e2e"
        );
        let SyncOutbox::Bound(target) = &manager.sync_outbox else {
            anyhow::bail!("preparing a provider binds the outbox");
        };
        assert_eq!(target.provider.as_str(), manager.local_cache_ref());
        assert_eq!(target.connection, connection);
        assert!(!manager.local_cache_ref().contains("device-a"));

        manager
            .prepare_storage(&StorageConnection::Local)
            .await
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        assert!(matches!(
            manager.storage.provider,
            PreparedProvider::ThisBrowser
        ));
        // A local session keeps pushing to the provider it last prepared.
        assert!(matches!(manager.sync_outbox, SyncOutbox::Bound(_)));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn moving_to_other_storage_resets_vault_metadata_unless_preserved() -> anyhow::Result<()>
    {
        let s3 = StorageConnection::S3 {
            connection: WasmFixture::s3_connection()?,
        };
        let mut manager = NookVaultManager::new();
        manager.vault.vault_name = VaultNameState::Named("Kept".to_owned());
        manager
            .prepare_storage_preserving_vault_metadata(&s3)
            .await
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        assert!(matches!(&manager.vault.vault_name, VaultNameState::Named(name) if name == "Kept"));
        // The same storage again is no move.
        manager
            .prepare_storage(&s3)
            .await
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        assert!(matches!(&manager.vault.vault_name, VaultNameState::Named(name) if name == "Kept"));
        manager
            .prepare_storage(&StorageConnection::Local)
            .await
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        assert!(matches!(manager.vault.vault_name, VaultNameState::Unnamed));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg(feature = "browser-wasm-tests")]
    async fn a_malformed_event_reaches_no_prepared_provider() -> anyhow::Result<()> {
        use crate::storage::fetch_stub::FetchStub;
        let mut manager = NookVaultManager::new();
        manager.storage.provider = PreparedProvider::s3_fixture(WasmFixture::s3_connection()?);
        manager.vault.store_id = nook_core::StoreId::generate()?.as_str().to_owned();
        let stub = FetchStub::install(Vec::new()).map_err(|error| anyhow::anyhow!("{error}"))?;
        let event_id = nook_core::EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        match manager
            .put_current_provider_event_if_absent(&event_id, b"not an event")
            .await
        {
            Err(NookError::Serialization(message)) => {
                assert!(message.starts_with("S3 event parse:"));
            }
            Err(_) => anyhow::bail!("unexpected refusal"),
            Ok(()) => anyhow::bail!("a malformed event was written"),
        }
        assert!(stub.calls().is_empty());
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg(feature = "browser-wasm-tests")]
    async fn a_failed_prepare_keeps_the_previous_provider() -> anyhow::Result<()> {
        use crate::storage::fetch_stub::{FetchRoute, FetchStub};
        let mut manager = NookVaultManager::new();
        manager.storage.provider = PreparedProvider::s3_fixture(WasmFixture::s3_connection()?);
        let _stub =
            FetchStub::install(vec![FetchRoute::failing("GET", "api.github.com/user", 401)])
                .map_err(|error| anyhow::anyhow!("{error}"))?;
        let github = WasmFixture::github_connection("rejected-token", "repo")?;
        assert!(manager.prepare_storage(&github).await.is_err());
        assert_eq!(manager.storage.mode(), StorageMode::S3);
        assert_eq!(
            manager.local_cache_ref(),
            "s3:http://127.0.0.1:8333/nook-dev/e2e"
        );
        Ok(())
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
