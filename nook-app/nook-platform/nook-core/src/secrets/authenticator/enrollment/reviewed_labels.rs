//! User-reviewed service and account labels applied when enrollment is saved.
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use super::AuthenticatorEnrollmentError;
use crate::{AuthenticatorSecret, ValidationError};
use std::cmp::Ordering;

const MAX_REVIEWED_ISSUER_CHARS: usize = 128;
const MAX_REVIEWED_ACCOUNT_CHARS: usize = 256;

/// Labels exactly as the user left them in the editable preview fields.
#[derive(Debug, Clone, Copy)]
pub struct AuthenticatorLabelReview<'a> {
    pub issuer: &'a str,
    pub account: &'a str,
}

/// A trimmed, required service name.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ReviewedIssuer(String);

/// A trimmed account name; empty means the service has no account label.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ReviewedAccount(String);

enum ControlCharacters {
    Present,
    Absent,
}

impl ControlCharacters {
    #[expect(
        clippy::match_bool,
        reason = "the character predicate is converted through a native pattern into a named presence"
    )]
    fn in_text(text: &str) -> Self {
        match text.chars().any(char::is_control) {
            true => Self::Present,
            false => Self::Absent,
        }
    }
}

impl TryFrom<&str> for ReviewedIssuer {
    type Error = AuthenticatorEnrollmentError;

    fn try_from(issuer: &str) -> Result<Self, Self::Error> {
        let issuer = issuer.trim();
        match issuer.chars().count() {
            0 => Err(ValidationError::AuthenticatorIssuerRequired.into()),
            1..=MAX_REVIEWED_ISSUER_CHARS => match ControlCharacters::in_text(issuer) {
                ControlCharacters::Absent => Ok(Self(issuer.to_owned())),
                ControlCharacters::Present => {
                    Err(AuthenticatorEnrollmentError::IssuerControlCharacter)
                }
            },
            _ => Err(AuthenticatorEnrollmentError::IssuerTooLong),
        }
    }
}

impl TryFrom<&str> for ReviewedAccount {
    type Error = AuthenticatorEnrollmentError;

    fn try_from(account: &str) -> Result<Self, Self::Error> {
        let account = account.trim();
        match account.chars().count().cmp(&MAX_REVIEWED_ACCOUNT_CHARS) {
            Ordering::Less | Ordering::Equal => match ControlCharacters::in_text(account) {
                ControlCharacters::Absent => Ok(Self(account.to_owned())),
                ControlCharacters::Present => {
                    Err(AuthenticatorEnrollmentError::AccountControlCharacter)
                }
            },
            Ordering::Greater => Err(AuthenticatorEnrollmentError::AccountTooLong),
        }
    }
}

/// Validated reviewed labels; they replace the decoded URI labels at save.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewedAuthenticatorLabels {
    issuer: ReviewedIssuer,
    account: ReviewedAccount,
}

impl TryFrom<AuthenticatorLabelReview<'_>> for ReviewedAuthenticatorLabels {
    type Error = AuthenticatorEnrollmentError;

    fn try_from(review: AuthenticatorLabelReview<'_>) -> Result<Self, Self::Error> {
        Ok(Self {
            issuer: ReviewedIssuer::try_from(review.issuer)?,
            account: ReviewedAccount::try_from(review.account)?,
        })
    }
}

impl AuthenticatorSecret {
    /// Replace the decoded issuer and account with the user's reviewed labels.
    #[must_use]
    pub fn with_reviewed_labels(mut self, labels: ReviewedAuthenticatorLabels) -> Self {
        let ReviewedAuthenticatorLabels {
            issuer: ReviewedIssuer(issuer),
            account: ReviewedAccount(account),
        } = labels;
        self.issuer = issuer;
        self.account = account;
        self
    }

    /// Associate the enrollment page; an empty origin keeps the decoded value.
    #[must_use]
    fn with_enrollment_page_origin(mut self, page_origin: &str) -> Self {
        match page_origin.trim() {
            "" => self,
            origin => {
                origin.clone_into(&mut self.website_url);
                self
            }
        }
    }
}

/// A consented save of one previewed `otpauth://totp/...` candidate.
#[derive(Debug, Clone, Copy)]
pub struct AuthenticatorEnrollmentSave<'a> {
    pub otpauth_uri: &'a str,
    pub page_origin: &'a str,
    pub reviewed_issuer: &'a str,
    pub reviewed_account: &'a str,
}

impl AuthenticatorEnrollmentSave<'_> {
    /// Validate the reviewed labels and URI, then build the item to persist.
    pub fn authenticator(&self) -> Result<AuthenticatorSecret, AuthenticatorEnrollmentError> {
        let labels = ReviewedAuthenticatorLabels::try_from(AuthenticatorLabelReview {
            issuer: self.reviewed_issuer,
            account: self.reviewed_account,
        })?;
        Ok(AuthenticatorSecret::from_otpauth_uri(self.otpauth_uri)?
            .with_reviewed_labels(labels)
            .with_enrollment_page_origin(self.page_origin)
            .normalize()?)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AuthenticatorEnrollmentSave, MAX_REVIEWED_ACCOUNT_CHARS, MAX_REVIEWED_ISSUER_CHARS,
    };
    use crate::{
        AuthenticatorEnrollmentError, TotpAlgorithm, TotpDigits, TotpPeriod, ValidationError,
    };

    const URI: &str = "otpauth://totp/Decoded:decoded-account?secret=JBSWY3DPEHPK3PXP&issuer=Decoded&algorithm=SHA256&digits=8&period=45";

    struct SaveFixture<'a> {
        issuer: &'a str,
        account: &'a str,
    }

    impl SaveFixture<'_> {
        fn save(&self) -> AuthenticatorEnrollmentSave<'_> {
            AuthenticatorEnrollmentSave {
                otpauth_uri: URI,
                page_origin: "https://www.example.com",
                reviewed_issuer: self.issuer,
                reviewed_account: self.account,
            }
        }
    }

    #[test]
    fn reviewed_labels_replace_decoded_labels_and_keep_the_uri_protocol() -> anyhow::Result<()> {
        let item = SaveFixture {
            issuer: "  Example Cloud ",
            account: " alice@example.com\n",
        }
        .save()
        .authenticator()?;

        assert_eq!(item.issuer, "Example Cloud");
        assert_eq!(item.account, "alice@example.com");
        assert_eq!(item.website_url, "https://www.example.com");
        assert_eq!(item.secret.as_str(), "JBSWY3DPEHPK3PXP");
        assert_eq!(item.algorithm, TotpAlgorithm::Sha256);
        assert_eq!(item.digits, TotpDigits::Eight);
        assert_eq!(item.period, TotpPeriod::try_from(45)?);
        Ok(())
    }

    #[test]
    fn account_is_optional_but_issuer_is_required() -> anyhow::Result<()> {
        let item = SaveFixture {
            issuer: "Example",
            account: "   ",
        }
        .save()
        .authenticator()?;
        assert_eq!(item.account, "");

        for issuer in ["", " \t "] {
            assert!(matches!(
                SaveFixture {
                    issuer,
                    account: "alice"
                }
                .save()
                .authenticator(),
                Err(AuthenticatorEnrollmentError::Validation(
                    ValidationError::AuthenticatorIssuerRequired
                ))
            ));
        }
        Ok(())
    }

    #[test]
    fn reviewed_labels_reject_control_characters_and_overlong_text() {
        assert!(matches!(
            SaveFixture {
                issuer: "Exa\u{0}mple",
                account: ""
            }
            .save()
            .authenticator(),
            Err(AuthenticatorEnrollmentError::IssuerControlCharacter)
        ));
        assert!(matches!(
            SaveFixture {
                issuer: "Example",
                account: "ali\nce"
            }
            .save()
            .authenticator(),
            Err(AuthenticatorEnrollmentError::AccountControlCharacter)
        ));
        let long_issuer = "é".repeat(MAX_REVIEWED_ISSUER_CHARS + 1);
        assert!(matches!(
            SaveFixture {
                issuer: &long_issuer,
                account: ""
            }
            .save()
            .authenticator(),
            Err(AuthenticatorEnrollmentError::IssuerTooLong)
        ));
        let bounded_issuer = "é".repeat(MAX_REVIEWED_ISSUER_CHARS);
        assert!(
            SaveFixture {
                issuer: &bounded_issuer,
                account: ""
            }
            .save()
            .authenticator()
            .is_ok()
        );
        let long_account = "a".repeat(MAX_REVIEWED_ACCOUNT_CHARS + 1);
        assert!(matches!(
            SaveFixture {
                issuer: "Example",
                account: &long_account
            }
            .save()
            .authenticator(),
            Err(AuthenticatorEnrollmentError::AccountTooLong)
        ));
    }

    #[test]
    fn invalid_uris_are_rejected_after_valid_labels() {
        for otpauth_uri in [
            "https://example.com",
            "otpauth://hotp/Example?secret=JBSWY3DPEHPK3PXP",
            "otpauth://totp/Example?secret=not-base32!",
        ] {
            assert!(matches!(
                AuthenticatorEnrollmentSave {
                    otpauth_uri,
                    page_origin: "https://example.com",
                    reviewed_issuer: "Example",
                    reviewed_account: "",
                }
                .authenticator(),
                Err(AuthenticatorEnrollmentError::Validation(_))
            ));
        }
    }

    #[test]
    fn empty_page_origin_keeps_the_decoded_website_association() -> anyhow::Result<()> {
        let item = AuthenticatorEnrollmentSave {
            otpauth_uri: "otpauth://totp/example.com:alice?secret=JBSWY3DPEHPK3PXP",
            page_origin: " ",
            reviewed_issuer: "example.com",
            reviewed_account: "alice",
        }
        .authenticator()?;
        assert_eq!(item.website_url, "https://example.com");
        Ok(())
    }
}
