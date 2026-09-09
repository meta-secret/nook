//! Read-only dashboard projection for browser device and vault access metadata.

mod passkey_metadata;
use crate::IdentityDbSaveNewProtectedLocalIdentity;
use crate::storage::device_access::DeviceAccessProfileKey;
use crate::{NookDatabase, SaveVaultBlobRequest};
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
use nook_core::DeviceIdentityProtection;
use nook_core::{
    AppId, DeviceAccessProtectionKind, PasskeyAuthenticatorAttachment, PasskeyBackupState, StoreId,
};
pub use passkey_metadata::{NookPasskeyAttachmentState, NookPasskeyBackupState};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::storage::device_access::{
    DeviceAccessProfile, PasskeyAccessProfile, PasskeyCreatedAtEvidence, PasskeyLastUsedAtEvidence,
};
use crate::storage::{device_access, indexed_db};

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookDeviceAccessTextKind {
    Unknown,
    Known,
}

#[derive(Clone)]
enum NookDeviceAccessTextValue {
    Unknown,
    Known(String),
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookDeviceAccessText(NookDeviceAccessTextValue);

impl NookDeviceAccessText {
    fn from_string(value: String) -> Self {
        if value.is_empty() {
            Self(NookDeviceAccessTextValue::Unknown)
        } else {
            Self(NookDeviceAccessTextValue::Known(value))
        }
    }

    fn from_option(value: Option<String>) -> Self {
        value.map_or_else(
            || Self(NookDeviceAccessTextValue::Unknown),
            Self::from_string,
        )
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookPasskeyTimestampEvidenceKind {
    Unavailable,
    NotYetObserved,
    Known,
}

#[derive(Clone)]
enum NookPasskeyTimestampEvidenceValue {
    Unavailable,
    NotYetObserved,
    Known(String),
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasskeyTimestampEvidence(NookPasskeyTimestampEvidenceValue);

impl NookPasskeyTimestampEvidence {
    fn from_created(value: device_access::PasskeyCreatedAtEvidence) -> Self {
        match value {
            PasskeyCreatedAtEvidence::Unavailable => {
                Self(NookPasskeyTimestampEvidenceValue::Unavailable)
            }
            PasskeyCreatedAtEvidence::Known { timestamp } => Self(
                NookPasskeyTimestampEvidenceValue::Known(timestamp.to_string()),
            ),
        }
    }

    fn from_last_used(value: device_access::PasskeyLastUsedAtEvidence) -> Self {
        match value {
            PasskeyLastUsedAtEvidence::NotYetObserved => {
                Self(NookPasskeyTimestampEvidenceValue::NotYetObserved)
            }
            PasskeyLastUsedAtEvidence::Unavailable => {
                Self(NookPasskeyTimestampEvidenceValue::Unavailable)
            }
            PasskeyLastUsedAtEvidence::Known { timestamp } => Self(
                NookPasskeyTimestampEvidenceValue::Known(timestamp.to_string()),
            ),
        }
    }
}

#[wasm_bindgen]
impl NookPasskeyTimestampEvidence {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn kind(&self) -> NookPasskeyTimestampEvidenceKind {
        match self.0 {
            NookPasskeyTimestampEvidenceValue::Unavailable => {
                NookPasskeyTimestampEvidenceKind::Unavailable
            }
            NookPasskeyTimestampEvidenceValue::NotYetObserved => {
                NookPasskeyTimestampEvidenceKind::NotYetObserved
            }
            NookPasskeyTimestampEvidenceValue::Known(_) => NookPasskeyTimestampEvidenceKind::Known,
        }
    }

    pub fn value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            NookPasskeyTimestampEvidenceValue::Known(value) => Ok(value.clone()),
            NookPasskeyTimestampEvidenceValue::Unavailable
            | NookPasskeyTimestampEvidenceValue::NotYetObserved => {
                Err(JsError::new("Passkey timestamp evidence is unavailable"))
            }
        }
    }
}

#[wasm_bindgen]
impl NookDeviceAccessText {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn kind(&self) -> NookDeviceAccessTextKind {
        match self.0 {
            NookDeviceAccessTextValue::Unknown => NookDeviceAccessTextKind::Unknown,
            NookDeviceAccessTextValue::Known(_) => NookDeviceAccessTextKind::Known,
        }
    }

    pub fn value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            NookDeviceAccessTextValue::Unknown => {
                Err(JsError::new("Device access value is unknown"))
            }
            NookDeviceAccessTextValue::Known(value) => Ok(value.clone()),
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookDeviceVaultAccessState {
    Unknown,
    Verified,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasskeyTransport {
    kind: nook_core::PasskeyTransport,
}

#[wasm_bindgen]
impl NookPasskeyTransport {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn kind(&self) -> nook_core::PasskeyTransport {
        self.kind
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookDeviceVaultAccess {
    store_id: String,
    label: String,
    last_local_update_at: NookDeviceAccessText,
    verified_at: NookDeviceAccessText,
}

struct LocalAccessProfile {
    app_id: String,
    profile: device_access::DeviceAccessProfile,
}

#[wasm_bindgen]
/// Named values required by NookDeviceVaultAccess::vaults_for_identity.
pub(crate) struct BrowserVaultsForIdentity<'a> {
    pub(crate) vaults: &'a [NookDeviceVaultAccess],
    pub(crate) identity: &'a nook_core::IdentityRecord,
}

/// Named values required by NookDeviceVaultAccess::device_vault_access_for_identity.
pub(crate) struct BrowserDeviceVaultAccessForIdentity<'a> {
    pub(crate) identity: &'a nook_core::IdentityRecord,
    pub(crate) local_app_ids: &'a [nook_core::AppId],
    pub(crate) session_app_id: &'a str,
}

/// Named values required by NookDeviceVaultAccess::vault_access_rows.
pub(crate) struct BrowserVaultAccessRows<'a> {
    pub(crate) registry: Vec<indexed_db::VaultRegistryEntry>,
    pub(crate) profiles: &'a [LocalAccessProfile],
    pub(crate) identity: Option<&'a nook_core::IdentityRecord>,
}

impl NookDeviceVaultAccess {
    #[wasm_bindgen(getter, js_name = storeId)]
    pub fn store_id(&self) -> String {
        self.store_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    #[wasm_bindgen(getter, js_name = accessState)]
    #[must_use]
    pub fn access_state(&self) -> NookDeviceVaultAccessState {
        match self.verified_at.kind() {
            NookDeviceAccessTextKind::Unknown => NookDeviceVaultAccessState::Unknown,
            NookDeviceAccessTextKind::Known => NookDeviceVaultAccessState::Verified,
        }
    }

    #[wasm_bindgen(getter, js_name = verifiedAt)]
    pub fn verified_at(&self) -> NookDeviceAccessText {
        self.verified_at.clone()
    }

    #[wasm_bindgen(getter, js_name = lastLocalUpdateAt)]
    pub fn last_local_update_at(&self) -> NookDeviceAccessText {
        self.last_local_update_at.clone()
    }
}

#[wasm_bindgen]
pub struct NookDeviceAccessSnapshotRequest {
    session_device_id: String,
    session_unlocked: bool,
}

impl NookDeviceAccessSnapshotRequest {
    pub(crate) fn new(session_device_id: String, session_unlocked: bool) -> Self {
        Self {
            session_device_id,
            session_unlocked,
        }
    }
}

#[wasm_bindgen]
impl NookDeviceAccessSnapshotRequest {
    /// Resolve the browser-backed projection without retaining a borrow of the
    /// live vault manager across `IndexedDB` work.
    pub async fn resolve(&self) -> Result<NookDeviceAccessSnapshot, wasm_bindgen::JsError> {
        NookDeviceAccessSnapshot::device_access_snapshot_for_session(
            BrowserDeviceAccessSnapshotForSession {
                session_device_id: &self.session_device_id,
                session_unlocked: self.session_unlocked,
            },
        )
        .await
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookDeviceAccessSnapshot {
    protection: nook_core::DeviceAccessProtectionKind,
    identity_state: nook_core::DeviceAccessIdentityState,
    device_id: NookDeviceAccessText,
    credential_id: NookDeviceAccessText,
    user_handle_id: NookDeviceAccessText,
    passkey_name: NookDeviceAccessText,
    provider_label: NookDeviceAccessText,
    created_at: NookPasskeyTimestampEvidence,
    last_used_at: NookPasskeyTimestampEvidence,
    attachment: NookPasskeyAttachmentState,
    transports: Vec<NookPasskeyTransport>,
    backup_state: NookPasskeyBackupState,
    aaguid: NookDeviceAccessText,
    keeper: nook_core::PasskeyKeeperKind,
    observed_browser: nook_core::PasskeyObservedBrowser,
    observed_platform: nook_core::PasskeyObservedPlatform,
    vaults: Vec<NookDeviceVaultAccess>,
}

#[cfg(test)]
impl NookDeviceVaultAccess {
    fn vaults_for_identity(request: BrowserVaultsForIdentity<'_>) -> Vec<NookDeviceVaultAccess> {
        let BrowserVaultsForIdentity { vaults, identity } = request;
        vaults
            .iter()
            .filter(|vault| {
                StoreId::parse(&vault.store_id).is_ok_and(|store_id| identity.owns_vault(&store_id))
            })
            .cloned()
            .collect()
    }
}

#[wasm_bindgen]
/// Named values required by NookDeviceAccessSnapshot::device_access_snapshot_for_session.
pub(crate) struct BrowserDeviceAccessSnapshotForSession<'a> {
    pub(crate) session_device_id: &'a str,
    pub(crate) session_unlocked: bool,
}

/// Named values required by NookDeviceAccessSnapshot::device_access_snapshot_for_session_with_protected.
pub(crate) struct BrowserDeviceAccessSnapshotForSessionWithProtected<'a> {
    pub(crate) session_device_id: &'a str,
    pub(crate) session_unlocked: bool,
    pub(crate) protected: Option<(String, nook_core::WrappedDeviceIdentity)>,
}

impl NookDeviceAccessSnapshot {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn protection(&self) -> nook_core::DeviceAccessProtectionKind {
        self.protection
    }

    #[wasm_bindgen(getter, js_name = identityState)]
    #[must_use]
    pub fn identity_state(&self) -> nook_core::DeviceAccessIdentityState {
        self.identity_state
    }

    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> NookDeviceAccessText {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter, js_name = credentialId)]
    pub fn credential_id(&self) -> NookDeviceAccessText {
        self.credential_id.clone()
    }

    #[wasm_bindgen(getter, js_name = userHandleId)]
    pub fn user_handle_id(&self) -> NookDeviceAccessText {
        self.user_handle_id.clone()
    }

    #[wasm_bindgen(getter, js_name = passkeyName)]
    pub fn passkey_name(&self) -> NookDeviceAccessText {
        self.passkey_name.clone()
    }

    #[wasm_bindgen(getter, js_name = providerLabel)]
    pub fn provider_label(&self) -> NookDeviceAccessText {
        self.provider_label.clone()
    }

    #[wasm_bindgen(getter, js_name = createdAt)]
    pub fn created_at(&self) -> NookPasskeyTimestampEvidence {
        self.created_at.clone()
    }

    #[wasm_bindgen(getter, js_name = lastUsedAt)]
    pub fn last_used_at(&self) -> NookPasskeyTimestampEvidence {
        self.last_used_at.clone()
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn attachment(&self) -> NookPasskeyAttachmentState {
        self.attachment
    }

    #[wasm_bindgen]
    pub fn transports(&self) -> Vec<NookPasskeyTransport> {
        self.transports.clone()
    }

    #[wasm_bindgen(getter, js_name = backupState)]
    #[must_use]
    pub fn backup_state(&self) -> NookPasskeyBackupState {
        self.backup_state
    }

    #[wasm_bindgen(getter)]
    pub fn aaguid(&self) -> NookDeviceAccessText {
        self.aaguid.clone()
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn keeper(&self) -> nook_core::PasskeyKeeperKind {
        self.keeper
    }

    #[wasm_bindgen(getter, js_name = observedBrowser)]
    #[must_use]
    pub fn observed_browser(&self) -> nook_core::PasskeyObservedBrowser {
        self.observed_browser
    }

    #[wasm_bindgen(getter, js_name = observedPlatform)]
    #[must_use]
    pub fn observed_platform(&self) -> nook_core::PasskeyObservedPlatform {
        self.observed_platform
    }

    #[wasm_bindgen]
    pub fn vaults(&self) -> Vec<NookDeviceVaultAccess> {
        self.vaults.clone()
    }
}

impl NookDeviceAccessSnapshot {
    pub(crate) async fn device_access_snapshot_for_session(
        request: BrowserDeviceAccessSnapshotForSession<'_>,
    ) -> Result<NookDeviceAccessSnapshot, wasm_bindgen::JsError> {
        let BrowserDeviceAccessSnapshotForSession {
            session_device_id,
            session_unlocked,
        } = request;
        let session_device_id = session_device_id.trim();
        let protected = if session_device_id.is_empty() {
            NookDatabase::load_wrapped_device_identity().await?
        } else {
            NookDatabase::load_wrapped_device_identity_for_app_id(session_device_id).await?
        };
        NookDeviceAccessSnapshot::device_access_snapshot_for_session_with_protected(
            BrowserDeviceAccessSnapshotForSessionWithProtected {
                session_device_id: session_device_id,
                session_unlocked: session_unlocked,
                protected: protected,
            },
        )
        .await
    }
}

impl NookDeviceAccessSnapshot {
    pub(crate) async fn device_access_snapshot_for_session_with_protected(
        request: BrowserDeviceAccessSnapshotForSessionWithProtected<'_>,
    ) -> Result<NookDeviceAccessSnapshot, wasm_bindgen::JsError> {
        let BrowserDeviceAccessSnapshotForSessionWithProtected {
            session_device_id,
            session_unlocked,
            protected,
        } = request;
        let session_device_id = session_device_id.trim();
        let identity_state = nook_core::DeviceAccessIdentityState::classify(
            &nook_core::DeviceAccessIdentityObservation {
                session_unlocked,
                session_device_id,
                persisted_device_id: protected.as_ref().map(|(device_id, _)| device_id.as_str()),
            },
        );
        let session_uses_companion = !session_device_id.is_empty()
            && protected
                .as_ref()
                .is_none_or(|(persisted_device_id, _)| persisted_device_id != session_device_id);
        let protection = if session_uses_companion {
            DeviceAccessProtectionKind::CompanionSession
        } else {
            nook_core::DeviceAccessProtectionKind::classify(
                protected.as_ref().map(|(_, record)| record),
            )
        };
        let (device_id, credential_id, user_handle_id) = if session_uses_companion {
            (session_device_id.to_owned(), String::new(), String::new())
        } else {
            match &protected {
                Some((device_id, record)) => {
                    let credential_id = record
                        .credential_id()
                        .map(|bytes| {
                            nook_core::PasskeyAccessProfile::credential_identifier(bytes.as_ref())
                        })
                        .unwrap_or_default();
                    let user_handle_id = record
                        .user_handle()
                        .map(|bytes| {
                            nook_core::PasskeyAccessProfile::user_handle_identifier(bytes.as_ref())
                        })
                        .unwrap_or_default();
                    (device_id.clone(), credential_id, user_handle_id)
                }
                None => (String::new(), String::new(), String::new()),
            }
        };
        let profile = if session_uses_companion {
            DeviceAccessProfileKey::companion().load().await?
        } else if device_id.is_empty() {
            DeviceAccessProfile::default()
        } else {
            DeviceAccessProfileKey::for_app_id(&device_id)
                .await?
                .load()
                .await?
        };
        let passkey = if session_uses_companion {
            PasskeyAccessProfile::default()
        } else {
            profile
                .passkey
                .clone()
                .filter(|passkey| passkey.credential_fingerprint == credential_id)
                .unwrap_or_default()
        };
        let profiles = if device_id.is_empty() {
            Vec::new()
        } else {
            vec![LocalAccessProfile {
                app_id: device_id.clone(),
                profile: profile.clone(),
            }]
        };
        let vaults = NookDeviceVaultAccess::vault_access_rows(BrowserVaultAccessRows {
            registry: NookDatabase::list_vault_registry_entries().await?,
            profiles: &profiles,
            identity: None,
        });

        Ok(NookDeviceAccessSnapshot {
            protection,
            identity_state,
            device_id: NookDeviceAccessText::from_string(device_id),
            credential_id: NookDeviceAccessText::from_string(credential_id),
            user_handle_id: NookDeviceAccessText::from_string(user_handle_id),
            passkey_name: NookDeviceAccessText::from_string(passkey.nook_name),
            provider_label: NookDeviceAccessText::from_string(passkey.provider_label),
            created_at: NookPasskeyTimestampEvidence::from_created(passkey.created_at),
            last_used_at: NookPasskeyTimestampEvidence::from_last_used(passkey.last_used_at),
            attachment: NookPasskeyAttachmentState::attachment_state(
                passkey.observation.attachment,
            ),
            transports: passkey
                .observation
                .transports
                .into_iter()
                .map(|kind| NookPasskeyTransport { kind })
                .collect(),
            backup_state: NookPasskeyBackupState::backup_state(passkey.observation.backup_state),
            aaguid: NookDeviceAccessText::from_option(passkey.observation.aaguid.clone()),
            keeper: nook_core::PasskeyKeeperKind::classify(passkey.observation.aaguid.as_deref()),
            observed_browser: passkey.observation.browser,
            observed_platform: passkey.observation.platform,
            vaults,
        })
    }
}

impl NookDeviceVaultAccess {
    pub(crate) async fn device_vault_access_for_identity(
        request: BrowserDeviceVaultAccessForIdentity<'_>,
    ) -> Result<Vec<NookDeviceVaultAccess>, wasm_bindgen::JsError> {
        let BrowserDeviceVaultAccessForIdentity {
            identity,
            local_app_ids,
            session_app_id,
        } = request;
        let mut profiles = Vec::new();
        for app_id in local_app_ids {
            if identity.has_app_id(app_id) {
                profiles.push(LocalAccessProfile {
                    app_id: app_id.as_str().to_owned(),
                    profile: DeviceAccessProfileKey::for_app_id(app_id.as_str())
                        .await?
                        .load()
                        .await?,
                });
            }
        }
        if let Ok(session_app_id) = AppId::parse(session_app_id)
            && identity.has_app_id(&session_app_id)
            && !local_app_ids.contains(&session_app_id)
        {
            profiles.push(LocalAccessProfile {
                app_id: session_app_id.as_str().to_owned(),
                profile: DeviceAccessProfileKey::companion().load().await?,
            });
        }
        Ok(NookDeviceVaultAccess::vault_access_rows(
            BrowserVaultAccessRows {
                registry: NookDatabase::list_vault_registry_entries().await?,
                profiles: &profiles,
                identity: Some(identity),
            },
        ))
    }
}

impl NookDeviceVaultAccess {
    fn vault_access_rows(request: BrowserVaultAccessRows<'_>) -> Vec<NookDeviceVaultAccess> {
        let BrowserVaultAccessRows {
            registry,
            profiles,
            identity,
        } = request;
        let mut vaults = Vec::new();
        for entry in registry {
            if identity.is_some_and(|record| {
                StoreId::parse(&entry.store_id)
                    .map_or(true, |store_id| !record.owns_vault(&store_id))
            }) {
                continue;
            }
            let verified_at = profiles
                .iter()
                .flat_map(|local| {
                    local.profile.verified_vaults.iter().filter(|access| {
                        identity.is_none_or(|record| {
                            AppId::parse(&local.app_id)
                                .is_ok_and(|app_id| record.has_app_id(&app_id))
                        }) && access.device_id.as_str() == local.app_id
                            && access.store_id.as_str() == entry.store_id
                    })
                })
                .map(|access| &access.verified_at)
                .max()
                .map(ToString::to_string);
            vaults.push(NookDeviceVaultAccess {
                store_id: entry.store_id,
                label: entry.label,
                last_local_update_at: NookDeviceAccessText::from_option(
                    entry
                        .last_unlocked_at
                        .map(|timestamp| timestamp.to_string()),
                ),
                verified_at: NookDeviceAccessText::from_option(verified_at),
            });
        }
        vaults.sort_by(|left, right| left.label.cmp(&right.label));
        vaults
    }
}

#[wasm_bindgen]
pub async fn set_device_access_passkey_provider_label(
    credential_fingerprint: String,
    label: String,
) -> Result<(), wasm_bindgen::JsError> {
    device_access::PasskeyProviderLabelUpdate {
        credential_fingerprint: &credential_fingerprint,
        label: &label,
    }
    .apply()
    .await
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::{AppKey, DeviceId, IdentityRecord, IsoTimestamp};
    use wasm_bindgen_test::wasm_bindgen_test;

    fn vault_row(store_id: &nook_core::StoreId, label: &str) -> NookDeviceVaultAccess {
        NookDeviceVaultAccess {
            store_id: store_id.to_string(),
            label: label.to_owned(),
            last_local_update_at: NookDeviceAccessText::from_option(None),
            verified_at: NookDeviceAccessText::from_option(None),
        }
    }

    #[wasm_bindgen_test]
    fn scopes_current_and_companion_identity_vault_rows() -> anyhow::Result<()> {
        let current_key = AppKey::generate()?;
        let companion_key = AppKey::generate()?;
        let current_store = nook_core::StoreId::generate()?;
        let companion_store = nook_core::StoreId::generate()?;
        let unrelated_store = nook_core::StoreId::generate()?;
        let mut current = IdentityRecord::create_with_app_key("Personal", &current_key, None)?;
        let mut companion = IdentityRecord::create_with_app_key("Work", &companion_key, None)?;
        current.generate_vault_dek(current_store.clone())?;
        companion.generate_vault_dek(companion_store.clone())?;
        let vaults = vec![
            vault_row(&current_store, "Personal vault"),
            vault_row(&companion_store, "Work vault"),
            vault_row(&unrelated_store, "Unrelated vault"),
        ];

        let current_rows = NookDeviceVaultAccess::vaults_for_identity(BrowserVaultsForIdentity {
            vaults: &vaults,
            identity: &current,
        });
        let companion_rows = NookDeviceVaultAccess::vaults_for_identity(BrowserVaultsForIdentity {
            vaults: &vaults,
            identity: &companion,
        });
        assert_eq!(current_rows.len(), 1);
        assert_eq!(current_rows[0].store_id(), current_store.as_str());
        assert_eq!(companion_rows.len(), 1);
        assert_eq!(companion_rows[0].store_id(), companion_store.as_str());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn scopes_verified_access_to_each_local_identity_profile() -> anyhow::Result<()> {
        let personal_key = AppKey::generate()?;
        let work_key = AppKey::generate()?;
        let personal_store = nook_core::StoreId::generate()?;
        let work_store = nook_core::StoreId::generate()?;
        let mut personal = IdentityRecord::create_with_app_key("Personal", &personal_key, None)?;
        let mut work = IdentityRecord::create_with_app_key("Work", &work_key, None)?;
        personal.generate_vault_dek(personal_store.clone())?;
        work.generate_vault_dek(work_store.clone())?;
        let mut personal_profile = DeviceAccessProfile::default();
        personal_profile.record_verified_vault_access(
            &DeviceId::parse(personal_key.app_id().as_str())?,
            &personal_store,
            IsoTimestamp::from_trusted("2026-08-23T01:00:00.000Z".to_owned()),
        );
        let mut work_profile = DeviceAccessProfile::default();
        work_profile.record_verified_vault_access(
            &DeviceId::parse(work_key.app_id().as_str())?,
            &work_store,
            IsoTimestamp::from_trusted("2026-08-23T02:00:00.000Z".to_owned()),
        );
        let registry = vec![
            indexed_db::VaultRegistryEntry {
                store_id: personal_store.to_string(),
                label: "Personal vault".to_owned(),
                last_unlocked_at: None,
            },
            indexed_db::VaultRegistryEntry {
                store_id: work_store.to_string(),
                label: "Work vault".to_owned(),
                last_unlocked_at: None,
            },
        ];
        let profiles = vec![
            LocalAccessProfile {
                app_id: personal_key.app_id().as_str().to_owned(),
                profile: personal_profile,
            },
            LocalAccessProfile {
                app_id: work_key.app_id().as_str().to_owned(),
                profile: work_profile,
            },
        ];

        let personal_rows = NookDeviceVaultAccess::vault_access_rows(BrowserVaultAccessRows {
            registry: registry.clone(),
            profiles: &profiles,
            identity: Some(&personal),
        });
        let work_rows = NookDeviceVaultAccess::vault_access_rows(BrowserVaultAccessRows {
            registry: registry,
            profiles: &profiles,
            identity: Some(&work),
        });

        assert_eq!(personal_rows.len(), 1);
        assert_eq!(personal_rows[0].store_id(), personal_store.as_str());
        assert_eq!(
            personal_rows[0].verified_at().kind(),
            NookDeviceAccessTextKind::Known
        );
        assert_eq!(work_rows.len(), 1);
        assert_eq!(work_rows[0].store_id(), work_store.as_str());
        assert_eq!(
            work_rows[0].verified_at().kind(),
            NookDeviceAccessTextKind::Known
        );
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use crate::NookError;
    use crate::storage::identity_record;
    use nook_core::{AppKey, DeviceAccessIdentityState, DeviceId, IdentityRecord};
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn locked_session_keeps_its_identity_evidence_after_another_tab_switches()
    -> Result<(), crate::NookError> {
        NookDatabase::clear_keyring_for_test().await?;
        NookDatabase::clear_identity_directory_for_test().await?;
        let first_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &first_key,
            record: &first_wrapped,
            prior_app_key: None,
            label: "Personal",
        })
        .await?;
        let second_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &second_key,
            record: &second_wrapped,
            prior_app_key: None,
            label: "Work",
        })
        .await?;

        let snapshot = NookDeviceAccessSnapshot::device_access_snapshot_for_session(
            BrowserDeviceAccessSnapshotForSession {
                session_device_id: first_key.app_id().as_str(),
                session_unlocked: false,
            },
        )
        .await
        .map_err(|error| NookError::Database(format!("{error:?}")))?;

        assert_eq!(
            snapshot.protection(),
            DeviceAccessProtectionKind::PinOrPassphrase
        );
        assert_eq!(snapshot.identity_state(), DeviceAccessIdentityState::Locked);
        assert_eq!(
            snapshot
                .device_id()
                .value()
                .map_err(|error| NookError::Database(format!("{error:?}")))?,
            first_key.app_id().as_str()
        );

        NookDatabase::clear_keyring_for_test().await?;
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn companion_session_projects_verified_vault_evidence_from_compatibility_profile()
    -> Result<(), crate::NookError> {
        NookDatabase::clear_vault_db().await?;
        let companion_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let companion_id = DeviceId::parse(companion_key.app_id().as_str())
            .map_err(|error| NookError::Database(error.to_string()))?;
        let store_id = nook_core::StoreId::generate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let mut identity = IdentityRecord::create_with_app_key("Companion", &companion_key, None)
            .map_err(|error| NookError::Database(error.to_string()))?;
        identity
            .generate_vault_dek(store_id.clone())
            .map_err(|error| NookError::Database(error.to_string()))?;
        NookDatabase::save_vault_blob(SaveVaultBlobRequest {
            store_id: store_id.as_str(),
            content: "encrypted-vault",
        })
        .await?;
        device_access::VerifiedVaultAccessUpdate {
            device_id: &companion_id,
            store_id: &store_id,
        }
        .apply()
        .await?;

        let snapshot = NookDeviceAccessSnapshot::device_access_snapshot_for_session_with_protected(
            BrowserDeviceAccessSnapshotForSessionWithProtected {
                session_device_id: companion_id.as_str(),
                session_unlocked: true,
                protected: None,
            },
        )
        .await
        .map_err(|error| NookError::Database(format!("{error:?}")))?;

        assert_eq!(
            snapshot.protection(),
            DeviceAccessProtectionKind::CompanionSession
        );
        let vault = snapshot
            .vaults()
            .into_iter()
            .find(|entry| entry.store_id() == store_id.as_str())
            .ok_or_else(|| NookError::Database("Companion vault is missing".to_owned()))?;
        assert_eq!(vault.access_state(), NookDeviceVaultAccessState::Verified);
        let identity_vault = NookDeviceVaultAccess::device_vault_access_for_identity(
            BrowserDeviceVaultAccessForIdentity {
                identity: &identity,
                local_app_ids: &[],
                session_app_id: companion_key.app_id().as_str(),
            },
        )
        .await
        .map_err(|error| NookError::Database(format!("{error:?}")))?
        .into_iter()
        .find(|entry| entry.store_id() == store_id.as_str())
        .ok_or_else(|| NookError::Database("Companion identity vault is missing".to_owned()))?;
        assert_eq!(
            identity_vault.access_state(),
            NookDeviceVaultAccessState::Verified
        );
        NookDatabase::clear_vault_db().await
    }

    #[wasm_bindgen_test]
    fn device_access_projection_wrappers_cover_unknown_and_known_states() {
        let unknown = NookDeviceAccessText::from_string(String::new());
        assert_eq!(unknown.kind(), NookDeviceAccessTextKind::Unknown);
        assert!(unknown.value().is_err());
        let known = NookDeviceAccessText::from_option(Some("label".into()));
        assert_eq!(known.kind(), NookDeviceAccessTextKind::Known);
        assert_eq!(known.value().unwrap(), "label");

        let created_unknown =
            NookPasskeyTimestampEvidence::from_created(PasskeyCreatedAtEvidence::Unavailable);
        assert_eq!(
            created_unknown.kind(),
            NookPasskeyTimestampEvidenceKind::Unavailable
        );
        assert!(created_unknown.value().is_err());
        let timestamp =
            nook_core::IsoTimestamp::from_trusted("2026-09-01T00:00:00.000Z".to_owned());
        let created_known =
            NookPasskeyTimestampEvidence::from_created(PasskeyCreatedAtEvidence::Known {
                timestamp: timestamp.clone(),
            });
        assert_eq!(
            created_known.kind(),
            NookPasskeyTimestampEvidenceKind::Known
        );
        assert_eq!(created_known.value().unwrap(), timestamp.to_string());
        let not_observed =
            NookPasskeyTimestampEvidence::from_last_used(PasskeyLastUsedAtEvidence::NotYetObserved);
        assert_eq!(
            not_observed.kind(),
            NookPasskeyTimestampEvidenceKind::NotYetObserved
        );
        assert!(not_observed.value().is_err());
        let unsorted = vec![
            indexed_db::VaultRegistryEntry {
                store_id: "invalid-store".into(),
                label: "Zulu".into(),
                last_unlocked_at: None,
            },
            indexed_db::VaultRegistryEntry {
                store_id: "invalid-store-2".into(),
                label: "Alpha".into(),
                last_unlocked_at: Some(timestamp),
            },
        ];
        let rows = NookDeviceVaultAccess::vault_access_rows(BrowserVaultAccessRows {
            registry: unsorted,
            profiles: &[],
            identity: None,
        });
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].label(), "Alpha");
        assert_eq!(rows[1].access_state(), NookDeviceVaultAccessState::Unknown);
    }
}
