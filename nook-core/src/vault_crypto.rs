use std::io::{Read, Write};

use crate::errors::{VaultCryptoError, VaultCryptoResult};

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
    pub fn new(passphrase: &str) -> VaultCryptoResult<Self> {
        let secret = age::secrecy::SecretString::from(passphrase.to_owned());
        let mut recipient = age::scrypt::Recipient::new(secret.clone());
        recipient.set_work_factor(PROGRAMMATIC_SCRYPT_LOG_N);
        let identity = age::scrypt::Identity::new(secret);
        Ok(Self {
            identity,
            recipient,
        })
    }

    pub fn encrypt_value(&self, plaintext: &str) -> VaultCryptoResult<String> {
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
            .write_all(plaintext.as_bytes())
            .map_err(|e| VaultCryptoError::Write(e.to_string()))?;
        writer
            .finish()
            .map_err(|e| VaultCryptoError::Finish(e.to_string()))?
            .finish()
            .map_err(|e| VaultCryptoError::ArmorFinish(e.to_string()))?;

        String::from_utf8(armored).map_err(|e| VaultCryptoError::InvalidUtf8Armor(e.to_string()))
    }

    pub fn decrypt_value(&self, armored: &str) -> VaultCryptoResult<String> {
        use age::armor::ArmoredReader;

        let decryptor = age::Decryptor::new_buffered(ArmoredReader::new(armored.as_bytes()))
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

    #[test]
    fn roundtrip_with_cached_crypto() {
        let crypto = VaultCrypto::new("deadbeefdeadbeefdeadbeefdeadbeef").unwrap();
        let plaintext = "secret-value";
        let armored = crypto.encrypt_value(plaintext).unwrap();
        assert!(armored.contains("BEGIN AGE ENCRYPTED FILE"));
        assert_eq!(crypto.decrypt_value(&armored).unwrap(), plaintext);
    }

    #[test]
    fn wrong_passphrase_fails_to_decrypt() {
        let enc = VaultCrypto::new("correct-key-1234567890123456").unwrap();
        let armored = enc.encrypt_value("payload").unwrap();
        let dec = VaultCrypto::new("wrong-key-123456789012345678").unwrap();
        assert!(dec.decrypt_value(&armored).is_err());
    }

    #[test]
    fn repeated_encrypt_produces_unique_ciphertext() {
        let crypto = VaultCrypto::new("deadbeefdeadbeefdeadbeefdeadbeef").unwrap();
        let first = crypto.encrypt_value("same").unwrap();
        let second = crypto.encrypt_value("same").unwrap();
        assert_ne!(first, second);
        assert_eq!(crypto.decrypt_value(&first).unwrap(), "same");
        assert_eq!(crypto.decrypt_value(&second).unwrap(), "same");
    }

    #[test]
    fn multiline_plaintext_roundtrip() {
        let crypto = VaultCrypto::new("deadbeefdeadbeefdeadbeefdeadbeef").unwrap();
        let plaintext = "line-one\nline-two\n\tindented";
        let armored = crypto.encrypt_value(plaintext).unwrap();
        assert_eq!(crypto.decrypt_value(&armored).unwrap(), plaintext);
    }
}
