#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::{DriveBackupName, ProviderOauthPreset, ProviderSyncCheckpoint};

use super::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, GoogleDriveMode, ICloudMode,
    ICloudSharedTarget, OAuthFileConfigData, OauthFilePreset, ProviderReplicationCapability,
    ProviderVaultScope, ReplicationType, StorageMode, StorageProviderData, StorageProviderType,
    StoredGithubPat, StoredGithubRepository, StoredLocalFolderConfiguration,
    StoredOAuthAccessCredential, StoredOAuthFileConfiguration, StoredOAuthRemoteFileName,
    ValidationError, ValidationResult,
};

/// Optional connection field interpreted with the persisted whitespace policy.
struct ConnectionField<'a>(Option<&'a str>);

/// Unauthenticated connection draft; its fields are configuration, not authorization.
pub struct DraftStorageConnection<'a> {
    pub provider_type: StorageProviderType,
    pub github_pat: Option<&'a str>,
    pub github_repo: Option<&'a str>,
    pub oauth_preset: Option<OauthFilePreset>,
    pub oauth_access_token: Option<&'a str>,
    pub oauth_file_id: Option<&'a str>,
    pub oauth_file_name: Option<&'a str>,
}

/// Borrowed staged configuration with the existing incomplete-draft outcome.
pub struct StagedRemoteConnection<'a> {
    pub provider_type: StorageProviderType,
    pub github_pat: Option<&'a str>,
    pub github_repo: Option<&'a str>,
    pub oauth_file: Option<&'a OAuthFileConfigData>,
}

/// Connection observations used to choose local, persisted, or draft arguments.
pub struct VaultStorageConnection<'a> {
    pub local_vault_present: bool,
    pub is_authenticated: bool,
    pub sync_provider: Option<&'a StorageProviderData>,
    pub draft: DraftStorageConnection<'a>,
}

/// Positional connect arguments expected by the current wasm manager boundary:
/// storage mode, credential/token, and remote reference/repo.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, tsify::Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
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

/// Trim optional persisted fields and discard empty values.
impl ConnectionField<'_> {
    fn non_empty(self) -> Option<String> {
        let value = self.0;

        value
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    }
}

/// Derive connect args from a configured persisted provider row.
///
/// Local-folder rows are browser-side backup targets, so manager sync still uses
/// the local encrypted vault cache for the main connect boundary.
impl StorageProviderData {
    pub fn connection_args(&self) -> ValidationResult<StorageConnectArgs> {
        let provider = self;
        let provider_type = provider.provider_type;
        let oauth_preset = provider.oauth_file.as_ref().map(|oauth| oauth.preset);
        let resolved_oauth_preset = oauth_preset;
        let mode = provider_type
            .storage_mode(resolved_oauth_preset)
            .as_str()
            .to_owned();
        match provider_type {
            StorageProviderType::Local | StorageProviderType::LocalFolder => {
                Ok(StorageConnectArgs::local())
            }
            StorageProviderType::Github => Ok(StorageConnectArgs {
                mode,
                pat: ConnectionField(provider.github_pat.as_deref())
                    .non_empty()
                    .unwrap_or_default(),
                repo: ConnectionField(provider.github_repo.as_deref())
                    .non_empty()
                    .unwrap_or_else(|| DEFAULT_GITHUB_REPO_NAME.to_owned()),
            }),
            StorageProviderType::OauthFile => {
                let oauth = provider.oauth_file.as_ref();
                let file_name = oauth
                    .and_then(|oauth| ConnectionField(oauth.file_name.as_deref()).non_empty())
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
                            ConnectionField(oauth.folder_id.as_deref())
                                .non_empty()
                                .ok_or(ValidationError::SharedStorageTargetRequired)?
                        )
                    }
                    (Some(OauthFilePreset::ICloud), Some(oauth))
                        if oauth.resolved_icloud_mode() == ICloudMode::Shared =>
                    {
                        ConnectionField(oauth.icloud_share_target.as_deref())
                            .non_empty()
                            .ok_or(ValidationError::SharedStorageTargetRequired)?
                    }
                    _ => oauth
                        .and_then(|oauth| ConnectionField(oauth.file_id.as_deref()).non_empty())
                        .unwrap_or_default(),
                };
                Ok(StorageConnectArgs {
                    mode,
                    pat: oauth
                        .and_then(|oauth| {
                            ConnectionField(oauth.access_token.as_deref()).non_empty()
                        })
                        .unwrap_or_default(),
                    repo: DriveBackupName::format_storage_ref_raw(&storage_id, &file_name),
                })
            }
        }
    }
}

impl StorageProviderData {
    pub fn replication_capability(&self) -> ProviderReplicationCapability {
        let provider = self;

        let provider_type = provider.provider_type;
        let oauth_preset = provider.oauth_file.as_ref().map(|oauth| oauth.preset);
        ProviderReplicationCapability::for_provider(
            provider_type,
            match oauth_preset {
                Some(preset) => ProviderOauthPreset::Preset(preset),
                None => ProviderOauthPreset::NotApplicable,
            },
        )
    }
}

impl StorageProviderData {
    pub fn validate_replication(
        &self,
        replication_type: ReplicationType,
    ) -> ValidationResult<ProviderReplicationCapability> {
        let provider = self;

        let provider_type = provider.provider_type;
        let oauth_preset = provider.oauth_file.as_ref().map(|oauth| oauth.preset);
        let capability = ProviderReplicationCapability::validate(
            provider_type,
            match oauth_preset {
                Some(preset) => ProviderOauthPreset::Preset(preset),
                None => ProviderOauthPreset::NotApplicable,
            },
            replication_type,
        )?;
        if replication_type == ReplicationType::Shared
            && oauth_preset == Some(OauthFilePreset::ICloud)
        {
            let oauth = provider
                .oauth_file
                .as_ref()
                .ok_or(ValidationError::SharedStorageTargetRequired)?;
            if oauth.resolved_icloud_mode() != ICloudMode::Shared {
                return Err(ValidationError::SharedStorageTargetRequired);
            }
            let storage_target = ConnectionField(oauth.icloud_share_target.as_deref())
                .non_empty()
                .ok_or(ValidationError::SharedStorageTargetRequired)?;
            ICloudSharedTarget::from_storage_id(&storage_target)?;
        }
        Ok(capability)
    }
}

/// Whether a persisted provider row is fully usable for the requested
/// replication mode. This includes provider-specific shared-target checks.
impl StorageProviderData {
    #[must_use]
    pub fn supports_replication(&self, replication_type: ReplicationType) -> bool {
        let provider = self;

        provider.validate_replication(replication_type).is_ok()
    }
}

impl DraftStorageConnection<'_> {
    #[must_use]
    pub fn project(self) -> StorageConnectArgs {
        let Self {
            provider_type,
            github_pat,
            github_repo,
            oauth_preset,
            oauth_access_token,
            oauth_file_id,
            oauth_file_name,
        } = self;

        let mode = provider_type.storage_mode(oauth_preset).as_str().to_owned();
        if provider_type == StorageProviderType::OauthFile {
            let file_name = ConnectionField(oauth_file_name)
                .non_empty()
                .or_else(|| ConnectionField(github_repo).non_empty())
                .unwrap_or_else(|| DEFAULT_DRIVE_BACKUP_NAME.to_owned());
            return StorageConnectArgs {
                mode,
                pat: ConnectionField(oauth_access_token)
                    .non_empty()
                    .unwrap_or_default(),
                repo: DriveBackupName::format_storage_ref_raw(
                    oauth_file_id.unwrap_or_default(),
                    &file_name,
                ),
            };
        }
        StorageConnectArgs {
            mode,
            pat: github_pat.unwrap_or_default().to_owned(),
            repo: github_repo.unwrap_or_default().to_owned(),
        }
    }
}

/// Resolve a usable staged remote-provider draft. Empty/incomplete drafts do
/// not cross the manager boundary; configured drafts reuse the same typed
/// provider conversion as persisted rows.
impl StagedRemoteConnection<'_> {
    pub fn project(self) -> ValidationResult<Option<StorageConnectArgs>> {
        let Self {
            provider_type,
            github_pat,
            github_repo,
            oauth_file,
        } = self;

        match provider_type {
            StorageProviderType::Local | StorageProviderType::LocalFolder => Ok(None),
            StorageProviderType::Github => {
                let Some(pat) = ConnectionField(github_pat).non_empty() else {
                    return Ok(None);
                };
                Ok(Some(StorageConnectArgs {
                    mode: StorageMode::Github.as_str().to_owned(),
                    pat,
                    repo: ConnectionField(github_repo)
                        .non_empty()
                        .unwrap_or_else(|| DEFAULT_GITHUB_REPO_NAME.to_owned()),
                }))
            }
            StorageProviderType::OauthFile => {
                let Some(oauth_file) = oauth_file else {
                    return Ok(None);
                };
                let Some(access_token) =
                    ConnectionField(oauth_file.access_token.as_deref()).non_empty()
                else {
                    return Ok(None);
                };
                let preset = oauth_file.preset;
                let shared_google_drive = preset == OauthFilePreset::GoogleDrive
                    && (oauth_file.resolved_google_drive_mode() == GoogleDriveMode::Shared
                        || ConnectionField(oauth_file.folder_id.as_deref())
                            .non_empty()
                            .is_some());
                let mut oauth_file = oauth_file.clone();
                oauth_file.access_token = StoredOAuthAccessCredential::AccessToken(access_token);
                oauth_file.file_name = StoredOAuthRemoteFileName::FileName(
                    if shared_google_drive {
                        ConnectionField(oauth_file.file_name.as_deref()).non_empty()
                    } else {
                        ConnectionField(github_repo).non_empty().or_else(|| {
                            ConnectionField(oauth_file.file_name.as_deref()).non_empty()
                        })
                    }
                    .unwrap_or_else(|| DEFAULT_DRIVE_BACKUP_NAME.to_owned()),
                );
                let provider = StorageProviderData {
                    id: "staged-oauth-file".to_owned(),
                    provider_type: StorageProviderType::OauthFile,
                    label: String::new(),
                    github_pat: StoredGithubPat::Missing,
                    github_repo: StoredGithubRepository::DefaultRepository,
                    oauth_file: StoredOAuthFileConfiguration::Configured(oauth_file),
                    local_folder: StoredLocalFolderConfiguration::NotApplicable,
                    store_id: ProviderVaultScope::Unscoped,
                    sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                    created_at: String::new(),
                };
                provider.connection_args().map(Some)
            }
        }
    }
}

impl VaultStorageConnection<'_> {
    pub fn project(self) -> ValidationResult<StorageConnectArgs> {
        let Self {
            local_vault_present,
            is_authenticated,
            sync_provider,
            draft,
        } = self;

        if local_vault_present {
            return Ok(StorageConnectArgs::local());
        }
        if is_authenticated && let Some(provider) = sync_provider {
            return provider.connection_args();
        }
        Ok(draft.project())
    }
}

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use crate::{
        ICloudShareRole, ICloudSharedTarget, ProviderJoinerIdentity, ProviderVaultScope,
        SharedJoinerIdentityKind, StoredGithubPat, StoredGithubRepository, StoredGoogleDriveFolder,
        StoredICloudShareTarget, StoredLocalFolderConfiguration, StoredLocalFolderDirectory,
        StoredLocalFolderHandle, StoredOAuthAccessCredential, StoredOAuthFileConfiguration,
        StoredOAuthRemoteFileId, StoredOAuthRemoteFileName,
    };

    use std::io;

    use super::{
        DraftStorageConnection, StagedRemoteConnection, StorageConnectArgs, VaultStorageConnection,
    };
    use crate::{
        DEFAULT_GITHUB_REPO_NAME, GoogleDriveMode, ICloudMode, OAuthFileConfigData,
        OauthFilePreset, ReplicationType, StorageProviderData, StorageProviderType,
        ValidationError,
    };
    use crate::{
        EnrollmentProvider, LocalFolderConfigData, ProviderEnrollmentRequest,
        ProviderSyncCheckpoint, SharedEnrollmentProvider, VaultArchitecture,
    };
    use crate::{ProviderSelection, ProviderSelectionPolicy, ProviderSelectionRequest};

    impl StorageProviderData {
        fn github_provider(id: &str, repo: &str, pat: &str) -> StorageProviderData {
            StorageProviderData {
                id: id.to_owned(),
                provider_type: StorageProviderType::Github,
                label: "GitHub".to_owned(),
                github_pat: StoredGithubPat::Token(pat.to_owned()),
                github_repo: StoredGithubRepository::Repository(repo.to_owned()),
                oauth_file: StoredOAuthFileConfiguration::NotApplicable,
                local_folder: StoredLocalFolderConfiguration::NotApplicable,
                store_id: ProviderVaultScope::Unscoped,
                sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                created_at: "2026-06-24T00:00:00.000Z".to_owned(),
            }
        }
        fn local_folder_provider(id: &str, handle_id: &str) -> StorageProviderData {
            StorageProviderData {
                id: id.to_owned(),
                provider_type: StorageProviderType::LocalFolder,
                label: "Local backup".to_owned(),
                github_pat: StoredGithubPat::Missing,
                github_repo: StoredGithubRepository::DefaultRepository,
                oauth_file: StoredOAuthFileConfiguration::NotApplicable,
                local_folder: StoredLocalFolderConfiguration::configured(LocalFolderConfigData {
                    directory_name: StoredLocalFolderDirectory::DirectoryName(
                        "Nook Backup".to_owned(),
                    ),
                    handle_id: StoredLocalFolderHandle::HandleId(handle_id.to_owned()),
                }),
                store_id: ProviderVaultScope::Unscoped,
                sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                created_at: "2026-06-24T00:00:00.000Z".to_owned(),
            }
        }
        fn oauth_provider(
            id: &str,
            preset: OauthFilePreset,
            file_id: StoredOAuthRemoteFileId,
            file_name: &str,
        ) -> StorageProviderData {
            StorageProviderData {
                id: id.to_owned(),
                provider_type: StorageProviderType::OauthFile,
                label: "Google Drive".to_owned(),
                github_pat: StoredGithubPat::Missing,
                github_repo: StoredGithubRepository::DefaultRepository,
                oauth_file: StoredOAuthFileConfiguration::configured(OAuthFileConfigData {
                    preset,
                    access_token: StoredOAuthAccessCredential::AccessToken(" token ".to_owned()),
                    file_id,
                    file_name: StoredOAuthRemoteFileName::FileName(file_name.to_owned()),
                    ..OAuthFileConfigData::default()
                }),
                local_folder: StoredLocalFolderConfiguration::NotApplicable,
                store_id: ProviderVaultScope::Unscoped,
                sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                created_at: "2026-06-24T00:00:00.000Z".to_owned(),
            }
        }
    }

    #[test]
    fn configured_provider_rows_match_the_manager_connect_contract() -> anyhow::Result<()> {
        assert_eq!(
            (StorageProviderData::github_provider("gh", " team-vault ", " pat "))
                .connection_args()?,
            StorageConnectArgs {
                mode: "github".to_owned(),
                pat: "pat".to_owned(),
                repo: "team-vault".to_owned(),
            }
        );
        assert_eq!(
            (StorageProviderData::oauth_provider(
                "drive",
                OauthFilePreset::GoogleDrive,
                StoredOAuthRemoteFileId::FileId(" file-1 ".to_owned()),
                " events ",
            ))
            .connection_args()?,
            StorageConnectArgs {
                mode: "google-drive".to_owned(),
                pat: "token".to_owned(),
                repo: "file-1\tevents".to_owned(),
            }
        );
        assert_eq!(
            (StorageProviderData::local_folder_provider("folder", "handle-1")).connection_args()?,
            StorageConnectArgs::local()
        );
        Ok(())
    }

    #[test]
    fn shared_drive_storage_requires_a_folder_target() -> anyhow::Result<()> {
        let mut provider = StorageProviderData::oauth_provider(
            "drive",
            OauthFilePreset::GoogleDrive,
            StoredOAuthRemoteFileId::Unresolved,
            "events",
        );
        let oauth = (match &mut provider.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Some(config),
            StoredOAuthFileConfiguration::NotApplicable => None,
        })
        .ok_or_else(|| io::Error::other("OAuth config must exist"))?;
        oauth.drive_mode = GoogleDriveMode::Shared;
        assert_eq!(
            provider.connection_args(),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        (match &mut provider.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Some(config),
            StoredOAuthFileConfiguration::NotApplicable => None,
        })
        .ok_or_else(|| io::Error::other("OAuth config must exist"))?
        .folder_id = StoredGoogleDriveFolder::FolderId("folder-1".to_owned());
        assert_eq!(provider.connection_args()?.repo, "shared:folder-1\tevents");
        Ok(())
    }

    #[test]
    fn draft_and_vault_storage_choose_the_correct_precedence() -> anyhow::Result<()> {
        assert_eq!(
            DraftStorageConnection {
                provider_type: StorageProviderType::OauthFile,
                github_pat: None,
                github_repo: Some(" repo-fallback "),
                oauth_preset: Some(OauthFilePreset::ICloud),
                oauth_access_token: Some(" token "),
                oauth_file_id: Some(" file-id "),
                oauth_file_name: Some(" ")
            }
            .project(),
            StorageConnectArgs {
                mode: "icloud".to_owned(),
                pat: "token".to_owned(),
                repo: "file-id\trepo-fallback".to_owned(),
            }
        );

        let provider = StorageProviderData::github_provider("gh", "team-vault", "pat");
        assert_eq!(
            VaultStorageConnection {
                local_vault_present: true,
                is_authenticated: true,
                sync_provider: Some(&provider),
                draft: DraftStorageConnection {
                    provider_type: StorageProviderType::Github,
                    github_pat: Some("draft-pat"),
                    github_repo: Some("draft-repo"),
                    oauth_preset: None,
                    oauth_access_token: None,
                    oauth_file_id: None,
                    oauth_file_name: None
                }
            }
            .project()?,
            StorageConnectArgs::local()
        );
        assert_eq!(
            VaultStorageConnection {
                local_vault_present: false,
                is_authenticated: true,
                sync_provider: Some(&provider),
                draft: DraftStorageConnection {
                    provider_type: StorageProviderType::Github,
                    github_pat: Some("draft-pat"),
                    github_repo: Some("draft-repo"),
                    oauth_preset: None,
                    oauth_access_token: None,
                    oauth_file_id: None,
                    oauth_file_name: None
                }
            }
            .project()?
            .repo,
            "team-vault"
        );
        assert_eq!(
            VaultStorageConnection {
                local_vault_present: false,
                is_authenticated: false,
                sync_provider: Some(&provider),
                draft: DraftStorageConnection {
                    provider_type: StorageProviderType::Github,
                    github_pat: Some("draft-pat"),
                    github_repo: Some("draft-repo"),
                    oauth_preset: None,
                    oauth_access_token: None,
                    oauth_file_id: None,
                    oauth_file_name: None
                }
            }
            .project()?
            .repo,
            "draft-repo"
        );
        Ok(())
    }

    #[test]
    fn provider_replication_capability_matches_the_provider_preset() -> anyhow::Result<()> {
        let github = StorageProviderData::github_provider("gh", "nook", "pat");
        assert!(
            (github)
                .validate_replication(ReplicationType::Personal)
                .is_ok()
        );
        assert!(
            (github)
                .validate_replication(ReplicationType::Shared)
                .is_err()
        );

        let drive = StorageProviderData::oauth_provider(
            "drive",
            OauthFilePreset::GoogleDrive,
            StoredOAuthRemoteFileId::Unresolved,
            "events",
        );
        let capability = (drive).validate_replication(ReplicationType::Shared)?;
        assert!(capability.supports_shared);
        assert_eq!(
            capability.shared_joiner_identity,
            ProviderJoinerIdentity::Required(SharedJoinerIdentityKind::Email)
        );
        Ok(())
    }

    #[test]
    fn compatible_provider_selection_is_core_owned() {
        let providers = vec![
            StorageProviderData::github_provider("github", "nook", "github_pat_11AAAA"),
            StorageProviderData::oauth_provider(
                "drive",
                OauthFilePreset::GoogleDrive,
                StoredOAuthRemoteFileId::Unresolved,
                "events",
            ),
        ];
        assert_eq!(
            ProviderSelectionRequest {
                providers: &providers,
                replication_type: ReplicationType::Shared,
                policy: ProviderSelectionPolicy::Prefer("github".into())
            }
            .select(),
            ProviderSelection::Selected("drive".into())
        );
        assert_eq!(
            ProviderSelectionRequest {
                providers: &providers,
                replication_type: ReplicationType::Personal,
                policy: ProviderSelectionPolicy::Prefer("github".into())
            }
            .select(),
            ProviderSelection::Selected("github".into())
        );
        assert!(!(providers[0]).supports_replication(ReplicationType::Shared));
        assert!((providers[1]).supports_replication(ReplicationType::Shared));
    }

    #[test]
    fn private_icloud_is_not_ready_for_shared_replication() -> anyhow::Result<()> {
        let mut icloud = StorageProviderData::oauth_provider(
            "icloud",
            OauthFilePreset::ICloud,
            StoredOAuthRemoteFileId::Unresolved,
            "nook-events",
        );
        let oauth = (match &mut icloud.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Some(config),
            StoredOAuthFileConfiguration::NotApplicable => None,
        })
        .ok_or_else(|| io::Error::other("OAuth config must exist"))?;
        oauth.icloud_mode = ICloudMode::Private;
        assert!(
            (icloud)
                .validate_replication(ReplicationType::Personal)
                .is_ok()
        );
        assert_eq!(
            (icloud).validate_replication(ReplicationType::Shared),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        let oauth = (match &mut icloud.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Some(config),
            StoredOAuthFileConfiguration::NotApplicable => None,
        })
        .ok_or_else(|| io::Error::other("OAuth config must exist"))?;
        oauth.icloud_mode = ICloudMode::Shared;
        oauth.icloud_share_target =
            StoredICloudShareTarget::SharedTarget("not-a-cloudkit-share-target".to_owned());
        assert_eq!(
            (icloud).validate_replication(ReplicationType::Shared),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        Ok(())
    }

    #[test]
    fn shared_icloud_onboarding_carries_target_without_owner_credentials() -> anyhow::Result<()> {
        let target =
            ICloudSharedTarget::new(ICloudShareRole::Owner, "zone", "owner", "root", "guid")?
                .to_storage_id()?;
        let mut icloud = StorageProviderData::oauth_provider(
            "icloud",
            OauthFilePreset::ICloud,
            StoredOAuthRemoteFileId::Unresolved,
            "nook-events",
        );
        let oauth = (match &mut icloud.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Some(config),
            StoredOAuthFileConfiguration::NotApplicable => None,
        })
        .ok_or_else(|| io::Error::other("OAuth config must exist"))?;
        oauth.icloud_mode = ICloudMode::Shared;
        oauth.icloud_share_target = StoredICloudShareTarget::SharedTarget(target.clone());

        assert_eq!(
            ProviderEnrollmentRequest {
                provider: &icloud,
                architecture: &VaultArchitecture::default(),
                shared_joiner_identity: None,
                shared_storage_target_id: None
            }
            .build()?,
            EnrollmentProvider::shared(SharedEnrollmentProvider::icloud(target.clone()))
        );
        let args = (icloud).connection_args()?;
        assert_eq!(args.mode, "icloud");
        assert_eq!(args.pat, "token");
        assert_eq!(args.repo, format!("{target}\tnook-events"));
        Ok(())
    }

    #[test]
    fn staged_remote_args_reject_incomplete_drafts_and_normalize_targets() -> anyhow::Result<()> {
        assert_eq!(
            StagedRemoteConnection {
                provider_type: StorageProviderType::Local,
                github_pat: None,
                github_repo: None,
                oauth_file: None
            }
            .project()?,
            None
        );
        assert_eq!(
            StagedRemoteConnection {
                provider_type: StorageProviderType::Github,
                github_pat: Some("  "),
                github_repo: None,
                oauth_file: None
            }
            .project()?,
            None
        );
        assert_eq!(
            StagedRemoteConnection {
                provider_type: StorageProviderType::Github,
                github_pat: Some(" pat "),
                github_repo: Some(" owner/repo "),
                oauth_file: None
            }
            .project()?
            .ok_or_else(|| io::Error::other("GitHub args must exist"))?
            .repo,
            "owner/repo"
        );

        let mut oauth = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: StoredOAuthAccessCredential::AccessToken(" token ".to_owned()),
            file_id: StoredOAuthRemoteFileId::FileId("file-id".to_owned()),
            file_name: StoredOAuthRemoteFileName::FileName("stored-name".to_owned()),
            ..OAuthFileConfigData::default()
        };
        assert_eq!(
            StagedRemoteConnection {
                provider_type: StorageProviderType::OauthFile,
                github_pat: None,
                github_repo: Some("draft-name"),
                oauth_file: Some(&oauth)
            }
            .project()?
            .ok_or_else(|| io::Error::other("OAuth args must exist"))?
            .repo,
            "file-id\tdraft-name"
        );
        oauth.drive_mode = GoogleDriveMode::Shared;
        oauth.folder_id = StoredGoogleDriveFolder::FolderId("shared-folder".to_owned());
        assert_eq!(
            StagedRemoteConnection {
                provider_type: StorageProviderType::OauthFile,
                github_pat: None,
                github_repo: Some("ignored-draft-name"),
                oauth_file: Some(&oauth)
            }
            .project()?
            .ok_or_else(|| io::Error::other("shared OAuth args must exist"))?
            .repo,
            "shared:shared-folder\tstored-name"
        );
        Ok(())
    }

    #[test]
    fn github_draft_bytes_differ_intentionally_from_staged_normalization() -> anyhow::Result<()> {
        for (pat, repo) in [(" pat ", " repo "), ("\t", " "), ("", "")] {
            let draft = DraftStorageConnection {
                provider_type: StorageProviderType::Github,
                github_pat: Some(pat),
                github_repo: Some(repo),
                oauth_preset: None,
                oauth_access_token: None,
                oauth_file_id: None,
                oauth_file_name: None,
            }
            .project();
            assert_eq!(draft.pat, pat);
            assert_eq!(draft.repo, repo);
            let staged = StagedRemoteConnection {
                provider_type: StorageProviderType::Github,
                github_pat: Some(pat),
                github_repo: Some(repo),
                oauth_file: None,
            }
            .project()?;
            if pat.trim().is_empty() {
                assert_eq!(staged, None);
            } else {
                let staged =
                    staged.ok_or_else(|| io::Error::other("nonempty staged credential"))?;
                assert_eq!(staged.pat, pat.trim());
                assert_eq!(staged.repo, repo.trim());
            }
        }
        let staged = StagedRemoteConnection {
            provider_type: StorageProviderType::Github,
            github_pat: Some("pat"),
            github_repo: None,
            oauth_file: None,
        }
        .project()?
        .ok_or_else(|| io::Error::other("staged credential"))?;
        assert_eq!(staged.repo, DEFAULT_GITHUB_REPO_NAME);
        Ok(())
    }

    #[test]
    fn incomplete_oauth_precedes_malformed_target_and_preserves_input() -> anyhow::Result<()> {
        let mut oauth = OAuthFileConfigData {
            preset: OauthFilePreset::ICloud,
            icloud_mode: ICloudMode::Shared,
            icloud_share_target: StoredICloudShareTarget::SharedTarget(" ".to_owned()),
            access_token: StoredOAuthAccessCredential::AccessToken(" ".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let before = oauth.clone();
        assert_eq!(
            StagedRemoteConnection {
                provider_type: StorageProviderType::OauthFile,
                github_pat: None,
                github_repo: None,
                oauth_file: Some(&oauth),
            }
            .project()?,
            None
        );
        assert_eq!(oauth, before);
        oauth.access_token = StoredOAuthAccessCredential::AccessToken("token".to_owned());
        let before = oauth.clone();
        assert_eq!(
            StagedRemoteConnection {
                provider_type: StorageProviderType::OauthFile,
                github_pat: None,
                github_repo: None,
                oauth_file: Some(&oauth),
            }
            .project(),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        assert_eq!(oauth, before);
        Ok(())
    }

    #[test]
    fn selection_preserves_order_and_rejects_an_incompatible_preference() {
        let providers = vec![
            StorageProviderData::github_provider("first", "repo", "pat"),
            StorageProviderData::github_provider("second", "repo", "pat"),
        ];
        for (policy, expected) in [
            (ProviderSelectionPolicy::FirstCompatible, "first"),
            (ProviderSelectionPolicy::Prefer("missing".into()), "first"),
            (ProviderSelectionPolicy::Prefer("second".into()), "second"),
        ] {
            assert_eq!(
                ProviderSelectionRequest {
                    providers: &providers,
                    replication_type: ReplicationType::Personal,
                    policy,
                }
                .select(),
                ProviderSelection::Selected(expected.into())
            );
        }
        assert_eq!(
            ProviderSelectionRequest {
                providers: &providers,
                replication_type: ReplicationType::Shared,
                policy: ProviderSelectionPolicy::Prefer("second".into()),
            }
            .select(),
            ProviderSelection::Unavailable
        );
        assert_eq!(
            ProviderSelectionRequest {
                providers: &[],
                replication_type: ReplicationType::Personal,
                policy: ProviderSelectionPolicy::FirstCompatible,
            }
            .select(),
            ProviderSelection::Unavailable
        );
        assert_eq!(providers[0].id, "first");
        assert_eq!(providers[1].id, "second");
    }
}
