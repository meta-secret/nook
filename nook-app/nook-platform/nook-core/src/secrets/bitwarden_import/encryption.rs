#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Password-bound encrypted export admission and authenticated payload decryption.
use super::items::BitwardenItems;
use super::{BitwardenExportAccess, BitwardenImportError, BitwardenImportPlan};
use aes::cipher::{BlockModeDecrypt, KeyIvInit, block_padding::Pkcs7};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use hkdf::Hkdf;
use hmac::{Hmac, KeyInit, Mac};
use pbkdf2::{pbkdf2_hmac, sha2::Sha256 as Pbkdf2Sha256};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

const MIN_PBKDF2_ITERATIONS: u32 = 5_000;
const MAX_PBKDF2_ITERATIONS: u32 = 10_000_000;
const MIN_ARGON2_MEMORY_MIB: u32 = 16;
const MAX_ARGON2_MEMORY_MIB: u32 = 1_024;
const MIN_ARGON2_ITERATIONS: u32 = 2;
const MAX_ARGON2_ITERATIONS: u32 = 20;
const MAX_ARGON2_PARALLELISM: u32 = 16;

// Raw Argon2-only declarations are admitted after export restriction and password checks.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum BitwardenArgonParameter {
    Declared(u32),
    NotExported(()),
}
impl Default for BitwardenArgonParameter {
    fn default() -> Self {
        Self::NotExported(())
    }
}
impl BitwardenArgonParameter {
    fn required(&self, name: &str) -> Result<u32, BitwardenImportError> {
        match self {
            Self::Declared(value) => Ok(*value),
            Self::NotExported(()) => Err(BitwardenImportError::encrypted(format!(
                "{name} is missing."
            ))),
        }
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EncryptedBitwardenExport {
    password_protected: bool,
    salt: String,
    kdf_type: u32,
    kdf_iterations: u32,
    #[serde(default)]
    kdf_memory: BitwardenArgonParameter,
    #[serde(default)]
    kdf_parallelism: BitwardenArgonParameter,
    #[serde(rename = "encKeyValidation_DO_NOT_EDIT")]
    enc_key_validation: String,
    data: String,
}

enum CheckedBitwardenKdf {
    Pbkdf2(u32),
    Argon2(Params),
}

struct BitwardenEncryptionKey {
    encryption: Zeroizing<[u8; 32]>,
    authentication: Zeroizing<[u8; 32]>,
}

struct EncStringParts {
    iv: [u8; 16],
    ciphertext: Zeroizing<Vec<u8>>,
    mac: [u8; 32],
}

impl EncryptedBitwardenExport {
    pub(super) fn parse(json: &str) -> Result<Self, BitwardenImportError> {
        serde_json::from_str(json).map_err(|error| {
            BitwardenImportError::encrypted(format!("missing or invalid metadata: {error}"))
        })
    }
    pub(super) fn check(
        self,
        password: BitwardenExportAccess<'_>,
    ) -> Result<CheckedBitwardenDecryption, BitwardenImportError> {
        if !self.password_protected {
            return Err(BitwardenImportError::AccountRestrictedExport);
        }
        let password = match password {
            BitwardenExportAccess::PasswordProvided(password) if !password.is_empty() => password,
            BitwardenExportAccess::PasswordProvided(_) | BitwardenExportAccess::WithoutPassword => {
                return Err(BitwardenImportError::PasswordRequired);
            }
        };
        let key = self.derive_key(password)?;
        key.decrypt(&self.enc_key_validation)?;
        Ok(CheckedBitwardenDecryption { export: self, key })
    }
    fn checked_kdf(&self) -> Result<CheckedBitwardenKdf, BitwardenImportError> {
        match self.kdf_type {
            0 => {
                let iterations = BitwardenKdfRange {
                    name: "PBKDF2 iterations",
                    minimum: MIN_PBKDF2_ITERATIONS,
                    maximum: MAX_PBKDF2_ITERATIONS,
                }
                .validate(self.kdf_iterations)?;
                Ok(CheckedBitwardenKdf::Pbkdf2(iterations))
            }
            1 => {
                let memory_mib = BitwardenKdfRange {
                    name: "Argon2 memory",
                    minimum: MIN_ARGON2_MEMORY_MIB,
                    maximum: MAX_ARGON2_MEMORY_MIB,
                }
                .validate(self.kdf_memory.required("Argon2 memory")?)?;
                let iterations = BitwardenKdfRange {
                    name: "Argon2 iterations",
                    minimum: MIN_ARGON2_ITERATIONS,
                    maximum: MAX_ARGON2_ITERATIONS,
                }
                .validate(self.kdf_iterations)?;
                let parallelism = BitwardenKdfRange {
                    name: "Argon2 parallelism",
                    minimum: 1,
                    maximum: MAX_ARGON2_PARALLELISM,
                }
                .validate(self.kdf_parallelism.required("Argon2 parallelism")?)?;
                let memory_cost_kib = memory_mib.checked_mul(1_024).ok_or_else(|| {
                    BitwardenImportError::encrypted("Argon2 memory is too large.")
                })?;
                let params = Params::new(memory_cost_kib, iterations, parallelism, Some(32))
                    .map_err(|error| {
                        BitwardenImportError::encrypted(format!("invalid Argon2 settings: {error}"))
                    })?;
                Ok(CheckedBitwardenKdf::Argon2(params))
            }
            other => {
                return Err(BitwardenImportError::encrypted(format!(
                    "unsupported KDF type {other}."
                )));
            }
        }
    }
    fn derive_key(&self, password: &str) -> Result<BitwardenEncryptionKey, BitwardenImportError> {
        let mut derived = Zeroizing::new([0_u8; 32]);
        match self.checked_kdf()? {
            CheckedBitwardenKdf::Pbkdf2(iterations) => {
                pbkdf2_hmac::<Pbkdf2Sha256>(
                    password.as_bytes(),
                    self.salt.as_bytes(),
                    iterations,
                    derived.as_mut(),
                );
            }
            CheckedBitwardenKdf::Argon2(params) => {
                let salt_hash = Sha256::digest(self.salt.as_bytes());
                Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
                    .hash_password_into(password.as_bytes(), &salt_hash, derived.as_mut())
                    .map_err(|error| {
                        BitwardenImportError::encrypted(format!("Argon2 failed: {error}"))
                    })?;
            }
        }

        let hkdf = Hkdf::<Sha256>::from_prk(derived.as_ref())
            .map_err(|_| BitwardenImportError::encrypted("derived key has the wrong length."))?;
        let mut encryption = Zeroizing::new([0_u8; 32]);
        let mut authentication = Zeroizing::new([0_u8; 32]);
        hkdf.expand(b"enc", encryption.as_mut())
            .map_err(|_| BitwardenImportError::encrypted("could not derive the encryption key."))?;
        hkdf.expand(b"mac", authentication.as_mut()).map_err(|_| {
            BitwardenImportError::encrypted("could not derive the authentication key.")
        })?;
        Ok(BitwardenEncryptionKey {
            encryption,
            authentication,
        })
    }
}

/// Validation of one export never authorizes a substituted payload or key.
/// ```compile_fail,E0603
/// use nook_core::bitwarden_import::encryption::CheckedBitwardenDecryption;
/// ```
pub(super) struct CheckedBitwardenDecryption {
    export: EncryptedBitwardenExport,
    key: BitwardenEncryptionKey,
}
impl CheckedBitwardenDecryption {
    pub(super) fn plan(self) -> Result<BitwardenImportPlan, BitwardenImportError> {
        let decrypted = self.key.decrypt(&self.export.data)?;
        let items = BitwardenItems::parse(decrypted.as_str())
            .map_err(|_| BitwardenImportError::InvalidPassword)?;
        Ok(items.plan())
    }
}
struct BitwardenKdfRange {
    name: &'static str,
    minimum: u32,
    maximum: u32,
}
impl BitwardenKdfRange {
    fn validate(self, value: u32) -> Result<u32, BitwardenImportError> {
        if (self.minimum..=self.maximum).contains(&value) {
            Ok(value)
        } else {
            Err(BitwardenImportError::encrypted(format!(
                "{} must be between {} and {}.",
                self.name, self.minimum, self.maximum
            )))
        }
    }
}
impl EncStringParts {
    fn decode(encoded: &str) -> Result<EncStringParts, BitwardenImportError> {
        let payload = encoded.strip_prefix("2.").ok_or_else(|| {
            BitwardenImportError::encrypted("encrypted data must use Bitwarden type 2.")
        })?;
        let mut parts = payload.split('|');
        let iv = parts
            .next()
            .and_then(|value| Engine::decode(&BASE64, value).ok())
            .and_then(|value| value.try_into().ok())
            .ok_or_else(|| BitwardenImportError::encrypted("encrypted data has an invalid IV."))?;
        let ciphertext = parts
            .next()
            .and_then(|value| Engine::decode(&BASE64, value).ok())
            .filter(|value| !value.is_empty() && value.len() % 16 == 0)
            .map(Zeroizing::new)
            .ok_or_else(|| {
                BitwardenImportError::encrypted("encrypted data has invalid ciphertext.")
            })?;
        let mac = parts
            .next()
            .and_then(|value| Engine::decode(&BASE64, value).ok())
            .and_then(|value| value.try_into().ok())
            .ok_or_else(|| BitwardenImportError::encrypted("encrypted data has an invalid MAC."))?;
        if parts.next().is_some() {
            return Err(BitwardenImportError::encrypted(
                "encrypted data has too many fields.",
            ));
        }
        Ok(EncStringParts {
            iv,
            ciphertext,
            mac,
        })
    }
}
impl BitwardenEncryptionKey {
    fn decrypt(&self, encoded: &str) -> Result<Zeroizing<String>, BitwardenImportError> {
        let EncStringParts {
            iv,
            mut ciphertext,
            mac,
        } = EncStringParts::decode(encoded)?;
        let mut verifier =
            Hmac::<Sha256>::new_from_slice(self.authentication.as_ref()).map_err(|_| {
                BitwardenImportError::encrypted("authentication key has the wrong length.")
            })?;
        verifier.update(&iv);
        verifier.update(ciphertext.as_ref());
        verifier
            .verify_slice(&mac)
            .map_err(|_| BitwardenImportError::InvalidPassword)?;

        let plaintext =
            cbc::Decryptor::<aes::Aes256>::new((&*self.encryption).into(), (&iv).into())
                .decrypt_padded::<Pkcs7>(ciphertext.as_mut())
                .map_err(|_| BitwardenImportError::InvalidPassword)?;
        let plaintext = String::from_utf8(plaintext.to_vec())
            .map_err(|_| BitwardenImportError::InvalidPassword)?;
        ciphertext.zeroize();
        Ok(Zeroizing::new(plaintext))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        BitwardenArgonParameter, BitwardenExportAccess, BitwardenImportError, BitwardenKdfRange,
        EncStringParts, EncryptedBitwardenExport,
    };
    use base64::Engine;

    impl EncryptedBitwardenExport {
        fn fixture() -> anyhow::Result<Self> {
            Ok(serde_json::from_str(include_str!(
                "../fixtures/bitwarden_encrypted_pbkdf2.json"
            ))?)
        }
    }

    #[test]
    fn admitted_validation_does_not_bypass_payload_authentication() -> anyhow::Result<()> {
        let mut export = EncryptedBitwardenExport::fixture()?;
        let mut parts = EncStringParts::decode(&export.data)?;
        parts.mac[0] ^= 1;
        export.data = format!(
            "2.{}|{}|{}",
            Engine::encode(&super::BASE64, parts.iv),
            Engine::encode(&super::BASE64, parts.ciphertext.as_slice()),
            Engine::encode(&super::BASE64, parts.mac)
        );
        let checked = export.check(BitwardenExportAccess::PasswordProvided(
            "correct horse battery staple",
        ))?;
        assert!(matches!(
            checked.plan(),
            Err(BitwardenImportError::InvalidPassword)
        ));
        Ok(())
    }

    #[test]
    fn malformed_validation_precedes_malformed_payload() -> anyhow::Result<()> {
        let mut export = EncryptedBitwardenExport::fixture()?;
        export.enc_key_validation = "1.invalid".to_owned();
        export.data = "2.invalid".to_owned();
        match export.check(BitwardenExportAccess::PasswordProvided(
            "correct horse battery staple",
        )) {
            Err(BitwardenImportError::InvalidEncryptedExport(message)) => {
                assert_eq!(message, "encrypted data must use Bitwarden type 2.");
            }
            _ => anyhow::bail!("validation must reject before payload decoding"),
        }
        Ok(())
    }

    #[test]
    fn encoding_rejects_each_malformed_component_in_order() {
        for (encoded, expected) in [
            ("1.invalid", "encrypted data must use Bitwarden type 2."),
            ("2.invalid", "encrypted data has an invalid IV."),
            (
                "2.AAAAAAAAAAAAAAAAAAAAAA==|",
                "encrypted data has invalid ciphertext.",
            ),
            (
                "2.AAAAAAAAAAAAAAAAAAAAAA==|AAAAAAAAAAAAAAAAAAAAAA==|",
                "encrypted data has an invalid MAC.",
            ),
            (
                "2.AAAAAAAAAAAAAAAAAAAAAA==|AAAAAAAAAAAAAAAAAAAAAA==|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=|extra",
                "encrypted data has too many fields.",
            ),
        ] {
            match EncStringParts::decode(encoded) {
                Err(BitwardenImportError::InvalidEncryptedExport(message)) => {
                    assert_eq!(message, expected);
                }
                _ => panic!("invalid encoding must retain its specific error"),
            }
        }
    }

    #[test]
    fn kdf_ranges_admit_endpoints_and_reject_outside_values() -> anyhow::Result<()> {
        for (name, minimum, maximum) in [
            ("PBKDF2 iterations", 5_000, 10_000_000),
            ("Argon2 memory", 16, 1_024),
            ("Argon2 iterations", 2, 20),
            ("Argon2 parallelism", 1, 16),
        ] {
            for value in [minimum, maximum] {
                assert_eq!(
                    BitwardenKdfRange {
                        name,
                        minimum,
                        maximum
                    }
                    .validate(value)?,
                    value
                );
            }
            for value in [minimum - 1, maximum + 1] {
                match (BitwardenKdfRange {
                    name,
                    minimum,
                    maximum,
                })
                .validate(value)
                {
                    Err(BitwardenImportError::InvalidEncryptedExport(message)) => {
                        assert_eq!(
                            message,
                            format!("{name} must be between {minimum} and {maximum}.")
                        );
                    }
                    _ => anyhow::bail!("outside KDF range must reject"),
                }
            }
        }
        Ok(())
    }

    #[test]
    fn argon_metadata_errors_keep_memory_then_iterations_then_parallelism_order()
    -> anyhow::Result<()> {
        for (memory, iterations, parallelism, expected) in [
            (
                BitwardenArgonParameter::NotExported(()),
                0,
                BitwardenArgonParameter::NotExported(()),
                "Argon2 memory is missing.",
            ),
            (
                BitwardenArgonParameter::Declared(16),
                0,
                BitwardenArgonParameter::NotExported(()),
                "Argon2 iterations must be between 2 and 20.",
            ),
            (
                BitwardenArgonParameter::Declared(16),
                2,
                BitwardenArgonParameter::NotExported(()),
                "Argon2 parallelism is missing.",
            ),
        ] {
            let mut export = EncryptedBitwardenExport::fixture()?;
            export.kdf_type = 1;
            export.kdf_memory = memory;
            export.kdf_iterations = iterations;
            export.kdf_parallelism = parallelism;
            match export.check(BitwardenExportAccess::PasswordProvided("password")) {
                Err(BitwardenImportError::InvalidEncryptedExport(message)) => {
                    assert_eq!(message, expected);
                }
                _ => anyhow::bail!("invalid KDF metadata must reject"),
            }
        }
        Ok(())
    }
    #[test]
    fn derives_bitwarden_argon2id_export_key() -> anyhow::Result<()> {
        // Expected values come from Bitwarden SDK's Argon2id KDF vector, then
        // its documented HKDF "enc" / "mac" expansion.
        let export = EncryptedBitwardenExport {
            password_protected: true,
            salt: "test_key".to_owned(),
            kdf_type: 1,
            kdf_iterations: 4,
            kdf_memory: BitwardenArgonParameter::Declared(32),
            kdf_parallelism: BitwardenArgonParameter::Declared(2),
            enc_key_validation: String::new(),
            data: String::new(),
        };
        let key = export.derive_key("67t9b5g67$%Dh89n")?;
        assert_eq!(
            *key.encryption,
            [
                236, 253, 166, 121, 207, 124, 98, 149, 42, 141, 97, 226, 207, 71, 173, 60, 10, 0,
                184, 255, 252, 87, 62, 32, 188, 166, 173, 223, 146, 159, 222, 219,
            ]
        );
        assert_eq!(
            *key.authentication,
            [
                214, 144, 76, 173, 225, 106, 132, 131, 173, 56, 134, 241, 223, 227, 165, 161, 146,
                37, 111, 206, 155, 24, 224, 151, 134, 189, 202, 0, 27, 149, 131, 21,
            ]
        );
        Ok(())
    }
}
