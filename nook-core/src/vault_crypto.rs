use std::io::{Read, Write};

use crate::errors::{VaultCryptoError, VaultCryptoResult};
use crate::vault_wire::{AgeArmoredCiphertext, SymmetricKey};

/// Session-scoped age encryptor/decryptor.
///
/// Derives scrypt identity and recipient once. The browser vault key is high-entropy
/// random bytes (not a human passphrase), so we use a lower scrypt work factor than age's
/// default ~1s target for new encryptions. Existing records keep their embedded factor.
pub struct VaultCrypto {
    identity: age::scrypt::Identity,
    recipient: age::scrypt::Recipient,
}

/// scrypt N = 2^15 — fast enough for WASM while the key remains 128-bit random hex.
const PROGRAMMATIC_SCRYPT_LOG_N: u8 = 15;

impl VaultCrypto {
    pub fn new(passphrase: &SymmetricKey) -> VaultCryptoResult<Self> {
        let secret = age::secrecy::SecretString::from(passphrase.as_str().to_owned());
        let mut recipient = age::scrypt::Recipient::new(secret.clone());
        recipient.set_work_factor(PROGRAMMATIC_SCRYPT_LOG_N);
        let identity = age::scrypt::Identity::new(secret);
        Ok(Self {
            identity,
            recipient,
        })
    }

    pub fn encrypt_value(
        &self,
        plaintext: impl AsRef<str>,
    ) -> VaultCryptoResult<AgeArmoredCiphertext> {
        use age::armor::{ArmoredWriter, Format};

        let encryptor = age::Encryptor::with_recipients(std::iter::once(
            &self.recipient as &dyn age::Recipient,
        ))
        .map_err(|e| VaultCryptoError::EncryptSetup(e.to_string()))?;

        let mut armored = Vec::new();
        let armor_writer = ArmoredWriter::wrap_output(&mut armored, Format::AsciiArmor)
            .map_err(|e| VaultCryptoError::ArmorWrap(e.to_string()))?;
        let mut writer = encryptor
            .wrap_output(armor_writer)
            .map_err(|e| VaultCryptoError::Encrypt(e.to_string()))?;
        writer
            .write_all(plaintext.as_ref().as_bytes())
            .map_err(|e| VaultCryptoError::Write(e.to_string()))?;
        writer
            .finish()
            .map_err(|e| VaultCryptoError::Finish(e.to_string()))?
            .finish()
            .map_err(|e| VaultCryptoError::ArmorFinish(e.to_string()))?;

        let armored = String::from_utf8(armored)
            .map_err(|e| VaultCryptoError::InvalidUtf8Armor(e.to_string()))?;
        Ok(AgeArmoredCiphertext::from_trusted_armored(armored))
    }

    pub fn decrypt_value(&self, armored: &AgeArmoredCiphertext) -> VaultCryptoResult<String> {
        use age::armor::ArmoredReader;

        let decryptor =
            age::Decryptor::new_buffered(ArmoredReader::new(armored.as_str().as_bytes()))
                .map_err(|e| VaultCryptoError::DecryptSetup(e.to_string()))?;

        let mut reader = decryptor
            .decrypt(std::iter::once(&self.identity as &dyn age::Identity))
            .map_err(|e| VaultCryptoError::Decrypt(e.to_string()))?;

        let mut decrypted = String::new();
        reader
            .read_to_string(&mut decrypted)
            .map_err(|e| VaultCryptoError::Read(e.to_string()))?;
        Ok(decrypted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SymmetricKey;

    fn test_key() -> SymmetricKey {
        SymmetricKey::parse("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
            .unwrap()
    }

    #[test]
    fn roundtrip_with_cached_crypto() {
        let crypto = VaultCrypto::new(&test_key()).unwrap();
        let encrypted = crypto.encrypt_value("hello world").unwrap();
        let decrypted = crypto.decrypt_value(&encrypted).unwrap();
        assert_eq!(decrypted, "hello world");
    }

    #[test]
    fn wrong_passphrase_fails() {
        let crypto = VaultCrypto::new(&test_key()).unwrap();
        let encrypted = crypto.encrypt_value("secret").unwrap();
        let wrong =
            VaultCrypto::new(&SymmetricKey::parse("cafebabe".repeat(8).as_str()).unwrap()).unwrap();
        assert!(wrong.decrypt_value(&encrypted).is_err());
    }

    #[test]
    fn encrypt_is_nondeterministic() {
        let crypto = VaultCrypto::new(&test_key()).unwrap();
        let a = crypto.encrypt_value("same").unwrap();
        let b = crypto.encrypt_value("same").unwrap();
        assert_ne!(a, b);
        assert_eq!(crypto.decrypt_value(&a).unwrap(), "same");
        assert_eq!(crypto.decrypt_value(&b).unwrap(), "same");
    }
}
