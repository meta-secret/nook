#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! The access key a device signs its S3 requests with.
//!
//! Every device brings its own key. The key id is an identifier that travels
//! in each request's `Authorization` header; the secret never leaves Rust in
//! a request, a URL, an error, or a log line, and is wiped when dropped.

use std::fmt;

use serde::{Deserialize, Serialize};
use tsify::Tsify;
use zeroize::Zeroizing;

use crate::errors::{ValidationError, ValidationResult};

/// Identifies the access key a device signs with: 3 to 128 letters, digits,
/// or `-_.~+@`. It is no secret, so it may be shown and logged.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[tsify(type = "string")]
#[serde(try_from = "String", into = "String")]
pub struct S3AccessKeyId(String);

impl S3AccessKeyId {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let id = match raw.trim() {
            "" => return Err(ValidationError::S3AccessKeyIdRequired),
            id => id,
        };
        let id = match id.len() {
            3..=128 => id,
            _ => return Err(ValidationError::S3AccessKeyIdInvalid),
        };
        match id.bytes().find(|byte| {
            !matches!(byte, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'+' | b'@')
        }) {
            Some(_) => Err(ValidationError::S3AccessKeyIdInvalid),
            None => Ok(Self(id.to_owned())),
        }
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(id) = self;
        id
    }
}

impl fmt::Display for S3AccessKeyId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl TryFrom<String> for S3AccessKeyId {
    type Error = ValidationError;
    fn try_from(value: String) -> ValidationResult<Self> {
        Self::parse(&value)
    }
}

impl From<S3AccessKeyId> for String {
    fn from(id: S3AccessKeyId) -> Self {
        let S3AccessKeyId(id) = id;
        id
    }
}

/// The secret half of an access key: 8 to 256 printable ASCII characters
/// without spaces. It has no `Display`, a redacted `Debug`, no serialization,
/// and zeroizes its buffer when dropped. Rejections never carry its text.
#[derive(Clone)]
pub struct S3SecretAccessKey(Zeroizing<String>);

impl S3SecretAccessKey {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let secret = match raw.trim() {
            "" => return Err(ValidationError::S3SecretAccessKeyRequired),
            secret => secret,
        };
        let secret = match secret.len() {
            8..=256 => secret,
            _ => return Err(ValidationError::S3SecretAccessKeyInvalid),
        };
        match secret.bytes().find(|byte| !matches!(byte, b'!'..=b'~')) {
            Some(_) => Err(ValidationError::S3SecretAccessKeyInvalid),
            None => Ok(Self(Zeroizing::new(secret.to_owned()))),
        }
    }

    /// The secret text, for the signer and the credential slot of the connect
    /// arguments only.
    pub(crate) fn expose(&self) -> &str {
        let Self(secret) = self;
        secret.as_str()
    }
}

impl fmt::Debug for S3SecretAccessKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("S3SecretAccessKey([redacted])")
    }
}

/// The key one device signs with.
#[derive(Debug, Clone)]
pub struct S3Credentials {
    pub access_key_id: S3AccessKeyId,
    pub secret_access_key: S3SecretAccessKey,
}

#[cfg(test)]
mod tests {
    use super::{S3AccessKeyId, S3Credentials, S3SecretAccessKey};
    use crate::errors::ValidationError;

    const SECRET: &str = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

    #[test]
    fn access_key_ids_are_short_identifiers() -> anyhow::Result<()> {
        for id in ["AKIAIOSFODNN7EXAMPLE", "device-a", "GK31c2f2", "user@team"] {
            assert_eq!(S3AccessKeyId::parse(&format!(" {id} "))?.as_str(), id);
        }
        assert_eq!(
            S3AccessKeyId::parse(" "),
            Err(ValidationError::S3AccessKeyIdRequired)
        );
        let too_long = "A".repeat(129);
        for id in [
            "ab",
            "AKIA/EXAMPLE",
            "AKIA EXAMPLE",
            "AKIA=",
            too_long.as_str(),
        ] {
            assert_eq!(
                S3AccessKeyId::parse(id),
                Err(ValidationError::S3AccessKeyIdInvalid),
                "{id}"
            );
        }
        Ok(())
    }

    #[test]
    fn secrets_are_printable_ascii_and_never_shown() -> anyhow::Result<()> {
        let secret = S3SecretAccessKey::parse(&format!("\n{SECRET} "))?;
        assert_eq!(secret.expose(), SECRET);
        let credentials = S3Credentials {
            access_key_id: S3AccessKeyId::parse("AKIAIOSFODNN7EXAMPLE")?,
            secret_access_key: secret,
        };
        let shown = format!("{credentials:?}");
        assert!(!shown.contains(SECRET));
        assert!(shown.contains("AKIAIOSFODNN7EXAMPLE"));

        assert!(matches!(
            S3SecretAccessKey::parse(""),
            Err(ValidationError::S3SecretAccessKeyRequired)
        ));
        let too_long = "s".repeat(257);
        for rejected in [
            "short",
            "has a space",
            "tab\there!",
            "ключ-секрет-ключ",
            too_long.as_str(),
        ] {
            let failure = S3SecretAccessKey::parse(rejected);
            assert!(
                matches!(failure, Err(ValidationError::S3SecretAccessKeyInvalid)),
                "{rejected}"
            );
            let message = match failure {
                Err(error) => error.to_string(),
                Ok(secret) => secret.expose().to_owned(),
            };
            assert!(!message.contains(rejected));
        }
        Ok(())
    }
}
