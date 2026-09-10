#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Proton Pass ZIP/JSON admission into typed plaintext secrets.
mod archive;
mod items;
use crate::SecretValue;
use archive::ProtonPassArchive;
use items::ProtonPassExport;
use std::{fmt, str};
use thiserror::Error;
const MAX_ARCHIVE_BYTES: usize = 128 * 1024 * 1024;
#[derive(Debug, Error)]
pub enum ProtonPassImportError {
    #[error("The Proton Pass export is too large to import safely.")]
    ExportTooLarge,
    #[error(
        "This Proton Pass archive is encrypted. Export an unencrypted ZIP, or decrypt data.pgp and import the resulting JSON file."
    )]
    EncryptedExport,
    #[error("The Proton Pass export is missing Proton Pass/data.json.")]
    MissingDataFile,
    #[error("This is not a valid Proton Pass ZIP or JSON export: {0}")]
    InvalidExport(String),
    #[error("The Proton Pass export data is invalid: {0}")]
    InvalidData(#[source] serde_json::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtonPassImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: crate::SecretImportSourceRecordCount,
    pub skipped_unsupported: crate::SecretImportUnsupportedRecordCount,
}

/// Borrow original export bytes until consuming import planning completes.
/// ```
/// use nook_core::ProtonPassImportInput;
/// let plan = ProtonPassImportInput::from_bytes(br#"{"vaults":{}}"#).plan()?;
/// assert!(plan.items.is_empty());
/// # Ok::<(), nook_core::ProtonPassImportError>(())
/// ```
/// ```compile_fail,E0502
/// use nook_core::ProtonPassImportInput;
/// let mut bytes = Vec::new();
/// let input = ProtonPassImportInput::from_bytes(&bytes);
/// bytes.clear();
/// let _ = input.plan();
/// ```
/// ```compile_fail,E0599
/// use nook_core::ProtonPassImportInput;
/// let input = ProtonPassImportInput::from_bytes(b"{}");
/// let duplicate = input.clone();
/// ```
/// ```compile_fail,E0382
/// use nook_core::ProtonPassImportInput;
/// let input = ProtonPassImportInput::from_bytes(b"{}");
/// let _ = input.plan();
/// let _ = input.plan();
/// ```
pub struct ProtonPassImportInput<'a> {
    bytes: &'a [u8],
}
impl<'a> ProtonPassImportInput<'a> {
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: accepts the original Proton Pass ZIP archive bytes"
        )
    )]
    pub fn from_bytes(bytes: &'a [u8]) -> Self {
        Self { bytes }
    }
    pub fn plan(self) -> Result<ProtonPassImportPlan, ProtonPassImportError> {
        if self.bytes.len() > MAX_ARCHIVE_BYTES {
            return Err(ProtonPassImportError::ExportTooLarge);
        }
        if self.bytes.starts_with(b"-----BEGIN PGP MESSAGE-----") {
            return Err(ProtonPassImportError::EncryptedExport);
        }
        if self.is_zip() {
            let archive = ProtonPassArchive::open(self.bytes)?;
            let json = archive.select_data()?.read()?;
            return ProtonPassExport::parse(&json).map(ProtonPassExport::plan);
        }
        let json = str::from_utf8(self.bytes).map_err(ProtonPassImportError::invalid)?;
        ProtonPassExport::parse(json).map(ProtonPassExport::plan)
    }
    fn is_zip(&self) -> bool {
        self.bytes.starts_with(b"PK\x03\x04")
            || self.bytes.starts_with(b"PK\x05\x06")
            || self.bytes.starts_with(b"PK\x07\x08")
    }
}
impl ProtonPassImportError {
    fn invalid(error: impl fmt::Display) -> Self {
        Self::InvalidExport(error.to_string())
    }
}
#[cfg(test)]
pub(super) mod tests {
    use std::io::Write;

    use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

    use super::archive::DATA_FILE;
    use super::{MAX_ARCHIVE_BYTES, ProtonPassImportError, ProtonPassImportInput};
    use crate::{LoginSecret, SecretValue, SecureNoteSecret};
    use std::io::Cursor;

    pub(super) struct ProtonPassZipFixture<'a> {
        pub(super) name: &'a str,
        pub(super) data: &'a [u8],
    }
    impl ProtonPassZipFixture<'_> {
        pub(super) fn build(self) -> anyhow::Result<Vec<u8>> {
            let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
            let options =
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
            writer.start_file(self.name, options)?;
            writer.write_all(self.data)?;
            Ok(writer.finish()?.into_inner())
        }

        pub(super) fn export_json() -> &'static str {
            r#"{
          "userId":"user",
          "version":"1.32.0",
          "vaults":{
            "vault-b":{
              "name":"Work",
              "items":[
                {
                  "data":{
                    "metadata":{"name":"GitHub","note":"Recovery codes elsewhere"},
                    "extraFields":[
                      {"fieldName":"PIN","type":"hidden","data":{"content":"1234"}},
                      {"fieldName":"Backup OTP","type":"totp","data":{"totpUri":"otpauth://backup"}}
                    ],
                    "type":"login",
                    "content":{
                      "itemEmail":"alice@example.com",
                      "itemUsername":"alice",
                      "password":"secret",
                      "urls":["https://github.com/login","https://gist.github.com"],
                      "totpUri":"otpauth://primary",
                      "passkeys":[{"credentialId":"redacted"}]
                    }
                  },
                  "state":1,
                  "pinned":true,
                  "files":[{"fileId":"attachment"}]
                },
                {
                  "data":{
                    "metadata":{"name":"Private note","note":"Keep offline"},
                    "extraFields":[],
                    "type":"note",
                    "content":{}
                  },
                  "state":2
                },
                {
                  "data":{
                    "metadata":{"name":"Card","note":"travel"},
                    "extraFields":[],
                    "type":"creditCard",
                    "content":{
                      "cardholderName":"Ada Lovelace",
                      "number":"4111111111111111",
                      "expirationDate":"2030-12",
                      "verificationNumber":"123"
                    }
                  },
                  "state":1
                }
              ]
            }
          }
        }"#
        }
    }
    #[test]
    fn converts_zip_logins_and_notes_and_counts_unsupported_items() -> anyhow::Result<()> {
        let plan = ProtonPassImportInput::from_bytes(
            &ProtonPassZipFixture {
                name: DATA_FILE,
                data: ProtonPassZipFixture::export_json().as_bytes(),
            }
            .build()?,
        )
        .plan()?;
        assert_eq!(usize::from(plan.source_count), 3);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        assert_eq!(plan.items.len(), 3);
        assert_eq!(
            plan.items[0],
            SecretValue::Login(LoginSecret {
                website_url: "https://github.com/login".to_owned(),
                username: "alice".to_owned(),
                password: "secret".to_owned(),
                notes: concat!(
                    "Recovery codes elsewhere\n\n## Proton Pass",
                    "\n- name: GitHub",
                    "\n- vault: Work",
                    "\n- pinned: true",
                    "\n- email: alice@example.com",
                    "\n- totp: otpauth://primary",
                    "\n- url[2]: https://gist.github.com",
                    "\n- field.PIN: 1234",
                    "\n- field.Backup OTP: otpauth://backup",
                    "\n- passkeys_skipped: 1",
                    "\n- attachments_skipped: 1"
                )
                .to_owned(),
            })
        );
        assert_eq!(
            plan.items[1],
            SecretValue::SecureNote(SecureNoteSecret {
                title: "Private note".to_owned(),
                note: "Keep offline\n\n## Proton Pass\n- vault: Work\n- state: trashed".to_owned(),
            })
        );
        Ok(())
    }

    #[test]
    fn accepts_decrypted_json_and_uses_email_as_username_fallback() -> anyhow::Result<()> {
        let json = ProtonPassZipFixture::export_json()
            .replace(r#""itemUsername":"alice""#, r#""itemUsername":"""#);
        let plan = ProtonPassImportInput::from_bytes(json.as_bytes()).plan()?;
        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login")
        };
        assert_eq!(login.username, "alice@example.com");
        assert!(!login.notes.contains("- email:"));
        Ok(())
    }

    #[test]
    fn preserves_legacy_content_username() -> anyhow::Result<()> {
        let json = ProtonPassZipFixture::export_json().replace(
            r#""itemUsername":"alice""#,
            r#""itemUsername":"","username":"legacy-alice""#,
        );
        let plan = ProtonPassImportInput::from_bytes(json.as_bytes()).plan()?;
        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login")
        };
        assert_eq!(login.username, "legacy-alice");
        assert!(login.notes.contains("- email: alice@example.com"));
        Ok(())
    }

    #[test]
    fn rejects_encrypted_missing_invalid_and_oversized_exports() -> anyhow::Result<()> {
        let encrypted = ProtonPassZipFixture {
            name: "Proton Pass/data.pgp",
            data: b"encrypted",
        }
        .build()?;
        assert!(matches!(
            ProtonPassImportInput::from_bytes(&encrypted).plan(),
            Err(ProtonPassImportError::EncryptedExport)
        ));
        let missing = ProtonPassZipFixture {
            name: "other.json",
            data: b"{}",
        }
        .build()?;
        assert!(matches!(
            ProtonPassImportInput::from_bytes(&missing).plan(),
            Err(ProtonPassImportError::MissingDataFile)
        ));
        assert!(matches!(
            ProtonPassImportInput::from_bytes(b"not json").plan(),
            Err(ProtonPassImportError::InvalidData(_))
        ));
        let oversized = vec![0_u8; MAX_ARCHIVE_BYTES + 1];
        assert!(matches!(
            ProtonPassImportInput::from_bytes(&oversized).plan(),
            Err(ProtonPassImportError::ExportTooLarge)
        ));
        Ok(())
    }
}
