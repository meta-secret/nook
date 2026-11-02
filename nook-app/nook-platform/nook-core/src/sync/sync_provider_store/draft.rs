#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! The provider being set up: the one value the web keeps from the picker
//! until it is saved and connected.
//!
//! Each provider states what its setup has gathered as named dimensions; a
//! complete draft converts into its stored provider with no defaults, and an
//! incomplete one names the [`ProviderDraftGap`] that stops it.

use nook_app_common::i18n_keys;
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::{
    DraftStorageConnection, ExistingVaultProviderReadiness, GithubProvider, LocalFolderProvider,
    ProviderKind, ProviderSecretText, S3Connection, StagedStorageConnection, StorageConnection,
    StoredGithubRepository, StoredProvider,
};

mod oauth_file;

pub use oauth_file::{
    GoogleDriveAccess, GoogleDriveDraft, GoogleDriveFolder, GoogleDriveFolderBinding,
    GoogleDriveSignIn, GoogleDriveSignInRequest, ICloudAccess, ICloudDraft, ICloudShare,
    ICloudShareBinding, ICloudSignIn, ICloudSignInRequest, OAuthFileDraft, ProviderDraftMismatch,
};

/// The provider being set up, tagged by its `type` like a stored provider.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ProviderDraft {
    Local {},
    LocalFolder(LocalFolderDraft),
    Github(GithubDraft),
    OauthFile(OAuthFileDraft),
    S3(S3Draft),
}

/// A local folder before and after the browser's folder picker chose one.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase", deny_unknown_fields)]
pub enum LocalFolderDraft {
    AwaitingFolder {},
    Selected(LocalFolderProvider),
}

/// A GitHub repository and the token typed for it so far.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GithubDraft {
    pub repository: StoredGithubRepository,
    pub token: GithubDraftToken,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(
    tag = "state",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum GithubDraftToken {
    AwaitingToken,
    Entered(ProviderSecretText),
}

/// What the GitHub setup form holds. The typed token is wiped when the form
/// is dropped.
#[derive(Deserialize, Tsify, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GithubDraftForm {
    pub token: String,
    #[zeroize(skip)]
    pub repository: String,
}

/// An S3 location before and after its setup form validated.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase", deny_unknown_fields)]
pub enum S3Draft {
    AwaitingConnection {},
    Ready(S3Connection),
}

/// Why a draft cannot become a provider row or connect yet.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum ProviderDraftGap {
    LocalFolder,
    GithubToken,
    #[serde(rename = "oauthSignIn")]
    OAuthSignIn,
    SharedTarget,
    S3Connection,
}

/// Whether a draft holds the credentials its provider needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "gap", rename_all = "camelCase")]
pub enum ProviderCredentialReadiness {
    Ready,
    Required(ProviderDraftGap),
}

impl ProviderDraftGap {
    /// The message a connect or save that the gap stops reports.
    #[must_use]
    pub const fn translation_key(self) -> &'static str {
        match self {
            Self::LocalFolder => i18n_keys::ERRORS_LOCAL_BACKUP_FOLDER_REQUIRED,
            Self::GithubToken => i18n_keys::ERRORS_VALIDATION_GITHUB_PAT_EMPTY,
            Self::OAuthSignIn => i18n_keys::ERRORS_VALIDATION_OAUTH_ACCESS_TOKEN_EMPTY,
            Self::SharedTarget => i18n_keys::ERRORS_VALIDATION_SHARED_STORAGE_TARGET_REQUIRED,
            Self::S3Connection => i18n_keys::ERRORS_VALIDATION_S3_STORAGE_TARGET_INVALID,
        }
    }

    /// What the provider needs before a backup password can unlock through
    /// it. A local folder asks for its folder, not for GitHub credentials.
    #[must_use]
    pub const fn unlock_translation_key(self) -> &'static str {
        match self {
            Self::LocalFolder => i18n_keys::ERRORS_LOCAL_BACKUP_FOLDER_REQUIRED,
            Self::GithubToken => i18n_keys::ERRORS_GITHUB_CREDENTIALS_REQUIRED,
            Self::OAuthSignIn | Self::SharedTarget => i18n_keys::ERRORS_GOOGLE_SIGN_IN_REQUIRED,
            Self::S3Connection => i18n_keys::ERRORS_VALIDATION_S3_STORAGE_TARGET_INVALID,
        }
    }
}

/// The form's text, trimmed once: a blank token is not entered yet and a
/// blank repository is the default one.
impl From<GithubDraftForm> for GithubDraft {
    fn from(form: GithubDraftForm) -> Self {
        let token = match ProviderSecretText::try_from(form.token.trim().to_owned()) {
            Ok(token) => GithubDraftToken::Entered(token),
            Err(_) => GithubDraftToken::AwaitingToken,
        };
        let repository = match form.repository.trim() {
            "" => StoredGithubRepository::DefaultRepository,
            name => StoredGithubRepository::Repository(name.to_owned()),
        };
        Self { repository, token }
    }
}

impl ProviderDraft {
    /// A new setup of `kind`, with every dimension still awaiting.
    #[must_use]
    pub const fn begin(kind: ProviderKind) -> Self {
        match kind {
            ProviderKind::Local => Self::Local {},
            ProviderKind::LocalFolder => Self::LocalFolder(LocalFolderDraft::AwaitingFolder {}),
            ProviderKind::Github => Self::Github(GithubDraft {
                repository: StoredGithubRepository::DefaultRepository,
                token: GithubDraftToken::AwaitingToken,
            }),
            ProviderKind::OauthFile(preset) => Self::OauthFile(OAuthFileDraft::begin(preset)),
            ProviderKind::S3 => Self::S3(S3Draft::AwaitingConnection {}),
        }
    }

    #[must_use]
    pub const fn kind(&self) -> ProviderKind {
        match self {
            Self::Local {} => ProviderKind::Local,
            Self::LocalFolder(_) => ProviderKind::LocalFolder,
            Self::Github(_) => ProviderKind::Github,
            Self::OauthFile(oauth) => ProviderKind::OauthFile(oauth.preset()),
            Self::S3(_) => ProviderKind::S3,
        }
    }

    /// The stored provider a complete draft becomes, or what it still lacks.
    pub fn complete(self) -> Result<StoredProvider, ProviderDraftGap> {
        match self {
            Self::Local {} => Ok(StoredProvider::Local {}),
            Self::LocalFolder(LocalFolderDraft::Selected(folder)) => {
                Ok(StoredProvider::LocalFolder(folder))
            }
            Self::LocalFolder(LocalFolderDraft::AwaitingFolder {}) => {
                Err(ProviderDraftGap::LocalFolder)
            }
            Self::Github(GithubDraft {
                repository,
                token: GithubDraftToken::Entered(token),
            }) => Ok(StoredProvider::Github(GithubProvider { repository, token })),
            Self::Github(GithubDraft {
                token: GithubDraftToken::AwaitingToken,
                ..
            }) => Err(ProviderDraftGap::GithubToken),
            Self::OauthFile(oauth) => oauth.complete().map(StoredProvider::OauthFile),
            Self::S3(S3Draft::Ready(connection)) => Ok(StoredProvider::S3(connection)),
            Self::S3(S3Draft::AwaitingConnection {}) => Err(ProviderDraftGap::S3Connection),
        }
    }

    /// Where the manager opens a vault through this draft, or what it lacks.
    /// A local folder in any stage opens this browser's store, as it syncs
    /// beside it; every other draft must be complete.
    #[must_use]
    pub fn storage_connection(self) -> DraftStorageConnection {
        match self {
            Self::Local {} | Self::LocalFolder(_) => DraftStorageConnection::Ready {
                connection: StorageConnection::Local,
            },
            remote => match remote.complete() {
                Ok(provider) => DraftStorageConnection::Ready {
                    connection: provider.storage_connection(),
                },
                Err(gap) => DraftStorageConnection::Incomplete { gap },
            },
        }
    }

    /// The remote connection a staged setup can open, if it is complete.
    #[must_use]
    pub fn staged_connection(self) -> StagedStorageConnection {
        match self {
            Self::Local {} | Self::LocalFolder(_) => StagedStorageConnection::Incomplete,
            remote => match remote.complete() {
                Ok(provider) => StagedStorageConnection::Ready(provider.storage_connection()),
                Err(_) => StagedStorageConnection::Incomplete,
            },
        }
    }

    /// Whether the credentials exist: a signed-in OAuth draft is ready before
    /// its shared target is bound.
    #[must_use]
    pub const fn credential_readiness(&self) -> ProviderCredentialReadiness {
        match self {
            Self::Local {}
            | Self::LocalFolder(LocalFolderDraft::Selected(_))
            | Self::Github(GithubDraft {
                token: GithubDraftToken::Entered(_),
                ..
            })
            | Self::S3(S3Draft::Ready(_)) => ProviderCredentialReadiness::Ready,
            Self::LocalFolder(LocalFolderDraft::AwaitingFolder {}) => {
                ProviderCredentialReadiness::Required(ProviderDraftGap::LocalFolder)
            }
            Self::Github(GithubDraft {
                token: GithubDraftToken::AwaitingToken,
                ..
            }) => ProviderCredentialReadiness::Required(ProviderDraftGap::GithubToken),
            Self::OauthFile(oauth) => oauth.credential_readiness(),
            Self::S3(S3Draft::AwaitingConnection {}) => {
                ProviderCredentialReadiness::Required(ProviderDraftGap::S3Connection)
            }
        }
    }

    /// Whether the draft can enter the existing-vault import: only a local
    /// folder must be chosen first.
    #[must_use]
    pub const fn existing_vault_readiness(&self) -> ExistingVaultProviderReadiness {
        match self {
            Self::LocalFolder(LocalFolderDraft::AwaitingFolder {}) => {
                ExistingVaultProviderReadiness::MissingLocalFolder
            }
            Self::Local {}
            | Self::LocalFolder(LocalFolderDraft::Selected(_))
            | Self::Github(_)
            | Self::OauthFile(_)
            | Self::S3(_) => ExistingVaultProviderReadiness::Ready,
        }
    }

    /// The label the setup shows. A local folder and an OAuth draft read as
    /// their provider; an S3 draft names its location once it is ready.
    #[must_use]
    pub fn label(&self) -> String {
        match self {
            Self::Local {} => "This device".to_owned(),
            Self::LocalFolder(_) => "Local backup".to_owned(),
            Self::Github(github) => github.repository.label(),
            Self::OauthFile(oauth) => oauth.preset().provider_label().to_owned(),
            Self::S3(S3Draft::Ready(connection)) => connection.label(),
            Self::S3(S3Draft::AwaitingConnection {}) => "S3".to_owned(),
        }
    }
}

/// A saved provider as the draft of its complete setup.
impl From<StoredProvider> for ProviderDraft {
    fn from(provider: StoredProvider) -> Self {
        match provider {
            StoredProvider::Local {} => Self::Local {},
            StoredProvider::LocalFolder(folder) => {
                Self::LocalFolder(LocalFolderDraft::Selected(folder))
            }
            StoredProvider::Github(GithubProvider { repository, token }) => {
                Self::Github(GithubDraft {
                    repository,
                    token: GithubDraftToken::Entered(token),
                })
            }
            StoredProvider::OauthFile(oauth) => Self::OauthFile(OAuthFileDraft::from(oauth)),
            StoredProvider::S3(connection) => Self::S3(S3Draft::Ready(connection)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        GithubDraft, GithubDraftForm, GithubDraftToken, LocalFolderDraft,
        ProviderCredentialReadiness, ProviderDraft, ProviderDraftGap, S3Draft,
    };
    use crate::{
        DraftStorageConnection, ExistingVaultProviderReadiness, OAuthFilePreset, ProviderKind,
        StagedStorageConnection, StorageConnection, StoredGithubRepository, StoredProvider,
    };
    use nook_app_common::i18n_keys;
    use serde_json::json;

    const KINDS: [ProviderKind; 6] = [
        ProviderKind::Local,
        ProviderKind::LocalFolder,
        ProviderKind::Github,
        ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive),
        ProviderKind::OauthFile(OAuthFilePreset::ICloud),
        ProviderKind::S3,
    ];

    #[test]
    fn a_new_draft_of_each_kind_awaits_every_dimension() {
        let local = ProviderDraft::begin(ProviderKind::Local);
        assert_eq!(local.kind(), ProviderKind::Local);
        assert_eq!(
            local.credential_readiness(),
            ProviderCredentialReadiness::Ready
        );
        assert_eq!(local.complete(), Ok(StoredProvider::Local {}));
        for (kind, gap) in [
            (ProviderKind::LocalFolder, ProviderDraftGap::LocalFolder),
            (ProviderKind::Github, ProviderDraftGap::GithubToken),
            (
                ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive),
                ProviderDraftGap::OAuthSignIn,
            ),
            (
                ProviderKind::OauthFile(OAuthFilePreset::ICloud),
                ProviderDraftGap::OAuthSignIn,
            ),
            (ProviderKind::S3, ProviderDraftGap::S3Connection),
        ] {
            let draft = ProviderDraft::begin(kind);
            assert_eq!(draft.kind(), kind);
            assert_eq!(
                draft.credential_readiness(),
                ProviderCredentialReadiness::Required(gap)
            );
            assert_eq!(draft.complete(), Err(gap));
        }
    }

    #[test]
    fn a_saved_provider_is_the_draft_of_its_complete_setup() -> anyhow::Result<()> {
        for provider in StoredProvider::every_fixture()? {
            let draft = ProviderDraft::from(provider.clone());
            assert_eq!(draft.kind(), provider.kind());
            assert_eq!(
                draft.credential_readiness(),
                ProviderCredentialReadiness::Ready
            );
            assert_eq!(
                draft.existing_vault_readiness(),
                ExistingVaultProviderReadiness::Ready
            );
            let wire = serde_json::to_value(&draft)?;
            assert_eq!(serde_json::from_value::<ProviderDraft>(wire)?, draft);
            assert_eq!(draft.complete(), Ok(provider));
        }
        Ok(())
    }

    #[test]
    fn a_draft_connects_only_when_complete_and_a_folder_opens_this_browser() -> anyhow::Result<()> {
        for draft in [
            ProviderDraft::begin(ProviderKind::Local),
            ProviderDraft::begin(ProviderKind::LocalFolder),
            ProviderDraft::from(StoredProvider::local_folder_fixture()?),
        ] {
            assert_eq!(
                draft.clone().storage_connection(),
                DraftStorageConnection::Ready {
                    connection: StorageConnection::Local
                }
            );
            assert_eq!(
                draft.staged_connection(),
                StagedStorageConnection::Incomplete
            );
        }
        for (kind, gap) in [
            (ProviderKind::Github, ProviderDraftGap::GithubToken),
            (ProviderKind::S3, ProviderDraftGap::S3Connection),
            (
                ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive),
                ProviderDraftGap::OAuthSignIn,
            ),
        ] {
            let draft = ProviderDraft::begin(kind);
            assert_eq!(
                draft.clone().storage_connection(),
                DraftStorageConnection::Incomplete { gap }
            );
            assert_eq!(
                draft.staged_connection(),
                StagedStorageConnection::Incomplete
            );
        }
        let github = ProviderDraft::from(StoredProvider::github_fixture()?);
        let StagedStorageConnection::Ready(StorageConnection::Github { repo, .. }) =
            github.clone().staged_connection()
        else {
            anyhow::bail!("a complete GitHub draft is staged ready");
        };
        assert_eq!(repo, "team-vault");
        assert!(matches!(
            github.storage_connection(),
            DraftStorageConnection::Ready {
                connection: StorageConnection::Github { .. }
            }
        ));
        Ok(())
    }

    #[test]
    fn each_gap_names_its_connect_and_unlock_wording() {
        for (gap, connect, unlock) in [
            (
                ProviderDraftGap::LocalFolder,
                i18n_keys::ERRORS_LOCAL_BACKUP_FOLDER_REQUIRED,
                i18n_keys::ERRORS_LOCAL_BACKUP_FOLDER_REQUIRED,
            ),
            (
                ProviderDraftGap::GithubToken,
                i18n_keys::ERRORS_VALIDATION_GITHUB_PAT_EMPTY,
                i18n_keys::ERRORS_GITHUB_CREDENTIALS_REQUIRED,
            ),
            (
                ProviderDraftGap::OAuthSignIn,
                i18n_keys::ERRORS_VALIDATION_OAUTH_ACCESS_TOKEN_EMPTY,
                i18n_keys::ERRORS_GOOGLE_SIGN_IN_REQUIRED,
            ),
            (
                ProviderDraftGap::SharedTarget,
                i18n_keys::ERRORS_VALIDATION_SHARED_STORAGE_TARGET_REQUIRED,
                i18n_keys::ERRORS_GOOGLE_SIGN_IN_REQUIRED,
            ),
            (
                ProviderDraftGap::S3Connection,
                i18n_keys::ERRORS_VALIDATION_S3_STORAGE_TARGET_INVALID,
                i18n_keys::ERRORS_VALIDATION_S3_STORAGE_TARGET_INVALID,
            ),
        ] {
            assert_eq!(gap.translation_key(), connect);
            assert_eq!(gap.unlock_translation_key(), unlock);
        }
    }

    #[test]
    fn a_folder_that_is_not_chosen_asks_for_the_folder_at_unlock() -> anyhow::Result<()> {
        let ProviderCredentialReadiness::Required(gap) =
            ProviderDraft::begin(ProviderKind::LocalFolder).credential_readiness()
        else {
            anyhow::bail!("a new local-folder draft has no folder");
        };
        assert_eq!(
            gap.unlock_translation_key(),
            i18n_keys::ERRORS_LOCAL_BACKUP_FOLDER_REQUIRED
        );
        assert_ne!(
            gap.unlock_translation_key(),
            i18n_keys::ERRORS_GITHUB_CREDENTIALS_REQUIRED
        );
        Ok(())
    }

    #[test]
    fn only_a_folder_without_its_handle_waits_before_the_import() {
        for kind in KINDS {
            let expected = match kind {
                ProviderKind::LocalFolder => ExistingVaultProviderReadiness::MissingLocalFolder,
                ProviderKind::Local
                | ProviderKind::Github
                | ProviderKind::OauthFile(_)
                | ProviderKind::S3 => ExistingVaultProviderReadiness::Ready,
            };
            assert_eq!(
                ProviderDraft::begin(kind).existing_vault_readiness(),
                expected
            );
        }
    }

    #[test]
    fn a_draft_labels_its_provider_and_a_ready_s3_location() -> anyhow::Result<()> {
        for (kind, label) in KINDS.into_iter().zip([
            "This device",
            "Local backup",
            "GitHub",
            "Google Drive",
            "iCloud",
            "S3",
        ]) {
            assert_eq!(ProviderDraft::begin(kind).label(), label);
        }
        assert_eq!(
            ProviderDraft::from(StoredProvider::s3_fixture()?).label(),
            "S3 · nook-dev/e2e/run-1"
        );
        assert_eq!(
            ProviderDraft::from(StoredProvider::local_folder_fixture()?).label(),
            "Local backup"
        );
        assert_eq!(
            ProviderDraft::from(StoredProvider::github_fixture()?).label(),
            "GitHub · team-vault"
        );
        Ok(())
    }

    #[test]
    fn the_github_form_is_trimmed_once_into_its_draft() -> anyhow::Result<()> {
        let typed: GithubDraftForm = serde_json::from_value(json!({
            "token": "  github_pat_TEST-ONLY  ",
            "repository": " team-vault ",
        }))?;
        let draft = GithubDraft::from(typed);
        assert_eq!(
            draft.repository,
            StoredGithubRepository::Repository("team-vault".to_owned())
        );
        let GithubDraftToken::Entered(token) = &draft.token else {
            anyhow::bail!("a typed token is entered");
        };
        assert_eq!(token.expose(), "github_pat_TEST-ONLY");
        let blank = GithubDraft::from(GithubDraftForm {
            token: " \t".to_owned(),
            repository: String::new(),
        });
        assert_eq!(blank.token, GithubDraftToken::AwaitingToken);
        assert_eq!(blank.repository, StoredGithubRepository::DefaultRepository);
        Ok(())
    }

    #[test]
    fn a_draft_reads_back_only_in_its_tagged_shape() -> anyhow::Result<()> {
        assert_eq!(
            serde_json::to_value(ProviderDraft::begin(ProviderKind::OauthFile(
                OAuthFilePreset::GoogleDrive
            )))?,
            json!({
                "type": "oauth-file",
                "preset": "google-drive",
                "signIn": { "state": "awaitingSignIn" },
                "folder": { "state": "notConnected" },
            })
        );
        assert_eq!(
            serde_json::to_value(ProviderDraft::LocalFolder(
                LocalFolderDraft::AwaitingFolder {}
            ))?,
            json!({ "type": "local-folder", "state": "awaitingFolder" })
        );
        assert_eq!(
            serde_json::to_value(ProviderDraft::S3(S3Draft::AwaitingConnection {}))?,
            json!({ "type": "s3", "state": "awaitingConnection" })
        );
        for damaged in [
            json!({ "type": "local", "token": "x" }),
            json!({ "type": "local-folder", "state": "awaitingFolder", "handleId": "h" }),
            json!({ "type": "github", "repository": { "state": "defaultRepository" } }),
            json!({ "type": "s3", "state": "ready" }),
            json!({
                "type": "oauth-file",
                "preset": "icloud",
                "signIn": { "state": "awaitingSignIn" },
                "folder": { "state": "notConnected" },
            }),
        ] {
            assert!(
                serde_json::from_value::<ProviderDraft>(damaged.clone()).is_err(),
                "{damaged}"
            );
        }
        Ok(())
    }
}
