#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::{
    StorageProviderData, StoredGithubPat, StoredGithubRepository, StoredLocalFolderConfiguration,
    StoredOAuthFileConfiguration, StoredOAuthRemoteFileName,
};
use crate::{DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, StorageProviderType};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "providerType", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ActiveProviderLoginSetup {
    Inactive,
    Active(StorageProviderType),
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(from_wasm_abi)]
pub struct ActiveProviderCredentialsRequest {
    pub local_vault_present: bool,
    pub login_setup: ActiveProviderLoginSetup,
    pub sync_providers: Vec<StorageProviderData>,
    pub current_storage_mode: StorageProviderType,
    pub current_github_pat: String,
    pub current_github_repo: String,
    pub current_oauth_file: StoredOAuthFileConfiguration,
    pub current_local_folder: StoredLocalFolderConfiguration,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub struct ActiveProviderCredentialDraft {
    pub storage_mode: StorageProviderType,
    pub github_pat: String,
    pub github_repo: String,
    pub oauth_file: StoredOAuthFileConfiguration,
    pub local_folder: StoredLocalFolderConfiguration,
}

impl ActiveProviderCredentialDraft {
    fn current(request: &ActiveProviderCredentialsRequest) -> Self {
        Self {
            storage_mode: request.current_storage_mode,
            github_pat: request.current_github_pat.clone(),
            github_repo: request.current_github_repo.clone(),
            oauth_file: request.current_oauth_file.clone(),
            local_folder: request.current_local_folder.clone(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "draft", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ActiveProviderCredentialsProjection {
    Unchanged,
    Apply(Box<ActiveProviderCredentialDraft>),
}

struct EcmascriptProviderText<'a>(&'a str);

impl<'a> EcmascriptProviderText<'a> {
    fn is_whitespace(character: char) -> bool {
        matches!(
            character,
            '\u{0009}'
                | '\u{000A}'
                | '\u{000B}'
                | '\u{000C}'
                | '\u{000D}'
                | '\u{0020}'
                | '\u{00A0}'
                | '\u{1680}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
        ) || ('\u{2000}'..='\u{200A}').contains(&character)
    }

    fn trimmed(self) -> &'a str {
        self.0.trim_matches(Self::is_whitespace)
    }

    fn with_default(self, default: &'a str) -> &'a str {
        let value = self.trimmed();
        if value.is_empty() { default } else { value }
    }
}

impl ActiveProviderCredentialsRequest {
    /// Project the active provider into a complete portable credential draft.
    /// Browser persistence and reactive state mutation remain host responsibilities.
    #[must_use]
    pub fn project(&self) -> ActiveProviderCredentialsProjection {
        let request = self;
        let mut draft = ActiveProviderCredentialDraft::current(request);
        if request.local_vault_present {
            draft.storage_mode = StorageProviderType::Local;
            draft.github_pat.clear();
            draft.oauth_file = StoredOAuthFileConfiguration::NotApplicable;
            draft.local_folder = StoredLocalFolderConfiguration::NotApplicable;
            return ActiveProviderCredentialsProjection::Apply(Box::new(draft));
        }

        if let ActiveProviderLoginSetup::Active(provider_type) = request.login_setup {
            draft.storage_mode = provider_type;
            if draft.storage_mode != StorageProviderType::Github {
                draft.github_pat.clear();
            }
            if draft.storage_mode != StorageProviderType::OauthFile {
                draft.oauth_file = StoredOAuthFileConfiguration::NotApplicable;
            }
            if draft.storage_mode != StorageProviderType::LocalFolder {
                draft.local_folder = StoredLocalFolderConfiguration::NotApplicable;
            }
            return ActiveProviderCredentialsProjection::Apply(Box::new(draft));
        }

        let Some(provider) = request.sync_providers.first() else {
            return ActiveProviderCredentialsProjection::Unchanged;
        };
        draft.storage_mode = provider.provider_type;
        match &provider.github_pat {
            StoredGithubPat::Missing => draft.github_pat.clear(),
            StoredGithubPat::Token(pat) => EcmascriptProviderText(pat)
                .trimmed()
                .clone_into(&mut draft.github_pat),
        }

        match provider.provider_type {
            StorageProviderType::OauthFile => {
                draft.oauth_file = provider.oauth_file.clone();
                draft.local_folder = StoredLocalFolderConfiguration::NotApplicable;
                let name = match &provider.oauth_file {
                    StoredOAuthFileConfiguration::Configured(config) => match &config.file_name {
                        StoredOAuthRemoteFileName::FileName(name) => {
                            EcmascriptProviderText(name).with_default(DEFAULT_DRIVE_BACKUP_NAME)
                        }
                        StoredOAuthRemoteFileName::Unresolved => DEFAULT_DRIVE_BACKUP_NAME,
                    },
                    StoredOAuthFileConfiguration::NotApplicable => DEFAULT_DRIVE_BACKUP_NAME,
                };
                name.clone_into(&mut draft.github_repo);
            }
            StorageProviderType::LocalFolder => {
                DEFAULT_GITHUB_REPO_NAME.clone_into(&mut draft.github_repo);
                draft.oauth_file = StoredOAuthFileConfiguration::NotApplicable;
                draft.local_folder = provider.local_folder.clone();
            }
            StorageProviderType::Local | StorageProviderType::Github => {
                let repository = match &provider.github_repo {
                    StoredGithubRepository::Repository(repo) => {
                        EcmascriptProviderText(repo).with_default(DEFAULT_GITHUB_REPO_NAME)
                    }
                    StoredGithubRepository::DefaultRepository => DEFAULT_GITHUB_REPO_NAME,
                };
                repository.clone_into(&mut draft.github_repo);
                draft.oauth_file = StoredOAuthFileConfiguration::NotApplicable;
                draft.local_folder = StoredLocalFolderConfiguration::NotApplicable;
            }
        }
        ActiveProviderCredentialsProjection::Apply(Box::new(draft))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        LocalFolderConfigData, OAuthFileConfigData, ProviderSyncCheckpoint, ProviderVaultScope,
        StoredGithubPat, StoredGithubRepository, StoredLocalFolderHandle,
        StoredOAuthRemoteFileName,
    };

    impl ActiveProviderCredentialsRequest {
        fn fixture() -> Self {
            ActiveProviderCredentialsRequest {
                local_vault_present: false,
                login_setup: ActiveProviderLoginSetup::Inactive,
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
    }

    impl StorageProviderData {
        fn credential_projection_fixture(provider_type: StorageProviderType) -> Self {
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
    }

    impl ActiveProviderCredentialsProjection {
        fn applied(self) -> Result<ActiveProviderCredentialDraft, &'static str> {
            let Self::Apply(draft) = self else {
                return Err("expected an applied credential draft");
            };
            Ok(*draft)
        }
    }

    #[test]
    fn local_vault_clears_remote_credentials_but_preserves_repository_draft()
    -> Result<(), &'static str> {
        let mut request = ActiveProviderCredentialsRequest::fixture();
        request.local_vault_present = true;

        let projection = request.project().applied()?;

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
        Ok(())
    }

    #[test]
    fn login_setup_preserves_only_the_selected_provider_credentials() -> Result<(), &'static str> {
        let mut request = ActiveProviderCredentialsRequest::fixture();
        request.login_setup = ActiveProviderLoginSetup::Active(StorageProviderType::OauthFile);

        let projection = request.project().applied()?;

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
        Ok(())
    }

    #[test]
    fn missing_sync_provider_preserves_the_current_draft() {
        let request = ActiveProviderCredentialsRequest::fixture();
        let projection = request.project();

        assert_eq!(projection, ActiveProviderCredentialsProjection::Unchanged);
    }

    #[test]
    fn github_provider_projects_pat_repo_and_clears_other_credentials() -> Result<(), &'static str>
    {
        let mut request = ActiveProviderCredentialsRequest::fixture();
        request.sync_providers = vec![StorageProviderData::credential_projection_fixture(
            StorageProviderType::Github,
        )];

        let projection = request.project().applied()?;

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
        Ok(())
    }

    #[test]
    fn oauth_provider_projects_configuration_and_remote_file_name() -> Result<(), &'static str> {
        let oauth = OAuthFileConfigData {
            file_name: StoredOAuthRemoteFileName::FileName(" vault.yaml ".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let mut provider =
            StorageProviderData::credential_projection_fixture(StorageProviderType::OauthFile);
        provider.oauth_file = StoredOAuthFileConfiguration::Configured(oauth.clone());
        let mut request = ActiveProviderCredentialsRequest::fixture();
        request.sync_providers = vec![provider];

        let projection = request.project().applied()?;

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
        Ok(())
    }

    #[test]
    fn local_folder_provider_projects_configuration_and_default_repo() -> Result<(), &'static str> {
        let folder = LocalFolderConfigData {
            handle_id: StoredLocalFolderHandle::HandleId("folder".to_owned()),
            ..LocalFolderConfigData::default()
        };
        let mut provider =
            StorageProviderData::credential_projection_fixture(StorageProviderType::LocalFolder);
        provider.local_folder = StoredLocalFolderConfiguration::Configured(folder.clone());
        let mut request = ActiveProviderCredentialsRequest::fixture();
        request.sync_providers = vec![provider];

        let projection = request.project().applied()?;

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
        Ok(())
    }

    #[test]
    fn provider_text_uses_ecmascript_whitespace_normalization() -> Result<(), &'static str> {
        let mut provider =
            StorageProviderData::credential_projection_fixture(StorageProviderType::Github);
        provider.github_pat = StoredGithubPat::Token("\u{FEFF}provider-pat\u{FEFF}".to_owned());
        provider.github_repo =
            StoredGithubRepository::Repository("\u{FEFF}owner/repo\u{FEFF}".to_owned());
        let mut request = ActiveProviderCredentialsRequest::fixture();
        request.sync_providers = vec![provider];

        let projection = request.project().applied()?;

        assert_eq!(projection.github_pat, "provider-pat");
        assert_eq!(projection.github_repo, "owner/repo");
        assert_eq!(
            EcmascriptProviderText("\u{0085}value\u{0085}").trimmed(),
            "\u{0085}value\u{0085}"
        );
        Ok(())
    }

    #[test]
    fn login_modes_preserve_selected_fields_and_local_vault_takes_precedence()
    -> Result<(), &'static str> {
        for mode in [
            StorageProviderType::Local,
            StorageProviderType::Github,
            StorageProviderType::OauthFile,
            StorageProviderType::LocalFolder,
        ] {
            let mut request = ActiveProviderCredentialsRequest::fixture();
            request.login_setup = ActiveProviderLoginSetup::Active(mode);
            request.sync_providers = vec![StorageProviderData::credential_projection_fixture(
                StorageProviderType::Github,
            )];
            let original = request.clone();
            let draft = request.project().applied()?;
            assert_eq!(request, original);
            assert_eq!(draft.storage_mode, mode);
            assert_eq!(draft.github_repo, request.current_github_repo);
            assert_eq!(
                draft.github_pat,
                if mode == StorageProviderType::Github {
                    "current-pat"
                } else {
                    ""
                }
            );
            assert_eq!(
                draft.oauth_file,
                if mode == StorageProviderType::OauthFile {
                    request.current_oauth_file.clone()
                } else {
                    StoredOAuthFileConfiguration::NotApplicable
                }
            );
            assert_eq!(
                draft.local_folder,
                if mode == StorageProviderType::LocalFolder {
                    request.current_local_folder.clone()
                } else {
                    StoredLocalFolderConfiguration::NotApplicable
                }
            );
            request.local_vault_present = true;
            let original = request.clone();
            let draft = request.project().applied()?;
            assert_eq!(request, original);
            assert_eq!(draft.storage_mode, StorageProviderType::Local);
            assert_eq!(draft.github_pat, "");
            assert_eq!(draft.github_repo, "current/repo");
            assert_eq!(
                draft.oauth_file,
                StoredOAuthFileConfiguration::NotApplicable
            );
            assert_eq!(
                draft.local_folder,
                StoredLocalFolderConfiguration::NotApplicable
            );
        }
        Ok(())
    }

    #[test]
    fn first_provider_projects_pat_for_every_mode_without_validating_or_mutating_rows()
    -> Result<(), &'static str> {
        for mode in [
            StorageProviderType::Local,
            StorageProviderType::Github,
            StorageProviderType::OauthFile,
            StorageProviderType::LocalFolder,
        ] {
            let mut first = StorageProviderData::credential_projection_fixture(mode);
            first.github_pat = StoredGithubPat::Token(" malformed token \u{FEFF}".to_owned());
            first.github_repo = StoredGithubRepository::Repository(" \u{FEFF}".to_owned());
            first.oauth_file = StoredOAuthFileConfiguration::Configured(OAuthFileConfigData {
                file_name: StoredOAuthRemoteFileName::FileName("\u{FEFF} ".to_owned()),
                ..OAuthFileConfigData::default()
            });
            let mut request = ActiveProviderCredentialsRequest::fixture();
            request.sync_providers = vec![
                first,
                StorageProviderData::credential_projection_fixture(StorageProviderType::Github),
            ];
            let original = request.clone();
            let draft = request.project().applied()?;
            assert_eq!(request, original);
            assert_eq!(draft.storage_mode, mode);
            assert_eq!(draft.github_pat, "malformed token");
            assert_eq!(
                draft.github_repo,
                if mode == StorageProviderType::OauthFile {
                    DEFAULT_DRIVE_BACKUP_NAME
                } else {
                    DEFAULT_GITHUB_REPO_NAME
                }
            );
            request.sync_providers.reverse();
            let draft = request.project().applied()?;
            assert_eq!(draft.storage_mode, StorageProviderType::Github);
            assert_eq!(draft.github_pat, "provider-pat");
            assert_eq!(draft.github_repo, "owner/repo");
        }
        Ok(())
    }

    #[test]
    fn whitespace_grammar_preserves_non_ecmascript_characters_and_interior_bytes() {
        for character in [
            '\u{0009}', '\u{000A}', '\u{000B}', '\u{000C}', '\u{000D}', '\u{0020}', '\u{00A0}',
            '\u{1680}', '\u{2028}', '\u{2029}', '\u{202F}', '\u{205F}', '\u{3000}', '\u{FEFF}',
        ]
        .into_iter()
        .chain('\u{2000}'..='\u{200A}')
        {
            let text = format!("{character}a{character}b{character}");
            let expected = format!("a{character}b");
            assert_eq!(EcmascriptProviderText(&text).trimmed(), expected);
            assert_eq!(
                EcmascriptProviderText(&text).non_empty(),
                Some(expected.as_str())
            );
            let blank = character.to_string();
            assert_eq!(EcmascriptProviderText(&blank).non_empty(), None);
        }
        for text in [
            "\u{0085}value\u{0085}",
            "\u{200B}value\u{200B}",
            "\u{180E}",
            "\u{2060}",
        ] {
            assert_eq!(EcmascriptProviderText(text).trimmed(), text);
            assert_eq!(EcmascriptProviderText(text).non_empty(), Some(text));
        }
        assert_eq!(EcmascriptProviderText("").non_empty(), None);
    }
}
