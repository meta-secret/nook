//! Portable domain values for TOTP authenticators and recovery-code updates.
#![deny(clippy::absolute_paths)]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_raw_numeric_api_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(raw_numeric_public_api))]

use serde::{Deserialize, Deserializer, Serialize, de::Error as _};
use std::{fmt, time::Duration};

const DEFAULT_PERIOD: u64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum AuthenticatorDomainError {
    #[error("authenticator algorithm is invalid")]
    AlgorithmInvalid,
    #[error("authenticator digits are invalid")]
    DigitsInvalid,
    #[error("authenticator period is invalid")]
    PeriodInvalid,
    #[error("authenticator backup-code attachment mode is invalid")]
    BackupCodeAttachModeInvalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasskeyDeviceProtectionMode {
    Standard,
    AntiHacker,
}

impl PasskeyDeviceProtectionMode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::AntiHacker => "anti-hacker",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BackupCodeAttachMode {
    Replace,
    Merge,
}

impl BackupCodeAttachMode {
    /// # Errors
    /// Returns an error when the value is not a supported attachment mode.
    pub fn parse(value: &str) -> Result<Self, AuthenticatorDomainError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "replace" => Ok(Self::Replace),
            "merge" => Ok(Self::Merge),
            _ => Err(AuthenticatorDomainError::BackupCodeAttachModeInvalid),
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Replace => "replace",
            Self::Merge => "merge",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum TotpAlgorithm {
    #[default]
    Sha1,
    Sha256,
    Sha512,
}

impl TotpAlgorithm {
    /// # Errors
    /// Returns an error when the value is not a supported TOTP algorithm.
    pub fn parse(value: &str) -> Result<Self, AuthenticatorDomainError> {
        match value.trim().to_ascii_uppercase().as_str() {
            "" | "SHA1" => Ok(Self::Sha1),
            "SHA256" => Ok(Self::Sha256),
            "SHA512" => Ok(Self::Sha512),
            _ => Err(AuthenticatorDomainError::AlgorithmInvalid),
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

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum TotpDigits {
    #[default]
    Six,
    Seven,
    Eight,
}

impl Serialize for TotpDigits {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_u32(match self {
            Self::Six => 6,
            Self::Seven => 7,
            Self::Eight => 8,
        })
    }
}

impl<'de> Deserialize<'de> for TotpDigits {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::parse(u32::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

impl fmt::Display for TotpDigits {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Six => "6",
            Self::Seven => "7",
            Self::Eight => "8",
        })
    }
}

impl TotpDigits {
    /// # Errors
    /// Returns an error when the digit count is outside the supported range.
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: validates a numeric digit count decoded from authenticator data"
        )
    )]
    pub fn parse(value: u32) -> Result<Self, AuthenticatorDomainError> {
        match value {
            6 => Ok(Self::Six),
            7 => Ok(Self::Seven),
            8 => Ok(Self::Eight),
            _ => Err(AuthenticatorDomainError::DigitsInvalid),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct TotpPeriod(u64);

impl<'de> Deserialize<'de> for TotpPeriod {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::parse(u64::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

impl Default for TotpPeriod {
    fn default() -> Self {
        Self(DEFAULT_PERIOD)
    }
}

impl fmt::Display for TotpPeriod {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl TotpPeriod {
    /// # Errors
    /// Returns an error when the period is outside the supported range.
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: validates a numeric period decoded from authenticator data"
        )
    )]
    pub fn parse(value: u64) -> Result<Self, AuthenticatorDomainError> {
        if (15..=300).contains(&value) {
            Ok(Self(value))
        } else {
            Err(AuthenticatorDomainError::PeriodInvalid)
        }
    }

    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: exposes the validated period only to companion and WASM wire adapters"
        )
    )]
    pub const fn serialized_value(self) -> u64 {
        self.0
    }

    #[must_use]
    pub const fn duration(self) -> Duration {
        Duration::from_secs(self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_closed_authenticator_vocabularies() {
        assert_eq!(
            BackupCodeAttachMode::parse("replace"),
            Ok(BackupCodeAttachMode::Replace)
        );
        assert_eq!(
            BackupCodeAttachMode::parse("MERGE"),
            Ok(BackupCodeAttachMode::Merge)
        );
        assert_eq!(TotpAlgorithm::parse(""), Ok(TotpAlgorithm::Sha1));
        assert_eq!(TotpAlgorithm::parse("sha256"), Ok(TotpAlgorithm::Sha256));
        assert_eq!(TotpAlgorithm::parse("SHA512"), Ok(TotpAlgorithm::Sha512));
        assert!(BackupCodeAttachMode::parse("append").is_err());
        assert!(TotpAlgorithm::parse("MD5").is_err());
    }

    #[test]
    fn bounds_authenticator_numbers() {
        assert_eq!(TotpDigits::parse(6), Ok(TotpDigits::Six));
        assert_eq!(TotpDigits::parse(7), Ok(TotpDigits::Seven));
        assert_eq!(TotpDigits::parse(8), Ok(TotpDigits::Eight));
        for digits in [0, 5, 9, u32::MAX] {
            assert!(TotpDigits::parse(digits).is_err());
        }
        for period in [15, 30, 300] {
            assert_eq!(
                TotpPeriod::parse(period).map(TotpPeriod::duration),
                Ok(Duration::from_secs(period))
            );
        }
        for period in [0, 14, 301, u64::MAX] {
            assert!(TotpPeriod::parse(period).is_err());
        }
    }

    #[test]
    fn deserialization_enforces_authenticator_number_bounds() {
        assert!(matches!(
            serde_json::to_string(&TotpDigits::Six),
            Ok(value) if value == "6"
        ));
        assert!(matches!(
            serde_json::to_string(&TotpPeriod::default()),
            Ok(value) if value == "30"
        ));
        assert!(matches!(
            serde_json::from_str::<TotpDigits>("6"),
            Ok(TotpDigits::Six)
        ));
        assert!(matches!(
            serde_json::from_str::<TotpPeriod>("300"),
            Ok(value) if value.duration() == Duration::from_mins(5)
        ));
        assert!(serde_json::from_str::<TotpDigits>("9").is_err());
        assert!(serde_json::from_str::<TotpPeriod>("301").is_err());
    }
}
