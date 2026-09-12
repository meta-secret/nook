#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! 1Password 1PUX export admission into typed plaintext secrets.
mod archive;
mod items;
use crate::SecretValue;
use archive::OnePasswordArchive;
use std::fmt;
use thiserror::Error;
/// Unsupported 1PUX format version reported at the import boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UnsupportedOnePasswordExportVersion(u32);

impl From<u32> for UnsupportedOnePasswordExportVersion {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

impl From<UnsupportedOnePasswordExportVersion> for u32 {
    fn from(value: UnsupportedOnePasswordExportVersion) -> Self {
        value.0
    }
}

impl fmt::Display for UnsupportedOnePasswordExportVersion {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Debug, Error)]
pub enum OnePasswordImportError {
    #[error("This is not a valid 1Password 1PUX archive: {0}")]
    InvalidArchive(String),
    #[error("The 1Password export is missing {0}.")]
    MissingEntry(&'static str),
    #[error("The 1Password export is too large to import safely.")]
    ArchiveTooLarge,
    #[error("The 1Password export data is too large to import safely.")]
    ExportDataTooLarge,
    #[error("This 1Password export uses unsupported 1PUX version {0}.")]
    UnsupportedVersion(UnsupportedOnePasswordExportVersion),
    #[error("The 1Password export metadata is invalid: {0}")]
    InvalidAttributes(#[source] serde_json::Error),
    #[error("The 1Password export data is invalid: {0}")]
    InvalidData(#[source] serde_json::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OnePasswordImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: crate::SecretImportSourceRecordCount,
    pub skipped_unsupported: crate::SecretImportUnsupportedRecordCount,
}

/// Borrow the original archive until the consuming plan has finished.
/// ```
/// use nook_core::{OnePasswordExport, OnePasswordImportError};
/// let result = OnePasswordExport::from_bytes(b"invalid archive").plan();
/// assert!(matches!(result, Err(OnePasswordImportError::InvalidArchive(_))));
/// ```
/// ```compile_fail,E0599
/// use nook_core::OnePasswordExport;
/// let export = OnePasswordExport::from_bytes(b"invalid archive");
/// let duplicate = export.clone();
/// ```
/// ```compile_fail,E0502
/// use nook_core::OnePasswordExport;
/// let mut bytes = Vec::new();
/// let export = OnePasswordExport::from_bytes(&bytes);
/// bytes.clear();
/// let _ = export.plan();
/// ```
/// ```compile_fail,E0382
/// use nook_core::OnePasswordExport;
/// let export = OnePasswordExport::from_bytes(b"invalid archive");
/// let _ = export.plan();
/// let _ = export.plan();
/// ```
pub struct OnePasswordExport<'a> {
    bytes: &'a [u8],
}
impl<'a> OnePasswordExport<'a> {
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: accepts the original 1PUX ZIP archive bytes"
        )
    )]
    pub fn from_bytes(bytes: &'a [u8]) -> Self {
        Self { bytes }
    }
    pub fn plan(self) -> Result<OnePasswordImportPlan, OnePasswordImportError> {
        OnePasswordArchive::open(self.bytes)?.check()?.plan()
    }
}
impl OnePasswordImportError {
    fn archive(error: impl fmt::Display) -> Self {
        Self::InvalidArchive(error.to_string())
    }
}
#[cfg(test)]
pub(super) mod tests {
    use std::io::Write;

    use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

    use super::archive::MAX_ARCHIVE_BYTES;
    use super::{OnePasswordExport, OnePasswordImportError};
    use crate::{SecretValue, SecureNoteSecret};
    use std::io::Cursor;

    pub(super) struct OnePasswordArchiveFixture<'a> {
        pub(super) attributes: &'a str,
        pub(super) data: &'a str,
    }
    impl OnePasswordArchiveFixture<'_> {
        pub(super) fn build(self) -> anyhow::Result<Vec<u8>> {
            let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
            let options =
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
            writer.start_file("export.attributes", options)?;
            writer.write_all(self.attributes.as_bytes())?;
            writer.start_file("export.data", options)?;
            writer.write_all(self.data.as_bytes())?;
            Ok(writer.finish()?.into_inner())
        }

        pub(super) fn current_attributes() -> &'static str {
            r#"{"version":3,"description":"1Password Unencrypted Export","createdAt":1585333569}"#
        }
    }
    #[test]
    fn converts_login_password_and_secure_note_items() -> anyhow::Result<()> {
        let data = r#"{
          "accounts":[{
            "vaults":[{
              "attrs":{"name":"Personal"},
              "items":[
                {
                  "categoryUuid":"001",
                  "state":"active",
                  "overview":{
                    "title":"GitHub",
                    "url":"https://github.com/login",
                    "urls":[
                      {"label":"","url":"https://github.com/login"},
                      {"label":"gist","url":"https://gist.github.com"}
                    ],
                    "tags":["work","code"]
                  },
                  "details":{
                    "loginFields":[
                      {"value":"alice","name":"username","fieldType":"T","designation":"username"},
                      {"value":"secret","name":"password","fieldType":"P","designation":"password"}
                    ],
                    "notesPlain":"Recovery codes elsewhere",
                    "sections":[{
                      "title":"Security",
                      "name":"security",
                      "fields":[
                        {"title":"PIN","id":"pin","value":{"concealed":"1234"}},
                        {"title":"TOTP","id":"otp","value":{"oneTimePassword":"otpauth://secret"}}
                      ]
                    }]
                  }
                },
                {
                  "categoryUuid":"005",
                  "overview":{"title":"Router"},
                  "details":{"password":"router-secret"}
                },
                {
                  "categoryUuid":"003",
                  "state":"archived",
                  "overview":{"title":"Private note"},
                  "details":{"notesPlain":"hello"}
                }
              ]
            }]
          }]
        }"#;
        let plan = OnePasswordExport::from_bytes(
            &OnePasswordArchiveFixture {
                attributes: OnePasswordArchiveFixture::current_attributes(),
                data,
            }
            .build()?,
        )
        .plan()?;
        assert_eq!(usize::from(plan.source_count), 3);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        assert_eq!(plan.items.len(), 3);

        let Some(SecretValue::Login(login)) = plan.items.first() else {
            panic!("expected login")
        };
        assert_eq!(login.website_url, "https://github.com/login");
        assert_eq!(login.username, "alice");
        assert_eq!(login.password, "secret");
        assert_eq!(
            login.notes,
            "Recovery codes elsewhere\n\n## 1Password\n- format: 1PUX\n- title: GitHub\n- vault: Personal\n- tags: work, code\n- url.gist: https://gist.github.com\n- Security.PIN: 1234\n- Security.TOTP: otpauth://secret"
        );

        let Some(SecretValue::Login(password)) = plan.items.get(1) else {
            panic!("expected password item as login")
        };
        assert_eq!(password.website_url, "Router");
        assert_eq!(password.password, "router-secret");

        assert_eq!(
            *plan
                .items
                .get(2)
                .unwrap_or_else(|| panic!("import fixture must contain a note")),
            SecretValue::SecureNote(SecureNoteSecret {
                title: "Private note".to_owned(),
                note: "hello\n\n## 1Password\n- format: 1PUX\n- vault: Personal\n- state: archived"
                    .to_owned(),
            })
        );
        Ok(())
    }

    #[test]
    fn accepts_wrapped_items_and_skips_unsupported_categories() -> anyhow::Result<()> {
        let data = r#"{
          "accounts": [{
            "vaults": [{
              "items": [
                {"item":{"categoryUuid":"003","overview":{"title":"Wrapped"},"details":{"notesPlain":"ok"}}},
                {"categoryUuid":"002","overview":{"title":"Credit card"},"details":{"sections":[{"fields":[
                  {"id":"cardholder","value":"Ada"},
                  {"id":"ccnum","value":{"creditCardNumber":"4111111111111111"}},
                  {"id":"expiry","value":{"monthYear":203012}},
                  {"id":"cvv","value":{"concealed":"123"}}
                ]}]}},
                {"categoryUuid":"006","overview":{"title":"Document"}},
                {"categoryUuid":"109","overview":{"title":"SSH key"}}
              ]
            }]
          }]
        }"#;
        let plan = OnePasswordExport::from_bytes(
            &OnePasswordArchiveFixture {
                attributes: OnePasswordArchiveFixture::current_attributes(),
                data,
            }
            .build()?,
        )
        .plan()?;
        assert_eq!(usize::from(plan.source_count), 4);
        assert_eq!(usize::from(plan.skipped_unsupported), 2);
        assert_eq!(plan.items.len(), 2);
        let Some(SecretValue::CreditCard(card)) = plan.items.get(1) else {
            panic!("expected credit card");
        };
        assert_eq!(card.number, "4111111111111111");
        assert_eq!(card.expiration_month, "12");
        assert_eq!(card.expiration_year, "2030");
        Ok(())
    }

    #[test]
    fn rejects_non_archives_missing_entries_and_unknown_versions() -> anyhow::Result<()> {
        assert!(matches!(
            OnePasswordExport::from_bytes(b"not a zip").plan(),
            Err(OnePasswordImportError::InvalidArchive(_))
        ));

        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("export.attributes", SimpleFileOptions::default())?;
        writer.write_all(OnePasswordArchiveFixture::current_attributes().as_bytes())?;
        let missing_data = writer.finish()?.into_inner();
        assert!(matches!(
            OnePasswordExport::from_bytes(&missing_data).plan(),
            Err(OnePasswordImportError::MissingEntry("export.data"))
        ));

        let future = OnePasswordArchiveFixture {
            attributes: r#"{"version":4,"description":"1Password Unencrypted Export"}"#,
            data: r#"{"accounts":[]}"#,
        }
        .build()?;
        assert!(matches!(
            OnePasswordExport::from_bytes(&future).plan(),
            Err(OnePasswordImportError::UnsupportedVersion(version))
                if u32::from(version) == 4
        ));
        Ok(())
    }

    #[test]
    fn rejects_oversized_archives_before_parsing() {
        let archive = vec![0_u8; MAX_ARCHIVE_BYTES + 1];
        assert!(matches!(
            OnePasswordExport::from_bytes(&archive).plan(),
            Err(OnePasswordImportError::ArchiveTooLarge)
        ));
    }
}
