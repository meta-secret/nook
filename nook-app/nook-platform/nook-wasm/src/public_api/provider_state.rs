use super::{NookStorageConnectArgs, wasm_bindgen};
use nook_core::GithubPat;
use nook_core::OAuthAccessToken;
use nook_core::StoredGithubPat;
use nook_core::StoredGithubRepository;
use nook_core::StoredOAuthRemoteFileName;
use nook_core::{
    ActiveProviderCredentialsProjection, ExistingVaultProviderReadiness, GithubPatMask,
    StorageConnectArgs, StoredLocalFolderConfiguration, StoredOAuthFileConfiguration,
};
use nook_core::{
    DraftStorageConnection, GithubStorageDraft, OAuthRemoteConfigurationUpdate,
    OAuthRemoteStorageReference, OAuthStorageDraft, ProviderSaveSetup, ProviderSelection,
    StagedStorageConnection,
};
use tsify::Tsify;
use wasm_bindgen::JsError;

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookActiveProviderCredentialsProjectionState {
    Unchanged,
    Apply,
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn active_provider_credentials_projection_state(
    projection: &tsify::Ts<nook_core::ActiveProviderCredentialsProjection>,
) -> Result<NookActiveProviderCredentialsProjectionState, wasm_bindgen::JsError> {
    let projection = projection
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;
    let result = {
        match projection {
            ActiveProviderCredentialsProjection::Unchanged => {
                NookActiveProviderCredentialsProjectionState::Unchanged
            }
            ActiveProviderCredentialsProjection::Apply(_) => {
                NookActiveProviderCredentialsProjectionState::Apply
            }
        }
    };
    Ok(result)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn active_provider_credentials_projection_draft(
    projection: &tsify::Ts<nook_core::ActiveProviderCredentialsProjection>,
) -> Result<tsify::Ts<nook_core::ActiveProviderCredentialDraft>, wasm_bindgen::JsError> {
    let projection = projection
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let result = match projection {
        ActiveProviderCredentialsProjection::Unchanged => Err(JsError::new(
            "active provider credentials projection is unchanged",
        )),
        ActiveProviderCredentialsProjection::Apply(draft) => Ok(*draft),
    }?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookStoredOAuthFileConfigurationState {
    NotApplicable,
    Configured,
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn stored_oauth_file_configuration_state(
    configuration: &tsify::Ts<nook_core::StoredOAuthFileConfiguration>,
) -> Result<NookStoredOAuthFileConfigurationState, wasm_bindgen::JsError> {
    let configuration = configuration
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;
    let result = {
        match configuration {
            StoredOAuthFileConfiguration::NotApplicable => {
                NookStoredOAuthFileConfigurationState::NotApplicable
            }
            StoredOAuthFileConfiguration::Configured(_) => {
                NookStoredOAuthFileConfigurationState::Configured
            }
        }
    };
    Ok(result)
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookStoredLocalFolderConfigurationState {
    NotApplicable,
    Configured,
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn stored_local_folder_configuration_state(
    configuration: &tsify::Ts<nook_core::StoredLocalFolderConfiguration>,
) -> Result<NookStoredLocalFolderConfigurationState, wasm_bindgen::JsError> {
    let configuration = configuration
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;
    let result = {
        match configuration {
            StoredLocalFolderConfiguration::NotApplicable => {
                NookStoredLocalFolderConfigurationState::NotApplicable
            }
            StoredLocalFolderConfiguration::Configured(_) => {
                NookStoredLocalFolderConfigurationState::Configured
            }
        }
    };
    Ok(result)
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
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn existing_vault_provider_readiness(
    provider_type: &tsify::Ts<nook_core::StorageProviderType>,
    oauth_file_configured: bool,
    local_folder_configured: bool,
) -> Result<NookExistingVaultProviderReadiness, wasm_bindgen::JsError> {
    let provider_type = provider_type
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;
    let result = {
        provider_type
            .readiness(oauth_file_configured, local_folder_configured)
            .into()
    };
    Ok(result)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn oauth_access_token(
    config: &tsify::Ts<nook_core::OAuthFileConfigData>,
) -> Result<tsify::Ts<nook_core::OAuthAccessToken>, wasm_bindgen::JsError> {
    let config = config
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;

    let result = { config.usable_access_token().into() };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn missing_oauth_access_token()
-> Result<tsify::Ts<nook_core::OAuthAccessToken>, wasm_bindgen::JsError> {
    let result = { OAuthAccessToken::Missing };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
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
    pub fn config(
        &self,
    ) -> Result<tsify::Ts<nook_core::OAuthFileConfigData>, wasm_bindgen::JsError> {
        let result = match &self.0 {
            OAuthRemoteConfigurationUpdate::Updated(value) => Ok((**value).clone()),
            OAuthRemoteConfigurationUpdate::Unchanged => {
                Err(JsError::new("OAuth remote reference was rejected"))
            }
        }?;
        Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
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
    pub fn args(&self) -> Result<tsify::Ts<NookStorageConnectArgs>, wasm_bindgen::JsError> {
        let result = match &self.0 {
            StagedStorageConnection::Ready(args) => Ok(args.clone()),
            StagedStorageConnection::Incomplete => {
                Err(JsError::new("staged storage is incomplete"))
            }
        }?;
        Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
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
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn local_vault_storage_args() -> Result<tsify::Ts<NookStorageConnectArgs>, wasm_bindgen::JsError>
{
    let result = { StorageConnectArgs::local() };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authenticated_vault_storage_args(
    provider: &tsify::Ts<nook_core::StorageProviderData>,
) -> Result<tsify::Ts<NookStorageConnectArgs>, wasm_bindgen::JsError> {
    let provider = provider
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;

    let result = Ok::<_, wasm_bindgen::JsError>(provider.connection_args()?)?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

#[wasm_bindgen]

#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn draft_github_storage_args(github_pat: &str,
github_repo: &str) -> Result<tsify::Ts<NookStorageConnectArgs>, wasm_bindgen::JsError> {

let result = {
    DraftStorageConnection::Github(GithubStorageDraft {
        credential: &StoredGithubPat::Token(github_pat.to_owned()),
        repository: &StoredGithubRepository::Repository(github_repo.to_owned()),
    })
    .project()
};
Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn draft_oauth_storage_args(
    config: &tsify::Ts<nook_core::OAuthFileConfigData>,

    setup: &tsify::Ts<ProviderSaveSetup>,
) -> Result<tsify::Ts<NookStorageConnectArgs>, wasm_bindgen::JsError> {
    let config = config
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;

    let setup = setup
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        let config = config.with_provider_save_setup(setup);
        DraftStorageConnection::OAuth(OAuthStorageDraft {
            preset: config.preset,
            credential: &config.access_token,
            remote_reference: config.remote_storage_ref(),
            file_name: &config.file_name,
            alternate_name: &StoredOAuthRemoteFileName::Unresolved,
        })
        .project()
    };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn draft_local_storage_args() -> Result<tsify::Ts<NookStorageConnectArgs>, wasm_bindgen::JsError>
{
    let result = { DraftStorageConnection::Local.project() };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

/// Return a masked GitHub PAT hint without exposing the full credential.
#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn mask_github_pat_hint(
    pat: &tsify::Ts<nook_core::StoredGithubPat>,
) -> Result<NookGithubPatHint, wasm_bindgen::JsError> {
    let pat = pat
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        NookGithubPatHint::new(match pat {
            StoredGithubPat::Missing => GithubPatMask::NoToken,
            StoredGithubPat::Token(pat) => GithubPat::mask(&pat),
        })
    };
    Ok(result)
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_core::ActiveProviderCredentialsProjection;
    use nook_core::LocalFolderConfigData;
    use nook_core::OAuthAccessToken;
    use nook_core::OAuthFileConfigData;
    use nook_core::StorageConnectArgs;
    use nook_core::StorageProviderType;
    use nook_core::StoredGithubPat;
    use nook_core::StoredOAuthAccessCredential;
    use tsify::Tsify;
    use wasm_bindgen::JsError;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn provider_state_wrappers_project_success_and_rejection_variants() -> Result<(), JsError> {
        let draft = nook_core::ActiveProviderCredentialDraft {
            storage_mode: StorageProviderType::Github,
            github_pat: "pat".into(),
            github_repo: "owner/repo".into(),
            oauth_file: StoredOAuthFileConfiguration::NotApplicable,
            local_folder: StoredLocalFolderConfiguration::NotApplicable,
        };
        assert_eq!(
            active_provider_credentials_projection_state(&Tsify::into_ts(
                &(ActiveProviderCredentialsProjection::Unchanged)
            )?)?,
            NookActiveProviderCredentialsProjectionState::Unchanged
        );
        assert_eq!(
            active_provider_credentials_projection_state(&Tsify::into_ts(
                &(ActiveProviderCredentialsProjection::Apply(Box::new(draft.clone())))
            )?)?,
            NookActiveProviderCredentialsProjectionState::Apply
        );
        assert!(
            active_provider_credentials_projection_draft(&Tsify::into_ts(
                &(ActiveProviderCredentialsProjection::Unchanged)
            )?)
            .and_then(|value| value
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded.")))
            .is_err()
        );
        let projected = active_provider_credentials_projection_draft(&Tsify::into_ts(
            &(ActiveProviderCredentialsProjection::Apply(Box::new(draft))),
        )?)
        .and_then(|value| {
            value
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded."))
        })?;
        assert_eq!(projected.github_repo, "owner/repo");

        assert_eq!(
            stored_oauth_file_configuration_state(&Tsify::into_ts(
                &(StoredOAuthFileConfiguration::NotApplicable)
            )?)?,
            NookStoredOAuthFileConfigurationState::NotApplicable
        );
        assert_eq!(
            stored_oauth_file_configuration_state(&Tsify::into_ts(
                &(StoredOAuthFileConfiguration::configured(OAuthFileConfigData::default(),))
            )?)?,
            NookStoredOAuthFileConfigurationState::Configured
        );
        assert_eq!(
            stored_local_folder_configuration_state(&Tsify::into_ts(
                &(StoredLocalFolderConfiguration::NotApplicable)
            )?)?,
            NookStoredLocalFolderConfigurationState::NotApplicable
        );
        assert_eq!(
            stored_local_folder_configuration_state(&Tsify::into_ts(
                &(StoredLocalFolderConfiguration::Configured(LocalFolderConfigData::default(),))
            )?)?,
            NookStoredLocalFolderConfigurationState::Configured
        );
        assert_eq!(
            existing_vault_provider_readiness(
                &Tsify::into_ts(&(StorageProviderType::OauthFile))?,
                false,
                false
            )?,
            NookExistingVaultProviderReadiness::MissingOauthFile
        );
        assert_eq!(
            existing_vault_provider_readiness(
                &Tsify::into_ts(&(StorageProviderType::LocalFolder))?,
                false,
                false
            )?,
            NookExistingVaultProviderReadiness::MissingLocalFolder
        );
        assert_eq!(
            existing_vault_provider_readiness(
                &Tsify::into_ts(&(StorageProviderType::Github))?,
                false,
                false
            )?,
            NookExistingVaultProviderReadiness::Ready
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn provider_state_values_keep_secret_boundaries_and_defaults() -> Result<(), JsError> {
        let missing: serde_json::Value =
            serde_wasm_bindgen::from_value(missing_oauth_access_token()?.js_value())?;
        assert_eq!(missing, serde_json::to_value(OAuthAccessToken::Missing)?);
        let mut config = OAuthFileConfigData::default();
        config.access_token = StoredOAuthAccessCredential::AccessToken(" token ".into());
        let available: serde_json::Value = serde_wasm_bindgen::from_value(
            oauth_access_token(&Tsify::into_ts(&(config.clone()))?)?.js_value(),
        )?;
        assert_eq!(
            available,
            serde_json::to_value(OAuthAccessToken::Available {
                token: "token".to_owned()
            })?
        );

        let missing_selection = NookProviderSelection(ProviderSelection::Unavailable);
        assert_eq!(
            missing_selection.state(),
            NookProviderSelectionState::Missing
        );
        assert!(missing_selection.provider_id().is_err());
        let selected = NookProviderSelection(ProviderSelection::Selected("provider-1".into()));
        assert_eq!(selected.state(), NookProviderSelectionState::Selected);
        assert_eq!(selected.provider_id()?, "provider-1");

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
        assert_eq!(resolved.value()?, "file-1");

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
        assert_eq!(
            updated
                .config()?
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded."))?,
            config
        );

        let incomplete = NookStagedStorageArgs::new(StagedStorageConnection::Incomplete);
        assert_eq!(incomplete.state(), NookStagedStorageArgsState::Incomplete);
        assert!(incomplete.args().is_err());
        let ready =
            NookStagedStorageArgs::new(StagedStorageConnection::Ready(StorageConnectArgs::local()));
        assert_eq!(ready.state(), NookStagedStorageArgsState::Ready);
        assert!(ready.args().is_ok());

        assert_eq!(
            local_vault_storage_args()
                .and_then(|value| value
                    .to_rust()
                    .map_err(|_| JsError::new("Typed test output could not be decoded.")))?
                .mode,
            "local"
        );
        assert_eq!(
            draft_local_storage_args()
                .and_then(|value| value
                    .to_rust()
                    .map_err(|_| JsError::new("Typed test output could not be decoded.")))?
                .mode,
            "local"
        );
        let github_args = draft_github_storage_args("pat", "owner/repo").and_then(|value| {
            value
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded."))
        })?;
        assert_eq!(github_args.mode, "github");
        assert_eq!(github_args.pat, "pat");
        assert_eq!(github_args.repo, "owner/repo");
        assert_eq!(
            draft_oauth_storage_args(
                &Tsify::into_ts(&(config))?,
                &Tsify::into_ts(&(ProviderSaveSetup::Existing))?
            )
            .and_then(|value| value
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded.")))?
            .mode,
            "google-drive"
        );

        let no_hint = mask_github_pat_hint(&Tsify::into_ts(&(StoredGithubPat::Missing))?)?;
        assert_eq!(no_hint.state(), NookGithubPatHintState::Missing);
        assert!(no_hint.value().is_err());
        let hint = mask_github_pat_hint(&Tsify::into_ts(
            &(StoredGithubPat::Token("ghp_1234567890ABCDEF".into())),
        )?)?;
        assert_eq!(hint.state(), NookGithubPatHintState::Available);
        assert_eq!(hint.value()?, "ghp_123456…");
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use crate::public_api;
    use nook_core::OAuthAccessToken;
    use nook_core::OauthFilePreset;
    use nook_core::StorageConnectArgs;
    use nook_core::StorageProviderType;
    use nook_core::StoredGithubPat;
    use nook_core::StoredGoogleDrivePrivateTarget;
    use nook_core::StoredOAuthAccessCredential;
    use nook_core::StoredOAuthRemoteFileId;
    use nook_core::StoredOAuthRemoteFileName;
    use tsify::Tsify;
    use wasm_bindgen::JsError;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn provider_state_wrappers_cover_typed_getters_and_storage_drafts() -> Result<(), JsError> {
        let missing = OAuthAccessToken::Missing;
        assert_eq!(missing, OAuthAccessToken::Missing);
        assert_eq!(
            serde_wasm_bindgen::from_value::<serde_json::Value>(
                missing_oauth_access_token()?.js_value()
            )?,
            serde_json::to_value(OAuthAccessToken::Missing)?
        );

        let configured = nook_core::OAuthFileConfigData {
            access_token: StoredOAuthAccessCredential::AccessToken(" token ".into()),
            file_id: StoredOAuthRemoteFileId::FileId("file-1".into()),
            file_name: StoredOAuthRemoteFileName::FileName("Vault.yaml".into()),
            ..Default::default()
        };
        let token: serde_json::Value = serde_wasm_bindgen::from_value(
            oauth_access_token(&Tsify::into_ts(&(configured.clone()))?)?.js_value(),
        )?;
        assert_eq!(
            token,
            serde_json::to_value(OAuthAccessToken::Available {
                token: "token".to_owned()
            })?
        );

        let missing_selection = NookProviderSelection(ProviderSelection::Unavailable);
        assert_eq!(
            missing_selection.state(),
            NookProviderSelectionState::Missing
        );
        assert!(missing_selection.provider_id().is_err());
        let selected = NookProviderSelection(ProviderSelection::Selected("provider-1".into()));
        assert_eq!(selected.state(), NookProviderSelectionState::Selected);
        assert_eq!(selected.provider_id()?, "provider-1");

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
        assert_eq!(resolved.value()?, "file-1");

        let rejected =
            NookOAuthRemoteConfigurationUpdate::new(OAuthRemoteConfigurationUpdate::Unchanged);
        assert_eq!(
            rejected.state(),
            NookOAuthRemoteConfigurationUpdateState::Rejected
        );
        assert!(rejected.config().is_err());
        let updated = NookOAuthRemoteConfigurationUpdate::new(
            OAuthRemoteConfigurationUpdate::Updated(Box::new(configured.clone())),
        );
        assert_eq!(
            updated.state(),
            NookOAuthRemoteConfigurationUpdateState::Updated
        );
        assert_eq!(
            updated
                .config()?
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded."))?
                .file_name,
            configured.file_name
        );

        let incomplete = NookStagedStorageArgs::new(StagedStorageConnection::Incomplete);
        assert_eq!(incomplete.state(), NookStagedStorageArgsState::Incomplete);
        assert!(incomplete.args().is_err());
        let ready =
            NookStagedStorageArgs::new(StagedStorageConnection::Ready(StorageConnectArgs::local()));
        assert_eq!(ready.state(), NookStagedStorageArgsState::Ready);
        assert_eq!(
            ready
                .args()?
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded."))?
                .mode,
            "local"
        );

        let no_hint = mask_github_pat_hint(&Tsify::into_ts(&(StoredGithubPat::Missing))?)?;
        assert_eq!(no_hint.state(), NookGithubPatHintState::Missing);
        assert!(no_hint.value().is_err());
        let hint = mask_github_pat_hint(&Tsify::into_ts(
            &(StoredGithubPat::Token("ghp_1234567890ABCDEF".into())),
        )?)?;
        assert_eq!(hint.state(), NookGithubPatHintState::Available);
        assert_eq!(hint.value()?, "ghp_123456…");

        assert_eq!(
            local_vault_storage_args()
                .and_then(|value| value
                    .to_rust()
                    .map_err(|_| JsError::new("Typed test output could not be decoded.")))?
                .mode,
            "local"
        );
        assert_eq!(
            draft_local_storage_args()
                .and_then(|value| value
                    .to_rust()
                    .map_err(|_| JsError::new("Typed test output could not be decoded.")))?
                .mode,
            "local"
        );
        let github = draft_github_storage_args("pat", "owner/repo").and_then(|value| {
            value
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded."))
        })?;
        assert_eq!(github.mode, "github");
        assert_eq!(github.pat, "pat");
        assert_eq!(github.repo, "owner/repo");
        let oauth = draft_oauth_storage_args(
            &Tsify::into_ts(&(configured.clone()))?,
            &Tsify::into_ts(&(ProviderSaveSetup::Existing))?,
        )
        .and_then(|value| {
            value
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded."))
        })?;
        assert_eq!(oauth.mode, "google-drive");

        let new_provider_setup = ProviderSaveSetup::New(StorageProviderType::OauthFile);
        let new_private = nook_core::OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: StoredOAuthAccessCredential::AccessToken("token".into()),
            file_id: StoredOAuthRemoteFileId::FileId("old-file-id".into()),
            file_name: StoredOAuthRemoteFileName::FileName("Vault.yaml".into()),
            ..Default::default()
        };
        let draft_args = draft_oauth_storage_args(
            &Tsify::into_ts(&(new_private.clone()))?,
            &Tsify::into_ts(&(new_provider_setup))?,
        )
        .and_then(|value| {
            value
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded."))
        })?;
        assert_eq!(draft_args.repo, "private-folder-v2:pending\tVault.yaml");
        let staged_args = public_api::staged_oauth_remote_storage_args(
            &Tsify::into_ts(&(new_private.clone()))?,
            &Tsify::into_ts(&(new_provider_setup))?,
        )?;
        assert_eq!(
            staged_args
                .args()?
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded."))?
                .repo,
            "private-folder-v2:pending\tVault.yaml"
        );
        let updated_new_provider = public_api::update_oauth_remote_ref(
            &Tsify::into_ts(&(new_private.clone()))?,
            &Tsify::into_ts(&(new_provider_setup))?,
            "private-folder-v2:stable-folder-id",
        )?;
        let updated_config = updated_new_provider
            .config()?
            .to_rust()
            .map_err(|_| JsError::new("Typed test output could not be decoded."))?;
        assert_eq!(
            updated_config.drive_private_target,
            StoredGoogleDrivePrivateTarget::FolderId("stable-folder-id".into())
        );
        assert_eq!(
            updated_config.file_id,
            StoredOAuthRemoteFileId::FileId("old-file-id".into())
        );

        let updated_existing_provider = public_api::update_oauth_remote_ref(
            &Tsify::into_ts(&(new_private.clone()))?,
            &Tsify::into_ts(&(ProviderSaveSetup::Existing))?,
            "file-1",
        )?;
        let updated_existing_config = updated_existing_provider
            .config()?
            .to_rust()
            .map_err(|_| JsError::new("Typed test output could not be decoded."))?;
        assert_eq!(
            updated_existing_config.drive_private_target,
            StoredGoogleDrivePrivateTarget::LegacyAppDataFolder
        );
        assert_eq!(
            updated_existing_config.file_id,
            StoredOAuthRemoteFileId::FileId("file-1".into())
        );

        let existing_staged = public_api::staged_oauth_remote_storage_args(
            &Tsify::into_ts(&(new_private))?,
            &Tsify::into_ts(&(ProviderSaveSetup::Existing))?,
        )?;
        assert_eq!(
            existing_staged
                .args()?
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded."))?
                .repo,
            "old-file-id\tVault.yaml"
        );
        Ok(())
    }
}
