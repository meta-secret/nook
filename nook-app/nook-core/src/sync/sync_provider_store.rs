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
            sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
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
            sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
            created_at: "2026-06-24T00:00:00.000Z".to_owned(),
        }
    }

    fn oauth_provider(
        id: &str,
        preset: OauthFilePreset,
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
                preset,
                access_token: " token ".to_owned(),
                file_id: file_id.map(str::to_owned),
                file_name: Some(file_name.to_owned()),
                ..OAuthFileConfigData::default()
            }),
            local_folder: None,
            store_id: None,
            sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
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
    fn normalize_handles_missing_value() -> Result<(), Box<dyn std::error::Error>> {
        let result = normalize_auth_snapshot(&serde_json::Value::Null);
        assert_eq!(result.snapshot, AuthProvidersSnapshotData::default());
        assert!(!result.changed);
        Ok(())
    }

    #[test]
    fn normalize_keeps_active_vault_store_id() -> Result<(), Box<dyn std::error::Error>> {
        let raw = json!({ "providers": [], "activeVaultStoreId": "vault-1" });
        let result = normalize_auth_snapshot(&raw);
        assert_eq!(
            result.snapshot.active_vault_store_id.as_deref(),
            Some("vault-1")
        );
        assert!(!result.changed);
        Ok(())
    }

    #[test]
    fn find_duplicate_matches_github_repo_and_pat() -> Result<(), Box<dyn std::error::Error>> {
        let existing = github_provider("gh-existing", "nook-crdt-test-1", "github_pat_11AAAA");
        let candidate = github_provider("gh-new", "nook-crdt-test-1", "github_pat_11AAAA");
        let found = find_duplicate_sync_provider(&[existing], &candidate, None);
        assert_eq!(
            found.map(|provider| provider.id).as_deref(),
            Some("gh-existing")
        );
        Ok(())
    }

    #[test]
    fn github_without_pat_has_no_stable_sync_identity() -> Result<(), Box<dyn std::error::Error>> {
        let provider = StorageProviderData {
            github_pat: None,
            ..github_provider("gh-draft", "nook", "github_pat_11AAAA")
        };
        assert_eq!(provider_target_key(&provider), None);
        Ok(())
    }

    #[test]
    fn find_duplicate_ignores_excluded_id() -> Result<(), Box<dyn std::error::Error>> {
        let existing = github_provider("gh-self", "nook", "github_pat_11AAAA");
        let found = find_duplicate_sync_provider(
            std::slice::from_ref(&existing),
            &existing,
            Some("gh-self"),
        );
        assert!(found.is_none());
        Ok(())
    }

    #[test]
    fn find_duplicate_returns_none_when_distinct() -> Result<(), Box<dyn std::error::Error>> {
        let existing = github_provider("gh-a", "alpha", "github_pat_11AAAA");
        let candidate = github_provider("gh-b", "beta", "github_pat_11AAAA");
        assert!(find_duplicate_sync_provider(&[existing], &candidate, None).is_none());
        Ok(())
    }

    #[test]
    fn find_duplicate_matches_local_folder_handle() -> Result<(), Box<dyn std::error::Error>> {
        let existing = local_folder_provider("folder-a", "handle-1");
        let candidate = local_folder_provider("folder-b", "handle-1");
        let found = find_duplicate_sync_provider(&[existing], &candidate, None);
        assert_eq!(
            found.map(|provider| provider.id).as_deref(),
            Some("folder-a")
        );
        Ok(())
    }

    #[test]
    fn oauth_target_identity_keeps_private_and_shared_drive_rows_distinct()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut private = oauth_provider(
            "drive-private",
            OauthFilePreset::GoogleDrive,
            None,
            "events",
        );
        private
            .oauth_file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?
            .drive_mode = GoogleDriveMode::Private;
        let mut shared =
            oauth_provider("drive-shared", OauthFilePreset::GoogleDrive, None, "events");
        let shared_oauth = shared
            .oauth_file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?;
        shared_oauth.drive_mode = GoogleDriveMode::Shared;
        shared_oauth.folder_id = Some("folder-team".to_owned());

        let providers = vec![private.clone(), shared.clone()];
        assert_eq!(
            find_duplicate_sync_provider(&providers, &private, None)
                .map(|provider| provider.id)
                .as_deref(),
            Some("drive-private")
        );
        assert_eq!(
            find_duplicate_sync_provider(&providers, &shared, None)
                .map(|provider| provider.id)
                .as_deref(),
            Some("drive-shared")
        );
        Ok(())
    }

    #[test]
    fn storage_args_for_configured_provider_rows_match_wasm_connect_contract()
    -> Result<(), Box<dyn std::error::Error>> {
        assert_eq!(
            storage_args_for_provider(&github_provider("gh", " team-vault ", " pat "))?,
            StorageConnectArgs {
                mode: "github".to_owned(),
                pat: "pat".to_owned(),
                repo: "team-vault".to_owned(),
            }
        );
        assert_eq!(
            storage_args_for_provider(&oauth_provider(
                "drive",
                OauthFilePreset::GoogleDrive,
                Some(" file-1 "),
                " events "
            ))?,
            StorageConnectArgs {
                mode: "google-drive".to_owned(),
                pat: "token".to_owned(),
                repo: "file-1\tevents".to_owned(),
            }
        );
        assert_eq!(
            storage_args_for_provider(&local_folder_provider("folder", "handle-1"))?,
            StorageConnectArgs::local()
        );
        Ok(())
    }

    #[test]
    fn google_drive_mode_switch_clears_scope_bound_credentials_and_targets()
    -> Result<(), Box<dyn std::error::Error>> {
        let config = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: "appdata-token".to_owned(),
            refresh_token: Some("refresh".to_owned()),
            expires_at: Some("2026-07-14T00:00:00Z".to_owned()),
            file_id: Some("appdata-file".to_owned()),
            file_name: Some("nook-events".to_owned()),
            account_email: Some("owner@example.com".to_owned()),
            drive_mode: GoogleDriveMode::Private,
            folder_id: None,
            icloud_mode: ICloudMode::Private,
            icloud_share_target: None,
        };
        let switched = set_google_drive_provider_mode(&config, GoogleDriveMode::Shared);
        assert_eq!(switched.drive_mode, GoogleDriveMode::Shared);
        assert!(switched.access_token.is_empty());
        assert_eq!(switched.refresh_token, None);
        assert_eq!(switched.expires_at, None);
        assert_eq!(switched.account_email, None);
        assert_eq!(switched.file_id, None);
        assert_eq!(switched.folder_id, None);
        assert_eq!(switched.file_name.as_deref(), Some("nook-events"));
        Ok(())
    }

    #[test]
    fn oauth_token_merges_preserve_only_same_provider_targets()
    -> Result<(), Box<dyn std::error::Error>> {
        let google_existing = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: "old".to_owned(),
            refresh_token: Some("refresh".to_owned()),
            expires_at: Some("old-expiry".to_owned()),
            file_id: Some("file".to_owned()),
            file_name: Some("events".to_owned()),
            account_email: Some("alex@example.com".to_owned()),
            drive_mode: GoogleDriveMode::Shared,
            folder_id: Some("folder".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let google = google_oauth_tokens_to_config(
            "new-google-token",
            "2026-07-20T00:00:00Z",
            Some(&google_existing),
        );
        assert_eq!(google.access_token, "new-google-token");
        assert_eq!(google.expires_at.as_deref(), Some("2026-07-20T00:00:00Z"));
        assert_eq!(google.drive_mode, GoogleDriveMode::Shared);
        assert_eq!(google.folder_id.as_deref(), Some("folder"));
        assert_eq!(google.icloud_mode, ICloudMode::Private);

        let icloud_existing = OAuthFileConfigData {
            preset: OauthFilePreset::ICloud,
            access_token: "old".to_owned(),
            refresh_token: Some("refresh".to_owned()),
            expires_at: Some("unchanged-expiry".to_owned()),
            file_id: Some("record".to_owned()),
            file_name: Some("events".to_owned()),
            account_email: Some("old@example.com".to_owned()),
            icloud_mode: ICloudMode::Shared,
            icloud_share_target: Some("icloud-share-v1:{\"role\":\"owner\"}".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let icloud = icloud_oauth_tokens_to_config(
            "new-icloud-token",
            Some("new@example.com"),
            Some(&icloud_existing),
        );
        assert_eq!(icloud.access_token, "new-icloud-token");
        assert_eq!(icloud.account_email.as_deref(), Some("new@example.com"));
        assert_eq!(icloud.icloud_mode, ICloudMode::Shared);
        assert_eq!(
            icloud.icloud_share_target,
            icloud_existing.icloud_share_target
        );
        assert_eq!(icloud.drive_mode, GoogleDriveMode::Private);
        assert!(icloud.folder_id.is_none());
        Ok(())
    }

    #[test]
    fn binding_shared_drive_folder_preserves_credentials_and_internal_event_name()
    -> Result<(), Box<dyn std::error::Error>> {
        let config = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: "shared-token".to_owned(),
            refresh_token: Some("refresh".to_owned()),
            expires_at: Some("2026-07-14T00:00:00Z".to_owned()),
            file_id: Some("stale-appdata-file".to_owned()),
            file_name: Some("nook-events".to_owned()),
            account_email: Some("owner@example.com".to_owned()),
            drive_mode: GoogleDriveMode::Private,
            folder_id: None,
            icloud_mode: ICloudMode::Private,
            icloud_share_target: None,
        };

        let bound = bind_google_drive_shared_folder(
            &config,
            "https://drive.google.com/drive/folders/folder-team",
        )?;

        assert_eq!(bound.drive_mode, GoogleDriveMode::Shared);
        assert_eq!(bound.folder_id.as_deref(), Some("folder-team"));
        assert_eq!(bound.file_id, None);
        assert_eq!(bound.access_token, "shared-token");
        assert_eq!(bound.refresh_token.as_deref(), Some("refresh"));
        assert_eq!(bound.file_name.as_deref(), Some("nook-events"));

        let mut provider =
            oauth_provider("drive", OauthFilePreset::GoogleDrive, None, "nook-events");
        provider.oauth_file = Some(bound);
        assert_eq!(
            storage_args_for_provider(&provider)?.repo,
            "shared:folder-team\tnook-events"
        );
        Ok(())
    }

    #[test]
    fn storage_args_require_folder_for_explicit_shared_drive_mode()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut provider = oauth_provider("drive", OauthFilePreset::GoogleDrive, None, "events");
        provider
            .oauth_file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?
            .drive_mode = GoogleDriveMode::Shared;
        assert_eq!(
            storage_args_for_provider(&provider),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        provider
            .oauth_file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?
            .folder_id = Some("folder-1".to_owned());
        assert_eq!(
            storage_args_for_provider(&provider)?.repo,
            "shared:folder-1\tevents"
        );
        Ok(())
    }

    #[test]
    fn provider_storage_detail_matches_provider_rows() -> Result<(), Box<dyn std::error::Error>> {
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
                    sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
                    created_at: "2026-06-24T00:00:00.000Z".to_owned(),
                },
                &labels,
            )?,
            "This device desc"
        );
        assert_eq!(
            provider_storage_detail(
                &github_provider("gh", " team-vault ", " github_pat_11AAAAbbbbCCCC "),
                &labels,
            )?,
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
            )?,
            "nook · No token saved"
        );
        assert_eq!(
            provider_storage_detail(&local_folder_provider("folder", "handle-1"), &labels)?,
            "Nook Backup"
        );
        assert_eq!(
            provider_storage_detail(
                &StorageProviderData {
                    local_folder: None,
                    ..local_folder_provider("folder", "handle-1")
                },
                &labels,
            )?,
            "Choose folder"
        );
        assert_eq!(
            provider_storage_detail(
                &StorageProviderData {
                    oauth_file: Some(OAuthFileConfigData {
                        account_email: Some("person@example.com".to_owned()),
                        ..oauth_provider("drive", OauthFilePreset::GoogleDrive, None, " events ")
                            .oauth_file
                            .ok_or_else(|| std::io::Error::other(
                                "OAuth provider file must exist"
                            ))?
                    }),
                    ..oauth_provider("drive", OauthFilePreset::GoogleDrive, None, " events ")
                },
                &labels,
            )?,
            "events · person@example.com"
        );
        assert_eq!(
            provider_storage_detail(
                &oauth_provider("icloud", OauthFilePreset::ICloud, None, " "),
                &labels
            )?,
            format!("{DEFAULT_DRIVE_BACKUP_NAME} · Signed in with iCloud")
        );
        Ok(())
    }

    #[test]
    fn localize_provider_label_preserves_provider_detail_suffixes()
    -> Result<(), Box<dyn std::error::Error>> {
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
        Ok(())
    }

    #[test]
    fn draft_storage_args_select_provider_specific_fields() -> Result<(), Box<dyn std::error::Error>>
    {
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
        Ok(())
    }

    #[test]
    fn vault_storage_args_prefers_local_cache_then_authenticated_provider()
    -> Result<(), Box<dyn std::error::Error>> {
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
            )?,
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
            )?,
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
            )?,
            StorageConnectArgs {
                mode: "github".to_owned(),
                pat: "draft-pat".to_owned(),
                repo: "draft-repo".to_owned(),
            }
        );
        Ok(())
    }

    #[test]
    fn ensure_local_row_added_when_missing() -> Result<(), Box<dyn std::error::Error>> {
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
        Ok(())
    }

    #[test]
    fn ensure_local_row_noop_when_present() -> Result<(), Box<dyn std::error::Error>> {
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
                sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
                created_at: "2026-06-24T00:00:00.000Z".to_owned(),
            }],
            active_vault_store_id: Some("vault-1".to_owned()),
        };
        let (next, changed) = ensure_local_provider_row(&snapshot, Some("vault-1"), "local-2", "x");
        assert!(!changed);
        assert_eq!(next.providers.len(), 1);
        Ok(())
    }

    #[test]
    fn provider_row_replication_capability_matches_provider_preset()
    -> Result<(), Box<dyn std::error::Error>> {
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
                preset: OauthFilePreset::GoogleDrive,
                access_token: "tok".to_owned(),
                account_email: Some("joiner@example.com".to_owned()),
                ..OAuthFileConfigData::default()
            }),
            local_folder: None,
            store_id: None,
            sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
            created_at: "2026-06-24T00:00:00.000Z".to_owned(),
        };
        let capability = validate_provider_row_replication(&gdrive, ReplicationType::Shared)?;
        assert!(capability.supports_shared);
        assert_eq!(
            capability.shared_joiner_identity,
            crate::ProviderJoinerIdentity::Required(crate::SharedJoinerIdentityKind::Email)
        );
        Ok(())
    }

    #[test]
    fn compatible_provider_selection_is_core_owned() -> Result<(), Box<dyn std::error::Error>> {
        let github = github_provider("github", "nook", "github_pat_11AAAA");
        let drive = oauth_provider("drive", OauthFilePreset::GoogleDrive, None, "events");
        let providers = vec![github, drive];

        assert_eq!(
            first_compatible_provider_id(&providers, ReplicationType::Shared, Some("github"))
                .as_deref(),
            Some("drive")
        );
        assert_eq!(
            first_compatible_provider_id(&providers, ReplicationType::Personal, Some("github"))
                .as_deref(),
            Some("github")
        );
        assert!(!provider_supports_replication(
            &providers[0],
            ReplicationType::Shared
        ));
        assert!(provider_supports_replication(
            &providers[1],
            ReplicationType::Shared
        ));
        Ok(())
    }

    #[test]
    fn enrollment_provider_builder_enforces_replication_before_payload_creation()
    -> Result<(), Box<dyn std::error::Error>> {
        let shared = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..VaultArchitecture::default()
        };
        let github = github_provider("gh", "nook", "github_pat_123");
        assert!(enrollment_provider_for_architecture(&github, &shared, Some("a@b.com")).is_err());

        let gdrive = oauth_provider(
            "drive",
            OauthFilePreset::GoogleDrive,
            Some("file-123"),
            "nook.yaml",
        );
        assert_eq!(
            enrollment_provider_for_architecture(&gdrive, &shared, Some("joiner@example.com")),
            Err(ValidationError::SharedStorageTargetRequired)
        );

        let granted = enrollment_provider_for_architecture_with_storage_target(
            &gdrive,
            &shared,
            Some("joiner@example.com"),
            Some("shared-folder-xyz"),
        )?;
        assert_eq!(
            granted,
            EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
                "joiner@example.com".to_owned(),
                "shared-folder-xyz".to_owned(),
            ))
        );

        let personal = VaultArchitecture::default();
        let provider = enrollment_provider_for_architecture(&gdrive, &personal, None)?;
        assert_eq!(
            provider,
            EnrollmentProvider::personal(PersonalEnrollmentProvider::oauth_file(
                "google-drive".to_owned(),
                "token".to_owned(),
                crate::OAuthRefreshCredential::NotIssued,
                crate::OAuthTokenExpiry::Unknown,
                crate::OAuthRemoteFile::Identified {
                    file_id: "file-123".to_owned(),
                    file_name: "nook.yaml".to_owned(),
                },
                crate::OAuthAccountIdentity::Unknown,
            ))
        );

        let mut shared_gdrive = gdrive.clone();
        let shared_oauth = shared_gdrive
            .oauth_file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?;
        shared_oauth.drive_mode = GoogleDriveMode::Shared;
        shared_oauth.folder_id = Some("persisted-shared-folder".to_owned());
        assert_eq!(
            provider_onboarding_type(&shared_gdrive, &personal),
            Ok(OnboardingType::SharedProviderGrant)
        );
        assert_eq!(
            enrollment_provider_for_architecture(
                &shared_gdrive,
                &personal,
                Some("joiner@example.com")
            )?,
            EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
                "joiner@example.com".to_owned(),
                "persisted-shared-folder".to_owned(),
            ))
        );

        shared_gdrive
            .oauth_file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?
            .folder_id = None;
        assert_eq!(
            enrollment_provider_for_architecture(
                &shared_gdrive,
                &personal,
                Some("joiner@example.com")
            ),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        Ok(())
    }

    #[test]
    fn enrollment_payload_variants_define_the_onboarding_credential_policy()
    -> Result<(), Box<dyn std::error::Error>> {
        let personal = EnrollmentProvider::personal(PersonalEnrollmentProvider::oauth_file(
            "google-drive".to_owned(),
            "owner-token".to_owned(),
            crate::OAuthRefreshCredential::Token("owner-refresh".to_owned()),
            crate::OAuthTokenExpiry::Unknown,
            crate::OAuthRemoteFile::Identified {
                file_id: "private-file".to_owned(),
                file_name: "nook-events".to_owned(),
            },
            crate::OAuthAccountIdentity::Email("owner@example.com".to_owned()),
        ));
        assert_eq!(
            enrollment_provider_onboarding_type(&personal),
            OnboardingType::PersonalCredentialTransfer
        );

        let shared = EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
            "joiner@example.com".to_owned(),
            "shared-folder".to_owned(),
        ));
        assert_eq!(
            enrollment_provider_onboarding_type(&shared),
            OnboardingType::SharedProviderGrant
        );

        let serialized = serde_json::to_value(shared)?;
        assert_eq!(serialized["onboardingType"], "shared-provider-grant");
        assert_eq!(serialized["provider"]["storage_target_id"], "shared-folder");
        let serialized = serialized.to_string();
        assert!(!serialized.contains("access_token"));
        assert!(!serialized.contains("refresh_token"));
        assert!(!serialized.contains("pat"));
        Ok(())
    }

    #[test]
    fn private_icloud_row_is_not_ready_for_shared_replication()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut icloud = oauth_provider("icloud", OauthFilePreset::ICloud, None, "nook-events");
        let oauth = icloud
            .oauth_file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?;
        oauth.icloud_mode = ICloudMode::Private;

        assert!(validate_provider_row_replication(&icloud, ReplicationType::Personal).is_ok());
        assert_eq!(
            validate_provider_row_replication(&icloud, ReplicationType::Shared),
            Err(ValidationError::SharedStorageTargetRequired)
        );

        let oauth = icloud
            .oauth_file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?;
        oauth.icloud_mode = ICloudMode::Shared;
        oauth.icloud_share_target = Some("not-a-cloudkit-share-target".to_owned());
        assert_eq!(
            validate_provider_row_replication(&icloud, ReplicationType::Shared),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        Ok(())
    }

    #[test]
    fn shared_icloud_onboarding_carries_target_without_owner_credentials()
    -> Result<(), Box<dyn std::error::Error>> {
        let target = crate::ICloudSharedTarget::new(
            crate::ICloudShareRole::Owner,
            "zone",
            "owner",
            "root",
            "guid",
        )?
        .to_storage_id()?;
        let mut icloud = oauth_provider("icloud", OauthFilePreset::ICloud, None, "nook-events");
        let oauth = icloud
            .oauth_file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?;
        oauth.icloud_mode = ICloudMode::Shared;
        oauth.icloud_share_target = Some(target.clone());

        let wire = serde_json::to_value(&icloud)?;
        assert_eq!(wire["oauthFile"]["iCloudMode"], "shared");
        assert_eq!(wire["oauthFile"]["iCloudShareTarget"], target);
        let icloud: StorageProviderData = serde_json::from_value(wire)?;

        assert_eq!(
            provider_onboarding_type(&icloud, &VaultArchitecture::default()),
            Ok(OnboardingType::SharedProviderGrant)
        );
        assert_eq!(
            enrollment_provider_for_architecture(&icloud, &VaultArchitecture::default(), None)?,
            EnrollmentProvider::shared(SharedEnrollmentProvider::icloud(target.clone()))
        );
        let args = storage_args_for_provider(&icloud)?;
        assert_eq!(args.mode, "icloud");
        assert_eq!(args.pat, "token");
        assert_eq!(args.repo, format!("{target}\tnook-events"));
        Ok(())
    }

    #[test]
    fn active_vault_provider_scope_and_roles_are_core_owned()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut local_a = github_provider("local-a", "ignored", "ignored");
        local_a.provider_type = StorageProviderType::Local.as_str().to_owned();
        local_a.store_id = Some("store-a".to_owned());
        let mut github_a = github_provider("github-a", "owner/a", "pat-a");
        github_a.store_id = Some("store-a".to_owned());
        let mut github_b = github_provider("github-b", "owner/b", "pat-b");
        github_b.store_id = Some("store-b".to_owned());
        let unscoped = github_provider("unscoped", "owner/unscoped", "pat-unscoped");
        let providers = vec![local_a.clone(), github_a.clone(), github_b, unscoped];

        assert_eq!(
            active_vault_providers(&providers, Some(" store-a ")),
            vec![local_a.clone(), github_a.clone()]
        );
        assert_eq!(
            sync_providers_for_active_vault(&providers, Some("store-a"))?,
            vec![github_a]
        );
        assert_eq!(
            local_provider_for_active_vault(&providers, Some("store-a"))?,
            Some(local_a.clone())
        );
        assert_eq!(
            provider_label_by_id(&providers, "github-b"),
            Some("GitHub".to_owned())
        );
        assert_eq!(
            providers_visible_while_device_locked(&providers),
            vec![local_a]
        );
        Ok(())
    }

    #[test]
    fn incoming_pairing_replaces_only_that_vaults_provider_grants()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut removed_a = github_provider("removed-a", "owner/old", "pat-old");
        removed_a.store_id = Some("store-a".to_owned());
        let mut retained_b = github_provider("retained-b", "owner/b", "pat-b");
        retained_b.store_id = Some("store-b".to_owned());
        let mut replacement_a = github_provider("replacement-a", "owner/new", "pat-new");
        replacement_a.store_id = None;
        let existing = AuthProvidersSnapshotData {
            providers: vec![removed_a, retained_b.clone()],
            active_vault_store_id: Some("store-a".to_owned()),
        };
        let incoming = AuthProvidersSnapshotData {
            providers: vec![replacement_a],
            active_vault_store_id: Some("store-a".to_owned()),
        };

        let replaced = replace_active_vault_provider_grants(&existing, &incoming);

        assert_eq!(replaced.providers.len(), 2);
        assert!(replaced.providers.contains(&retained_b));
        let replacement = replaced
            .providers
            .iter()
            .find(|provider| provider.id == "replacement-a")
            .expect("replacement provider");
        assert_eq!(replacement.store_id.as_deref(), Some("store-a"));
        assert!(
            replaced
                .providers
                .iter()
                .all(|provider| provider.id != "removed-a")
        );
        Ok(())
    }

    #[test]
    fn incoming_pairing_discards_unscoped_rows() -> Result<(), Box<dyn std::error::Error>> {
        let unscoped = github_provider("unscoped-a", "owner/a", "pat-a");
        let existing = AuthProvidersSnapshotData {
            providers: vec![unscoped],
            active_vault_store_id: Some("store-a".to_owned()),
        };
        let incoming = AuthProvidersSnapshotData {
            providers: Vec::new(),
            active_vault_store_id: Some("store-b".to_owned()),
        };

        let replaced = replace_active_vault_provider_grants(&existing, &incoming);

        assert!(replaced.providers.is_empty());
        Ok(())
    }

    #[test]
    fn empty_incoming_pairing_removes_every_provider_for_that_vault()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut removed_a = github_provider("removed-a", "owner/a", "pat-a");
        removed_a.store_id = Some("store-a".to_owned());
        let mut retained_b = github_provider("retained-b", "owner/b", "pat-b");
        retained_b.store_id = Some("store-b".to_owned());
        let existing = AuthProvidersSnapshotData {
            providers: vec![removed_a, retained_b.clone()],
            active_vault_store_id: Some("store-a".to_owned()),
        };
        let incoming = AuthProvidersSnapshotData {
            providers: Vec::new(),
            active_vault_store_id: Some("store-a".to_owned()),
        };

        let replaced = replace_active_vault_provider_grants(&existing, &incoming);

        assert_eq!(replaced.providers, vec![retained_b]);
        Ok(())
    }

    #[test]
    fn oauth_remote_reference_policy_is_core_owned() -> Result<(), Box<dyn std::error::Error>> {
        let mut google = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            file_id: Some("file-id".to_owned()),
            ..OAuthFileConfigData::default()
        };
        assert_eq!(
            oauth_remote_storage_ref(&google).as_deref(),
            Some("file-id")
        );

        google.folder_id = Some(" shared-folder ".to_owned());
        assert_eq!(
            oauth_remote_storage_ref(&google).as_deref(),
            Some("shared:shared-folder")
        );

        let updated = update_oauth_remote_ref(&google, " manager-ref ")
            .ok_or_else(|| std::io::Error::other("remote reference update must exist"))?;
        assert_eq!(updated.file_id.as_deref(), Some("manager-ref"));
        assert!(update_oauth_remote_ref(&updated, "manager-ref").is_none());
        assert!(update_oauth_remote_ref(&updated, " ").is_none());

        let icloud = OAuthFileConfigData {
            preset: OauthFilePreset::ICloud,
            icloud_share_target: Some("icloud-share-v1:{}".to_owned()),
            folder_id: Some("not-selected".to_owned()),
            ..OAuthFileConfigData::default()
        };
        assert_eq!(
            oauth_remote_storage_ref(&icloud).as_deref(),
            Some("icloud-share-v1:{}")
        );
        Ok(())
    }

    #[test]
    fn staged_remote_args_reject_incomplete_drafts_and_normalize_targets()
    -> Result<(), Box<dyn std::error::Error>> {
        assert_eq!(
            staged_remote_storage_args(StorageProviderType::Local, None, None, None)?,
            None
        );
        assert_eq!(
            staged_remote_storage_args(StorageProviderType::Github, Some("  "), None, None)?,
            None
        );
        assert_eq!(
            staged_remote_storage_args(
                StorageProviderType::Github,
                Some(" pat "),
                Some(" owner/repo "),
                None
            )?,
            Some(StorageConnectArgs {
                mode: "github".to_owned(),
                pat: "pat".to_owned(),
                repo: "owner/repo".to_owned(),
            })
        );

        let mut oauth = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: " token ".to_owned(),
            file_id: Some("file-id".to_owned()),
            file_name: Some("stored-name".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let args = staged_remote_storage_args(
            StorageProviderType::OauthFile,
            None,
            Some("draft-name"),
            Some(&oauth),
        )?
        .ok_or_else(|| std::io::Error::other("staged OAuth arguments must exist"))?;
        assert_eq!(args.mode, "google-drive");
        assert_eq!(args.pat, "token");
        assert_eq!(args.repo, "file-id\tdraft-name");

        oauth.preset = OauthFilePreset::GoogleDrive;
        oauth.drive_mode = GoogleDriveMode::Shared;
        oauth.folder_id = Some("shared-folder".to_owned());
        let args = staged_remote_storage_args(
            StorageProviderType::OauthFile,
            None,
            Some("ignored-draft-name"),
            Some(&oauth),
        )?
        .ok_or_else(|| std::io::Error::other("shared staged OAuth arguments must exist"))?;
        assert_eq!(args.repo, "shared:shared-folder\tstored-name");
        Ok(())
    }

    #[test]
    fn provider_sync_metadata_update_preserves_unreported_fields()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut provider = github_provider("github", "owner/repo", "pat");
        provider.sync_checkpoint = ProviderSyncCheckpoint::Synced {
            version: ProviderSyncedVaultVersion::Version(9),
            synced_at: "earlier".to_owned(),
            revision: ProviderSyncRevision::Revision("old-revision".to_owned()),
            common_content_hash: "old-hash".to_owned(),
        };
        let untouched = github_provider("other", "owner/other", "other-pat");

        let updated = update_provider_sync_metadata(
            &[provider, untouched.clone()],
            "github",
            "",
            ProviderSyncRevisionRef::Unreported,
            ManagerStoreScopeRef::Store(" store-1 "),
            "2026-07-17T12:00:00Z",
        );
        assert_eq!(
            updated[0].sync_checkpoint,
            ProviderSyncCheckpoint::Synced {
                version: ProviderSyncedVaultVersion::Version(9),
                synced_at: "2026-07-17T12:00:00Z".to_owned(),
                revision: ProviderSyncRevision::Revision("old-revision".to_owned()),
                common_content_hash: crate::vault_content_hash(""),
            }
        );
        assert_eq!(updated[0].store_id.as_deref(), Some("store-1"));
        assert_eq!(updated[1], untouched);
        Ok(())
    }
}
