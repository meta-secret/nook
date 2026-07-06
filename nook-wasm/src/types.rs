//! Typed values exported across the wasm-bindgen boundary (no raw `JsValue` bags).

use crate::NookError;
use crate::NookSecretRecord;
use crate::NookVaultManager;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasskeySetup {
    user_handle: Vec<u8>,
    prf_input: Vec<u8>,
}

impl NookPasskeySetup {
    pub(crate) fn from_core(setup: &nook_core::DeviceKeyProtectionSetup) -> Self {
        Self {
            user_handle: setup.user_handle().to_vec(),
            prf_input: setup.prf_input().to_vec(),
        }
    }
}

#[wasm_bindgen]
impl NookPasskeySetup {
    #[wasm_bindgen(getter, js_name = userHandle)]
    pub fn user_handle(&self) -> Vec<u8> {
        self.user_handle.clone()
    }

    #[wasm_bindgen(getter, js_name = prfInput)]
    pub fn prf_input(&self) -> Vec<u8> {
        self.prf_input.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasskeyUnlockOptions {
    credential_id: Vec<u8>,
    prf_input: Vec<u8>,
}

impl NookPasskeyUnlockOptions {
    pub(crate) fn from_core(
        record: &nook_core::WrappedDeviceIdentity,
    ) -> Result<Self, nook_core::DeviceKeyProtectionError> {
        Ok(Self {
            credential_id: record.credential_id_bytes()?,
            prf_input: record.prf_input_bytes()?,
        })
    }
}

#[wasm_bindgen]
impl NookPasskeyUnlockOptions {
    #[wasm_bindgen(getter, js_name = credentialId)]
    pub fn credential_id(&self) -> Vec<u8> {
        self.credential_id.clone()
    }

    #[wasm_bindgen(getter, js_name = prfInput)]
    pub fn prf_input(&self) -> Vec<u8> {
        self.prf_input.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookJoinRequest {
    device_id: String,
    public_key: String,
    requested_at: String,
}

#[wasm_bindgen]
impl NookJoinRequest {
    pub(crate) fn from_core(join: nook_core::JoinRequest) -> Self {
        Self {
            device_id: join.device_id.to_string(),
            public_key: join.public_key.as_str().to_owned(),
            requested_at: join.requested_at,
        }
    }

    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter, js_name = publicKey)]
    pub fn public_key(&self) -> String {
        self.public_key.clone()
    }

    #[wasm_bindgen(getter, js_name = requestedAt)]
    pub fn requested_at(&self) -> String {
        self.requested_at.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultMember {
    auth_id: String,
    device_id: String,
    public_key: String,
    enrolled_at: String,
    label: String,
}

#[wasm_bindgen]
impl NookVaultMember {
    pub(crate) fn from_core(member: nook_core::VaultMember) -> Self {
        Self {
            auth_id: member.auth_id.to_string(),
            device_id: member.device_id.to_string(),
            public_key: member.public_key.as_str().to_owned(),
            enrolled_at: member.enrolled_at,
            label: member.label.unwrap_or_default(),
        }
    }

    #[wasm_bindgen(getter, js_name = authId)]
    pub fn auth_id(&self) -> String {
        self.auth_id.clone()
    }

    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter, js_name = publicKey)]
    pub fn public_key(&self) -> String {
        self.public_key.clone()
    }

    #[wasm_bindgen(getter, js_name = enrolledAt)]
    pub fn enrolled_at(&self) -> String {
        self.enrolled_at.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasswordEntrySummary {
    id: String,
    label: String,
    created_at: String,
}

#[wasm_bindgen]
impl NookPasswordEntrySummary {
    pub(crate) fn from_core(entry: &nook_core::PasswordUnlockEntry) -> Self {
        Self {
            id: entry.id.clone(),
            label: entry.label.clone(),
            created_at: entry.created_at.clone(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    #[wasm_bindgen(getter, js_name = createdAt)]
    pub fn created_at(&self) -> String {
        self.created_at.clone()
    }
}

pub(crate) fn password_entries_to_vec(
    entries: &[nook_core::PasswordUnlockEntry],
) -> Vec<NookPasswordEntrySummary> {
    entries
        .iter()
        .map(NookPasswordEntrySummary::from_core)
        .collect()
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookEnrollmentProvider {
    provider_type: nook_core::StorageProviderType,
    pat: String,
    repo: String,
}

#[wasm_bindgen]
impl NookEnrollmentProvider {
    #[wasm_bindgen(constructor)]
    pub fn new(
        provider_type: nook_core::StorageProviderType,
        pat: Option<String>,
        repo: Option<String>,
    ) -> Self {
        Self {
            provider_type,
            pat: pat.unwrap_or_default(),
            repo: repo.unwrap_or_default(),
        }
    }

    #[wasm_bindgen(js_name = local)]
    #[must_use]
    pub fn local() -> Self {
        Self {
            provider_type: nook_core::StorageProviderType::Local,
            pat: String::new(),
            repo: String::new(),
        }
    }

    #[wasm_bindgen(js_name = github)]
    #[must_use]
    pub fn github(pat: String, repo: String) -> Self {
        Self {
            provider_type: nook_core::StorageProviderType::Github,
            pat,
            repo,
        }
    }

    pub(crate) fn from_core(provider: nook_core::EnrollmentProvider) -> Self {
        match provider {
            nook_core::EnrollmentProvider::Local => Self::local(),
            nook_core::EnrollmentProvider::Github { pat, repo } => Self::github(pat, repo),
        }
    }

    pub(crate) fn to_core(
        &self,
    ) -> Result<nook_core::EnrollmentProvider, nook_core::EnrollmentError> {
        match self.provider_type {
            nook_core::StorageProviderType::Local => Ok(nook_core::EnrollmentProvider::Local),
            nook_core::StorageProviderType::Github => Ok(nook_core::EnrollmentProvider::Github {
                pat: self.pat.clone(),
                repo: self.repo.clone(),
            }),
            provider_type => Err(nook_core::EnrollmentError::UnsupportedProviderType {
                provider_type: provider_type.as_str().to_owned(),
            }),
        }
    }

    #[wasm_bindgen(getter, js_name = "type")]
    #[must_use]
    pub fn provider_type(&self) -> nook_core::StorageProviderType {
        self.provider_type
    }

    #[wasm_bindgen(getter)]
    pub fn pat(&self) -> String {
        self.pat.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn repo(&self) -> String {
        self.repo.clone()
    }
}

/// Thin wasm newtype wrapper over the core `SyncProviderTarget` enum. Construct
/// via the variant constructors; read via `is_*` / `as_*` accessors.
#[wasm_bindgen]
#[derive(Clone)]
pub struct NookSyncProviderTarget(nook_core::SyncProviderTarget);

#[wasm_bindgen]
impl NookSyncProviderTarget {
    #[wasm_bindgen(js_name = local)]
    #[must_use]
    pub fn local() -> Self {
        Self(nook_core::SyncProviderTarget::Local)
    }

    #[wasm_bindgen(js_name = localFolder)]
    #[must_use]
    pub fn local_folder(directory_name: Option<String>, handle_id: Option<String>) -> Self {
        Self(nook_core::SyncProviderTarget::LocalFolder(
            nook_core::LocalFolderSyncTarget {
                directory_name,
                handle_id,
            },
        ))
    }

    #[wasm_bindgen(js_name = github)]
    #[must_use]
    pub fn github(repo: String, pat: String) -> Self {
        Self(nook_core::SyncProviderTarget::Github(
            nook_core::GithubSyncTarget { repo, pat },
        ))
    }

    #[wasm_bindgen(js_name = empty)]
    #[must_use]
    pub fn empty() -> Self {
        Self(nook_core::SyncProviderTarget::Empty)
    }

    #[wasm_bindgen(js_name = oauthFile)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn oauth_file(
        preset: Option<nook_core::OauthFilePreset>,
        file_id: Option<String>,
        file_name: Option<String>,
        account_email: Option<String>,
        access_token: Option<String>,
    ) -> Result<NookSyncProviderTarget, wasm_bindgen::JsError> {
        let preset = preset.unwrap_or(nook_core::OauthFilePreset::GoogleDrive);
        Ok(Self(nook_core::SyncProviderTarget::OauthFile(
            nook_core::OauthFileSyncTarget {
                preset,
                file_id,
                file_name,
                account_email,
                access_token,
            },
        )))
    }

    #[wasm_bindgen(js_name = isLocal)]
    #[must_use]
    pub fn is_local(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::Local)
    }

    #[wasm_bindgen(js_name = isLocalFolder)]
    #[must_use]
    pub fn is_local_folder(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::LocalFolder(_))
    }

    #[wasm_bindgen(js_name = isGithub)]
    #[must_use]
    pub fn is_github(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::Github(_))
    }

    #[wasm_bindgen(js_name = isEmpty)]
    #[must_use]
    pub fn is_empty(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::Empty)
    }

    #[wasm_bindgen(js_name = isOauthFile)]
    #[must_use]
    pub fn is_oauth_file(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::OauthFile(_))
    }

    pub(crate) fn as_core(&self) -> &nook_core::SyncProviderTarget {
        &self.0
    }
}

impl From<nook_core::SyncProviderTarget> for NookSyncProviderTarget {
    fn from(target: nook_core::SyncProviderTarget) -> Self {
        Self(target)
    }
}

#[wasm_bindgen]
pub struct NookEnrollmentIssueInput {
    provider: NookEnrollmentProvider,
    entry_id: String,
    issued_at: String,
}

#[wasm_bindgen]
impl NookEnrollmentIssueInput {
    #[wasm_bindgen(constructor)]
    pub fn new(provider: NookEnrollmentProvider, entry_id: String, issued_at: String) -> Self {
        Self {
            provider,
            entry_id,
            issued_at,
        }
    }

    pub(crate) fn to_core(
        &self,
    ) -> Result<nook_core::EnrollmentIssueInput, nook_core::EnrollmentError> {
        Ok(nook_core::EnrollmentIssueInput {
            provider: self.provider.to_core()?,
            entry_id: self.entry_id.clone(),
            issued_at: self.issued_at.clone(),
        })
    }

    #[wasm_bindgen(getter)]
    pub fn provider(&self) -> NookEnrollmentProvider {
        self.provider.clone()
    }

    #[wasm_bindgen(getter, js_name = entryId)]
    pub fn entry_id(&self) -> String {
        self.entry_id.clone()
    }

    #[wasm_bindgen(getter, js_name = issuedAt)]
    pub fn issued_at(&self) -> String {
        self.issued_at.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookDecryptedEnrollmentPayload {
    provider: NookEnrollmentProvider,
    entry_id: String,
    issued_at: String,
}

#[wasm_bindgen]
impl NookDecryptedEnrollmentPayload {
    pub(crate) fn from_core(payload: nook_core::DecryptedEnrollmentPayload) -> Self {
        Self {
            provider: NookEnrollmentProvider::from_core(payload.provider),
            entry_id: payload.entry_id,
            issued_at: payload.issued_at,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn provider(&self) -> NookEnrollmentProvider {
        self.provider.clone()
    }

    #[wasm_bindgen(getter, js_name = entryId)]
    pub fn entry_id(&self) -> String {
        self.entry_id.clone()
    }

    #[wasm_bindgen(getter, js_name = issuedAt)]
    pub fn issued_at(&self) -> String {
        self.issued_at.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultSyncResult {
    changed: bool,
    access_status: String,
    secrets: Vec<NookSecretRecord>,
    pending_joins: Vec<NookJoinRequest>,
    vault_members: Vec<NookVaultMember>,
}

#[wasm_bindgen]
impl NookVaultSyncResult {
    #[wasm_bindgen(getter)]
    pub fn changed(&self) -> bool {
        self.changed
    }

    #[wasm_bindgen(getter, js_name = accessStatus)]
    pub fn access_status(&self) -> String {
        self.access_status.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn secrets(&self) -> Vec<NookSecretRecord> {
        self.secrets.clone()
    }

    #[wasm_bindgen(getter, js_name = pendingJoins)]
    pub fn pending_joins(&self) -> Vec<NookJoinRequest> {
        self.pending_joins.clone()
    }

    #[wasm_bindgen(getter, js_name = vaultMembers)]
    pub fn vault_members(&self) -> Vec<NookVaultMember> {
        self.vault_members.clone()
    }

    pub(crate) fn unchanged() -> Self {
        Self {
            changed: false,
            access_status: String::new(),
            secrets: Vec::new(),
            pending_joins: Vec::new(),
            vault_members: Vec::new(),
        }
    }

    pub(crate) fn with_access_status(status: String) -> Self {
        Self {
            changed: true,
            access_status: status,
            secrets: Vec::new(),
            pending_joins: Vec::new(),
            vault_members: Vec::new(),
        }
    }

    pub(crate) fn session(manager: &NookVaultManager, changed: bool) -> Result<Self, NookError> {
        Ok(Self {
            changed,
            access_status: String::new(),
            secrets: manager.get_records().unwrap_or_default(),
            pending_joins: manager.pending_joins().unwrap_or_default(),
            vault_members: manager.vault_members().unwrap_or_default(),
        })
    }
}

/// Flat form payload for `buildSecretYaml` — unused fields stay empty.
#[wasm_bindgen]
pub struct NookSecretFormFields {
    website_url: String,
    username: String,
    password: String,
    notes: String,
    key: String,
    expires_at: String,
    name: String,
    seed: String,
    title: String,
    note: String,
}

#[wasm_bindgen]
impl NookSecretFormFields {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        website_url: Option<String>,
        username: Option<String>,
        password: Option<String>,
        notes: Option<String>,
        key: Option<String>,
        expires_at: Option<String>,
        name: Option<String>,
        seed: Option<String>,
        title: Option<String>,
        note: Option<String>,
    ) -> Self {
        Self {
            website_url: website_url.unwrap_or_default(),
            username: username.unwrap_or_default(),
            password: password.unwrap_or_default(),
            notes: notes.unwrap_or_default(),
            key: key.unwrap_or_default(),
            expires_at: expires_at.unwrap_or_default(),
            name: name.unwrap_or_default(),
            seed: seed.unwrap_or_default(),
            title: title.unwrap_or_default(),
            note: note.unwrap_or_default(),
        }
    }

    pub(crate) fn to_json_value(&self) -> serde_json::Value {
        serde_json::json!({
            "websiteUrl": self.website_url,
            "username": self.username,
            "password": self.password,
            "notes": self.notes,
            "key": self.key,
            "expiresAt": self.expires_at,
            "name": self.name,
            "seed": self.seed,
            "title": self.title,
            "note": self.note,
        })
    }
}

pub(crate) fn records_to_vec(
    records: Vec<nook_core::SecretRecord>,
) -> Result<Vec<NookSecretRecord>, NookError> {
    Ok(records
        .into_iter()
        .map(NookSecretRecord::from_record)
        .collect())
}

pub(crate) fn joins_to_vec(joins: Vec<nook_core::JoinRequest>) -> Vec<NookJoinRequest> {
    joins.into_iter().map(NookJoinRequest::from_core).collect()
}

pub(crate) fn members_to_vec(members: Vec<nook_core::VaultMember>) -> Vec<NookVaultMember> {
    members
        .into_iter()
        .map(NookVaultMember::from_core)
        .collect()
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookReplacementConflict {
    old_secret_id: String,
    candidates_json: String,
}

#[wasm_bindgen]
impl NookReplacementConflict {
    #[wasm_bindgen(getter, js_name = oldSecretId)]
    pub fn old_secret_id(&self) -> String {
        self.old_secret_id.clone()
    }

    #[wasm_bindgen(getter, js_name = candidatesJson)]
    pub fn candidates_json(&self) -> String {
        self.candidates_json.clone()
    }
}

pub(crate) fn replacement_conflicts_to_vec(
    conflicts: std::collections::BTreeMap<
        nook_core::SecretId,
        nook_core::SecretReplacementConflict,
    >,
) -> Result<Vec<NookReplacementConflict>, NookError> {
    conflicts
        .into_values()
        .map(|conflict| {
            let candidates_json = serde_json::to_string(
                &conflict
                    .candidates
                    .iter()
                    .map(|(event_id, secret_id)| {
                        (event_id.as_str().to_owned(), secret_id.as_str().to_owned())
                    })
                    .collect::<Vec<_>>(),
            )
            .map_err(|e| NookError::Serialization(e.to_string()))?;
            Ok(NookReplacementConflict {
                old_secret_id: conflict.old_secret_id.as_str().to_owned(),
                candidates_json,
            })
        })
        .collect()
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookSecurityConflict {
    events_json: String,
    reasons_json: String,
}

#[wasm_bindgen]
impl NookSecurityConflict {
    #[wasm_bindgen(getter, js_name = eventsJson)]
    pub fn events_json(&self) -> String {
        self.events_json.clone()
    }

    #[wasm_bindgen(getter, js_name = reasonsJson)]
    pub fn reasons_json(&self) -> String {
        self.reasons_json.clone()
    }
}

pub(crate) fn security_conflicts_to_vec(
    conflicts: Vec<nook_core::SecurityConflict>,
) -> Result<Vec<NookSecurityConflict>, NookError> {
    conflicts
        .into_iter()
        .map(|conflict| {
            let events_json = serde_json::to_string(
                &conflict
                    .events
                    .iter()
                    .map(|event| event.as_str().to_owned())
                    .collect::<Vec<_>>(),
            )
            .map_err(|e| NookError::Serialization(e.to_string()))?;
            let reasons_json = serde_json::to_string(
                &conflict
                    .reasons
                    .iter()
                    .map(|reason| reason.as_str())
                    .collect::<Vec<_>>(),
            )
            .map_err(|e| NookError::Serialization(e.to_string()))?;
            Ok(NookSecurityConflict {
                events_json,
                reasons_json,
            })
        })
        .collect()
}
