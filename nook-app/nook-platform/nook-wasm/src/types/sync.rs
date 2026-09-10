use super::{
    NookError, NookJoinRequest, NookSecretRecord, NookVaultManager, NookVaultMember, wasm_bindgen,
};
use nook_core::OnboardingType;
use nook_core::{
    EnrollmentProvider, EnrollmentProviderDataRef, PersonalEnrollmentProvider,
    PersonalEnrollmentProviderData, SharedEnrollmentProvider, SharedEnrollmentProviderData,
    StorageProviderType, SyncProviderTarget,
};
use wasm_bindgen::JsError;

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookEnrollmentProvider(nook_core::EnrollmentProvider);

#[wasm_bindgen]
impl NookEnrollmentProvider {
    #[wasm_bindgen]
    #[must_use]
    pub fn local() -> Self {
        Self(EnrollmentProvider::personal(
            PersonalEnrollmentProvider::local(),
        ))
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn github(repo: String, pat: String) -> Self {
        Self(EnrollmentProvider::personal(
            PersonalEnrollmentProvider::github(pat, repo),
        ))
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn shared_provider_grant(joiner_identity: String, storage_target_id: String) -> Self {
        Self(EnrollmentProvider::shared(
            SharedEnrollmentProvider::google_drive(joiner_identity, storage_target_id),
        ))
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn icloud_shared(storage_target_id: String) -> Self {
        Self(EnrollmentProvider::shared(
            SharedEnrollmentProvider::icloud(storage_target_id),
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
            EnrollmentProvider::PersonalCredentialTransfer(provider) => match provider.data() {
                PersonalEnrollmentProviderData::Local => StorageProviderType::Local,
                PersonalEnrollmentProviderData::Github { .. } => StorageProviderType::Github,
                PersonalEnrollmentProviderData::OauthFile { .. } => StorageProviderType::OauthFile,
            },
            EnrollmentProvider::SharedProviderGrant(_) => StorageProviderType::OauthFile,
        }
    }

    #[wasm_bindgen(getter, js_name = isSharedProviderGrant)]
    #[must_use]
    pub fn is_shared_provider_grant(&self) -> bool {
        matches!(self.0, EnrollmentProvider::SharedProviderGrant(_))
    }

    #[wasm_bindgen(getter, js_name = onboardingType)]
    #[must_use]
    pub fn onboarding_type(&self) -> nook_core::OnboardingType {
        OnboardingType::from_enrollment(&self.0)
    }

    #[wasm_bindgen(getter, js_name = githubPat)]
    pub fn github_pat(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.data() {
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::Github {
                pat,
                ..
            }) => Ok(pat.clone()),
            _ => Err(JsError::new("enrollment provider is not GitHub")),
        }
    }

    #[wasm_bindgen(getter, js_name = githubRepo)]
    pub fn github_repo(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.data() {
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::Github {
                repo,
                ..
            }) => Ok(repo.clone()),
            _ => Err(JsError::new("enrollment provider is not GitHub")),
        }
    }

    #[wasm_bindgen(getter, js_name = oauthPreset)]
    pub fn oauth_preset(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.data() {
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::OauthFile {
                preset,
                ..
            }) => Ok(preset.clone()),
            EnrollmentProviderDataRef::Shared(SharedEnrollmentProviderData::GoogleDrive {
                oauth_preset,
                ..
            }) => Ok(oauth_preset.clone()),
            EnrollmentProviderDataRef::Shared(SharedEnrollmentProviderData::ICloud { .. }) => {
                Ok("icloud".to_owned())
            }
            _ => Err(JsError::new("enrollment provider does not use OAuth")),
        }
    }

    #[wasm_bindgen(getter, js_name = oauthAccessToken)]
    pub fn oauth_access_token(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.data() {
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::OauthFile {
                access_token,
                ..
            }) => Ok(access_token.clone()),
            _ => Err(JsError::new(
                "enrollment provider does not carry an OAuth access token",
            )),
        }
    }

    #[wasm_bindgen(getter, js_name = sharedJoinerIdentityKind)]
    pub fn shared_joiner_identity_kind(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.data() {
            EnrollmentProviderDataRef::Shared(SharedEnrollmentProviderData::GoogleDrive {
                joiner_identity_kind,
                ..
            }) => Ok(joiner_identity_kind.clone()),
            _ => Err(JsError::new(
                "enrollment provider does not require a shared joiner identity",
            )),
        }
    }

    #[wasm_bindgen(getter, js_name = sharedJoinerIdentity)]
    pub fn shared_joiner_identity(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.data() {
            EnrollmentProviderDataRef::Shared(SharedEnrollmentProviderData::GoogleDrive {
                joiner_identity,
                ..
            }) => Ok(joiner_identity.clone()),
            _ => Err(JsError::new(
                "enrollment provider does not carry a shared joiner identity",
            )),
        }
    }

    #[wasm_bindgen(getter, js_name = sharedStorageTargetId)]
    pub fn shared_storage_target_id(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.data() {
            EnrollmentProviderDataRef::Shared(
                SharedEnrollmentProviderData::GoogleDrive {
                    storage_target_id, ..
                }
                | SharedEnrollmentProviderData::ICloud { storage_target_id },
            ) => Ok(storage_target_id.clone()),
            EnrollmentProviderDataRef::Personal(_) => Err(JsError::new(
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
        Self(SyncProviderTarget::Local)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn github(repo: String, pat: String) -> Self {
        Self(SyncProviderTarget::Github(nook_core::GithubSyncTarget {
            repo,
            pat,
        }))
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn empty() -> Self {
        Self(SyncProviderTarget::Empty)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn is_local(&self) -> bool {
        matches!(self.0, SyncProviderTarget::Local)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn is_local_folder(&self) -> bool {
        matches!(self.0, SyncProviderTarget::LocalFolder(_))
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn is_github(&self) -> bool {
        matches!(self.0, SyncProviderTarget::Github(_))
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn is_empty(&self) -> bool {
        matches!(self.0, SyncProviderTarget::Empty)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn is_oauth_file(&self) -> bool {
        matches!(self.0, SyncProviderTarget::OauthFile(_))
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

#[derive(Clone, Copy)]
enum VaultSyncAccessAssessment {
    NotAssessed,
    Assessed(nook_core::VaultAccessStatus),
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultSyncResult {
    changed: bool,
    access_status: VaultSyncAccessAssessment,
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
            VaultSyncAccessAssessment::NotAssessed => NookVaultSyncAccessState::NotAssessed,
            VaultSyncAccessAssessment::Assessed(_) => NookVaultSyncAccessState::Assessed,
        }
    }

    #[wasm_bindgen(getter, js_name = accessStatus)]
    pub fn access_status(&self) -> Result<nook_core::VaultAccessStatus, wasm_bindgen::JsError> {
        match self.access_status {
            VaultSyncAccessAssessment::NotAssessed => {
                Err(JsError::new("vault access was not assessed"))
            }
            VaultSyncAccessAssessment::Assessed(status) => Ok(status),
        }
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
            access_status: VaultSyncAccessAssessment::NotAssessed,
            secrets: Vec::new(),
            pending_joins: Vec::new(),
            vault_members: Vec::new(),
        }
    }

    pub(crate) fn with_access_status(status: nook_core::VaultAccessStatus) -> Self {
        Self {
            changed: true,
            access_status: VaultSyncAccessAssessment::Assessed(status),
            secrets: Vec::new(),
            pending_joins: Vec::new(),
            vault_members: Vec::new(),
        }
    }

    pub(crate) fn session(manager: &NookVaultManager, changed: bool) -> Result<Self, NookError> {
        Ok(Self {
            changed,
            access_status: VaultSyncAccessAssessment::NotAssessed,
            secrets: Vec::new(),
            pending_joins: manager.pending_joins().unwrap_or_default(),
            vault_members: manager.vault_members().unwrap_or_default(),
        })
    }
}

#[cfg(test)]
#[allow(unused_imports)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn enrollment_provider_projects_personal_and_shared_variants() -> Result<(), JsError> {
        use nook_core::{
            OAuthAccountIdentity, OAuthRefreshCredential, OAuthRemoteFile, OAuthTokenExpiry,
        };
        let local = NookEnrollmentProvider::local();
        assert_eq!(local.provider_type(), nook_core::StorageProviderType::Local);
        assert!(!local.is_shared_provider_grant());
        assert!(matches!(
            local.onboarding_type(),
            nook_core::OnboardingType::PersonalCredentialTransfer
        ));
        assert!(local.github_pat().is_err());

        let github = NookEnrollmentProvider::github("owner/repo".into(), "pat".into());
        assert_eq!(
            github.provider_type(),
            nook_core::StorageProviderType::Github
        );
        assert_eq!(github.github_repo()?, "owner/repo");
        assert_eq!(github.github_pat()?, "pat");
        assert!(github.oauth_preset().is_err());

        let oauth = NookEnrollmentProvider::from_core(EnrollmentProvider::personal(
            PersonalEnrollmentProvider::oauth_file(
                "google-drive".into(),
                "access-token".into(),
                OAuthRefreshCredential::Token("refresh-token".into()),
                OAuthTokenExpiry::ExpiresAt("2030-01-01".into()),
                OAuthRemoteFile::Identified {
                    file_id: "file-1".into(),
                    file_name: "vault.json".into(),
                },
                OAuthAccountIdentity::Email("owner@example.com".into()),
            ),
        ));
        assert_eq!(
            oauth.provider_type(),
            nook_core::StorageProviderType::OauthFile
        );
        assert_eq!(oauth.oauth_preset()?, "google-drive");
        assert_eq!(oauth.oauth_access_token()?, "access-token");
        let config = oauth.oauth_configuration(nook_core::OAuthFileConfigData::default())?;
        assert_eq!(
            config.refresh_token,
            nook_core::StoredOAuthRefreshCredential::Token(("refresh-token").to_owned())
        );
        assert_eq!(
            config.expires_at,
            nook_core::StoredOAuthTokenExpiry::ExpiresAt(("2030-01-01").to_owned())
        );
        assert_eq!(
            config.file_id,
            nook_core::StoredOAuthRemoteFileId::FileId(("file-1").to_owned())
        );
        assert_eq!(
            config.file_name,
            nook_core::StoredOAuthRemoteFileName::FileName(("vault.json").to_owned())
        );
        assert_eq!(
            config.account_email,
            nook_core::StoredOAuthAccountIdentity::Email(("owner@example.com").to_owned())
        );

        let drive =
            NookEnrollmentProvider::shared_provider_grant("joiner".into(), "folder-1".into());
        assert!(drive.is_shared_provider_grant());
        assert_eq!(drive.oauth_preset()?, "google-drive");
        assert_eq!(drive.shared_joiner_identity_kind()?, "email");
        assert_eq!(drive.shared_joiner_identity()?, "joiner");
        assert_eq!(drive.shared_storage_target_id()?, "folder-1");
        assert!(drive.oauth_access_token().is_err());

        let icloud = NookEnrollmentProvider::icloud_shared("share-1".into());
        assert_eq!(icloud.oauth_preset()?, "icloud");
        assert_eq!(icloud.shared_storage_target_id()?, "share-1");
        assert!(icloud.shared_joiner_identity().is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn enrollment_inputs_and_sync_targets_keep_typed_values() {
        let provider = NookEnrollmentProvider::github("repo".into(), "pat".into());
        let unnamed = NookEnrollmentIssueInput::unnamed(
            provider.clone(),
            "entry-1".into(),
            "2026-01-01".into(),
        );
        assert_eq!(unnamed.entry_id(), "entry-1");
        assert_eq!(unnamed.issued_at(), "2026-01-01");
        assert_eq!(unnamed.to_core().unwrap().vault_name, "");
        let named = NookEnrollmentIssueInput::named(
            provider,
            "Personal".into(),
            "entry-2".into(),
            "2026-01-02".into(),
        );
        assert_eq!(named.to_core().unwrap().vault_name, "Personal");

        let payload =
            NookDecryptedEnrollmentPayload::from_core(nook_core::DecryptedEnrollmentPayload {
                provider: NookEnrollmentProvider::local().to_core(),
                vault_name: "Vault".into(),
                entry_id: "entry-3".into(),
                issued_at: "2026-01-03".into(),
            });
        assert_eq!(payload.vault_name(), "Vault");
        assert_eq!(payload.entry_id(), "entry-3");
        assert_eq!(payload.issued_at(), "2026-01-03");
        assert!(matches!(
            payload.onboarding_type(),
            nook_core::OnboardingType::PersonalCredentialTransfer
        ));

        let local = NookSyncProviderTarget::local();
        assert!(local.is_local());
        assert!(!local.is_github() && !local.is_empty() && !local.is_oauth_file());
        let github = NookSyncProviderTarget::github("repo".into(), "pat".into());
        assert!(github.is_github());
        let empty = NookSyncProviderTarget::empty();
        assert!(empty.is_empty());
    }
}

#[wasm_bindgen]
impl NookEnrollmentProvider {
    pub fn oauth_configuration(
        &self,
        defaults: nook_core::OAuthFileConfigData,
    ) -> Result<nook_core::OAuthFileConfigData, JsError> {
        nook_core::EnrollmentOAuthConfigurationRequest {
            provider: &self.0,
            defaults,
        }
        .project()
        .map_err(|error| JsError::new(&error.to_string()))
    }
}
