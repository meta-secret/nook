//! Canonical `otpauth://totp/...` serialization for an admitted authenticator.
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use super::AuthenticatorSecret;
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use std::fmt::{self, Write};
use zeroize::Zeroizing;

/// RFC 3986 unreserved characters stay literal; everything else is escaped, so
/// `:`, `&`, `=`, `+`, `%`, and spaces cannot change the label or query shape.
const OTPAUTH_COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

/// Literal URI text: `otpauth://totp/:`, `?secret=`, `&issuer=`,
/// `&algorithm=`, `&digits=`, and `&period=`.
const URI_LITERAL_BYTES: usize = 59;
/// Rendered algorithm, digit count, and period: at most `SHA512`, one digit,
/// and a `u64` period.
const URI_PARAMETER_BYTES: usize = 6 + 1 + 20;
/// Percent-encoding expands one input byte to at most three output bytes.
const PERCENT_ENCODED_BYTES_PER_BYTE: usize = 3;

impl AuthenticatorSecret {
    /// Serialize the issuer, account, shared secret, and TOTP parameters as a
    /// canonical `otpauth://totp/` URI that [`Self::from_otpauth_uri`] admits.
    ///
    /// The label is `:{account}`: the authoritative issuer travels in the
    /// `issuer` query parameter, which the parser prefers. Leaving the label's
    /// issuer prefix empty keeps the account exact even when the issuer itself
    /// contains `:`, because the parser splits the decoded label at its first
    /// colon. The website URL is not part of the URI; the save path supplies it.
    ///
    /// The URI is written into one zeroizing buffer sized for the worst-case
    /// encoding, so no secret-bearing buffer is reallocated and freed unwiped.
    pub fn otpauth_uri(&self) -> Result<Zeroizing<String>, fmt::Error> {
        let mut uri = Zeroizing::new(String::with_capacity(self.otpauth_uri_capacity()));
        write!(
            uri,
            "otpauth://totp/:{account}?secret={secret}&issuer={issuer}&algorithm={algorithm}&digits={digits}&period={period}",
            account = utf8_percent_encode(&self.account, OTPAUTH_COMPONENT),
            secret = utf8_percent_encode(self.secret.as_str(), OTPAUTH_COMPONENT),
            issuer = utf8_percent_encode(&self.issuer, OTPAUTH_COMPONENT),
            algorithm = self.algorithm.as_str(),
            digits = self.digits,
            period = self.period,
        )?;
        Ok(uri)
    }

    fn otpauth_uri_capacity(&self) -> usize {
        let encoded_inputs = self.account.len() + self.secret.as_str().len() + self.issuer.len();
        URI_LITERAL_BYTES + URI_PARAMETER_BYTES + PERCENT_ENCODED_BYTES_PER_BYTE * encoded_inputs
    }
}

#[cfg(test)]
mod tests {
    use crate::{AuthenticatorSecret, TotpAlgorithm, TotpDigits, TotpPeriod, TotpSecret};

    struct LabelFixture<'a> {
        issuer: &'a str,
        account: &'a str,
    }

    impl LabelFixture<'_> {
        fn authenticator(&self) -> anyhow::Result<AuthenticatorSecret> {
            Ok(AuthenticatorSecret {
                issuer: self.issuer.to_owned(),
                account: self.account.to_owned(),
                website_url: String::new(),
                secret: TotpSecret::parse("JBSWY3DPEHPK3PXP")?,
                algorithm: TotpAlgorithm::Sha256,
                digits: TotpDigits::Eight,
                period: TotpPeriod::try_from(45)?,
                backup_codes: Vec::new(),
            })
        }
    }

    #[test]
    fn serialized_uri_round_trips_labels_and_parameters_through_the_parser() -> anyhow::Result<()> {
        for fixture in [
            LabelFixture {
                issuer: "Example Co",
                account: "alice+alerts@example.com",
            },
            LabelFixture {
                issuer: "a:b&c=d%e",
                account: "x:y?z#w",
            },
            LabelFixture {
                issuer: "Ünïcode 服务",
                account: "",
            },
        ] {
            let original = fixture.authenticator()?;
            let uri = original.otpauth_uri()?;
            let parsed = AuthenticatorSecret::from_otpauth_uri(&uri)?;

            assert_eq!(parsed.issuer, fixture.issuer);
            assert_eq!(parsed.account, fixture.account);
            assert_eq!(parsed.secret, original.secret);
            assert_eq!(parsed.algorithm, TotpAlgorithm::Sha256);
            assert_eq!(parsed.digits, TotpDigits::Eight);
            assert_eq!(parsed.period, TotpPeriod::try_from(45)?);
        }
        Ok(())
    }

    #[test]
    fn worst_case_encoding_fits_the_presized_buffer_without_reallocation() -> anyhow::Result<()> {
        let issuer = "\u{1f511}&".repeat(32);
        let account = "%\u{e9} ".repeat(64);
        let original = LabelFixture {
            issuer: &issuer,
            account: &account,
        }
        .authenticator()?;
        let capacity = original.otpauth_uri_capacity();
        let uri = original.otpauth_uri()?;

        assert!(uri.len() <= capacity, "{} > {capacity}", uri.len());
        assert!(uri.capacity() >= capacity);
        assert_eq!(AuthenticatorSecret::from_otpauth_uri(&uri)?.issuer, issuer);
        Ok(())
    }

    #[test]
    fn serialized_uri_escapes_reserved_label_and_query_characters() -> anyhow::Result<()> {
        let uri = LabelFixture {
            issuer: "A&B",
            account: "c d+e",
        }
        .authenticator()?
        .otpauth_uri()?;

        assert_eq!(
            uri.as_str(),
            "otpauth://totp/:c%20d%2Be?secret=JBSWY3DPEHPK3PXP&issuer=A%26B&algorithm=SHA256&digits=8&period=45"
        );
        Ok(())
    }
}
