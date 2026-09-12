#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Decoded parameter conversion preserves wire values and secret cleanup.
use crate::{
    AuthenticatorIssuerHostsError, AuthenticatorSecret, SecretValue, TotpAlgorithm, TotpDigits,
    TotpPeriod, TotpSecret,
};
use prost::Message;
use std::mem;
use zeroize::{Zeroize, Zeroizing};
#[derive(Clone, PartialEq, Message)]
pub(super) struct OtpParameters {
    #[prost(bytes = "vec", tag = "1")]
    pub(super) secret: Vec<u8>,
    #[prost(string, tag = "2")]
    pub(super) name: String,
    #[prost(string, tag = "3")]
    pub(super) issuer: String,
    #[prost(enumeration = "MigrationAlgorithm", tag = "4")]
    pub(super) algorithm: i32,
    #[prost(enumeration = "MigrationDigits", tag = "5")]
    pub(super) digits: i32,
    #[prost(enumeration = "MigrationOtpType", tag = "6")]
    pub(super) otp_type: i32,
    #[prost(int64, tag = "7")]
    pub(super) counter: i64,
}

impl Zeroize for OtpParameters {
    fn zeroize(&mut self) {
        self.secret.zeroize();
        self.name.zeroize();
        self.issuer.zeroize();
    }
}

impl Drop for OtpParameters {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, prost::Enumeration)]
pub(super) enum MigrationAlgorithm {
    Unspecified = 0,
    Sha1 = 1,
    Sha256 = 2,
    Sha512 = 3,
    Md5 = 4,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, prost::Enumeration)]
pub(super) enum MigrationDigits {
    Unspecified = 0,
    Six = 1,
    Eight = 2,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, prost::Enumeration)]
pub(super) enum MigrationOtpType {
    Unspecified = 0,
    Hotp = 1,
    Totp = 2,
}

impl OtpParameters {
    pub(super) fn convert(mut self) -> Result<SecretValue, OtpParameterError> {
        let secret_bytes = Zeroizing::new(mem::take(&mut self.secret));
        let name = Zeroizing::new(mem::take(&mut self.name));
        let issuer = Zeroizing::new(mem::take(&mut self.issuer));
        if MigrationOtpType::try_from(self.otp_type).ok() != Some(MigrationOtpType::Totp) {
            return Err(OtpParameterError::Unsupported);
        }
        let algorithm = match MigrationAlgorithm::try_from(self.algorithm).ok() {
            Some(MigrationAlgorithm::Sha1) => TotpAlgorithm::Sha1,
            Some(MigrationAlgorithm::Sha256) => TotpAlgorithm::Sha256,
            Some(MigrationAlgorithm::Sha512) => TotpAlgorithm::Sha512,
            _ => return Err(OtpParameterError::Unsupported),
        };
        let digits = match MigrationDigits::try_from(self.digits).ok() {
            Some(MigrationDigits::Unspecified | MigrationDigits::Six) => TotpDigits::try_from(6),
            Some(MigrationDigits::Eight) => TotpDigits::try_from(8),
            None => return Err(OtpParameterError::Unsupported),
        }
        .map_err(|_| OtpParameterError::Unsupported)?;
        let (account, issuer) = MigrationAccountLabel {
            name: &name,
            issuer: &issuer,
        }
        .split();
        let encoded_secret = Zeroizing::new(
            MigrationSecretBytes {
                bytes: &secret_bytes,
            }
            .base32()?,
        );
        let authenticator = AuthenticatorSecret {
            issuer,
            account,
            website_url: String::new(),
            secret: TotpSecret::parse(&encoded_secret)
                .map_err(|_| OtpParameterError::Unsupported)?,
            algorithm,
            digits,
            period: TotpPeriod::try_from(30).map_err(|_| OtpParameterError::Unsupported)?,
            backup_codes: Vec::new(),
        };
        let authenticator = authenticator
            .apply_inferred_website_url_if_empty()
            .map_err(OtpParameterError::IssuerCatalog)?
            .normalize()
            .map_err(|_| OtpParameterError::Unsupported)?;
        Ok(SecretValue::Authenticator(authenticator))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum OtpParameterError {
    Unsupported,
    IssuerCatalog(AuthenticatorIssuerHostsError),
}
struct MigrationSecretBytes<'a> {
    bytes: &'a [u8],
}
impl MigrationSecretBytes<'_> {
    fn base32(&self) -> Result<String, OtpParameterError> {
        const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        let mut output = String::with_capacity(self.bytes.len().div_ceil(5) * 8);
        let mut buffer = 0_u16;
        let mut bits = 0_u8;
        for byte in self.bytes {
            buffer = (buffer << 8) | u16::from(*byte);
            bits += 8;
            while bits >= 5 {
                bits -= 5;
                let index = usize::from((buffer >> bits) & 0x1f);
                let symbol = ALPHABET
                    .get(index)
                    .copied()
                    .ok_or(OtpParameterError::Unsupported)?;
                output.push(char::from(symbol));
            }
        }
        if bits > 0 {
            let index = usize::from((buffer << (5 - bits)) & 0x1f);
            let symbol = ALPHABET
                .get(index)
                .copied()
                .ok_or(OtpParameterError::Unsupported)?;
            output.push(char::from(symbol));
        }
        Ok(output)
    }
}
struct MigrationAccountLabel<'a> {
    name: &'a str,
    issuer: &'a str,
}
impl MigrationAccountLabel<'_> {
    fn split(&self) -> (String, String) {
        let name = self.name.trim();
        let issuer = self.issuer.trim();
        if !issuer.is_empty() {
            let account = name
                .strip_prefix(issuer)
                .and_then(|rest| rest.strip_prefix(':'))
                .unwrap_or(name)
                .trim();
            return (account.to_owned(), issuer.to_owned());
        }
        if let Some((label_issuer, account)) = name.split_once(':')
            && !label_issuer.trim().is_empty()
        {
            return (account.trim().to_owned(), label_issuer.trim().to_owned());
        }
        (name.to_owned(), name.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::MigrationParameterFixture;
    use super::{
        MigrationAccountLabel, MigrationAlgorithm, MigrationDigits, MigrationOtpType,
        MigrationSecretBytes,
    };
    use crate::{SecretValue, TotpDigits};

    #[test]
    fn base32_preserves_partial_byte_groups_without_padding() {
        for (bytes, expected) in [
            (b"".as_slice(), ""),
            (b"f".as_slice(), "MY"),
            (b"fo".as_slice(), "MZXQ"),
            (b"foo".as_slice(), "MZXW6"),
            (b"foob".as_slice(), "MZXW6YQ"),
            (b"fooba".as_slice(), "MZXW6YTB"),
            (b"foobar".as_slice(), "MZXW6YTBOI"),
        ] {
            assert_eq!(
                MigrationSecretBytes { bytes }.base32(),
                Ok(expected.to_owned())
            );
        }
    }

    #[test]
    fn labels_keep_case_sensitive_prefix_and_first_colon_rules() {
        for (name, issuer, account, expected_issuer) in [
            (" Example: alice ", " Example ", "alice", "Example"),
            ("example:alice", "Example", "example:alice", "Example"),
            ("Example:alice:second", "", "alice:second", "Example"),
            (" :alice ", "", ":alice", ":alice"),
            ("alice", "", "alice", "alice"),
        ] {
            assert_eq!(
                MigrationAccountLabel { name, issuer }.split(),
                (account.to_owned(), expected_issuer.to_owned())
            );
        }
    }

    #[test]
    fn unspecified_digits_default_but_unknown_wire_values_are_skipped() -> anyhow::Result<()> {
        let fixture = MigrationParameterFixture {
            secret_byte: 1,
            name: "alice",
            issuer: "Example",
            algorithm: MigrationAlgorithm::Sha1,
            digits: MigrationDigits::Unspecified,
            otp_type: MigrationOtpType::Totp,
        };
        let parameter = fixture.build();
        let SecretValue::Authenticator(item) = parameter
            .clone()
            .convert()
            .map_err(|_| anyhow::anyhow!("unspecified digits must default"))?
        else {
            anyhow::bail!("expected authenticator")
        };
        assert_eq!(item.digits, TotpDigits::Six);
        let mut invalid_algorithm = parameter.clone();
        invalid_algorithm.algorithm = 999;
        assert!(invalid_algorithm.convert().is_err());
        let mut invalid_digits = parameter.clone();
        invalid_digits.digits = 999;
        assert!(invalid_digits.convert().is_err());
        let mut invalid_type = parameter;
        invalid_type.otp_type = 999;
        assert!(invalid_type.convert().is_err());
        Ok(())
    }
}
