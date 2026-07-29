use super::{NookStorageConnectArgs, wasm_bindgen};

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookOAuthAccessTokenKind {
    Missing,
    Available,
}

enum NookOAuthAccessTokenValue {
    Missing,
    Available(String),
}

#[wasm_bindgen]
pub struct NookOAuthAccessToken(NookOAuthAccessTokenValue);

#[wasm_bindgen]
impl NookOAuthAccessToken {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub const fn kind(&self) -> NookOAuthAccessTokenKind {
        match self.0 {
            NookOAuthAccessTokenValue::Missing => NookOAuthAccessTokenKind::Missing,
            NookOAuthAccessTokenValue::Available(_) => NookOAuthAccessTokenKind::Available,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn token(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            NookOAuthAccessTokenValue::Missing => {
                Err(wasm_bindgen::JsError::new("OAuth access token is missing"))
            }
            NookOAuthAccessTokenValue::Available(token) => Ok(token.clone()),
        }
    }
}

#[wasm_bindgen(js_name = oauthAccessToken)]
#[allow(clippy::needless_pass_by_value)]
#[must_use]
pub fn oauth_access_token(config: nook_core::OAuthFileConfigData) -> NookOAuthAccessToken {
    match config.usable_access_token() {
        nook_core::OAuthAccessTokenRef::Missing => {
            NookOAuthAccessToken(NookOAuthAccessTokenValue::Missing)
        }
        nook_core::OAuthAccessTokenRef::Available(token) => {
            NookOAuthAccessToken(NookOAuthAccessTokenValue::Available(token.to_owned()))
        }
    }
}

#[wasm_bindgen(js_name = missingOAuthAccessToken)]
#[must_use]
pub const fn missing_oauth_access_token() -> NookOAuthAccessToken {
    NookOAuthAccessToken(NookOAuthAccessTokenValue::Missing)
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookProviderSelectionState {
    Missing,
    Selected,
}

#[wasm_bindgen]
pub struct NookProviderSelection(pub(super) Option<String>);

#[wasm_bindgen]
impl NookProviderSelection {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookProviderSelectionState {
        if self.0.is_some() {
            NookProviderSelectionState::Selected
        } else {
            NookProviderSelectionState::Missing
        }
    }

    #[wasm_bindgen(getter, js_name = providerId)]
    pub fn provider_id(&self) -> Result<String, wasm_bindgen::JsError> {
        self.0
            .clone()
            .ok_or_else(|| wasm_bindgen::JsError::new("provider selection is missing"))
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookOAuthRemoteStorageReferenceState {
    Unresolved,
    Resolved,
}

#[wasm_bindgen]
pub struct NookOAuthRemoteStorageReference(Option<String>);

#[wasm_bindgen]
impl NookOAuthRemoteStorageReference {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookOAuthRemoteStorageReferenceState {
        if self.0.is_some() {
            NookOAuthRemoteStorageReferenceState::Resolved
        } else {
            NookOAuthRemoteStorageReferenceState::Unresolved
        }
    }

    #[wasm_bindgen(getter)]
    pub fn value(&self) -> Result<String, wasm_bindgen::JsError> {
        self.0
            .clone()
            .ok_or_else(|| wasm_bindgen::JsError::new("OAuth remote storage is unresolved"))
    }
}

impl NookOAuthRemoteStorageReference {
    pub(super) const fn new(value: Option<String>) -> Self {
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
pub struct NookOAuthRemoteConfigurationUpdate(Option<nook_core::OAuthFileConfigData>);

#[wasm_bindgen]
impl NookOAuthRemoteConfigurationUpdate {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookOAuthRemoteConfigurationUpdateState {
        if self.0.is_some() {
            NookOAuthRemoteConfigurationUpdateState::Updated
        } else {
            NookOAuthRemoteConfigurationUpdateState::Rejected
        }
    }

    #[wasm_bindgen(getter)]
    pub fn config(&self) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
        self.0
            .clone()
            .ok_or_else(|| wasm_bindgen::JsError::new("OAuth remote reference was rejected"))
    }
}

impl NookOAuthRemoteConfigurationUpdate {
    pub(super) const fn new(value: Option<nook_core::OAuthFileConfigData>) -> Self {
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
pub struct NookStagedStorageArgs(Option<nook_core::StorageConnectArgs>);

#[wasm_bindgen]
impl NookStagedStorageArgs {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookStagedStorageArgsState {
        if self.0.is_some() {
            NookStagedStorageArgsState::Ready
        } else {
            NookStagedStorageArgsState::Incomplete
        }
    }

    #[wasm_bindgen(getter)]
    pub fn args(&self) -> Result<NookStorageConnectArgs, wasm_bindgen::JsError> {
        self.0
            .clone()
            .map(Into::into)
            .ok_or_else(|| wasm_bindgen::JsError::new("staged storage is incomplete"))
    }
}

impl NookStagedStorageArgs {
    pub(super) const fn new(value: Option<nook_core::StorageConnectArgs>) -> Self {
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
pub struct NookGithubPatHint(Option<String>);

#[wasm_bindgen]
impl NookGithubPatHint {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookGithubPatHintState {
        if self.0.is_some() {
            NookGithubPatHintState::Available
        } else {
            NookGithubPatHintState::Missing
        }
    }

    #[wasm_bindgen(getter)]
    pub fn value(&self) -> Result<String, wasm_bindgen::JsError> {
        self.0
            .clone()
            .ok_or_else(|| wasm_bindgen::JsError::new("GitHub PAT hint is unavailable"))
    }
}

impl NookGithubPatHint {
    pub(super) const fn new(value: Option<String>) -> Self {
        Self(value)
    }
}

#[wasm_bindgen(js_name = localVaultStorageArgs)]
#[must_use]
pub fn local_vault_storage_args() -> NookStorageConnectArgs {
    nook_core::StorageConnectArgs::local().into()
}

#[wasm_bindgen(js_name = authenticatedVaultStorageArgs)]
#[allow(clippy::needless_pass_by_value)]
pub fn authenticated_vault_storage_args(
    provider: nook_core::StorageProviderData,
) -> Result<NookStorageConnectArgs, wasm_bindgen::JsError> {
    Ok(nook_core::storage_args_for_provider(&provider)?.into())
}

#[wasm_bindgen(js_name = draftGithubStorageArgs)]
#[must_use]
pub fn draft_github_storage_args(github_pat: &str, github_repo: &str) -> NookStorageConnectArgs {
    nook_core::draft_storage_args(
        nook_core::StorageProviderType::Github,
        Some(github_pat),
        Some(github_repo),
        None,
        None,
        None,
        None,
    )
    .into()
}

#[wasm_bindgen(js_name = draftOauthStorageArgs)]
#[allow(clippy::needless_pass_by_value)]
#[must_use]
pub fn draft_oauth_storage_args(config: nook_core::OAuthFileConfigData) -> NookStorageConnectArgs {
    let remote_ref = nook_core::oauth_remote_storage_ref(&config);
    nook_core::draft_storage_args(
        nook_core::StorageProviderType::OauthFile,
        None,
        None,
        Some(config.preset),
        config.access_token.as_deref(),
        remote_ref.as_deref(),
        config.file_name.as_deref(),
    )
    .into()
}

#[wasm_bindgen(js_name = draftLocalStorageArgs)]
#[must_use]
pub fn draft_local_storage_args() -> NookStorageConnectArgs {
    nook_core::draft_storage_args(
        nook_core::StorageProviderType::Local,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .into()
}

/// Return a masked GitHub PAT hint without exposing the full credential.
#[wasm_bindgen(js_name = maskGithubPatHint)]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn mask_github_pat_hint(pat: nook_core::StoredGithubPat) -> NookGithubPatHint {
    NookGithubPatHint::new(
        match nook_core::mask_github_pat(pat.as_deref().unwrap_or_default()) {
            nook_core::GithubPatMask::NoToken => None,
            nook_core::GithubPatMask::Hint(hint) => Some(hint),
        },
    )
}
