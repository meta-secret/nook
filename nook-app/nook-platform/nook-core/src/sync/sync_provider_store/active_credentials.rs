use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::{StorageProviderData, StoredLocalFolderConfiguration, StoredOAuthFileConfiguration};
use crate::{DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, StorageProviderType};

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(from_wasm_abi)]
pub struct ActiveProviderCredentialsRequest {
    pub local_vault_present: bool,
    pub login_setup_active: bool,
    pub login_setup_provider_type: StorageProviderType,
    pub sync_providers: Vec<StorageProviderData>,
    pub current_storage_mode: StorageProviderType,
    pub current_github_pat: String,
    pub current_github_repo: String,
    pub current_oauth_file: StoredOAuthFileConfiguration,
    pub current_local_folder: StoredLocalFolderConfiguration,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub struct ActiveProviderCredentialsProjection {
    pub apply: bool,
    pub storage_mode: StorageProviderType,
    pub github_pat: String,
    pub github_repo: String,
    pub oauth_file: StoredOAuthFileConfiguration,
    pub local_folder: StoredLocalFolderConfiguration,
}

impl ActiveProviderCredentialsProjection {
    fn current(request: &ActiveProviderCredentialsRequest) -> Self {
        Self {
            apply: false,
            storage_mode: request.current_storage_mode,
            github_pat: request.current_github_pat.clone(),
            github_repo: request.current_github_repo.clone(),
            oauth_file: request.current_oauth_file.clone(),
            local_folder: request.current_local_folder.clone(),
        }
    }
}

fn non_empty(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()).then_some(value)
}

/// Project the active provider into a complete portable credential draft.
/// Browser persistence and reactive state mutation remain host responsibilities.
#[must_use]
pub fn active_provider_credentials_projection(
    request: &ActiveProviderCredentialsRequest,
) -> ActiveProviderCredentialsProjection {
    let mut projection = ActiveProviderCredentialsProjection::current(request);
    if request.local_vault_present {
        projection.apply = true;
        projection.storage_mode = StorageProviderType::Local;
        projection.github_pat.clear();
        projection.oauth_file = StoredOAuthFileConfiguration::NotApplicable;
        projection.local_folder = StoredLocalFolderConfiguration::NotApplicable;
        return projection;
    }

    if request.login_setup_active {
        projection.apply = true;
        projection.storage_mode = request.login_setup_provider_type;
        if projection.storage_mode != StorageProviderType::Github {
            projection.github_pat.clear();
        }
        if projection.storage_mode != StorageProviderType::OauthFile {
            projection.oauth_file = StoredOAuthFileConfiguration::NotApplicable;
        }
        if projection.storage_mode != StorageProviderType::LocalFolder {
            projection.local_folder = StoredLocalFolderConfiguration::NotApplicable;
        }
        return projection;
    }

    let Some(provider) = request.sync_providers.first() else {
        return projection;
    };
    projection.apply = true;
    projection.storage_mode = provider.provider_type;
    provider
        .github_pat
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .clone_into(&mut projection.github_pat);

    match provider.provider_type {
        StorageProviderType::OauthFile => {
            projection.oauth_file = provider.oauth_file.clone();
            projection.local_folder = StoredLocalFolderConfiguration::NotApplicable;
            provider
                .oauth_file
                .as_ref()
                .and_then(|config| config.file_name.as_deref())
                .and_then(non_empty)
                .unwrap_or(DEFAULT_DRIVE_BACKUP_NAME)
                .clone_into(&mut projection.github_repo);
        }
        StorageProviderType::LocalFolder => {
            DEFAULT_GITHUB_REPO_NAME.clone_into(&mut projection.github_repo);
            projection.oauth_file = StoredOAuthFileConfiguration::NotApplicable;
            projection.local_folder = provider.local_folder.clone();
        }
        StorageProviderType::Local | StorageProviderType::Github => {
            provider
                .github_repo
                .as_deref()
                .and_then(non_empty)
                .unwrap_or(DEFAULT_GITHUB_REPO_NAME)
                .clone_into(&mut projection.github_repo);
            projection.oauth_file = StoredOAuthFileConfiguration::NotApplicable;
            projection.local_folder = StoredLocalFolderConfiguration::NotApplicable;
        }
    }
    projection
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        LocalFolderConfigData, OAuthFileConfigData, ProviderSyncCheckpoint, ProviderVaultScope,
        StoredGithubPat, StoredGithubRepository, StoredLocalFolderHandle,
        StoredOAuthRemoteFileName,
    };

    fn request() -> ActiveProviderCredentialsRequest {
        ActiveProviderCredentialsRequest {
            local_vault_present: false,
            login_setup_active: false,
            login_setup_provider_type: StorageProviderType::Local,
            sync_providers: Vec::new(),
            current_storage_mode: StorageProviderType::Github,
            current_github_pat: "current-pat".to_owned(),
            current_github_repo: "current/repo".to_owned(),
            current_oauth_file: StoredOAuthFileConfiguration::Configured(
                OAuthFileConfigData::default(),
            ),
            current_local_folder: StoredLocalFolderConfiguration::Configured(
                LocalFolderConfigData::default(),
            ),
        }
    }

    fn provider(provider_type: StorageProviderType) -> StorageProviderData {
        StorageProviderData {
            id: "provider".to_owned(),
            provider_type,
            label: "Provider".to_owned(),
            github_pat: StoredGithubPat::Token(" provider-pat ".to_owned()),
            github_repo: StoredGithubRepository::Repository(" owner/repo ".to_owned()),
            oauth_file: StoredOAuthFileConfiguration::NotApplicable,
            local_folder: StoredLocalFolderConfiguration::NotApplicable,
            store_id: ProviderVaultScope::Unscoped,
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: "2026-08-12T00:00:00Z".to_owned(),
        }
    }

    #[test]
    fn local_vault_clears_remote_credentials_but_preserves_repository_draft() {
        let mut request = request();
        request.local_vault_present = true;

        let projection = active_provider_credentials_projection(&request);

        assert!(projection.apply);
        assert_eq!(projection.storage_mode, StorageProviderType::Local);
        assert!(projection.github_pat.is_empty());
        assert_eq!(projection.github_repo, "current/repo");
        assert_eq!(
            projection.oauth_file,
            StoredOAuthFileConfiguration::NotApplicable
        );
        assert_eq!(
            projection.local_folder,
            StoredLocalFolderConfiguration::NotApplicable
        );
    }

    #[test]
    fn login_setup_preserves_only_the_selected_provider_credentials() {
        let mut request = request();
        request.login_setup_active = true;
        request.login_setup_provider_type = StorageProviderType::OauthFile;

        let projection = active_provider_credentials_projection(&request);

        assert!(projection.apply);
        assert_eq!(projection.storage_mode, StorageProviderType::OauthFile);
        assert!(projection.github_pat.is_empty());
        assert_eq!(projection.github_repo, "current/repo");
        assert!(matches!(
            projection.oauth_file,
            StoredOAuthFileConfiguration::Configured(_)
        ));
        assert_eq!(
            projection.local_folder,
            StoredLocalFolderConfiguration::NotApplicable
        );
    }

    #[test]
    fn missing_sync_provider_preserves_the_current_draft() {
        let request = request();
        let projection = active_provider_credentials_projection(&request);

        assert!(!projection.apply);
        assert_eq!(
            projection,
            ActiveProviderCredentialsProjection::current(&request)
        );
    }

    #[test]
    fn github_provider_projects_pat_repo_and_clears_other_credentials() {
        let mut request = request();
        request.sync_providers = vec![provider(StorageProviderType::Github)];

        let projection = active_provider_credentials_projection(&request);

        assert!(projection.apply);
        assert_eq!(projection.storage_mode, StorageProviderType::Github);
        assert_eq!(projection.github_pat, "provider-pat");
        assert_eq!(projection.github_repo, "owner/repo");
        assert_eq!(
            projection.oauth_file,
            StoredOAuthFileConfiguration::NotApplicable
        );
        assert_eq!(
            projection.local_folder,
            StoredLocalFolderConfiguration::NotApplicable
        );
    }

    #[test]
    fn oauth_provider_projects_configuration_and_remote_file_name() {
        let oauth = OAuthFileConfigData {
            file_name: StoredOAuthRemoteFileName::FileName(" vault.yaml ".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let mut provider = provider(StorageProviderType::OauthFile);
        provider.oauth_file = StoredOAuthFileConfiguration::Configured(oauth.clone());
        let mut request = request();
        request.sync_providers = vec![provider];

        let projection = active_provider_credentials_projection(&request);

        assert_eq!(projection.storage_mode, StorageProviderType::OauthFile);
        assert_eq!(projection.github_repo, "vault.yaml");
        assert_eq!(
            projection.oauth_file,
            StoredOAuthFileConfiguration::Configured(oauth)
        );
        assert_eq!(
            projection.local_folder,
            StoredLocalFolderConfiguration::NotApplicable
        );
    }

    #[test]
    fn local_folder_provider_projects_configuration_and_default_repo() {
        let folder = LocalFolderConfigData {
            handle_id: StoredLocalFolderHandle::HandleId("folder".to_owned()),
            ..LocalFolderConfigData::default()
        };
        let mut provider = provider(StorageProviderType::LocalFolder);
        provider.local_folder = StoredLocalFolderConfiguration::Configured(folder.clone());
        let mut request = request();
        request.sync_providers = vec![provider];

        let projection = active_provider_credentials_projection(&request);

        assert_eq!(projection.storage_mode, StorageProviderType::LocalFolder);
        assert_eq!(projection.github_repo, DEFAULT_GITHUB_REPO_NAME);
        assert_eq!(
            projection.local_folder,
            StoredLocalFolderConfiguration::Configured(folder)
        );
        assert_eq!(
            projection.oauth_file,
            StoredOAuthFileConfiguration::NotApplicable
        );
    }
}
