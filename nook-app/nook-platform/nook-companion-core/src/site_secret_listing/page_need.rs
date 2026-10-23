//! What the active tab's page currently needs from the "This site" listing.
//!
//! The content script classifies its page into an [`AuthenticationWorkflowMatch`]
//! as it does for the in-page widget; this module derives the listing filter
//! from that classification, so the workflow vocabulary has a single owner.

use super::{
    SiteSecretEmptyHint, SiteSecretKind, SiteSecretListingSummary, SiteSecretMessageKey,
    SiteSecretPageOffer,
};
use crate::{
    AuthenticationWorkflowAction, AuthenticationWorkflowKind, AuthenticationWorkflowMatch,
};
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
    /// The page shows an authenticator setup (its QR code or setup key):
    /// every site-bound kind, and the offer to add that authenticator.
    AuthenticatorSetup,
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
            AuthenticationWorkflowMatch::Matched(snapshot) => match snapshot.action {
                // A setup page, or its verify step while the QR code or setup
                // key is still shown, holds an authenticator Nook can add.
                AuthenticationWorkflowAction::EnrollAuthenticator
                | AuthenticationWorkflowAction::FillTotp
                    if snapshot.kind == AuthenticationWorkflowKind::TotpEnrollment =>
                {
                    Self::AuthenticatorSetup
                }
                AuthenticationWorkflowAction::ContinueWithNook
                | AuthenticationWorkflowAction::GeneratePassword
                | AuthenticationWorkflowAction::FillTotp
                | AuthenticationWorkflowAction::EnrollAuthenticator
                | AuthenticationWorkflowAction::UsePasskey
                | AuthenticationWorkflowAction::CreatePasskey
                | AuthenticationWorkflowAction::TakeOver
                | AuthenticationWorkflowAction::SaveBackupCodes => Self::from(snapshot.kind),
            },
        }
    }
}

impl SitePageNeed {
    /// What the panel offers for the page itself, beside its sections.
    pub(super) fn page_offer(self) -> SiteSecretPageOffer {
        match self {
            Self::AuthenticatorSetup => SiteSecretPageOffer::AddAuthenticator {
                label_key: SiteSecretMessageKey::catalog(
                    i18n_keys::EXTENSION_ACTION_SITE_ADD_AUTHENTICATOR,
                ),
            },
            Self::OneTimeCode | Self::Credentials | Self::AnySiteSecret => {
                SiteSecretPageOffer::Absent
            }
        }
    }

    /// The listing summary when no section has a row this need admits.
    pub(super) fn empty_summary(self) -> SiteSecretListingSummary {
        let save_hint = SiteSecretEmptyHint::Shown {
            message_key: SiteSecretMessageKey::catalog(i18n_keys::EXTENSION_ACTION_SITE_EMPTY_HINT),
        };
        match self {
            Self::OneTimeCode => SiteSecretListingSummary::Empty {
                message_key: SiteSecretMessageKey::catalog(
                    i18n_keys::EXTENSION_ACTION_SITE_EMPTY_TOTP,
                ),
                hint: SiteSecretEmptyHint::Absent,
            },
            Self::Credentials => SiteSecretListingSummary::Empty {
                message_key: SiteSecretMessageKey::catalog(i18n_keys::EXTENSION_ACTION_SITE_EMPTY),
                hint: save_hint,
            },
            Self::AnySiteSecret | Self::AuthenticatorSetup => SiteSecretListingSummary::Empty {
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
            SitePageNeed::AnySiteSecret | SitePageNeed::AuthenticatorSetup => match self {
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

#[cfg(test)]
mod authenticator_setup_tests {
    use super::*;
    use crate::{
        AuthenticationEnrollmentObservation, AuthenticationFieldCount,
        AuthenticationPageObservation,
    };

    fn add_authenticator_offer() -> SiteSecretPageOffer {
        SiteSecretPageOffer::AddAuthenticator {
            label_key: SiteSecretMessageKey::catalog(
                i18n_keys::EXTENSION_ACTION_SITE_ADD_AUTHENTICATOR,
            ),
        }
    }

    #[test]
    fn formless_setup_dialog_offers_to_add_the_authenticator() {
        let need = SitePageNeed::from(
            AuthenticationWorkflowMatch::authentication_enrollment_workflow_match(
                AuthenticationEnrollmentObservation {
                    authenticator_setup_hint: true.into(),
                    backup_codes_copy: "",
                    manual_checkpoint_present: false.into(),
                },
            ),
        );
        assert_eq!(need, SitePageNeed::AuthenticatorSetup);
        assert_eq!(need.page_offer(), add_authenticator_offer());
        // Replacing an authenticator keeps the saved one listed beside the offer.
        for kind in [
            SiteSecretKind::Login,
            SiteSecretKind::Authenticator,
            SiteSecretKind::Passkey,
            SiteSecretKind::ApiKey,
        ] {
            assert_eq!(kind.relevance(need), SiteSecretRelevance::Relevant);
        }
    }

    #[test]
    fn verify_step_that_still_shows_the_setup_offers_to_add_it() {
        let verify_beside_qr = AuthenticationPageObservation {
            one_time_code_field_count: AuthenticationFieldCount::from(1),
            authenticator_setup_hint: true,
            ..AuthenticationPageObservation::default()
        };
        let need = SitePageNeed::from(verify_beside_qr.classify_authentication_workflow());
        assert_eq!(need, SitePageNeed::AuthenticatorSetup);
        assert_eq!(need.page_offer(), add_authenticator_offer());
    }

    #[test]
    fn pages_without_a_setup_offer_nothing() {
        let backup_codes_only =
            AuthenticationWorkflowMatch::authentication_enrollment_workflow_match(
                AuthenticationEnrollmentObservation {
                    authenticator_setup_hint: false.into(),
                    backup_codes_copy: "Save your recovery codes",
                    manual_checkpoint_present: false.into(),
                },
            );
        let code_challenge = AuthenticationPageObservation {
            one_time_code_field_count: AuthenticationFieldCount::from(1),
            ..AuthenticationPageObservation::default()
        }
        .classify_authentication_workflow();
        for workflow in [
            backup_codes_only,
            code_challenge,
            AuthenticationWorkflowMatch::NoMatch,
            AuthenticationWorkflowMatch::Rejected,
        ] {
            assert_eq!(
                SitePageNeed::from(workflow).page_offer(),
                SiteSecretPageOffer::Absent,
                "{workflow:?}"
            );
        }
    }
}
