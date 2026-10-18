//! What the active tab's page currently needs from the "This site" listing.
//!
//! The content script classifies its page into an [`AuthenticationWorkflowMatch`]
//! as it does for the in-page widget; this module derives the listing filter
//! from that classification, so the workflow vocabulary has a single owner.

use super::{SiteSecretEmptyHint, SiteSecretKind, SiteSecretListing, SiteSecretMessageKey};
use crate::{AuthenticationWorkflowKind, AuthenticationWorkflowMatch};
use nook_app_common::i18n_keys;
use wasm_bindgen::prelude::wasm_bindgen;

/// The secret kinds the page's recognized authentication form needs.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SitePageNeed {
    /// A second-factor code challenge: authenticators only.
    OneTimeCode,
    /// A login, sign-up, or password-change form: logins only.
    Credentials,
    /// No recognized authentication form: every site-bound kind.
    AnySiteSecret,
}

impl From<AuthenticationWorkflowKind> for SitePageNeed {
    fn from(kind: AuthenticationWorkflowKind) -> Self {
        match kind {
            AuthenticationWorkflowKind::TotpChallenge => Self::OneTimeCode,
            AuthenticationWorkflowKind::Login
            | AuthenticationWorkflowKind::Signup
            | AuthenticationWorkflowKind::PasswordChange => Self::Credentials,
            // Authenticator enrollment shows a setup secret, not a fillable
            // form; a manual page is one Nook could not classify.
            AuthenticationWorkflowKind::TotpEnrollment | AuthenticationWorkflowKind::Manual => {
                Self::AnySiteSecret
            }
        }
    }
}

impl From<AuthenticationWorkflowMatch> for SitePageNeed {
    fn from(workflow: AuthenticationWorkflowMatch) -> Self {
        match workflow {
            AuthenticationWorkflowMatch::NoMatch | AuthenticationWorkflowMatch::Rejected => {
                Self::AnySiteSecret
            }
            AuthenticationWorkflowMatch::Matched(snapshot) => Self::from(snapshot.kind),
        }
    }
}

impl SitePageNeed {
    /// The empty state when no saved item serves this need.
    pub(super) fn empty_listing(self) -> SiteSecretListing {
        let save_hint = SiteSecretEmptyHint::Shown {
            message_key: SiteSecretMessageKey::catalog(i18n_keys::EXTENSION_ACTION_SITE_EMPTY_HINT),
        };
        match self {
            Self::OneTimeCode => SiteSecretListing::Empty {
                message_key: SiteSecretMessageKey::catalog(
                    i18n_keys::EXTENSION_ACTION_SITE_EMPTY_TOTP,
                ),
                hint: SiteSecretEmptyHint::Absent,
            },
            Self::Credentials => SiteSecretListing::Empty {
                message_key: SiteSecretMessageKey::catalog(i18n_keys::EXTENSION_ACTION_SITE_EMPTY),
                hint: save_hint,
            },
            Self::AnySiteSecret => SiteSecretListing::Empty {
                message_key: SiteSecretMessageKey::catalog(
                    i18n_keys::EXTENSION_ACTION_SITE_EMPTY_ANY,
                ),
                hint: save_hint,
            },
        }
    }
}

/// Whether a kind serves the page's current need.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SiteSecretRelevance {
    Relevant,
    Hidden,
}

impl SiteSecretKind {
    /// Exhaustive page-need filter: a code challenge shows authenticators,
    /// a login or sign-up form shows logins, any other page every kind.
    pub(super) const fn relevance(self, need: SitePageNeed) -> SiteSecretRelevance {
        match need {
            SitePageNeed::OneTimeCode => match self {
                Self::Authenticator => SiteSecretRelevance::Relevant,
                Self::Login | Self::Passkey | Self::ApiKey => SiteSecretRelevance::Hidden,
            },
            SitePageNeed::Credentials => match self {
                Self::Login => SiteSecretRelevance::Relevant,
                Self::Authenticator | Self::Passkey | Self::ApiKey => SiteSecretRelevance::Hidden,
            },
            SitePageNeed::AnySiteSecret => match self {
                Self::Login | Self::Authenticator | Self::Passkey | Self::ApiKey => {
                    SiteSecretRelevance::Relevant
                }
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AuthenticationFieldCount, AuthenticationPageObservation};

    struct WorkflowCase {
        kind: AuthenticationWorkflowKind,
        need: SitePageNeed,
    }

    #[test]
    fn every_workflow_kind_selects_its_page_need() {
        for case in [
            WorkflowCase {
                kind: AuthenticationWorkflowKind::TotpChallenge,
                need: SitePageNeed::OneTimeCode,
            },
            WorkflowCase {
                kind: AuthenticationWorkflowKind::Login,
                need: SitePageNeed::Credentials,
            },
            WorkflowCase {
                kind: AuthenticationWorkflowKind::Signup,
                need: SitePageNeed::Credentials,
            },
            WorkflowCase {
                kind: AuthenticationWorkflowKind::PasswordChange,
                need: SitePageNeed::Credentials,
            },
            WorkflowCase {
                kind: AuthenticationWorkflowKind::TotpEnrollment,
                need: SitePageNeed::AnySiteSecret,
            },
            WorkflowCase {
                kind: AuthenticationWorkflowKind::Manual,
                need: SitePageNeed::AnySiteSecret,
            },
        ] {
            assert_eq!(SitePageNeed::from(case.kind), case.need, "{:?}", case.kind);
        }
    }

    #[test]
    fn unrecognized_workflow_matches_need_every_kind() {
        for workflow in [
            AuthenticationWorkflowMatch::NoMatch,
            AuthenticationWorkflowMatch::Rejected,
        ] {
            assert_eq!(SitePageNeed::from(workflow), SitePageNeed::AnySiteSecret);
        }
    }

    #[test]
    fn classified_pages_select_the_listing_filter() {
        let totp_page = AuthenticationPageObservation {
            one_time_code_field_count: AuthenticationFieldCount::from(1),
            ..AuthenticationPageObservation::default()
        };
        assert_eq!(
            SitePageNeed::from(totp_page.classify_authentication_workflow()),
            SitePageNeed::OneTimeCode
        );
        let login_page = AuthenticationPageObservation {
            username_field_count: AuthenticationFieldCount::from(1),
            current_password_field_count: AuthenticationFieldCount::from(1),
            ..AuthenticationPageObservation::default()
        };
        assert_eq!(
            SitePageNeed::from(login_page.classify_authentication_workflow()),
            SitePageNeed::Credentials
        );
        assert_eq!(
            SitePageNeed::from(
                AuthenticationPageObservation::default().classify_authentication_workflow()
            ),
            SitePageNeed::AnySiteSecret
        );
    }
}
