//! Persisted sync-provider snapshot model plus the pure transforms the web app
//! runs over it (normalize, field migration, local-row seeding, dedup).
//!
//! The browser stores an [`AuthProvidersSnapshotData`] in the `nook_auth`
//! `IndexedDB` database. All shaping of that data lives here so it is unit-tested
//! in Rust; `nook-wasm` owns the `IndexedDB` I/O and device-key sealing, and the
//! web layer keeps only thin call adapters plus i18n presentation.

use serde::{Deserialize, Serialize};

use crate::errors::{ValidationError, ValidationResult};
use crate::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, EnrollmentProvider, GithubPatMask,
    GithubSyncTarget, LocalFolderSyncTarget, OauthFilePreset, OauthFileSyncTarget,
    ProviderReplicationCapability, ReplicationType, StorageMode, StorageProviderType,
    SyncProviderTarget, VaultArchitecture, format_drive_storage_ref_raw, mask_github_pat,
    provider_replication_capability, storage_mode_for_provider, sync_provider_default_label,
    sync_provider_target_key, validate_github_pat, validate_github_repo_name,
    validate_oauth_access_token, validate_provider_replication,
};

/// OAuth-file (Google Drive / iCloud) credential block for a stored provider.
///
/// Field names are `camelCase` on the wire to match the structured-clone object
/// the web layer and e2e seeders read/write directly in `IndexedDB`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthFileConfigData {
    pub preset: String,
    #[serde(default)]
    pub access_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_email: Option<String>,
    /// Shared-replication My Drive folder id (`drive.file` scope). Personal
    /// vaults leave this unset and continue using `drive.appdata`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
}

/// Browser-local File System Access folder handle metadata.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFolderConfigData {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directory_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle_id: Option<String>,
}

/// One persisted sync provider row.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageProviderData {
    pub id: String,
    #[serde(rename = "type")]
    pub provider_type: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github_pat: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github_repo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth_file: Option<OAuthFileConfigData>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_folder: Option<LocalFolderConfigData>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_synced_version: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_synced_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync_revision: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_common_content_hash: Option<String>,
    pub created_at: String,
}

/// The full persisted snapshot: provider rows plus the active vault scope.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthProvidersSnapshotData {
    #[serde(default)]
    pub providers: Vec<StorageProviderData>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_vault_store_id: Option<String>,
}

/// Result of [`normalize_auth_snapshot`] — the cleaned snapshot plus signals the
/// caller uses to decide whether to re-persist and to run legacy vault copy.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedAuthSnapshot {
    pub snapshot: AuthProvidersSnapshotData,
    pub legacy_active_provider_id: Option<String>,
    pub changed: bool,
}

/// Positional connect arguments expected by the current wasm manager boundary:
/// storage mode, credential/token, and remote reference/repo.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StorageConnectArgs {
    pub mode: String,
    pub pat: String,
    pub repo: String,
}

impl StorageConnectArgs {
    #[must_use]
    pub fn local() -> Self {
        Self {
            mode: StorageMode::Local.as_str().to_owned(),
            pat: String::new(),
            repo: String::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderStorageDetailLabels {
    pub this_device_desc: String,
    pub no_token_saved: String,
    pub google_signed_in: String,
    pub icloud_signed_in: String,
    pub google_not_signed_in: String,
    pub icloud_not_signed_in: String,
    pub local_folder_needs_reconnect: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderLabelLabels {
    pub this_device: String,
    pub github: String,
    pub local_folder: String,
    pub google_drive: String,
    pub icloud: String,
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn parse_oauth_preset(raw: Option<&str>) -> ValidationResult<Option<OauthFilePreset>> {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(OauthFilePreset::parse)
        .transpose()
}

/// Derive connect args from a configured persisted provider row.
///
/// Local-folder rows are browser-side backup targets, so manager sync still uses
/// the local encrypted vault cache for the main connect boundary.
pub fn storage_args_for_provider(
    provider: &StorageProviderData,
) -> ValidationResult<StorageConnectArgs> {
    let provider_type = StorageProviderType::parse(&provider.provider_type)?;
    let oauth_preset = parse_oauth_preset(
        provider
            .oauth_file
            .as_ref()
            .map(|oauth| oauth.preset.as_str()),
    )?;
    let mode = storage_mode_for_provider(provider_type, oauth_preset)
        .as_str()
        .to_owned();
    match provider_type {
        StorageProviderType::Local | StorageProviderType::LocalFolder => {
            Ok(StorageConnectArgs::local())
        }
        StorageProviderType::Github => Ok(StorageConnectArgs {
            mode,
            pat: non_empty(provider.github_pat.as_deref()).unwrap_or_default(),
            repo: non_empty(provider.github_repo.as_deref())
                .unwrap_or_else(|| DEFAULT_GITHUB_REPO_NAME.to_owned()),
        }),
        StorageProviderType::OauthFile => {
            let oauth = provider.oauth_file.as_ref();
            let file_name = oauth
                .and_then(|oauth| non_empty(oauth.file_name.as_deref()))
                .unwrap_or_else(|| DEFAULT_DRIVE_BACKUP_NAME.to_owned());
            // Shared replication stores events under a My Drive folder id.
            // Encode with the `shared:` prefix so prepare_storage can select
            // drive.file parent vs personal appDataFolder without a 4th arg.
            let storage_id = oauth
                .and_then(|oauth| non_empty(oauth.folder_id.as_deref()))
                .map(|folder_id| format!("shared:{folder_id}"))
                .or_else(|| oauth.and_then(|oauth| non_empty(oauth.file_id.as_deref())))
                .unwrap_or_default();
            Ok(StorageConnectArgs {
                mode,
                pat: oauth
                    .and_then(|oauth| non_empty(Some(oauth.access_token.as_str())))
                    .unwrap_or_default(),
                repo: format_drive_storage_ref_raw(&storage_id, &file_name),
            })
        }
    }
}

pub fn provider_replication_capability_for_row(
    provider: &StorageProviderData,
) -> ValidationResult<ProviderReplicationCapability> {
    let provider_type = StorageProviderType::parse(&provider.provider_type)?;
    let oauth_preset = parse_oauth_preset(
        provider
            .oauth_file
            .as_ref()
            .map(|oauth| oauth.preset.as_str()),
    )?;
    Ok(provider_replication_capability(provider_type, oauth_preset))
}

pub fn validate_provider_row_replication(
    provider: &StorageProviderData,
    replication_type: ReplicationType,
) -> ValidationResult<ProviderReplicationCapability> {
    let provider_type = StorageProviderType::parse(&provider.provider_type)?;
    let oauth_preset = parse_oauth_preset(
        provider
            .oauth_file
            .as_ref()
            .map(|oauth| oauth.preset.as_str()),
    )?;
    validate_provider_replication(provider_type, oauth_preset, replication_type)
}

pub fn enrollment_provider_for_architecture(
    provider: &StorageProviderData,
    architecture: &VaultArchitecture,
    shared_joiner_identity: Option<&str>,
) -> ValidationResult<EnrollmentProvider> {
    enrollment_provider_for_architecture_with_storage_target(
        provider,
        architecture,
        shared_joiner_identity,
        None,
    )
}

pub fn enrollment_provider_for_architecture_with_storage_target(
    provider: &StorageProviderData,
    architecture: &VaultArchitecture,
    shared_joiner_identity: Option<&str>,
    shared_storage_target_id: Option<&str>,
) -> ValidationResult<EnrollmentProvider> {
    let capability = validate_provider_row_replication(provider, architecture.replication_type)?;
    let provider_type = StorageProviderType::parse(&provider.provider_type)?;
    match architecture.replication_type {
        ReplicationType::Personal => match provider_type {
            StorageProviderType::Local | StorageProviderType::LocalFolder => {
                Ok(EnrollmentProvider::Local)
            }
            StorageProviderType::Github => Ok(EnrollmentProvider::Github {
                pat: validate_github_pat(provider.github_pat.as_deref().unwrap_or_default())?
                    .as_str()
                    .to_owned(),
                repo: validate_github_repo_name(
                    provider.github_repo.as_deref().unwrap_or_default(),
                )?
                .as_str()
                .to_owned(),
            }),
            StorageProviderType::OauthFile => {
                let oauth = provider
                    .oauth_file
                    .as_ref()
                    .ok_or(ValidationError::OauthAccessTokenEmpty)?;
                let preset = OauthFilePreset::parse(&oauth.preset)?;
                Ok(EnrollmentProvider::OauthFile {
                    preset: preset.as_str().to_owned(),
                    access_token: validate_oauth_access_token(&oauth.access_token)?
                        .as_str()
                        .to_owned(),
                    refresh_token: oauth.refresh_token.clone(),
                    expires_at: oauth.expires_at.clone(),
                    file_id: oauth.file_id.clone(),
                    file_name: oauth.file_name.clone(),
                    account_email: oauth.account_email.clone(),
                })
            }
        },
        ReplicationType::Shared => Ok(EnrollmentProvider::SharedProviderGrant {
            sync_provider_type: capability.provider_type,
            oauth_preset: capability.oauth_preset,
            joiner_identity_kind: capability
                .shared_joiner_identity
                .map_or_else(|| "email".to_owned(), |kind| kind.as_str().to_owned()),
            joiner_identity: shared_joiner_identity
                .map(str::trim)
                .filter(|identity| !identity.is_empty())
                .ok_or(ValidationError::SharedJoinerIdentityRequired)?
                .to_owned(),
            storage_target_id: shared_storage_target_id
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(str::to_owned)
                .or_else(|| {
                    provider
                        .oauth_file
                        .as_ref()
                        .and_then(|oauth| oauth.folder_id.clone())
                        .filter(|id| !id.trim().is_empty())
                }),
        }),
    }
}

#[allow(clippy::too_many_arguments)]
#[must_use]
pub fn draft_storage_args(
    provider_type: StorageProviderType,
    github_pat: Option<&str>,
    github_repo: Option<&str>,
    oauth_preset: Option<OauthFilePreset>,
    oauth_access_token: Option<&str>,
    oauth_file_id: Option<&str>,
    oauth_file_name: Option<&str>,
) -> StorageConnectArgs {
    let mode = storage_mode_for_provider(provider_type, oauth_preset)
        .as_str()
        .to_owned();
    if provider_type == StorageProviderType::OauthFile {
        let file_name = non_empty(oauth_file_name)
            .or_else(|| non_empty(github_repo))
            .unwrap_or_else(|| DEFAULT_DRIVE_BACKUP_NAME.to_owned());
        return StorageConnectArgs {
            mode,
            pat: non_empty(oauth_access_token).unwrap_or_default(),
            repo: format_drive_storage_ref_raw(oauth_file_id.unwrap_or_default(), &file_name),
        };
    }
    StorageConnectArgs {
        mode,
        pat: github_pat.unwrap_or_default().to_owned(),
        repo: github_repo.unwrap_or_default().to_owned(),
    }
}

#[allow(clippy::too_many_arguments)]
pub fn vault_storage_args(
    local_vault_present: bool,
    is_authenticated: bool,
    sync_provider: Option<&StorageProviderData>,
    provider_type: StorageProviderType,
    github_pat: Option<&str>,
    github_repo: Option<&str>,
    oauth_preset: Option<OauthFilePreset>,
    oauth_access_token: Option<&str>,
    oauth_file_id: Option<&str>,
    oauth_file_name: Option<&str>,
) -> ValidationResult<StorageConnectArgs> {
    if local_vault_present {
        return Ok(StorageConnectArgs::local());
    }
    if is_authenticated && let Some(provider) = sync_provider {
        return storage_args_for_provider(provider);
    }
    Ok(draft_storage_args(
        provider_type,
        github_pat,
        github_repo,
        oauth_preset,
        oauth_access_token,
        oauth_file_id,
        oauth_file_name,
    ))
}

pub fn provider_storage_detail(
    provider: &StorageProviderData,
    labels: &ProviderStorageDetailLabels,
) -> ValidationResult<String> {
    let provider_type = StorageProviderType::parse(&provider.provider_type)?;
    match provider_type {
        StorageProviderType::Local => Ok(labels.this_device_desc.clone()),
        StorageProviderType::LocalFolder => Ok(provider
            .local_folder
            .as_ref()
            .and_then(|folder| non_empty(folder.directory_name.as_deref()))
            .unwrap_or_else(|| labels.local_folder_needs_reconnect.clone())),
        StorageProviderType::OauthFile => {
            let oauth = provider.oauth_file.as_ref();
            let preset = parse_oauth_preset(oauth.map(|oauth| oauth.preset.as_str()))?
                .unwrap_or(OauthFilePreset::GoogleDrive);
            let file = oauth
                .and_then(|oauth| non_empty(oauth.file_name.as_deref()))
                .unwrap_or_else(|| DEFAULT_DRIVE_BACKUP_NAME.to_owned());
            let account = match oauth {
                Some(oauth) => match non_empty(oauth.account_email.as_deref()) {
                    Some(email) => email,
                    None if non_empty(Some(oauth.access_token.as_str())).is_some() => {
                        match preset {
                            OauthFilePreset::ICloud => labels.icloud_signed_in.clone(),
                            OauthFilePreset::GoogleDrive => labels.google_signed_in.clone(),
                        }
                    }
                    None => match preset {
                        OauthFilePreset::ICloud => labels.icloud_not_signed_in.clone(),
                        OauthFilePreset::GoogleDrive => labels.google_not_signed_in.clone(),
                    },
                },
                None => labels.google_not_signed_in.clone(),
            };
            Ok(format!("{file} · {account}"))
        }
        StorageProviderType::Github => {
            let repo = non_empty(provider.github_repo.as_deref())
                .unwrap_or_else(|| DEFAULT_GITHUB_REPO_NAME.to_owned());
            let pat = match mask_github_pat(provider.github_pat.as_deref().unwrap_or_default()) {
                GithubPatMask::Hint(hint) => hint,
                GithubPatMask::NoToken => labels.no_token_saved.clone(),
            };
            Ok(format!("{repo} · {pat}"))
        }
    }
}

#[must_use]
pub fn localize_provider_label(label: &str, labels: &ProviderLabelLabels) -> String {
    if label == "This device" {
        return labels.this_device.clone();
    }
    if label == "GitHub" {
        return labels.github.clone();
    }
    if label == "Local backup" {
        return labels.local_folder.clone();
    }
    if let Some(directory) = label.strip_prefix("Local backup · ") {
        return format!("{} · {directory}", labels.local_folder);
    }
    if let Some(file) = label.strip_prefix("Google Drive · ") {
        return format!("{} · {file}", labels.google_drive);
    }
    if label == "Google Drive" {
        return labels.google_drive.clone();
    }
    if let Some(file) = label.strip_prefix("iCloud · ") {
        return format!("{} · {file}", labels.icloud);
    }
    if label == "iCloud" {
        return labels.icloud.clone();
    }
    if let Some(repo) = label.strip_prefix("GitHub · ") {
        return format!("{} · {repo}", labels.github);
    }
    label.to_owned()
}

/// Sync-target identity for one provider. Rows without enough captured
/// configuration collapse to [`SyncProviderTarget::Empty`] because they do not
/// name a usable sync provider target yet.
fn provider_target(provider: &StorageProviderData) -> SyncProviderTarget {
    match provider.provider_type.as_str() {
        "local" => SyncProviderTarget::Local,
        "local-folder" => SyncProviderTarget::LocalFolder(LocalFolderSyncTarget {
            directory_name: provider
                .local_folder
                .as_ref()
                .and_then(|folder| folder.directory_name.clone()),
            handle_id: provider
                .local_folder
                .as_ref()
                .and_then(|folder| folder.handle_id.clone()),
        }),
        "github" => SyncProviderTarget::Github(GithubSyncTarget {
            repo: non_empty(provider.github_repo.as_deref())
                .unwrap_or_else(|| DEFAULT_GITHUB_REPO_NAME.to_owned()),
            pat: match non_empty(provider.github_pat.as_deref()) {
                Some(pat) => pat,
                None => return SyncProviderTarget::Empty,
            },
        }),
        _ => match &provider.oauth_file {
            Some(oauth) => SyncProviderTarget::OauthFile(OauthFileSyncTarget {
                preset: OauthFilePreset::parse(&oauth.preset)
                    .unwrap_or(OauthFilePreset::GoogleDrive),
                file_id: oauth.file_id.clone(),
                file_name: oauth.file_name.clone(),
                account_email: oauth.account_email.clone(),
                access_token: Some(oauth.access_token.clone()),
            }),
            None => SyncProviderTarget::Empty,
        },
    }
}

/// Canonical dedup key for a provider (`None` when it has no stable identity).
#[must_use]
pub fn provider_target_key(provider: &StorageProviderData) -> Option<String> {
    sync_provider_target_key(&provider_target(provider))
}

/// Find an existing provider whose sync target matches `candidate`, optionally
/// skipping a provider by id (used to let a row match against itself on edit).
#[must_use]
pub fn find_duplicate_sync_provider(
    providers: &[StorageProviderData],
    candidate: &StorageProviderData,
    exclude_id: Option<&str>,
) -> Option<StorageProviderData> {
    let candidate_key = provider_target_key(candidate)?;
    providers
        .iter()
        .find(|provider| {
            if exclude_id.is_some_and(|excluded| provider.id == excluded) {
                return false;
            }
            provider_target_key(provider).as_deref() == Some(candidate_key.as_str())
        })
        .cloned()
}

/// Drop the deprecated `activeProviderId` field from a raw persisted snapshot,
/// returning the cleaned snapshot plus the legacy id (for one-time vault copy)
/// and whether anything changed.
#[must_use]
pub fn normalize_auth_snapshot(raw: &serde_json::Value) -> NormalizedAuthSnapshot {
    let object = raw.as_object();
    let providers = object
        .and_then(|object| object.get("providers"))
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value::<StorageProviderData>(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default();
    let legacy_active_provider_id = object
        .and_then(|object| object.get("activeProviderId"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let changed = object.is_some_and(|object| object.contains_key("activeProviderId"));
    let active_vault_store_id = object
        .and_then(|object| object.get("activeVaultStoreId"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    NormalizedAuthSnapshot {
        snapshot: AuthProvidersSnapshotData {
            providers,
            active_vault_store_id,
        },
        legacy_active_provider_id,
        changed,
    }
}

/// Backfill default repo / vault-file names onto older provider rows. Returns
/// the (possibly rebuilt) snapshot and whether any row changed.
#[must_use]
pub fn migrate_provider_fields(
    snapshot: &AuthProvidersSnapshotData,
) -> (AuthProvidersSnapshotData, bool) {
    let mut changed = false;
    let providers = snapshot
        .providers
        .iter()
        .map(|provider| match provider.provider_type.as_str() {
            "github" => {
                if non_empty(provider.github_repo.as_deref()).is_some() {
                    return provider.clone();
                }
                changed = true;
                StorageProviderData {
                    github_repo: Some(DEFAULT_GITHUB_REPO_NAME.to_owned()),
                    ..provider.clone()
                }
            }
            "oauth-file" => {
                let has_file_name = provider
                    .oauth_file
                    .as_ref()
                    .and_then(|oauth| non_empty(oauth.file_name.as_deref()))
                    .is_some();
                if has_file_name {
                    return provider.clone();
                }
                changed = true;
                let existing = provider.oauth_file.as_ref();
                StorageProviderData {
                    oauth_file: Some(OAuthFileConfigData {
                        preset: existing.map_or_else(
                            || OauthFilePreset::GoogleDrive.as_str().to_owned(),
                            |oauth| oauth.preset.clone(),
                        ),
                        access_token: existing
                            .map(|oauth| oauth.access_token.clone())
                            .unwrap_or_default(),
                        refresh_token: existing.and_then(|oauth| oauth.refresh_token.clone()),
                        expires_at: existing.and_then(|oauth| oauth.expires_at.clone()),
                        file_id: existing.and_then(|oauth| oauth.file_id.clone()),
                        folder_id: existing.and_then(|oauth| oauth.folder_id.clone()),
                        account_email: existing.and_then(|oauth| oauth.account_email.clone()),
                        file_name: Some(DEFAULT_DRIVE_BACKUP_NAME.to_owned()),
                    }),
                    local_folder: None,
                    ..provider.clone()
                }
            }
            _ => provider.clone(),
        })
        .collect();
    if !changed {
        return (snapshot.clone(), false);
    }
    (
        AuthProvidersSnapshotData {
            providers,
            active_vault_store_id: snapshot.active_vault_store_id.clone(),
        },
        true,
    )
}

/// Ensure a `local` provider row exists for the active vault, prepending one
/// when missing. Returns the snapshot and whether a row was added. `new_id` /
/// `created_at` are injected by the caller (the browser owns id/time sources).
#[must_use]
pub fn ensure_local_provider_row(
    snapshot: &AuthProvidersSnapshotData,
    active_store_id: Option<&str>,
    new_id: &str,
    created_at: &str,
) -> (AuthProvidersSnapshotData, bool) {
    let store_id =
        non_empty(active_store_id).or_else(|| non_empty(snapshot.active_vault_store_id.as_deref()));
    let has_local_for_vault = snapshot.providers.iter().any(|provider| {
        provider.provider_type == "local"
            && match (&store_id, non_empty(provider.store_id.as_deref())) {
                (None, _) | (Some(_), None) => true,
                (Some(active), Some(existing)) => *active == existing,
            }
    });
    if has_local_for_vault {
        return (snapshot.clone(), false);
    }
    let local = StorageProviderData {
        id: new_id.to_owned(),
        provider_type: StorageProviderType::Local.as_str().to_owned(),
        label: sync_provider_default_label(StorageProviderType::Local, None, None),
        github_pat: None,
        github_repo: None,
        oauth_file: None,
        local_folder: None,
        store_id,
        last_synced_version: None,
        last_synced_at: None,
        last_sync_revision: None,
        last_common_content_hash: None,
        created_at: created_at.to_owned(),
    };
    let mut providers = Vec::with_capacity(snapshot.providers.len() + 1);
    providers.push(local);
    providers.extend(snapshot.providers.iter().cloned());
    (
        AuthProvidersSnapshotData {
            providers,
            active_vault_store_id: snapshot.active_vault_store_id.clone(),
        },
        true,
    )
}

/// One-time seeding of a provider row from legacy `localStorage` values. Returns
/// `Some(new_snapshot)` only when the snapshot has no providers yet and legacy
/// state exists; the caller then clears the legacy keys.
#[must_use]
pub fn seed_provider_from_legacy_storage(
    snapshot: &AuthProvidersSnapshotData,
    legacy_mode: Option<&str>,
    legacy_pat: &str,
    new_id: &str,
    created_at: &str,
) -> Option<AuthProvidersSnapshotData> {
    if !snapshot.providers.is_empty() {
        return None;
    }
    let mode = non_empty(legacy_mode);
    let pat = legacy_pat.trim();
    if mode.is_none() && pat.is_empty() {
        return None;
    }
    let is_github = mode.as_deref() == Some("github");
    let provider_type = if is_github {
        StorageProviderType::Github
    } else {
        StorageProviderType::Local
    };
    let provider = StorageProviderData {
        id: new_id.to_owned(),
        provider_type: provider_type.as_str().to_owned(),
        label: sync_provider_default_label(provider_type, None, None),
        github_pat: is_github.then(|| pat.to_owned()),
        github_repo: is_github.then(|| DEFAULT_GITHUB_REPO_NAME.to_owned()),
        oauth_file: None,
        local_folder: None,
        store_id: None,
        last_synced_version: None,
        last_synced_at: None,
        last_sync_revision: None,
        last_common_content_hash: None,
        created_at: created_at.to_owned(),
    };
    Some(AuthProvidersSnapshotData {
        providers: vec![provider],
        active_vault_store_id: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn github_provider(id: &str, repo: &str, pat: &str) -> StorageProviderData {
        StorageProviderData {
            id: id.to_owned(),
            provider_type: "github".to_owned(),
            label: "GitHub".to_owned(),
            github_pat: Some(pat.to_owned()),
            github_repo: Some(repo.to_owned()),
            oauth_file: None,
            local_folder: None,
            store_id: None,
            last_synced_version: None,
            last_synced_at: None,
            last_sync_revision: None,
            last_common_content_hash: None,
            created_at: "2026-06-24T00:00:00.000Z".to_owned(),
        }
    }

    fn local_folder_provider(id: &str, handle_id: &str) -> StorageProviderData {
        StorageProviderData {
            id: id.to_owned(),
            provider_type: "local-folder".to_owned(),
            label: "Local backup".to_owned(),
            github_pat: None,
            github_repo: None,
            oauth_file: None,
            local_folder: Some(LocalFolderConfigData {
                directory_name: Some("Nook Backup".to_owned()),
                handle_id: Some(handle_id.to_owned()),
            }),
            store_id: None,
            last_synced_version: None,
            last_synced_at: None,
            last_sync_revision: None,
            last_common_content_hash: None,
            created_at: "2026-06-24T00:00:00.000Z".to_owned(),
        }
    }

    fn oauth_provider(
        id: &str,
        preset: &str,
        file_id: Option<&str>,
        file_name: &str,
    ) -> StorageProviderData {
        StorageProviderData {
            id: id.to_owned(),
            provider_type: "oauth-file".to_owned(),
            label: "Google Drive".to_owned(),
            github_pat: None,
            github_repo: None,
            oauth_file: Some(OAuthFileConfigData {
                preset: preset.to_owned(),
                access_token: " token ".to_owned(),
                file_id: file_id.map(str::to_owned),
                file_name: Some(file_name.to_owned()),
                ..OAuthFileConfigData::default()
            }),
            local_folder: None,
            store_id: None,
            last_synced_version: None,
            last_synced_at: None,
            last_sync_revision: None,
            last_common_content_hash: None,
            created_at: "2026-06-24T00:00:00.000Z".to_owned(),
        }
    }

    fn detail_labels() -> ProviderStorageDetailLabels {
        ProviderStorageDetailLabels {
            this_device_desc: "This device desc".to_owned(),
            no_token_saved: "No token saved".to_owned(),
            google_signed_in: "Signed in with Google".to_owned(),
            icloud_signed_in: "Signed in with iCloud".to_owned(),
            google_not_signed_in: "Not signed in".to_owned(),
            icloud_not_signed_in: "Not signed in with iCloud".to_owned(),
            local_folder_needs_reconnect: "Choose folder".to_owned(),
        }
    }

    fn provider_label_labels() -> ProviderLabelLabels {
        ProviderLabelLabels {
            this_device: "This device localized".to_owned(),
            github: "GitHub localized".to_owned(),
            local_folder: "Local folder localized".to_owned(),
            google_drive: "Google Drive localized".to_owned(),
            icloud: "iCloud localized".to_owned(),
        }
    }

    #[test]
    fn normalize_handles_missing_value() {
        let result = normalize_auth_snapshot(&serde_json::Value::Null);
        assert_eq!(result.snapshot, AuthProvidersSnapshotData::default());
        assert_eq!(result.legacy_active_provider_id, None);
        assert!(!result.changed);
    }

    #[test]
    fn normalize_strips_legacy_active_provider_id() {
        let raw = json!({
            "providers": [{"id": "a", "type": "github", "label": "GitHub", "createdAt": ""}],
            "activeProviderId": "a",
        });
        let result = normalize_auth_snapshot(&raw);
        assert_eq!(result.snapshot.providers.len(), 1);
        assert_eq!(result.snapshot.providers[0].id, "a");
        assert_eq!(result.legacy_active_provider_id.as_deref(), Some("a"));
        assert!(result.changed);
        // Re-serialization drops the deprecated field.
        let value = serde_json::to_value(&result.snapshot).unwrap();
        assert!(value.get("activeProviderId").is_none());
    }

    #[test]
    fn normalize_keeps_active_vault_store_id() {
        let raw = json!({ "providers": [], "activeVaultStoreId": "vault-1" });
        let result = normalize_auth_snapshot(&raw);
        assert_eq!(
            result.snapshot.active_vault_store_id.as_deref(),
            Some("vault-1")
        );
        assert!(!result.changed);
    }

    #[test]
    fn find_duplicate_matches_github_repo_and_pat() {
        let existing = github_provider("gh-existing", "nook-crdt-test-1", "github_pat_11AAAA");
        let candidate = github_provider("gh-new", "nook-crdt-test-1", "github_pat_11AAAA");
        let found = find_duplicate_sync_provider(&[existing], &candidate, None);
        assert_eq!(
            found.map(|provider| provider.id).as_deref(),
            Some("gh-existing")
        );
    }

    #[test]
    fn github_without_pat_has_no_stable_sync_identity() {
        let provider = StorageProviderData {
            github_pat: None,
            ..github_provider("gh-draft", "nook", "github_pat_11AAAA")
        };
        assert_eq!(provider_target_key(&provider), None);
    }

    #[test]
    fn find_duplicate_ignores_excluded_id() {
        let existing = github_provider("gh-self", "nook", "github_pat_11AAAA");
        let found = find_duplicate_sync_provider(
            std::slice::from_ref(&existing),
            &existing,
            Some("gh-self"),
        );
        assert!(found.is_none());
    }

    #[test]
    fn find_duplicate_returns_none_when_distinct() {
        let existing = github_provider("gh-a", "alpha", "github_pat_11AAAA");
        let candidate = github_provider("gh-b", "beta", "github_pat_11AAAA");
        assert!(find_duplicate_sync_provider(&[existing], &candidate, None).is_none());
    }

    #[test]
    fn find_duplicate_matches_local_folder_handle() {
        let existing = local_folder_provider("folder-a", "handle-1");
        let candidate = local_folder_provider("folder-b", "handle-1");
        let found = find_duplicate_sync_provider(&[existing], &candidate, None);
        assert_eq!(
            found.map(|provider| provider.id).as_deref(),
            Some("folder-a")
        );
    }

    #[test]
    fn storage_args_for_configured_provider_rows_match_wasm_connect_contract() {
        assert_eq!(
            storage_args_for_provider(&github_provider("gh", " team-vault ", " pat ")).unwrap(),
            StorageConnectArgs {
                mode: "github".to_owned(),
                pat: "pat".to_owned(),
                repo: "team-vault".to_owned(),
            }
        );
        assert_eq!(
            storage_args_for_provider(&oauth_provider(
                "drive",
                "google-drive",
                Some(" file-1 "),
                " events "
            ))
            .unwrap(),
            StorageConnectArgs {
                mode: "google-drive".to_owned(),
                pat: "token".to_owned(),
                repo: "file-1\tevents".to_owned(),
            }
        );
        assert_eq!(
            storage_args_for_provider(&local_folder_provider("folder", "handle-1")).unwrap(),
            StorageConnectArgs::local()
        );
    }

    #[test]
    fn provider_storage_detail_matches_provider_rows() {
        let labels = detail_labels();
        assert_eq!(
            provider_storage_detail(
                &StorageProviderData {
                    id: "local".to_owned(),
                    provider_type: "local".to_owned(),
                    label: "This device".to_owned(),
                    github_pat: None,
                    github_repo: None,
                    oauth_file: None,
                    local_folder: None,
                    store_id: None,
                    last_synced_version: None,
                    last_synced_at: None,
                    last_sync_revision: None,
                    last_common_content_hash: None,
                    created_at: "2026-06-24T00:00:00.000Z".to_owned(),
                },
                &labels,
            )
            .unwrap(),
            "This device desc"
        );
        assert_eq!(
            provider_storage_detail(
                &github_provider("gh", " team-vault ", " github_pat_11AAAAbbbbCCCC "),
                &labels,
            )
            .unwrap(),
            "team-vault · github_pat_11A…"
        );
        assert_eq!(
            provider_storage_detail(
                &StorageProviderData {
                    github_pat: Some(" ".to_owned()),
                    github_repo: Some(" ".to_owned()),
                    ..github_provider("gh", "team-vault", "github_pat_11AAAAbbbbCCCC")
                },
                &labels,
            )
            .unwrap(),
            "nook · No token saved"
        );
        assert_eq!(
            provider_storage_detail(&local_folder_provider("folder", "handle-1"), &labels).unwrap(),
            "Nook Backup"
        );
        assert_eq!(
            provider_storage_detail(
                &StorageProviderData {
                    local_folder: None,
                    ..local_folder_provider("folder", "handle-1")
                },
                &labels,
            )
            .unwrap(),
            "Choose folder"
        );
        assert_eq!(
            provider_storage_detail(
                &StorageProviderData {
                    oauth_file: Some(OAuthFileConfigData {
                        account_email: Some("person@example.com".to_owned()),
                        ..oauth_provider("drive", "google-drive", None, " events ")
                            .oauth_file
                            .unwrap()
                    }),
                    ..oauth_provider("drive", "google-drive", None, " events ")
                },
                &labels,
            )
            .unwrap(),
            "events · person@example.com"
        );
        assert_eq!(
            provider_storage_detail(&oauth_provider("icloud", "icloud", None, " "), &labels)
                .unwrap(),
            format!("{DEFAULT_DRIVE_BACKUP_NAME} · Signed in with iCloud")
        );
    }

    #[test]
    fn localize_provider_label_preserves_provider_detail_suffixes() {
        let labels = provider_label_labels();
        assert_eq!(
            localize_provider_label("This device", &labels),
            "This device localized"
        );
        assert_eq!(
            localize_provider_label("GitHub", &labels),
            "GitHub localized"
        );
        assert_eq!(
            localize_provider_label("GitHub · team-vault", &labels),
            "GitHub localized · team-vault"
        );
        assert_eq!(
            localize_provider_label("Local backup · Nook Backup", &labels),
            "Local folder localized · Nook Backup"
        );
        assert_eq!(
            localize_provider_label("Google Drive · work.yaml", &labels),
            "Google Drive localized · work.yaml"
        );
        assert_eq!(
            localize_provider_label("iCloud · home.yaml", &labels),
            "iCloud localized · home.yaml"
        );
        assert_eq!(
            localize_provider_label("Custom provider", &labels),
            "Custom provider"
        );
    }

    #[test]
    fn draft_storage_args_preserve_legacy_local_and_oauth_fallbacks() {
        assert_eq!(
            draft_storage_args(
                StorageProviderType::Local,
                Some("draft-pat"),
                Some("draft-repo"),
                None,
                None,
                None,
                None,
            ),
            StorageConnectArgs {
                mode: "local".to_owned(),
                pat: "draft-pat".to_owned(),
                repo: "draft-repo".to_owned(),
            }
        );
        assert_eq!(
            draft_storage_args(
                StorageProviderType::OauthFile,
                None,
                Some(" repo-fallback "),
                Some(OauthFilePreset::ICloud),
                Some(" token "),
                Some(" file-id "),
                Some(" "),
            ),
            StorageConnectArgs {
                mode: "icloud".to_owned(),
                pat: "token".to_owned(),
                repo: "file-id\trepo-fallback".to_owned(),
            }
        );
    }

    #[test]
    fn vault_storage_args_prefers_local_cache_then_authenticated_provider() {
        let provider = github_provider("gh", "team-vault", "pat");
        assert_eq!(
            vault_storage_args(
                true,
                true,
                Some(&provider),
                StorageProviderType::Github,
                Some("draft-pat"),
                Some("draft-repo"),
                None,
                None,
                None,
                None,
            )
            .unwrap(),
            StorageConnectArgs::local()
        );
        assert_eq!(
            vault_storage_args(
                false,
                true,
                Some(&provider),
                StorageProviderType::Github,
                Some("draft-pat"),
                Some("draft-repo"),
                None,
                None,
                None,
                None,
            )
            .unwrap(),
            StorageConnectArgs {
                mode: "github".to_owned(),
                pat: "pat".to_owned(),
                repo: "team-vault".to_owned(),
            }
        );
        assert_eq!(
            vault_storage_args(
                false,
                false,
                Some(&provider),
                StorageProviderType::Github,
                Some("draft-pat"),
                Some("draft-repo"),
                None,
                None,
                None,
                None,
            )
            .unwrap(),
            StorageConnectArgs {
                mode: "github".to_owned(),
                pat: "draft-pat".to_owned(),
                repo: "draft-repo".to_owned(),
            }
        );
    }

    #[test]
    fn migrate_backfills_github_repo() {
        let snapshot = AuthProvidersSnapshotData {
            providers: vec![StorageProviderData {
                github_repo: None,
                ..github_provider("gh", "nook", "pat")
            }],
            active_vault_store_id: None,
        };
        let (migrated, changed) = migrate_provider_fields(&snapshot);
        assert!(changed);
        assert_eq!(
            migrated.providers[0].github_repo.as_deref(),
            Some(DEFAULT_GITHUB_REPO_NAME)
        );
    }

    #[test]
    fn migrate_backfills_oauth_file_name_preserving_fields() {
        let snapshot = AuthProvidersSnapshotData {
            providers: vec![StorageProviderData {
                id: "gd".to_owned(),
                provider_type: "oauth-file".to_owned(),
                label: "Google Drive".to_owned(),
                github_pat: None,
                github_repo: None,
                oauth_file: Some(OAuthFileConfigData {
                    preset: "icloud".to_owned(),
                    access_token: "tok".to_owned(),
                    account_email: Some("me@example.com".to_owned()),
                    ..OAuthFileConfigData::default()
                }),
                local_folder: None,
                store_id: None,
                last_synced_version: None,
                last_synced_at: None,
                last_sync_revision: None,
                last_common_content_hash: None,
                created_at: "2026-06-24T00:00:00.000Z".to_owned(),
            }],
            active_vault_store_id: None,
        };
        let (migrated, changed) = migrate_provider_fields(&snapshot);
        assert!(changed);
        let oauth = migrated.providers[0].oauth_file.as_ref().unwrap();
        assert_eq!(oauth.file_name.as_deref(), Some(DEFAULT_DRIVE_BACKUP_NAME));
        assert_eq!(oauth.preset, "icloud");
        assert_eq!(oauth.access_token, "tok");
        assert_eq!(oauth.account_email.as_deref(), Some("me@example.com"));
    }

    #[test]
    fn migrate_is_noop_when_up_to_date() {
        let snapshot = AuthProvidersSnapshotData {
            providers: vec![github_provider("gh", "nook", "pat")],
            active_vault_store_id: None,
        };
        let (migrated, changed) = migrate_provider_fields(&snapshot);
        assert!(!changed);
        assert_eq!(migrated, snapshot);
    }

    #[test]
    fn ensure_local_row_added_when_missing() {
        let snapshot = AuthProvidersSnapshotData {
            providers: vec![github_provider("gh", "nook", "pat")],
            active_vault_store_id: None,
        };
        let (next, changed) =
            ensure_local_provider_row(&snapshot, None, "local-1", "2026-06-24T00:00:00.000Z");
        assert!(changed);
        assert_eq!(next.providers.len(), 2);
        assert_eq!(next.providers[0].provider_type, "local");
        assert_eq!(next.providers[0].label, "This device");
    }

    #[test]
    fn ensure_local_row_noop_when_present() {
        let snapshot = AuthProvidersSnapshotData {
            providers: vec![StorageProviderData {
                id: "local".to_owned(),
                provider_type: "local".to_owned(),
                label: "This device".to_owned(),
                github_pat: None,
                github_repo: None,
                oauth_file: None,
                local_folder: None,
                store_id: Some("vault-1".to_owned()),
                last_synced_version: None,
                last_synced_at: None,
                last_sync_revision: None,
                last_common_content_hash: None,
                created_at: "2026-06-24T00:00:00.000Z".to_owned(),
            }],
            active_vault_store_id: Some("vault-1".to_owned()),
        };
        let (next, changed) = ensure_local_provider_row(&snapshot, Some("vault-1"), "local-2", "x");
        assert!(!changed);
        assert_eq!(next.providers.len(), 1);
    }

    #[test]
    fn seed_from_legacy_github() {
        let snapshot = AuthProvidersSnapshotData::default();
        let seeded = seed_provider_from_legacy_storage(
            &snapshot,
            Some("github"),
            "github_pat_11AAAA",
            "p1",
            "2026-06-24T00:00:00.000Z",
        )
        .expect("seeded");
        assert_eq!(seeded.providers.len(), 1);
        let provider = &seeded.providers[0];
        assert_eq!(provider.provider_type, "github");
        assert_eq!(provider.github_pat.as_deref(), Some("github_pat_11AAAA"));
        assert_eq!(
            provider.github_repo.as_deref(),
            Some(DEFAULT_GITHUB_REPO_NAME)
        );
    }

    #[test]
    fn seed_from_legacy_local_mode() {
        let seeded = seed_provider_from_legacy_storage(
            &AuthProvidersSnapshotData::default(),
            Some("local"),
            "",
            "p1",
            "t",
        )
        .expect("seeded");
        assert_eq!(seeded.providers[0].provider_type, "local");
        assert!(seeded.providers[0].github_pat.is_none());
    }

    #[test]
    fn seed_skipped_when_providers_exist_or_no_legacy_state() {
        let with_providers = AuthProvidersSnapshotData {
            providers: vec![github_provider("gh", "nook", "pat")],
            active_vault_store_id: None,
        };
        assert!(
            seed_provider_from_legacy_storage(&with_providers, Some("github"), "pat", "p", "t")
                .is_none()
        );
        assert!(
            seed_provider_from_legacy_storage(
                &AuthProvidersSnapshotData::default(),
                None,
                "",
                "p",
                "t"
            )
            .is_none()
        );
    }

    #[test]
    fn provider_row_replication_capability_matches_provider_preset() {
        let github = github_provider("gh", "nook", "pat");
        assert!(validate_provider_row_replication(&github, ReplicationType::Personal).is_ok());
        assert!(validate_provider_row_replication(&github, ReplicationType::Shared).is_err());

        let gdrive = StorageProviderData {
            id: "gd".to_owned(),
            provider_type: "oauth-file".to_owned(),
            label: "Google Drive".to_owned(),
            github_pat: None,
            github_repo: None,
            oauth_file: Some(OAuthFileConfigData {
                preset: "google-drive".to_owned(),
                access_token: "tok".to_owned(),
                account_email: Some("joiner@example.com".to_owned()),
                ..OAuthFileConfigData::default()
            }),
            local_folder: None,
            store_id: None,
            last_synced_version: None,
            last_synced_at: None,
            last_sync_revision: None,
            last_common_content_hash: None,
            created_at: "2026-06-24T00:00:00.000Z".to_owned(),
        };
        let capability =
            validate_provider_row_replication(&gdrive, ReplicationType::Shared).unwrap();
        assert!(capability.supports_shared);
        assert_eq!(
            capability.shared_joiner_identity,
            Some(crate::SharedJoinerIdentityKind::Email)
        );
    }

    #[test]
    fn enrollment_provider_builder_enforces_replication_before_payload_creation() {
        let shared = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..VaultArchitecture::default_legacy()
        };
        let github = github_provider("gh", "nook", "github_pat_123");
        assert!(enrollment_provider_for_architecture(&github, &shared, Some("a@b.com")).is_err());

        let gdrive = oauth_provider(
            "drive",
            OauthFilePreset::GoogleDrive.as_str(),
            Some("file-123"),
            "nook.yaml",
        );
        let grant =
            enrollment_provider_for_architecture(&gdrive, &shared, Some("joiner@example.com"))
                .unwrap();
        assert_eq!(
            grant,
            EnrollmentProvider::SharedProviderGrant {
                sync_provider_type: "oauth-file".to_owned(),
                oauth_preset: Some("google-drive".to_owned()),
                joiner_identity_kind: "email".to_owned(),
                joiner_identity: "joiner@example.com".to_owned(),
                storage_target_id: None,
            }
        );

        let granted = enrollment_provider_for_architecture_with_storage_target(
            &gdrive,
            &shared,
            Some("joiner@example.com"),
            Some("shared-folder-xyz"),
        )
        .unwrap();
        assert_eq!(
            granted,
            EnrollmentProvider::SharedProviderGrant {
                sync_provider_type: "oauth-file".to_owned(),
                oauth_preset: Some("google-drive".to_owned()),
                joiner_identity_kind: "email".to_owned(),
                joiner_identity: "joiner@example.com".to_owned(),
                storage_target_id: Some("shared-folder-xyz".to_owned()),
            }
        );

        let personal = VaultArchitecture::default_legacy();
        let provider = enrollment_provider_for_architecture(&gdrive, &personal, None).unwrap();
        assert_eq!(
            provider,
            EnrollmentProvider::OauthFile {
                preset: "google-drive".to_owned(),
                access_token: "token".to_owned(),
                refresh_token: None,
                expires_at: None,
                file_id: Some("file-123".to_owned()),
                file_name: Some("nook.yaml".to_owned()),
                account_email: None,
            }
        );
    }
}
