use super::{
    NookError, NookJoinRequest, NookSecretRecord, NookVaultManager, NookVaultMember, wasm_bindgen,
};
use crate::TypedOutput;
use nook_core::OnboardingType;
use nook_core::{
    EnrollmentProvider, EnrollmentProviderDataRef, OAuthFileEnrollment, OAuthFilePreset,
    PersonalEnrollmentProvider, PersonalEnrollmentProviderData, ProviderDraft, ProviderKind,
    ProviderSecretText, SharedEnrollmentProvider, SharedEnrollmentProviderData,
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

    /// A blank token is refused with its validation key.
    #[wasm_bindgen]
    pub fn github(repo: String, pat: String) -> Result<Self, wasm_bindgen::JsError> {
        Ok(Self(EnrollmentProvider::personal(
            PersonalEnrollmentProvider::github(ProviderSecretText::try_from(pat)?, repo),
        )))
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
    pub fn icloud_shared(joiner_identity: String, storage_target_id: String) -> Self {
        Self(EnrollmentProvider::shared(
            SharedEnrollmentProvider::icloud(joiner_identity, storage_target_id),
        ))
    }

    pub(crate) fn from_core(provider: nook_core::EnrollmentProvider) -> Self {
        Self(provider)
    }

    pub(crate) fn to_core(&self) -> nook_core::EnrollmentProvider {
        self.0.clone()
    }

    #[wasm_bindgen(getter, js_name = "type")]

    pub fn provider_type(&self) -> Result<tsify::Ts<ProviderKind>, wasm_bindgen::JsError> {
        let result = match self.0.data() {
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::Local) => {
                ProviderKind::Local
            }
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::Github {
                ..
            }) => ProviderKind::Github,
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::OauthFile(
                OAuthFileEnrollment::GoogleDrive { .. },
            ))
            | EnrollmentProviderDataRef::Shared(SharedEnrollmentProviderData::GoogleDrive {
                ..
            }) => ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive),
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::OauthFile(
                OAuthFileEnrollment::ICloud { .. },
            ))
            | EnrollmentProviderDataRef::Shared(SharedEnrollmentProviderData::ICloud { .. }) => {
                ProviderKind::OauthFile(OAuthFilePreset::ICloud)
            }
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::S3(_)) => {
                ProviderKind::S3
            }
        };
        Ok(result.encode()?)
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
            }) => Ok(pat.expose().to_owned()),
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

    /// The S3 connection a joiner saves from an invite carrying one: the
    /// inviter's location and key, validated again field by field.
    #[wasm_bindgen(getter, js_name = s3Configuration)]
    pub fn s3_configuration(
        &self,
    ) -> Result<tsify::Ts<nook_core::S3Connection>, wasm_bindgen::JsError> {
        let connection = nook_core::S3Connection::try_from(&self.0)?;
        Ok(connection.encode()?)
    }

    /// The draft the invite gives the joiner: the provider complete for a
    /// personal code, the shared target awaiting the joiner's own sign-in
    /// for a grant.
    #[wasm_bindgen]
    pub fn provider_draft(&self) -> Result<tsify::Ts<ProviderDraft>, wasm_bindgen::JsError> {
        let draft = ProviderDraft::try_from(&self.0)?;
        Ok(draft.encode()?)
    }

    #[wasm_bindgen(getter, js_name = oauthPreset)]
    pub fn oauth_preset(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.data() {
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::OauthFile(
                OAuthFileEnrollment::GoogleDrive { .. },
            ))
            | EnrollmentProviderDataRef::Shared(SharedEnrollmentProviderData::GoogleDrive {
                ..
            }) => Ok(OAuthFilePreset::GoogleDrive.as_str().to_owned()),
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::OauthFile(
                OAuthFileEnrollment::ICloud { .. },
            ))
            | EnrollmentProviderDataRef::Shared(SharedEnrollmentProviderData::ICloud { .. }) => {
                Ok(OAuthFilePreset::ICloud.as_str().to_owned())
            }
            EnrollmentProviderDataRef::Personal(
                PersonalEnrollmentProviderData::Local
                | PersonalEnrollmentProviderData::Github { .. }
                | PersonalEnrollmentProviderData::S3(_),
            ) => Err(JsError::new("enrollment provider does not use OAuth")),
        }
    }

    #[wasm_bindgen(getter, js_name = oauthAccessToken)]
    pub fn oauth_access_token(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.data() {
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::OauthFile(
                OAuthFileEnrollment::GoogleDrive { access_token, .. },
            )) => Ok(access_token.expose().to_owned()),
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::OauthFile(
                OAuthFileEnrollment::ICloud { web_auth_token, .. },
            )) => Ok(web_auth_token.expose().to_owned()),
            EnrollmentProviderDataRef::Personal(
                PersonalEnrollmentProviderData::Local
                | PersonalEnrollmentProviderData::Github { .. }
                | PersonalEnrollmentProviderData::S3(_),
            )
            | EnrollmentProviderDataRef::Shared(_) => Err(JsError::new(
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
            EnrollmentProviderDataRef::Shared(
                SharedEnrollmentProviderData::GoogleDrive {
                    joiner_identity, ..
                }
                | SharedEnrollmentProviderData::ICloud {
                    joiner_identity, ..
                },
            ) => Ok(joiner_identity.clone()),
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
                | SharedEnrollmentProviderData::ICloud {
                    storage_target_id, ..
                },
            ) => Ok(storage_target_id.clone()),
            EnrollmentProviderDataRef::Personal(_) => Err(JsError::new(
                "enrollment provider is not a shared provider grant",
            )),
        }
    }
}

#[wasm_bindgen]
pub struct NookEnrollmentIssueInput {
    provider: NookEnrollmentProvider,
    identity_id: String,
    identity_label: String,
    entry_id: String,
    issued_at: String,
}

#[wasm_bindgen]
impl NookEnrollmentIssueInput {
    /// An invitation into one identity through the given provider mount.
    #[wasm_bindgen]
    pub fn for_identity(
        provider: NookEnrollmentProvider,
        identity_id: String,
        identity_label: String,
        entry_id: String,
        issued_at: String,
    ) -> Self {
        Self {
            provider,
            identity_id,
            identity_label,
            entry_id,
            issued_at,
        }
    }

    /// The issue input with the invite a member just recorded.
    pub(crate) fn to_core(
        &self,
        invite: nook_core::EnrollmentInvite,
    ) -> Result<nook_core::EnrollmentIssueInput, nook_core::EnrollmentError> {
        Ok(nook_core::EnrollmentIssueInput {
            invite,
            provider: self.provider.to_core(),
            identity: nook_core::EnrollmentIdentityTarget {
                identity_id: nook_core::IdentityId::parse(&self.identity_id).map_err(|_| {
                    nook_core::EnrollmentError::MissingField {
                        field: "identity_id",
                    }
                })?,
                label: self.identity_label.clone(),
            },
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
    identity_id: String,
    identity_label: String,
    entry_id: String,
    issued_at: String,
}

#[wasm_bindgen]
impl NookDecryptedEnrollmentPayload {
    pub(crate) fn from_core(payload: nook_core::DecryptedEnrollmentPayload) -> Self {
        Self {
            provider: NookEnrollmentProvider::from_core(payload.provider),
            identity_id: payload.identity.identity_id.to_string(),
            identity_label: payload.identity.label,
            entry_id: payload.entry_id,
            issued_at: payload.issued_at,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn provider(&self) -> NookEnrollmentProvider {
        self.provider.clone()
    }

    #[wasm_bindgen(getter, js_name = identityId)]
    pub fn identity_id(&self) -> String {
        self.identity_id.clone()
    }

    #[wasm_bindgen(getter, js_name = identityLabel)]
    pub fn identity_label(&self) -> String {
        self.identity_label.clone()
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
mod tests {
    use super::*;
    use nook_core::OnboardingType;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn enrollment_provider_projects_personal_and_shared_variants() -> Result<(), JsError> {
        use nook_core::{IsoTimestamp, OAuthAccountIdentity};
        let local = NookEnrollmentProvider::local();
        assert_eq!(local.provider_type()?.to_rust()?, ProviderKind::Local);
        assert!(!local.is_shared_provider_grant());
        assert!(matches!(
            local.onboarding_type(),
            OnboardingType::PersonalCredentialTransfer
        ));
        assert!(local.github_pat().is_err());
        assert_eq!(local.provider_draft()?.to_rust()?, ProviderDraft::Local {});

        let github = NookEnrollmentProvider::github("owner-repo".into(), "pat".into())?;
        assert_eq!(github.provider_type()?.to_rust()?, ProviderKind::Github);
        assert_eq!(github.github_repo()?, "owner-repo");
        assert_eq!(github.github_pat()?, "pat");
        assert!(github.oauth_preset().is_err());
        assert!(NookEnrollmentProvider::github("repo".into(), " ".into()).is_err());

        // A companion code carries the shared Drive folder it connects through.
        let oauth = NookEnrollmentProvider::from_core(EnrollmentProvider::personal(
            PersonalEnrollmentProvider::oauth_file(OAuthFileEnrollment::GoogleDrive {
                access_token: ProviderSecretText::try_from("access-token".to_owned())?,
                expires_at: IsoTimestamp::parse("2030-01-01T00:00:00Z")?,
                account: OAuthAccountIdentity::Email("owner@example.com".into()),
                folder_id: "folder-1".into(),
            }),
        ));
        assert_eq!(
            oauth.provider_type()?.to_rust()?,
            ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive)
        );
        assert_eq!(oauth.oauth_preset()?, "google-drive");
        assert_eq!(oauth.oauth_access_token()?, "access-token");
        assert!(oauth.provider_draft()?.to_rust()?.complete().is_ok());

        let drive =
            NookEnrollmentProvider::shared_provider_grant("joiner".into(), "folder-1".into());
        assert!(drive.is_shared_provider_grant());
        assert_eq!(drive.oauth_preset()?, "google-drive");
        assert_eq!(drive.shared_joiner_identity_kind()?, "email");
        assert_eq!(drive.shared_joiner_identity()?, "joiner");
        assert_eq!(drive.shared_storage_target_id()?, "folder-1");
        assert!(drive.oauth_access_token().is_err());
        assert!(drive.provider_draft()?.to_rust()?.complete().is_err());

        let icloud =
            NookEnrollmentProvider::icloud_shared("member@icloud.com".into(), "share-1".into());
        assert_eq!(icloud.oauth_preset()?, "icloud");
        assert_eq!(icloud.shared_storage_target_id()?, "share-1");
        assert_eq!(icloud.shared_joiner_identity()?, "member@icloud.com");
        // A grant whose share is not one gives the joiner no draft.
        assert!(icloud.provider_draft().is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn enrollment_inputs_keep_typed_values() -> anyhow::Result<()> {
        let invite = || -> anyhow::Result<nook_core::EnrollmentInvite> {
            Ok(nook_core::EnrollmentInvite {
                invite_id: nook_core::IdentityInviteId::generate()?,
                signing_seed: nook_core::InviteSigningSeed::generate()?,
                vaults: Vec::new(),
            })
        };
        let provider = NookEnrollmentProvider::github("repo".into(), "pat".into())
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        let malformed = NookEnrollmentIssueInput::for_identity(
            provider.clone(),
            "not-an-identity".into(),
            "Personal".into(),
            "entry-1".into(),
            "2026-01-01".into(),
        );
        assert_eq!(malformed.entry_id(), "entry-1");
        assert_eq!(malformed.issued_at(), "2026-01-01");
        assert!(malformed.to_core(invite()?).is_err());
        let identity_id = nook_core::IdentityId::generate()?;
        let named = NookEnrollmentIssueInput::for_identity(
            provider,
            identity_id.to_string(),
            "Personal".into(),
            "entry-2".into(),
            "2026-01-02".into(),
        );
        assert_eq!(named.to_core(invite()?)?.identity.identity_id, identity_id);
        assert_eq!(named.to_core(invite()?)?.identity.label, "Personal");

        let payload =
            NookDecryptedEnrollmentPayload::from_core(nook_core::DecryptedEnrollmentPayload {
                provider: NookEnrollmentProvider::local().to_core(),
                identity: nook_core::EnrollmentIdentityTarget {
                    identity_id: identity_id.clone(),
                    label: "Family".into(),
                },
                entry_id: "entry-3".into(),
                issued_at: "2026-01-03".into(),
                invite: invite()?,
            });
        assert_eq!(payload.identity_label(), "Family");
        assert_eq!(payload.identity_id(), identity_id.to_string());
        assert_eq!(payload.entry_id(), "entry-3");
        assert_eq!(payload.issued_at(), "2026-01-03");
        assert!(matches!(
            payload.onboarding_type(),
            OnboardingType::PersonalCredentialTransfer
        ));

        Ok(())
    }
}
