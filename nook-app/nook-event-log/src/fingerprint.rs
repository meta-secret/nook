use serde::{Deserialize, Serialize};

const SECRET_VERSION_FINGERPRINT_SCHEME: &str = "hmac-sha256:v2:";

/// Opaque vault-keyed tag carried by event operations and projections.
///
/// The HMAC computation remains in `nook-core`, where plaintext secret domain
/// values live. The event log owns the serialized opaque value because it is
/// part of the immutable event schema.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SecretFingerprint(String);

impl SecretFingerprint {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }

    /// Whether this fingerprint uses the current secret-version semantics.
    #[must_use]
    pub fn is_current_secret_version(&self) -> bool {
        self.0.starts_with(SECRET_VERSION_FINGERPRINT_SCHEME)
    }
}
