use super::prepared_provider::{NextConnect, PreparedProvider, ProviderCacheRef};
use crate::ConfiguredVaultApplication;
use nook_core::{
    EventGraph, SentinelConfiguration, SentinelGenesisPhase, SentinelPolicy, StorageConnection,
    StorageMode, StoreId, StoredSecretRecord, VaultArchitecture, VaultMetaGraphProjection,
    VaultMetaState, VaultProjection, VaultSessionProjection, VaultType, VaultUnlock,
    VaultUserRecordBatch,
};

use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroize;

use crate::{NookError, NookEventLogSyncIssue};

/// The vault a provider import should open when the provider holds several.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(in crate::manager) enum ChosenProviderVault {
    #[default]
    Unchosen,
    Chosen(StoreId),
}

/// The storage of one session: what it reads and writes, the vault it opens
/// when the provider holds several, and where the next connect reads from.
#[derive(Default)]
pub(in crate::manager) struct StorageSession {
    pub(in crate::manager) provider: PreparedProvider,
    /// The vault to open when the prepared provider holds several.
    pub(in crate::manager) chosen_vault: ChosenProviderVault,
    pub(in crate::manager) next_connect: NextConnect,
}

impl StorageSession {
    pub(in crate::manager) fn mode(&self) -> StorageMode {
        self.provider.mode()
    }
}

pub(in crate::manager) enum VaultCryptoState {
    Locked,
    Unlocked(nook_core::VaultCrypto),
}

impl VaultCryptoState {
    pub(in crate::manager) fn get(&self) -> Result<&nook_core::VaultCrypto, NookError> {
        match self {
            Self::Unlocked(crypto) => Ok(crypto),
            Self::Locked => Err(NookError::Encryption(
                "Vault crypto not initialized.".to_owned(),
            )),
        }
    }

    pub(in crate::manager) fn is_unlocked(&self) -> bool {
        matches!(self, Self::Unlocked(..))
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "state", content = "name", rename_all = "camelCase")]
pub(in crate::manager) enum VaultNameState {
    Unnamed,
    Named(String),
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookVaultNameState {
    Unnamed,
    Named,
}

pub(in crate::manager) enum SearchCatalogState {
    Unavailable,
    Ready(nook_core::SecretSearchCatalog),
}

pub(in crate::manager) enum SearchCatalogRestore {
    Rebuild,
    Restored(nook_core::SecretSearchCatalog),
}

pub(in crate::manager) enum CeremonyState<T> {
    Inactive,
    Active(T),
}

pub(in crate::manager) enum EventLogSyncIssueState {
    Clear,
    Pending {
        provider_label: String,
        classification: nook_core::RemoteEventLogClassification,
    },
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookEventLogSyncIssueState {
    Clear,
    Pending,
}

#[wasm_bindgen]
pub struct NookEventLogSyncIssueResult(pub(in crate::manager) EventLogSyncIssueState);

#[wasm_bindgen]
impl NookEventLogSyncIssueResult {
    #[wasm_bindgen(getter)]
    pub fn state(&self) -> NookEventLogSyncIssueState {
        match self.0 {
            EventLogSyncIssueState::Clear => NookEventLogSyncIssueState::Clear,
            EventLogSyncIssueState::Pending { .. } => NookEventLogSyncIssueState::Pending,
        }
    }

    pub fn issue(&self) -> Result<crate::NookEventLogSyncIssue, JsError> {
        match &self.0 {
            EventLogSyncIssueState::Pending {
                provider_label,
                classification,
            } => Ok(NookEventLogSyncIssue::new(
                provider_label.clone(),
                classification.clone(),
            )),
            EventLogSyncIssueState::Clear => Err(JsError::new("No event-log sync issue.")),
        }
    }
}

impl<T> CeremonyState<T> {
    pub(in crate::manager) fn get(&self, message: &'static str) -> Result<&T, JsError> {
        match self {
            Self::Active(session) => Ok(session),
            Self::Inactive => Err(JsError::new(message)),
        }
    }
}

impl SearchCatalogState {
    pub(in crate::manager) fn get(&self) -> Result<&nook_core::SecretSearchCatalog, NookError> {
        match self {
            Self::Ready(catalog) => Ok(catalog),
            Self::Unavailable => Err(NookError::Database(
                "Secret search catalog is unavailable.".to_owned(),
            )),
        }
    }

    pub(in crate::manager) fn get_mut(
        &mut self,
    ) -> Result<&mut nook_core::SecretSearchCatalog, NookError> {
        match self {
            Self::Ready(catalog) => Ok(catalog),
            Self::Unavailable => Err(NookError::Database(
                "Secret search catalog is unavailable.".to_owned(),
            )),
        }
    }

    #[cfg(test)]
    pub(in crate::manager) fn is_ready(&self) -> bool {
        matches!(self, Self::Ready(..))
    }
}

pub(in crate::manager) struct VaultSessionState {
    pub(in crate::manager) projection: nook_core::VaultSessionProjection,
    pub(in crate::manager) secrets_key: String,
    pub(in crate::manager) members_key: String,
    pub(in crate::manager) crypto: VaultCryptoState,
    pub(in crate::manager) meta: nook_core::VaultMetaState,
    pub(in crate::manager) last_synced_content: String,
    pub(in crate::manager) unlock: nook_core::VaultUnlock,
    pub(in crate::manager) password_entries: Vec<nook_core::PasswordUnlockEntry>,
    pub(in crate::manager) store_id: String,
    pub(in crate::manager) vault_name: VaultNameState,
    /// The name the event log carries, still encrypted. Epoch rotation
    /// re-encrypts it; it never holds the "Vault <id>" display fallback.
    pub(in crate::manager) projected_name: nook_core::ProjectedVaultName,
    pub(in crate::manager) vault_version: u64,
    pub(in crate::manager) architecture: nook_core::VaultArchitecture,
    pub(in crate::manager) search_catalog: SearchCatalogState,
    pub(in crate::manager) search_catalog_store_id: String,
    pub(in crate::manager) search_catalog_dirty: bool,
    pub(in crate::manager) search_catalog_pending_bucket_mask: u64,
}

pub(in crate::manager) struct VaultSessionGraphProjection<'a> {
    pub(in crate::manager) graph: &'a EventGraph,
    pub(in crate::manager) store_id: &'a StoreId,
    pub(in crate::manager) architecture: &'a VaultArchitecture,
}

impl Default for VaultSessionState {
    fn default() -> Self {
        Self {
            projection: VaultSessionProjection::Unhydrated,
            secrets_key: String::new(),
            members_key: String::new(),
            crypto: VaultCryptoState::Locked,
            meta: VaultMetaState::default(),
            last_synced_content: String::new(),
            unlock: VaultUnlock::Keys,
            store_id: String::new(),
            vault_name: VaultNameState::Unnamed,
            projected_name: nook_core::ProjectedVaultName::Unnamed,
            vault_version: 0,
            architecture: VaultArchitecture::default(),
            search_catalog: SearchCatalogState::Unavailable,
            search_catalog_store_id: String::new(),
            search_catalog_dirty: true,
            search_catalog_pending_bucket_mask: 0,
        }
    }
}

/// Presence only; cryptographic validation and authorization remain at effects.
pub(in crate::manager) enum VaultKeyMaterial<'a> {
    Unavailable,
    Available { secrets: &'a str, members: &'a str },
}
pub(in crate::manager) enum SessionCatalogAvailability<'a> {
    UnavailableStore,
    Restore,
    Reconcile,
    Ready(&'a nook_core::SecretSearchCatalog),
}
impl VaultSessionState {
    /// Materialize an owned session before publishing it to the retained manager.
    pub(in crate::manager) fn from_event_graph(
        input: &VaultSessionGraphProjection<'_>,
    ) -> Result<Self, NookError> {
        let projection = VaultProjection::from_graph(input.graph, input.store_id.as_str())?;
        let records: Vec<StoredSecretRecord> =
            projection.live_secrets(input.graph).into_values().collect();
        let mut vault = Self {
            store_id: input.store_id.to_string(),
            architecture: input.architecture.clone(),
            password_entries: projection.password_entries,
            ..Self::default()
        };
        VaultUserRecordBatch::new(records).replace(&mut vault.meta);
        VaultMetaGraphProjection::new(input.graph).materialize(&mut vault.meta)?;
        if let SentinelConfiguration::Enabled(policy) =
            SentinelPolicy::from_share_records(&vault.meta)?
        {
            vault.architecture.vault_type = VaultType::Sentinel;
            vault.architecture.sentinel = SentinelConfiguration::Enabled(policy);
        }
        Ok(vault)
    }

    pub(in crate::manager) fn key_material(&self) -> VaultKeyMaterial<'_> {
        if self.secrets_key.is_empty() || self.members_key.is_empty() {
            VaultKeyMaterial::Unavailable
        } else {
            VaultKeyMaterial::Available {
                secrets: &self.secrets_key,
                members: &self.members_key,
            }
        }
    }
    pub(in crate::manager) fn catalog_availability(&self) -> SessionCatalogAvailability<'_> {
        if self.store_id.is_empty() {
            return SessionCatalogAvailability::UnavailableStore;
        }
        if self.search_catalog_store_id != self.store_id {
            return SessionCatalogAvailability::Restore;
        }
        match &self.search_catalog {
            SearchCatalogState::Unavailable => SessionCatalogAvailability::Restore,
            SearchCatalogState::Ready(_) if self.search_catalog_dirty => {
                SessionCatalogAvailability::Reconcile
            }
            SearchCatalogState::Ready(catalog) => SessionCatalogAvailability::Ready(catalog),
        }
    }
}

impl VaultSessionState {
    pub(in crate::manager) fn reset(&mut self) {
        let architecture = self.architecture.clone();
        self.secrets_key.zeroize();
        self.members_key.zeroize();
        self.crypto = VaultCryptoState::Locked;
        self.projection = VaultSessionProjection::Unhydrated;
        self.meta = VaultMetaState::default();
        self.last_synced_content.clear();
        self.unlock = VaultUnlock::Keys;
        self.password_entries.clear();
        self.store_id.clear();
        self.vault_name = VaultNameState::Unnamed;
        self.projected_name = nook_core::ProjectedVaultName::Unnamed;
        self.vault_version = 0;
        self.architecture = architecture;
        self.search_catalog = SearchCatalogState::Unavailable;
        self.search_catalog_store_id.clear();
        self.search_catalog_dirty = true;
        self.search_catalog_pending_bucket_mask = 0;
    }

    pub(in crate::manager) fn mark_search_catalog_dirty(&mut self) {
        self.search_catalog_dirty = true;
    }
}

#[derive(Clone, Default)]
pub(in crate::manager) enum LocalIdentityCreation {
    #[default]
    ExistingIdentity,
    Creating(String),
}

#[derive(Default)]
pub(in crate::manager) struct DeviceSessionState {
    pub(in crate::manager) id: String,
    pub(in crate::manager) identity_private_key: String,
    pub(in crate::manager) pending_local_identity_label: LocalIdentityCreation,
}

impl DeviceSessionState {
    pub(in crate::manager) fn public_app_id(&self) -> String {
        self.id.trim().to_owned()
    }
}

pub(in crate::manager) struct StatusChannel {
    pub(in crate::manager) tx: flume::Sender<String>,
    pub(in crate::manager) rx: flume::Receiver<String>,
}

impl StatusChannel {
    fn new() -> Self {
        let (tx, rx) = flume::unbounded();
        Self { tx, rx }
    }
}

#[derive(Default)]
pub(in crate::manager) struct EventLogSessionState {
    pub(in crate::manager) enabled: bool,
    pub(in crate::manager) signing_seed: String,
    pub(in crate::manager) key_epoch: String,
    pub(in crate::manager) heads: Vec<String>,
}

impl EventLogSessionState {
    pub(in crate::manager) fn reset(&mut self) {
        self.enabled = false;
        self.signing_seed.zeroize();
        self.key_epoch.zeroize();
        self.heads.clear();
    }
}

/// Where a session that keeps its vault in this browser also pushes new
/// events: nowhere, or the sync provider it last prepared.
#[derive(Default)]
pub(in crate::manager) enum SyncOutbox {
    #[default]
    Unbound,
    Bound(OutboxTarget),
}

/// The provider an outbox pushes to. Replacing the target drops its
/// connection, whose credential wipes itself.
pub(in crate::manager) struct OutboxTarget {
    /// Names the outbox rows.
    pub(in crate::manager) provider: ProviderCacheRef,
    pub(in crate::manager) connection: StorageConnection,
}

#[wasm_bindgen]
pub struct NookVaultManager {
    pub(in crate::manager) application: nook_core::VaultApplication,
    pub(in crate::manager) storage: StorageSession,
    pub(in crate::manager) vault: VaultSessionState,
    pub(in crate::manager) device: DeviceSessionState,
    pub(in crate::manager) status: StatusChannel,
    pub(in crate::manager) event_log: EventLogSessionState,
    pub(in crate::manager) sentinel_genesis: CeremonyState<nook_core::SentinelGenesisSession>,
    pub(in crate::manager) sentinel_genesis_phase: nook_core::SentinelGenesisPhase,
    pub(in crate::manager) pending_sentinel_genesis_request:
        CeremonyState<nook_core::SentinelGenesisRequest>,
    pub(in crate::manager) sentinel_unlock: CeremonyState<nook_core::SentinelUnlockSession>,
    pub(in crate::manager) sync_outbox: SyncOutbox,
    pub(in crate::manager) event_log_sync_issue: EventLogSyncIssueState,
}

impl Drop for NookVaultManager {
    fn drop(&mut self) {
        self.vault.reset();
        self.device.identity_private_key.zeroize();
        self.event_log.reset();
        self.sentinel_genesis = CeremonyState::Inactive;
        self.sentinel_genesis_phase = SentinelGenesisPhase::Inactive;
        self.pending_sentinel_genesis_request = CeremonyState::Inactive;
        self.sentinel_unlock = CeremonyState::Inactive;
        self.sync_outbox = SyncOutbox::Unbound;
        self.event_log_sync_issue = EventLogSyncIssueState::Clear;
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            application: ConfiguredVaultApplication::configured_vault_application(),
            storage: StorageSession::default(),
            vault: VaultSessionState::default(),
            device: DeviceSessionState::default(),
            status: StatusChannel::new(),
            event_log: EventLogSessionState::default(),
            sentinel_genesis: CeremonyState::Inactive,
            sentinel_genesis_phase: SentinelGenesisPhase::Inactive,
            pending_sentinel_genesis_request: CeremonyState::Inactive,
            sentinel_unlock: CeremonyState::Inactive,
            sync_outbox: SyncOutbox::Unbound,
            event_log_sync_issue: EventLogSyncIssueState::Clear,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn vault_crypto_state_distinguishes_locked_and_unlocked_sessions() -> Result<(), NookError> {
        let locked = VaultCryptoState::Locked;
        assert!(!locked.is_unlocked());
        assert!(matches!(
            locked.get(),
            Err(NookError::Encryption(message))
                if message == "Vault crypto not initialized."
        ));

        let keys = nook_core::VaultKeys::generate()?;
        let unlocked = VaultCryptoState::Unlocked(nook_core::VaultCrypto::new(&keys.secrets_key)?);
        assert!(unlocked.is_unlocked());
        assert!(unlocked.get().is_ok());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn ceremony_state_returns_active_sessions() -> Result<(), JsError> {
        let active = CeremonyState::Active(7_u8);
        assert_eq!(active.get("unused")?, &7);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn search_catalog_state_reports_readiness_and_mutability() -> Result<(), NookError> {
        let unavailable = SearchCatalogState::Unavailable;
        assert!(!unavailable.is_ready());
        assert!(matches!(
            unavailable.get(),
            Err(NookError::Database(message))
                if message == "Secret search catalog is unavailable."
        ));

        let mut ready = SearchCatalogState::Ready(nook_core::SecretSearchCatalog::default());
        assert!(ready.is_ready());
        assert!(ready.get().is_ok());
        assert!(ready.get_mut().is_ok());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn vault_session_reset_clears_sensitive_and_derived_state() {
        let mut state = VaultSessionState {
            secrets_key: "secrets".to_owned(),
            members_key: "members".to_owned(),
            last_synced_content: "content".to_owned(),
            ..VaultSessionState::default()
        };
        state.password_entries.push(nook_core::PasswordUnlockEntry {
            id: "password-entry".to_owned(),
            label: "Backup".to_owned(),
            created_at: "2026-09-06T00:00:00Z".to_owned(),
            envelope: nook_core::PasswordEnvelope {
                version: nook_core::PasswordEnvelopeVersion::LEGACY,
                kdf: "argon2id".to_owned(),
                work_factor: 3.into(),
                recipient: String::new(),
                wrapped_keys: String::new(),
                ciphertext: "AGE-ENCRYPTED-KEYS".to_owned(),
            },
        });
        state.store_id = "store_12345678".to_owned();
        state.vault_name = VaultNameState::Named("Vault".to_owned());
        state.vault_version = 4;
        state.search_catalog = SearchCatalogState::Ready(nook_core::SecretSearchCatalog::default());
        state.search_catalog_store_id = "catalog-store".to_owned();
        state.search_catalog_dirty = false;
        state.search_catalog_pending_bucket_mask = 0x42;
        state.reset();

        assert!(state.secrets_key.is_empty());
        assert!(state.members_key.is_empty());
        assert!(matches!(state.crypto, VaultCryptoState::Locked));
        assert!(state.last_synced_content.is_empty());
        assert!(matches!(state.unlock, VaultUnlock::Keys));
        assert!(state.password_entries.is_empty());
        assert!(state.store_id.is_empty());
        assert!(matches!(state.vault_name, VaultNameState::Unnamed));
        assert_eq!(state.vault_version, 0);
        assert!(!state.search_catalog.is_ready());
        assert!(state.search_catalog_store_id.is_empty());
        assert!(state.search_catalog_dirty);
        assert_eq!(state.search_catalog_pending_bucket_mask, 0);
    }

    #[wasm_bindgen_test]
    fn session_helpers_trim_public_ids_and_reset_outbox_state() -> anyhow::Result<()> {
        let mut device = DeviceSessionState {
            id: "  app-id  ".to_owned(),
            ..DeviceSessionState::default()
        };
        assert_eq!(device.public_app_id(), "app-id");
        device.id.clear();
        assert!(device.public_app_id().is_empty());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn status_channel_round_trips_messages() -> anyhow::Result<()> {
        let channel = StatusChannel::new();
        channel.tx.send("ready".to_owned())?;
        assert_eq!(channel.rx.recv()?, "ready");
        Ok(())
    }

    #[wasm_bindgen_test]
    fn event_log_reset_zeroizes_and_disables_state() {
        let mut state = EventLogSessionState {
            enabled: true,
            signing_seed: "signing".to_owned(),
            key_epoch: "epoch".to_owned(),
            heads: vec!["head".to_owned()],
        };
        state.reset();
        assert!(!state.enabled);
        assert!(state.signing_seed.is_empty());
        assert!(state.key_epoch.is_empty());
        assert!(state.heads.is_empty());
    }

    #[wasm_bindgen_test]
    fn sync_issue_result_exposes_clear_state() {
        let result = NookEventLogSyncIssueResult(EventLogSyncIssueState::Clear);
        assert_eq!(result.state(), NookEventLogSyncIssueState::Clear);
    }
}
