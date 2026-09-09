#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::ProviderSyncCheckpoint;

use crate::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, GithubPat, GithubPatMask,
    GithubSyncTarget, ICloudMode, LocalFolderSyncTarget, OauthFilePreset, OauthFileSyncTarget,
    ProviderVaultScope, StorageProviderType, StoredGithubPat, StoredGithubRepository,
    StoredLocalFolderConfiguration, StoredOAuthFileConfiguration, SyncProviderTarget,
};

use super::{
    AuthProvidersSnapshotData, ProviderLabelLabels, ProviderStorageDetailLabels,
    StorageProviderData,
};

pub struct DuplicateProviderSelection<'a> {
    pub providers: &'a [StorageProviderData],
    pub candidate: &'a StorageProviderData,
    pub exclude_id: Option<&'a str>,
}
#[derive(Clone, Copy)]
pub struct LocalProviderRowRequest<'a> {
    pub active_store_id: Option<&'a str>,
    pub new_id: &'a str,
    pub created_at: &'a str,
}
struct CatalogProviderText<'a>(Option<&'a str>);

impl StorageProviderData {
    pub fn storage_detail(&self, labels: &ProviderStorageDetailLabels) -> String {
        let provider = self;
        let provider_type = provider.provider_type;
        match provider_type {
            StorageProviderType::Local => labels.this_device_desc.clone(),
            StorageProviderType::LocalFolder => provider
                .local_folder
                .as_ref()
                .and_then(|folder| {
                    CatalogProviderText(folder.directory_name.as_deref()).non_empty()
                })
                .unwrap_or_else(|| labels.local_folder_needs_reconnect.clone()),
            StorageProviderType::OauthFile => {
                let oauth = provider.oauth_file.as_ref();
                let preset = oauth.map_or(OauthFilePreset::GoogleDrive, |oauth| oauth.preset);
                let file = oauth
                    .and_then(|oauth| CatalogProviderText(oauth.file_name.as_deref()).non_empty())
                    .unwrap_or_else(|| DEFAULT_DRIVE_BACKUP_NAME.to_owned());
                let account = match oauth {
                    Some(oauth) => {
                        match CatalogProviderText(oauth.account_email.as_deref()).non_empty() {
                            Some(email) => email,
                            None if CatalogProviderText(oauth.access_token.as_deref())
                                .non_empty()
                                .is_some() =>
                            {
                                match preset {
                                    OauthFilePreset::ICloud => labels.icloud_signed_in.clone(),
                                    OauthFilePreset::GoogleDrive => labels.google_signed_in.clone(),
                                }
                            }
                            None => match preset {
                                OauthFilePreset::ICloud => labels.icloud_not_signed_in.clone(),
                                OauthFilePreset::GoogleDrive => labels.google_not_signed_in.clone(),
                            },
                        }
                    }
                    None => labels.google_not_signed_in.clone(),
                };
                format!("{file} · {account}")
            }
            StorageProviderType::Github => {
                let repo = CatalogProviderText(provider.github_repo.as_deref())
                    .non_empty()
                    .unwrap_or_else(|| DEFAULT_GITHUB_REPO_NAME.to_owned());
                let pat = match GithubPat::mask(provider.github_pat.as_deref().unwrap_or_default())
                {
                    GithubPatMask::Hint(hint) => hint,
                    GithubPatMask::NoToken => labels.no_token_saved.clone(),
                };
                format!("{repo} · {pat}")
            }
        }
    }
}

impl ProviderLabelLabels {
    #[must_use]
    pub fn localize(&self, label: &str) -> String {
        let labels = self;
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
}

impl StorageProviderData {
    fn catalog_target(&self) -> SyncProviderTarget {
        let provider = self;
        match provider.provider_type {
            StorageProviderType::Local => SyncProviderTarget::Local,
            StorageProviderType::LocalFolder => {
                SyncProviderTarget::LocalFolder(LocalFolderSyncTarget {
                    directory_name: provider
                        .local_folder
                        .as_ref()
                        .and_then(|folder| folder.directory_name.as_deref().map(str::to_owned)),
                    handle_id: provider
                        .local_folder
                        .as_ref()
                        .and_then(|folder| folder.handle_id.as_deref().map(str::to_owned)),
                })
            }
            StorageProviderType::Github => SyncProviderTarget::Github(GithubSyncTarget {
                repo: CatalogProviderText(provider.github_repo.as_deref())
                    .non_empty()
                    .unwrap_or_else(|| DEFAULT_GITHUB_REPO_NAME.to_owned()),
                pat: match CatalogProviderText(provider.github_pat.as_deref()).non_empty() {
                    Some(pat) => pat,
                    None => return SyncProviderTarget::Empty,
                },
            }),
            StorageProviderType::OauthFile => match provider.oauth_file.as_ref() {
                Some(oauth) => {
                    let preset = oauth.preset;
                    SyncProviderTarget::OauthFile(OauthFileSyncTarget {
                        preset,
                        file_id: if preset == OauthFilePreset::ICloud
                            && oauth.resolved_icloud_mode() == ICloudMode::Shared
                        {
                            oauth.icloud_share_target.as_deref().map(str::to_owned)
                        } else {
                            oauth.file_id.as_deref().map(str::to_owned)
                        },
                        folder_id: oauth.folder_id.as_deref().map(str::to_owned),
                        file_name: oauth.file_name.as_deref().map(str::to_owned),
                        account_email: oauth.account_email.as_deref().map(str::to_owned),
                        access_token: oauth.access_token.as_deref().map(str::to_owned),
                    })
                }
                None => SyncProviderTarget::Empty,
            },
        }
    }

    #[must_use]
    pub fn target_key(&self) -> Option<String> {
        let provider = self;
        provider.catalog_target().stable_key()
    }
}

impl DuplicateProviderSelection<'_> {
    #[must_use]
    pub fn find(self) -> Option<StorageProviderData> {
        let Self {
            providers,
            candidate,
            exclude_id,
        } = self;
        let candidate_key = candidate.target_key()?;
        providers
            .iter()
            .find(|provider| {
                if exclude_id.is_some_and(|excluded| provider.id == excluded) {
                    return false;
                }
                provider.target_key().as_deref() == Some(candidate_key.as_str())
            })
            .cloned()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LocalProviderRowChange {
    Present,
    Inserted,
}
pub struct LocalProviderRowOutcome {
    pub snapshot: AuthProvidersSnapshotData,
    pub change: LocalProviderRowChange,
}

impl AuthProvidersSnapshotData {
    #[must_use]
    pub fn ensure_local_row(
        mut self,
        request: LocalProviderRowRequest<'_>,
    ) -> LocalProviderRowOutcome {
        let LocalProviderRowRequest {
            active_store_id,
            new_id,
            created_at,
        } = request;
        let store_id = CatalogProviderText(active_store_id)
            .non_empty()
            .or_else(|| CatalogProviderText(self.active_vault_store_id.as_deref()).non_empty());
        let has_local_for_vault = self.providers.iter().any(|provider| {
            provider.provider_type == StorageProviderType::Local
                && match (
                    &store_id,
                    CatalogProviderText(provider.store_id.as_deref()).non_empty(),
                ) {
                    (None, _) | (Some(_), None) => true,
                    (Some(active), Some(existing)) => *active == existing,
                }
        });
        if has_local_for_vault {
            return LocalProviderRowOutcome {
                snapshot: self,
                change: LocalProviderRowChange::Present,
            };
        }
        let local = StorageProviderData {
            id: new_id.to_owned(),
            provider_type: StorageProviderType::Local,
            label: StorageProviderType::Local.default_label(None, None),
            github_pat: StoredGithubPat::Missing,
            github_repo: StoredGithubRepository::DefaultRepository,
            oauth_file: StoredOAuthFileConfiguration::NotApplicable,
            local_folder: StoredLocalFolderConfiguration::NotApplicable,
            store_id: ProviderVaultScope::from_option(store_id),
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: created_at.to_owned(),
        };
        self.providers.insert(0, local);
        LocalProviderRowOutcome {
            snapshot: self,
            change: LocalProviderRowChange::Inserted,
        }
    }
}

impl CatalogProviderText<'_> {
    fn non_empty(self) -> Option<String> {
        let value = self.0;
        value
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    }
}

#[cfg(test)]
mod tests {
    struct GithubCatalogFixture<'a> {
        id: &'a str,
        repo: &'a str,
        pat: &'a str,
    }
    struct LocalFolderCatalogFixture<'a> {
        id: &'a str,
        handle_id: &'a str,
    }
    struct OAuthCatalogFixture<'a> {
        id: &'a str,
        preset: OauthFilePreset,
        file_id: Option<&'a str>,
        file_name: &'a str,
    }

    use crate::{
        ActiveVaultScope, ProviderVaultScope, StoredGithubPat, StoredGithubRepository,
        StoredGoogleDriveFolder, StoredLocalFolderConfiguration, StoredLocalFolderDirectory,
        StoredLocalFolderHandle, StoredOAuthAccessCredential, StoredOAuthFileConfiguration,
        StoredOAuthRemoteFileId, StoredOAuthRemoteFileName,
    };

    use std::io::Error as IoError;
    use std::slice;

    use crate::{
        AuthProvidersSnapshotData, DEFAULT_DRIVE_BACKUP_NAME, GoogleDriveMode,
        LocalFolderConfigData, OAuthFileConfigData, OauthFilePreset, ProviderLabelLabels,
        ProviderStorageDetailLabels, ProviderSyncCheckpoint, StorageProviderData,
        StorageProviderType,
    };

    use super::{
        DuplicateProviderSelection, LocalProviderRowChange, LocalProviderRowOutcome,
        LocalProviderRowRequest,
    };

    impl GithubCatalogFixture<'_> {
        fn build(self) -> StorageProviderData {
            let Self { id, repo, pat } = self;

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
    }

    impl LocalFolderCatalogFixture<'_> {
        fn build(self) -> StorageProviderData {
            let Self { id, handle_id } = self;

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
    }

    impl OAuthCatalogFixture<'_> {
        fn build(self) -> StorageProviderData {
            let Self {
                id,
                preset,
                file_id,
                file_name,
            } = self;

            StorageProviderData {
                id: id.to_owned(),
                provider_type: StorageProviderType::OauthFile,
                label: "Google Drive".to_owned(),
                github_pat: StoredGithubPat::Missing,
                github_repo: StoredGithubRepository::DefaultRepository,
                oauth_file: StoredOAuthFileConfiguration::configured(OAuthFileConfigData {
                    preset,
                    access_token: StoredOAuthAccessCredential::AccessToken(" token ".to_owned()),
                    file_id: StoredOAuthRemoteFileId::from_option(file_id.map(str::to_owned)),
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

    impl ProviderStorageDetailLabels {
        fn catalog_fixture() -> Self {
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
    }

    impl ProviderLabelLabels {
        fn catalog_fixture() -> Self {
            ProviderLabelLabels {
                this_device: "This device localized".to_owned(),
                github: "GitHub localized".to_owned(),
                local_folder: "Local folder localized".to_owned(),
                google_drive: "Google Drive localized".to_owned(),
                icloud: "iCloud localized".to_owned(),
            }
        }
    }

    #[test]
    fn duplicate_selection_returns_first_nonexcluded_row_without_mutation() {
        let first = GithubCatalogFixture {
            id: "first",
            repo: "repo",
            pat: "pat",
        }
        .build();
        let second = StorageProviderData {
            id: "second".to_owned(),
            ..first.clone()
        };
        let rows = vec![first.clone(), second];
        let original = rows.clone();
        for (exclude_id, expected) in [
            (None, "first"),
            (Some("first"), "second"),
            (Some("absent"), "first"),
        ] {
            let found = DuplicateProviderSelection {
                providers: &rows,
                candidate: &first,
                exclude_id,
            }
            .find();
            assert_eq!(found.map(|row| row.id).as_deref(), Some(expected));
            assert_eq!(rows, original);
        }
    }

    #[test]
    fn duplicate_detection_uses_stable_provider_targets() {
        let existing = GithubCatalogFixture {
            id: "gh-existing",
            repo: "nook-crdt-test-1",
            pat: "github_pat_11AAAA",
        }
        .build();
        let candidate = GithubCatalogFixture {
            id: "gh-new",
            repo: "nook-crdt-test-1",
            pat: "github_pat_11AAAA",
        }
        .build();
        assert_eq!(
            DuplicateProviderSelection {
                providers: &[existing],
                candidate: &candidate,
                exclude_id: None
            }
            .find()
            .map(|provider| provider.id)
            .as_deref(),
            Some("gh-existing")
        );

        let no_pat = StorageProviderData {
            github_pat: StoredGithubPat::Missing,
            ..GithubCatalogFixture {
                id: "gh-draft",
                repo: "nook",
                pat: "github_pat_11AAAA",
            }
            .build()
        };
        assert_eq!(no_pat.target_key(), None);

        let self_row = GithubCatalogFixture {
            id: "gh-self",
            repo: "nook",
            pat: "github_pat_11AAAA",
        }
        .build();
        assert!(
            DuplicateProviderSelection {
                providers: slice::from_ref(&self_row),
                candidate: &self_row,
                exclude_id: Some("gh-self")
            }
            .find()
            .is_none()
        );
        assert!(
            DuplicateProviderSelection {
                providers: &[GithubCatalogFixture {
                    id: "gh-a",
                    repo: "alpha",
                    pat: "github_pat_11AAAA"
                }
                .build()],
                candidate: &GithubCatalogFixture {
                    id: "gh-b",
                    repo: "beta",
                    pat: "github_pat_11AAAA"
                }
                .build(),
                exclude_id: None
            }
            .find()
            .is_none()
        );
    }

    #[test]
    fn duplicate_detection_preserves_folder_and_oauth_targets() -> anyhow::Result<()> {
        let folder = LocalFolderCatalogFixture {
            id: "folder-a",
            handle_id: "handle-1",
        }
        .build();
        assert_eq!(
            DuplicateProviderSelection {
                providers: &[folder],
                candidate: &LocalFolderCatalogFixture {
                    id: "folder-b",
                    handle_id: "handle-1"
                }
                .build(),
                exclude_id: None
            }
            .find()
            .map(|provider| provider.id)
            .as_deref(),
            Some("folder-a")
        );

        let mut private = OAuthCatalogFixture {
            id: "drive-private",
            preset: OauthFilePreset::GoogleDrive,
            file_id: None,
            file_name: "events",
        }
        .build();
        (match &mut private.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Some(config),
            StoredOAuthFileConfiguration::NotApplicable => None,
        })
        .ok_or_else(|| IoError::other("private OAuth config must exist"))?
        .drive_mode = GoogleDriveMode::Private;
        let mut shared = OAuthCatalogFixture {
            id: "drive-shared",
            preset: OauthFilePreset::GoogleDrive,
            file_id: None,
            file_name: "events",
        }
        .build();
        let shared_oauth = (match &mut shared.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Some(config),
            StoredOAuthFileConfiguration::NotApplicable => None,
        })
        .ok_or_else(|| IoError::other("shared OAuth config must exist"))?;
        shared_oauth.drive_mode = GoogleDriveMode::Shared;
        shared_oauth.folder_id = StoredGoogleDriveFolder::FolderId("folder-team".to_owned());
        let providers = vec![private.clone(), shared.clone()];
        assert_eq!(
            DuplicateProviderSelection {
                providers: &providers,
                candidate: &private,
                exclude_id: None
            }
            .find()
            .map(|provider| provider.id)
            .as_deref(),
            Some("drive-private")
        );
        assert_eq!(
            DuplicateProviderSelection {
                providers: &providers,
                candidate: &shared,
                exclude_id: None
            }
            .find()
            .map(|provider| provider.id)
            .as_deref(),
            Some("drive-shared")
        );
        Ok(())
    }

    #[test]
    fn provider_storage_details_match_persisted_rows() {
        let labels = ProviderStorageDetailLabels::catalog_fixture();
        let local = StorageProviderData {
            id: "local".to_owned(),
            provider_type: StorageProviderType::Local,
            label: "This device".to_owned(),
            github_pat: StoredGithubPat::Missing,
            github_repo: StoredGithubRepository::DefaultRepository,
            oauth_file: StoredOAuthFileConfiguration::NotApplicable,
            local_folder: StoredLocalFolderConfiguration::NotApplicable,
            store_id: ProviderVaultScope::Unscoped,
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: "2026-06-24T00:00:00.000Z".to_owned(),
        };
        assert_eq!(local.storage_detail(&labels), "This device desc");
        assert_eq!(
            (GithubCatalogFixture {
                id: "gh",
                repo: " team-vault ",
                pat: " github_pat_11AAAAbbbbCCCC "
            }
            .build())
            .storage_detail(&labels),
            "team-vault · github_pat_11A…"
        );
        assert_eq!(
            (LocalFolderCatalogFixture {
                id: "folder",
                handle_id: "handle-1"
            }
            .build())
            .storage_detail(&labels),
            "Nook Backup"
        );
        assert_eq!(
            (StorageProviderData {
                local_folder: StoredLocalFolderConfiguration::NotApplicable,
                ..LocalFolderCatalogFixture {
                    id: "folder",
                    handle_id: "handle-1"
                }
                .build()
            })
            .storage_detail(&labels),
            "Choose folder"
        );
        assert_eq!(
            (OAuthCatalogFixture {
                id: "icloud",
                preset: OauthFilePreset::ICloud,
                file_id: None,
                file_name: " "
            }
            .build())
            .storage_detail(&labels),
            format!("{DEFAULT_DRIVE_BACKUP_NAME} · Signed in with iCloud")
        );
    }

    #[test]
    fn provider_label_localization_preserves_detail_suffixes() {
        let labels = ProviderLabelLabels::catalog_fixture();
        assert_eq!(labels.localize("This device"), "This device localized");
        assert_eq!(
            labels.localize("GitHub · team-vault"),
            "GitHub localized · team-vault"
        );
        assert_eq!(
            labels.localize("Local backup · Nook Backup"),
            "Local folder localized · Nook Backup"
        );
        assert_eq!(
            labels.localize("Google Drive · work.yaml"),
            "Google Drive localized · work.yaml"
        );
        assert_eq!(
            labels.localize("iCloud · home.yaml"),
            "iCloud localized · home.yaml"
        );
        assert_eq!(labels.localize("Custom provider"), "Custom provider");
    }

    #[test]
    fn local_row_is_seeded_once_per_vault() {
        let snapshot = AuthProvidersSnapshotData {
            providers: vec![
                GithubCatalogFixture {
                    id: "gh",
                    repo: "nook",
                    pat: "pat",
                }
                .build(),
            ],
            active_vault_store_id: ActiveVaultScope::Unselected,
        };
        let LocalProviderRowOutcome {
            snapshot: next,
            change,
        } = snapshot.ensure_local_row(LocalProviderRowRequest {
            active_store_id: None,
            new_id: "local-1",
            created_at: "2026-06-24T00:00:00.000Z",
        });
        assert_eq!(change, LocalProviderRowChange::Inserted);
        assert_eq!(next.providers.len(), 2);
        assert_eq!(next.providers[0].provider_type, StorageProviderType::Local);
        assert_eq!(next.providers[0].label, "This device");

        let existing = AuthProvidersSnapshotData {
            providers: vec![StorageProviderData {
                store_id: ProviderVaultScope::StoreId("vault-1".to_owned()),
                ..next.providers[0].clone()
            }],
            active_vault_store_id: ActiveVaultScope::StoreId("vault-1".to_owned()),
        };
        let LocalProviderRowOutcome {
            snapshot: existing,
            change,
        } = existing.ensure_local_row(LocalProviderRowRequest {
            active_store_id: Some("vault-1"),
            new_id: "local-2",
            created_at: "x",
        });
        assert_eq!(change, LocalProviderRowChange::Present);
        assert_eq!(existing.providers.len(), 1);

        for active_store_id in [None, Some(" "), Some(" vault-1 "), Some("vault-2")] {
            let LocalProviderRowOutcome {
                snapshot: next,
                change,
            } = existing.clone().ensure_local_row(LocalProviderRowRequest {
                active_store_id,
                new_id: "new",
                created_at: "time",
            });
            assert_eq!(next.active_vault_store_id, existing.active_vault_store_id);
            assert_eq!(
                change,
                if active_store_id == Some("vault-2") {
                    LocalProviderRowChange::Inserted
                } else {
                    LocalProviderRowChange::Present
                }
            );
            if change == LocalProviderRowChange::Inserted {
                assert_eq!(next.providers[0].store_id.as_deref(), Some("vault-2"));
                assert_eq!(next.providers[1], existing.providers[0]);
            } else {
                assert_eq!(next, existing);
            }
        }
    }
}
