use super::{
    NookError, NookJoinRequest, NookOAuthAccountIdentity, NookOAuthRefreshCredential,
    NookOAuthRemoteFile, NookOAuthTokenExpiry, NookSecretRecord, NookVaultManager, NookVaultMember,
    wasm_bindgen,
};

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookEnrollmentProvider(nook_core::EnrollmentProvider);

#[wasm_bindgen]
impl NookEnrollmentProvider {
    #[wasm_bindgen]
    #[must_use]
    pub fn local() -> Self {
        Self(nook_core::EnrollmentProvider::personal(
            nook_core::PersonalEnrollmentProvider::local(),
        ))
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn github(repo: String, pat: String) -> Self {
        Self(nook_core::EnrollmentProvider::personal(
            nook_core::PersonalEnrollmentProvider::github(pat, repo),
        ))
    }

    #[wasm_bindgen]
    #[must_use]
    #[allow(clippy::needless_pass_by_value, clippy::too_many_arguments)]
    pub fn oauth_file(
        preset: String,
        access_token: String,
        refresh: NookOAuthRefreshCredential,
        expiry: NookOAuthTokenExpiry,
        remote_file: NookOAuthRemoteFile,
        account: NookOAuthAccountIdentity,
    ) -> Self {
        Self(nook_core::EnrollmentProvider::personal(
            nook_core::PersonalEnrollmentProvider::oauth_file(
                preset,
                access_token,
                refresh.0,
                expiry.0,
                remote_file.0,
                account.0,
            ),
        ))
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn shared_provider_grant(joiner_identity: String, storage_target_id: String) -> Self {
        Self(nook_core::EnrollmentProvider::shared(
            nook_core::SharedEnrollmentProvider::google_drive(joiner_identity, storage_target_id),
        ))
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn icloud_shared(storage_target_id: String) -> Self {
        Self(nook_core::EnrollmentProvider::shared(
            nook_core::SharedEnrollmentProvider::icloud(storage_target_id),
        ))
    }

    pub(crate) fn from_core(provider: nook_core::EnrollmentProvider) -> Self {
        Self(provider)
    }

    pub(crate) fn to_core(&self) -> nook_core::EnrollmentProvider {
        self.0.clone()
    }

    #[wasm_bindgen(getter, js_name = "type")]
    #[must_use]
    pub fn provider_type(&self) -> nook_core::StorageProviderType {
        match &self.0 {
            nook_core::EnrollmentProvider::PersonalCredentialTransfer(provider) => {
                match provider.data() {
                    nook_core::PersonalEnrollmentProviderData::Local => {
                        nook_core::StorageProviderType::Local
                    }
                    nook_core::PersonalEnrollmentProviderData::Github { .. } => {
                        nook_core::StorageProviderType::Github
                    }
                    nook_core::PersonalEnrollmentProviderData::OauthFile { .. } => {
                        nook_core::StorageProviderType::OauthFile
                    }
                }
            }
            nook_core::EnrollmentProvider::SharedProviderGrant(_) => {
                nook_core::StorageProviderType::OauthFile
            }
        }
    }

    #[wasm_bindgen(getter, js_name = isSharedProviderGrant)]
    #[must_use]
    pub fn is_shared_provider_grant(&self) -> bool {
        matches!(
            self.0,
            nook_core::EnrollmentProvider::SharedProviderGrant(_)
        )
    }

    #[wasm_bindgen(getter, js_name = onboardingType)]
    #[must_use]
    pub fn onboarding_type(&self) -> nook_core::OnboardingType {
        nook_core::enrollment_provider_onboarding_type(&self.0)
    }

    #[wasm_bindgen(getter, js_name = githubPat)]
    pub fn github_pat(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Personal(
                nook_core::PersonalEnrollmentProviderData::Github { pat, .. },
            ) => Ok(pat.clone()),
            _ => Err(wasm_bindgen::JsError::new(
                "enrollment provider is not GitHub",
            )),
        }
    }

    #[wasm_bindgen(getter, js_name = githubRepo)]
    pub fn github_repo(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Personal(
                nook_core::PersonalEnrollmentProviderData::Github { repo, .. },
            ) => Ok(repo.clone()),
            _ => Err(wasm_bindgen::JsError::new(
                "enrollment provider is not GitHub",
            )),
        }
    }

    #[wasm_bindgen(getter, js_name = oauthPreset)]
    pub fn oauth_preset(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Personal(
                nook_core::PersonalEnrollmentProviderData::OauthFile { preset, .. },
            ) => Ok(preset.clone()),
            nook_core::EnrollmentProviderDataRef::Shared(
                nook_core::SharedEnrollmentProviderData::GoogleDrive { oauth_preset, .. },
            ) => Ok(oauth_preset.clone()),
            nook_core::EnrollmentProviderDataRef::Shared(
                nook_core::SharedEnrollmentProviderData::ICloud { .. },
            ) => Ok("icloud".to_owned()),
            _ => Err(wasm_bindgen::JsError::new(
                "enrollment provider does not use OAuth",
            )),
        }
    }

    #[wasm_bindgen(getter, js_name = oauthAccessToken)]
    pub fn oauth_access_token(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Personal(
                nook_core::PersonalEnrollmentProviderData::OauthFile { access_token, .. },
            ) => Ok(access_token.clone()),
            _ => Err(wasm_bindgen::JsError::new(
                "enrollment provider does not carry an OAuth access token",
            )),
        }
    }

    #[wasm_bindgen(getter, js_name = oauthRefresh)]
    pub fn oauth_refresh(&self) -> Result<NookOAuthRefreshCredential, wasm_bindgen::JsError> {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Personal(
                nook_core::PersonalEnrollmentProviderData::OauthFile { refresh, .. },
            ) => Ok(NookOAuthRefreshCredential(refresh.clone())),
            _ => Err(wasm_bindgen::JsError::new(
                "enrollment provider does not carry OAuth refresh state",
            )),
        }
    }

    #[wasm_bindgen(getter, js_name = oauthExpiry)]
    pub fn oauth_expiry(&self) -> Result<NookOAuthTokenExpiry, wasm_bindgen::JsError> {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Personal(
                nook_core::PersonalEnrollmentProviderData::OauthFile { expiry, .. },
            ) => Ok(NookOAuthTokenExpiry(expiry.clone())),
            _ => Err(wasm_bindgen::JsError::new(
                "enrollment provider does not carry OAuth expiry state",
            )),
        }
    }

    #[wasm_bindgen(getter, js_name = oauthRemoteFile)]
    pub fn oauth_remote_file(&self) -> Result<NookOAuthRemoteFile, wasm_bindgen::JsError> {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Personal(
                nook_core::PersonalEnrollmentProviderData::OauthFile { remote_file, .. },
            ) => Ok(NookOAuthRemoteFile(remote_file.clone())),
            _ => Err(wasm_bindgen::JsError::new(
                "enrollment provider does not carry OAuth remote-file state",
            )),
        }
    }

    #[wasm_bindgen(getter, js_name = oauthAccount)]
    pub fn oauth_account(&self) -> Result<NookOAuthAccountIdentity, wasm_bindgen::JsError> {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Personal(
                nook_core::PersonalEnrollmentProviderData::OauthFile { account, .. },
            ) => Ok(NookOAuthAccountIdentity(account.clone())),
            _ => Err(wasm_bindgen::JsError::new(
                "enrollment provider does not carry OAuth account identity",
            )),
        }
    }

    #[wasm_bindgen(getter, js_name = sharedJoinerIdentityKind)]
    pub fn shared_joiner_identity_kind(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Shared(
                nook_core::SharedEnrollmentProviderData::GoogleDrive {
                    joiner_identity_kind,
                    ..
                },
            ) => Ok(joiner_identity_kind.clone()),
            _ => Err(wasm_bindgen::JsError::new(
                "enrollment provider does not require a shared joiner identity",
            )),
        }
    }

    #[wasm_bindgen(getter, js_name = sharedJoinerIdentity)]
    pub fn shared_joiner_identity(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Shared(
                nook_core::SharedEnrollmentProviderData::GoogleDrive {
                    joiner_identity, ..
                },
            ) => Ok(joiner_identity.clone()),
            _ => Err(wasm_bindgen::JsError::new(
                "enrollment provider does not carry a shared joiner identity",
            )),
        }
    }

    #[wasm_bindgen(getter, js_name = sharedStorageTargetId)]
    pub fn shared_storage_target_id(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Shared(
                nook_core::SharedEnrollmentProviderData::GoogleDrive {
                    storage_target_id, ..
                }
                | nook_core::SharedEnrollmentProviderData::ICloud { storage_target_id },
            ) => Ok(storage_target_id.clone()),
            nook_core::EnrollmentProviderDataRef::Personal(_) => Err(wasm_bindgen::JsError::new(
                "enrollment provider is not a shared provider grant",
            )),
        }
    }
}

/// Thin wasm newtype wrapper over the core `SyncProviderTarget` enum. Construct
/// via the variant constructors; read via `is_*` / `as_*` accessors.
#[wasm_bindgen]
#[derive(Clone)]
pub struct NookSyncProviderTarget(nook_core::SyncProviderTarget);

#[wasm_bindgen]
impl NookSyncProviderTarget {
    #[wasm_bindgen]
    #[must_use]
    pub fn local() -> Self {
        Self(nook_core::SyncProviderTarget::Local)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn github(repo: String, pat: String) -> Self {
        Self(nook_core::SyncProviderTarget::Github(
            nook_core::GithubSyncTarget { repo, pat },
        ))
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn empty() -> Self {
        Self(nook_core::SyncProviderTarget::Empty)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn is_local(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::Local)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn is_local_folder(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::LocalFolder(_))
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn is_github(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::Github(_))
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn is_empty(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::Empty)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn is_oauth_file(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::OauthFile(_))
    }
}

impl From<nook_core::SyncProviderTarget> for NookSyncProviderTarget {
    fn from(target: nook_core::SyncProviderTarget) -> Self {
        Self(target)
    }
}

#[wasm_bindgen]
pub struct NookEnrollmentIssueInput {
    provider: NookEnrollmentProvider,
    vault_name: String,
    entry_id: String,
    issued_at: String,
}

#[wasm_bindgen]
impl NookEnrollmentIssueInput {
    #[wasm_bindgen]
    pub fn unnamed(provider: NookEnrollmentProvider, entry_id: String, issued_at: String) -> Self {
        Self {
            provider,
            vault_name: String::new(),
            entry_id,
            issued_at,
        }
    }

    #[wasm_bindgen]
    pub fn named(
        provider: NookEnrollmentProvider,
        vault_name: String,
        entry_id: String,
        issued_at: String,
    ) -> Self {
        Self {
            provider,
            vault_name,
            entry_id,
            issued_at,
        }
    }

    pub(crate) fn to_core(
        &self,
    ) -> Result<nook_core::EnrollmentIssueInput, nook_core::EnrollmentError> {
        Ok(nook_core::EnrollmentIssueInput {
            provider: self.provider.to_core(),
            vault_name: self.vault_name.clone(),
            entry_id: self.entry_id.clone(),
            issued_at: self.issued_at.clone(),
        })
    }

    #[wasm_bindgen(getter)]
    pub fn provider(&self) -> NookEnrollmentProvider {
        self.provider.clone()
    }

    #[wasm_bindgen(getter, js_name = entryId)]
    pub fn entry_id(&self) -> String {
        self.entry_id.clone()
    }

    #[wasm_bindgen(getter, js_name = issuedAt)]
    pub fn issued_at(&self) -> String {
        self.issued_at.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookDecryptedEnrollmentPayload {
    provider: NookEnrollmentProvider,
    vault_name: String,
    entry_id: String,
    issued_at: String,
}

#[wasm_bindgen]
impl NookDecryptedEnrollmentPayload {
    pub(crate) fn from_core(payload: nook_core::DecryptedEnrollmentPayload) -> Self {
        Self {
            provider: NookEnrollmentProvider::from_core(payload.provider),
            vault_name: payload.vault_name,
            entry_id: payload.entry_id,
            issued_at: payload.issued_at,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn provider(&self) -> NookEnrollmentProvider {
        self.provider.clone()
    }

    #[wasm_bindgen(getter, js_name = vaultName)]
    pub fn vault_name(&self) -> String {
        self.vault_name.clone()
    }

    #[wasm_bindgen(getter, js_name = onboardingType)]
    #[must_use]
    pub fn onboarding_type(&self) -> nook_core::OnboardingType {
        self.provider.onboarding_type()
    }

    #[wasm_bindgen(getter, js_name = entryId)]
    pub fn entry_id(&self) -> String {
        self.entry_id.clone()
    }

    #[wasm_bindgen(getter, js_name = issuedAt)]
    pub fn issued_at(&self) -> String {
        self.issued_at.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultSyncResult {
    changed: bool,
    access_status: Option<nook_core::VaultAccessStatus>,
    secrets: Vec<NookSecretRecord>,
    pending_joins: Vec<NookJoinRequest>,
    vault_members: Vec<NookVaultMember>,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookVaultSyncAccessState {
    NotAssessed,
    Assessed,
}

#[wasm_bindgen]
impl NookVaultSyncResult {
    #[wasm_bindgen(getter)]
    pub fn changed(&self) -> bool {
        self.changed
    }

    #[wasm_bindgen(getter, js_name = accessState)]
    pub fn access_state(&self) -> NookVaultSyncAccessState {
        match self.access_status {
            None => NookVaultSyncAccessState::NotAssessed,
            Some(_) => NookVaultSyncAccessState::Assessed,
        }
    }

    #[wasm_bindgen(getter, js_name = accessStatus)]
    pub fn access_status(&self) -> Result<nook_core::VaultAccessStatus, wasm_bindgen::JsError> {
        self.access_status
            .ok_or_else(|| wasm_bindgen::JsError::new("vault access was not assessed"))
    }

    #[wasm_bindgen(getter)]
    pub fn secrets(&self) -> Vec<NookSecretRecord> {
        self.secrets.clone()
    }

    #[wasm_bindgen(getter, js_name = pendingJoins)]
    pub fn pending_joins(&self) -> Vec<NookJoinRequest> {
        self.pending_joins.clone()
    }

    #[wasm_bindgen(getter, js_name = vaultMembers)]
    pub fn vault_members(&self) -> Vec<NookVaultMember> {
        self.vault_members.clone()
    }

    pub(crate) fn unchanged() -> Self {
        Self {
            changed: false,
            access_status: None,
            secrets: Vec::new(),
            pending_joins: Vec::new(),
            vault_members: Vec::new(),
        }
    }

    pub(crate) fn with_access_status(status: nook_core::VaultAccessStatus) -> Self {
        Self {
            changed: true,
            access_status: Some(status),
            secrets: Vec::new(),
            pending_joins: Vec::new(),
            vault_members: Vec::new(),
        }
    }

    pub(crate) fn session(manager: &NookVaultManager, changed: bool) -> Result<Self, NookError> {
        Ok(Self {
            changed,
            access_status: None,
            secrets: Vec::new(),
            pending_joins: manager.pending_joins().unwrap_or_default(),
            vault_members: manager.vault_members().unwrap_or_default(),
        })
    }
}
