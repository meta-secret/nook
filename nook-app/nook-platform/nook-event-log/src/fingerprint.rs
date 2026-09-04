use serde::{Deserialize, Deserializer, Serialize, de::Error as _};

const SECRET_VERSION_FINGERPRINT_SCHEME: &str = "hmac-sha256:v2:";

/// Opaque vault-keyed tag carried by event operations and projections.
///
/// The HMAC computation remains in `nook-core`, where plaintext secret domain
/// values live. The event log owns the serialized opaque value because it is
/// part of the immutable event schema.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct SecretFingerprint(String);

impl SecretFingerprint {
    pub fn parse(value: &str) -> Result<Self, &'static str> {
        if value.trim().is_empty() {
            return Err("secret fingerprint must not be empty");
        }
        Ok(Self(value.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        assert!(
            !value.trim().is_empty(),
            "trusted secret fingerprint must not be empty"
        );
        Self(value)
    }

    /// Whether this fingerprint uses the current secret-version semantics.
    #[must_use]
    pub fn is_current_secret_version(&self) -> bool {
        self.0.starts_with(SECRET_VERSION_FINGERPRINT_SCHEME)
    }
}

impl<'de> Deserialize<'de> for SecretFingerprint {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(D::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::SecretFingerprint;

    #[test]
    fn empty_fingerprints_are_rejected_at_the_wire_boundary() {
        assert!(SecretFingerprint::parse("").is_err());
        assert!(SecretFingerprint::parse("  ").is_err());
        assert!(serde_json::from_str::<SecretFingerprint>("\"\"").is_err());
    }
}
