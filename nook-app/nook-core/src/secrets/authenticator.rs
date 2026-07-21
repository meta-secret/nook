//! RFC 6238 TOTP parsing, validation, and code generation.

use crate::ValidationError;
use hmac::{Hmac, Mac};
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Sha256, Sha512};
use std::collections::HashMap;
use zeroize::{Zeroize, Zeroizing};

const DEFAULT_DIGITS: u32 = 6;
const DEFAULT_PERIOD: u64 = 30;
const MIN_SECRET_BYTES: usize = 10;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum TotpAlgorithm {
    #[default]
    Sha1,
    Sha256,
    Sha512,
}

impl TotpAlgorithm {
    pub fn parse(value: &str) -> Result<Self, ValidationError> {
        match value.trim().to_ascii_uppercase().as_str() {
            "" | "SHA1" => Ok(Self::Sha1),
            "SHA256" => Ok(Self::Sha256),
            "SHA512" => Ok(Self::Sha512),
            _ => Err(ValidationError::AuthenticatorUriInvalid),
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Sha1 => "SHA1",
            Self::Sha256 => "SHA256",
            Self::Sha512 => "SHA512",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct TotpDigits(u32);

impl Default for TotpDigits {
    fn default() -> Self {
        Self(DEFAULT_DIGITS)
    }
}

impl TotpDigits {
    pub fn parse(value: u32) -> Result<Self, ValidationError> {
        if (6..=8).contains(&value) {
            Ok(Self(value))
        } else {
            Err(ValidationError::AuthenticatorDigitsInvalid)
        }
    }

    #[must_use]
    pub const fn get(self) -> u32 {
        self.0
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct TotpPeriod(u64);

impl Default for TotpPeriod {
    fn default() -> Self {
        Self(DEFAULT_PERIOD)
    }
}

impl TotpPeriod {
    pub fn parse(value: u64) -> Result<Self, ValidationError> {
        if (15..=300).contains(&value) {
            Ok(Self(value))
        } else {
            Err(ValidationError::AuthenticatorPeriodInvalid)
        }
    }

    #[must_use]
    pub const fn get(self) -> u64 {
        self.0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct TotpSecret(String);

impl TotpSecret {
    pub fn parse(value: &str) -> Result<Self, ValidationError> {
        let mut normalized = Zeroizing::new(normalize_base32(value));
        let decoded = Zeroizing::new(decode_base32(&normalized)?);
        if decoded.len() < MIN_SECRET_BYTES {
            return Err(ValidationError::AuthenticatorSecretInvalid);
        }
        Ok(Self(std::mem::take(&mut *normalized)))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn decoded(&self) -> Result<Zeroizing<Vec<u8>>, ValidationError> {
        decode_base32(&self.0).map(Zeroizing::new)
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
        TotpDigits::parse(self.digits.get())?;
        TotpPeriod::parse(self.period.get())?;
        Ok(())
    }

    pub fn normalize(&mut self) -> Result<(), ValidationError> {
        self.issuer = self.issuer.trim().to_owned();
        self.account = self.account.trim().to_owned();
        self.website_url = self.website_url.trim().to_owned();
        self.secret = TotpSecret::parse(self.secret.as_str())?;
        self.digits = TotpDigits::parse(self.digits.get())?;
        self.period = TotpPeriod::parse(self.period.get())?;
        let normalized_backup_codes = normalize_backup_codes(&self.backup_codes);
        self.backup_codes.zeroize();
        self.backup_codes = normalized_backup_codes;
        self.validate()
    }

    /// Fill [`Self::website_url`] from issuer host text or the popular-issuer map.
    pub fn apply_inferred_website_url_if_empty(&mut self) {
        if !self.website_url.trim().is_empty() {
            return;
        }
        if let Some(host) =
            crate::secrets::authenticator_issuer_hosts::resolve_authenticator_website_host(
                "",
                &self.issuer,
            )
        {
            self.website_url = format!("https://{host}");
        }
    }

    pub fn current_code(&self, unix_seconds: u64) -> Result<TotpCode, ValidationError> {
        self.validate()?;
        let period = self.period.get();
        let counter = unix_seconds / period;
        let key = self.secret.decoded()?;
        let counter_bytes = counter.to_be_bytes();
        let digest = match self.algorithm {
            TotpAlgorithm::Sha1 => {
                let mut mac =
                    Hmac::<Sha1>::new_from_slice(&key).expect("HMAC accepts any key length");
                mac.update(&counter_bytes);
                mac.finalize().into_bytes().to_vec()
            }
            TotpAlgorithm::Sha256 => {
                let mut mac =
                    Hmac::<Sha256>::new_from_slice(&key).expect("HMAC accepts any key length");
                mac.update(&counter_bytes);
                mac.finalize().into_bytes().to_vec()
            }
            TotpAlgorithm::Sha512 => {
                let mut mac =
                    Hmac::<Sha512>::new_from_slice(&key).expect("HMAC accepts any key length");
                mac.update(&counter_bytes);
                mac.finalize().into_bytes().to_vec()
            }
        };
        let offset = usize::from(digest[digest.len() - 1] & 0x0f);
        let binary = (u32::from(digest[offset] & 0x7f) << 24)
            | (u32::from(digest[offset + 1]) << 16)
            | (u32::from(digest[offset + 2]) << 8)
            | u32::from(digest[offset + 3]);
        let modulus = 10_u32.pow(self.digits.get());
        let code = format!(
            "{:0width$}",
            binary % modulus,
            width = self.digits.get() as usize
        );
        Ok(TotpCode {
            code,
            seconds_remaining: period - (unix_seconds % period),
            period,
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
            Self {
                issuer: issuer.to_owned(),
                account: account.to_owned(),
                website_url: website_url.to_owned(),
                secret: TotpSecret::parse(secret_or_uri)?,
                algorithm: TotpAlgorithm::parse(algorithm)?,
                digits: TotpDigits::parse(parse_u32_or_default(digits, DEFAULT_DIGITS)?)?,
                period: TotpPeriod::parse(parse_u64_or_default(period, DEFAULT_PERIOD)?)?,
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
        item.apply_inferred_website_url_if_empty();
        item.normalize()?;
        Ok(item)
    }

    pub fn from_otpauth_uri(uri: &str) -> Result<Self, ValidationError> {
        let rest = uri
            .trim()
            .strip_prefix("otpauth://totp/")
            .ok_or(ValidationError::AuthenticatorUriInvalid)?;
        let (label_raw, query_raw) = rest
            .split_once('?')
            .ok_or(ValidationError::AuthenticatorUriInvalid)?;
        let label = decode_uri_path_component(label_raw)?;
        let params = parse_query(query_raw)?;
        let secret = params
            .get("secret")
            .ok_or(ValidationError::AuthenticatorSecretInvalid)?;
        let (label_issuer, account) = label
            .split_once(':')
            .map_or(("", label.as_str()), |(issuer, account)| (issuer, account));
        let issuer = params.get("issuer").map_or(label_issuer, String::as_str);
        let algorithm =
            TotpAlgorithm::parse(params.get("algorithm").map_or("SHA1", String::as_str))?;
        let digits = TotpDigits::parse(
            params
                .get("digits")
                .map(String::as_str)
                .map_or(Ok(DEFAULT_DIGITS), parse_u32)?,
        )?;
        let period = TotpPeriod::parse(
            params
                .get("period")
                .map(String::as_str)
                .map_or(Ok(DEFAULT_PERIOD), parse_u64)?,
        )?;
        let mut item = Self {
            issuer: issuer.to_owned(),
            account: account.to_owned(),
            website_url: String::new(),
            secret: TotpSecret::parse(secret)?,
            algorithm,
            digits,
            period,
            backup_codes: Vec::new(),
        };
        item.apply_inferred_website_url_if_empty();
        item.normalize()?;
        Ok(item)
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

/// Decide whether an edited setup key represents a different authenticator.
///
/// Stored keys are canonical Base32. Manual keys are compared after the same
/// normalization, while an `otpauth://` URI is treated as a replacement because
/// it can also change the algorithm, digits, and period.
pub fn authenticator_setup_key_changed(
    stored_key: &str,
    candidate_key: &str,
) -> Result<bool, ValidationError> {
    let stored = TotpSecret::parse(stored_key)?;
    if candidate_key.trim().starts_with("otpauth://") {
        AuthenticatorSecret::from_otpauth_uri(candidate_key)?;
        return Ok(true);
    }
    Ok(stored != TotpSecret::parse(candidate_key)?)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TotpCode {
    pub code: String,
    pub seconds_remaining: u64,
    pub period: u64,
}

fn normalize_base32(value: &str) -> String {
    let mut normalized = value
        .chars()
        .filter(|character| !character.is_ascii_whitespace() && *character != '-')
        .map(|character| character.to_ascii_uppercase())
        .collect::<String>();
    normalized.truncate(normalized.trim_end_matches('=').len());
    normalized
}

fn decode_base32(value: &str) -> Result<Vec<u8>, ValidationError> {
    let mut output = Vec::with_capacity(value.len() * 5 / 8);
    let mut buffer = 0_u32;
    let mut bits = 0_u8;
    for character in value.trim_end_matches('=').chars() {
        let digit = match character {
            'A'..='Z' => u32::from(character) - u32::from('A'),
            '2'..='7' => u32::from(character) - u32::from('2') + 26,
            _ => return Err(ValidationError::AuthenticatorSecretInvalid),
        };
        buffer = (buffer << 5) | digit;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            output.push(
                u8::try_from((buffer >> bits) & 0xff)
                    .expect("masked Base32 output always fits in one byte"),
            );
            buffer &= (1_u32 << bits) - 1;
        }
    }
    if output.is_empty() {
        return Err(ValidationError::AuthenticatorSecretInvalid);
    }
    Ok(output)
}

fn normalize_backup_codes(codes: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();
    for code in codes {
        let trimmed = code.trim();
        if !trimmed.is_empty() && !normalized.iter().any(|existing| existing == trimmed) {
            normalized.push(trimmed.to_owned());
        }
    }
    normalized
}

fn decode_uri_path_component(value: &str) -> Result<String, ValidationError> {
    percent_decode_str(value)
        .decode_utf8()
        .map(std::borrow::Cow::into_owned)
        .map_err(|_| ValidationError::AuthenticatorUriInvalid)
}

fn decode_uri_query_component(value: &str) -> Result<String, ValidationError> {
    percent_decode_str(&value.replace('+', " "))
        .decode_utf8()
        .map(std::borrow::Cow::into_owned)
        .map_err(|_| ValidationError::AuthenticatorUriInvalid)
}

fn parse_query(query: &str) -> Result<HashMap<String, String>, ValidationError> {
    query
        .split('&')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let (key, value) = part
                .split_once('=')
                .ok_or(ValidationError::AuthenticatorUriInvalid)?;
            Ok((
                decode_uri_query_component(key)?,
                decode_uri_query_component(value)?,
            ))
        })
        .collect()
}

fn parse_u32(value: &str) -> Result<u32, ValidationError> {
    value
        .parse()
        .map_err(|_| ValidationError::AuthenticatorUriInvalid)
}

fn parse_u64(value: &str) -> Result<u64, ValidationError> {
    value
        .parse()
        .map_err(|_| ValidationError::AuthenticatorUriInvalid)
}

fn parse_u32_or_default(value: &str, default: u32) -> Result<u32, ValidationError> {
    if value.trim().is_empty() {
        Ok(default)
    } else {
        parse_u32(value.trim())
    }
}

fn parse_u64_or_default(value: &str, default: u64) -> Result<u64, ValidationError> {
    if value.trim().is_empty() {
        Ok(default)
    } else {
        parse_u64(value.trim())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rfc_secret(secret: &[u8]) -> TotpSecret {
        let encoded = match secret.len() {
            20 => "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
            32 => "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA",
            64 => {
                "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA"
            }
            _ => panic!("unsupported fixture"),
        };
        TotpSecret::parse(encoded).unwrap()
    }

    fn fixture(algorithm: TotpAlgorithm, secret: &[u8]) -> AuthenticatorSecret {
        AuthenticatorSecret {
            issuer: "RFC".to_owned(),
            account: "test".to_owned(),
            website_url: String::new(),
            secret: rfc_secret(secret),
            algorithm,
            digits: TotpDigits::parse(8).unwrap(),
            period: TotpPeriod::default(),
            backup_codes: Vec::new(),
        }
    }

    #[test]
    fn matches_rfc_6238_test_vectors() {
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
                fixture(TotpAlgorithm::Sha1, sha1)
                    .current_code(timestamp)
                    .unwrap()
                    .code,
                expected_sha1
            );
            assert_eq!(
                fixture(TotpAlgorithm::Sha256, sha256)
                    .current_code(timestamp)
                    .unwrap()
                    .code,
                expected_sha256
            );
            assert_eq!(
                fixture(TotpAlgorithm::Sha512, sha512)
                    .current_code(timestamp)
                    .unwrap()
                    .code,
                expected_sha512
            );
        }
    }

    #[test]
    fn parses_google_authenticator_uri_and_normalizes_backup_codes() {
        let mut item = AuthenticatorSecret::from_form_fields(
            "",
            "",
            "otpauth://totp/Example%20Co:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example%20Co&algorithm=SHA256&digits=8&period=45",
            "",
            "",
            "",
            " first-code \nsecond-code\nfirst-code\n",
            "",
        )
        .unwrap();
        assert_eq!(item.issuer, "Example Co");
        assert_eq!(item.account, "alice@example.com");
        assert_eq!(item.algorithm, TotpAlgorithm::Sha256);
        assert_eq!(item.digits.get(), 8);
        assert_eq!(item.period.get(), 45);
        assert_eq!(item.backup_codes, ["first-code", "second-code"]);
        item.zeroize();
        assert!(item.secret.as_str().is_empty());
    }

    #[test]
    fn canonicalizes_base32_padding() {
        let padded = TotpSecret::parse("JBSWY3DPEHPK3PXP====").unwrap();
        let unpadded = TotpSecret::parse("JBSWY3DPEHPK3PXP").unwrap();

        assert_eq!(padded, unpadded);
        assert_eq!(padded.as_str(), "JBSWY3DPEHPK3PXP");
    }

    #[test]
    fn setup_key_change_detection_uses_canonical_base32() {
        assert!(
            !authenticator_setup_key_changed("JBSWY3DPEHPK3PXP", "jbsw-y3dp ehpk-3pxp====",)
                .unwrap()
        );
        assert!(authenticator_setup_key_changed("JBSWY3DPEHPK3PXP", "KRUGS4ZANFZSAYJA",).unwrap());
        assert!(authenticator_setup_key_changed(
            "JBSWY3DPEHPK3PXP",
            "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA256",
        )
        .unwrap());
    }

    #[test]
    fn preserves_plus_signs_in_otpauth_labels() {
        let item = AuthenticatorSecret::from_otpauth_uri(
            "otpauth://totp/Example%3Aalice%2Balerts%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example",
        )
        .unwrap();

        assert_eq!(item.account, "alice+alerts@example.com");
    }

    #[test]
    fn rejects_short_or_invalid_base32_secrets_and_parameters() {
        assert!(TotpSecret::parse("not base32!").is_err());
        assert!(TotpSecret::parse("JBSWY3DP").is_err());
        assert!(TotpDigits::parse(5).is_err());
        assert!(TotpPeriod::parse(10).is_err());
    }
}
