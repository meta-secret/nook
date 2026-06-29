//! Typed values exported across the wasm-bindgen boundary (no raw `JsValue` bags).

use crate::NookError;
use crate::NookSecretRecord;
use crate::NookVaultManager;
use wasm_bindgen::prelude::wasm_bindgen;

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
            device_id: join.device_id,
            public_key: join.public_key,
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
            auth_id: member.auth_id,
            device_id: member.device_id,
            public_key: member.public_key,
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
            secrets: manager.get_records()?,
            pending_joins: manager.pending_joins()?,
            vault_members: manager.vault_members()?,
        })
    }
}

#[wasm_bindgen]
pub struct NookRemoteVaultFetch {
    content: String,
    revision: Option<String>,
    missing: bool,
}

#[wasm_bindgen]
impl NookRemoteVaultFetch {
    pub(crate) fn new(content: String, revision: Option<String>, missing: bool) -> Self {
        Self {
            content,
            revision,
            missing,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn content(&self) -> String {
        self.content.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn revision(&self) -> Option<String> {
        self.revision.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn missing(&self) -> bool {
        self.missing
    }
}

#[wasm_bindgen]
pub struct NookReconcileVaultBlobsResult {
    action: String,
    local_yaml: String,
    remote_yaml: String,
    remote_revision: Option<String>,
}

#[wasm_bindgen]
impl NookReconcileVaultBlobsResult {
    pub(crate) fn new(
        action: String,
        local_yaml: String,
        remote_yaml: String,
        remote_revision: Option<String>,
    ) -> Self {
        Self {
            action,
            local_yaml,
            remote_yaml,
            remote_revision,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn action(&self) -> String {
        self.action.clone()
    }

    #[wasm_bindgen(getter, js_name = localYaml)]
    pub fn local_yaml(&self) -> String {
        self.local_yaml.clone()
    }

    #[wasm_bindgen(getter, js_name = remoteYaml)]
    pub fn remote_yaml(&self) -> String {
        self.remote_yaml.clone()
    }

    #[wasm_bindgen(getter, js_name = remoteRevision)]
    pub fn remote_revision(&self) -> Option<String> {
        self.remote_revision.clone()
    }
}

#[wasm_bindgen]
pub struct NookResolveConflictKeepLocalResult {
    remote_yaml: String,
}

#[wasm_bindgen]
impl NookResolveConflictKeepLocalResult {
    pub(crate) fn new(remote_yaml: String) -> Self {
        Self { remote_yaml }
    }

    #[wasm_bindgen(getter, js_name = remoteYaml)]
    pub fn remote_yaml(&self) -> String {
        self.remote_yaml.clone()
    }
}

#[wasm_bindgen]
pub struct NookResolveConflictKeepRemoteResult {
    local_yaml: String,
}

#[wasm_bindgen]
impl NookResolveConflictKeepRemoteResult {
    pub(crate) fn new(local_yaml: String) -> Self {
        Self { local_yaml }
    }

    #[wasm_bindgen(getter, js_name = localYaml)]
    pub fn local_yaml(&self) -> String {
        self.local_yaml.clone()
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
    conflicts: std::collections::BTreeMap<String, nook_core::SecretReplacementConflict>,
) -> Result<Vec<NookReplacementConflict>, NookError> {
    conflicts
        .into_values()
        .map(|conflict| {
            let candidates_json = serde_json::to_string(
                &conflict
                    .candidates
                    .iter()
                    .map(|(event_id, secret_id)| (event_id.as_str().to_owned(), secret_id.clone()))
                    .collect::<Vec<_>>(),
            )
            .map_err(|e| NookError::Serialization(e.to_string()))?;
            Ok(NookReplacementConflict {
                old_secret_id: conflict.old_secret_id,
                candidates_json,
            })
        })
        .collect()
}
