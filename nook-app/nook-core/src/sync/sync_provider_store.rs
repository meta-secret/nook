//! Persisted sync-provider snapshot model plus the pure transforms the web app
//! runs over it (normalize, field migration, local-row seeding, dedup).
//!
//! The browser stores an [`AuthProvidersSnapshotData`] in the `nook_auth`
//! `IndexedDB` database. All shaping of that data lives here so it is unit-tested
//! in Rust; `nook-wasm` owns the `IndexedDB` I/O and device-key sealing, and the
//! web layer keeps only thin call adapters plus i18n presentation.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::errors::{ValidationError, ValidationResult};
use crate::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, EnrollmentProvider, GithubPatMask,
    GithubSyncTarget, GoogleDriveMode, ICloudMode, ICloudSharedTarget, LocalFolderSyncTarget,
    OauthFilePreset, OauthFileSyncTarget, OnboardingType, PersonalEnrollmentProvider,
    ProviderReplicationCapability, ReplicationType, SharedEnrollmentProvider, StorageMode,
    StorageProviderType, SyncProviderTarget, VaultArchitecture, format_drive_storage_ref_raw,
    mask_github_pat, provider_replication_capability, storage_mode_for_provider,
    sync_provider_default_label, sync_provider_target_key, validate_github_pat,
    validate_github_repo_name, validate_oauth_access_token, validate_provider_replication,
};

/// OAuth-file (Google Drive / iCloud) credential block for a stored provider.
///
/// Field names are `camelCase` on the wire to match the structured-clone object
/// the web layer and e2e seeders read/write directly in `IndexedDB`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct OAuthFileConfig {
    pub preset: OauthFilePreset,
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
    /// Explicit Google Drive provider mode.
    pub drive_mode: GoogleDriveMode,
    /// Shared-mode My Drive folder id (`drive.file` writes plus cross-account
    /// `drive.readonly`). Private-mode
    /// providers leave this unset and continue using `drive.appdata`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    /// Explicit iCloud provider mode.
    #[serde(rename = "iCloudMode")]
    pub icloud_mode: ICloudMode,
    /// Opaque, validated `ICloudSharedTarget` storage id. It contains `CloudKit`
    /// share/zone routing only and never contains an account credential.
    #[serde(
        default,
        rename = "iCloudShareTarget",
        alias = "icloudShareTarget",
        skip_serializing_if = "Option::is_none"
    )]
    pub icloud_share_target: Option<String>,
}

pub type OAuthFileConfigData = OAuthFileConfig;

impl OAuthFileConfigData {
    #[must_use]
    pub const fn resolved_google_drive_mode(&self) -> GoogleDriveMode {
        self.drive_mode
    }

    #[must_use]
    pub const fn resolved_icloud_mode(&self) -> ICloudMode {
        self.icloud_mode
    }
}

/// Merge a fresh Google OAuth access token into the persisted provider shape.
/// Browser/native SDK adapters obtain the token; core owns which provider
/// target metadata survives credential refresh.
#[must_use]
pub fn google_oauth_tokens_to_config(
    access_token: &str,
    expires_at: &str,
    existing: Option<&OAuthFileConfigData>,
) -> OAuthFileConfigData {
    let existing = existing.cloned().unwrap_or_default();
    let drive_mode = existing.resolved_google_drive_mode();
    OAuthFileConfigData {
        preset: OauthFilePreset::GoogleDrive,
        access_token: access_token.to_owned(),
        refresh_token: existing.refresh_token,
        expires_at: Some(expires_at.to_owned()),
        file_id: existing.file_id,
        file_name: existing.file_name,
        account_email: existing.account_email,
        drive_mode,
        folder_id: existing.folder_id,
        icloud_mode: ICloudMode::Private,
        icloud_share_target: None,
    }
}

/// Merge a fresh `CloudKit` web-auth token into the persisted provider shape.
/// Provider SDK ceremony state stays in the host adapter; target preservation
/// and private/shared mode inference stay portable.
#[must_use]
pub fn icloud_oauth_tokens_to_config(
    access_token: &str,
    account_name: Option<&str>,
    existing: Option<&OAuthFileConfigData>,
) -> OAuthFileConfigData {
    let existing = existing.cloned().unwrap_or_default();
    let icloud_mode = existing.resolved_icloud_mode();
    OAuthFileConfigData {
        preset: OauthFilePreset::ICloud,
        access_token: access_token.to_owned(),
        refresh_token: existing.refresh_token,
        expires_at: existing.expires_at,
        file_id: existing.file_id,
        file_name: existing.file_name,
        account_email: account_name.map(str::to_owned).or(existing.account_email),
        drive_mode: GoogleDriveMode::Private,
        folder_id: None,
        icloud_mode,
        icloud_share_target: existing.icloud_share_target,
    }
}

/// Switch iCloud storage mode without carrying an auth token or `CloudKit`
/// share target issued for the previous mode into the new connection.
#[must_use]
pub fn set_icloud_provider_mode(
    config: &OAuthFileConfigData,
    mode: ICloudMode,
) -> OAuthFileConfigData {
    let mut switched = config.clone();
    switched.icloud_mode = mode;
    switched.access_token.clear();
    switched.refresh_token = None;
    switched.expires_at = None;
    switched.account_email = None;
    switched.file_id = None;
    switched.icloud_share_target = None;
    switched
}

/// Switch Google Drive storage mode without carrying an OAuth token issued for
/// the previous scope into the new mode. Provider target ids are also scoped to
/// their mode, so stale app-data or shared-folder references are discarded.
#[must_use]
pub fn set_google_drive_provider_mode(
    config: &OAuthFileConfigData,
    mode: GoogleDriveMode,
) -> OAuthFileConfigData {
    let mut switched = config.clone();
    switched.drive_mode = mode;
    switched.access_token.clear();
    switched.refresh_token = None;
    switched.expires_at = None;
    switched.account_email = None;
    switched.file_id = None;
    switched.folder_id = None;
    switched
}

/// Bind an authenticated Google Drive provider to a shared folder without
/// discarding its current OAuth credentials. The shared folder becomes the
/// provider target, so any stale private app-data file id is removed.
pub fn bind_google_drive_shared_folder(
    config: &OAuthFileConfigData,
    folder_ref: &str,
) -> ValidationResult<OAuthFileConfigData> {
    let folder_id = crate::normalize_google_drive_folder_ref(folder_ref)?;
    let mut bound = config.clone();
    bound.drive_mode = GoogleDriveMode::Shared;
    bound.folder_id = Some(folder_id.into_inner());
    bound.file_id = None;
    Ok(bound)
}

/// Browser-local File System Access folder handle metadata.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct LocalFolderConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directory_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle_id: Option<String>,
}

pub type LocalFolderConfigData = LocalFolderConfig;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ProviderSyncCheckpoint {
    #[default]
    NeverSynced,
    Synced {
        version: ProviderSyncedVaultVersion,
        synced_at: String,
        revision: ProviderSyncRevision,
        common_content_hash: String,
    },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "version", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ProviderSyncedVaultVersion {
    #[default]
    Unknown,
    Version(i64),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "revision", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ProviderSyncRevision {
    #[default]
    Unknown,
    Revision(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderSyncRevisionRef<'a> {
    Unreported,
    Revision(&'a str),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ManagerStoreScopeRef<'a> {
    Unscoped,
    Store(&'a str),
}

/// One persisted sync provider row.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct StorageProvider {
    pub id: String,
    #[serde(rename = "type")]
    #[tsify(type = "StorageProviderType")]
    pub provider_type: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github_pat: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github_repo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth_file: Option<OAuthFileConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_folder: Option<LocalFolderConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store_id: Option<String>,
    #[serde(default)]
    pub sync_checkpoint: ProviderSyncCheckpoint,
    pub created_at: String,
}

impl StorageProvider {
    #[must_use]
    pub fn github(id: &str, label: &str, pat: &str, repo: &str, created_at: &str) -> Self {
        Self {
            id: id.to_owned(),
            provider_type: "github".to_owned(),
            label: label.to_owned(),
            github_pat: Some(pat.to_owned()),
            github_repo: Some(repo.to_owned()),
            oauth_file: None,
            local_folder: None,
            store_id: None,
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: created_at.to_owned(),
        }
    }
}

pub type StorageProviderData = StorageProvider;

/// The full persisted snapshot: provider rows plus the active vault scope.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthProvidersSnapshot {
    pub providers: Vec<StorageProvider>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_vault_store_id: Option<String>,
}

pub type AuthProvidersSnapshotData = AuthProvidersSnapshot;

/// Result of [`normalize_auth_snapshot`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedAuthSnapshot {
    pub snapshot: AuthProvidersSnapshot,
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

/// Provider rows visible for the active vault.
#[must_use]
pub fn active_vault_providers(
    providers: &[StorageProviderData],
    active_store_id: Option<&str>,
) -> Vec<StorageProviderData> {
    let active_store_id = active_store_id.map(str::trim).filter(|id| !id.is_empty());
    match active_store_id {
        None => providers.to_vec(),
        Some(active_store_id) => providers
            .iter()
            .filter(|provider| provider.store_id.as_deref() == Some(active_store_id))
            .cloned()
            .collect(),
    }
}

/// Replace the complete provider grant set for `incoming`'s active vault while
/// preserving provider rows owned by every other vault.
#[must_use]
pub fn replace_active_vault_provider_grants(
    existing: &AuthProvidersSnapshotData,
    incoming: &AuthProvidersSnapshotData,
) -> AuthProvidersSnapshotData {
    let Some(active_store_id) = incoming
        .active_vault_store_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    else {
        return incoming.clone();
    };
    let mut providers = existing
        .providers
        .iter()
        .filter_map(|provider| {
            let provider_store_id = provider
                .store_id
                .as_deref()
                .map(str::trim)
                .filter(|id| !id.is_empty());
            match provider_store_id {
                Some(store_id) if store_id == active_store_id => None,
                Some(_) => Some(provider.clone()),
                None => None,
            }
        })
        .collect::<Vec<_>>();
    providers.extend(incoming.providers.iter().cloned().map(|mut provider| {
        provider.store_id = Some(active_store_id.to_owned());
        provider
    }));
    AuthProvidersSnapshotData {
        providers,
        active_vault_store_id: Some(active_store_id.to_owned()),
    }
}

pub fn sync_providers_for_active_vault(
    providers: &[StorageProviderData],
    active_store_id: Option<&str>,
) -> ValidationResult<Vec<StorageProviderData>> {
    active_vault_providers(providers, active_store_id)
        .into_iter()
        .filter_map(|provider| {
            StorageProviderType::parse(&provider.provider_type)
                .map(|provider_type| {
                    (provider_type != StorageProviderType::Local).then_some(provider)
                })
                .transpose()
        })
        .collect()
}

pub fn local_provider_for_active_vault(
    providers: &[StorageProviderData],
    active_store_id: Option<&str>,
) -> ValidationResult<Option<StorageProviderData>> {
    for provider in active_vault_providers(providers, active_store_id) {
        if StorageProviderType::parse(&provider.provider_type)? == StorageProviderType::Local {
            return Ok(Some(provider));
        }
    }
    Ok(None)
}

#[must_use]
pub fn provider_label_by_id(
    providers: &[StorageProviderData],
    provider_id: &str,
) -> Option<String> {
    providers
        .iter()
        .find(|provider| provider.id == provider_id)
        .map(|provider| provider.label.clone())
}

/// Keep only non-secret local rows while the device identity is locked.
/// Unknown or malformed provider types fail closed and are discarded.
#[must_use]
pub fn providers_visible_while_device_locked(
    providers: &[StorageProviderData],
) -> Vec<StorageProviderData> {
    providers
        .iter()
        .filter(|provider| provider.provider_type == StorageProviderType::Local.as_str())
        .cloned()
        .collect()
}

/// Resolve the remote reference passed to the manager connect tuple.
/// Provider-specific target selection remains portable even while the browser
/// owns the OAuth ceremony and transport.
#[must_use]
pub fn oauth_remote_storage_ref(config: &OAuthFileConfigData) -> Option<String> {
    let preset = config.preset;
    if preset == OauthFilePreset::ICloud
        && let Some(target) = non_empty(config.icloud_share_target.as_deref())
    {
        return Some(target);
    }
    if let Some(folder_id) = non_empty(config.folder_id.as_deref()) {
        return Some(format!("shared:{folder_id}"));
    }
    non_empty(config.file_id.as_deref())
}

/// Merge the manager-reported remote reference back into OAuth config. An
/// absent result means the host has nothing to update.
#[must_use]
pub fn update_oauth_remote_ref(
    config: &OAuthFileConfigData,
    remote_ref: &str,
) -> Option<OAuthFileConfigData> {
    let remote_ref = remote_ref.trim();
    if remote_ref.is_empty() || config.file_id.as_deref() == Some(remote_ref) {
        return None;
    }
    Some(OAuthFileConfigData {
        file_id: Some(remote_ref.to_owned()),
        ..config.clone()
    })
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// Derive connect args from a configured persisted provider row.
///
/// Local-folder rows are browser-side backup targets, so manager sync still uses
/// the local encrypted vault cache for the main connect boundary.
pub fn storage_args_for_provider(
    provider: &StorageProviderData,
) -> ValidationResult<StorageConnectArgs> {
    let provider_type = StorageProviderType::parse(&provider.provider_type)?;
    let oauth_preset = provider.oauth_file.as_ref().map(|oauth| oauth.preset);
    let resolved_oauth_preset = oauth_preset;
    let mode = storage_mode_for_provider(provider_type, resolved_oauth_preset)
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
            // Shared Drive parent vs personal appDataFolder without a 4th arg.
            let storage_id = match (resolved_oauth_preset, oauth) {
                (Some(OauthFilePreset::GoogleDrive), Some(oauth))
                    if oauth.resolved_google_drive_mode() == GoogleDriveMode::Shared =>
                {
                    format!(
                        "shared:{}",
                        non_empty(oauth.folder_id.as_deref())
                            .ok_or(ValidationError::SharedStorageTargetRequired)?
                    )
                }
                (Some(OauthFilePreset::ICloud), Some(oauth))
                    if oauth.resolved_icloud_mode() == ICloudMode::Shared =>
                {
                    non_empty(oauth.icloud_share_target.as_deref())
                        .ok_or(ValidationError::SharedStorageTargetRequired)?
                }
                _ => oauth
                    .and_then(|oauth| non_empty(oauth.file_id.as_deref()))
                    .unwrap_or_default(),
            };
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
    let oauth_preset = provider.oauth_file.as_ref().map(|oauth| oauth.preset);
    Ok(provider_replication_capability(
        provider_type,
        match oauth_preset {
            Some(preset) => crate::ProviderOauthPreset::Preset(preset),
            None => crate::ProviderOauthPreset::NotApplicable,
        },
    ))
}

pub fn validate_provider_row_replication(
    provider: &StorageProviderData,
    replication_type: ReplicationType,
) -> ValidationResult<ProviderReplicationCapability> {
    let provider_type = StorageProviderType::parse(&provider.provider_type)?;
    let oauth_preset = provider.oauth_file.as_ref().map(|oauth| oauth.preset);
    let capability = validate_provider_replication(
        provider_type,
        match oauth_preset {
            Some(preset) => crate::ProviderOauthPreset::Preset(preset),
            None => crate::ProviderOauthPreset::NotApplicable,
        },
        replication_type,
    )?;
    if replication_type == ReplicationType::Shared && oauth_preset == Some(OauthFilePreset::ICloud)
    {
        let oauth = provider
            .oauth_file
            .as_ref()
            .ok_or(ValidationError::SharedStorageTargetRequired)?;
        if oauth.resolved_icloud_mode() != ICloudMode::Shared {
            return Err(ValidationError::SharedStorageTargetRequired);
        }
        let storage_target = non_empty(oauth.icloud_share_target.as_deref())
            .ok_or(ValidationError::SharedStorageTargetRequired)?;
        ICloudSharedTarget::from_storage_id(&storage_target)?;
    }
    Ok(capability)
}

/// Whether a persisted provider row is fully usable for the requested
/// replication mode. This includes provider-specific shared-target checks.
#[must_use]
pub fn provider_supports_replication(
    provider: &StorageProviderData,
    replication_type: ReplicationType,
) -> bool {
    validate_provider_row_replication(provider, replication_type).is_ok()
}

/// Select the preferred compatible provider, or the first compatible row.
/// Returning the id lets host adapters retain their own object/reference while
/// core owns the compatibility and ordering decision.
#[must_use]
pub fn first_compatible_provider_id(
    providers: &[StorageProviderData],
    replication_type: ReplicationType,
    preferred_id: Option<&str>,
) -> Option<String> {
    preferred_id
        .and_then(|preferred_id| {
            providers.iter().find(|provider| {
                provider.id == preferred_id
                    && provider_supports_replication(provider, replication_type)
            })
        })
        .or_else(|| {
            providers
                .iter()
                .find(|provider| provider_supports_replication(provider, replication_type))
        })
        .map(|provider| provider.id.clone())
}

/// Resolve the enrollment handoff from both vault policy and the concrete
/// provider target. A shared Google Drive folder always uses a target-only
/// grant, even when the vault's default replication policy is personal;
/// the owner's OAuth credential must never be transferred for a shared target.
pub fn provider_onboarding_type(
    provider: &StorageProviderData,
    architecture: &VaultArchitecture,
) -> ValidationResult<OnboardingType> {
    architecture.validate()?;
    let provider_type = StorageProviderType::parse(&provider.provider_type)?;
    let provider_uses_shared_target = if provider_type == StorageProviderType::OauthFile {
        provider
            .oauth_file
            .as_ref()
            .is_some_and(|oauth| match oauth.preset {
                OauthFilePreset::GoogleDrive => {
                    oauth.resolved_google_drive_mode() == GoogleDriveMode::Shared
                }
                OauthFilePreset::ICloud => oauth.resolved_icloud_mode() == ICloudMode::Shared,
            })
    } else {
        false
    };
    let effective_replication = if provider_uses_shared_target {
        ReplicationType::Shared
    } else {
        architecture.replication_type
    };
    validate_provider_row_replication(provider, effective_replication)?;
    Ok(match effective_replication {
        ReplicationType::Personal => OnboardingType::PersonalCredentialTransfer,
        ReplicationType::Shared => OnboardingType::SharedProviderGrant,
    })
}

/// Resolve the onboarding ceremony encoded by an enrollment provider payload.
///
/// Credential-bearing provider variants are restricted to trusted-device
/// onboarding. Shared-target variants contain no provider credential fields and
/// always require the joining device to authenticate independently.
#[must_use]
pub const fn enrollment_provider_onboarding_type(provider: &EnrollmentProvider) -> OnboardingType {
    match provider {
        EnrollmentProvider::PersonalCredentialTransfer(_) => {
            OnboardingType::PersonalCredentialTransfer
        }
        EnrollmentProvider::SharedProviderGrant(_) => OnboardingType::SharedProviderGrant,
    }
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
    match provider_onboarding_type(provider, architecture)? {
        OnboardingType::PersonalCredentialTransfer => {
            personal_enrollment_provider(provider).map(EnrollmentProvider::personal)
        }
        OnboardingType::SharedProviderGrant => {
            shared_enrollment_provider(provider, shared_joiner_identity, shared_storage_target_id)
                .map(EnrollmentProvider::shared)
        }
    }
}

/// Build only the credential-bearing enrollment typestate. Its return value
/// cannot be wrapped as a shared-provider payload.
fn personal_enrollment_provider(
    provider: &StorageProviderData,
) -> ValidationResult<PersonalEnrollmentProvider> {
    validate_provider_row_replication(provider, ReplicationType::Personal)?;
    let provider_type = StorageProviderType::parse(&provider.provider_type)?;
    match provider_type {
        StorageProviderType::Local | StorageProviderType::LocalFolder => {
            Ok(PersonalEnrollmentProvider::local())
        }
        StorageProviderType::Github => Ok(PersonalEnrollmentProvider::github(
            validate_github_pat(provider.github_pat.as_deref().unwrap_or_default())?
                .as_str()
                .to_owned(),
            validate_github_repo_name(provider.github_repo.as_deref().unwrap_or_default())?
                .as_str()
                .to_owned(),
        )),
        StorageProviderType::OauthFile => {
            let oauth = provider
                .oauth_file
                .as_ref()
                .ok_or(ValidationError::OauthAccessTokenEmpty)?;
            let preset = oauth.preset;
            Ok(PersonalEnrollmentProvider::oauth_file(
                preset.as_str().to_owned(),
                validate_oauth_access_token(&oauth.access_token)?
                    .as_str()
                    .to_owned(),
                match &oauth.refresh_token {
                    Some(value) => crate::OAuthRefreshCredential::Token(value.clone()),
                    None => crate::OAuthRefreshCredential::NotIssued,
                },
                match &oauth.expires_at {
                    Some(value) => crate::OAuthTokenExpiry::ExpiresAt(value.clone()),
                    None => crate::OAuthTokenExpiry::Unknown,
                },
                match (&oauth.file_id, &oauth.file_name) {
                    (Some(file_id), Some(file_name)) => crate::OAuthRemoteFile::Identified {
                        file_id: file_id.clone(),
                        file_name: file_name.clone(),
                    },
                    (Some(file_id), None) => crate::OAuthRemoteFile::FileId {
                        file_id: file_id.clone(),
                    },
                    (None, Some(file_name)) => crate::OAuthRemoteFile::FileName {
                        file_name: file_name.clone(),
                    },
                    (None, None) => crate::OAuthRemoteFile::Unresolved,
                },
                match &oauth.account_email {
                    Some(value) => crate::OAuthAccountIdentity::Email(value.clone()),
                    None => crate::OAuthAccountIdentity::Unknown,
                },
            ))
        }
    }
}

/// Build only the credential-free shared-provider typestate. Even though the
/// saved row contains this browser's credential for grant preparation, this
/// return type has no credential fields or credential-bearing constructors.
fn shared_enrollment_provider(
    provider: &StorageProviderData,
    shared_joiner_identity: Option<&str>,
    shared_storage_target_id: Option<&str>,
) -> ValidationResult<SharedEnrollmentProvider> {
    validate_provider_row_replication(provider, ReplicationType::Shared)?;
    let oauth = provider.oauth_file.as_ref();
    let preset = oauth.map(|config| config.preset);
    let storage_target_id = shared_storage_target_id
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .or_else(|| match preset {
            Some(OauthFilePreset::GoogleDrive) => oauth
                .and_then(|config| config.folder_id.clone())
                .filter(|id| !id.trim().is_empty()),
            Some(OauthFilePreset::ICloud) => oauth
                .and_then(|config| config.icloud_share_target.clone())
                .filter(|id| !id.trim().is_empty()),
            None => None,
        })
        .ok_or(ValidationError::SharedStorageTargetRequired)?;
    match preset {
        Some(OauthFilePreset::ICloud) => Ok(SharedEnrollmentProvider::icloud(storage_target_id)),
        _ => Ok(SharedEnrollmentProvider::google_drive(
            shared_joiner_identity
                .map(str::trim)
                .filter(|identity| !identity.is_empty())
                .ok_or(ValidationError::SharedJoinerIdentityRequired)?
                .to_owned(),
            storage_target_id,
        )),
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

/// Resolve a usable staged remote-provider draft. Empty/incomplete drafts do
/// not cross the manager boundary; configured drafts reuse the same typed
/// provider conversion as persisted rows.
pub fn staged_remote_storage_args(
    provider_type: StorageProviderType,
    github_pat: Option<&str>,
    github_repo: Option<&str>,
    oauth_file: Option<&OAuthFileConfigData>,
) -> ValidationResult<Option<StorageConnectArgs>> {
    match provider_type {
        StorageProviderType::Local | StorageProviderType::LocalFolder => Ok(None),
        StorageProviderType::Github => {
            let Some(pat) = non_empty(github_pat) else {
                return Ok(None);
            };
            Ok(Some(StorageConnectArgs {
                mode: StorageMode::Github.as_str().to_owned(),
                pat,
                repo: non_empty(github_repo).unwrap_or_else(|| DEFAULT_GITHUB_REPO_NAME.to_owned()),
            }))
        }
        StorageProviderType::OauthFile => {
            let Some(oauth_file) = oauth_file else {
                return Ok(None);
            };
            let Some(access_token) = non_empty(Some(oauth_file.access_token.as_str())) else {
                return Ok(None);
            };
            let preset = oauth_file.preset;
            let shared_google_drive = preset == OauthFilePreset::GoogleDrive
                && (oauth_file.resolved_google_drive_mode() == GoogleDriveMode::Shared
                    || non_empty(oauth_file.folder_id.as_deref()).is_some());
            let mut oauth_file = oauth_file.clone();
            oauth_file.access_token = access_token;
            oauth_file.file_name = Some(
                if shared_google_drive {
                    non_empty(oauth_file.file_name.as_deref())
                } else {
                    non_empty(github_repo).or_else(|| non_empty(oauth_file.file_name.as_deref()))
                }
                .unwrap_or_else(|| DEFAULT_DRIVE_BACKUP_NAME.to_owned()),
            );
            let provider = StorageProviderData {
                id: "staged-oauth-file".to_owned(),
                provider_type: StorageProviderType::OauthFile.as_str().to_owned(),
                label: String::new(),
                github_pat: None,
                github_repo: None,
                oauth_file: Some(oauth_file),
                local_folder: None,
                store_id: None,
                sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
                created_at: String::new(),
            };
            storage_args_for_provider(&provider).map(Some)
        }
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

/// Apply successful provider-sync metadata without duplicating vault parsing
/// or hashing in host code.
#[must_use]
pub fn update_provider_sync_metadata(
    providers: &[StorageProviderData],
    provider_id: &str,
    vault_yaml: &str,
    revision: ProviderSyncRevisionRef<'_>,
    manager_store_id: ManagerStoreScopeRef<'_>,
    synced_at: &str,
) -> Vec<StorageProviderData> {
    let version = match crate::read_vault_version(vault_yaml) {
        Ok(version) => match i64::try_from(version) {
            Ok(version) if version > 0 => ProviderSyncedVaultVersion::Version(version),
            Ok(_) | Err(_) => ProviderSyncedVaultVersion::Unknown,
        },
        Err(_) => ProviderSyncedVaultVersion::Unknown,
    };
    let content_hash = crate::vault_content_hash(vault_yaml);
    providers
        .iter()
        .cloned()
        .map(|mut provider| {
            if provider.id == provider_id {
                let (previous_version, previous_revision) = match &provider.sync_checkpoint {
                    ProviderSyncCheckpoint::Synced {
                        version, revision, ..
                    } => (*version, revision.clone()),
                    ProviderSyncCheckpoint::NeverSynced => (
                        ProviderSyncedVaultVersion::Unknown,
                        ProviderSyncRevision::Unknown,
                    ),
                };
                provider.sync_checkpoint = ProviderSyncCheckpoint::Synced {
                    version: match version {
                        ProviderSyncedVaultVersion::Unknown => previous_version,
                        ProviderSyncedVaultVersion::Version(_) => version,
                    },
                    synced_at: synced_at.to_owned(),
                    revision: match revision {
                        ProviderSyncRevisionRef::Revision(value) if !value.trim().is_empty() => {
                            ProviderSyncRevision::Revision(value.trim().to_owned())
                        }
                        ProviderSyncRevisionRef::Unreported
                        | ProviderSyncRevisionRef::Revision(_) => previous_revision,
                    },
                    common_content_hash: content_hash.clone(),
                };
                if let ManagerStoreScopeRef::Store(store_id) = manager_store_id
                    && !store_id.trim().is_empty()
                {
                    provider.store_id = Some(store_id.trim().to_owned());
                }
            }
            provider
        })
        .collect()
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
            let preset = oauth.map_or(OauthFilePreset::GoogleDrive, |oauth| oauth.preset);
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
            Some(oauth) => {
                let preset = oauth.preset;
                SyncProviderTarget::OauthFile(OauthFileSyncTarget {
                    preset,
                    file_id: if preset == OauthFilePreset::ICloud
                        && oauth.resolved_icloud_mode() == ICloudMode::Shared
                    {
                        oauth.icloud_share_target.clone()
                    } else {
                        oauth.file_id.clone()
                    },
                    folder_id: oauth.folder_id.clone(),
                    file_name: oauth.file_name.clone(),
                    account_email: oauth.account_email.clone(),
                    access_token: Some(oauth.access_token.clone()),
                })
            }
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

/// Parse a raw persisted provider snapshot.
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
    let active_vault_store_id = object
        .and_then(|object| object.get("activeVaultStoreId"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    NormalizedAuthSnapshot {
        snapshot: AuthProvidersSnapshotData {
            providers,
            active_vault_store_id,
        },
        changed: false,
    }
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
        sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
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

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
#[path = "sync_provider_store_tests.rs"]
mod tests;
