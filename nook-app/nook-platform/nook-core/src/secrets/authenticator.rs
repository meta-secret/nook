//! RFC 6238 TOTP parsing, validation, and code generation.

#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::ValidationError;
use crate::authenticator_issuer_hosts::AuthenticatorHostResolution;
use crate::secrets::authenticator_issuer_hosts::{
    AuthenticatorIssuerHosts, AuthenticatorIssuerHostsError, AuthenticatorWebsiteHostRequest,
};
use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Sha256, Sha512};
use zeroize::Zeroize;

mod backup_codes;
mod setup_key;
mod uri;
use uri::{FormProtocolInput, OtpauthInput, ProtocolParameters};

pub use backup_codes::*;
pub use nook_authenticator_domain::{BackupCodeAttachMode, TotpAlgorithm, TotpDigits, TotpPeriod};

/// Non-secret metadata from a validated `otpauth://totp/...` URI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OtpauthPreview {
    pub issuer: String,
    pub account: String,
    pub website_url: String,
    pub algorithm: TotpAlgorithm,
    pub digits: TotpDigits,
    pub period: TotpPeriod,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct TotpSecret(String);

impl TotpSecret {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Zeroize for TotpSecret {
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl Drop for TotpSecret {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatorSecret {
    pub issuer: String,
    #[serde(default)]
    pub account: String,
    /// Optional website association for vault clustering and login pairing.
    ///
    /// Empty for legacy items and for services without a browser origin. When
    /// unset at create/import time, Nook may infer `https://{host}` from a
    /// domain-like issuer or the bundled popular-issuer map.
    #[serde(default)]
    pub website_url: String,
    pub secret: TotpSecret,
    #[serde(default)]
    pub algorithm: TotpAlgorithm,
    #[serde(default)]
    pub digits: TotpDigits,
    #[serde(default)]
    pub period: TotpPeriod,
    #[serde(default)]
    pub backup_codes: Vec<String>,
}

impl AuthenticatorSecret {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.issuer.trim().is_empty() {
            return Err(ValidationError::AuthenticatorIssuerRequired);
        }
        TotpSecret::parse(self.secret.as_str())?;
        Ok(())
    }

    pub fn normalize(mut self) -> Result<Self, ValidationError> {
        self.issuer = self.issuer.trim().to_owned();
        self.account = self.account.trim().to_owned();
        self.website_url = self.website_url.trim().to_owned();
        self.secret = TotpSecret::parse(self.secret.as_str())?;
        let normalized_backup_codes =
            backup_codes::BackupCodeInput::new(&self.backup_codes).soft_normalized();
        self.backup_codes.zeroize();
        self.backup_codes = normalized_backup_codes;
        self.validate()?;
        Ok(self)
    }

    /// Fill [`Self::website_url`] from issuer host text or the popular-issuer map.
    pub fn apply_inferred_website_url_if_empty(
        mut self,
    ) -> Result<Self, AuthenticatorIssuerHostsError> {
        if !self.website_url.trim().is_empty() {
            return Ok(self);
        }
        let request = AuthenticatorWebsiteHostRequest {
            website_url: "",
            issuer: &self.issuer,
        };
        let host = if let AuthenticatorHostResolution::Resolved(host) =
            request.explicit_or_domain_host()
        {
            AuthenticatorHostResolution::Resolved(host)
        } else {
            AuthenticatorIssuerHosts::require_bundled()?.resolve_website_host(request)
        };
        if let AuthenticatorHostResolution::Resolved(host) = host {
            self.website_url = format!("https://{}", host.as_str());
        }
        Ok(self)
    }

    pub fn current_code(&self, unix_seconds: TotpUnixSeconds) -> Result<TotpCode, ValidationError> {
        self.validate()?;
        let unix_seconds = u64::from(unix_seconds);
        let period = self.period.duration().as_secs();
        let counter = unix_seconds / period;
        let key = self.secret.decoded()?;
        let counter_bytes = counter.to_be_bytes();
        let digest = match self.algorithm {
            TotpAlgorithm::Sha1 => {
                let mut mac = Hmac::<Sha1>::new_from_slice(&key)
                    .map_err(|_| ValidationError::AuthenticatorSecretInvalid)?;
                mac.update(&counter_bytes);
                mac.finalize().into_bytes().to_vec()
            }
            TotpAlgorithm::Sha256 => {
                let mut mac = Hmac::<Sha256>::new_from_slice(&key)
                    .map_err(|_| ValidationError::AuthenticatorSecretInvalid)?;
                mac.update(&counter_bytes);
                mac.finalize().into_bytes().to_vec()
            }
            TotpAlgorithm::Sha512 => {
                let mut mac = Hmac::<Sha512>::new_from_slice(&key)
                    .map_err(|_| ValidationError::AuthenticatorSecretInvalid)?;
                mac.update(&counter_bytes);
                mac.finalize().into_bytes().to_vec()
            }
        };
        let Some(last) = digest.last() else {
            return Err(ValidationError::AuthenticatorSecretInvalid);
        };
        let offset = usize::from(last & 0x0f);
        let Some([first, second, third, fourth]) = digest.get(offset..offset + 4) else {
            return Err(ValidationError::AuthenticatorSecretInvalid);
        };
        let binary = (u32::from(first & 0x7f) << 24)
            | (u32::from(*second) << 16)
            | (u32::from(*third) << 8)
            | u32::from(*fourth);
        let (modulus, width) = match self.digits {
            TotpDigits::Six => (1_000_000, 6),
            TotpDigits::Seven => (10_000_000, 7),
            TotpDigits::Eight => (100_000_000, 8),
        };
        let code = format!("{:0width$}", binary % modulus, width = width);
        Ok(TotpCode {
            code,
            seconds_remaining: (period - (unix_seconds % period)).into(),
            period: self.period,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn from_form_fields(
        issuer: &str,
        account: &str,
        secret_or_uri: &str,
        algorithm: &str,
        digits: &str,
        period: &str,
        backup_codes: &str,
        website_url: &str,
    ) -> Result<Self, ValidationError> {
        let mut item = if secret_or_uri.trim().starts_with("otpauth://") {
            Self::from_otpauth_uri(secret_or_uri)?
        } else {
            let secret = TotpSecret::parse(secret_or_uri)?;
            let protocol = ProtocolParameters::from_form(&FormProtocolInput {
                algorithm,
                digits,
                period,
            })?;
            Self {
                issuer: issuer.to_owned(),
                account: account.to_owned(),
                website_url: website_url.to_owned(),
                secret,
                algorithm: protocol.algorithm,
                digits: protocol.digits,
                period: protocol.period,
                backup_codes: Vec::new(),
            }
        };
        if !issuer.trim().is_empty() {
            issuer.clone_into(&mut item.issuer);
        }
        if !account.trim().is_empty() {
            account.clone_into(&mut item.account);
        }
        if !website_url.trim().is_empty() {
            website_url.clone_into(&mut item.website_url);
        }
        item.backup_codes = backup_codes.lines().map(str::to_owned).collect();
        item.apply_inferred_website_url_if_empty()
            .map_err(|_| ValidationError::AuthenticatorIssuerCatalogInvalid)?
            .normalize()
    }

    pub fn from_otpauth_uri(uri: &str) -> Result<Self, ValidationError> {
        OtpauthInput(uri).into_authenticator()
    }

    /// Validate an `otpauth://totp/...` URI and return non-secret preview fields.
    pub fn preview_otpauth_uri(uri: &str) -> Result<OtpauthPreview, ValidationError> {
        let item = Self::from_otpauth_uri(uri)?;
        Ok(OtpauthPreview {
            issuer: item.issuer.clone(),
            account: item.account.clone(),
            website_url: item.website_url.clone(),
            algorithm: item.algorithm,
            digits: item.digits,
            period: item.period,
        })
    }

    /// Generate the current TOTP for a validated `otpauth://` URI without persisting it.
    pub fn current_code_from_otpauth_uri(
        uri: &str,
        unix_seconds: TotpUnixSeconds,
    ) -> Result<TotpCode, ValidationError> {
        Self::from_otpauth_uri(uri)?.current_code(unix_seconds)
    }
}

impl Zeroize for AuthenticatorSecret {
    fn zeroize(&mut self) {
        self.issuer.zeroize();
        self.account.zeroize();
        self.website_url.zeroize();
        self.secret.zeroize();
        self.backup_codes.zeroize();
    }
}

impl Drop for AuthenticatorSecret {
    fn drop(&mut self) {
        self.zeroize();
    }
}

/// Unix timestamp used to select a time-based one-time-password window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TotpUnixSeconds(u64);

impl From<u64> for TotpUnixSeconds {
    fn from(value: u64) -> Self {
        Self(value)
    }
}

impl From<TotpUnixSeconds> for u64 {
    fn from(value: TotpUnixSeconds) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TotpRemainingSeconds(u64);

impl From<u64> for TotpRemainingSeconds {
    fn from(value: u64) -> Self {
        Self(value)
    }
}

impl From<TotpRemainingSeconds> for u64 {
    fn from(value: TotpRemainingSeconds) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TotpCode {
    pub code: String,
    pub seconds_remaining: TotpRemainingSeconds,
    pub period: TotpPeriod,
}

#[cfg(test)]
mod tests {
    use super::{AuthenticatorSecret, TotpAlgorithm, TotpDigits, TotpPeriod, TotpSecret};
    use zeroize::Zeroize;

    struct RfcTotpFixture<'a> {
        algorithm: TotpAlgorithm,
        secret: &'a [u8],
    }

    impl RfcTotpFixture<'_> {
        fn secret(&self) -> anyhow::Result<TotpSecret> {
            let encoded = match self.secret.len() {
                20 => "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
                32 => "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA",
                64 => {
                    "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA"
                }
                _ => panic!("unsupported fixture"),
            };
            Ok(TotpSecret::parse(encoded)?)
        }

        fn authenticator(&self) -> anyhow::Result<AuthenticatorSecret> {
            Ok(AuthenticatorSecret {
                issuer: "RFC".to_owned(),
                account: "test".to_owned(),
                website_url: String::new(),
                secret: self.secret()?,
                algorithm: self.algorithm,
                digits: TotpDigits::try_from(8)?,
                period: TotpPeriod::default(),
                backup_codes: Vec::new(),
            })
        }
    }

    #[test]
    fn matches_rfc_6238_test_vectors() -> anyhow::Result<()> {
        let sha1 = b"12345678901234567890";
        let sha256 = b"12345678901234567890123456789012";
        let sha512 = b"1234567890123456789012345678901234567890123456789012345678901234";
        let cases = [
            (59, "94287082", "46119246", "90693936"),
            (1_111_111_109, "07081804", "68084774", "25091201"),
            (1_111_111_111, "14050471", "67062674", "99943326"),
            (1_234_567_890, "89005924", "91819424", "93441116"),
            (2_000_000_000, "69279037", "90698825", "38618901"),
            (20_000_000_000, "65353130", "77737706", "47863826"),
        ];
        for (timestamp, expected_sha1, expected_sha256, expected_sha512) in cases {
            assert_eq!(
                RfcTotpFixture {
                    algorithm: TotpAlgorithm::Sha1,
                    secret: sha1
                }
                .authenticator()?
                .current_code(timestamp.into())?
                .code,
                expected_sha1
            );
            assert_eq!(
                RfcTotpFixture {
                    algorithm: TotpAlgorithm::Sha256,
                    secret: sha256
                }
                .authenticator()?
                .current_code(timestamp.into())?
                .code,
                expected_sha256
            );
            assert_eq!(
                RfcTotpFixture {
                    algorithm: TotpAlgorithm::Sha512,
                    secret: sha512
                }
                .authenticator()?
                .current_code(timestamp.into())?
                .code,
                expected_sha512
            );
        }
        Ok(())
    }

    #[test]
    fn parses_google_authenticator_uri_and_normalizes_backup_codes() -> anyhow::Result<()> {
        let mut item = AuthenticatorSecret::from_form_fields(
            "",
            "",
            "otpauth://totp/Example%20Co:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example%20Co&algorithm=SHA256&digits=8&period=45",
            "",
            "",
            "",
            " first-code \nsecond-code\nfirst-code\n",
            "",
        )?;
        assert_eq!(item.issuer, "Example Co");
        assert_eq!(item.account, "alice@example.com");
        assert_eq!(item.algorithm, TotpAlgorithm::Sha256);
        assert_eq!(item.digits, TotpDigits::Eight);
        assert_eq!(item.period.duration().as_secs(), 45);
        assert_eq!(item.backup_codes, ["first-code", "second-code"]);
        item.zeroize();
        assert!(item.secret.as_str().is_empty());
        Ok(())
    }

    #[test]
    fn canonicalizes_base32_padding() -> anyhow::Result<()> {
        let padded = TotpSecret::parse("JBSWY3DPEHPK3PXP====")?;
        let unpadded = TotpSecret::parse("JBSWY3DPEHPK3PXP")?;

        assert_eq!(padded, unpadded);
        assert_eq!(padded.as_str(), "JBSWY3DPEHPK3PXP");
        Ok(())
    }

    #[test]
    fn setup_key_change_detection_uses_canonical_base32() -> anyhow::Result<()> {
        assert!(
            !TotpSecret::parse("JBSWY3DPEHPK3PXP")?
                .replacement_differs("jbsw-y3dp ehpk-3pxp====",)?
        );
        assert!(TotpSecret::parse("JBSWY3DPEHPK3PXP")?.replacement_differs("KRUGS4ZANFZSAYJA",)?);
        assert!(TotpSecret::parse("JBSWY3DPEHPK3PXP")?.replacement_differs(
            "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA256",
        )?);
        Ok(())
    }

    #[test]
    fn preserves_plus_signs_in_otpauth_labels() -> anyhow::Result<()> {
        let item = AuthenticatorSecret::from_otpauth_uri(
            "otpauth://totp/Example%3Aalice%2Balerts%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example",
        )?;

        assert_eq!(item.account, "alice+alerts@example.com");
        Ok(())
    }

    #[test]
    fn current_code_from_otpauth_matches_persisted_secret() -> anyhow::Result<()> {
        let uri = "otpauth://totp/Mock%20Auth:alice-2fa%40nook.test?secret=JBSWY3DPEHPK3PXP&issuer=Mock%20Auth";
        let from_uri = AuthenticatorSecret::current_code_from_otpauth_uri(uri, 59.into())?;
        let from_secret = AuthenticatorSecret::from_otpauth_uri(uri)?.current_code(59.into())?;
        assert_eq!(from_uri.code, from_secret.code);
        assert_eq!(u64::from(from_uri.seconds_remaining), 1);
        assert_eq!(from_uri.period, TotpPeriod::default());
        Ok(())
    }

    #[test]
    fn rejects_short_or_invalid_base32_secrets_and_parameters() {
        assert!(TotpSecret::parse("not base32!").is_err());
        assert!(TotpSecret::parse("JBSWY3DP").is_err());
        assert!(TotpDigits::try_from(5).is_err());
        assert!(TotpPeriod::try_from(10).is_err());
    }

    #[test]
    fn previews_otpauth_without_exposing_secret_fields_elsewhere() -> anyhow::Result<()> {
        let preview = AuthenticatorSecret::preview_otpauth_uri(
            "otpauth://totp/Example%20Co:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example%20Co&algorithm=SHA256&digits=8&period=45",
        )?;
        assert_eq!(preview.issuer, "Example Co");
        assert_eq!(preview.account, "alice@example.com");
        assert_eq!(preview.algorithm, TotpAlgorithm::Sha256);
        assert_eq!(preview.digits, TotpDigits::Eight);
        assert_eq!(preview.period.duration().as_secs(), 45);
        assert!(
            AuthenticatorSecret::preview_otpauth_uri("otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP")
                .is_err()
        );
        assert!(AuthenticatorSecret::preview_otpauth_uri("https://example.com").is_err());
        Ok(())
    }
}
