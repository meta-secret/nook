use super::{NookStorageConnectArgs, wasm_bindgen};
use nook_core::{
    ActiveProviderCredentialsProjection, ExistingVaultProviderReadiness, GithubPatMask,
    StorageConnectArgs, StorageProviderType, StoredLocalFolderConfiguration,
    StoredOAuthFileConfiguration,
};
use nook_core::{
    DraftStorageConnection, GithubStorageDraft, OAuthRemoteConfigurationUpdate,
    OAuthRemoteStorageReference, OAuthStorageDraft, ProviderSelection, StagedStorageConnection,
};
use wasm_bindgen::JsError;

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookActiveProviderCredentialsProjectionState {
    Unchanged,
    Apply,
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn active_provider_credentials_projection_state(
    projection: nook_core::ActiveProviderCredentialsProjection,
) -> NookActiveProviderCredentialsProjectionState {
    match projection {
        ActiveProviderCredentialsProjection::Unchanged => {
            NookActiveProviderCredentialsProjectionState::Unchanged
        }
        ActiveProviderCredentialsProjection::Apply(_) => {
            NookActiveProviderCredentialsProjectionState::Apply
        }
    }
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn active_provider_credentials_projection_draft(
    projection: nook_core::ActiveProviderCredentialsProjection,
) -> Result<nook_core::ActiveProviderCredentialDraft, wasm_bindgen::JsError> {
    match projection {
        ActiveProviderCredentialsProjection::Unchanged => Err(JsError::new(
            "active provider credentials projection is unchanged",
        )),
        ActiveProviderCredentialsProjection::Apply(draft) => Ok(*draft),
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookStoredOAuthFileConfigurationState {
    NotApplicable,
    Configured,
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn stored_oauth_file_configuration_state(
    configuration: nook_core::StoredOAuthFileConfiguration,
) -> NookStoredOAuthFileConfigurationState {
    match configuration {
        StoredOAuthFileConfiguration::NotApplicable => {
            NookStoredOAuthFileConfigurationState::NotApplicable
        }
        StoredOAuthFileConfiguration::Configured(_) => {
            NookStoredOAuthFileConfigurationState::Configured
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookStoredLocalFolderConfigurationState {
    NotApplicable,
    Configured,
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn stored_local_folder_configuration_state(
    configuration: nook_core::StoredLocalFolderConfiguration,
) -> NookStoredLocalFolderConfigurationState {
    match configuration {
        StoredLocalFolderConfiguration::NotApplicable => {
            NookStoredLocalFolderConfigurationState::NotApplicable
        }
        StoredLocalFolderConfiguration::Configured(_) => {
            NookStoredLocalFolderConfigurationState::Configured
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookExistingVaultProviderReadiness {
    Ready,
    MissingOauthFile,
    MissingLocalFolder,
}

impl From<nook_core::ExistingVaultProviderReadiness> for NookExistingVaultProviderReadiness {
    fn from(value: nook_core::ExistingVaultProviderReadiness) -> Self {
        match value {
            ExistingVaultProviderReadiness::Ready => Self::Ready,
            ExistingVaultProviderReadiness::MissingOauthFile => Self::MissingOauthFile,
            ExistingVaultProviderReadiness::MissingLocalFolder => Self::MissingLocalFolder,
        }
    }
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn existing_vault_provider_readiness(
    provider_type: nook_core::StorageProviderType,
    oauth_file_configured: bool,
    local_folder_configured: bool,
) -> NookExistingVaultProviderReadiness {
    provider_type
        .readiness(oauth_file_configured, local_folder_configured)
        .into()
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn oauth_access_token(config: nook_core::OAuthFileConfigData) -> nook_core::OAuthAccessToken {
    config.usable_access_token().into()
}
#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn missing_oauth_access_token() -> nook_core::OAuthAccessToken {
    nook_core::OAuthAccessToken::Missing
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookProviderSelectionState {
    Missing,
    Selected,
}

#[wasm_bindgen]
pub struct NookProviderSelection(pub(super) ProviderSelection);

#[wasm_bindgen]
impl NookProviderSelection {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookProviderSelectionState {
        match &self.0 {
            ProviderSelection::Selected(_) => NookProviderSelectionState::Selected,
            ProviderSelection::Unavailable => NookProviderSelectionState::Missing,
        }
    }
    #[wasm_bindgen(getter, js_name = providerId)]
    pub fn provider_id(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            ProviderSelection::Selected(id) => Ok(id.as_str().to_owned()),
            ProviderSelection::Unavailable => Err(JsError::new("provider selection is missing")),
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookOAuthRemoteStorageReferenceState {
    Unresolved,
    Resolved,
}

#[wasm_bindgen]
pub struct NookOAuthRemoteStorageReference(OAuthRemoteStorageReference);

#[wasm_bindgen]
impl NookOAuthRemoteStorageReference {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookOAuthRemoteStorageReferenceState {
        match &self.0 {
            OAuthRemoteStorageReference::Unresolved => {
                NookOAuthRemoteStorageReferenceState::Unresolved
            }
            OAuthRemoteStorageReference::Resolved(_) => {
                NookOAuthRemoteStorageReferenceState::Resolved
            }
        }
    }
    #[wasm_bindgen(getter)]
    pub fn value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            OAuthRemoteStorageReference::Resolved(value) => Ok(value.as_str().to_owned()),
            OAuthRemoteStorageReference::Unresolved => {
                Err(JsError::new("OAuth remote storage is unresolved"))
            }
        }
    }
}

impl NookOAuthRemoteStorageReference {
    pub(super) const fn new(value: OAuthRemoteStorageReference) -> Self {
        Self(value)
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookOAuthRemoteConfigurationUpdateState {
    Rejected,
    Updated,
}

#[wasm_bindgen]
pub struct NookOAuthRemoteConfigurationUpdate(OAuthRemoteConfigurationUpdate);

#[wasm_bindgen]
impl NookOAuthRemoteConfigurationUpdate {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookOAuthRemoteConfigurationUpdateState {
        match &self.0 {
            OAuthRemoteConfigurationUpdate::Unchanged => {
                NookOAuthRemoteConfigurationUpdateState::Rejected
            }
            OAuthRemoteConfigurationUpdate::Updated(_) => {
                NookOAuthRemoteConfigurationUpdateState::Updated
            }
        }
    }
    #[wasm_bindgen(getter)]
    pub fn config(&self) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
        match &self.0 {
            OAuthRemoteConfigurationUpdate::Updated(value) => Ok((**value).clone()),
            OAuthRemoteConfigurationUpdate::Unchanged => {
                Err(JsError::new("OAuth remote reference was rejected"))
            }
        }
    }
}

impl NookOAuthRemoteConfigurationUpdate {
    pub(super) const fn new(value: OAuthRemoteConfigurationUpdate) -> Self {
        Self(value)
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookStagedStorageArgsState {
    Incomplete,
    Ready,
}

#[wasm_bindgen]
pub struct NookStagedStorageArgs(StagedStorageConnection);

#[wasm_bindgen]
impl NookStagedStorageArgs {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookStagedStorageArgsState {
        match self.0 {
            StagedStorageConnection::Ready(_) => NookStagedStorageArgsState::Ready,
            StagedStorageConnection::Incomplete => NookStagedStorageArgsState::Incomplete,
        }
    }
    #[wasm_bindgen(getter)]
    pub fn args(&self) -> Result<NookStorageConnectArgs, wasm_bindgen::JsError> {
        match &self.0 {
            StagedStorageConnection::Ready(args) => Ok(args.clone().into()),
            StagedStorageConnection::Incomplete => {
                Err(JsError::new("staged storage is incomplete"))
            }
        }
    }
}

impl NookStagedStorageArgs {
    pub(super) const fn new(value: StagedStorageConnection) -> Self {
        Self(value)
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookGithubPatHintState {
    Missing,
    Available,
}

#[wasm_bindgen]
pub struct NookGithubPatHint(GithubPatMask);

#[wasm_bindgen]
impl NookGithubPatHint {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookGithubPatHintState {
        match &self.0 {
            GithubPatMask::NoToken => NookGithubPatHintState::Missing,
            GithubPatMask::Hint(_) => NookGithubPatHintState::Available,
        }
    }
    #[wasm_bindgen(getter)]
    pub fn value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            GithubPatMask::Hint(value) => Ok(value.clone()),
            GithubPatMask::NoToken => Err(JsError::new("GitHub PAT hint is unavailable")),
        }
    }
}

impl NookGithubPatHint {
    pub(super) const fn new(value: GithubPatMask) -> Self {
        Self(value)
    }
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn local_vault_storage_args() -> NookStorageConnectArgs {
    StorageConnectArgs::local().into()
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authenticated_vault_storage_args(
    provider: nook_core::StorageProviderData,
) -> Result<NookStorageConnectArgs, wasm_bindgen::JsError> {
    Ok(provider.connection_args()?.into())
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn draft_github_storage_args(github_pat: &str, github_repo: &str) -> NookStorageConnectArgs {
    DraftStorageConnection::Github(GithubStorageDraft {
        credential: &nook_core::StoredGithubPat::Token(github_pat.to_owned()),
        repository: &nook_core::StoredGithubRepository::Repository(github_repo.to_owned()),
    })
    .project()
    .into()
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn draft_oauth_storage_args(config: nook_core::OAuthFileConfigData) -> NookStorageConnectArgs {
    DraftStorageConnection::OAuth(OAuthStorageDraft {
        preset: config.preset,
        credential: &config.access_token,
        remote_reference: config.remote_storage_ref(),
        file_name: &config.file_name,
        alternate_name: &nook_core::StoredOAuthRemoteFileName::Unresolved,
    })
    .project()
    .into()
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn draft_local_storage_args() -> NookStorageConnectArgs {
    DraftStorageConnection::Local.project().into()
}

/// Return a masked GitHub PAT hint without exposing the full credential.
#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn mask_github_pat_hint(pat: nook_core::StoredGithubPat) -> NookGithubPatHint {
    NookGithubPatHint::new(match pat {
        nook_core::StoredGithubPat::Missing => GithubPatMask::NoToken,
        nook_core::StoredGithubPat::Token(pat) => nook_core::GithubPat::mask(&pat),
    })
}

#[cfg(test)]
#[allow(unused_imports)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn provider_state_wrappers_project_success_and_rejection_variants() {
        let draft = nook_core::ActiveProviderCredentialDraft {
            storage_mode: StorageProviderType::Github,
            github_pat: "pat".into(),
            github_repo: "owner/repo".into(),
            oauth_file: StoredOAuthFileConfiguration::NotApplicable,
            local_folder: StoredLocalFolderConfiguration::NotApplicable,
        };
        assert_eq!(
            active_provider_credentials_projection_state(
                nook_core::ActiveProviderCredentialsProjection::Unchanged
            ),
            NookActiveProviderCredentialsProjectionState::Unchanged
        );
        assert_eq!(
            active_provider_credentials_projection_state(
                nook_core::ActiveProviderCredentialsProjection::Apply(Box::new(draft.clone()))
            ),
            NookActiveProviderCredentialsProjectionState::Apply
        );
        assert!(
            active_provider_credentials_projection_draft(
                nook_core::ActiveProviderCredentialsProjection::Unchanged
            )
            .is_err()
        );
        let projected = active_provider_credentials_projection_draft(
            nook_core::ActiveProviderCredentialsProjection::Apply(Box::new(draft)),
        )
        .expect("apply projection keeps its draft");
        assert_eq!(projected.github_repo, "owner/repo");

        assert_eq!(
            stored_oauth_file_configuration_state(StoredOAuthFileConfiguration::NotApplicable),
            NookStoredOAuthFileConfigurationState::NotApplicable
        );
        assert_eq!(
            stored_oauth_file_configuration_state(StoredOAuthFileConfiguration::Configured(
                nook_core::OAuthFileConfigData::default(),
            )),
            NookStoredOAuthFileConfigurationState::Configured
        );
        assert_eq!(
            stored_local_folder_configuration_state(StoredLocalFolderConfiguration::NotApplicable),
            NookStoredLocalFolderConfigurationState::NotApplicable
        );
        assert_eq!(
            stored_local_folder_configuration_state(StoredLocalFolderConfiguration::Configured(
                nook_core::LocalFolderConfigData::default(),
            )),
            NookStoredLocalFolderConfigurationState::Configured
        );
        assert_eq!(
            existing_vault_provider_readiness(StorageProviderType::OauthFile, false, false),
            NookExistingVaultProviderReadiness::MissingOauthFile
        );
        assert_eq!(
            existing_vault_provider_readiness(StorageProviderType::LocalFolder, false, false),
            NookExistingVaultProviderReadiness::MissingLocalFolder
        );
        assert_eq!(
            existing_vault_provider_readiness(StorageProviderType::Github, false, false),
            NookExistingVaultProviderReadiness::Ready
        );
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn provider_state_values_keep_secret_boundaries_and_defaults() {
        let missing = missing_oauth_access_token();
        assert_eq!(missing, nook_core::OAuthAccessToken::Missing);
        let mut config = nook_core::OAuthFileConfigData::default();
        config.access_token = nook_core::StoredOAuthAccessCredential::AccessToken(" token ".into());
        let available = oauth_access_token(config.clone());
        assert_eq!(
            available,
            nook_core::OAuthAccessToken::Available {
                token: "token".to_owned()
            }
        );

        let missing_selection = NookProviderSelection(ProviderSelection::Unavailable);
        assert_eq!(
            missing_selection.state(),
            NookProviderSelectionState::Missing
        );
        assert!(missing_selection.provider_id().is_err());
        let selected = NookProviderSelection(ProviderSelection::Selected("provider-1".into()));
        assert_eq!(selected.state(), NookProviderSelectionState::Selected);
        assert_eq!(selected.provider_id().unwrap(), "provider-1");

        let unresolved =
            NookOAuthRemoteStorageReference::new(OAuthRemoteStorageReference::Unresolved);
        assert_eq!(
            unresolved.state(),
            NookOAuthRemoteStorageReferenceState::Unresolved
        );
        assert!(unresolved.value().is_err());
        let resolved = NookOAuthRemoteStorageReference::new(OAuthRemoteStorageReference::Resolved(
            "file-1".into(),
        ));
        assert_eq!(
            resolved.state(),
            NookOAuthRemoteStorageReferenceState::Resolved
        );
        assert_eq!(resolved.value().unwrap(), "file-1");

        let rejected =
            NookOAuthRemoteConfigurationUpdate::new(OAuthRemoteConfigurationUpdate::Unchanged);
        assert_eq!(
            rejected.state(),
            NookOAuthRemoteConfigurationUpdateState::Rejected
        );
        assert!(rejected.config().is_err());
        let updated = NookOAuthRemoteConfigurationUpdate::new(
            OAuthRemoteConfigurationUpdate::Updated(Box::new(config.clone())),
        );
        assert_eq!(
            updated.state(),
            NookOAuthRemoteConfigurationUpdateState::Updated
        );
        assert_eq!(updated.config().unwrap(), config);

        let incomplete = NookStagedStorageArgs::new(StagedStorageConnection::Incomplete);
        assert_eq!(incomplete.state(), NookStagedStorageArgsState::Incomplete);
        assert!(incomplete.args().is_err());
        let ready = NookStagedStorageArgs::new(StagedStorageConnection::Ready(
            nook_core::StorageConnectArgs::local(),
        ));
        assert_eq!(ready.state(), NookStagedStorageArgsState::Ready);
        assert!(ready.args().is_ok());

        assert_eq!(local_vault_storage_args().mode, "local");
        assert_eq!(draft_local_storage_args().mode, "local");
        let github_args = draft_github_storage_args("pat", "owner/repo");
        assert_eq!(github_args.mode, "github");
        assert_eq!(github_args.pat, "pat");
        assert_eq!(github_args.repo, "owner/repo");
        assert_eq!(draft_oauth_storage_args(config).mode, "google-drive");

        let no_hint = mask_github_pat_hint(nook_core::StoredGithubPat::Missing);
        assert_eq!(no_hint.state(), NookGithubPatHintState::Missing);
        assert!(no_hint.value().is_err());
        let hint = mask_github_pat_hint(nook_core::StoredGithubPat::Token(
            "ghp_1234567890ABCDEF".into(),
        ));
        assert_eq!(hint.state(), NookGithubPatHintState::Available);
        assert_eq!(hint.value().unwrap(), "ghp_123456…");
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn provider_state_wrappers_cover_typed_getters_and_storage_drafts() {
        let missing = nook_core::OAuthAccessToken::Missing;
        assert_eq!(missing, nook_core::OAuthAccessToken::Missing);
        assert_eq!(
            missing_oauth_access_token(),
            nook_core::OAuthAccessToken::Missing
        );

        let configured = nook_core::OAuthFileConfigData {
            access_token: nook_core::StoredOAuthAccessCredential::AccessToken(" token ".into()),
            file_id: nook_core::StoredOAuthRemoteFileId::FileId("file-1".into()),
            file_name: nook_core::StoredOAuthRemoteFileName::FileName("Vault.yaml".into()),
            ..Default::default()
        };
        let token = oauth_access_token(configured.clone());
        assert_eq!(
            token,
            nook_core::OAuthAccessToken::Available {
                token: "token".to_owned()
            }
        );

        let missing_selection = NookProviderSelection(ProviderSelection::Unavailable);
        assert_eq!(
            missing_selection.state(),
            NookProviderSelectionState::Missing
        );
        assert!(missing_selection.provider_id().is_err());
        let selected = NookProviderSelection(ProviderSelection::Selected("provider-1".into()));
        assert_eq!(selected.state(), NookProviderSelectionState::Selected);
        assert_eq!(selected.provider_id().unwrap(), "provider-1");

        let unresolved =
            NookOAuthRemoteStorageReference::new(OAuthRemoteStorageReference::Unresolved);
        assert_eq!(
            unresolved.state(),
            NookOAuthRemoteStorageReferenceState::Unresolved
        );
        assert!(unresolved.value().is_err());
        let resolved = NookOAuthRemoteStorageReference::new(OAuthRemoteStorageReference::Resolved(
            "file-1".into(),
        ));
        assert_eq!(
            resolved.state(),
            NookOAuthRemoteStorageReferenceState::Resolved
        );
        assert_eq!(resolved.value().unwrap(), "file-1");

        let rejected =
            NookOAuthRemoteConfigurationUpdate::new(OAuthRemoteConfigurationUpdate::Unchanged);
        assert_eq!(
            rejected.state(),
            NookOAuthRemoteConfigurationUpdateState::Rejected
        );
        assert!(rejected.config().is_err());
        let updated = NookOAuthRemoteConfigurationUpdate::new(Some(configured.clone()));
        assert_eq!(
            updated.state(),
            NookOAuthRemoteConfigurationUpdateState::Updated
        );
        assert_eq!(updated.config().unwrap().file_name, configured.file_name);

        let incomplete = NookStagedStorageArgs::new(StagedStorageConnection::Incomplete);
        assert_eq!(incomplete.state(), NookStagedStorageArgsState::Incomplete);
        assert!(incomplete.args().is_err());
        let ready = NookStagedStorageArgs::new(StagedStorageConnection::Ready(
            nook_core::StorageConnectArgs::local(),
        ));
        assert_eq!(ready.state(), NookStagedStorageArgsState::Ready);
        assert_eq!(ready.args().unwrap().mode, "local");

        let no_hint = mask_github_pat_hint(nook_core::StoredGithubPat::Missing);
        assert_eq!(no_hint.state(), NookGithubPatHintState::Missing);
        assert!(no_hint.value().is_err());
        let hint = mask_github_pat_hint(nook_core::StoredGithubPat::Token(
            "ghp_1234567890ABCDEF".into(),
        ));
        assert_eq!(hint.state(), NookGithubPatHintState::Available);
        assert_eq!(hint.value().unwrap(), "ghp_123456…");

        assert_eq!(local_vault_storage_args().mode, "local");
        assert_eq!(draft_local_storage_args().mode, "local");
        let github = draft_github_storage_args("pat", "owner/repo");
        assert_eq!(github.mode, "github");
        assert_eq!(github.pat, "pat");
        assert_eq!(github.repo, "owner/repo");
        let oauth = draft_oauth_storage_args(configured);
        assert_eq!(oauth.mode, "google-drive");
    }
}
