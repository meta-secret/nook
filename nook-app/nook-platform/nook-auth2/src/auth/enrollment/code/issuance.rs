#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Checked enrollment issuance retains the exact provider input until encryption.
use super::{
    ENROLLMENT_CIPHER, ENROLLMENT_KDF, EnrollmentKeyDerivation, IV_LEN, PBKDF2_ITERATIONS, SALT_LEN,
};
use crate::auth::enrollment::{
    EnrollmentCodeEnvelope, EnrollmentEntryLabel, EnrollmentIssueInput, EnrollmentProviderPayload,
};
use crate::{EnrollmentError, EnrollmentResult};
use aes_gcm::{
    Aes256Gcm,
    aead::{Aead, KeyInit, array::Array},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};

pub struct EnrollmentIssuance<'a> {
    pub input: &'a EnrollmentIssueInput,
    pub password: &'a str,
    pub entry_label: &'a str,
}
/// Validated issuance input; this does not prove provider access or recipient authorization.
/// The original input stays borrowed and encryption consumes this particular check.
///
/// ```
/// use nook_auth2::{EnrollmentIssueInput, EnrollmentIssuance, EnrollmentResult};
/// let issue = |input: &EnrollmentIssueInput| -> EnrollmentResult<String> {
///     EnrollmentIssuance { input, password: "password", entry_label: "Phone" }
///         .check()?.issue()
/// };
/// ```
///
/// Only validation constructs checked state:
/// ```compile_fail,E0451
/// use nook_auth2::{CheckedEnrollmentIssuance, EnrollmentIssueInput};
/// let forge = |input: &EnrollmentIssueInput| CheckedEnrollmentIssuance {
///     input, password: "", entry_id: "", vault_name: "", entry_label: "",
/// };
/// ```
///
/// Unchecked requests cannot issue:
/// ```compile_fail,E0599
/// use nook_auth2::EnrollmentIssuance;
/// let bypass = |request: EnrollmentIssuance<'_>| request.issue();
/// ```
///
/// Checked state has no duplication or deserialization route:
/// ```compile_fail,E0599
/// use nook_auth2::CheckedEnrollmentIssuance;
/// let duplicate = |checked: CheckedEnrollmentIssuance<'_>| checked.clone();
/// ```
/// ```compile_fail,E0277
/// use nook_auth2::CheckedEnrollmentIssuance;
/// let decode = |json: &str| serde_json::from_str::<CheckedEnrollmentIssuance<'_>>(json);
/// ```
///
/// Issuance consumes the check, including on encryption failure:
/// ```compile_fail,E0382
/// use nook_auth2::{CheckedEnrollmentIssuance, EnrollmentResult};
/// let reuse = |checked: CheckedEnrollmentIssuance<'_>| -> EnrollmentResult<String> {
///     checked.issue()?;
///     checked.issue()
/// };
/// ```
///
/// The original observation cannot change while checked state is retained:
/// ```compile_fail,E0502
/// use nook_auth2::{EnrollmentIssueInput, EnrollmentIssuance, EnrollmentResult};
/// let change = |input: &mut EnrollmentIssueInput| -> EnrollmentResult<String> {
///     let checked = EnrollmentIssuance { input, password: "password", entry_label: "" }.check()?;
///     input.vault_name.clear();
///     checked.issue()
/// };
/// ```
pub struct CheckedEnrollmentIssuance<'a> {
    input: &'a EnrollmentIssueInput,
    password: &'a str,
    entry_id: &'a str,
    vault_name: &'a str,
    entry_label: &'a str,
}
impl<'a> EnrollmentIssuance<'a> {
    pub fn check(self) -> EnrollmentResult<CheckedEnrollmentIssuance<'a>> {
        let password = self.password.trim();
        if password.is_empty() {
            return Err(EnrollmentError::EncryptPasswordRequired);
        }

        let entry_id = self.input.entry_id.trim();
        if entry_id.is_empty() {
            return Err(EnrollmentError::EntryIdRequired);
        }

        self.input.provider.validate()?;
        let vault_name = self.input.vault_name.trim();
        if vault_name.is_empty() {
            return Err(EnrollmentError::MissingField {
                field: "vault_name",
            });
        }

        Ok(CheckedEnrollmentIssuance {
            input: self.input,
            password,
            entry_id,
            vault_name,
            entry_label: self.entry_label,
        })
    }
}
impl CheckedEnrollmentIssuance<'_> {
    pub fn issue(self) -> EnrollmentResult<String> {
        let inner = EnrollmentProviderPayload {
            provider: self.input.provider.clone(),
            vault_name: self.vault_name.to_owned(),
        };
        let mut salt = [0u8; SALT_LEN];
        let mut iv = [0u8; IV_LEN];
        getrandom::fill(&mut salt).map_err(|e| EnrollmentError::RandomBytes(e.to_string()))?;
        getrandom::fill(&mut iv).map_err(|e| EnrollmentError::RandomBytes(e.to_string()))?;

        let key = EnrollmentKeyDerivation {
            password: self.password,
            salt: &salt,
            iterations: PBKDF2_ITERATIONS.into(),
        }
        .derive();
        let cipher = Aes256Gcm::new(&Array(key));
        let plaintext = serde_json::to_vec(&inner).map_err(EnrollmentError::Serialize)?;
        let ciphertext = cipher
            .encrypt(&Array(iv), plaintext.as_slice())
            .map_err(|_| EnrollmentError::WrongPassword)?;

        let label = self.entry_label.trim();
        let envelope = EnrollmentCodeEnvelope {
            entry_id: self.entry_id.to_owned(),
            entry_label: if label.is_empty() {
                EnrollmentEntryLabel::Unlabeled
            } else {
                EnrollmentEntryLabel::Labeled(label.to_owned())
            },
            issued_at: self.input.issued_at.clone(),
            kdf: ENROLLMENT_KDF.to_owned(),
            iterations: PBKDF2_ITERATIONS.into(),
            salt: Engine::encode(&URL_SAFE_NO_PAD, salt.as_slice()),
            cipher: ENROLLMENT_CIPHER.to_owned(),
            iv: Engine::encode(&URL_SAFE_NO_PAD, iv.as_slice()),
            ct: Engine::encode(&URL_SAFE_NO_PAD, ciphertext.as_slice()),
        };
        envelope.encode()
    }
}

#[cfg(test)]
mod tests {
    use super::{CheckedEnrollmentIssuance, EnrollmentIssuance};
    use crate::EnrollmentError;
    use crate::auth::enrollment::{
        CheckedEnrollmentEnvelope, EnrollmentEntryLabel, EnrollmentIssueInput, EnrollmentProvider,
        EnrollmentProviderDataRef, OAuthAccountIdentity, OAuthRefreshCredential, OAuthRemoteFile,
        OAuthTokenExpiry, PersonalEnrollmentProvider, SharedEnrollmentProvider,
        SharedEnrollmentProviderData,
    };
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    use serde_json::json;
    impl EnrollmentIssueInput {
        fn github_fixture() -> Self {
            Self {
                provider: EnrollmentProvider::personal(PersonalEnrollmentProvider::github(
                    "github_pat_11AAAAbbbbCCCC".to_owned(),
                    "team-vault".to_owned(),
                )),
                vault_name: "Team vault".to_owned(),
                entry_id: "entry-1".to_owned(),
                issued_at: "2026-06-23T12:00:00Z".to_owned(),
            }
        }
    }

    impl EnrollmentIssuance<'_> {
        fn expect_rejection(self, expected: &EnrollmentError) -> anyhow::Result<()> {
            match self.check() {
                Err(actual) => {
                    assert_eq!(actual.to_string(), expected.to_string());
                }
                Ok(_) => anyhow::bail!("expected issuance rejection"),
            }
            Ok(())
        }
    }

    #[test]
    fn issuance_validation_keeps_password_entry_provider_vault_order() -> anyhow::Result<()> {
        let mut input = EnrollmentIssueInput::github_fixture();
        input.entry_id = " ".to_owned();
        input.vault_name = "\n".to_owned();
        input.provider = EnrollmentProvider::personal(PersonalEnrollmentProvider::github(
            String::new(),
            "repo".to_owned(),
        ));
        EnrollmentIssuance {
            input: &input,
            password: " ",
            entry_label: "",
        }
        .expect_rejection(&EnrollmentError::EncryptPasswordRequired)?;
        EnrollmentIssuance {
            input: &input,
            password: "pw",
            entry_label: "",
        }
        .expect_rejection(&EnrollmentError::EntryIdRequired)?;
        input.entry_id = "entry".to_owned();
        EnrollmentIssuance {
            input: &input,
            password: "pw",
            entry_label: "",
        }
        .expect_rejection(&EnrollmentError::MalformedGithubProvider)?;
        input.provider = EnrollmentProvider::personal(PersonalEnrollmentProvider::local());
        EnrollmentIssuance {
            input: &input,
            password: "pw",
            entry_label: "",
        }
        .expect_rejection(&EnrollmentError::MissingField {
            field: "vault_name",
        })?;
        Ok(())
    }

    #[test]
    fn checked_issuance_trims_only_the_existing_fields_and_keeps_wire_parameters()
    -> anyhow::Result<()> {
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::personal(PersonalEnrollmentProvider::github(
                " token ".to_owned(),
                " repo ".to_owned(),
            )),
            vault_name: "  Vault \n".to_owned(),
            entry_id: "  entry  ".to_owned(),
            issued_at: "  timestamp  ".to_owned(),
        };
        let code = EnrollmentIssuance {
            input: &input,
            password: "  password  ",
            entry_label: "  Phone  ",
        }
        .check()?
        .issue()?;
        let checked = CheckedEnrollmentEnvelope::parse(&code)?;
        let wire = checked.envelope();
        assert_eq!(wire.entry_id, "entry");
        assert_eq!(
            wire.entry_label,
            EnrollmentEntryLabel::Labeled("Phone".to_owned())
        );
        assert_eq!(wire.issued_at, input.issued_at);
        assert_eq!(wire.kdf, "pbkdf2-sha256");
        assert_eq!(u32::from(wire.iterations), 210_000);
        assert_eq!(wire.cipher, "aes-gcm-256");
        assert_eq!(
            Engine::decode(&URL_SAFE_NO_PAD, wire.salt.as_str())?.len(),
            16
        );
        assert_eq!(
            Engine::decode(&URL_SAFE_NO_PAD, wire.iv.as_str())?.len(),
            12
        );
        let decrypted = checked.decrypt("password")?;
        assert_eq!(decrypted.provider, input.provider);
        assert_eq!(decrypted.vault_name, "Vault");
        Ok(())
    }

    #[test]
    fn outer_report_metadata_remains_unbound_to_ciphertext() -> anyhow::Result<()> {
        let input = EnrollmentIssueInput::github_fixture();
        let code = EnrollmentIssuance {
            input: &input,
            password: "password",
            entry_label: "",
        }
        .check()?
        .issue()?;
        let checked = CheckedEnrollmentEnvelope::parse(&code)?;
        let mut wire = checked.envelope().clone();
        wire.entry_id = "reported-entry".to_owned();
        wire.issued_at = "reported-time".to_owned();
        let rewritten = wire.encode()?;
        let decrypted = CheckedEnrollmentEnvelope::parse(&rewritten)?.decrypt("password")?;
        assert_eq!(decrypted.entry_id, "reported-entry");
        assert_eq!(decrypted.issued_at, "reported-time");
        assert_eq!(decrypted.provider, input.provider);
        Ok(())
    }

    #[test]
    fn preserves_local_provider() -> anyhow::Result<()> {
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::personal(PersonalEnrollmentProvider::local()),
            vault_name: "Local vault".to_owned(),
            entry_id: "entry-local".to_owned(),
            issued_at: "2026-06-23T12:00:00Z".to_owned(),
        };
        let code = EnrollmentIssuance {
            input: &input,
            password: "hunter2",
            entry_label: "",
        }
        .check()
        .and_then(CheckedEnrollmentIssuance::issue)?;
        let decrypted = CheckedEnrollmentEnvelope::parse(&code)?.decrypt("hunter2")?;
        assert_eq!(
            decrypted.provider,
            EnrollmentProvider::personal(PersonalEnrollmentProvider::local())
        );
        Ok(())
    }

    #[test]
    fn shared_provider_grant_roundtrips_without_provider_credentials() -> anyhow::Result<()> {
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
                "joiner@example.com".to_owned(),
                "shared-folder-abc".to_owned(),
            )),
            vault_name: "Shared vault".to_owned(),
            entry_id: "entry-shared".to_owned(),
            issued_at: "2026-06-23T12:00:00Z".to_owned(),
        };
        let code = EnrollmentIssuance {
            input: &input,
            password: "hunter2",
            entry_label: "Shared Drive grant",
        }
        .check()
        .and_then(CheckedEnrollmentIssuance::issue)?;
        let decrypted = CheckedEnrollmentEnvelope::parse(&code)?.decrypt("hunter2")?;
        assert_eq!(decrypted.provider, input.provider);
        match decrypted.provider.data() {
            EnrollmentProviderDataRef::Shared(SharedEnrollmentProviderData::GoogleDrive {
                storage_target_id,
                ..
            }) => {
                assert_eq!(storage_target_id, "shared-folder-abc");
            }
            _ => anyhow::bail!("expected shared grant"),
        }

        let checked = CheckedEnrollmentEnvelope::parse(&code)?;
        let envelope = checked.envelope();
        let serialized = serde_json::to_string(envelope)?;
        assert!(!serialized.contains("ya29."));
        assert!(!serialized.contains("github_pat_"));
        assert!(!serialized.contains("hunter2"));
        Ok(())
    }

    #[test]
    fn shared_icloud_target_roundtrips_without_provider_credentials() -> anyhow::Result<()> {
        let storage_target_id = concat!(
            "icloud-share-v1:",
            r#"{"role":"owner","zoneName":"zone","ownerRecordName":"owner","rootRecordName":"root","shortGuid":"guid"}"#
        )
        .to_owned();
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::shared(SharedEnrollmentProvider::icloud(
                storage_target_id.clone(),
            )),
            vault_name: "Shared iCloud vault".to_owned(),
            entry_id: "entry-icloud-shared".to_owned(),
            issued_at: "2026-06-23T12:00:00Z".to_owned(),
        };
        let code = EnrollmentIssuance {
            input: &input,
            password: "hunter2",
            entry_label: "Shared iCloud",
        }
        .check()
        .and_then(CheckedEnrollmentIssuance::issue)?;
        let decrypted = CheckedEnrollmentEnvelope::parse(&code)?.decrypt("hunter2")?;
        assert_eq!(decrypted.provider, input.provider);
        assert!(!code.contains("web-auth-token"));
        assert!(storage_target_id.contains("shortGuid"));
        Ok(())
    }

    #[test]
    fn personal_oauth_file_provider_roundtrips_inside_encrypted_payload() -> anyhow::Result<()> {
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::personal(PersonalEnrollmentProvider::oauth_file(
                "google-drive".to_owned(),
                "ya29.secret".to_owned(),
                OAuthRefreshCredential::Token("refresh.secret".to_owned()),
                OAuthTokenExpiry::ExpiresAt("2026-07-09T00:00:00Z".to_owned()),
                OAuthRemoteFile::Identified {
                    file_id: "drive-file-id".to_owned(),
                    file_name: "nook-backup.yaml".to_owned(),
                },
                OAuthAccountIdentity::Email("owner@example.com".to_owned()),
            )),
            vault_name: "OAuth vault".to_owned(),
            entry_id: "entry-oauth".to_owned(),
            issued_at: "2026-07-09T00:00:00Z".to_owned(),
        };
        let code = EnrollmentIssuance {
            input: &input,
            password: "correct horse",
            entry_label: "OAuth entry",
        }
        .check()
        .and_then(CheckedEnrollmentIssuance::issue)?;
        assert!(!code.contains("ya29.secret"));
        assert!(!code.contains("refresh.secret"));

        let decrypted = CheckedEnrollmentEnvelope::parse(&code)?.decrypt("correct horse")?;
        assert_eq!(decrypted.provider, input.provider);
        Ok(())
    }

    #[test]
    fn malformed_oauth_file_provider_has_provider_specific_error() {
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::personal(PersonalEnrollmentProvider::oauth_file(
                "unsupported".to_owned(),
                String::new(),
                OAuthRefreshCredential::NotIssued,
                OAuthTokenExpiry::Unknown,
                OAuthRemoteFile::Unresolved,
                OAuthAccountIdentity::Unknown,
            )),
            vault_name: "OAuth vault".to_owned(),
            entry_id: "entry-oauth".to_owned(),
            issued_at: "2026-07-09T00:00:00Z".to_owned(),
        };
        assert!(matches!(
            EnrollmentIssuance {
                input: &input,
                password: "correct horse",
                entry_label: "OAuth entry"
            }
            .check()
            .and_then(CheckedEnrollmentIssuance::issue),
            Err(EnrollmentError::MalformedOauthFileProvider)
        ));
    }
    #[test]
    fn encrypts_provider_credentials_and_peeks_outer_fields() -> anyhow::Result<()> {
        let code = EnrollmentIssuance {
            input: &EnrollmentIssueInput::github_fixture(),
            password: "vault-pass-99",
            entry_label: "Work laptop",
        }
        .check()
        .and_then(CheckedEnrollmentIssuance::issue)?;
        assert_eq!(
            CheckedEnrollmentEnvelope::parse(&code)
                .map(|checked| checked.envelope().entry_id.clone())?,
            "entry-1"
        );
        assert_eq!(
            CheckedEnrollmentEnvelope::parse(&code)
                .map(|checked| checked.envelope().entry_label.clone())?,
            EnrollmentEntryLabel::Labeled("Work laptop".to_owned())
        );
        assert_eq!(
            CheckedEnrollmentEnvelope::parse(&code)
                .map(|checked| checked.envelope().issued_at.clone())?,
            "2026-06-23T12:00:00Z"
        );

        let checked = CheckedEnrollmentEnvelope::parse(&code)?;
        let envelope = checked.envelope();
        let serialized = serde_json::to_string(envelope)?;
        assert!(!serialized.contains("vault-pass-99"));
        assert!(!serialized.contains("github_pat_11AAAAbbbbCCCC"));
        assert!(!serialized.contains("Team vault"));
        assert!(!envelope.ct.is_empty());
        Ok(())
    }

    #[test]
    fn decrypts_roundtrip_payload() -> anyhow::Result<()> {
        let input = EnrollmentIssueInput::github_fixture();
        let code = EnrollmentIssuance {
            input: &input,
            password: "vault-pass-99",
            entry_label: "",
        }
        .check()
        .and_then(CheckedEnrollmentIssuance::issue)?;
        let checked = CheckedEnrollmentEnvelope::parse(&format!("  {code}  "))?;
        assert_eq!(checked.envelope().entry_id, input.entry_id);
        let decrypted = checked.decrypt("  vault-pass-99  ")?;
        assert_eq!(decrypted.provider, input.provider);
        assert_eq!(decrypted.vault_name, "Team vault");
        assert_eq!(decrypted.entry_id, input.entry_id);
        assert_eq!(decrypted.issued_at, input.issued_at);
        Ok(())
    }

    #[test]
    fn rejects_wrong_password() -> anyhow::Result<()> {
        let code = EnrollmentIssuance {
            input: &EnrollmentIssueInput::github_fixture(),
            password: "hunter2",
            entry_label: "",
        }
        .check()
        .and_then(CheckedEnrollmentIssuance::issue)?;
        let err = CheckedEnrollmentEnvelope::parse(&code)?
            .decrypt("wrong-pass")
            .err()
            .ok_or_else(|| anyhow::anyhow!("enrollment test should reject invalid input"))?;
        assert_eq!(
            err.to_string(),
            "Vault password does not decrypt this enrollment code."
        );
        Ok(())
    }

    #[test]
    fn rejects_malformed_codes() -> anyhow::Result<()> {
        let malformed = Engine::encode(
            &URL_SAFE_NO_PAD,
            serde_json::to_vec(&json!({"provider": {"type": "local"}}))?.as_slice(),
        );
        let err = CheckedEnrollmentEnvelope::parse(&malformed)
            .and_then(|checked| checked.decrypt("pw"))
            .err()
            .ok_or_else(|| anyhow::anyhow!("enrollment test should reject invalid input"))?;
        assert_eq!(err.to_string(), "Invalid enrollment code.");
        assert!(
            CheckedEnrollmentEnvelope::parse(&malformed)
                .map(|checked| checked.envelope().entry_id.clone())
                .is_err()
        );
        Ok(())
    }
}
