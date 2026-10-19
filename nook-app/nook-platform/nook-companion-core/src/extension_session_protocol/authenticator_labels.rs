//! Reviewed authenticator labels carried by the enrollment confirm request.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use tsify::Tsify;

/// Transport bounds only: UTF-8 worst case of the 128-character service name and
/// 256-character account limits. `nook-core` owns trimming, the required service
/// name, the character limits, and control-character rejection at save.
const MAX_REVIEWED_ISSUER_BYTES: usize = 512;
const MAX_REVIEWED_ACCOUNT_BYTES: usize = 1024;

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum ReviewedAuthenticatorLabelTextError {
    #[error("reviewed authenticator service name exceeds the transport limit")]
    IssuerTooLong,
    #[error("reviewed authenticator account name exceeds the transport limit")]
    AccountTooLong,
}

/// The service name the user reviewed in the enrollment preview.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(try_from = "String", into = "String")]
#[tsify(type = "string")]
pub struct ReviewedAuthenticatorIssuerText(String);

impl TryFrom<String> for ReviewedAuthenticatorIssuerText {
    type Error = ReviewedAuthenticatorLabelTextError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.len().cmp(&MAX_REVIEWED_ISSUER_BYTES) {
            Ordering::Less | Ordering::Equal => Ok(Self(value)),
            Ordering::Greater => Err(ReviewedAuthenticatorLabelTextError::IssuerTooLong),
        }
    }
}

impl From<ReviewedAuthenticatorIssuerText> for String {
    fn from(value: ReviewedAuthenticatorIssuerText) -> Self {
        let ReviewedAuthenticatorIssuerText(issuer) = value;
        issuer
    }
}

impl ReviewedAuthenticatorIssuerText {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(issuer) = self;
        issuer
    }
}

/// The account name the user reviewed in the enrollment preview; may be empty.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(try_from = "String", into = "String")]
#[tsify(type = "string")]
pub struct ReviewedAuthenticatorAccountText(String);

impl TryFrom<String> for ReviewedAuthenticatorAccountText {
    type Error = ReviewedAuthenticatorLabelTextError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.len().cmp(&MAX_REVIEWED_ACCOUNT_BYTES) {
            Ordering::Less | Ordering::Equal => Ok(Self(value)),
            Ordering::Greater => Err(ReviewedAuthenticatorLabelTextError::AccountTooLong),
        }
    }
}

impl From<ReviewedAuthenticatorAccountText> for String {
    fn from(value: ReviewedAuthenticatorAccountText) -> Self {
        let ReviewedAuthenticatorAccountText(account) = value;
        account
    }
}

impl ReviewedAuthenticatorAccountText {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(account) = self;
        account
    }
}

#[cfg(test)]
mod tests {
    use super::{
        MAX_REVIEWED_ACCOUNT_BYTES, MAX_REVIEWED_ISSUER_BYTES, ReviewedAuthenticatorAccountText,
        ReviewedAuthenticatorIssuerText, ReviewedAuthenticatorLabelTextError,
    };

    #[test]
    fn reviewed_label_text_bounds_transport_size_and_preserves_content() -> anyhow::Result<()> {
        let issuer = ReviewedAuthenticatorIssuerText::try_from(" Example\n".to_owned())?;
        assert_eq!(issuer.as_str(), " Example\n");
        let account = ReviewedAuthenticatorAccountText::try_from(String::new())?;
        assert_eq!(account.as_str(), "");
        assert!(ReviewedAuthenticatorIssuerText::try_from("é".repeat(256)).is_ok());
        assert_eq!(
            ReviewedAuthenticatorIssuerText::try_from("x".repeat(MAX_REVIEWED_ISSUER_BYTES + 1)),
            Err(ReviewedAuthenticatorLabelTextError::IssuerTooLong)
        );
        assert!(ReviewedAuthenticatorAccountText::try_from("é".repeat(512)).is_ok());
        assert_eq!(
            ReviewedAuthenticatorAccountText::try_from("x".repeat(MAX_REVIEWED_ACCOUNT_BYTES + 1)),
            Err(ReviewedAuthenticatorLabelTextError::AccountTooLong)
        );
        assert_eq!(serde_json::to_string(&issuer)?, r#"" Example\n""#);
        let oversize = serde_json::to_string(&"x".repeat(MAX_REVIEWED_ISSUER_BYTES + 1))?;
        assert!(serde_json::from_str::<ReviewedAuthenticatorIssuerText>(&oversize).is_err());
        Ok(())
    }
}
