#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use super::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, ICloudSharedTarget,
    OAuthRemoteStorageReference, OAuthStorageReference, OauthFilePreset,
    ProviderReplicationCapability, ReplicationType, StorageMode, StorageProviderData,
    StorageProviderType, StoredGithubPat, StoredGithubRepository, StoredICloudShareTarget,
    StoredOAuthAccessCredential, StoredOAuthFileConfiguration, StoredOAuthRemoteFileName,
    ValidationError, ValidationResult,
};
use crate::{DriveBackupName, ProviderOauthPreset};

/// Positional connect arguments expected by the current wasm manager boundary:
/// storage mode, credential/token, and remote reference/repo.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, tsify::Tsify)]
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

impl super::OAuthFileConfig {
    fn backup_file_name(&self) -> &str {
        match &self.file_name {
            StoredOAuthRemoteFileName::FileName(name) => match name.trim() {
                "" => DEFAULT_DRIVE_BACKUP_NAME,
                name => name,
            },
            StoredOAuthRemoteFileName::Unresolved => DEFAULT_DRIVE_BACKUP_NAME,
        }
    }

    /// Every OAuth-file provider connects through its shared target: the Drive
    /// vault folder or the `CloudKit` share. A provider without one is not
    /// connectable yet.
    fn connection_storage_id(&self) -> ValidationResult<OAuthStorageReference> {
        match self.remote_storage_ref() {
            OAuthRemoteStorageReference::Resolved(storage_id) => Ok(storage_id),
            OAuthRemoteStorageReference::Unresolved => {
                Err(ValidationError::SharedStorageTargetRequired)
            }
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

impl StorageProviderData {
    pub fn connection_args(&self) -> ValidationResult<StorageConnectArgs> {
        let args = match self.provider_type {
            StorageProviderType::Local | StorageProviderType::LocalFolder => {
                return Ok(StorageConnectArgs::local());
            }
            StorageProviderType::Github => self.github_connection_args(),
            StorageProviderType::OauthFile => self.oauth_file_connection_args()?,
        };
        Ok(args)
    }

    fn github_connection_args(&self) -> StorageConnectArgs {
        StorageConnectArgs {
            mode: StorageMode::Github.as_str().to_owned(),
            pat: match &self.github_pat {
                StoredGithubPat::Token(pat) => pat.trim().to_owned(),
                StoredGithubPat::Missing => String::new(),
            },
            repo: match &self.github_repo {
                StoredGithubRepository::Repository(repo) if !repo.trim().is_empty() => {
                    repo.trim().to_owned()
                }
                StoredGithubRepository::Repository(_)
                | StoredGithubRepository::DefaultRepository => DEFAULT_GITHUB_REPO_NAME.to_owned(),
            },
        }
    }

    fn oauth_file_connection_args(&self) -> ValidationResult<StorageConnectArgs> {
        let StoredOAuthFileConfiguration::Configured(oauth) = &self.oauth_file else {
            return Ok(StorageConnectArgs {
                mode: StorageMode::GoogleDrive.as_str().to_owned(),
                pat: String::new(),
                repo: DEFAULT_DRIVE_BACKUP_NAME.to_owned(),
            });
        };
        let storage_id = oauth.connection_storage_id()?;
        let mode = match oauth.preset {
            OauthFilePreset::GoogleDrive => StorageMode::GoogleDrive,
            OauthFilePreset::ICloud => StorageMode::ICloud,
        };
        let token = match &oauth.access_token {
            StoredOAuthAccessCredential::SignedOut => String::new(),
            StoredOAuthAccessCredential::AccessToken(token) => token.trim().to_owned(),
        };
        Ok(StorageConnectArgs {
            mode: mode.as_str().to_owned(),
            pat: token,
            repo: DriveBackupName::format_storage_ref_raw(
                storage_id.as_str(),
                oauth.backup_file_name(),
            ),
        })
    }

    #[must_use]
    pub fn replication_capability(&self) -> ProviderReplicationCapability {
        let preset = match &self.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => {
                ProviderOauthPreset::Preset(config.preset)
            }
            StoredOAuthFileConfiguration::NotApplicable => ProviderOauthPreset::NotApplicable,
        };
        ProviderReplicationCapability::for_provider(self.provider_type, preset)
    }
    pub fn validate_replication(
        &self,
        replication_type: ReplicationType,
    ) -> ValidationResult<ProviderReplicationCapability> {
        let preset = match &self.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => {
                ProviderOauthPreset::Preset(config.preset)
            }
            StoredOAuthFileConfiguration::NotApplicable => ProviderOauthPreset::NotApplicable,
        };
        let capability =
            ProviderReplicationCapability::validate(self.provider_type, preset, replication_type)?;
        if replication_type == ReplicationType::Shared
            && let StoredOAuthFileConfiguration::Configured(oauth) = &self.oauth_file
            && oauth.preset == OauthFilePreset::ICloud
        {
            let target = match &oauth.icloud_share_target {
                StoredICloudShareTarget::SharedTarget(target) if !target.trim().is_empty() => {
                    target.trim()
                }
                StoredICloudShareTarget::Unbound | StoredICloudShareTarget::SharedTarget(_) => {
                    return Err(ValidationError::SharedStorageTargetRequired);
                }
            };
            ICloudSharedTarget::from_storage_id(target)?;
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

    use super::StorageConnectArgs;
    use crate::{
        DEFAULT_GITHUB_REPO_NAME, OAuthFileConfigData, OauthFilePreset, ReplicationType,
        StorageProviderData, StorageProviderType, ValidationError,
    };
    use crate::{
        DraftStorageConnection, GithubStorageDraft, OAuthRemoteStorageReference, OAuthStorageDraft,
        VaultStorageConnection,
    };
    use crate::{
        EnrollmentAudience, EnrollmentProvider, LocalFolderConfigData, ProviderEnrollmentRequest,
        ProviderSyncCheckpoint, SharedEnrollmentAudience, SharedEnrollmentProvider,
        VaultArchitecture,
    };
    use crate::{
        ProviderSelection, ProviderSelectionPolicy, ProviderSelectionRequest,
        StagedGithubConnection, StagedOAuthConnection, StagedRemoteConnection,
        StagedStorageConnection,
    };

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
        fn with_oauth(
            mut self,
            edit: impl FnOnce(&mut OAuthFileConfigData),
        ) -> anyhow::Result<StorageProviderData> {
            let StoredOAuthFileConfiguration::Configured(oauth) = &mut self.oauth_file else {
                anyhow::bail!("OAuth config must exist");
            };
            edit(oauth);
            Ok(self)
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
            StorageProviderData::oauth_provider(
                "drive",
                OauthFilePreset::GoogleDrive,
                StoredOAuthRemoteFileId::FileId(" file-1 ".to_owned()),
                " events ",
            )
            .with_oauth(|oauth| {
                oauth.folder_id = StoredGoogleDriveFolder::FolderId(" folder-1 ".to_owned());
            })?
            .connection_args()?,
            StorageConnectArgs {
                mode: "google-drive".to_owned(),
                pat: "token".to_owned(),
                repo: "shared:folder-1\tevents".to_owned(),
            }
        );
        assert_eq!(
            (StorageProviderData::local_folder_provider("folder", "handle-1")).connection_args()?,
            StorageConnectArgs::local()
        );
        Ok(())
    }

    #[test]
    fn oauth_storage_requires_its_shared_target() -> anyhow::Result<()> {
        for preset in [OauthFilePreset::GoogleDrive, OauthFilePreset::ICloud] {
            // A cached file id never substitutes for the shared folder or share.
            let provider = StorageProviderData::oauth_provider(
                "oauth",
                preset,
                StoredOAuthRemoteFileId::FileId("file-id".to_owned()),
                "events",
            );
            assert_eq!(
                provider.connection_args(),
                Err(ValidationError::SharedStorageTargetRequired)
            );
        }
        Ok(())
    }

    #[test]
    fn draft_and_vault_storage_choose_the_correct_precedence() -> anyhow::Result<()> {
        let credential = StoredOAuthAccessCredential::AccessToken(" token ".to_owned());
        let file_name = StoredOAuthRemoteFileName::FileName(" ".to_owned());
        let alternate_name = StoredOAuthRemoteFileName::FileName(" repo-fallback ".to_owned());
        let oauth = DraftStorageConnection::OAuth(OAuthStorageDraft {
            preset: OauthFilePreset::ICloud,
            credential: &credential,
            remote_reference: OAuthRemoteStorageReference::Resolved(" file-id ".into()),
            file_name: &file_name,
            alternate_name: &alternate_name,
        });
        assert_eq!(
            oauth.project(),
            StorageConnectArgs {
                mode: "icloud".to_owned(),
                pat: "token".to_owned(),
                repo: "file-id\trepo-fallback".to_owned()
            }
        );
        let provider = StorageProviderData::github_provider("gh", "team-vault", "pat");
        assert_eq!(
            VaultStorageConnection::LocalCache.project()?,
            StorageConnectArgs::local()
        );
        assert_eq!(
            VaultStorageConnection::AuthenticatedProvider(&provider)
                .project()?
                .repo,
            "team-vault"
        );
        assert_eq!(
            VaultStorageConnection::Draft(DraftStorageConnection::Github(GithubStorageDraft {
                credential: &StoredGithubPat::Token("draft-pat".to_owned()),
                repository: &StoredGithubRepository::Repository("draft-repo".to_owned()),
            }))
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
        assert!(
            providers
                .first()
                .is_some_and(|provider| !provider.supports_replication(ReplicationType::Shared))
        );
        assert!(
            providers
                .get(1)
                .is_some_and(|provider| provider.supports_replication(ReplicationType::Shared))
        );
    }

    #[test]
    fn icloud_requires_a_valid_share_for_shared_replication() -> anyhow::Result<()> {
        let icloud = StorageProviderData::oauth_provider(
            "icloud",
            OauthFilePreset::ICloud,
            StoredOAuthRemoteFileId::Unresolved,
            "nook-events",
        );
        assert_eq!(
            icloud.validate_replication(ReplicationType::Shared),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        let malformed = icloud.with_oauth(|oauth| {
            oauth.icloud_share_target =
                StoredICloudShareTarget::SharedTarget("not-a-cloudkit-share-target".to_owned());
        })?;
        assert_eq!(
            malformed.validate_replication(ReplicationType::Shared),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        Ok(())
    }

    #[test]
    fn icloud_device_invites_carry_the_share_and_account_without_credentials() -> anyhow::Result<()>
    {
        let target =
            ICloudSharedTarget::new(ICloudShareRole::Owner, "zone", "owner", "root", "guid")?
                .to_storage_id()?;
        let icloud = StorageProviderData::oauth_provider(
            "icloud",
            OauthFilePreset::ICloud,
            StoredOAuthRemoteFileId::Unresolved,
            "nook-events",
        )
        .with_oauth(|oauth| {
            oauth.icloud_share_target = StoredICloudShareTarget::SharedTarget(target.clone());
        })?;

        assert_eq!(
            ProviderEnrollmentRequest {
                provider: &icloud,
                architecture: &VaultArchitecture::default(),
                audience: EnrollmentAudience::Shared(SharedEnrollmentAudience {
                    joiner_identity: "member@icloud.com",
                }),
            }
            .build()?,
            EnrollmentProvider::shared(SharedEnrollmentProvider::icloud(
                "member@icloud.com".to_owned(),
                target.clone()
            ))
        );
        let args = icloud.connection_args()?;
        assert_eq!(args.mode, "icloud");
        assert_eq!(args.pat, "token");
        assert_eq!(args.repo, format!("{target}\tnook-events"));
        Ok(())
    }

    #[test]
    fn staged_remote_args_reject_incomplete_drafts_and_normalize_targets() -> anyhow::Result<()> {
        assert_eq!(
            StagedRemoteConnection::Local.project()?,
            StagedStorageConnection::Incomplete
        );
        assert_eq!(
            StagedRemoteConnection::Github(StagedGithubConnection {
                credential: &StoredGithubPat::Token(("  ").to_owned()),
                repository: &StoredGithubRepository::DefaultRepository
            })
            .project()?,
            StagedStorageConnection::Incomplete
        );
        assert_eq!(
            StagedRemoteConnection::Github(StagedGithubConnection {
                credential: &StoredGithubPat::Token((" pat ").to_owned()),
                repository: &StoredGithubRepository::Repository((" owner/repo ").to_owned())
            })
            .project()?
            .ready()?
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
            StagedRemoteConnection::OAuth(StagedOAuthConnection {
                configuration: &StoredOAuthFileConfiguration::configured(oauth.clone()),
                file_name: &StoredOAuthRemoteFileName::FileName(("draft-name").to_owned()),
            })
            .project(),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        // Drive events stay under the stored backup name in the vault folder.
        oauth.folder_id = StoredGoogleDriveFolder::FolderId("shared-folder".to_owned());
        assert_eq!(
            StagedRemoteConnection::OAuth(StagedOAuthConnection {
                configuration: &StoredOAuthFileConfiguration::configured(oauth),
                file_name: &StoredOAuthRemoteFileName::FileName(("ignored-draft-name").to_owned()),
            })
            .project()?
            .ready()?
            .repo,
            "shared:shared-folder\tstored-name"
        );

        let icloud = OAuthFileConfigData {
            preset: OauthFilePreset::ICloud,
            access_token: StoredOAuthAccessCredential::AccessToken("token".to_owned()),
            file_name: StoredOAuthRemoteFileName::FileName("stored-name".to_owned()),
            icloud_share_target: StoredICloudShareTarget::SharedTarget("share".to_owned()),
            ..OAuthFileConfigData::default()
        };
        assert_eq!(
            StagedRemoteConnection::OAuth(StagedOAuthConnection {
                configuration: &StoredOAuthFileConfiguration::configured(icloud),
                file_name: &StoredOAuthRemoteFileName::FileName((" draft-name ").to_owned()),
            })
            .project()?
            .ready()?
            .repo,
            "share\tdraft-name"
        );
        Ok(())
    }

    #[test]
    fn github_draft_bytes_differ_intentionally_from_staged_normalization() -> anyhow::Result<()> {
        for (pat, repo) in [(" pat ", " repo "), ("\t", " "), ("", "")] {
            let draft = DraftStorageConnection::Github(GithubStorageDraft {
                credential: &StoredGithubPat::Token(pat.to_owned()),
                repository: &StoredGithubRepository::Repository(repo.to_owned()),
            })
            .project();
            assert_eq!(draft.pat, pat);
            assert_eq!(draft.repo, repo);
            let staged = StagedRemoteConnection::Github(StagedGithubConnection {
                credential: &StoredGithubPat::Token((pat).to_owned()),
                repository: &StoredGithubRepository::Repository((repo).to_owned()),
            })
            .project()?;
            if pat.trim().is_empty() {
                assert_eq!(staged, StagedStorageConnection::Incomplete);
            } else {
                let staged = staged.ready()?;
                assert_eq!(staged.pat, pat.trim());
                assert_eq!(staged.repo, repo.trim());
            }
        }
        let staged = StagedRemoteConnection::Github(StagedGithubConnection {
            credential: &StoredGithubPat::Token(("pat").to_owned()),
            repository: &StoredGithubRepository::DefaultRepository,
        })
        .project()?
        .ready()?;
        assert_eq!(staged.repo, DEFAULT_GITHUB_REPO_NAME);
        Ok(())
    }

    #[test]
    fn incomplete_oauth_precedes_malformed_target_and_preserves_input() -> anyhow::Result<()> {
        let mut oauth = OAuthFileConfigData {
            preset: OauthFilePreset::ICloud,
            icloud_share_target: StoredICloudShareTarget::SharedTarget(" ".to_owned()),
            access_token: StoredOAuthAccessCredential::AccessToken(" ".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let before = oauth.clone();
        assert_eq!(
            StagedRemoteConnection::OAuth(StagedOAuthConnection {
                configuration: &StoredOAuthFileConfiguration::configured(oauth.clone()),
                file_name: &StoredOAuthRemoteFileName::Unresolved,
            })
            .project()?,
            StagedStorageConnection::Incomplete
        );
        assert_eq!(oauth, before);
        oauth.access_token = StoredOAuthAccessCredential::AccessToken("token".to_owned());
        let before = oauth.clone();
        assert_eq!(
            StagedRemoteConnection::OAuth(StagedOAuthConnection {
                configuration: &StoredOAuthFileConfiguration::configured(oauth.clone()),
                file_name: &StoredOAuthRemoteFileName::Unresolved,
            })
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
        assert_eq!(
            providers.first().map(|provider| provider.id.as_str()),
            Some("first")
        );
        assert_eq!(
            providers.get(1).map(|provider| provider.id.as_str()),
            Some("second")
        );
    }
    impl StagedStorageConnection {
        fn ready(self) -> anyhow::Result<StorageConnectArgs> {
            match self {
                Self::Ready(args) => Ok(args),
                Self::Incomplete => anyhow::bail!("staged connection is incomplete"),
            }
        }
    }
}
