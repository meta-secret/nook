#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use serde::{Deserialize, Serialize};
use tsify::Tsify;
use zeroize::Zeroize;

use super::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, ICloudSharedTarget,
    OAuthRemoteStorageReference, OauthFilePreset, ProviderReplicationCapability, ReplicationType,
    StorageMode, StorageProviderData, StorageProviderType, StoredGithubPat, StoredGithubRepository,
    StoredGoogleDriveFolder, StoredICloudShareTarget, StoredOAuthAccessCredential,
    StoredOAuthFileConfiguration, StoredOAuthRemoteFileName, StoredS3Configuration,
    ValidationError, ValidationResult,
};
use crate::{ProviderOauthPreset, S3Connection};

/// Where the manager opens a vault: the provider and everything it connects
/// with, validated again when the manager prepares its storage. It crosses
/// the WASM boundary as one value tagged by its [`StorageMode`]; only the
/// token and the S3 connection carry a secret.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(
    tag = "mode",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum StorageConnection {
    /// `IndexedDB` on this device only.
    Local,
    /// A repository of the token's GitHub account.
    Github { token: String, repo: String },
    /// The event file in the vault's shared Google Drive folder.
    GoogleDrive {
        token: String,
        folder_id: String,
        file_name: String,
    },
    /// The event file in a `CloudKit` share, named by its storage id.
    #[serde(rename = "icloud")]
    ICloud {
        token: String,
        share_target: String,
        file_name: String,
    },
    /// An S3-compatible location and this device's key.
    S3 { connection: S3Connection },
}

impl StorageConnection {
    #[must_use]
    pub const fn mode(&self) -> StorageMode {
        match self {
            Self::Local => StorageMode::Local,
            Self::Github { .. } => StorageMode::Github,
            Self::GoogleDrive { .. } => StorageMode::GoogleDrive,
            Self::ICloud { .. } => StorageMode::ICloud,
            Self::S3 { .. } => StorageMode::S3,
        }
    }
}

/// Wipes the credential the connection carries.
impl Zeroize for StorageConnection {
    fn zeroize(&mut self) {
        match self {
            Self::Github { token, .. }
            | Self::GoogleDrive { token, .. }
            | Self::ICloud { token, .. } => token.zeroize(),
            Self::S3 { connection } => connection.secret_access_key.zeroize(),
            Self::Local => {}
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

    /// The shared target an OAuth-file provider connects through: the Drive
    /// vault folder id or the `CloudKit` share's storage id. A provider
    /// without one is not connectable yet.
    #[must_use]
    pub fn connection_target(&self) -> OAuthRemoteStorageReference {
        let target = match self.preset {
            OauthFilePreset::GoogleDrive => match &self.folder_id {
                StoredGoogleDriveFolder::FolderId(folder) => folder.trim(),
                StoredGoogleDriveFolder::Root => "",
            },
            OauthFilePreset::ICloud => match &self.icloud_share_target {
                StoredICloudShareTarget::SharedTarget(target) => target.trim(),
                StoredICloudShareTarget::Unbound => "",
            },
        };
        match target {
            "" => OAuthRemoteStorageReference::Unresolved,
            target => OAuthRemoteStorageReference::Resolved(target.into()),
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
    pub fn connection_args(&self) -> ValidationResult<StorageConnection> {
        match self.provider_type {
            StorageProviderType::Local | StorageProviderType::LocalFolder => {
                Ok(StorageConnection::Local)
            }
            StorageProviderType::Github => Ok(self.github_connection_args()),
            StorageProviderType::OauthFile => self.oauth_file_connection_args(),
            // A row without its S3 block cannot connect.
            StorageProviderType::S3 => match &self.s3 {
                StoredS3Configuration::Configured(connection) => Ok(StorageConnection::S3 {
                    connection: connection.clone(),
                }),
                StoredS3Configuration::NotApplicable => {
                    Err(ValidationError::S3StorageTargetInvalid)
                }
            },
        }
    }

    fn github_connection_args(&self) -> StorageConnection {
        StorageConnection::Github {
            token: match &self.github_pat {
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

    fn oauth_file_connection_args(&self) -> ValidationResult<StorageConnection> {
        let StoredOAuthFileConfiguration::Configured(oauth) = &self.oauth_file else {
            return Ok(StorageConnection::GoogleDrive {
                token: String::new(),
                folder_id: String::new(),
                file_name: DEFAULT_DRIVE_BACKUP_NAME.to_owned(),
            });
        };
        let OAuthRemoteStorageReference::Resolved(target) = oauth.connection_target() else {
            return Err(ValidationError::SharedStorageTargetRequired);
        };
        let token = match &oauth.access_token {
            StoredOAuthAccessCredential::SignedOut => String::new(),
            StoredOAuthAccessCredential::AccessToken(token) => token.trim().to_owned(),
        };
        let file_name = oauth.backup_file_name().to_owned();
        Ok(match oauth.preset {
            OauthFilePreset::GoogleDrive => StorageConnection::GoogleDrive {
                token,
                folder_id: target.as_str().to_owned(),
                file_name,
            },
            OauthFilePreset::ICloud => StorageConnection::ICloud {
                token,
                share_target: target.as_str().to_owned(),
                file_name,
            },
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
        StoredOAuthRemoteFileId, StoredOAuthRemoteFileName, StoredS3Configuration,
    };

    use super::StorageConnection;
    use crate::{
        DEFAULT_GITHUB_REPO_NAME, OAuthFileConfigData, OauthFilePreset, ReplicationType,
        S3Connection, StorageMode, StorageProviderData, StorageProviderType, ValidationError,
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
    use serde_json::json;
    use zeroize::Zeroize;

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
                s3: StoredS3Configuration::NotApplicable,
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
                s3: StoredS3Configuration::NotApplicable,
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
                s3: StoredS3Configuration::NotApplicable,
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
            StorageConnection::Github {
                token: "pat".to_owned(),
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
            StorageConnection::GoogleDrive {
                token: "token".to_owned(),
                folder_id: "folder-1".to_owned(),
                file_name: "events".to_owned(),
            }
        );
        assert_eq!(
            (StorageProviderData::local_folder_provider("folder", "handle-1")).connection_args()?,
            StorageConnection::Local
        );
        Ok(())
    }

    #[test]
    fn each_connection_crosses_the_wire_tagged_by_its_mode() -> anyhow::Result<()> {
        let token = || "user-token".to_owned();
        for (connection, wire) in [
            (StorageConnection::Local, json!({ "mode": "local" })),
            (
                StorageConnection::Github {
                    token: token(),
                    repo: "vault".to_owned(),
                },
                json!({ "mode": "github", "token": "user-token", "repo": "vault" }),
            ),
            (
                StorageConnection::GoogleDrive {
                    token: token(),
                    folder_id: "folder-1".to_owned(),
                    file_name: "events".to_owned(),
                },
                json!({
                    "mode": "google-drive",
                    "token": "user-token",
                    "folderId": "folder-1",
                    "fileName": "events",
                }),
            ),
            (
                StorageConnection::ICloud {
                    token: token(),
                    share_target: "icloud-share-v1:{}".to_owned(),
                    file_name: "events".to_owned(),
                },
                json!({
                    "mode": "icloud",
                    "token": "user-token",
                    "shareTarget": "icloud-share-v1:{}",
                    "fileName": "events",
                }),
            ),
        ] {
            assert_eq!(serde_json::to_value(&connection)?, wire);
            assert_eq!(wire.get("mode"), Some(&json!(connection.mode().as_str())));
            assert_eq!(
                serde_json::from_value::<StorageConnection>(wire)?,
                connection
            );
            let mut wiped = connection.clone();
            wiped.zeroize();
            assert!(!serde_json::to_string(&wiped)?.contains("user-token"));
        }
        // A local folder is not a storage mode the manager prepares.
        assert!(
            serde_json::from_value::<StorageConnection>(json!({ "mode": "local-folder" })).is_err()
        );
        Ok(())
    }

    #[test]
    fn an_s3_connection_carries_its_secret_in_its_own_field_alone() -> anyhow::Result<()> {
        const SECRET: &str = "TEST-ONLY-device-a-secret-not-real";
        let connection = StorageConnection::S3 {
            connection: S3Connection::fixture()?,
        };
        assert_eq!(connection.mode(), StorageMode::S3);
        let wire = serde_json::to_value(&connection)?;
        assert_eq!(
            wire,
            json!({
                "mode": "s3",
                "connection": {
                    "endpoint": "http://127.0.0.1:8333",
                    "region": "us-east-1",
                    "bucket": "nook-dev",
                    "keyPrefix": { "state": "prefix", "value": "e2e/run-1" },
                    "accessKeyId": "device-a",
                    "secretAccessKey": SECRET,
                },
            })
        );
        assert_eq!(wire.to_string().matches(SECRET).count(), 1);
        assert!(!format!("{connection:?}").contains(SECRET));
        // Reading it back validates the location as the setup form does.
        assert_eq!(
            serde_json::from_value::<StorageConnection>(wire.clone())?,
            connection
        );
        let mut damaged = wire;
        if let Some(bucket) = damaged.pointer_mut("/connection/bucket") {
            *bucket = json!("nook/dev");
        }
        assert!(serde_json::from_value::<StorageConnection>(damaged).is_err());
        let mut wiped = connection;
        wiped.zeroize();
        assert!(!serde_json::to_string(&wiped)?.contains(SECRET));
        Ok(())
    }

    #[test]
    fn an_s3_row_connects_with_its_connection() -> anyhow::Result<()> {
        let config = S3Connection::fixture()?;
        let mut row = StorageProviderData::github_provider("s3", "", "");
        row.provider_type = StorageProviderType::S3;
        row.github_pat = StoredGithubPat::Missing;
        row.s3 = StoredS3Configuration::Configured(config.clone());
        assert_eq!(
            row.connection_args()?,
            StorageConnection::S3 { connection: config }
        );
        assert!(row.validate_replication(ReplicationType::Personal).is_ok());
        assert!(!row.supports_replication(ReplicationType::Shared));
        row.s3 = StoredS3Configuration::NotApplicable;
        assert_eq!(
            row.connection_args(),
            Err(ValidationError::S3StorageTargetInvalid)
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
            StorageConnection::ICloud {
                token: "token".to_owned(),
                share_target: "file-id".to_owned(),
                file_name: "repo-fallback".to_owned(),
            }
        );
        // A Drive draft without its folder still projects; preparing it fails.
        assert_eq!(
            DraftStorageConnection::OAuth(OAuthStorageDraft {
                preset: OauthFilePreset::GoogleDrive,
                credential: &StoredOAuthAccessCredential::SignedOut,
                remote_reference: OAuthRemoteStorageReference::Unresolved,
                file_name: &StoredOAuthRemoteFileName::Unresolved,
                alternate_name: &StoredOAuthRemoteFileName::Unresolved,
            })
            .project(),
            StorageConnection::GoogleDrive {
                token: String::new(),
                folder_id: String::new(),
                file_name: "nook-events".to_owned(),
            }
        );
        let provider = StorageProviderData::github_provider("gh", "team-vault", "pat");
        assert_eq!(
            VaultStorageConnection::LocalCache.project()?,
            StorageConnection::Local
        );
        assert_eq!(
            VaultStorageConnection::AuthenticatedProvider(&provider).project()?,
            StorageConnection::Github {
                token: "pat".to_owned(),
                repo: "team-vault".to_owned(),
            }
        );
        assert_eq!(
            VaultStorageConnection::Draft(DraftStorageConnection::Github(GithubStorageDraft {
                credential: &StoredGithubPat::Token("draft-pat".to_owned()),
                repository: &StoredGithubRepository::Repository("draft-repo".to_owned()),
            }))
            .project()?,
            StorageConnection::Github {
                token: "draft-pat".to_owned(),
                repo: "draft-repo".to_owned(),
            }
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
        assert_eq!(
            icloud.connection_args()?,
            StorageConnection::ICloud {
                token: "token".to_owned(),
                share_target: target,
                file_name: "nook-events".to_owned(),
            }
        );
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
            .ready()?,
            StorageConnection::Github {
                token: "pat".to_owned(),
                repo: "owner/repo".to_owned(),
            }
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
            .project()?,
            StagedStorageConnection::Incomplete
        );
        // Drive events stay under the stored backup name in the vault folder.
        oauth.folder_id = StoredGoogleDriveFolder::FolderId("shared-folder".to_owned());
        assert_eq!(
            StagedRemoteConnection::OAuth(StagedOAuthConnection {
                configuration: &StoredOAuthFileConfiguration::configured(oauth),
                file_name: &StoredOAuthRemoteFileName::FileName(("ignored-draft-name").to_owned()),
            })
            .project()?
            .ready()?,
            StorageConnection::GoogleDrive {
                token: "token".to_owned(),
                folder_id: "shared-folder".to_owned(),
                file_name: "stored-name".to_owned(),
            }
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
            .ready()?,
            StorageConnection::ICloud {
                token: "token".to_owned(),
                share_target: "share".to_owned(),
                file_name: "draft-name".to_owned(),
            }
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
            assert_eq!(
                draft,
                StorageConnection::Github {
                    token: pat.to_owned(),
                    repo: repo.to_owned(),
                }
            );
            let staged = StagedRemoteConnection::Github(StagedGithubConnection {
                credential: &StoredGithubPat::Token((pat).to_owned()),
                repository: &StoredGithubRepository::Repository((repo).to_owned()),
            })
            .project()?;
            if pat.trim().is_empty() {
                assert_eq!(staged, StagedStorageConnection::Incomplete);
            } else {
                assert_eq!(
                    staged.ready()?,
                    StorageConnection::Github {
                        token: pat.trim().to_owned(),
                        repo: repo.trim().to_owned(),
                    }
                );
            }
        }
        let staged = StagedRemoteConnection::Github(StagedGithubConnection {
            credential: &StoredGithubPat::Token(("pat").to_owned()),
            repository: &StoredGithubRepository::DefaultRepository,
        })
        .project()?
        .ready()?;
        assert_eq!(
            staged,
            StorageConnection::Github {
                token: "pat".to_owned(),
                repo: DEFAULT_GITHUB_REPO_NAME.to_owned(),
            }
        );
        Ok(())
    }

    #[test]
    fn oauth_without_a_shared_target_stays_incomplete_and_preserves_input() -> anyhow::Result<()> {
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
            .project()?,
            StagedStorageConnection::Incomplete
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
        fn ready(self) -> anyhow::Result<StorageConnection> {
            match self {
                Self::Ready(args) => Ok(args),
                Self::Incomplete => anyhow::bail!("staged connection is incomplete"),
            }
        }
    }
}
