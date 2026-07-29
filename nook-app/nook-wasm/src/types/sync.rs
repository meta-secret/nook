use super::{
    NookError, NookJoinRequest, NookSecretListItem, NookSecretRecord, NookStringValue,
    NookStringValueRef, NookVaultManager, NookVaultMember, wasm_bindgen,
};

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookEnrollmentProvider(nook_core::EnrollmentProvider);

#[wasm_bindgen]
impl NookEnrollmentProvider {
    #[wasm_bindgen(js_name = local)]
    #[must_use]
    pub fn local() -> Self {
        Self(nook_core::EnrollmentProvider::personal(
            nook_core::PersonalEnrollmentProvider::local(),
        ))
    }

    #[wasm_bindgen(js_name = github)]
    #[must_use]
    pub fn github(repo: String, pat: String) -> Self {
        Self(nook_core::EnrollmentProvider::personal(
            nook_core::PersonalEnrollmentProvider::github(pat, repo),
        ))
    }

    #[wasm_bindgen(js_name = oauthFile)]
    #[must_use]
    #[allow(clippy::needless_pass_by_value, clippy::too_many_arguments)]
    pub fn oauth_file(
        preset: String,
        access_token: String,
        refresh_token: NookStringValue,
        expires_at: NookStringValue,
        file_id: NookStringValue,
        file_name: NookStringValue,
        account_email: NookStringValue,
    ) -> Self {
        Self(nook_core::EnrollmentProvider::personal(
            nook_core::PersonalEnrollmentProvider::oauth_file(
                preset,
                access_token,
                match refresh_token.as_ref() {
                    NookStringValueRef::Value(value) => {
                        nook_core::OAuthRefreshCredential::Token(value.to_owned())
                    }
                    NookStringValueRef::Unavailable => nook_core::OAuthRefreshCredential::NotIssued,
                },
                match expires_at.as_ref() {
                    NookStringValueRef::Value(value) => {
                        nook_core::OAuthTokenExpiry::ExpiresAt(value.to_owned())
                    }
                    NookStringValueRef::Unavailable => nook_core::OAuthTokenExpiry::Unknown,
                },
                match (file_id.as_ref(), file_name.as_ref()) {
                    (NookStringValueRef::Value(file_id), NookStringValueRef::Value(file_name)) => {
                        nook_core::OAuthRemoteFile::Identified {
                            file_id: file_id.to_owned(),
                            file_name: file_name.to_owned(),
                        }
                    }
                    (NookStringValueRef::Value(file_id), NookStringValueRef::Unavailable) => {
                        nook_core::OAuthRemoteFile::FileId {
                            file_id: file_id.to_owned(),
                        }
                    }
                    (NookStringValueRef::Unavailable, NookStringValueRef::Value(file_name)) => {
                        nook_core::OAuthRemoteFile::FileName {
                            file_name: file_name.to_owned(),
                        }
                    }
                    (NookStringValueRef::Unavailable, NookStringValueRef::Unavailable) => {
                        nook_core::OAuthRemoteFile::Unresolved
                    }
                },
                match account_email.as_ref() {
                    NookStringValueRef::Value(value) => {
                        nook_core::OAuthAccountIdentity::Email(value.to_owned())
                    }
                    NookStringValueRef::Unavailable => nook_core::OAuthAccountIdentity::Unknown,
                },
            ),
        ))
    }

    #[wasm_bindgen(js_name = sharedProviderGrant)]
    #[must_use]
    pub fn shared_provider_grant(joiner_identity: String, storage_target_id: String) -> Self {
        Self(nook_core::EnrollmentProvider::shared(
            nook_core::SharedEnrollmentProvider::google_drive(joiner_identity, storage_target_id),
        ))
    }

    #[wasm_bindgen(js_name = iCloudShared)]
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
    pub fn github_pat(&self) -> NookStringValue {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Personal(
                nook_core::PersonalEnrollmentProviderData::Github { pat, .. },
            ) => NookStringValue::from_value(pat),
            _ => NookStringValue::unavailable(),
        }
    }

    #[wasm_bindgen(getter, js_name = githubRepo)]
    pub fn github_repo(&self) -> NookStringValue {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Personal(
                nook_core::PersonalEnrollmentProviderData::Github { repo, .. },
            ) => NookStringValue::from_value(repo),
            _ => NookStringValue::unavailable(),
        }
    }

    #[wasm_bindgen(getter, js_name = oauthPreset)]
    pub fn oauth_preset(&self) -> NookStringValue {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Personal(
                nook_core::PersonalEnrollmentProviderData::OauthFile { preset, .. },
            ) => NookStringValue::from_value(preset),
            nook_core::EnrollmentProviderDataRef::Shared(
                nook_core::SharedEnrollmentProviderData::GoogleDrive { oauth_preset, .. },
            ) => NookStringValue::from_value(oauth_preset),
            nook_core::EnrollmentProviderDataRef::Shared(
                nook_core::SharedEnrollmentProviderData::ICloud { .. },
            ) => NookStringValue::from_value("icloud"),
            _ => NookStringValue::unavailable(),
        }
    }

    #[wasm_bindgen(getter, js_name = oauthAccessToken)]
    pub fn oauth_access_token(&self) -> NookStringValue {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Personal(
                nook_core::PersonalEnrollmentProviderData::OauthFile { access_token, .. },
            ) => NookStringValue::from_value(access_token),
            _ => NookStringValue::unavailable(),
        }
    }

    #[wasm_bindgen(getter, js_name = oauthRefreshToken)]
    pub fn oauth_refresh_token(&self) -> NookStringValue {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Personal(
                nook_core::PersonalEnrollmentProviderData::OauthFile { refresh, .. },
            ) => match refresh {
                nook_core::OAuthRefreshCredential::Token(value) => {
                    NookStringValue::from_value(value)
                }
                nook_core::OAuthRefreshCredential::NotIssued => NookStringValue::unavailable(),
            },
            _ => NookStringValue::unavailable(),
        }
    }

    #[wasm_bindgen(getter, js_name = oauthExpiresAt)]
    pub fn oauth_expires_at(&self) -> NookStringValue {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Personal(
                nook_core::PersonalEnrollmentProviderData::OauthFile { expiry, .. },
            ) => match expiry {
                nook_core::OAuthTokenExpiry::ExpiresAt(value) => NookStringValue::from_value(value),
                nook_core::OAuthTokenExpiry::Unknown => NookStringValue::unavailable(),
            },
            _ => NookStringValue::unavailable(),
        }
    }

    #[wasm_bindgen(getter, js_name = oauthFileId)]
    pub fn oauth_file_id(&self) -> NookStringValue {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Personal(
                nook_core::PersonalEnrollmentProviderData::OauthFile { remote_file, .. },
            ) => match remote_file {
                nook_core::OAuthRemoteFile::FileId { file_id }
                | nook_core::OAuthRemoteFile::Identified { file_id, .. } => {
                    NookStringValue::from_value(file_id)
                }
                nook_core::OAuthRemoteFile::Unresolved
                | nook_core::OAuthRemoteFile::FileName { .. } => NookStringValue::unavailable(),
            },
            _ => NookStringValue::unavailable(),
        }
    }

    #[wasm_bindgen(getter, js_name = oauthFileName)]
    pub fn oauth_file_name(&self) -> NookStringValue {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Personal(
                nook_core::PersonalEnrollmentProviderData::OauthFile { remote_file, .. },
            ) => match remote_file {
                nook_core::OAuthRemoteFile::FileName { file_name }
                | nook_core::OAuthRemoteFile::Identified { file_name, .. } => {
                    NookStringValue::from_value(file_name)
                }
                nook_core::OAuthRemoteFile::Unresolved
                | nook_core::OAuthRemoteFile::FileId { .. } => NookStringValue::unavailable(),
            },
            _ => NookStringValue::unavailable(),
        }
    }

    #[wasm_bindgen(getter, js_name = oauthAccountEmail)]
    pub fn oauth_account_email(&self) -> NookStringValue {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Personal(
                nook_core::PersonalEnrollmentProviderData::OauthFile { account, .. },
            ) => match account {
                nook_core::OAuthAccountIdentity::Email(value) => NookStringValue::from_value(value),
                nook_core::OAuthAccountIdentity::Unknown => NookStringValue::unavailable(),
            },
            _ => NookStringValue::unavailable(),
        }
    }

    #[wasm_bindgen(getter, js_name = sharedJoinerIdentityKind)]
    pub fn shared_joiner_identity_kind(&self) -> NookStringValue {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Shared(
                nook_core::SharedEnrollmentProviderData::GoogleDrive {
                    joiner_identity_kind,
                    ..
                },
            ) => NookStringValue::from_value(joiner_identity_kind),
            _ => NookStringValue::unavailable(),
        }
    }

    #[wasm_bindgen(getter, js_name = sharedJoinerIdentity)]
    pub fn shared_joiner_identity(&self) -> NookStringValue {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Shared(
                nook_core::SharedEnrollmentProviderData::GoogleDrive {
                    joiner_identity, ..
                },
            ) => NookStringValue::from_value(joiner_identity),
            _ => NookStringValue::unavailable(),
        }
    }

    #[wasm_bindgen(getter, js_name = sharedStorageTargetId)]
    pub fn shared_storage_target_id(&self) -> NookStringValue {
        match self.0.data() {
            nook_core::EnrollmentProviderDataRef::Shared(
                nook_core::SharedEnrollmentProviderData::GoogleDrive {
                    storage_target_id, ..
                }
                | nook_core::SharedEnrollmentProviderData::ICloud { storage_target_id },
            ) => NookStringValue::from_value(storage_target_id),
            nook_core::EnrollmentProviderDataRef::Personal(_) => NookStringValue::unavailable(),
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
    #[wasm_bindgen(js_name = local)]
    #[must_use]
    pub fn local() -> Self {
        Self(nook_core::SyncProviderTarget::Local)
    }

    #[wasm_bindgen(js_name = localFolder)]
    #[must_use]
    pub fn local_folder(directory_name: Option<String>, handle_id: Option<String>) -> Self {
        Self(nook_core::SyncProviderTarget::LocalFolder(
            nook_core::LocalFolderSyncTarget {
                directory_name,
                handle_id,
            },
        ))
    }

    #[wasm_bindgen(js_name = github)]
    #[must_use]
    pub fn github(repo: String, pat: String) -> Self {
        Self(nook_core::SyncProviderTarget::Github(
            nook_core::GithubSyncTarget { repo, pat },
        ))
    }

    #[wasm_bindgen(js_name = empty)]
    #[must_use]
    pub fn empty() -> Self {
        Self(nook_core::SyncProviderTarget::Empty)
    }

    #[wasm_bindgen(js_name = oauthFile)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn oauth_file(
        preset: Option<String>,
        file_id: Option<String>,
        file_name: Option<String>,
        account_email: Option<String>,
        access_token: Option<String>,
        folder_id: Option<String>,
    ) -> Result<NookSyncProviderTarget, wasm_bindgen::JsError> {
        let preset = preset
            .as_deref()
            .map(nook_core::OauthFilePreset::parse)
            .transpose()?
            .unwrap_or(nook_core::OauthFilePreset::GoogleDrive);
        Ok(Self(nook_core::SyncProviderTarget::OauthFile(
            nook_core::OauthFileSyncTarget {
                preset,
                file_id,
                folder_id,
                file_name,
                account_email,
                access_token,
            },
        )))
    }

    #[wasm_bindgen(js_name = isLocal)]
    #[must_use]
    pub fn is_local(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::Local)
    }

    #[wasm_bindgen(js_name = isLocalFolder)]
    #[must_use]
    pub fn is_local_folder(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::LocalFolder(_))
    }

    #[wasm_bindgen(js_name = isGithub)]
    #[must_use]
    pub fn is_github(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::Github(_))
    }

    #[wasm_bindgen(js_name = isEmpty)]
    #[must_use]
    pub fn is_empty(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::Empty)
    }

    #[wasm_bindgen(js_name = isOauthFile)]
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
    #[wasm_bindgen(constructor)]
    pub fn new(
        provider: NookEnrollmentProvider,
        vault_name: &NookStringValue,
        entry_id: String,
        issued_at: String,
    ) -> Self {
        Self {
            provider,
            vault_name: match vault_name.as_ref() {
                NookStringValueRef::Unavailable => String::new(),
                NookStringValueRef::Value(name) => name.to_owned(),
            },
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
impl NookVaultSyncResult {
    #[wasm_bindgen(getter)]
    pub fn changed(&self) -> bool {
        self.changed
    }

    #[wasm_bindgen(getter, js_name = accessStatus)]
    pub fn access_status(&self) -> Option<nook_core::VaultAccessStatus> {
        self.access_status
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

#[wasm_bindgen]
pub struct NookSecretPage {
    items: Vec<NookSecretListItem>,
    total: u32,
    offset: u32,
    limit: u32,
}

impl NookSecretPage {
    pub(crate) fn from_core(page: nook_core::SecretPage) -> Result<Self, NookError> {
        Ok(Self {
            items: list_items_to_vec(page.records),
            total: u32::try_from(page.total).unwrap_or(u32::MAX),
            offset: u32::try_from(page.offset).unwrap_or(u32::MAX),
            limit: u32::try_from(page.limit).unwrap_or(u32::MAX),
        })
    }
}

#[wasm_bindgen]
impl NookSecretPage {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn total(&self) -> u32 {
        self.total
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn offset(&self) -> u32 {
        self.offset
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn limit(&self) -> u32 {
        self.limit
    }

    /// Transfer page-owned metadata items to JavaScript without cloning them.
    #[wasm_bindgen(js_name = takeItems)]
    pub fn take_items(&mut self) -> Vec<NookSecretListItem> {
        std::mem::take(&mut self.items)
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookImportResult {
    imported: u32,
    skipped_unsupported: u32,
    skipped_duplicates: u32,
}

#[wasm_bindgen]
impl NookImportResult {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn imported(&self) -> u32 {
        self.imported
    }

    #[wasm_bindgen(getter, js_name = skippedUnsupported)]
    #[must_use]
    pub fn skipped_unsupported(&self) -> u32 {
        self.skipped_unsupported
    }

    #[wasm_bindgen(getter, js_name = skippedDuplicates)]
    #[must_use]
    pub fn skipped_duplicates(&self) -> u32 {
        self.skipped_duplicates
    }

    pub(crate) fn new(
        imported: usize,
        skipped_unsupported: usize,
        skipped_duplicates: usize,
    ) -> Self {
        Self {
            imported: u32::try_from(imported).unwrap_or(u32::MAX),
            skipped_unsupported: u32::try_from(skipped_unsupported).unwrap_or(u32::MAX),
            skipped_duplicates: u32::try_from(skipped_duplicates).unwrap_or(u32::MAX),
        }
    }
}

/// Variant-specific form payload for `buildSecretYaml`.
#[wasm_bindgen]
pub struct NookSecretFormFields {
    pub(crate) inner: nook_core::SecretFormFields,
}

#[wasm_bindgen]
impl NookSecretFormFields {
    #[wasm_bindgen(js_name = login)]
    pub fn login(website_url: String, username: String, password: String, notes: String) -> Self {
        Self {
            inner: nook_core::SecretFormFields::Login(nook_core::LoginSecretForm {
                website_url,
                username,
                password,
                notes,
            }),
        }
    }

    #[wasm_bindgen(js_name = apiKey)]
    pub fn api_key(website_url: String, key: String, expires_at: String) -> Self {
        Self {
            inner: nook_core::SecretFormFields::ApiKey(nook_core::ApiKeySecretForm {
                website_url,
                key,
                expires_at,
            }),
        }
    }

    #[wasm_bindgen(js_name = seedPhrase)]
    pub fn seed_phrase(name: String, seed: String) -> Self {
        Self {
            inner: nook_core::SecretFormFields::SeedPhrase(nook_core::SeedPhraseSecretForm {
                name,
                seed,
            }),
        }
    }

    #[wasm_bindgen(js_name = secureNote)]
    pub fn secure_note(title: String, note: String) -> Self {
        Self {
            inner: nook_core::SecretFormFields::SecureNote(nook_core::SecureNoteSecretForm {
                title,
                note,
            }),
        }
    }

    #[wasm_bindgen(js_name = authenticator)]
    #[allow(clippy::too_many_arguments)]
    pub fn authenticator(
        issuer: String,
        account: String,
        website_url: String,
        totp_secret: String,
        algorithm: String,
        digits: String,
        period: String,
        backup_codes: String,
    ) -> Self {
        Self {
            inner: nook_core::SecretFormFields::Authenticator(nook_core::AuthenticatorSecretForm {
                issuer,
                account,
                website_url,
                totp_secret,
                algorithm,
                digits,
                period,
                backup_codes,
            }),
        }
    }

    #[wasm_bindgen(js_name = creditCard)]
    #[allow(clippy::too_many_arguments)]
    pub fn credit_card(
        title: String,
        cardholder_name: String,
        number: String,
        expiration_month: String,
        expiration_year: String,
        cvv: String,
        notes: String,
    ) -> Self {
        Self {
            inner: nook_core::SecretFormFields::CreditCard(nook_core::CreditCardSecretForm {
                title,
                cardholder_name,
                number,
                expiration_month,
                expiration_year,
                cvv,
                notes,
            }),
        }
    }

    #[wasm_bindgen(js_name = fileAttachment)]
    pub fn file_attachment(
        title: String,
        file_name: String,
        mime_type: String,
        size_bytes: u32,
        content_base64: String,
    ) -> Self {
        Self {
            inner: nook_core::SecretFormFields::FileAttachment(
                nook_core::FileAttachmentSecretForm {
                    title,
                    file_name,
                    mime_type,
                    size_bytes: u64::from(size_bytes),
                    content_base64,
                },
            ),
        }
    }
}

#[wasm_bindgen]
pub struct NookTotpCode {
    code: String,
    seconds_remaining: u32,
    period: u32,
    expires_at_unix_seconds: f64,
}

#[wasm_bindgen]
impl NookTotpCode {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn code(&self) -> String {
        self.code.clone()
    }

    #[wasm_bindgen(getter, js_name = secondsRemaining)]
    #[must_use]
    pub fn seconds_remaining(&self) -> u32 {
        self.seconds_remaining
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn period(&self) -> u32 {
        self.period
    }

    #[wasm_bindgen(getter, js_name = expiresAtUnixSeconds)]
    #[must_use]
    pub fn expires_at_unix_seconds(&self) -> f64 {
        self.expires_at_unix_seconds
    }

    #[allow(clippy::cast_precision_loss)]
    pub(crate) fn from_core(value: nook_core::TotpCode, unix_seconds: u64) -> Self {
        let seconds_remaining = u32::try_from(value.seconds_remaining).unwrap_or(u32::MAX);
        Self {
            code: value.code,
            seconds_remaining,
            period: u32::try_from(value.period).unwrap_or(u32::MAX),
            expires_at_unix_seconds: unix_seconds as f64 + f64::from(seconds_remaining),
        }
    }
}

impl Drop for NookTotpCode {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.code.zeroize();
    }
}

pub(crate) fn records_to_vec(
    records: Vec<nook_core::SecretRecord>,
) -> Result<Vec<NookSecretRecord>, NookError> {
    Ok(records
        .into_iter()
        .map(NookSecretRecord::from_record)
        .collect())
}

pub(crate) fn list_items_to_vec(items: Vec<nook_core::SecretListItem>) -> Vec<NookSecretListItem> {
    let group_keys = nook_core::resolve_entity_group_keys(&items);
    items
        .into_iter()
        .zip(group_keys)
        .map(|(item, group_key)| NookSecretListItem::from_core(item, group_key))
        .collect()
}

pub(crate) fn joins_to_vec(joins: Vec<nook_core::JoinRequest>) -> Vec<NookJoinRequest> {
    joins.into_iter().map(NookJoinRequest::from_core).collect()
}

pub(crate) fn members_to_vec(members: Vec<nook_core::VaultMember>) -> Vec<NookVaultMember> {
    members
        .into_iter()
        .map(NookVaultMember::from_core)
        .collect()
}
