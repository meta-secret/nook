#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Apple Passwords and Safari export admission into typed plaintext secrets.
mod archive;
mod records;
use crate::SecretValue;
use archive::SafariArchive;
pub use records::ApplePasswordsCsvInput;
use std::{fmt, str};
use thiserror::Error;
const MAX_ARCHIVE_BYTES: usize = 128 * 1024 * 1024;
#[derive(Debug, Error)]
pub enum ApplePasswordsImportError {
    #[error("The Apple Passwords or Safari export is too large to import safely.")]
    ExportTooLarge,
    #[error("The Apple Passwords CSV export is too large to import safely.")]
    CsvTooLarge,
    #[error("The Apple Passwords CSV contains too many rows to import safely.")]
    TooManyRecords,
    #[error("This Safari browsing-data archive does not contain a passwords CSV export.")]
    MissingPasswordsFile,
    #[error("This is not a valid Safari browsing-data ZIP archive: {0}")]
    InvalidArchive(String),
    #[error("This is not an Apple Passwords CSV export. The {0} column is missing.")]
    MissingColumn(&'static str),
    #[error("The Apple Passwords CSV is invalid: {0}")]
    InvalidCsv(#[from] csv::Error),
    #[error("The bundled authenticator issuer catalog is invalid: {0}")]
    InvalidIssuerCatalog(#[from] crate::AuthenticatorIssuerHostsError),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplePasswordsImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: crate::SecretImportSourceRecordCount,
    pub skipped_unsupported: crate::SecretImportUnsupportedRecordCount,
}

/// Borrow original ZIP or CSV bytes until import planning completes.
/// ```
/// use nook_core::ApplePasswordsExportInput;
/// let plan = ApplePasswordsExportInput::from_bytes(b"Title,URL,Username,Password\n").plan()?;
/// assert!(plan.items.is_empty());
/// # Ok::<(), nook_core::ApplePasswordsImportError>(())
/// ```
/// ```compile_fail,E0502
/// use nook_core::ApplePasswordsExportInput;
/// let mut bytes = Vec::new();
/// let input = ApplePasswordsExportInput::from_bytes(&bytes);
/// bytes.clear();
/// let _ = input.plan();
/// ```
/// ```compile_fail,E0599
/// use nook_core::ApplePasswordsExportInput;
/// let input = ApplePasswordsExportInput::from_bytes(b"");
/// let duplicate = input.clone();
/// ```
/// ```compile_fail,E0382
/// use nook_core::ApplePasswordsExportInput;
/// let input = ApplePasswordsExportInput::from_bytes(b"");
/// let _ = input.plan();
/// let _ = input.plan();
/// ```
pub struct ApplePasswordsExportInput<'a> {
    bytes: &'a [u8],
}
impl<'a> ApplePasswordsExportInput<'a> {
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: accepts the original Apple Passwords ZIP archive bytes"
        )
    )]
    pub fn from_bytes(bytes: &'a [u8]) -> Self {
        Self { bytes }
    }
    pub fn plan(self) -> Result<ApplePasswordsImportPlan, ApplePasswordsImportError> {
        if self.bytes.len() > MAX_ARCHIVE_BYTES {
            return Err(ApplePasswordsImportError::ExportTooLarge);
        }
        if self.is_zip() {
            return SafariArchive::open(self.bytes)?.plan();
        }
        let text = str::from_utf8(self.bytes).map_err(|_| {
            ApplePasswordsImportError::InvalidArchive(
                "expected UTF-8 CSV or a Safari browsing-data ZIP archive".to_owned(),
            )
        })?;
        ApplePasswordsCsvInput::new(text).plan()
    }
    fn is_zip(&self) -> bool {
        self.bytes.starts_with(b"PK\x03\x04")
            || self.bytes.starts_with(b"PK\x05\x06")
            || self.bytes.starts_with(b"PK\x07\x08")
    }
}
impl ApplePasswordsImportError {
    fn archive(error: impl fmt::Display) -> Self {
        Self::InvalidArchive(error.to_string())
    }
}
#[cfg(test)]
pub(super) mod tests {
    use super::{
        ApplePasswordsCsvInput, ApplePasswordsExportInput, ApplePasswordsImportError,
        MAX_ARCHIVE_BYTES,
    };
    use crate::LoginSecret;
    use crate::{SecretValue, TotpDigits};
    use std::io::Cursor;

    #[test]
    fn imports_login_notes_title_and_authenticator() -> anyhow::Result<()> {
        let csv = concat!(
            "Title,URL,Username,Password,Notes,OTPAuth\n",
            "\"Example, Inc\",https://example.com/login,alice@example.com,secret,",
            "\"Recovery, information\",",
            "\"otpauth://totp/Example%3Aalice%40example.com?",
            "secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA256&digits=8&period=45\"\n"
        );

        let plan = ApplePasswordsCsvInput::new(csv).plan()?;

        assert_eq!(usize::from(plan.source_count), 1);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        assert_eq!(plan.items.len(), 2);
        assert_eq!(
            plan.items[0],
            SecretValue::Login(LoginSecret {
                website_url: "https://example.com/login".to_owned(),
                username: "alice@example.com".to_owned(),
                password: "secret".to_owned(),
                notes: "Recovery, information\n\n## Apple Passwords\n- title: Example, Inc"
                    .to_owned(),
            })
        );
        let SecretValue::Authenticator(authenticator) = &plan.items[1] else {
            panic!("expected authenticator");
        };
        assert_eq!(authenticator.issuer, "Example");
        assert_eq!(authenticator.account, "alice@example.com");
        assert_eq!(authenticator.algorithm.as_str(), "SHA256");
        assert_eq!(authenticator.digits, TotpDigits::Eight);
        assert_eq!(authenticator.period.duration().as_secs(), 45);
        Ok(())
    }

    #[test]
    fn supports_bom_reordered_headers_and_optional_columns() -> anyhow::Result<()> {
        let csv = "\u{feff}Password,Username,URL,Title\nsecret,alice,,Example\n";

        let plan = ApplePasswordsCsvInput::new(csv).plan()?;

        assert_eq!(usize::from(plan.source_count), 1);
        assert_eq!(
            plan.items,
            vec![SecretValue::Login(LoginSecret {
                website_url: "Example".to_owned(),
                username: "alice".to_owned(),
                password: "secret".to_owned(),
                notes: String::new(),
            })]
        );
        Ok(())
    }

    #[test]
    fn skips_empty_rows_and_invalid_otp_without_losing_the_login() -> anyhow::Result<()> {
        let csv = concat!(
            "Title,URL,Username,Password,Notes,OTPAuth\n",
            "Example,https://example.com,alice,secret,,not-an-otp-uri\n",
            ",,,,,\n"
        );

        let plan = ApplePasswordsCsvInput::new(csv).plan()?;

        assert_eq!(usize::from(plan.source_count), 2);
        assert_eq!(plan.items.len(), 1);
        assert_eq!(usize::from(plan.skipped_unsupported), 2);
        Ok(())
    }

    #[test]
    fn imports_an_otp_only_row_without_creating_an_empty_login() -> anyhow::Result<()> {
        let csv = concat!(
            "Title,URL,Username,Password,Notes,OTPAuth\n",
            "Example,https://example.com,alice,,,",
            "\"otpauth://totp/Example%3Aalice?",
            "secret=JBSWY3DPEHPK3PXP&issuer=Example\"\n"
        );

        let plan = ApplePasswordsCsvInput::new(csv).plan()?;

        assert_eq!(usize::from(plan.source_count), 1);
        assert_eq!(plan.items.len(), 1);
        assert!(matches!(plan.items[0], SecretValue::Authenticator(_)));
        assert_eq!(usize::from(plan.skipped_unsupported), 1);
        Ok(())
    }

    #[test]
    fn preserves_leading_and_trailing_password_whitespace() -> anyhow::Result<()> {
        let csv = "Title,URL,Username,Password\nExample,https://example.com,alice,\" secret \"\n";

        let plan = ApplePasswordsCsvInput::new(csv).plan()?;
        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login");
        };

        assert_eq!(login.password, " secret ");
        Ok(())
    }

    #[test]
    fn rejects_non_apple_csv_headers() -> anyhow::Result<()> {
        let error = ApplePasswordsCsvInput::new("name,login,secret\nExample,alice,password\n")
            .plan()
            .err()
            .ok_or_else(|| {
                anyhow::anyhow!("apple passwords import test should reject invalid input")
            })?;

        assert!(matches!(
            error,
            ApplePasswordsImportError::MissingColumn("Title")
        ));
        Ok(())
    }

    pub(super) struct SafariZipFixture<'a> {
        pub(super) entries: &'a [(&'a str, &'a [u8])],
    }
    impl SafariZipFixture<'_> {
        pub(super) fn build(self) -> anyhow::Result<Vec<u8>> {
            use std::io::Write;

            use zip::CompressionMethod;
            use zip::ZipWriter;
            use zip::write::SimpleFileOptions;

            let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
            let options =
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
            for (name, data) in self.entries {
                writer.start_file(*name, options)?;
                writer.write_all(data)?;
            }
            Ok(writer.finish()?.into_inner())
        }
    }
    #[test]
    fn imports_safari_browsing_data_zip_passwords_csv() -> anyhow::Result<()> {
        let csv = concat!(
            "Title,URL,Username,Password,Notes,OTPAuth\n",
            "Safari Example,https://safari.example,alice,secret,from safari,\n"
        );
        let zip = SafariZipFixture {
            entries: &[
                ("Bookmarks.html", b"<html></html>"),
                ("Passwords.csv", csv.as_bytes()),
                ("PaymentCards.json", br#"{"payment_cards":[]}"#),
            ],
        }
        .build()?;

        let plan = ApplePasswordsExportInput::from_bytes(&zip).plan()?;

        assert_eq!(usize::from(plan.source_count), 1);
        assert_eq!(
            plan.items,
            vec![SecretValue::Login(LoginSecret {
                website_url: "https://safari.example".to_owned(),
                username: "alice".to_owned(),
                password: "secret".to_owned(),
                notes: "from safari\n\n## Apple Passwords\n- title: Safari Example".to_owned(),
            })]
        );
        Ok(())
    }

    #[test]
    fn prefers_passwords_csv_when_archive_contains_other_csvs() -> anyhow::Result<()> {
        let other = "name,login,secret\nIgnored,bob,other\n";
        let passwords = "Title,URL,Username,Password\nExample,https://example.com,alice,secret\n";
        let zip = SafariZipFixture {
            entries: &[
                ("Notes.csv", other.as_bytes()),
                ("Passwords.csv", passwords.as_bytes()),
            ],
        }
        .build()?;

        let plan = ApplePasswordsExportInput::from_bytes(&zip).plan()?;
        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login");
        };
        assert_eq!(login.username, "alice");
        Ok(())
    }

    #[test]
    fn accepts_localized_csv_name_when_headers_match_apple_passwords() -> anyhow::Result<()> {
        let csv = "Title,URL,Username,Password\nExample,https://example.com,alice,secret\n";
        let zip = SafariZipFixture {
            entries: &[("Пароли.csv", csv.as_bytes())],
        }
        .build()?;

        let plan = ApplePasswordsExportInput::from_bytes(&zip).plan()?;
        assert_eq!(plan.items.len(), 1);
        Ok(())
    }

    #[test]
    fn accepts_raw_csv_bytes_through_export_entry_point() -> anyhow::Result<()> {
        let csv = "Title,URL,Username,Password\nExample,https://example.com,alice,secret\n";
        let plan = ApplePasswordsExportInput::from_bytes(csv.as_bytes()).plan()?;
        assert_eq!(usize::from(plan.source_count), 1);
        assert_eq!(plan.items.len(), 1);
        Ok(())
    }

    #[test]
    fn rejects_zip_without_passwords_csv_and_oversized_exports() -> anyhow::Result<()> {
        let missing = SafariZipFixture {
            entries: &[("Bookmarks.html", b"<html></html>")],
        }
        .build()?;
        assert!(matches!(
            ApplePasswordsExportInput::from_bytes(&missing).plan(),
            Err(ApplePasswordsImportError::MissingPasswordsFile)
        ));
        let oversized = vec![0_u8; MAX_ARCHIVE_BYTES + 1];
        assert!(matches!(
            ApplePasswordsExportInput::from_bytes(&oversized).plan(),
            Err(ApplePasswordsImportError::ExportTooLarge)
        ));
        Ok(())
    }
}
