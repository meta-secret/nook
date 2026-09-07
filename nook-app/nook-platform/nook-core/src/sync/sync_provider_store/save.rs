#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use super::oauth::ConfigurationText;
use crate::ProviderRows;
use crate::StoredICloudShareTarget;

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, GoogleDriveMode, OAuthAccessTokenRef,
    OauthFilePreset, ProviderSyncCheckpoint, ProviderVaultScope, StorageProviderType,
    StoredGithubPat, StoredGithubRepository, StoredGoogleDriveFolder,
    StoredLocalFolderConfiguration, StoredOAuthAccountIdentity, StoredOAuthFileConfiguration,
    StoredOAuthRemoteFileName, StoredOAuthTokenExpiry, sync_provider_default_label,
};

use super::{
    AuthProvidersSnapshotData, OAuthFileConfigData, StorageProviderData, ensure_local_provider_row,
    find_duplicate_sync_provider,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "providerType", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ProviderSaveSetup {
    Existing,
    New(StorageProviderType),
}

impl ProviderSaveSetup {
    fn provider_type(self, storage_mode: StorageProviderType) -> StorageProviderType {
        match self {
            Self::Existing => storage_mode,
            Self::New(provider_type) => provider_type,
        }
    }

    const fn is_new(self) -> bool {
        matches!(self, Self::New(_))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ProviderSaveRequest {
    pub snapshot: AuthProvidersSnapshotData,
    pub provider_store_id: ProviderVaultScope,
    pub storage_mode: StorageProviderType,
    pub setup: ProviderSaveSetup,
    pub explicit_add: bool,
    pub github_pat: String,
    pub github_repo: String,
    pub oauth_file: StoredOAuthFileConfiguration,
    pub oauth_preset: OauthFilePreset,
    pub local_folder: StoredLocalFolderConfiguration,
    pub new_provider_id: String,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub enum ProviderSaveOutcome {
    Saved {
        snapshot: AuthProvidersSnapshotData,
        oauth_file: Box<StoredOAuthFileConfiguration>,
    },
    Duplicate,
    LocalFolderRequired,
}

enum ProviderConstructionError {
    LocalFolderRequired,
}

struct ProviderRowDefaults {
    provider_type: StorageProviderType,
    label: String,
}

impl ProviderSaveRequest {
    fn provider_defaults(&self, row: ProviderRowDefaults) -> StorageProviderData {
        let request = self;
        let ProviderRowDefaults {
            provider_type,
            label,
        } = row;
        StorageProviderData {
            id: request.new_provider_id.clone(),
            provider_type,
            label,
            github_pat: StoredGithubPat::Missing,
            github_repo: StoredGithubRepository::DefaultRepository,
            oauth_file: StoredOAuthFileConfiguration::NotApplicable,
            local_folder: StoredLocalFolderConfiguration::NotApplicable,
            store_id: request.provider_store_id.clone(),
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: request.created_at.clone(),
        }
    }

    fn configured_drive_file(&self) -> String {
        let request = self;
        let oauth = request.oauth_file.as_ref();
        let shared_google_drive = oauth.is_some_and(|config| {
            config.preset == OauthFilePreset::GoogleDrive
                && (config.drive_mode == GoogleDriveMode::Shared
                    || matches!(config.folder_id, StoredGoogleDriveFolder::FolderId(_)))
        });
        if shared_google_drive {
            return oauth
                .and_then(|config| config.file_name.as_deref())
                .and_then(|value| ConfigurationText(value).non_empty())
                .unwrap_or(DEFAULT_DRIVE_BACKUP_NAME)
                .to_owned();
        }
        ConfigurationText(&request.github_repo)
            .non_empty()
            .unwrap_or(DEFAULT_DRIVE_BACKUP_NAME)
            .to_owned()
    }

    fn new_provider(
        &self,
        provider_type: StorageProviderType,
    ) -> Result<StorageProviderData, ProviderConstructionError> {
        let request = self;
        match provider_type {
            StorageProviderType::Local => Ok(request.provider_defaults(ProviderRowDefaults {
                provider_type,
                label: sync_provider_default_label(provider_type, None, None),
            })),
            StorageProviderType::Github => {
                let repo = ConfigurationText(&request.github_repo)
                    .non_empty()
                    .unwrap_or(DEFAULT_GITHUB_REPO_NAME);
                let mut provider = request.provider_defaults(ProviderRowDefaults {
                    provider_type,
                    label: sync_provider_default_label(provider_type, Some(repo), None),
                });
                provider.github_pat = StoredGithubPat::Token(request.github_pat.trim().to_owned());
                provider.github_repo = StoredGithubRepository::Repository(repo.to_owned());
                Ok(provider)
            }
            StorageProviderType::OauthFile => {
                let drive_file = request.configured_drive_file();
                let mut oauth =
                    request
                        .oauth_file
                        .as_ref()
                        .cloned()
                        .unwrap_or_else(|| OAuthFileConfigData {
                            preset: request.oauth_preset,
                            file_name: StoredOAuthRemoteFileName::FileName(drive_file.clone()),
                            ..OAuthFileConfigData::default()
                        });
                oauth.preset = request.oauth_preset;
                oauth.file_name = StoredOAuthRemoteFileName::FileName(drive_file.clone());
                let mut provider = request.provider_defaults(ProviderRowDefaults {
                    provider_type,
                    label: sync_provider_default_label(
                        provider_type,
                        Some(&drive_file),
                        Some(request.oauth_preset),
                    ),
                });
                provider.oauth_file = StoredOAuthFileConfiguration::Configured(oauth);
                Ok(provider)
            }
            StorageProviderType::LocalFolder => {
                let folder = request
                    .local_folder
                    .as_ref()
                    .ok_or(ProviderConstructionError::LocalFolderRequired)?;
                let detail = folder
                    .directory_name
                    .as_deref()
                    .and_then(|value| ConfigurationText(value).non_empty());
                let mut provider = request.provider_defaults(ProviderRowDefaults {
                    provider_type,
                    label: sync_provider_default_label(provider_type, detail, None),
                });
                provider.local_folder = request.local_folder.clone();
                Ok(provider)
            }
        }
    }
}

struct ActiveOAuthMerge<'a> {
    persisted: &'a OAuthFileConfigData,
    active: &'a OAuthFileConfigData,
    drive_file: &'a str,
}

impl ActiveOAuthMerge<'_> {
    fn merge(self) -> OAuthFileConfigData {
        let Self {
            persisted,
            active,
            drive_file,
        } = self;
        OAuthFileConfigData {
            preset: active.preset,
            access_token: match active.usable_access_token() {
                OAuthAccessTokenRef::Available(_) => active.access_token.clone(),
                OAuthAccessTokenRef::Missing => persisted.access_token.clone(),
            },
            refresh_token: persisted.refresh_token.clone(),
            expires_at: match persisted.expires_at {
                StoredOAuthTokenExpiry::ExpiresAt(_) => persisted.expires_at.clone(),
                StoredOAuthTokenExpiry::Unknown => active.expires_at.clone(),
            },
            file_id: active.file_id.clone(),
            folder_id: match active.folder_id {
                StoredGoogleDriveFolder::FolderId(_) => active.folder_id.clone(),
                StoredGoogleDriveFolder::Root => persisted.folder_id.clone(),
            },
            drive_mode: active.drive_mode,
            icloud_mode: active.icloud_mode,
            icloud_share_target: match active.icloud_share_target {
                StoredICloudShareTarget::SharedTarget(_) => active.icloud_share_target.clone(),
                StoredICloudShareTarget::Personal => persisted.icloud_share_target.clone(),
            },
            file_name: if persisted
                .file_name
                .as_deref()
                .and_then(|value| ConfigurationText(value).non_empty())
                .is_some()
            {
                persisted.file_name.clone()
            } else if active
                .file_name
                .as_deref()
                .and_then(|value| ConfigurationText(value).non_empty())
                .is_some()
            {
                active.file_name.clone()
            } else {
                StoredOAuthRemoteFileName::FileName(drive_file.to_owned())
            },
            account_email: match persisted.account_email {
                StoredOAuthAccountIdentity::Email(_) => persisted.account_email.clone(),
                StoredOAuthAccountIdentity::Unknown => active.account_email.clone(),
            },
        }
    }
}

struct OAuthUpdateTarget<'a> {
    providers: &'a [StorageProviderData],
    active_store_id: Option<&'a str>,
    active_oauth: &'a OAuthFileConfigData,
}

impl OAuthUpdateTarget<'_> {
    fn id(&self) -> Option<String> {
        let providers = self.providers;
        let active_store_id = self.active_store_id;
        let active_oauth = self.active_oauth;
        let candidate = StorageProviderData {
            id: "oauth-provider-update-target".to_owned(),
            provider_type: StorageProviderType::OauthFile,
            label: String::new(),
            github_pat: StoredGithubPat::Missing,
            github_repo: StoredGithubRepository::DefaultRepository,
            oauth_file: StoredOAuthFileConfiguration::Configured(active_oauth.clone()),
            local_folder: StoredLocalFolderConfiguration::NotApplicable,
            store_id: ProviderVaultScope::Unscoped,
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: String::new(),
        };
        let sync_providers = ProviderRows { providers }
            .for_vault(active_store_id)
            .sync()
            .ok()?;
        find_duplicate_sync_provider(&sync_providers, &candidate, None).map(|provider| provider.id)
    }
}

impl ProviderSaveRequest {
    #[must_use]
    pub fn apply(&self) -> ProviderSaveOutcome {
        let request = self;
        let provider_type = request.setup.provider_type(request.storage_mode);
        let active_store_id = request.snapshot.active_vault_store_id.as_deref();
        let active_providers = ProviderRows {
            providers: &request.snapshot.providers,
        }
        .for_vault(active_store_id)
        .active();
        let local_provider = ProviderRows {
            providers: &request.snapshot.providers,
        }
        .for_vault(active_store_id)
        .local()
        .ok()
        .flatten();
        let mut providers = request.snapshot.providers.clone();
        let mut oauth_update_id = None;

        if request.setup.is_new() && provider_type != StorageProviderType::Local {
            let provider = match request.new_provider(provider_type) {
                Ok(provider) => provider,
                Err(ProviderConstructionError::LocalFolderRequired) => {
                    return ProviderSaveOutcome::LocalFolderRequired;
                }
            };
            let duplicate = find_duplicate_sync_provider(&active_providers, &provider, None);
            if duplicate.is_some() && request.explicit_add {
                return ProviderSaveOutcome::Duplicate;
            }
            if duplicate.is_none() {
                if provider.provider_type == StorageProviderType::OauthFile {
                    oauth_update_id = Some(provider.id.clone());
                }
                providers.push(provider);
            }
        } else if request.setup.is_new()
            && provider_type == StorageProviderType::Local
            && local_provider.is_none()
        {
            providers.push(request.provider_defaults(ProviderRowDefaults {
                provider_type: StorageProviderType::Local,
                label: sync_provider_default_label(StorageProviderType::Local, None, None),
            }));
        } else if let Some(local_provider) = local_provider {
            for provider in &mut providers {
                if provider.id == local_provider.id {
                    provider.store_id = request.provider_store_id.clone();
                }
            }
        } else if let ProviderVaultScope::StoreId(store_id) = &request.provider_store_id {
            let snapshot = AuthProvidersSnapshotData {
                providers,
                active_vault_store_id: request.snapshot.active_vault_store_id.clone(),
            };
            let (seeded, _) = ensure_local_provider_row(
                &snapshot,
                Some(store_id),
                &request.new_provider_id,
                &request.created_at,
            );
            providers = seeded.providers;
        }

        let mut returned_oauth = StoredOAuthFileConfiguration::NotApplicable;
        if request.storage_mode == StorageProviderType::OauthFile
            && let Some(active_oauth) = request.oauth_file.as_ref()
            && active_oauth.file_id.as_deref().is_some()
        {
            let target_id = oauth_update_id.or_else(|| {
                OAuthUpdateTarget {
                    providers: &providers,
                    active_store_id,
                    active_oauth,
                }
                .id()
            });
            if let Some(target_id) = target_id {
                let drive_file = request.configured_drive_file();
                for provider in &mut providers {
                    if provider.id == target_id
                        && let Some(persisted) = provider.oauth_file.as_ref()
                    {
                        let merged = ActiveOAuthMerge {
                            persisted,
                            active: active_oauth,
                            drive_file: &drive_file,
                        }
                        .merge();
                        provider.oauth_file =
                            StoredOAuthFileConfiguration::Configured(merged.clone());
                        returned_oauth = StoredOAuthFileConfiguration::Configured(merged);
                    }
                }
            }
            if matches!(returned_oauth, StoredOAuthFileConfiguration::NotApplicable) {
                returned_oauth = StoredOAuthFileConfiguration::Configured(active_oauth.clone());
            }
        }

        ProviderSaveOutcome::Saved {
            snapshot: AuthProvidersSnapshotData {
                providers,
                active_vault_store_id: request.snapshot.active_vault_store_id.clone(),
            },
            oauth_file: Box::new(returned_oauth),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        ActiveVaultScope, GoogleDriveMode, LocalFolderConfigData, OauthFilePreset,
        ProviderVaultScope, StorageProviderType, StoredGoogleDriveFolder,
        StoredLocalFolderConfiguration, StoredLocalFolderDirectory, StoredLocalFolderHandle,
        StoredOAuthAccessCredential, StoredOAuthFileConfiguration, StoredOAuthRefreshCredential,
        StoredOAuthRemoteFileId, StoredOAuthRemoteFileName,
    };

    use super::{ActiveOAuthMerge, ProviderSaveOutcome, ProviderSaveRequest, ProviderSaveSetup};
    use crate::{AuthProvidersSnapshotData, OAuthFileConfigData, StorageProviderData};

    impl ProviderSaveRequest {
        fn fixture(provider_type: StorageProviderType) -> Self {
            ProviderSaveRequest {
                snapshot: AuthProvidersSnapshotData {
                    providers: Vec::new(),
                    active_vault_store_id: ActiveVaultScope::StoreId("vault-1".to_owned()),
                },
                provider_store_id: ProviderVaultScope::StoreId("vault-1".to_owned()),
                storage_mode: provider_type,
                setup: ProviderSaveSetup::New(provider_type),
                explicit_add: true,
                github_pat: " pat ".to_owned(),
                github_repo: " owner/repo ".to_owned(),
                oauth_file: StoredOAuthFileConfiguration::NotApplicable,
                oauth_preset: OauthFilePreset::GoogleDrive,
                local_folder: StoredLocalFolderConfiguration::NotApplicable,
                new_provider_id: "provider-new".to_owned(),
                created_at: "2026-08-11T00:00:00Z".to_owned(),
            }
        }
    }

    impl ProviderSaveOutcome {
        fn saved(self) -> Result<AuthProvidersSnapshotData, &'static str> {
            match self {
                ProviderSaveOutcome::Saved { snapshot, .. } => Ok(snapshot),
                _ => Err("expected saved provider outcome"),
            }
        }
    }

    #[test]
    fn creates_scoped_github_provider_from_trimmed_inputs() -> Result<(), &'static str> {
        let snapshot = ProviderSaveRequest::fixture(StorageProviderType::Github)
            .apply()
            .saved()?;
        let provider = &snapshot.providers[0];
        assert_eq!(provider.id, "provider-new");
        assert_eq!(provider.label, "GitHub · owner/repo");
        assert_eq!(provider.github_pat.as_deref(), Some("pat"));
        assert_eq!(provider.github_repo.as_deref(), Some("owner/repo"));
        assert_eq!(provider.store_id.as_deref(), Some("vault-1"));
        Ok(())
    }

    #[test]
    fn rejects_an_explicit_duplicate_provider() {
        let mut request = ProviderSaveRequest::fixture(StorageProviderType::Github);
        request.snapshot.providers.push(StorageProviderData::github(
            "existing",
            "GitHub",
            "pat",
            "owner/repo",
            "earlier",
        ));
        request.snapshot.providers[0].store_id = ProviderVaultScope::StoreId("vault-1".to_owned());
        assert_eq!(request.apply(), ProviderSaveOutcome::Duplicate);
    }

    #[test]
    fn provider_save_scopes_duplicates_to_the_active_vault() -> Result<(), &'static str> {
        let mut request = ProviderSaveRequest::fixture(StorageProviderType::Github);
        let mut other_vault_provider = StorageProviderData::github(
            "other-vault-provider",
            "GitHub · owner/repo",
            "pat",
            "owner/repo",
            "earlier",
        );
        other_vault_provider.store_id = ProviderVaultScope::StoreId("vault-2".to_owned());
        request
            .snapshot
            .providers
            .push(other_vault_provider.clone());

        let snapshot = request.apply().saved()?;

        assert_eq!(snapshot.providers[0], other_vault_provider);
        assert_eq!(snapshot.providers.len(), 2);
        assert_eq!(snapshot.providers[1].id, "provider-new");
        assert_eq!(snapshot.providers[1].store_id.as_deref(), Some("vault-1"));
        Ok(())
    }

    #[test]
    fn requires_a_selected_local_folder() {
        let request = ProviderSaveRequest::fixture(StorageProviderType::LocalFolder);
        assert_eq!(request.apply(), ProviderSaveOutcome::LocalFolderRequired);
    }

    #[test]
    fn creates_a_local_folder_provider_with_its_directory_label() -> Result<(), &'static str> {
        let mut request = ProviderSaveRequest::fixture(StorageProviderType::LocalFolder);
        request.local_folder = StoredLocalFolderConfiguration::Configured(LocalFolderConfigData {
            directory_name: StoredLocalFolderDirectory::DirectoryName("Backups".to_owned()),
            handle_id: StoredLocalFolderHandle::HandleId("handle-1".to_owned()),
        });
        let snapshot = request.apply().saved()?;
        assert_eq!(snapshot.providers[0].label, "Local backup · Backups");
        Ok(())
    }

    #[test]
    fn existing_flow_seeds_the_local_row_for_a_known_vault() -> Result<(), &'static str> {
        let mut request = ProviderSaveRequest::fixture(StorageProviderType::Github);
        request.setup = ProviderSaveSetup::Existing;
        let snapshot = request.apply().saved()?;
        assert_eq!(snapshot.providers.len(), 1);
        assert_eq!(
            snapshot.providers[0].provider_type,
            StorageProviderType::Local
        );
        assert_eq!(snapshot.providers[0].store_id.as_deref(), Some("vault-1"));
        Ok(())
    }

    #[test]
    fn oauth_provider_creation_adopts_active_remote_identity() -> Result<(), &'static str> {
        let mut request = ProviderSaveRequest::fixture(StorageProviderType::OauthFile);
        let active = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: StoredOAuthAccessCredential::AccessToken("fresh-access".to_owned()),
            file_id: StoredOAuthRemoteFileId::FileId("remote-file".to_owned()),
            file_name: StoredOAuthRemoteFileName::FileName("events".to_owned()),
            drive_mode: GoogleDriveMode::Shared,
            folder_id: StoredGoogleDriveFolder::FolderId("folder".to_owned()),
            ..OAuthFileConfigData::default()
        };
        request.oauth_file = StoredOAuthFileConfiguration::Configured(active);
        let ProviderSaveOutcome::Saved {
            snapshot,
            oauth_file,
        } = request.apply()
        else {
            return Err("expected saved OAuth provider outcome");
        };
        let persisted = snapshot.providers[0]
            .oauth_file
            .as_ref()
            .ok_or("expected persisted OAuth config")?;
        assert_eq!(persisted.access_token.as_deref(), Some("fresh-access"));
        assert_eq!(persisted.file_id.as_deref(), Some("remote-file"));
        assert_eq!(persisted.folder_id.as_deref(), Some("folder"));
        assert_eq!(
            persisted.refresh_token,
            StoredOAuthRefreshCredential::NotIssued
        );
        assert_eq!(oauth_file.as_ref().as_ref(), Some(persisted));
        Ok(())
    }

    #[test]
    fn oauth_merge_preserves_a_valid_persisted_token_when_active_token_is_blank() {
        let persisted_oauth = OAuthFileConfigData {
            access_token: StoredOAuthAccessCredential::AccessToken("persisted-token".to_owned()),
            file_id: StoredOAuthRemoteFileId::FileId("remote-file".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let active_oauth = OAuthFileConfigData {
            access_token: StoredOAuthAccessCredential::AccessToken("   ".to_owned()),
            file_id: StoredOAuthRemoteFileId::FileId("remote-file".to_owned()),
            ..OAuthFileConfigData::default()
        };

        let merged = ActiveOAuthMerge {
            persisted: &persisted_oauth,
            active: &active_oauth,
            drive_file: "nook.yaml",
        }
        .merge();
        assert_eq!(merged.access_token.as_deref(), Some("persisted-token"));
    }

    #[test]
    fn oauth_merge_preserves_the_persisted_refresh_token() {
        let persisted_oauth = OAuthFileConfigData {
            refresh_token: StoredOAuthRefreshCredential::Token("persisted-refresh".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let active_oauth = OAuthFileConfigData {
            refresh_token: StoredOAuthRefreshCredential::Token("active-refresh".to_owned()),
            ..OAuthFileConfigData::default()
        };

        let merged = ActiveOAuthMerge {
            persisted: &persisted_oauth,
            active: &active_oauth,
            drive_file: "nook.yaml",
        }
        .merge();
        assert_eq!(merged.refresh_token.as_deref(), Some("persisted-refresh"));
    }

    #[test]
    fn oauth_merge_resolves_blank_file_names_semantically() {
        let persisted_oauth = OAuthFileConfigData {
            file_name: StoredOAuthRemoteFileName::FileName("  ".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let active_oauth = OAuthFileConfigData {
            file_name: StoredOAuthRemoteFileName::FileName("discovered.yaml".to_owned()),
            ..OAuthFileConfigData::default()
        };

        let merged = ActiveOAuthMerge {
            persisted: &persisted_oauth,
            active: &active_oauth,
            drive_file: "fallback.yaml",
        }
        .merge();
        assert_eq!(merged.file_name.as_deref(), Some("discovered.yaml"));

        let blank_active = OAuthFileConfigData {
            file_name: StoredOAuthRemoteFileName::FileName("\t".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let fallback = ActiveOAuthMerge {
            persisted: &OAuthFileConfigData::default(),
            active: &blank_active,
            drive_file: "fallback.yaml",
        }
        .merge();
        assert_eq!(fallback.file_name.as_deref(), Some("fallback.yaml"));
    }

    #[test]
    fn implicit_duplicate_preserves_rows_and_request() -> Result<(), &'static str> {
        let mut request = ProviderSaveRequest::fixture(StorageProviderType::Github);
        request.explicit_add = false;
        let mut existing = StorageProviderData::github(
            "existing",
            "original label",
            "pat",
            "owner/repo",
            "earlier",
        );
        existing.store_id = ProviderVaultScope::StoreId("vault-1".to_owned());
        request.snapshot.providers.push(existing);
        let before = request.snapshot.clone();
        let result = request.apply().saved()?;
        assert_eq!(result, before);
        assert_eq!(request.snapshot, before);
        Ok(())
    }

    #[test]
    fn active_merge_retains_persisted_metadata_and_adopts_active_targets() {
        use crate::{
            ICloudMode, StoredICloudShareTarget, StoredOAuthAccountIdentity, StoredOAuthTokenExpiry,
        };
        let persisted = OAuthFileConfigData {
            file_name: StoredOAuthRemoteFileName::FileName(" stored ".to_owned()),
            account_email: StoredOAuthAccountIdentity::Email("stored-account".to_owned()),
            expires_at: StoredOAuthTokenExpiry::ExpiresAt("stored-expiry".to_owned()),
            folder_id: StoredGoogleDriveFolder::FolderId("stored-folder".to_owned()),
            icloud_share_target: StoredICloudShareTarget::SharedTarget("stored-share".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let active = OAuthFileConfigData {
            access_token: StoredOAuthAccessCredential::AccessToken(" active-token ".to_owned()),
            file_name: StoredOAuthRemoteFileName::FileName("active".to_owned()),
            account_email: StoredOAuthAccountIdentity::Email("active-account".to_owned()),
            expires_at: StoredOAuthTokenExpiry::ExpiresAt("active-expiry".to_owned()),
            file_id: StoredOAuthRemoteFileId::FileId("active-file".to_owned()),
            drive_mode: GoogleDriveMode::Shared,
            icloud_mode: ICloudMode::Shared,
            ..OAuthFileConfigData::default()
        };
        let merged = ActiveOAuthMerge {
            persisted: &persisted,
            active: &active,
            drive_file: "configured",
        }
        .merge();
        assert_eq!(merged.access_token, active.access_token);
        assert_eq!(merged.file_id, active.file_id);
        assert_eq!(merged.drive_mode, active.drive_mode);
        assert_eq!(merged.icloud_mode, active.icloud_mode);
        assert_eq!(merged.file_name, persisted.file_name);
        assert_eq!(merged.account_email, persisted.account_email);
        assert_eq!(merged.expires_at, persisted.expires_at);
        assert_eq!(merged.folder_id, persisted.folder_id);
        assert_eq!(merged.icloud_share_target, persisted.icloud_share_target);
    }
}
