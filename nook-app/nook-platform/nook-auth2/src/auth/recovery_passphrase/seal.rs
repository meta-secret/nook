//! The recovery member's private keys sealed under its passphrase.
//!
//! The same age scrypt construction vault password envelopes used: an age
//! file whose only recipient is the passphrase, at scrypt work factor 18.
//! The plaintext is the member's X25519 secret and Ed25519 signing seed.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use std::fmt;
use std::io::{Read, Write};
use std::iter;

use age::armor::{ArmoredReader, ArmoredWriter, Format};
use age::{DecryptError, scrypt, secrecy::SecretString};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use super::{RecoveryPassphraseError, RecoveryPhrase};
use crate::{AgeArmoredCiphertext, AppKey, DeviceIdentitySecret, SigningSeedHex};

/// The scrypt work factor (log2 N) of a recovery seal.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ScryptWorkFactor(u8);

impl ScryptWorkFactor {
    /// About a second on a mid-tier laptop: the cost of every guess.
    const RECOVERY: Self = Self(18);
}

/// The private keys of one recovery member: the X25519 key DEKs are wrapped
/// to and the Ed25519 seed it signs with. They exist in memory only, while
/// a passphrase is added or used.
pub struct RecoverySecret {
    app_key: AppKey,
    signing_seed: SigningSeedHex,
}

impl fmt::Debug for RecoverySecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RecoverySecret")
            .field("app_id", self.app_key.app_id())
            .finish_non_exhaustive()
    }
}

/// The sealed plaintext.
#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
struct SealedKeys {
    encryption_secret: String,
    signing_seed: String,
}

/// A recovery member's private keys sealed under its passphrase, as the
/// identity control log carries them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RecoverySealedSecret(AgeArmoredCiphertext);

impl RecoverySecret {
    /// Fresh keys for a new recovery member.
    pub fn generate() -> Result<Self, RecoveryPassphraseError> {
        let app_key = AppKey::generate()
            .map_err(|error| RecoveryPassphraseError::Random(error.to_string()))?;
        let mut seed = Zeroizing::new([0_u8; 32]);
        getrandom::fill(seed.as_mut_slice())
            .map_err(|error| RecoveryPassphraseError::Random(error.to_string()))?;
        let signing_seed = SigningSeedHex::parse(&Zeroizing::new(hex::encode(*seed)))
            .map_err(|error| RecoveryPassphraseError::Random(error.to_string()))?;
        Ok(Self {
            app_key,
            signing_seed,
        })
    }

    /// The X25519 key: its public half is the member's encryption key.
    #[must_use]
    pub fn app_key(&self) -> &AppKey {
        &self.app_key
    }

    /// The Ed25519 seed the member signs identity events with.
    #[must_use]
    pub fn signing_seed(&self) -> &SigningSeedHex {
        &self.signing_seed
    }

    /// Seal both keys under the passphrase.
    pub fn seal(
        &self,
        phrase: &RecoveryPhrase,
    ) -> Result<RecoverySealedSecret, RecoveryPassphraseError> {
        let plaintext = Zeroizing::new(
            serde_json::to_vec(&SealedKeys {
                encryption_secret: self.app_key.secret_string().into_inner(),
                signing_seed: self.signing_seed.as_str().to_owned(),
            })
            .map_err(|error| RecoveryPassphraseError::Unreadable(error.to_string()))?,
        );
        let ScryptWorkFactor(work_factor) = ScryptWorkFactor::RECOVERY;
        let mut recipient =
            scrypt::Recipient::new(SecretString::from(phrase.scrypt_passphrase().to_string()));
        recipient.set_work_factor(work_factor);
        let seal_failed = |error: &dyn fmt::Display| RecoveryPassphraseError::Unreadable(error.to_string());
        let encryptor = age::Encryptor::with_recipients(iter::once(&recipient as &dyn age::Recipient))
            .map_err(|error| seal_failed(&error))?;
        let mut armored = Vec::new();
        let armor = ArmoredWriter::wrap_output(&mut armored, Format::AsciiArmor)
            .map_err(|error| seal_failed(&error))?;
        let mut writer = encryptor
            .wrap_output(armor)
            .map_err(|error| seal_failed(&error))?;
        writer
            .write_all(&plaintext)
            .map_err(|error| seal_failed(&error))?;
        writer
            .finish()
            .and_then(ArmoredWriter::finish)
            .map_err(|error| seal_failed(&error))?;
        let text = String::from_utf8(armored).map_err(|error| seal_failed(&error))?;
        Ok(RecoverySealedSecret(
            AgeArmoredCiphertext::from_trusted_armored(text),
        ))
    }
}

impl RecoverySealedSecret {
    /// The armored seal, as the log stores it.
    #[must_use]
    pub fn ciphertext(&self) -> &AgeArmoredCiphertext {
        let Self(ciphertext) = self;
        ciphertext
    }

    /// Open the seal with typed words. Words that do not open it fail
    /// closed with [`RecoveryPassphraseError::WrongWords`].
    pub fn unseal(&self, phrase: &RecoveryPhrase) -> Result<RecoverySecret, RecoveryPassphraseError> {
        let Self(ciphertext) = self;
        let ScryptWorkFactor(work_factor) = ScryptWorkFactor::RECOVERY;
        let mut identity =
            scrypt::Identity::new(SecretString::from(phrase.scrypt_passphrase().to_string()));
        identity.set_max_work_factor(work_factor);
        let unreadable = |error: &dyn fmt::Display| RecoveryPassphraseError::Unreadable(error.to_string());
        let decryptor = age::Decryptor::new_buffered(ArmoredReader::new(ciphertext.as_str().as_bytes()))
            .map_err(|error| unreadable(&error))?;
        let mut reader = decryptor
            .decrypt(iter::once(&identity as &dyn age::Identity))
            .map_err(|error| match error {
                DecryptError::DecryptionFailed | DecryptError::NoMatchingKeys => {
                    RecoveryPassphraseError::WrongWords
                }
                other => unreadable(&other),
            })?;
        let mut plaintext = Zeroizing::new(Vec::new());
        reader
            .read_to_end(&mut plaintext)
            .map_err(|error| unreadable(&error))?;
        let keys: SealedKeys =
            serde_json::from_slice(&plaintext).map_err(|error| unreadable(&error))?;
        let app_key = DeviceIdentitySecret::parse(&keys.encryption_secret)
            .map_err(|error| unreadable(&error))
            .and_then(|secret| {
                AppKey::from_secret_str(&secret).map_err(|error| unreadable(&error))
            })?;
        let signing_seed =
            SigningSeedHex::parse(&keys.signing_seed).map_err(|error| unreadable(&error))?;
        Ok(RecoverySecret {
            app_key,
            signing_seed,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{RecoveryStrength, TypedRecoveryWords};

    #[test]
    fn the_words_open_the_seal_and_other_words_fail_closed() -> anyhow::Result<()> {
        let phrase = RecoveryPhrase::generate(RecoveryStrength::Standard)?;
        let secret = RecoverySecret::generate()?;
        let sealed = secret.seal(&phrase)?;
        // The log carries ciphertext only.
        let armored = sealed.ciphertext().as_str();
        assert!(armored.contains("BEGIN AGE ENCRYPTED FILE"));
        assert!(!armored.contains(secret.signing_seed().as_str()));
        for word in phrase.words() {
            assert!(!armored.contains(word));
        }

        // However the words are typed, they open the same seal.
        let typed = TypedRecoveryWords::from(phrase.words().join("-").to_uppercase());
        let opened = sealed.unseal(&RecoveryPhrase::parse(&typed, RecoveryStrength::Standard)?)?;
        assert_eq!(opened.app_key().app_id(), secret.app_key().app_id());
        assert_eq!(opened.signing_seed(), secret.signing_seed());

        let other = RecoveryPhrase::generate(RecoveryStrength::Standard)?;
        assert!(matches!(
            sealed.unseal(&other),
            Err(RecoveryPassphraseError::WrongWords)
        ));
        Ok(())
    }
}
