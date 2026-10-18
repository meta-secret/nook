//! Rust-selected display text of listing rows and section headers: type labels,
//! row actions, and saved names with their catalog fallbacks.

use super::{
    SiteSecretAction, SiteSecretActionLabels, SiteSecretIdentityHeader, SiteSecretIdentityName,
    SiteSecretKind, SiteSecretMessageKey, SiteSecretVaultLabel, SiteSecretVaultName,
};
use nook_app_common::i18n_keys;

/// Whether a saved name is empty prose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SiteSecretNaming {
    Named,
    Unnamed,
}

impl SiteSecretNaming {
    pub(super) fn of(text: &str) -> Self {
        match text.trim() {
            "" => Self::Unnamed,
            _ => Self::Named,
        }
    }
}

impl SiteSecretKind {
    pub(super) fn type_label_key(self) -> SiteSecretMessageKey {
        SiteSecretMessageKey::catalog(match self {
            Self::Login => i18n_keys::VAULT_TYPES_LOGIN,
            Self::Authenticator => i18n_keys::VAULT_TYPES_AUTHENTICATOR,
            Self::Passkey => i18n_keys::VAULT_TYPES_PASSKEY,
            Self::ApiKey => i18n_keys::VAULT_TYPES_API_KEY,
        })
    }

    pub(super) fn action(self) -> SiteSecretAction {
        match self {
            Self::Login => SiteSecretAction::FillLogin(SiteSecretActionLabels {
                label_key: SiteSecretMessageKey::catalog(i18n_keys::EXTENSION_ACTION_FILL),
                accessible_label_key: SiteSecretMessageKey::catalog(
                    i18n_keys::EXTENSION_ACTION_FILL_LOGIN,
                ),
            }),
            Self::Authenticator => SiteSecretAction::FillCode(SiteSecretActionLabels {
                label_key: SiteSecretMessageKey::catalog(i18n_keys::EXTENSION_ACTION_FILL_CODE),
                accessible_label_key: SiteSecretMessageKey::catalog(
                    i18n_keys::EXTENSION_ACTION_FILL_CODE_FOR,
                ),
            }),
            Self::Passkey | Self::ApiKey => SiteSecretAction::ViewOnly,
        }
    }
}

impl From<SiteSecretVaultName> for SiteSecretVaultLabel {
    fn from(name: SiteSecretVaultName) -> Self {
        let SiteSecretVaultName(text) = &name;
        match SiteSecretNaming::of(text) {
            SiteSecretNaming::Named => Self::Named { name },
            SiteSecretNaming::Unnamed => Self::Unnamed {
                message_key: SiteSecretMessageKey::catalog(i18n_keys::LOGIN_VAULT_PICKER_UNNAMED),
            },
        }
    }
}

impl From<SiteSecretIdentityName> for SiteSecretIdentityHeader {
    fn from(name: SiteSecretIdentityName) -> Self {
        let SiteSecretIdentityName(text) = &name;
        match SiteSecretNaming::of(text) {
            SiteSecretNaming::Named => Self::Named { name },
            SiteSecretNaming::Unnamed => Self::Unnamed {
                message_key: SiteSecretMessageKey::catalog(
                    i18n_keys::EXTENSION_COMPANION_OTHER_VAULTS,
                ),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct KindPresentationCase {
        kind: SiteSecretKind,
        type_label: &'static str,
        action: SiteSecretAction,
    }

    #[test]
    fn every_kind_maps_to_its_type_label_and_action() {
        let fill_login = SiteSecretAction::FillLogin(SiteSecretActionLabels {
            label_key: SiteSecretMessageKey::catalog(i18n_keys::EXTENSION_ACTION_FILL),
            accessible_label_key: SiteSecretMessageKey::catalog(
                i18n_keys::EXTENSION_ACTION_FILL_LOGIN,
            ),
        });
        let fill_code = SiteSecretAction::FillCode(SiteSecretActionLabels {
            label_key: SiteSecretMessageKey::catalog(i18n_keys::EXTENSION_ACTION_FILL_CODE),
            accessible_label_key: SiteSecretMessageKey::catalog(
                i18n_keys::EXTENSION_ACTION_FILL_CODE_FOR,
            ),
        });
        for case in [
            KindPresentationCase {
                kind: SiteSecretKind::Login,
                type_label: i18n_keys::VAULT_TYPES_LOGIN,
                action: fill_login,
            },
            KindPresentationCase {
                kind: SiteSecretKind::Authenticator,
                type_label: i18n_keys::VAULT_TYPES_AUTHENTICATOR,
                action: fill_code,
            },
            KindPresentationCase {
                kind: SiteSecretKind::Passkey,
                type_label: i18n_keys::VAULT_TYPES_PASSKEY,
                action: SiteSecretAction::ViewOnly,
            },
            KindPresentationCase {
                kind: SiteSecretKind::ApiKey,
                type_label: i18n_keys::VAULT_TYPES_API_KEY,
                action: SiteSecretAction::ViewOnly,
            },
        ] {
            assert_eq!(
                case.kind.type_label_key(),
                SiteSecretMessageKey::catalog(case.type_label)
            );
            assert_eq!(case.kind.action(), case.action);
        }
    }
}
