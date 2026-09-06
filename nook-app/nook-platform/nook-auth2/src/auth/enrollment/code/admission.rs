//! Structural admission of the exact encrypted enrollment envelope.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::EnrollmentKeyDerivation;
use super::{ENROLLMENT_CIPHER, ENROLLMENT_KDF, IV_LEN};
use crate::auth::enrollment::{
    DecryptedEnrollmentPayload, EnrollmentCodeEnvelope, EnrollmentEntryLabel,
    EnrollmentProviderPayload,
};
use crate::errors::{EnrollmentError, EnrollmentResult};
use aes_gcm::{
    Aes256Gcm,
    aead::{Aead, KeyInit, array::Array},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};

/// Structurally checked encrypted input, consumed by decryption.
///
/// This proves structural admission only. Outer metadata is not authenticated;
/// this does not prove expiry, replay prevention, or vault/provider authorization.
/// Parsing the same code again remains possible.
///
/// Admission allows observation followed by consuming decryption:
/// ```
/// use nook_auth2::{CheckedEnrollmentEnvelope, DecryptedEnrollmentPayload, EnrollmentResult};
/// let decrypt = |code: &str, password: &str| -> EnrollmentResult<DecryptedEnrollmentPayload> {
///     let checked = CheckedEnrollmentEnvelope::parse(code)?;
///     assert!(!checked.envelope().entry_id.is_empty());
///     checked.decrypt(password)
/// };
/// ```
///
/// Public wire data cannot construct checked authority:
/// ```compile_fail,E0451
/// use nook_auth2::{CheckedEnrollmentEnvelope, EnrollmentCodeEnvelope};
/// let forge = |wire: EnrollmentCodeEnvelope| CheckedEnrollmentEnvelope { envelope: wire };
/// ```
///
/// Checked ownership cannot be cloned:
/// ```compile_fail,E0599
/// use nook_auth2::CheckedEnrollmentEnvelope;
/// let duplicate = |checked: CheckedEnrollmentEnvelope| checked.clone();
/// ```
///
/// Deserialization cannot bypass admission:
/// ```compile_fail,E0277
/// use nook_auth2::CheckedEnrollmentEnvelope;
/// let decode = |json: &str| serde_json::from_str::<CheckedEnrollmentEnvelope>(json);
/// ```
///
/// Observations cannot mutate the admitted input:
/// ```compile_fail,E0596
/// use nook_auth2::CheckedEnrollmentEnvelope;
/// let amend = |checked: CheckedEnrollmentEnvelope| checked.envelope().entry_id.clear();
/// ```
///
/// Decryption consumes the checked input even when it fails:
/// ```compile_fail,E0382
/// use nook_auth2::CheckedEnrollmentEnvelope;
/// let reuse = |checked: CheckedEnrollmentEnvelope| {
///     let first = checked.decrypt("password");
///     let second = checked.decrypt("password");
/// };
/// ```
pub struct CheckedEnrollmentEnvelope {
    envelope: EnrollmentCodeEnvelope,
}

impl CheckedEnrollmentEnvelope {
    /// Parse the wire envelope and check its structural parameters.
    pub fn parse(code: &str) -> EnrollmentResult<Self> {
        let cleaned = code.trim();
        if cleaned.is_empty() {
            return Err(EnrollmentError::InvalidCode);
        }
        let bytes =
            Engine::decode(&URL_SAFE_NO_PAD, cleaned).map_err(|_| EnrollmentError::InvalidCode)?;
        let envelope: EnrollmentCodeEnvelope =
            serde_json::from_slice(&bytes).map_err(|_| EnrollmentError::InvalidCode)?;
        Self::validate(&envelope)?;
        Ok(Self { envelope })
    }

    /// Observe the admitted wire fields without changing the encrypted input.
    #[must_use]
    pub const fn envelope(&self) -> &EnrollmentCodeEnvelope {
        &self.envelope
    }

    /// Decrypt this exact envelope with the existing password and provider checks.
    pub fn decrypt(self, password: &str) -> EnrollmentResult<DecryptedEnrollmentPayload> {
        let envelope = self.envelope;
        let password = password.trim();
        if password.is_empty() {
            return Err(EnrollmentError::DecryptPasswordRequired);
        }

        let salt = Engine::decode(&URL_SAFE_NO_PAD, envelope.salt.as_str())
            .map_err(|_| EnrollmentError::InvalidCode)?;
        let iv: [u8; IV_LEN] = Engine::decode(&URL_SAFE_NO_PAD, envelope.iv.as_str())
            .map_err(|_| EnrollmentError::InvalidCode)?
            .try_into()
            .map_err(|_| EnrollmentError::InvalidCode)?;
        let ciphertext = Engine::decode(&URL_SAFE_NO_PAD, envelope.ct.as_str())
            .map_err(|_| EnrollmentError::InvalidCode)?;
        let key = EnrollmentKeyDerivation {
            password,
            salt: &salt,
            iterations: envelope.iterations,
        }
        .derive();
        let cipher = Aes256Gcm::new(&Array(key));
        let plaintext = cipher
            .decrypt(&Array(iv), ciphertext.as_slice())
            .map_err(|_| EnrollmentError::WrongPassword)?;
        let provider_payload: EnrollmentProviderPayload =
            serde_json::from_slice(&plaintext).map_err(|_| EnrollmentError::WrongPassword)?;
        let EnrollmentProviderPayload {
            provider,
            vault_name,
        } = provider_payload;
        provider.validate()?;
        if vault_name.trim().is_empty() {
            return Err(EnrollmentError::WrongPassword);
        }

        Ok(DecryptedEnrollmentPayload {
            provider,
            vault_name,
            entry_id: envelope.entry_id,
            issued_at: envelope.issued_at,
        })
    }

    fn validate(envelope: &EnrollmentCodeEnvelope) -> EnrollmentResult<()> {
        if envelope.kdf != ENROLLMENT_KDF || envelope.cipher != ENROLLMENT_CIPHER {
            return Err(EnrollmentError::UnsupportedEncryptionParameters);
        }
        if u32::from(envelope.iterations) == 0 {
            return Err(EnrollmentError::MissingKdfParameters);
        }
        if envelope.entry_id.is_empty() {
            return Err(EnrollmentError::MissingEntryId);
        }
        if matches!(&envelope.entry_label, EnrollmentEntryLabel::Labeled(label) if label.is_empty())
        {
            return Err(EnrollmentError::InvalidEntryLabel);
        }
        for (field, value) in [
            ("salt", envelope.salt.as_str()),
            ("iv", envelope.iv.as_str()),
            ("ct", envelope.ct.as_str()),
            ("issued_at", envelope.issued_at.as_str()),
        ] {
            if value.is_empty() {
                return Err(EnrollmentError::MissingField { field });
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{CheckedEnrollmentEnvelope, EnrollmentCodeEnvelope, EnrollmentEntryLabel};
    use crate::errors::EnrollmentError;
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    use std::mem;

    struct EnrollmentDecryptionRejection<'a> {
        password: &'a str,
        expected: &'a EnrollmentError,
    }

    impl EnrollmentCodeEnvelope {
        fn admission_fixture() -> Self {
            Self {
                entry_id: "entry-1".to_owned(),
                entry_label: EnrollmentEntryLabel::Unlabeled,
                issued_at: "2026-06-23T12:00:00Z".to_owned(),
                kdf: "pbkdf2-sha256".to_owned(),
                iterations: 1.into(),
                salt: "AA".to_owned(),
                cipher: "aes-gcm-256".to_owned(),
                iv: "AA".to_owned(),
                ct: "AA".to_owned(),
            }
        }

        fn expect_decryption_error(
            &self,
            rejection: EnrollmentDecryptionRejection<'_>,
        ) -> anyhow::Result<()> {
            let EnrollmentDecryptionRejection { password, expected } = rejection;
            let encoded = Engine::encode(&URL_SAFE_NO_PAD, serde_json::to_vec(self)?.as_slice());
            match CheckedEnrollmentEnvelope::parse(&encoded)
                .and_then(|checked| checked.decrypt(password))
            {
                Err(actual) => {
                    assert_eq!(mem::discriminant(&actual), mem::discriminant(expected));
                    assert_eq!(actual.to_string(), expected.to_string());
                }
                Ok(_) => anyhow::bail!("expected enrollment rejection"),
            }
            Ok(())
        }
    }

    #[test]
    fn structural_errors_precede_empty_password_in_existing_order() -> anyhow::Result<()> {
        let mut wire = EnrollmentCodeEnvelope::admission_fixture();
        wire.kdf = "unsupported".to_owned();
        wire.iterations = 0.into();
        wire.entry_id.clear();
        wire.entry_label = EnrollmentEntryLabel::Labeled(String::new());
        wire.salt.clear();
        wire.iv.clear();
        wire.ct.clear();
        wire.issued_at.clear();
        wire.expect_decryption_error(EnrollmentDecryptionRejection {
            password: " ",
            expected: &EnrollmentError::UnsupportedEncryptionParameters,
        })?;
        wire.kdf = "pbkdf2-sha256".to_owned();
        wire.cipher = "unsupported".to_owned();
        wire.expect_decryption_error(EnrollmentDecryptionRejection {
            password: " ",
            expected: &EnrollmentError::UnsupportedEncryptionParameters,
        })?;
        wire.cipher = "aes-gcm-256".to_owned();
        wire.expect_decryption_error(EnrollmentDecryptionRejection {
            password: " ",
            expected: &EnrollmentError::MissingKdfParameters,
        })?;
        wire.iterations = 1.into();
        wire.expect_decryption_error(EnrollmentDecryptionRejection {
            password: " ",
            expected: &EnrollmentError::MissingEntryId,
        })?;
        wire.entry_id = "entry-1".to_owned();
        wire.expect_decryption_error(EnrollmentDecryptionRejection {
            password: " ",
            expected: &EnrollmentError::InvalidEntryLabel,
        })?;
        wire.entry_label = EnrollmentEntryLabel::Unlabeled;
        wire.expect_decryption_error(EnrollmentDecryptionRejection {
            password: " ",
            expected: &EnrollmentError::MissingField { field: "salt" },
        })?;
        wire.salt = "AA".to_owned();
        wire.expect_decryption_error(EnrollmentDecryptionRejection {
            password: " ",
            expected: &EnrollmentError::MissingField { field: "iv" },
        })?;
        wire.iv = "AA".to_owned();
        wire.expect_decryption_error(EnrollmentDecryptionRejection {
            password: " ",
            expected: &EnrollmentError::MissingField { field: "ct" },
        })?;
        wire.ct = "AA".to_owned();
        wire.expect_decryption_error(EnrollmentDecryptionRejection {
            password: " ",
            expected: &EnrollmentError::MissingField { field: "issued_at" },
        })?;
        wire.issued_at = "present".to_owned();
        wire.expect_decryption_error(EnrollmentDecryptionRejection {
            password: " ",
            expected: &EnrollmentError::DecryptPasswordRequired,
        })?;
        Ok(())
    }

    #[test]
    fn password_check_precedes_byte_decoding_and_iv_keeps_fixed_length() -> anyhow::Result<()> {
        let mut wire = EnrollmentCodeEnvelope::admission_fixture();
        wire.salt = "!".to_owned();
        wire.expect_decryption_error(EnrollmentDecryptionRejection {
            password: " ",
            expected: &EnrollmentError::DecryptPasswordRequired,
        })?;
        wire.expect_decryption_error(EnrollmentDecryptionRejection {
            password: "pw",
            expected: &EnrollmentError::InvalidCode,
        })?;
        wire.salt = "AA".to_owned();
        wire.expect_decryption_error(EnrollmentDecryptionRejection {
            password: "pw",
            expected: &EnrollmentError::InvalidCode,
        })?;
        wire.iv = Engine::encode(&URL_SAFE_NO_PAD, [0; 12].as_slice());
        wire.ct = "!".to_owned();
        wire.expect_decryption_error(EnrollmentDecryptionRejection {
            password: "pw",
            expected: &EnrollmentError::InvalidCode,
        })?;
        Ok(())
    }
}
