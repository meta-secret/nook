use std::io::{Read, Write};

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
    pub fn new(passphrase: &str) -> Result<Self, String> {
        let secret = age::secrecy::SecretString::from(passphrase.to_owned());
        let mut recipient = age::scrypt::Recipient::new(secret.clone());
        recipient.set_work_factor(PROGRAMMATIC_SCRYPT_LOG_N);
        let identity = age::scrypt::Identity::new(secret);
        Ok(Self { identity, recipient })
    }

    pub fn encrypt_value(&self, plaintext: &str) -> Result<String, String> {
        use age::armor::{ArmoredWriter, Format};

        let encryptor = age::Encryptor::with_recipients(std::iter::once(
            &self.recipient as &dyn age::Recipient,
        ))
        .map_err(|e| format!("Encryption setup error: {}", e))?;

        let mut armored = Vec::new();
        let armor_writer = ArmoredWriter::wrap_output(&mut armored, Format::AsciiArmor)
            .map_err(|e| format!("Armor wrap error: {}", e))?;
        let mut writer = encryptor
            .wrap_output(armor_writer)
            .map_err(|e| format!("Encryption error: {}", e))?;
        writer
            .write_all(plaintext.as_bytes())
            .map_err(|e| format!("Write error: {}", e))?;
        writer
            .finish()
            .map_err(|e| format!("Finish error: {}", e))?
            .finish()
            .map_err(|e| format!("Armor finish error: {}", e))?;

        String::from_utf8(armored).map_err(|e| format!("Invalid UTF-8 armor: {}", e))
    }

    pub fn decrypt_value(&self, armored: &str) -> Result<String, String> {
        use age::armor::ArmoredReader;

        let decryptor = age::Decryptor::new_buffered(ArmoredReader::new(armored.as_bytes()))
            .map_err(|e| format!("Decryption setup error: {}", e))?;

        let mut reader = decryptor
            .decrypt(std::iter::once(&self.identity as &dyn age::Identity))
            .map_err(|e| format!("Decryption error: {}", e))?;

        let mut decrypted = String::new();
        reader
            .read_to_string(&mut decrypted)
            .map_err(|e| format!("Read error: {}", e))?;
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
}
