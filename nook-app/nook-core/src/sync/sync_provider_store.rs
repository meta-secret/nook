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
    #[tsify(type = "OAuthFilePreset")]
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
    /// Explicit Google Drive provider mode. Legacy rows infer shared mode from
    /// `folder_id`; rows without either field remain private.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drive_mode: Option<GoogleDriveMode>,
    /// Shared-mode My Drive folder id (`drive.file` writes plus cross-account
    /// `drive.readonly`). Private-mode
    /// providers leave this unset and continue using `drive.appdata`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    /// Explicit iCloud provider mode. Legacy rows remain private.
    #[serde(
        default,
        rename = "iCloudMode",
        alias = "icloudMode",
        skip_serializing_if = "Option::is_none"
    )]
    pub icloud_mode: Option<ICloudMode>,
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
    pub fn resolved_google_drive_mode(&self) -> GoogleDriveMode {
        self.drive_mode.unwrap_or_else(|| {
            if non_empty(self.folder_id.as_deref()).is_some() {
                GoogleDriveMode::Shared
            } else {
                GoogleDriveMode::Private
            }
        })
    }

    #[must_use]
    pub fn resolved_icloud_mode(&self) -> ICloudMode {
        self.icloud_mode.unwrap_or_else(|| {
            if non_empty(self.icloud_share_target.as_deref()).is_some() {
                ICloudMode::Shared
            } else {
                ICloudMode::Private
            }
        })
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
        preset: OauthFilePreset::GoogleDrive.as_str().to_owned(),
        access_token: access_token.to_owned(),
        refresh_token: existing.refresh_token,
        expires_at: Some(expires_at.to_owned()),
        file_id: existing.file_id,
        file_name: existing.file_name,
        account_email: existing.account_email,
        drive_mode: Some(drive_mode),
        folder_id: existing.folder_id,
        icloud_mode: None,
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
        preset: OauthFilePreset::ICloud.as_str().to_owned(),
        access_token: access_token.to_owned(),
        refresh_token: existing.refresh_token,
        expires_at: existing.expires_at,
        file_id: existing.file_id,
        file_name: existing.file_name,
        account_email: account_name.map(str::to_owned).or(existing.account_email),
        drive_mode: None,
        folder_id: None,
        icloud_mode: Some(icloud_mode),
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
    switched.icloud_mode = Some(mode);
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
    switched.drive_mode = Some(mode);
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
    bound.drive_mode = Some(GoogleDriveMode::Shared);
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

/// Provider rows visible for the active vault. Legacy unscoped rows remain
/// visible until migration assigns their `store_id`.
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
            .filter(|provider| {
                provider
                    .store_id
                    .as_deref()
                    .map(str::trim)
                    .is_none_or(|store_id| store_id.is_empty() || store_id == active_store_id)
            })
            .cloned()
            .collect(),
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

/// Resolve the remote reference passed to the legacy manager connect tuple.
/// Provider-specific target selection remains portable even while the browser
/// owns the OAuth ceremony and transport.
#[must_use]
pub fn oauth_remote_storage_ref(config: &OAuthFileConfigData) -> Option<String> {
    let preset = if config.preset.trim().is_empty() {
        OauthFilePreset::GoogleDrive
    } else {
        OauthFilePreset::parse(&config.preset).ok()?
    };
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
    // Empty legacy OAuth presets mean Google Drive everywhere else in the
    // provider model. Resolve that default here too so shared folder ids are
    // not accidentally encoded as private app-data targets.
    let resolved_oauth_preset = if provider_type == StorageProviderType::OauthFile {
        Some(oauth_preset.unwrap_or(OauthFilePreset::GoogleDrive))
    } else {
        oauth_preset
    };
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
    let capability = validate_provider_replication(provider_type, oauth_preset, replication_type)?;
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
/// grant, even when the vault's legacy/default replication policy is personal;
/// the owner's OAuth credential must never be transferred for a shared target.
pub fn provider_onboarding_type(
    provider: &StorageProviderData,
    architecture: &VaultArchitecture,
) -> ValidationResult<OnboardingType> {
    architecture.validate()?;
    let provider_type = StorageProviderType::parse(&provider.provider_type)?;
    let provider_uses_shared_target = if provider_type == StorageProviderType::OauthFile {
        provider.oauth_file.as_ref().is_some_and(|oauth| {
            OauthFilePreset::parse(&oauth.preset).is_ok_and(|preset| match preset {
                OauthFilePreset::GoogleDrive => {
                    oauth.resolved_google_drive_mode() == GoogleDriveMode::Shared
                }
                OauthFilePreset::ICloud => oauth.resolved_icloud_mode() == ICloudMode::Shared,
            })
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
            let preset = OauthFilePreset::parse(&oauth.preset)?;
            Ok(PersonalEnrollmentProvider::oauth_file(
                preset.as_str().to_owned(),
                validate_oauth_access_token(&oauth.access_token)?
                    .as_str()
                    .to_owned(),
                oauth.refresh_token.clone(),
                oauth.expires_at.clone(),
                oauth.file_id.clone(),
                oauth.file_name.clone(),
                oauth.account_email.clone(),
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
    let preset = oauth
        .map(|config| OauthFilePreset::parse(&config.preset))
        .transpose()?;
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
            let preset = if oauth_file.preset.trim().is_empty() {
                OauthFilePreset::GoogleDrive
            } else {
                OauthFilePreset::parse(&oauth_file.preset)?
            };
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
                last_synced_version: None,
                last_synced_at: None,
                last_sync_revision: None,
                last_common_content_hash: None,
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

/// Apply successful provider-sync metadata without duplicating vault parsing,
/// hashing, or legacy-field preservation in host code.
#[must_use]
pub fn update_provider_sync_metadata(
    providers: &[StorageProviderData],
    provider_id: &str,
    vault_yaml: &str,
    revision: Option<&str>,
    manager_store_id: Option<&str>,
    synced_at: &str,
) -> Vec<StorageProviderData> {
    let version = crate::read_vault_version(vault_yaml)
        .ok()
        .and_then(|version| i64::try_from(version).ok())
        .filter(|version| *version > 0);
    let content_hash = crate::vault_content_hash(vault_yaml);
    let revision = non_empty(revision);
    let manager_store_id = non_empty(manager_store_id);
    providers
        .iter()
        .cloned()
        .map(|mut provider| {
            if provider.id == provider_id {
                provider.last_synced_at = Some(synced_at.to_owned());
                if let Some(version) = version {
                    provider.last_synced_version = Some(version);
                }
                if let Some(revision) = &revision {
                    provider.last_sync_revision = Some(revision.clone());
                }
                provider.last_common_content_hash = Some(content_hash.clone());
                if let Some(store_id) = &manager_store_id {
                    provider.store_id = Some(store_id.clone());
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
            Some(oauth) => {
                let preset =
                    OauthFilePreset::parse(&oauth.preset).unwrap_or(OauthFilePreset::GoogleDrive);
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
        .map(|provider| {
            let mut provider = provider.clone();
            if provider.label == "GitHub sync" {
                "GitHub".clone_into(&mut provider.label);
                changed = true;
            }
            match provider.provider_type.as_str() {
                "github" => {
                    if non_empty(provider.github_repo.as_deref()).is_some() {
                        return provider;
                    }
                    changed = true;
                    StorageProviderData {
                        github_repo: Some(DEFAULT_GITHUB_REPO_NAME.to_owned()),
                        ..provider
                    }
                }
                "oauth-file" => {
                    let has_file_name = provider
                        .oauth_file
                        .as_ref()
                        .and_then(|oauth| non_empty(oauth.file_name.as_deref()))
                        .is_some();
                    let existing = provider.oauth_file.as_ref();
                    let is_google = existing.is_none_or(|oauth| {
                        oauth.preset.trim().is_empty() || oauth.preset == "google-drive"
                    });
                    let needs_drive_mode =
                        is_google && existing.and_then(|oauth| oauth.drive_mode).is_none();
                    if has_file_name && !needs_drive_mode {
                        return provider;
                    }
                    changed = true;
                    StorageProviderData {
                        oauth_file: Some(OAuthFileConfigData {
                            preset: existing.map_or_else(
                                || OauthFilePreset::GoogleDrive.as_str().to_owned(),
                                |oauth| {
                                    non_empty(Some(oauth.preset.as_str())).unwrap_or_else(|| {
                                        OauthFilePreset::GoogleDrive.as_str().to_owned()
                                    })
                                },
                            ),
                            access_token: existing
                                .map(|oauth| oauth.access_token.clone())
                                .unwrap_or_default(),
                            refresh_token: existing.and_then(|oauth| oauth.refresh_token.clone()),
                            expires_at: existing.and_then(|oauth| oauth.expires_at.clone()),
                            file_id: existing.and_then(|oauth| oauth.file_id.clone()),
                            folder_id: existing.and_then(|oauth| oauth.folder_id.clone()),
                            icloud_mode: existing.and_then(|oauth| oauth.icloud_mode),
                            icloud_share_target: existing
                                .and_then(|oauth| oauth.icloud_share_target.clone()),
                            account_email: existing.and_then(|oauth| oauth.account_email.clone()),
                            drive_mode: if is_google {
                                Some(existing.map_or(GoogleDriveMode::Private, |oauth| {
                                    oauth.resolved_google_drive_mode()
                                }))
                            } else {
                                existing.and_then(|oauth| oauth.drive_mode)
                            },
                            file_name: existing
                                .and_then(|oauth| oauth.file_name.clone())
                                .or_else(|| Some(DEFAULT_DRIVE_BACKUP_NAME.to_owned())),
                        }),
                        local_folder: None,
                        ..provider
                    }
                }
                _ => provider,
            }
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
        assert!(!result.changed);
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
    fn oauth_target_identity_keeps_private_and_shared_drive_rows_distinct() {
        let mut private = oauth_provider("drive-private", "google-drive", None, "events");
        private.oauth_file.as_mut().unwrap().drive_mode = Some(GoogleDriveMode::Private);
        let mut shared = oauth_provider("drive-shared", "google-drive", None, "events");
        let shared_oauth = shared.oauth_file.as_mut().unwrap();
        shared_oauth.drive_mode = Some(GoogleDriveMode::Shared);
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
    fn google_drive_mode_switch_clears_scope_bound_credentials_and_targets() {
        let config = OAuthFileConfigData {
            preset: "google-drive".to_owned(),
            access_token: "appdata-token".to_owned(),
            refresh_token: Some("refresh".to_owned()),
            expires_at: Some("2026-07-14T00:00:00Z".to_owned()),
            file_id: Some("appdata-file".to_owned()),
            file_name: Some("nook-events".to_owned()),
            account_email: Some("owner@example.com".to_owned()),
            drive_mode: Some(GoogleDriveMode::Private),
            folder_id: None,
            icloud_mode: None,
            icloud_share_target: None,
        };
        let switched = set_google_drive_provider_mode(&config, GoogleDriveMode::Shared);
        assert_eq!(switched.drive_mode, Some(GoogleDriveMode::Shared));
        assert!(switched.access_token.is_empty());
        assert_eq!(switched.refresh_token, None);
        assert_eq!(switched.expires_at, None);
        assert_eq!(switched.account_email, None);
        assert_eq!(switched.file_id, None);
        assert_eq!(switched.folder_id, None);
        assert_eq!(switched.file_name.as_deref(), Some("nook-events"));
    }

    #[test]
    fn oauth_token_merges_preserve_only_same_provider_targets() {
        let google_existing = OAuthFileConfigData {
            preset: "google-drive".to_owned(),
            access_token: "old".to_owned(),
            refresh_token: Some("refresh".to_owned()),
            expires_at: Some("old-expiry".to_owned()),
            file_id: Some("file".to_owned()),
            file_name: Some("events".to_owned()),
            account_email: Some("alex@example.com".to_owned()),
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
        assert_eq!(google.drive_mode, Some(GoogleDriveMode::Shared));
        assert_eq!(google.folder_id.as_deref(), Some("folder"));
        assert!(google.icloud_mode.is_none());

        let icloud_existing = OAuthFileConfigData {
            preset: "icloud".to_owned(),
            access_token: "old".to_owned(),
            refresh_token: Some("refresh".to_owned()),
            expires_at: Some("unchanged-expiry".to_owned()),
            file_id: Some("record".to_owned()),
            file_name: Some("events".to_owned()),
            account_email: Some("old@example.com".to_owned()),
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
        assert_eq!(icloud.icloud_mode, Some(ICloudMode::Shared));
        assert_eq!(
            icloud.icloud_share_target,
            icloud_existing.icloud_share_target
        );
        assert!(icloud.drive_mode.is_none());
        assert!(icloud.folder_id.is_none());
    }

    #[test]
    fn binding_shared_drive_folder_preserves_credentials_and_internal_event_name() {
        let config = OAuthFileConfigData {
            preset: "google-drive".to_owned(),
            access_token: "shared-token".to_owned(),
            refresh_token: Some("refresh".to_owned()),
            expires_at: Some("2026-07-14T00:00:00Z".to_owned()),
            file_id: Some("stale-appdata-file".to_owned()),
            file_name: Some("nook-events".to_owned()),
            account_email: Some("owner@example.com".to_owned()),
            drive_mode: Some(GoogleDriveMode::Private),
            folder_id: None,
            icloud_mode: None,
            icloud_share_target: None,
        };

        let bound = bind_google_drive_shared_folder(
            &config,
            "https://drive.google.com/drive/folders/folder-team",
        )
        .unwrap();

        assert_eq!(bound.drive_mode, Some(GoogleDriveMode::Shared));
        assert_eq!(bound.folder_id.as_deref(), Some("folder-team"));
        assert_eq!(bound.file_id, None);
        assert_eq!(bound.access_token, "shared-token");
        assert_eq!(bound.refresh_token.as_deref(), Some("refresh"));
        assert_eq!(bound.file_name.as_deref(), Some("nook-events"));

        let mut provider = oauth_provider("drive", "google-drive", None, "nook-events");
        provider.oauth_file = Some(bound);
        assert_eq!(
            storage_args_for_provider(&provider).unwrap().repo,
            "shared:folder-team\tnook-events"
        );
    }

    #[test]
    fn storage_args_require_folder_for_explicit_shared_drive_mode() {
        let mut provider = oauth_provider("drive", "google-drive", None, "events");
        provider.oauth_file.as_mut().unwrap().drive_mode = Some(GoogleDriveMode::Shared);
        assert_eq!(
            storage_args_for_provider(&provider),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        provider.oauth_file.as_mut().unwrap().folder_id = Some("folder-1".to_owned());
        assert_eq!(
            storage_args_for_provider(&provider).unwrap().repo,
            "shared:folder-1\tevents"
        );
    }

    #[test]
    fn storage_args_preserve_shared_folder_for_empty_legacy_google_preset() {
        let mut provider = oauth_provider("drive", "", None, "events");
        let oauth = provider.oauth_file.as_mut().unwrap();
        oauth.drive_mode = Some(GoogleDriveMode::Shared);
        oauth.folder_id = Some("folder-legacy".to_owned());

        assert_eq!(
            storage_args_for_provider(&provider).unwrap(),
            StorageConnectArgs {
                mode: "google-drive".to_owned(),
                pat: "token".to_owned(),
                repo: "shared:folder-legacy\tevents".to_owned(),
            }
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
    fn migrate_normalizes_the_legacy_github_label() {
        let provider = StorageProviderData {
            label: "GitHub sync".to_owned(),
            ..github_provider("gh", "owner/repo", "github_pat_11AAAA")
        };
        let snapshot = AuthProvidersSnapshotData {
            providers: vec![provider],
            active_vault_store_id: None,
        };

        let (migrated, changed) = migrate_provider_fields(&snapshot);

        assert!(changed);
        assert_eq!(migrated.providers[0].label, "GitHub");
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
    fn migrate_infers_shared_mode_for_legacy_google_folder_rows() {
        let mut provider = oauth_provider("gd", "", None, "events");
        provider.oauth_file.as_mut().unwrap().folder_id = Some("folder-1".to_owned());
        let snapshot = AuthProvidersSnapshotData {
            providers: vec![provider],
            active_vault_store_id: None,
        };
        let (migrated, changed) = migrate_provider_fields(&snapshot);
        assert!(changed);
        let oauth = migrated.providers[0].oauth_file.as_ref().unwrap();
        assert_eq!(oauth.preset, "google-drive");
        assert_eq!(oauth.drive_mode, Some(GoogleDriveMode::Shared));
        assert_eq!(oauth.folder_id.as_deref(), Some("folder-1"));
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
    fn compatible_provider_selection_is_core_owned() {
        let github = github_provider("github", "nook", "github_pat_11AAAA");
        let drive = oauth_provider("drive", "google-drive", None, "events");
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
    }

    #[test]
    fn enrollment_provider_builder_enforces_replication_before_payload_creation() {
        let shared = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..VaultArchitecture::default()
        };
        let github = github_provider("gh", "nook", "github_pat_123");
        assert!(enrollment_provider_for_architecture(&github, &shared, Some("a@b.com")).is_err());

        let gdrive = oauth_provider(
            "drive",
            OauthFilePreset::GoogleDrive.as_str(),
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
        )
        .unwrap();
        assert_eq!(
            granted,
            EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
                "joiner@example.com".to_owned(),
                "shared-folder-xyz".to_owned(),
            ))
        );

        let personal = VaultArchitecture::default();
        let provider = enrollment_provider_for_architecture(&gdrive, &personal, None).unwrap();
        assert_eq!(
            provider,
            EnrollmentProvider::personal(PersonalEnrollmentProvider::oauth_file(
                "google-drive".to_owned(),
                "token".to_owned(),
                None,
                None,
                Some("file-123".to_owned()),
                Some("nook.yaml".to_owned()),
                None,
            ))
        );

        let mut shared_gdrive = gdrive.clone();
        let shared_oauth = shared_gdrive.oauth_file.as_mut().unwrap();
        shared_oauth.drive_mode = Some(GoogleDriveMode::Shared);
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
            )
            .unwrap(),
            EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
                "joiner@example.com".to_owned(),
                "persisted-shared-folder".to_owned(),
            ))
        );

        shared_gdrive.oauth_file.as_mut().unwrap().folder_id = None;
        assert_eq!(
            enrollment_provider_for_architecture(
                &shared_gdrive,
                &personal,
                Some("joiner@example.com")
            ),
            Err(ValidationError::SharedStorageTargetRequired)
        );
    }

    #[test]
    fn enrollment_payload_variants_define_the_onboarding_credential_policy() {
        let personal = EnrollmentProvider::personal(PersonalEnrollmentProvider::oauth_file(
            "google-drive".to_owned(),
            "owner-token".to_owned(),
            Some("owner-refresh".to_owned()),
            None,
            Some("private-file".to_owned()),
            Some("nook-events".to_owned()),
            Some("owner@example.com".to_owned()),
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

        let serialized = serde_json::to_value(shared).unwrap();
        assert_eq!(serialized["onboardingType"], "shared-provider-grant");
        assert_eq!(serialized["provider"]["storage_target_id"], "shared-folder");
        let serialized = serialized.to_string();
        assert!(!serialized.contains("access_token"));
        assert!(!serialized.contains("refresh_token"));
        assert!(!serialized.contains("pat"));
    }

    #[test]
    fn private_icloud_row_is_not_ready_for_shared_replication() {
        let mut icloud = oauth_provider("icloud", "icloud", None, "nook-events");
        let oauth = icloud.oauth_file.as_mut().unwrap();
        oauth.icloud_mode = Some(ICloudMode::Private);

        assert!(validate_provider_row_replication(&icloud, ReplicationType::Personal).is_ok());
        assert_eq!(
            validate_provider_row_replication(&icloud, ReplicationType::Shared),
            Err(ValidationError::SharedStorageTargetRequired)
        );

        let oauth = icloud.oauth_file.as_mut().unwrap();
        oauth.icloud_mode = Some(ICloudMode::Shared);
        oauth.icloud_share_target = Some("not-a-cloudkit-share-target".to_owned());
        assert_eq!(
            validate_provider_row_replication(&icloud, ReplicationType::Shared),
            Err(ValidationError::SharedStorageTargetRequired)
        );
    }

    #[test]
    fn shared_icloud_onboarding_carries_target_without_owner_credentials() {
        let target = crate::ICloudSharedTarget::new(
            crate::ICloudShareRole::Owner,
            "zone",
            "owner",
            "root",
            "guid",
        )
        .unwrap()
        .to_storage_id()
        .unwrap();
        let mut icloud = oauth_provider("icloud", "icloud", None, "nook-events");
        let oauth = icloud.oauth_file.as_mut().unwrap();
        oauth.icloud_mode = Some(ICloudMode::Shared);
        oauth.icloud_share_target = Some(target.clone());

        let wire = serde_json::to_value(&icloud).unwrap();
        assert_eq!(wire["oauthFile"]["iCloudMode"], "shared");
        assert_eq!(wire["oauthFile"]["iCloudShareTarget"], target);
        let icloud: StorageProviderData = serde_json::from_value(wire).unwrap();

        assert_eq!(
            provider_onboarding_type(&icloud, &VaultArchitecture::default()),
            Ok(OnboardingType::SharedProviderGrant)
        );
        assert_eq!(
            enrollment_provider_for_architecture(&icloud, &VaultArchitecture::default(), None)
                .unwrap(),
            EnrollmentProvider::shared(SharedEnrollmentProvider::icloud(target.clone()))
        );
        let args = storage_args_for_provider(&icloud).unwrap();
        assert_eq!(args.mode, "icloud");
        assert_eq!(args.pat, "token");
        assert_eq!(args.repo, format!("{target}\tnook-events"));
    }

    #[test]
    fn active_vault_provider_scope_and_roles_are_core_owned() {
        let mut local_a = github_provider("local-a", "ignored", "ignored");
        local_a.provider_type = StorageProviderType::Local.as_str().to_owned();
        local_a.store_id = Some("store-a".to_owned());
        let mut github_a = github_provider("github-a", "owner/a", "pat-a");
        github_a.store_id = Some("store-a".to_owned());
        let mut github_b = github_provider("github-b", "owner/b", "pat-b");
        github_b.store_id = Some("store-b".to_owned());
        let legacy = github_provider("legacy", "owner/legacy", "pat-legacy");
        let providers = vec![local_a.clone(), github_a.clone(), github_b, legacy.clone()];

        assert_eq!(
            active_vault_providers(&providers, Some(" store-a ")),
            vec![local_a.clone(), github_a.clone(), legacy.clone()]
        );
        assert_eq!(
            sync_providers_for_active_vault(&providers, Some("store-a")).unwrap(),
            vec![github_a, legacy]
        );
        assert_eq!(
            local_provider_for_active_vault(&providers, Some("store-a")).unwrap(),
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
    }

    #[test]
    fn oauth_remote_reference_policy_is_core_owned() {
        let mut google = OAuthFileConfigData {
            preset: "google-drive".to_owned(),
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

        let updated = update_oauth_remote_ref(&google, " manager-ref ").unwrap();
        assert_eq!(updated.file_id.as_deref(), Some("manager-ref"));
        assert!(update_oauth_remote_ref(&updated, "manager-ref").is_none());
        assert!(update_oauth_remote_ref(&updated, " ").is_none());

        let icloud = OAuthFileConfigData {
            preset: "icloud".to_owned(),
            icloud_share_target: Some("icloud-share-v1:{}".to_owned()),
            folder_id: Some("not-selected".to_owned()),
            ..OAuthFileConfigData::default()
        };
        assert_eq!(
            oauth_remote_storage_ref(&icloud).as_deref(),
            Some("icloud-share-v1:{}")
        );
    }

    #[test]
    fn staged_remote_args_reject_incomplete_drafts_and_normalize_targets() {
        assert_eq!(
            staged_remote_storage_args(StorageProviderType::Local, None, None, None).unwrap(),
            None
        );
        assert_eq!(
            staged_remote_storage_args(StorageProviderType::Github, Some("  "), None, None)
                .unwrap(),
            None
        );
        assert_eq!(
            staged_remote_storage_args(
                StorageProviderType::Github,
                Some(" pat "),
                Some(" owner/repo "),
                None
            )
            .unwrap(),
            Some(StorageConnectArgs {
                mode: "github".to_owned(),
                pat: "pat".to_owned(),
                repo: "owner/repo".to_owned(),
            })
        );

        let mut oauth = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive.as_str().to_owned(),
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
        )
        .unwrap()
        .unwrap();
        assert_eq!(args.mode, "google-drive");
        assert_eq!(args.pat, "token");
        assert_eq!(args.repo, "file-id\tdraft-name");

        oauth.preset.clear();
        let legacy = staged_remote_storage_args(
            StorageProviderType::OauthFile,
            None,
            Some("draft-name"),
            Some(&oauth),
        )
        .unwrap()
        .unwrap();
        assert_eq!(legacy.mode, "google-drive");
        assert_eq!(legacy.repo, "file-id\tdraft-name");

        oauth.preset = OauthFilePreset::GoogleDrive.as_str().to_owned();
        oauth.drive_mode = Some(GoogleDriveMode::Shared);
        oauth.folder_id = Some("shared-folder".to_owned());
        let args = staged_remote_storage_args(
            StorageProviderType::OauthFile,
            None,
            Some("ignored-draft-name"),
            Some(&oauth),
        )
        .unwrap()
        .unwrap();
        assert_eq!(args.repo, "shared:shared-folder\tstored-name");
    }

    #[test]
    fn provider_sync_metadata_update_preserves_unreported_fields() {
        let mut provider = github_provider("github", "owner/repo", "pat");
        provider.last_synced_version = Some(9);
        provider.last_sync_revision = Some("old-revision".to_owned());
        let untouched = github_provider("other", "owner/other", "other-pat");

        let updated = update_provider_sync_metadata(
            &[provider, untouched.clone()],
            "github",
            "",
            None,
            Some(" store-1 "),
            "2026-07-17T12:00:00Z",
        );
        assert_eq!(updated[0].last_synced_version, Some(9));
        assert_eq!(
            updated[0].last_sync_revision.as_deref(),
            Some("old-revision")
        );
        assert_eq!(updated[0].store_id.as_deref(), Some("store-1"));
        assert_eq!(
            updated[0].last_synced_at.as_deref(),
            Some("2026-07-17T12:00:00Z")
        );
        let expected_hash = crate::vault_content_hash("");
        assert_eq!(
            updated[0].last_common_content_hash.as_deref(),
            Some(expected_hash.as_str())
        );
        assert_eq!(updated[1], untouched);
    }
}
