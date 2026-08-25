use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroize;

use crate::NookError;

pub(in crate::manager) struct StorageSession {
    pub(in crate::manager) mode: nook_core::StorageMode,
    pub(in crate::manager) access_token: String,
    pub(in crate::manager) remote_ref: String,
    pub(in crate::manager) remote_path: String,
    pub(in crate::manager) drive_event_parent: nook_core::DriveEventParent,
    pub(in crate::manager) icloud_event_target: nook_core::ICloudEventTarget,
    pub(in crate::manager) github_root_empty: bool,
    pub(in crate::manager) use_local_cache_for_connect: bool,
}

impl Default for StorageSession {
    fn default() -> Self {
        Self {
            mode: nook_core::StorageMode::Local,
            access_token: String::new(),
            remote_ref: String::new(),
            remote_path: String::new(),
            drive_event_parent: nook_core::DriveEventParent::AppDataFolder,
            icloud_event_target: nook_core::ICloudEventTarget::Private,
            github_root_empty: false,
            use_local_cache_for_connect: false,
        }
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
            } => Ok(crate::NookEventLogSyncIssue::new(
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

    pub(in crate::manager) fn get_mut(&mut self, message: &'static str) -> Result<&mut T, JsError> {
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

    pub(in crate::manager) fn is_ready(&self) -> bool {
        matches!(self, Self::Ready(..))
    }
}

pub(in crate::manager) struct VaultSessionState {
    pub(in crate::manager) secrets_key: String,
    pub(in crate::manager) members_key: String,
    pub(in crate::manager) crypto: VaultCryptoState,
    pub(in crate::manager) meta: nook_core::VaultMetaState,
    pub(in crate::manager) last_synced_content: String,
    pub(in crate::manager) unlock: nook_core::VaultUnlock,
    pub(in crate::manager) password_entries: Vec<nook_core::PasswordUnlockEntry>,
    pub(in crate::manager) store_id: String,
    pub(in crate::manager) vault_name: VaultNameState,
    pub(in crate::manager) vault_version: u64,
    pub(in crate::manager) architecture: nook_core::VaultArchitecture,
    pub(in crate::manager) search_catalog: SearchCatalogState,
    pub(in crate::manager) search_catalog_store_id: String,
    pub(in crate::manager) search_catalog_dirty: bool,
    pub(in crate::manager) search_catalog_pending_bucket_mask: u64,
}

impl Default for VaultSessionState {
    fn default() -> Self {
        Self {
            secrets_key: String::new(),
            members_key: String::new(),
            crypto: VaultCryptoState::Locked,
            meta: nook_core::VaultMetaState::default(),
            last_synced_content: String::new(),
            unlock: nook_core::VaultUnlock::Keys,
            password_entries: Vec::new(),
            store_id: String::new(),
            vault_name: VaultNameState::Unnamed,
            vault_version: 0,
            architecture: nook_core::VaultArchitecture::default(),
            search_catalog: SearchCatalogState::Unavailable,
            search_catalog_store_id: String::new(),
            search_catalog_dirty: true,
            search_catalog_pending_bucket_mask: 0,
        }
    }
}

impl VaultSessionState {
    pub(in crate::manager) fn reset(&mut self) {
        let architecture = self.architecture.clone();
        self.secrets_key.zeroize();
        self.members_key.zeroize();
        self.crypto = VaultCryptoState::Locked;
        self.meta = nook_core::VaultMetaState::default();
        self.last_synced_content.clear();
        self.unlock = nook_core::VaultUnlock::Keys;
        self.password_entries.clear();
        self.store_id.clear();
        self.vault_name = VaultNameState::Unnamed;
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

#[derive(Default)]
pub(in crate::manager) struct DeviceSessionState {
    pub(in crate::manager) id: String,
    pub(in crate::manager) identity_private_key: String,
    pub(in crate::manager) extension_handoff_private_key: String,
    pub(in crate::manager) pending_extension_handoff:
        Option<super::device_protection::PendingExtensionIdentityHandoff>,
    pub(in crate::manager) pending_local_identity_label: Option<String>,
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

pub(in crate::manager) struct SyncOutboxState {
    pub(in crate::manager) provider_id: String,
    pub(in crate::manager) storage_mode: nook_core::StorageMode,
    pub(in crate::manager) access_token: String,
    pub(in crate::manager) repo_arg: String,
}

impl Default for SyncOutboxState {
    fn default() -> Self {
        Self {
            provider_id: String::new(),
            storage_mode: nook_core::StorageMode::Local,
            access_token: String::new(),
            repo_arg: String::new(),
        }
    }
}

impl SyncOutboxState {
    pub(in crate::manager) fn reset(&mut self) {
        self.provider_id.clear();
        self.storage_mode = nook_core::StorageMode::Local;
        self.access_token.zeroize();
        self.repo_arg.clear();
    }
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
    pub(in crate::manager) sync_outbox: SyncOutboxState,
    pub(in crate::manager) event_log_sync_issue: EventLogSyncIssueState,
}

impl Drop for NookVaultManager {
    fn drop(&mut self) {
        self.storage.access_token.zeroize();
        self.vault.reset();
        self.device.identity_private_key.zeroize();
        self.device.extension_handoff_private_key.zeroize();
        self.event_log.reset();
        self.sentinel_genesis = CeremonyState::Inactive;
        self.sentinel_genesis_phase = nook_core::SentinelGenesisPhase::Inactive;
        self.pending_sentinel_genesis_request = CeremonyState::Inactive;
        self.sentinel_unlock = CeremonyState::Inactive;
        self.sync_outbox.reset();
        self.event_log_sync_issue = EventLogSyncIssueState::Clear;
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            application: crate::application::configured_vault_application(),
            storage: StorageSession::default(),
            vault: VaultSessionState::default(),
            device: DeviceSessionState::default(),
            status: StatusChannel::new(),
            event_log: EventLogSessionState::default(),
            sentinel_genesis: CeremonyState::Inactive,
            sentinel_genesis_phase: nook_core::SentinelGenesisPhase::Inactive,
            pending_sentinel_genesis_request: CeremonyState::Inactive,
            sentinel_unlock: CeremonyState::Inactive,
            sync_outbox: SyncOutboxState::default(),
            event_log_sync_issue: EventLogSyncIssueState::Clear,
        }
    }
}
