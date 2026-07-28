use crate::errors::ValidationResult;
use crate::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, GithubPatMask, GithubSyncTarget,
    ICloudMode, LocalFolderSyncTarget, OauthFilePreset, OauthFileSyncTarget, StorageProviderType,
    SyncProviderTarget, mask_github_pat, sync_provider_default_label, sync_provider_target_key,
};

use super::{
    AuthProvidersSnapshotData, NormalizedAuthSnapshot, ProviderLabelLabels,
    ProviderStorageDetailLabels, StorageProviderData,
};

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

#[must_use]
pub fn provider_target_key(provider: &StorageProviderData) -> Option<String> {
    sync_provider_target_key(&provider_target(provider))
}

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

fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::{
        AuthProvidersSnapshotData, DEFAULT_DRIVE_BACKUP_NAME, GoogleDriveMode,
        LocalFolderConfigData, OAuthFileConfigData, OauthFilePreset, ProviderLabelLabels,
        ProviderStorageDetailLabels, ProviderSyncCheckpoint, StorageProviderData,
    };

    use super::{
        ensure_local_provider_row, find_duplicate_sync_provider, localize_provider_label,
        normalize_auth_snapshot, provider_storage_detail, provider_target_key,
    };

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
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
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
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
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
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
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
    fn normalization_preserves_active_vault_and_handles_missing_values() {
        let missing = normalize_auth_snapshot(&serde_json::Value::Null);
        assert_eq!(missing.snapshot, AuthProvidersSnapshotData::default());
        assert!(!missing.changed);

        let raw = json!({ "providers": [], "activeVaultStoreId": "vault-1" });
        let normalized = normalize_auth_snapshot(&raw);
        assert_eq!(
            normalized.snapshot.active_vault_store_id.as_deref(),
            Some("vault-1")
        );
        assert!(!normalized.changed);
    }

    #[test]
    fn duplicate_detection_uses_stable_provider_targets() -> anyhow::Result<()> {
        let existing = github_provider("gh-existing", "nook-crdt-test-1", "github_pat_11AAAA");
        let candidate = github_provider("gh-new", "nook-crdt-test-1", "github_pat_11AAAA");
        assert_eq!(
            find_duplicate_sync_provider(&[existing], &candidate, None)
                .map(|provider| provider.id)
                .as_deref(),
            Some("gh-existing")
        );

        let no_pat = StorageProviderData {
            github_pat: None,
            ..github_provider("gh-draft", "nook", "github_pat_11AAAA")
        };
        assert_eq!(provider_target_key(&no_pat), None);

        let self_row = github_provider("gh-self", "nook", "github_pat_11AAAA");
        assert!(
            find_duplicate_sync_provider(
                std::slice::from_ref(&self_row),
                &self_row,
                Some("gh-self")
            )
            .is_none()
        );
        assert!(
            find_duplicate_sync_provider(
                &[github_provider("gh-a", "alpha", "github_pat_11AAAA")],
                &github_provider("gh-b", "beta", "github_pat_11AAAA"),
                None
            )
            .is_none()
        );

        let folder = local_folder_provider("folder-a", "handle-1");
        assert_eq!(
            find_duplicate_sync_provider(
                &[folder],
                &local_folder_provider("folder-b", "handle-1"),
                None
            )
            .map(|provider| provider.id)
            .as_deref(),
            Some("folder-a")
        );

        let mut private = oauth_provider(
            "drive-private",
            OauthFilePreset::GoogleDrive,
            None,
            "events",
        );
        private
            .oauth_file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("private OAuth config must exist"))?
            .drive_mode = GoogleDriveMode::Private;
        let mut shared =
            oauth_provider("drive-shared", OauthFilePreset::GoogleDrive, None, "events");
        let shared_oauth = shared
            .oauth_file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("shared OAuth config must exist"))?;
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
    fn provider_storage_details_match_persisted_rows() -> anyhow::Result<()> {
        let labels = detail_labels();
        let local = StorageProviderData {
            id: "local".to_owned(),
            provider_type: "local".to_owned(),
            label: "This device".to_owned(),
            github_pat: None,
            github_repo: None,
            oauth_file: None,
            local_folder: None,
            store_id: None,
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: "2026-06-24T00:00:00.000Z".to_owned(),
        };
        assert_eq!(
            provider_storage_detail(&local, &labels)?,
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
                &oauth_provider("icloud", OauthFilePreset::ICloud, None, " "),
                &labels,
            )?,
            format!("{DEFAULT_DRIVE_BACKUP_NAME} · Signed in with iCloud")
        );
        Ok(())
    }

    #[test]
    fn provider_label_localization_preserves_detail_suffixes() {
        let labels = provider_label_labels();
        assert_eq!(
            localize_provider_label("This device", &labels),
            "This device localized"
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
    fn local_row_is_seeded_once_per_vault() {
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

        let existing = AuthProvidersSnapshotData {
            providers: vec![StorageProviderData {
                store_id: Some("vault-1".to_owned()),
                ..next.providers[0].clone()
            }],
            active_vault_store_id: Some("vault-1".to_owned()),
        };
        let (unchanged, changed) =
            ensure_local_provider_row(&existing, Some("vault-1"), "local-2", "x");
        assert!(!changed);
        assert_eq!(unchanged.providers.len(), 1);
    }
}
