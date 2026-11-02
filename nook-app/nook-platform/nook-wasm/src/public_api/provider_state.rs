use super::{NookStorageConnection, wasm_bindgen};
use crate::NookLocalFolderConfig;
use crate::{TypedInput, TypedOutput};
use nook_core::{
    DraftStorageConnection, ExistingVaultProviderReadiness, GithubDraft, GithubPat, GithubPatMask,
    LocalFolderDraft, ProviderDraft, ProviderSelection, S3Draft, StagedStorageConnection,
    StorageConnection,
};
use wasm_bindgen::JsError;

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookExistingVaultProviderReadiness {
    Ready,
    MissingLocalFolder,
}

impl From<nook_core::ExistingVaultProviderReadiness> for NookExistingVaultProviderReadiness {
    fn from(value: nook_core::ExistingVaultProviderReadiness) -> Self {
        match value {
            ExistingVaultProviderReadiness::Ready => Self::Ready,
            ExistingVaultProviderReadiness::MissingLocalFolder => Self::MissingLocalFolder,
        }
    }
}

/// Whether the draft can enter the existing-vault import.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn existing_vault_provider_readiness(
    draft: &tsify::Ts<ProviderDraft>,
) -> Result<NookExistingVaultProviderReadiness, wasm_bindgen::JsError> {
    let draft = draft.decode()?;
    Ok(draft.existing_vault_readiness().into())
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
    pub fn args(&self) -> Result<tsify::Ts<NookStorageConnection>, wasm_bindgen::JsError> {
        let result = match &self.0 {
            StagedStorageConnection::Ready(args) => Ok(args.clone()),
            StagedStorageConnection::Incomplete => {
                Err(JsError::new("staged storage is incomplete"))
            }
        }?;
        Ok(result.encode()?)
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

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn local_vault_storage_args() -> Result<tsify::Ts<NookStorageConnection>, wasm_bindgen::JsError>
{
    Ok(StorageConnection::Local.encode()?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authenticated_vault_storage_args(
    provider: &tsify::Ts<nook_core::StorageProvider>,
) -> Result<tsify::Ts<NookStorageConnection>, wasm_bindgen::JsError> {
    let provider = provider.decode()?;
    Ok(provider.storage_connection().encode()?)
}

/// Where the manager opens a vault through the draft being set up, or the
/// gap that stops it.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn draft_storage_args(
    draft: &tsify::Ts<ProviderDraft>,
) -> Result<tsify::Ts<DraftStorageConnection>, wasm_bindgen::JsError> {
    let draft = draft.decode()?;
    Ok(draft.storage_connection().encode()?)
}

/// The kind of provider the draft sets up.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_draft_kind(
    draft: &tsify::Ts<ProviderDraft>,
) -> Result<tsify::Ts<nook_core::ProviderKind>, wasm_bindgen::JsError> {
    let draft = draft.decode()?;
    Ok(draft.kind().encode()?)
}

/// A saved row as the draft of its complete setup.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_row_draft(
    row: &tsify::Ts<nook_core::StorageProvider>,
) -> Result<tsify::Ts<ProviderDraft>, wasm_bindgen::JsError> {
    let row = row.decode()?;
    Ok(ProviderDraft::from(row.provider).encode()?)
}

/// The folder the local-folder chooser returned, as the draft it sets up.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn local_folder_provider_draft(
    folder: &NookLocalFolderConfig,
) -> Result<tsify::Ts<ProviderDraft>, wasm_bindgen::JsError> {
    let folder = folder.provider()?;
    Ok(ProviderDraft::LocalFolder(LocalFolderDraft::Selected(folder)).encode()?)
}

/// Whether a Google sign-in's token still serves a request, or needs a fresh
/// sign-in first: Rust owns the one-minute margin and the comparison, and the
/// page passes its clock as `now`.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn google_drive_authorization_freshness(
    check: &tsify::Ts<nook_core::GoogleDriveAuthorizationCheck>,
) -> Result<tsify::Ts<nook_core::GoogleDriveAuthorizationFreshness>, wasm_bindgen::JsError> {
    Ok(check.decode()?.freshness()?.encode()?)
}

/// The saved rows after the draft's fresh sign-in: every row of its target
/// and account takes it as one unit.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn put_provider_sign_in(
    request: &tsify::Ts<nook_core::ProviderSignInUpdate>,
) -> Result<tsify::Ts<nook_core::AuthProvidersSnapshot>, wasm_bindgen::JsError> {
    let request = request.decode()?;
    Ok(request.apply().encode()?)
}

/// The remote connection a staged setup can open, if it is complete.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn staged_storage_args(
    draft: &tsify::Ts<ProviderDraft>,
) -> Result<NookStagedStorageArgs, wasm_bindgen::JsError> {
    let draft = draft.decode()?;
    Ok(NookStagedStorageArgs::new(draft.staged_connection()))
}

/// The label the setup shows for the draft.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_draft_label(
    draft: &tsify::Ts<ProviderDraft>,
) -> Result<String, wasm_bindgen::JsError> {
    let draft = draft.decode()?;
    Ok(draft.label())
}

/// Whether the draft holds the credentials its provider needs.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_draft_credential_readiness(
    draft: &tsify::Ts<ProviderDraft>,
) -> Result<tsify::Ts<nook_core::ProviderCredentialReadiness>, wasm_bindgen::JsError> {
    let draft = draft.decode()?;
    Ok(draft.credential_readiness().encode()?)
}

/// A new setup of `kind`, with every dimension still awaiting.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn begin_provider_draft(
    kind: &tsify::Ts<nook_core::ProviderKind>,
) -> Result<tsify::Ts<ProviderDraft>, wasm_bindgen::JsError> {
    let kind = kind.decode()?;
    Ok(ProviderDraft::begin(kind).encode()?)
}

/// The GitHub setup form as its draft: trimmed once, a blank token not
/// entered yet and a blank repository the default one.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn github_provider_draft(
    form: &tsify::Ts<nook_core::GithubDraftForm>,
) -> Result<tsify::Ts<ProviderDraft>, wasm_bindgen::JsError> {
    let form = form.decode()?;
    Ok(ProviderDraft::Github(GithubDraft::from(form)).encode()?)
}

/// A validated S3 connection as a ready S3 draft.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn s3_provider_draft(
    connection: &tsify::Ts<nook_core::S3Connection>,
) -> Result<tsify::Ts<ProviderDraft>, wasm_bindgen::JsError> {
    let connection = connection.decode()?;
    Ok(ProviderDraft::S3(S3Draft::Ready(connection)).encode()?)
}

/// The message a connect or save that the gap stops reports.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_draft_gap_translation_key(
    gap: &tsify::Ts<nook_core::ProviderDraftGap>,
) -> Result<String, wasm_bindgen::JsError> {
    let gap = gap.decode()?;
    Ok(gap.translation_key().to_owned())
}

/// What the provider needs before a backup password can unlock through it.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_draft_gap_unlock_translation_key(
    gap: &tsify::Ts<nook_core::ProviderDraftGap>,
) -> Result<String, wasm_bindgen::JsError> {
    let gap = gap.decode()?;
    Ok(gap.unlock_translation_key().to_owned())
}

/// Return a masked GitHub PAT hint without exposing the full credential.
#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn mask_github_pat_hint(token: &str) -> NookGithubPatHint {
    NookGithubPatHint(GithubPat::mask(token))
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use crate::test_fixtures::WasmFixture;
    use nook_core::{
        ActiveVaultScope, AuthProvidersSnapshot, GithubDraftForm, GoogleDriveAccess,
        GoogleDriveAuthorization, GoogleDriveFolderId, IsoTimestamp, LocalFolderProvider,
        OAuthAccountIdentity, OAuthFilePreset, ProviderCredentialReadiness, ProviderDraftGap,
        ProviderKind, ProviderSignInUpdate, ProviderVaultScope, StorageProvider, i18n_keys,
    };
    use serde::Serialize;
    use tsify::Tsify;
    use wasm_bindgen_test::wasm_bindgen_test;

    fn ts<T: Tsify + Serialize>(value: &T) -> Result<tsify::Ts<T>, JsError> {
        Ok(value.encode()?)
    }

    /// A request as the host sends it, for the request types that only decode.
    fn wire<T: Tsify>(value: &serde_json::Value) -> Result<tsify::Ts<T>, JsError> {
        let value = value
            .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
            .map_err(|_| JsError::new("fixture"))?;
        Ok(tsify::Ts::new_unchecked(value))
    }

    fn github_form(token: &str, repository: &str) -> Result<tsify::Ts<GithubDraftForm>, JsError> {
        wire(&serde_json::json!({ "token": token, "repository": repository }))
    }

    #[wasm_bindgen_test]
    fn draft_exports_project_connections_labels_and_readiness() -> Result<(), JsError> {
        let github = github_provider_draft(&github_form(" github_pat_TEST-ONLY ", " team ")?)?;
        assert_eq!(provider_draft_label(&github)?, "GitHub · team");
        assert!(matches!(
            draft_storage_args(&github)?.to_rust()?,
            DraftStorageConnection::Ready {
                connection: StorageConnection::Github { .. }
            }
        ));
        assert_eq!(
            staged_storage_args(&github)?.state(),
            NookStagedStorageArgsState::Ready
        );
        assert_eq!(
            provider_draft_credential_readiness(&github)?.to_rust()?,
            ProviderCredentialReadiness::Ready
        );
        let drive =
            begin_provider_draft(&ts(&ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive))?)?;
        assert_eq!(provider_draft_label(&drive)?, "Google Drive");
        assert_eq!(
            draft_storage_args(&drive)?.to_rust()?,
            DraftStorageConnection::Incomplete {
                gap: ProviderDraftGap::OAuthSignIn
            }
        );
        assert_eq!(
            staged_storage_args(&drive)?.state(),
            NookStagedStorageArgsState::Incomplete
        );
        let folder = begin_provider_draft(&ts(&ProviderKind::LocalFolder)?)?;
        assert_eq!(
            existing_vault_provider_readiness(&folder)?,
            NookExistingVaultProviderReadiness::MissingLocalFolder
        );
        assert_eq!(
            draft_storage_args(&folder)?.to_rust()?,
            DraftStorageConnection::Ready {
                connection: StorageConnection::Local
            }
        );
        let s3 = s3_provider_draft(&ts(&WasmFixture::s3_connection()?)?)?;
        assert_eq!(provider_draft_label(&s3)?, "S3 · nook-dev/e2e");
        let gap = ts(&ProviderDraftGap::GithubToken)?;
        assert_eq!(
            provider_draft_gap_translation_key(&gap)?,
            i18n_keys::ERRORS_VALIDATION_GITHUB_PAT_EMPTY
        );
        assert_eq!(
            provider_draft_gap_unlock_translation_key(&gap)?,
            i18n_keys::ERRORS_GITHUB_CREDENTIALS_REQUIRED
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn a_row_a_chosen_folder_and_a_fresh_sign_in_become_drafts_and_rows() -> Result<(), JsError> {
        let row = WasmFixture::github_row("github", "github_pat_TEST-ONLY", "team")?;
        let draft = provider_row_draft(&ts(&row)?)?;
        assert_eq!(
            provider_draft_kind(&draft)?.to_rust()?,
            ProviderKind::Github
        );
        assert_eq!(draft.to_rust()?, ProviderDraft::from(row.provider));

        let folder =
            local_folder_provider_draft(&NookLocalFolderConfig::fixture("backups", "folder_1"))?;
        assert_eq!(
            folder.to_rust()?,
            ProviderDraft::LocalFolder(LocalFolderDraft::Selected(LocalFolderProvider {
                directory_name: "backups".to_owned().into(),
                handle_id: "folder_1".to_owned().try_into()?,
            }))
        );
        assert!(
            local_folder_provider_draft(&NookLocalFolderConfig::fixture("backups", " ")).is_err()
        );

        let authorization = |token: &str| -> Result<GoogleDriveAuthorization, JsError> {
            Ok(GoogleDriveAuthorization {
                access_token: WasmFixture::secret(token)?,
                expires_at: IsoTimestamp::parse("2030-01-01T00:00:00Z")?,
            })
        };
        let saved = ProviderDraft::begin(ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive))
            .with_google_drive_folder(GoogleDriveFolderId::parse("folder-1")?)?
            .with_google_drive_access(GoogleDriveAccess {
                authorization: authorization("TEST-ONLY-old")?,
                account: OAuthAccountIdentity::Unknown,
            });
        let snapshot = AuthProvidersSnapshot {
            providers: vec![StorageProvider::never_synced(
                "drive".to_owned(),
                ProviderVaultScope::Unscoped,
                "2026-01-01T00:00:00Z".to_owned(),
                saved
                    .clone()
                    .complete()
                    .map_err(|gap| JsError::new(gap.translation_key()))?,
            )],
            active_vault_store_id: ActiveVaultScope::Unselected,
        };
        let fresh = saved.with_google_drive_access(GoogleDriveAccess {
            authorization: authorization("TEST-ONLY-fresh")?,
            account: OAuthAccountIdentity::Unknown,
        });
        let request = wire::<ProviderSignInUpdate>(&serde_json::json!({
            "snapshot": serde_json::to_value(&snapshot)?,
            "draft": serde_json::to_value(&fresh)?,
        }))?;
        let updated = put_provider_sign_in(&request)?.to_rust()?;
        let [row] = updated.providers.as_slice() else {
            return Err(JsError::new("the row stays"));
        };
        assert_eq!(
            row.provider.secrets().first().map(|token| token.expose()),
            Some("TEST-ONLY-fresh")
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn the_pat_hint_never_shows_the_token() -> Result<(), JsError> {
        let hint = mask_github_pat_hint("github_pat_11AAAAAAAAAAAAAA");
        assert_eq!(hint.state(), NookGithubPatHintState::Available);
        assert_eq!(hint.value()?, "github_pat_11A…");
        assert_eq!(
            mask_github_pat_hint(" ").state(),
            NookGithubPatHintState::Missing
        );
        assert!(mask_github_pat_hint(" ").value().is_err());
        assert_eq!(
            local_vault_storage_args()?.to_rust()?,
            StorageConnection::Local
        );
        Ok(())
    }
}
