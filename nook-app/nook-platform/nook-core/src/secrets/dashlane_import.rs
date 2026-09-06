#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Dashlane CSV / CSV-ZIP conversion into Nook's typed plaintext secret model.
mod archive;
mod rows;
use crate::SecretValue;
use archive::DashlaneArchive;
use rows::{DashlaneCsvInput, DashlaneCsvSelection};
use std::{fmt, str};
use thiserror::Error;
const MAX_ARCHIVE_BYTES: usize = 128 * 1024 * 1024;
#[derive(Debug, Error)]
pub enum DashlaneImportError {
    #[error("The Dashlane export is too large to import safely.")]
    ExportTooLarge,
    #[error("The Dashlane CSV export is too large to import safely.")]
    CsvTooLarge,
    #[error("The Dashlane CSV contains too many rows to import safely.")]
    TooManyRecords,
    #[error("This Dashlane archive does not contain a supported CSV export.")]
    MissingSupportedCsv,
    #[error("This is not a valid Dashlane ZIP archive: {0}")]
    InvalidArchive(String),
    #[error("This is not a Dashlane CSV export. The {0} column is missing.")]
    MissingColumn(&'static str),
    #[error("The Dashlane CSV is invalid: {0}")]
    InvalidCsv(#[from] csv::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DashlaneImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: crate::SecretImportSourceRecordCount,
    pub skipped_unsupported: crate::SecretImportUnsupportedRecordCount,
}

/// Borrow the original plaintext export until planning has completed.
///
/// ```
/// use nook_core::DashlaneExport;
/// let bytes = b"username,password\nalice,secret\n";
/// let plan = DashlaneExport::from_bytes(bytes).plan()?;
/// assert_eq!(usize::from(plan.source_count), 1);
/// # Ok::<(), nook_core::DashlaneImportError>(())
/// ```
/// The export must remain available until its consuming operation finishes.
/// ```compile_fail,E0502
/// use nook_core::DashlaneExport;
/// let mut bytes = b"username,password\nalice,secret\n".to_vec();
/// let export = DashlaneExport::from_bytes(&bytes);
/// bytes.clear();
/// let _ = export.plan();
/// ```
/// ```compile_fail,E0382
/// use nook_core::DashlaneExport;
/// let export = DashlaneExport::from_bytes(b"username,password\nalice,secret\n");
/// let _ = export.plan();
/// let _ = export.plan();
/// ```
pub struct DashlaneExport<'a> {
    bytes: &'a [u8],
}
impl<'a> DashlaneExport<'a> {
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: accepts the original Dashlane ZIP archive bytes"
        )
    )]
    pub fn from_bytes(bytes: &'a [u8]) -> Self {
        Self { bytes }
    }
    pub fn plan(self) -> Result<DashlaneImportPlan, DashlaneImportError> {
        if self.bytes.len() > MAX_ARCHIVE_BYTES {
            return Err(DashlaneImportError::ExportTooLarge);
        }
        if self.is_zip() {
            return DashlaneArchive::open(self.bytes)?.plan();
        }
        let text = str::from_utf8(self.bytes).map_err(|_| {
            DashlaneImportError::InvalidArchive(
                "expected UTF-8 CSV or a Dashlane CSV ZIP archive".to_owned(),
            )
        })?;
        DashlaneCsvInput {
            text,
            selection: DashlaneCsvSelection::Detect,
        }
        .check()?
        .collect()
    }
    fn is_zip(&self) -> bool {
        self.bytes.starts_with(b"PK\x03\x04")
            || self.bytes.starts_with(b"PK\x05\x06")
            || self.bytes.starts_with(b"PK\x07\x08")
    }
}
impl DashlaneImportError {
    fn archive(error: impl fmt::Display) -> Self {
        Self::InvalidArchive(error.to_string())
    }
}
#[cfg(test)]
mod tests {
    use super::archive::tests::{DashlaneZipFixture, ZipFixtureEntry};
    use super::{DashlaneExport, DashlaneImportError, MAX_ARCHIVE_BYTES};
    use crate::SecretValue;

    #[test]
    fn imports_credentials_notes_category_and_otp_secret() -> anyhow::Result<()> {
        let csv = concat!(
            "username,username2,username3,title,password,note,url,category,otpSecret\n",
            "alice,,,Example,secret,\"Recovery info\",https://example.com,Work,JBSWY3DPEHPK3PXP\n"
        );

        let plan = DashlaneExport::from_bytes(csv.as_bytes()).plan()?;
        assert_eq!(usize::from(plan.source_count), 1);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        assert_eq!(plan.items.len(), 2);
        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login");
        };
        assert_eq!(login.username, "alice");
        assert_eq!(login.password, "secret");
        assert!(login.notes.contains("## Dashlane"));
        assert!(login.notes.contains("category: Work"));
        assert!(matches!(plan.items[1], SecretValue::Authenticator(_)));
        Ok(())
    }

    #[test]
    fn imports_secure_notes_and_credit_cards_from_zip() -> anyhow::Result<()> {
        let credentials = concat!(
            "username,title,password,note,url,category,otpUrl\n",
            "bob,GitHub,pass,,https://github.com,,\n"
        );
        let notes = "title,note\nPrivate,\"Keep offline\"\n";
        let payments = concat!(
            "type,account_name,account_holder,cc_number,code,expiration_month,expiration_year\n",
            "credit_card,Travel,Ada Lovelace,4111111111111111,123,12,2030\n",
            "bank,Checking,Ada,999,,,\n"
        );
        let zip = DashlaneZipFixture {
            entries: &[
                ZipFixtureEntry {
                    name: "credentials.csv",
                    bytes: credentials.as_bytes(),
                },
                ZipFixtureEntry {
                    name: "securenotes.csv",
                    bytes: notes.as_bytes(),
                },
                ZipFixtureEntry {
                    name: "payments.csv",
                    bytes: payments.as_bytes(),
                },
            ],
        }
        .build()?;

        let plan = DashlaneExport::from_bytes(&zip).plan()?;
        assert_eq!(usize::from(plan.source_count), 4);
        assert_eq!(usize::from(plan.skipped_unsupported), 1);
        assert!(
            plan.items
                .iter()
                .any(|item| matches!(item, SecretValue::Login(_)))
        );
        assert!(
            plan.items
                .iter()
                .any(|item| matches!(item, SecretValue::SecureNote(_)))
        );
        assert!(
            plan.items
                .iter()
                .any(|item| matches!(item, SecretValue::CreditCard(_)))
        );
        Ok(())
    }

    #[test]
    fn rejects_unsupported_csv_and_oversized_exports() -> anyhow::Result<()> {
        assert!(matches!(
            DashlaneExport::from_bytes(b"name,login,secret\nExample,alice,password\n").plan(),
            Err(DashlaneImportError::MissingColumn("username"))
        ));
        let missing = DashlaneZipFixture {
            entries: &[ZipFixtureEntry {
                name: "ids.csv",
                bytes: b"type,number,name\npassport,1,Ada\n",
            }],
        }
        .build()?;
        assert!(matches!(
            DashlaneExport::from_bytes(&missing).plan(),
            Err(DashlaneImportError::MissingSupportedCsv)
        ));
        let oversized = vec![0_u8; MAX_ARCHIVE_BYTES + 1];
        assert!(matches!(
            DashlaneExport::from_bytes(&oversized).plan(),
            Err(DashlaneImportError::ExportTooLarge)
        ));
        Ok(())
    }

    #[test]
    fn invalid_utf8_and_zip_signatures_keep_distinct_error_paths() {
        match DashlaneExport::from_bytes(&[0xff]).plan() {
            Err(DashlaneImportError::InvalidArchive(message)) => {
                assert_eq!(message, "expected UTF-8 CSV or a Dashlane CSV ZIP archive");
            }
            _ => panic!("invalid UTF-8 must use the export decoding error"),
        }
        for magic in [b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"] {
            assert!(matches!(
                DashlaneExport::from_bytes(magic).plan(),
                Err(DashlaneImportError::InvalidArchive(_))
            ));
        }
    }
}
