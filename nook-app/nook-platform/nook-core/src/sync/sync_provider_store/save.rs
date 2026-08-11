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
    AuthProvidersSnapshotData, OAuthFileConfigData, StorageProviderData, active_vault_providers,
    ensure_local_provider_row, find_duplicate_sync_provider, local_provider_for_active_vault,
    sync_providers_for_active_vault,
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

fn non_empty(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()).then_some(value)
}

fn provider_defaults(
    request: &ProviderSaveRequest,
    provider_type: StorageProviderType,
    label: String,
) -> StorageProviderData {
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

fn configured_drive_file(request: &ProviderSaveRequest) -> String {
    let oauth = request.oauth_file.as_ref();
    let shared_google_drive = oauth.is_some_and(|config| {
        config.preset == OauthFilePreset::GoogleDrive
            && (config.drive_mode == GoogleDriveMode::Shared
                || matches!(config.folder_id, StoredGoogleDriveFolder::FolderId(_)))
    });
    if shared_google_drive {
        return oauth
            .and_then(|config| config.file_name.as_deref())
            .and_then(non_empty)
            .unwrap_or(DEFAULT_DRIVE_BACKUP_NAME)
            .to_owned();
    }
    non_empty(&request.github_repo)
        .unwrap_or(DEFAULT_DRIVE_BACKUP_NAME)
        .to_owned()
}

fn new_provider(
    request: &ProviderSaveRequest,
    provider_type: StorageProviderType,
) -> Result<StorageProviderData, ProviderConstructionError> {
    match provider_type {
        StorageProviderType::Local => Ok(provider_defaults(
            request,
            provider_type,
            sync_provider_default_label(provider_type, None, None),
        )),
        StorageProviderType::Github => {
            let repo = non_empty(&request.github_repo).unwrap_or(DEFAULT_GITHUB_REPO_NAME);
            let mut provider = provider_defaults(
                request,
                provider_type,
                sync_provider_default_label(provider_type, Some(repo), None),
            );
            provider.github_pat = StoredGithubPat::Token(request.github_pat.trim().to_owned());
            provider.github_repo = StoredGithubRepository::Repository(repo.to_owned());
            Ok(provider)
        }
        StorageProviderType::OauthFile => {
            let drive_file = configured_drive_file(request);
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
            let mut provider = provider_defaults(
                request,
                provider_type,
                sync_provider_default_label(
                    provider_type,
                    Some(&drive_file),
                    Some(request.oauth_preset),
                ),
            );
            provider.oauth_file = StoredOAuthFileConfiguration::Configured(oauth);
            Ok(provider)
        }
        StorageProviderType::LocalFolder => {
            let folder = request
                .local_folder
                .as_ref()
                .ok_or(ProviderConstructionError::LocalFolderRequired)?;
            let detail = folder.directory_name.as_deref().and_then(non_empty);
            let mut provider = provider_defaults(
                request,
                provider_type,
                sync_provider_default_label(provider_type, detail, None),
            );
            provider.local_folder = request.local_folder.clone();
            Ok(provider)
        }
    }
}

fn merge_active_oauth(
    persisted: &OAuthFileConfigData,
    active: &OAuthFileConfigData,
    drive_file: &str,
) -> OAuthFileConfigData {
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
            crate::StoredICloudShareTarget::SharedTarget(_) => active.icloud_share_target.clone(),
            crate::StoredICloudShareTarget::Personal => persisted.icloud_share_target.clone(),
        },
        file_name: if persisted.file_name.as_deref().and_then(non_empty).is_some() {
            persisted.file_name.clone()
        } else if active.file_name.as_deref().and_then(non_empty).is_some() {
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

fn oauth_update_target(
    providers: &[StorageProviderData],
    active_store_id: Option<&str>,
    active_oauth: &OAuthFileConfigData,
) -> Option<String> {
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
    let sync_providers = sync_providers_for_active_vault(providers, active_store_id).ok()?;
    find_duplicate_sync_provider(&sync_providers, &candidate, None).map(|provider| provider.id)
}

#[must_use]
pub fn apply_provider_save_policy(request: &ProviderSaveRequest) -> ProviderSaveOutcome {
    let provider_type = request.setup.provider_type(request.storage_mode);
    let active_store_id = request.snapshot.active_vault_store_id.as_deref();
    let active_providers = active_vault_providers(&request.snapshot.providers, active_store_id);
    let local_provider =
        local_provider_for_active_vault(&request.snapshot.providers, active_store_id)
            .ok()
            .flatten();
    let mut providers = request.snapshot.providers.clone();
    let mut oauth_update_id = None;

    if request.setup.is_new() && provider_type != StorageProviderType::Local {
        let provider = match new_provider(request, provider_type) {
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
        providers.push(provider_defaults(
            request,
            StorageProviderType::Local,
            sync_provider_default_label(StorageProviderType::Local, None, None),
        ));
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
        let target_id = oauth_update_id
            .or_else(|| oauth_update_target(&providers, active_store_id, active_oauth));
        if let Some(target_id) = target_id {
            let drive_file = configured_drive_file(request);
            for provider in &mut providers {
                if provider.id == target_id
                    && let Some(persisted) = provider.oauth_file.as_ref()
                {
                    let merged = merge_active_oauth(persisted, active_oauth, &drive_file);
                    provider.oauth_file = StoredOAuthFileConfiguration::Configured(merged.clone());
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

#[cfg(test)]
mod tests {
    use crate::{
        ActiveVaultScope, GoogleDriveMode, LocalFolderConfigData, OauthFilePreset,
        ProviderVaultScope, StorageProviderType, StoredGoogleDriveFolder,
        StoredLocalFolderConfiguration, StoredLocalFolderDirectory, StoredLocalFolderHandle,
        StoredOAuthAccessCredential, StoredOAuthFileConfiguration, StoredOAuthRefreshCredential,
        StoredOAuthRemoteFileId, StoredOAuthRemoteFileName,
    };

    use super::{
        ProviderSaveOutcome, ProviderSaveRequest, ProviderSaveSetup, apply_provider_save_policy,
        merge_active_oauth,
    };
    use crate::{AuthProvidersSnapshotData, OAuthFileConfigData, StorageProviderData};

    fn request(provider_type: StorageProviderType) -> ProviderSaveRequest {
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

    fn saved(outcome: ProviderSaveOutcome) -> Result<AuthProvidersSnapshotData, &'static str> {
        match outcome {
            ProviderSaveOutcome::Saved { snapshot, .. } => Ok(snapshot),
            _ => Err("expected saved provider outcome"),
        }
    }

    #[test]
    fn creates_scoped_github_provider_from_trimmed_inputs() -> Result<(), &'static str> {
        let snapshot = saved(apply_provider_save_policy(&request(
            StorageProviderType::Github,
        )))?;
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
        let mut request = request(StorageProviderType::Github);
        request.snapshot.providers.push(StorageProviderData::github(
            "existing",
            "GitHub",
            "pat",
            "owner/repo",
            "earlier",
        ));
        request.snapshot.providers[0].store_id = ProviderVaultScope::StoreId("vault-1".to_owned());
        assert_eq!(
            apply_provider_save_policy(&request),
            ProviderSaveOutcome::Duplicate
        );
    }

    #[test]
    fn requires_a_selected_local_folder() {
        let request = request(StorageProviderType::LocalFolder);
        assert_eq!(
            apply_provider_save_policy(&request),
            ProviderSaveOutcome::LocalFolderRequired
        );
    }

    #[test]
    fn creates_a_local_folder_provider_with_its_directory_label() -> Result<(), &'static str> {
        let mut request = request(StorageProviderType::LocalFolder);
        request.local_folder = StoredLocalFolderConfiguration::Configured(LocalFolderConfigData {
            directory_name: StoredLocalFolderDirectory::DirectoryName("Backups".to_owned()),
            handle_id: StoredLocalFolderHandle::HandleId("handle-1".to_owned()),
        });
        let snapshot = saved(apply_provider_save_policy(&request))?;
        assert_eq!(snapshot.providers[0].label, "Local backup · Backups");
        Ok(())
    }

    #[test]
    fn existing_flow_seeds_the_local_row_for_a_known_vault() -> Result<(), &'static str> {
        let mut request = request(StorageProviderType::Github);
        request.setup = ProviderSaveSetup::Existing;
        let snapshot = saved(apply_provider_save_policy(&request))?;
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
        let mut request = request(StorageProviderType::OauthFile);
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
        } = apply_provider_save_policy(&request)
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

        let merged = merge_active_oauth(&persisted_oauth, &active_oauth, "nook.yaml");
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

        let merged = merge_active_oauth(&persisted_oauth, &active_oauth, "nook.yaml");
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

        let merged = merge_active_oauth(&persisted_oauth, &active_oauth, "fallback.yaml");
        assert_eq!(merged.file_name.as_deref(), Some("discovered.yaml"));

        let blank_active = OAuthFileConfigData {
            file_name: StoredOAuthRemoteFileName::FileName("\t".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let fallback = merge_active_oauth(
            &OAuthFileConfigData::default(),
            &blank_active,
            "fallback.yaml",
        );
        assert_eq!(fallback.file_name.as_deref(), Some("fallback.yaml"));
    }
}
