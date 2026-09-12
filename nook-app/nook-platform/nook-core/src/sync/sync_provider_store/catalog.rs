#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::ProviderLabel;
use crate::{
    ActiveVaultScope, DuplicateSyncProvider, ProviderId, ProviderSyncCheckpoint,
    StoredICloudShareTarget, StoredLocalFolderDirectory, StoredOAuthAccessCredential,
    StoredOAuthAccountIdentity, StoredOAuthRemoteFileId, StoredOAuthRemoteFileName,
    SyncProviderTargetIdentity,
};

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

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DuplicateCandidatePolicy {
    IncludeAll,
    Exclude(ProviderId),
}

pub struct DuplicateProviderSelection<'a> {
    pub providers: &'a [StorageProviderData],
    pub candidate: &'a StorageProviderData,
    pub policy: DuplicateCandidatePolicy,
}
#[derive(Clone, Copy)]
pub struct LocalProviderRowRequest<'a> {
    pub active_store_id: &'a ActiveVaultScope,
    pub new_id: &'a str,
    pub created_at: &'a str,
}

impl StorageProviderData {
    #[must_use]
    pub fn storage_detail(&self, labels: &ProviderStorageDetailLabels) -> String {
        let provider = self;
        let provider_type = provider.provider_type;
        match provider_type {
            StorageProviderType::Local => labels.this_device_desc.clone(),
            StorageProviderType::LocalFolder => match &provider.local_folder {
                StoredLocalFolderConfiguration::Configured(folder) => {
                    match &folder.directory_name {
                        StoredLocalFolderDirectory::DirectoryName(name)
                            if !name.trim().is_empty() =>
                        {
                            name.trim().to_owned()
                        }
                        StoredLocalFolderDirectory::DirectoryName(_)
                        | StoredLocalFolderDirectory::Unnamed => {
                            labels.local_folder_needs_reconnect.clone()
                        }
                    }
                }
                StoredLocalFolderConfiguration::NotApplicable => {
                    labels.local_folder_needs_reconnect.clone()
                }
            },
            StorageProviderType::OauthFile => {
                let (file, account) = match &provider.oauth_file {
                    StoredOAuthFileConfiguration::Configured(oauth) => {
                        let file = match &oauth.file_name {
                            StoredOAuthRemoteFileName::FileName(name)
                                if !name.trim().is_empty() =>
                            {
                                name.trim()
                            }
                            StoredOAuthRemoteFileName::FileName(_)
                            | StoredOAuthRemoteFileName::Unresolved => DEFAULT_DRIVE_BACKUP_NAME,
                        };
                        let account = match &oauth.account_email {
                            StoredOAuthAccountIdentity::Email(email)
                                if !email.trim().is_empty() =>
                            {
                                email.trim()
                            }
                            StoredOAuthAccountIdentity::Email(_)
                            | StoredOAuthAccountIdentity::Unknown => {
                                match (&oauth.access_token, oauth.preset) {
                                    (
                                        StoredOAuthAccessCredential::AccessToken(token),
                                        OauthFilePreset::ICloud,
                                    ) if !token.trim().is_empty() => &labels.icloud_signed_in,
                                    (
                                        StoredOAuthAccessCredential::AccessToken(token),
                                        OauthFilePreset::GoogleDrive,
                                    ) if !token.trim().is_empty() => &labels.google_signed_in,
                                    (_, OauthFilePreset::ICloud) => &labels.icloud_not_signed_in,
                                    (_, OauthFilePreset::GoogleDrive) => {
                                        &labels.google_not_signed_in
                                    }
                                }
                            }
                        };
                        (file, account)
                    }
                    StoredOAuthFileConfiguration::NotApplicable => (
                        DEFAULT_DRIVE_BACKUP_NAME,
                        labels.google_not_signed_in.as_str(),
                    ),
                };
                format!("{file} · {account}")
            }
            StorageProviderType::Github => {
                let repo = match &provider.github_repo {
                    StoredGithubRepository::Repository(repo) if !repo.trim().is_empty() => {
                        repo.trim()
                    }
                    StoredGithubRepository::Repository(_)
                    | StoredGithubRepository::DefaultRepository => DEFAULT_GITHUB_REPO_NAME,
                };
                let masked = match &provider.github_pat {
                    StoredGithubPat::Token(token) => GithubPat::mask(token),
                    StoredGithubPat::Missing => GithubPatMask::NoToken,
                };
                let pat = match masked {
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
                let folder = match &provider.local_folder {
                    StoredLocalFolderConfiguration::Configured(folder) => LocalFolderSyncTarget {
                        directory_name: folder.directory_name.clone(),
                        handle_id: folder.handle_id.clone(),
                    },
                    StoredLocalFolderConfiguration::NotApplicable => {
                        LocalFolderSyncTarget::default()
                    }
                };
                SyncProviderTarget::LocalFolder(folder)
            }
            StorageProviderType::Github => SyncProviderTarget::Github(GithubSyncTarget {
                repo: match &provider.github_repo {
                    StoredGithubRepository::Repository(repo) if !repo.trim().is_empty() => {
                        repo.trim().to_owned()
                    }
                    StoredGithubRepository::Repository(_)
                    | StoredGithubRepository::DefaultRepository => {
                        DEFAULT_GITHUB_REPO_NAME.to_owned()
                    }
                },
                pat: match &provider.github_pat {
                    StoredGithubPat::Token(pat) if !pat.trim().is_empty() => pat.trim().to_owned(),
                    StoredGithubPat::Token(_) | StoredGithubPat::Missing => {
                        return SyncProviderTarget::Empty;
                    }
                },
            }),
            StorageProviderType::OauthFile => match &provider.oauth_file {
                StoredOAuthFileConfiguration::Configured(oauth) => {
                    let preset = oauth.preset;
                    SyncProviderTarget::OauthFile(OauthFileSyncTarget {
                        preset,
                        file_id: if preset == OauthFilePreset::ICloud
                            && oauth.resolved_icloud_mode() == ICloudMode::Shared
                        {
                            match &oauth.icloud_share_target {
                                StoredICloudShareTarget::SharedTarget(target) => {
                                    StoredOAuthRemoteFileId::FileId(target.clone())
                                }
                                StoredICloudShareTarget::Personal => {
                                    StoredOAuthRemoteFileId::Unresolved
                                }
                            }
                        } else {
                            oauth.file_id.clone()
                        },
                        folder_id: oauth.folder_id.clone(),
                        file_name: oauth.file_name.clone(),
                        account_email: oauth.account_email.clone(),
                        access_token: oauth.access_token.clone(),
                    })
                }
                StoredOAuthFileConfiguration::NotApplicable => SyncProviderTarget::Empty,
            },
        }
    }

    #[must_use]
    pub fn target_key(&self) -> SyncProviderTargetIdentity {
        let provider = self;
        provider.catalog_target().stable_key()
    }
}

impl DuplicateProviderSelection<'_> {
    #[must_use]
    pub fn find(self) -> DuplicateSyncProvider {
        let Self {
            providers,
            candidate,
            policy,
        } = self;
        let candidate_key = candidate.target_key();
        if matches!(candidate_key, SyncProviderTargetIdentity::Unconfigured) {
            return DuplicateSyncProvider::Unique;
        }
        match providers.iter().find(|provider| {
            if let DuplicateCandidatePolicy::Exclude(excluded) = &policy
                && provider.id == excluded.as_str()
            {
                return false;
            }
            provider.target_key() == candidate_key
        }) {
            Some(provider) => DuplicateSyncProvider::Duplicate {
                provider: provider.clone(),
            },
            None => DuplicateSyncProvider::Unique,
        }
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
        let store_id = match active_store_id {
            ActiveVaultScope::StoreId(id) if !id.trim().is_empty() => {
                ProviderVaultScope::StoreId(id.trim().to_owned())
            }
            ActiveVaultScope::StoreId(_) | ActiveVaultScope::Unselected => {
                match &self.active_vault_store_id {
                    ActiveVaultScope::StoreId(id) if !id.trim().is_empty() => {
                        ProviderVaultScope::StoreId(id.trim().to_owned())
                    }
                    ActiveVaultScope::StoreId(_) | ActiveVaultScope::Unselected => {
                        ProviderVaultScope::Unscoped
                    }
                }
            }
        };
        let has_local_for_vault = self.providers.iter().any(|provider| {
            provider.provider_type == StorageProviderType::Local
                && match (&store_id, &provider.store_id) {
                    (ProviderVaultScope::Unscoped, _) | (_, ProviderVaultScope::Unscoped) => true,
                    (
                        ProviderVaultScope::StoreId(active),
                        ProviderVaultScope::StoreId(existing),
                    ) => existing.trim().is_empty() || active == existing.trim(),
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
            label: ProviderLabel::Local.render(),
            github_pat: StoredGithubPat::Missing,
            github_repo: StoredGithubRepository::DefaultRepository,
            oauth_file: StoredOAuthFileConfiguration::NotApplicable,
            local_folder: StoredLocalFolderConfiguration::NotApplicable,
            store_id,
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
        file_id: StoredOAuthRemoteFileId,
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
        DuplicateCandidatePolicy, DuplicateProviderSelection, DuplicateSyncProvider,
        LocalProviderRowChange, LocalProviderRowOutcome, LocalProviderRowRequest,
    };
    use crate::SyncProviderTargetIdentity;

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
        for (policy, expected) in [
            (DuplicateCandidatePolicy::IncludeAll, "first"),
            (DuplicateCandidatePolicy::Exclude("first".into()), "second"),
            (DuplicateCandidatePolicy::Exclude("absent".into()), "first"),
        ] {
            let found = DuplicateProviderSelection {
                providers: &rows,
                candidate: &first,
                policy,
            }
            .find();
            assert!(
                matches!(found, DuplicateSyncProvider::Duplicate { provider } if provider.id == expected)
            );
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
        assert!(matches!(DuplicateProviderSelection {
                providers: &[existing],
                candidate: &candidate,
                policy: DuplicateCandidatePolicy::IncludeAll
            }
            .find(), DuplicateSyncProvider::Duplicate { provider } if provider.id == "gh-existing"));

        let no_pat = StorageProviderData {
            github_pat: StoredGithubPat::Missing,
            ..GithubCatalogFixture {
                id: "gh-draft",
                repo: "nook",
                pat: "github_pat_11AAAA",
            }
            .build()
        };
        assert_eq!(
            no_pat.target_key(),
            SyncProviderTargetIdentity::Unconfigured
        );

        let self_row = GithubCatalogFixture {
            id: "gh-self",
            repo: "nook",
            pat: "github_pat_11AAAA",
        }
        .build();
        assert_eq!(
            DuplicateProviderSelection {
                providers: slice::from_ref(&self_row),
                candidate: &self_row,
                policy: DuplicateCandidatePolicy::Exclude("gh-self".into())
            }
            .find(),
            DuplicateSyncProvider::Unique
        );
        assert_eq!(
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
                policy: DuplicateCandidatePolicy::IncludeAll
            }
            .find(),
            DuplicateSyncProvider::Unique
        );
    }

    #[test]
    fn duplicate_detection_preserves_folder_and_oauth_targets() -> anyhow::Result<()> {
        let folder = LocalFolderCatalogFixture {
            id: "folder-a",
            handle_id: "handle-1",
        }
        .build();
        assert!(matches!(DuplicateProviderSelection {
                providers: &[folder],
                candidate: &LocalFolderCatalogFixture {
                    id: "folder-b",
                    handle_id: "handle-1"
                }
                .build(),
                policy: DuplicateCandidatePolicy::IncludeAll
            }
            .find(), DuplicateSyncProvider::Duplicate { provider } if provider.id == "folder-a"));

        let mut private = OAuthCatalogFixture {
            id: "drive-private",
            preset: OauthFilePreset::GoogleDrive,
            file_id: StoredOAuthRemoteFileId::Unresolved,
            file_name: "events",
        }
        .build();
        (match &mut private.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Ok(config),
            StoredOAuthFileConfiguration::NotApplicable => {
                Err(IoError::other("private OAuth config must exist"))
            }
        })?
        .drive_mode = GoogleDriveMode::Private;
        let mut shared = OAuthCatalogFixture {
            id: "drive-shared",
            preset: OauthFilePreset::GoogleDrive,
            file_id: StoredOAuthRemoteFileId::Unresolved,
            file_name: "events",
        }
        .build();
        let shared_oauth = (match &mut shared.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Ok(config),
            StoredOAuthFileConfiguration::NotApplicable => {
                Err(IoError::other("shared OAuth config must exist"))
            }
        })?;
        shared_oauth.drive_mode = GoogleDriveMode::Shared;
        shared_oauth.folder_id = StoredGoogleDriveFolder::FolderId("folder-team".to_owned());
        let providers = vec![private.clone(), shared.clone()];
        assert!(matches!(DuplicateProviderSelection {
                providers: &providers,
                candidate: &private,
                policy: DuplicateCandidatePolicy::IncludeAll
            }
            .find(), DuplicateSyncProvider::Duplicate { provider } if provider.id == "drive-private"));
        assert!(matches!(DuplicateProviderSelection {
                providers: &providers,
                candidate: &shared,
                policy: DuplicateCandidatePolicy::IncludeAll
            }
            .find(), DuplicateSyncProvider::Duplicate { provider } if provider.id == "drive-shared"));
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
                file_id: StoredOAuthRemoteFileId::Unresolved,
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
            active_store_id: &ActiveVaultScope::Unselected,
            new_id: "local-1",
            created_at: "2026-06-24T00:00:00.000Z",
        });
        assert_eq!(change, LocalProviderRowChange::Inserted);
        assert_eq!(next.providers.len(), 2);
        let first = next
            .providers
            .first()
            .unwrap_or_else(|| panic!("catalog fixture must contain local provider"));
        assert_eq!(first.provider_type, StorageProviderType::Local);
        assert_eq!(first.label, "This device");

        let existing = AuthProvidersSnapshotData {
            providers: vec![StorageProviderData {
                store_id: ProviderVaultScope::StoreId("vault-1".to_owned()),
                ..first.clone()
            }],
            active_vault_store_id: ActiveVaultScope::StoreId("vault-1".to_owned()),
        };
        let LocalProviderRowOutcome {
            snapshot: existing,
            change,
        } = existing.ensure_local_row(LocalProviderRowRequest {
            active_store_id: &ActiveVaultScope::StoreId("vault-1".to_owned()),
            new_id: "local-2",
            created_at: "x",
        });
        assert_eq!(change, LocalProviderRowChange::Present);
        assert_eq!(existing.providers.len(), 1);

        for active_store_id in [
            ActiveVaultScope::Unselected,
            ActiveVaultScope::StoreId(" ".to_owned()),
            ActiveVaultScope::StoreId(" vault-1 ".to_owned()),
            ActiveVaultScope::StoreId("vault-2".to_owned()),
        ] {
            let LocalProviderRowOutcome {
                snapshot: next,
                change,
            } = existing.clone().ensure_local_row(LocalProviderRowRequest {
                active_store_id: &active_store_id,
                new_id: "new",
                created_at: "time",
            });
            assert_eq!(next.active_vault_store_id, existing.active_vault_store_id);
            assert_eq!(
                change,
                if active_store_id == ActiveVaultScope::StoreId("vault-2".to_owned()) {
                    LocalProviderRowChange::Inserted
                } else {
                    LocalProviderRowChange::Present
                }
            );
            if change == LocalProviderRowChange::Inserted {
                assert_eq!(
                    next.providers.first().map(|provider| &provider.store_id),
                    Some(&ProviderVaultScope::StoreId(("vault-2").to_owned()))
                );
                assert_eq!(next.providers.get(1), existing.providers.first());
            } else {
                assert_eq!(next, existing);
            }
        }
    }
}
