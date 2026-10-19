//! The one validation of user-reviewed authenticator labels, shared by the
//! preview (before the site enables 2FA) and the save.
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use super::AuthenticatorEnrollmentError;
use crate::AuthenticatorSecret;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

const MAX_REVIEWED_ISSUER_CHARS: usize = 128;
const MAX_REVIEWED_ACCOUNT_CHARS: usize = 256;

/// Service and account labels as the user left them in the editable preview.
#[derive(Debug, Clone, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NookReviewedAuthenticatorLabels {
    pub reviewed_issuer: String,
    pub reviewed_account: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum NookReviewedAuthenticatorLabelsVerdict {
    Valid,
    Invalid,
}

/// One trimmed label and its character bound.
struct BoundedLabel<'a> {
    text: &'a str,
    max_chars: usize,
}

impl BoundedLabel<'_> {
    #[expect(
        clippy::match_bool,
        reason = "the length and control-character predicates are converted through a native pattern"
    )]
    fn check(&self) -> Result<(), AuthenticatorEnrollmentError> {
        match self.text.chars().count() <= self.max_chars
            && !self.text.chars().any(char::is_control)
        {
            true => Ok(()),
            false => Err(AuthenticatorEnrollmentError::ReviewedLabelsInvalid),
        }
    }
}

impl NookReviewedAuthenticatorLabels {
    /// The service name is required (the existing authenticator rule); after
    /// trimming, the service name has at most 128 and the account at most 256
    /// characters, and neither contains a control character.
    pub fn validate(&self) -> Result<(), AuthenticatorEnrollmentError> {
        let issuer = self.reviewed_issuer.trim();
        AuthenticatorSecret::require_issuer(issuer)?;
        BoundedLabel {
            text: issuer,
            max_chars: MAX_REVIEWED_ISSUER_CHARS,
        }
        .check()?;
        BoundedLabel {
            text: self.reviewed_account.trim(),
            max_chars: MAX_REVIEWED_ACCOUNT_CHARS,
        }
        .check()
    }

    #[must_use]
    pub fn verdict(&self) -> NookReviewedAuthenticatorLabelsVerdict {
        match self.validate() {
            Ok(()) => NookReviewedAuthenticatorLabelsVerdict::Valid,
            Err(_) => NookReviewedAuthenticatorLabelsVerdict::Invalid,
        }
    }
}

/// A consented save of one previewed `otpauth://totp/...` candidate.
pub struct AuthenticatorEnrollmentSave<'a> {
    pub otpauth_uri: &'a str,
    pub page_origin: &'a str,
    pub labels: NookReviewedAuthenticatorLabels,
}

impl AuthenticatorEnrollmentSave<'_> {
    /// Validate the reviewed labels and URI, then build the item to persist.
    pub fn authenticator(self) -> Result<AuthenticatorSecret, AuthenticatorEnrollmentError> {
        self.labels.validate()?;
        let mut authenticator = AuthenticatorSecret::from_otpauth_uri(self.otpauth_uri)?;
        authenticator.issuer = self.labels.reviewed_issuer;
        authenticator.account = self.labels.reviewed_account;
        match self.page_origin.trim() {
            "" => {}
            origin => origin.clone_into(&mut authenticator.website_url),
        }
        Ok(authenticator.normalize()?)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AuthenticatorEnrollmentSave, NookReviewedAuthenticatorLabels,
        NookReviewedAuthenticatorLabelsVerdict,
    };
    use crate::{AuthenticatorEnrollmentError, TotpAlgorithm, TotpDigits, ValidationError};

    struct LabelFixture<'a> {
        issuer: &'a str,
        account: &'a str,
    }

    struct InvalidCase<'a> {
        fixture: LabelFixture<'a>,
        expected: &'a AuthenticatorEnrollmentError,
    }

    impl LabelFixture<'_> {
        fn labels(&self) -> NookReviewedAuthenticatorLabels {
            NookReviewedAuthenticatorLabels {
                reviewed_issuer: self.issuer.to_owned(),
                reviewed_account: self.account.to_owned(),
            }
        }

        fn save(&self) -> Result<crate::AuthenticatorSecret, AuthenticatorEnrollmentError> {
            AuthenticatorEnrollmentSave {
                otpauth_uri: "otpauth://totp/Decoded:decoded?secret=JBSWY3DPEHPK3PXP&issuer=Decoded&algorithm=SHA256&digits=8",
                page_origin: "https://www.example.com",
                labels: self.labels(),
            }
            .authenticator()
        }
    }

    #[test]
    fn valid_labels_pass_the_verdict_and_are_applied_at_save() -> anyhow::Result<()> {
        let bounded_issuer = "é".repeat(128);
        for fixture in [
            LabelFixture {
                issuer: "Example",
                account: "",
            },
            LabelFixture {
                issuer: " Example ",
                account: " alice\n",
            },
            LabelFixture {
                issuer: &bounded_issuer,
                account: "",
            },
        ] {
            assert_eq!(
                fixture.labels().verdict(),
                NookReviewedAuthenticatorLabelsVerdict::Valid
            );
            let item = fixture.save()?;
            assert_eq!(item.issuer, fixture.issuer.trim());
            assert_eq!(item.account, fixture.account.trim());
            assert_eq!(item.website_url, "https://www.example.com");
            assert_eq!(item.algorithm, TotpAlgorithm::Sha256);
            assert_eq!(item.digits, TotpDigits::Eight);
        }
        Ok(())
    }

    #[test]
    fn invalid_labels_fail_the_verdict_and_the_save_alike() {
        let long_issuer = "é".repeat(129);
        let long_account = "a".repeat(257);
        let required =
            AuthenticatorEnrollmentError::Validation(ValidationError::AuthenticatorIssuerRequired);
        for InvalidCase { fixture, expected } in [
            InvalidCase {
                fixture: LabelFixture {
                    issuer: "",
                    account: "alice",
                },
                expected: &required,
            },
            InvalidCase {
                fixture: LabelFixture {
                    issuer: " \t ",
                    account: "",
                },
                expected: &required,
            },
            InvalidCase {
                fixture: LabelFixture {
                    issuer: "Exa\u{0}mple",
                    account: "",
                },
                expected: &AuthenticatorEnrollmentError::ReviewedLabelsInvalid,
            },
            InvalidCase {
                fixture: LabelFixture {
                    issuer: "Example",
                    account: "ali\nce",
                },
                expected: &AuthenticatorEnrollmentError::ReviewedLabelsInvalid,
            },
            InvalidCase {
                fixture: LabelFixture {
                    issuer: &long_issuer,
                    account: "",
                },
                expected: &AuthenticatorEnrollmentError::ReviewedLabelsInvalid,
            },
            InvalidCase {
                fixture: LabelFixture {
                    issuer: "Example",
                    account: &long_account,
                },
                expected: &AuthenticatorEnrollmentError::ReviewedLabelsInvalid,
            },
        ] {
            assert_eq!(
                fixture.labels().verdict(),
                NookReviewedAuthenticatorLabelsVerdict::Invalid
            );
            assert!(matches!(fixture.save(), Err(error) if &error == expected));
        }
    }
}
