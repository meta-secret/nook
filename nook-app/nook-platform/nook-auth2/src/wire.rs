//! Typed key-access and crypto strings.

use crate::CompactToken;
use crate::errors::{ValidationError, ValidationResult};
use age::secrecy::ExposeSecret;
use age::x25519::{Identity, Recipient};
use serde::{Deserialize, Serialize};
use std::{fmt, mem};
use zeroize::{Zeroize, ZeroizeOnDrop};

mod metadata;
pub use metadata::{DeviceSigningPublicKey, IdentityVaultEventId, IsoTimestamp, Sha256Hex};

const AGE_ARMOR_MARKER: &str = "BEGIN AGE ENCRYPTED FILE";
const HEX_32_BYTE_LEN: usize = 64;

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize, Serialize)]
#[serde(try_from = "String")]
pub struct SymmetricKey(String);

impl SymmetricKey {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }
}

impl fmt::Debug for SymmetricKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SymmetricKey([REDACTED])")
    }
}

impl AsRef<str> for SymmetricKey {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize, tsify::Tsify, Serialize,
)]
#[tsify(type = "string")]
#[serde(try_from = "String")]
pub struct AgeArmoredCiphertext(String);

impl AgeArmoredCiphertext {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for AgeArmoredCiphertext {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for AgeArmoredCiphertext {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize, tsify::Tsify, Serialize,
)]
#[tsify(type = "string")]
#[serde(try_from = "String")]
pub struct DevicePublicKey(String);

impl DevicePublicKey {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for DevicePublicKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for DevicePublicKey {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize, tsify::Tsify, Serialize,
)]
#[tsify(type = "string")]
#[serde(from = "String")]
pub struct MemberLabel(String);

impl MemberLabel {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for MemberLabel {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for MemberLabel {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize, tsify::Tsify, Serialize,
)]
#[tsify(type = "string")]
#[serde(from = "String")]
pub struct OpaqueCiphertext(String);

impl OpaqueCiphertext {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for OpaqueCiphertext {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for OpaqueCiphertext {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub struct DecryptedPlaintext(String);

impl DecryptedPlaintext {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }

    #[must_use]
    pub(crate) fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Debug for DecryptedPlaintext {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DecryptedPlaintext([REDACTED])")
    }
}

impl AsRef<str> for DecryptedPlaintext {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize, Serialize)]
#[serde(try_from = "String")]
pub struct SigningSeedHex(String);

impl SigningSeedHex {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }
}

impl fmt::Debug for SigningSeedHex {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SigningSeedHex([REDACTED])")
    }
}

impl AsRef<str> for SigningSeedHex {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl Drop for SigningSeedHex {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl DecryptedPlaintext {
    pub fn zeroize_plaintext(&mut self) {
        self.0.zeroize();
    }
}

impl Drop for DecryptedPlaintext {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize, Serialize)]
#[serde(try_from = "String")]
pub struct DeviceIdentitySecret(String);

impl DeviceIdentitySecret {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }

    #[must_use]
    pub(crate) fn from_identity(identity: &Identity) -> Self {
        Self(identity.to_string().expose_secret().to_owned())
    }
}

impl fmt::Debug for DeviceIdentitySecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DeviceIdentitySecret([REDACTED])")
    }
}

impl AsRef<str> for DeviceIdentitySecret {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl Drop for DeviceIdentitySecret {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl SymmetricKey {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let key = raw.trim();
        if key.len() != HEX_32_BYTE_LEN || !key.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ValidationError::SymmetricKeyInvalid);
        }
        Ok(Self(key.to_owned()))
    }

    pub fn generate() -> ValidationResult<Self> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|_| ValidationError::SymmetricKeyInvalid)?;
        Ok(Self(hex::encode(bytes)))
    }
}

impl TryFrom<String> for SymmetricKey {
    type Error = ValidationError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        let value = zeroize::Zeroizing::new(value);
        Self::parse(&value)
    }
}

impl AgeArmoredCiphertext {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        if !raw.contains(AGE_ARMOR_MARKER) {
            return Err(ValidationError::AgeArmoredInvalid);
        }
        Ok(Self(raw.to_owned()))
    }

    #[must_use]
    pub fn from_trusted_armored(value: String) -> Self {
        Self(value)
    }
}

impl TryFrom<String> for AgeArmoredCiphertext {
    type Error = ValidationError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}

impl DevicePublicKey {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let key = raw.trim();
        key.parse::<Recipient>()
            .map(|_| Self(key.to_owned()))
            .map_err(|_| ValidationError::DevicePublicKeyInvalid)
    }
}

impl TryFrom<String> for DevicePublicKey {
    type Error = ValidationError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}

impl DeviceIdentitySecret {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let secret = raw.trim();
        secret
            .parse::<Identity>()
            .map(|_| Self(secret.to_owned()))
            .map_err(|_| ValidationError::DeviceIdentitySecretInvalid)
    }
}

impl TryFrom<String> for DeviceIdentitySecret {
    type Error = ValidationError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        let value = zeroize::Zeroizing::new(value);
        Self::parse(&value)
    }
}

/// One sync-provider credential's text: a GitHub token, a Google Drive access
/// token, an iCloud web-auth token, or an S3 secret access key. It is the
/// plaintext while its provider is open and the age armor sealed to an app key
/// at rest. It is never blank and is kept exactly as written, because armor
/// line breaks matter. `Debug` is redacted, there is no `Display`, and the
/// text is wiped when the value is dropped or replaced.
#[derive(Clone, PartialEq, Eq, Deserialize, Serialize, tsify::Tsify, Zeroize, ZeroizeOnDrop)]
#[tsify(type = "string")]
#[serde(try_from = "String")]
pub struct ProviderSecretText(String);

impl ProviderSecretText {
    /// The text, for sealing, request signing, and the provider adapters.
    #[must_use]
    pub fn expose(&self) -> &str {
        let Self(text) = self;
        text
    }
}

/// A blank text, empty or whitespace only, names no credential.
impl TryFrom<String> for ProviderSecretText {
    type Error = ValidationError;
    fn try_from(text: String) -> ValidationResult<Self> {
        match text.trim() {
            "" => Err(ValidationError::ProviderSecretRequired),
            _ => Ok(Self(text)),
        }
    }
}

impl fmt::Debug for ProviderSecretText {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ProviderSecretText([REDACTED])")
    }
}

impl SigningSeedHex {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let seed = raw.trim();
        if seed.len() != HEX_32_BYTE_LEN || !seed.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ValidationError::SigningSeedInvalid);
        }
        Ok(Self(seed.to_owned()))
    }
}

impl TryFrom<String> for SigningSeedHex {
    type Error = ValidationError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        let value = zeroize::Zeroizing::new(value);
        Self::parse(&value)
    }
}

impl From<String> for MemberLabel {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<String> for OpaqueCiphertext {
    fn from(value: String) -> Self {
        Self(value)
    }
}

/// Alias for compact URL-safe base64 ids (`generate_id` — 11 chars).
pub type Url64EncodedString = CompactToken;

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use super::*;
    use age::secrecy::ExposeSecret;
    use age::x25519::Identity;
    use tsify::Tsify;

    struct WipedOnDrop;
    impl WipedOnDrop {
        /// Compiles only for a type that wipes itself when dropped.
        const fn check<T: ZeroizeOnDrop>() {}
    }

    #[test]
    fn a_provider_secret_is_never_blank_and_keeps_its_text_exactly() -> anyhow::Result<()> {
        for blank in ["", " ", "\t\n"] {
            assert_eq!(
                ProviderSecretText::try_from(blank.to_owned()),
                Err(ValidationError::ProviderSecretRequired)
            );
        }
        let armor = "-----BEGIN AGE ENCRYPTED FILE-----\nYWdl\n-----END AGE ENCRYPTED FILE-----\n";
        assert_eq!(
            ProviderSecretText::try_from(armor.to_owned())?.expose(),
            armor
        );
        assert_eq!(
            ProviderSecretText::try_from(" kept exactly\n".to_owned())?.expose(),
            " kept exactly\n"
        );
        Ok(())
    }

    #[test]
    fn a_provider_secret_is_a_plain_string_on_the_wire_and_redacted_in_debug() -> anyhow::Result<()>
    {
        let secret = ProviderSecretText::try_from("TEST-ONLY-secret-not-real".to_owned())?;
        let wire = serde_json::to_value(&secret)?;
        assert_eq!(wire, serde_json::json!("TEST-ONLY-secret-not-real"));
        assert_eq!(serde_json::from_value::<ProviderSecretText>(wire)?, secret);
        assert!(serde_json::from_value::<ProviderSecretText>(serde_json::json!("  ")).is_err());
        assert_eq!(format!("{secret:?}"), "ProviderSecretText([REDACTED])");
        assert!(ProviderSecretText::DECL.ends_with("export type ProviderSecretText = string;"));
        Ok(())
    }

    #[test]
    fn a_provider_secret_wipes_its_text() -> anyhow::Result<()> {
        WipedOnDrop::check::<ProviderSecretText>();
        let mut secret = ProviderSecretText::try_from("TEST-ONLY-secret-not-real".to_owned())?;
        secret.zeroize();
        assert_eq!(secret.expose(), "");
        Ok(())
    }

    #[test]
    fn symmetric_key_roundtrip_and_generate() -> anyhow::Result<()> {
        let key = SymmetricKey::generate()?;
        assert_eq!(key.as_str().len(), 64);
        assert_eq!(SymmetricKey::parse(key.as_str())?, key);
        assert_eq!(format!("{key:?}"), "SymmetricKey([REDACTED])");
        assert_eq!(key.into_inner().len(), 64);
        Ok(())
    }

    #[test]
    fn age_armored_accepts_valid_armor() -> anyhow::Result<()> {
        let armor = "-----BEGIN AGE ENCRYPTED FILE-----\nabc\n-----END AGE ENCRYPTED FILE-----";
        let parsed = AgeArmoredCiphertext::parse(armor)?;
        assert_eq!(parsed.as_str(), armor);
        let trusted = AgeArmoredCiphertext::from_trusted_armored(armor.to_owned());
        assert_eq!(parsed, trusted);
        Ok(())
    }

    #[test]
    fn device_keys_parse_from_generated_identity() -> anyhow::Result<()> {
        let identity = Identity::generate();
        let public = identity.to_public().to_string();
        let secret = identity.to_string().expose_secret().to_owned();
        let pk = DevicePublicKey::parse(&public)?;
        assert_eq!(pk.as_str(), public);
        let sk = DeviceIdentitySecret::parse(&secret)?;
        assert_eq!(sk.as_str(), secret);
        assert_eq!(format!("{sk:?}"), "DeviceIdentitySecret([REDACTED])");
        Ok(())
    }

    #[test]
    fn invalid_key_and_ciphertext_strings_fail_validation() -> anyhow::Result<()> {
        assert!(SymmetricKey::parse("short").is_err());
        assert!(SymmetricKey::parse(&"zz".repeat(32)).is_err());
        assert!(AgeArmoredCiphertext::parse("plain text").is_err());
        assert!(DevicePublicKey::parse("not-an-age-recipient").is_err());
        assert!(DeviceIdentitySecret::parse("not-an-age-secret").is_err());
        assert!(SigningSeedHex::parse("short").is_err());
        assert!(SigningSeedHex::parse(&"zz".repeat(32)).is_err());
        assert!(IsoTimestamp::parse("").is_err());
        assert!(IsoTimestamp::parse("not-a-date").is_err());
        Ok(())
    }

    #[test]
    fn string_newtypes_expose_display_as_ref_and_inner_values() -> anyhow::Result<()> {
        let seed_hex = "ab".repeat(32);
        let seed = SigningSeedHex::parse(&seed_hex)?;
        assert_eq!(seed.as_str(), seed_hex);
        assert_eq!(seed.as_ref(), seed_hex);
        assert_eq!(format!("{seed:?}"), "SigningSeedHex([REDACTED])");
        assert_eq!(serde_json::to_string(&seed)?, format!("\"{seed_hex}\""));
        assert_eq!(seed.clone().into_inner(), seed_hex);

        let trusted_seed = SigningSeedHex::try_from(seed_hex.clone())?;
        assert_eq!(trusted_seed, seed);

        let label = MemberLabel::from_trusted("Laptop".to_owned());
        assert_eq!(label.as_str(), "Laptop");
        assert_eq!(label.as_ref(), "Laptop");
        assert_eq!(label.to_string(), "Laptop");
        assert_eq!(label.clone().into_inner(), "Laptop");
        let decoded_label: MemberLabel = serde_json::from_str("\"Laptop\"")?;
        assert_eq!(decoded_label, label);

        let opaque = OpaqueCiphertext::from_trusted("sealed".to_owned());
        assert_eq!(opaque.as_str(), "sealed");
        assert_eq!(opaque.as_ref(), "sealed");
        assert_eq!(opaque.to_string(), "sealed");
        assert_eq!(opaque.clone().into_inner(), "sealed");
        let decoded_opaque: OpaqueCiphertext = serde_json::from_str("\"sealed\"")?;
        assert_eq!(decoded_opaque, opaque);

        let plaintext = DecryptedPlaintext::from_trusted("secret".to_owned());
        assert_eq!(plaintext.as_str(), "secret");
        assert_eq!(plaintext.as_ref(), "secret");
        assert_eq!(format!("{plaintext:?}"), "DecryptedPlaintext([REDACTED])");
        assert_eq!(plaintext.into_inner(), "secret");
        Ok(())
    }

    #[test]
    fn device_identity_secret_can_be_unwrapped_without_debug_leak() -> anyhow::Result<()> {
        let identity = Identity::generate();
        let secret = identity.to_string().expose_secret().to_owned();
        let wrapped = DeviceIdentitySecret::parse(&secret)?;
        assert_eq!(wrapped.as_ref(), secret);
        assert_eq!(format!("{wrapped:?}"), "DeviceIdentitySecret([REDACTED])");
        assert_eq!(serde_json::to_string(&wrapped)?, format!("\"{secret}\""));
        assert_eq!(wrapped.into_inner(), secret);
        Ok(())
    }
}
