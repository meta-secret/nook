//! Apple Passwords / Safari password export conversion into Nook's typed
//! plaintext secret model.
//!
//! Accepts either a plaintext Apple Passwords / Safari passwords CSV, or a
//! Safari browsing-data ZIP that contains a passwords CSV entry.

use std::io::{Cursor, Read};

use csv::StringRecord;
use thiserror::Error;
use zip::ZipArchive;

use super::import_support::{
    MAX_CSV_BYTES, collect_csv_records, csv_field, csv_password_field, csv_reader,
    normalized_csv_header, optional_csv_field,
};
use crate::{AuthenticatorSecret, LoginSecret, SecretValue};

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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplePasswordsImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: usize,
    pub skipped_unsupported: usize,
}

#[derive(Clone, Copy)]
struct ApplePasswordColumns {
    title: usize,
    url: usize,
    username: usize,
    password: usize,
    notes: Option<usize>,
    otp_auth: Option<usize>,
}

fn required_column(
    normalized: &[String],
    name: &'static str,
) -> Result<usize, ApplePasswordsImportError> {
    normalized
        .iter()
        .position(|header| header == &normalized_csv_header(name))
        .ok_or(ApplePasswordsImportError::MissingColumn(name))
}

fn optional_column(normalized: &[String], name: &str) -> Option<usize> {
    let expected = normalized_csv_header(name);
    normalized.iter().position(|header| header == &expected)
}

fn columns(headers: &StringRecord) -> Result<ApplePasswordColumns, ApplePasswordsImportError> {
    let normalized = headers
        .iter()
        .map(normalized_csv_header)
        .collect::<Vec<_>>();
    Ok(ApplePasswordColumns {
        title: required_column(&normalized, "Title")?,
        url: required_column(&normalized, "URL")?,
        username: required_column(&normalized, "Username")?,
        password: required_column(&normalized, "Password")?,
        notes: optional_column(&normalized, "Notes"),
        otp_auth: optional_column(&normalized, "OTPAuth"),
    })
}

fn append_title_metadata(notes: &mut String, title: &str, website_url: &str) {
    if let Some(entry) = super::import_support::source_label_metadata("title", title, website_url) {
        super::import_support::append_import_metadata(notes, "Apple Passwords", [entry]);
    }
}

fn convert_record(
    record: &StringRecord,
    columns: ApplePasswordColumns,
) -> (Vec<SecretValue>, usize) {
    let title = csv_field(record, columns.title);
    let url = csv_field(record, columns.url);
    let username = csv_field(record, columns.username);
    let password = csv_password_field(record, columns.password);
    let mut notes = optional_csv_field(record, columns.notes);
    let otp_auth = optional_csv_field(record, columns.otp_auth);

    if title.is_empty()
        && url.is_empty()
        && username.is_empty()
        && password.is_empty()
        && notes.is_empty()
        && otp_auth.is_empty()
    {
        return (Vec::new(), 1);
    }

    let website_url = if url.is_empty() { title.clone() } else { url };
    append_title_metadata(&mut notes, &title, &website_url);

    let mut items = Vec::new();
    let mut skipped_unsupported = 0;

    if password.is_empty() {
        skipped_unsupported += 1;
    } else {
        items.push(SecretValue::Login(LoginSecret {
            website_url: website_url.clone(),
            username,
            password,
            notes,
        }));
    }

    if !otp_auth.is_empty() {
        match AuthenticatorSecret::from_otpauth_uri(&otp_auth) {
            Ok(mut authenticator) => {
                if authenticator.website_url.trim().is_empty() && !website_url.trim().is_empty() {
                    authenticator.website_url = website_url;
                }
                authenticator.apply_inferred_website_url_if_empty();
                items.push(SecretValue::Authenticator(authenticator));
            }
            Err(_) => skipped_unsupported += 1,
        }
    }

    (items, skipped_unsupported)
}

fn is_zip_export(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"PK\x05\x06")
        || bytes.starts_with(b"PK\x07\x08")
}

fn invalid_archive(error: impl std::fmt::Display) -> ApplePasswordsImportError {
    ApplePasswordsImportError::InvalidArchive(error.to_string())
}

fn csv_entry_basename(name: &str) -> &str {
    name.rsplit(['/', '\\']).next().unwrap_or(name)
}

fn is_csv_entry(name: &str) -> bool {
    !name.ends_with(['/', '\\'])
        && csv_entry_basename(name)
            .rsplit_once('.')
            .is_some_and(|(_, extension)| extension.eq_ignore_ascii_case("csv"))
}

fn is_passwords_csv_entry(name: &str) -> bool {
    csv_entry_basename(name).eq_ignore_ascii_case("passwords.csv")
}

fn read_zip_entry_text(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    index: usize,
) -> Result<String, ApplePasswordsImportError> {
    let file = archive.by_index(index).map_err(invalid_archive)?;
    if file.size() > MAX_CSV_BYTES as u64 {
        return Err(ApplePasswordsImportError::CsvTooLarge);
    }
    let mut csv = String::new();
    file.take(MAX_CSV_BYTES as u64 + 1)
        .read_to_string(&mut csv)
        .map_err(invalid_archive)?;
    if csv.len() > MAX_CSV_BYTES {
        return Err(ApplePasswordsImportError::CsvTooLarge);
    }
    Ok(csv)
}

fn plan_safari_zip_import(
    export_bytes: &[u8],
) -> Result<ApplePasswordsImportPlan, ApplePasswordsImportError> {
    let mut archive = ZipArchive::new(Cursor::new(export_bytes)).map_err(invalid_archive)?;
    let mut csv_indexes = Vec::new();
    for index in 0..archive.len() {
        let name = archive
            .by_index(index)
            .map_err(invalid_archive)?
            .name()
            .to_owned();
        if is_csv_entry(&name) {
            csv_indexes.push((is_passwords_csv_entry(&name), name, index));
        }
    }
    csv_indexes.sort_by(|left, right| {
        right.0.cmp(&left.0).then_with(|| {
            left.1
                .to_ascii_lowercase()
                .cmp(&right.1.to_ascii_lowercase())
        })
    });

    let mut saw_csv = false;
    let mut last_missing_column = None;
    for (_, _, index) in csv_indexes {
        saw_csv = true;
        let csv = read_zip_entry_text(&mut archive, index)?;
        match plan_apple_passwords_import(&csv) {
            Ok(plan) => return Ok(plan),
            Err(ApplePasswordsImportError::MissingColumn(column)) => {
                last_missing_column = Some(column);
            }
            Err(error) => return Err(error),
        }
    }

    if let Some(column) = last_missing_column {
        return Err(ApplePasswordsImportError::MissingColumn(column));
    }
    if saw_csv {
        return Err(ApplePasswordsImportError::MissingPasswordsFile);
    }
    Err(ApplePasswordsImportError::MissingPasswordsFile)
}

/// Parse an Apple Passwords CSV or Safari browsing-data ZIP export in memory.
pub fn plan_apple_passwords_export(
    export_bytes: &[u8],
) -> Result<ApplePasswordsImportPlan, ApplePasswordsImportError> {
    if export_bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(ApplePasswordsImportError::ExportTooLarge);
    }
    if is_zip_export(export_bytes) {
        return plan_safari_zip_import(export_bytes);
    }
    let csv_text = std::str::from_utf8(export_bytes).map_err(|_| {
        ApplePasswordsImportError::InvalidArchive(
            "expected UTF-8 CSV or a Safari browsing-data ZIP archive".to_owned(),
        )
    })?;
    plan_apple_passwords_import(csv_text)
}

/// Parse an Apple Passwords CSV export entirely in memory.
pub fn plan_apple_passwords_import(
    csv_text: &str,
) -> Result<ApplePasswordsImportPlan, ApplePasswordsImportError> {
    if csv_text.len() > MAX_CSV_BYTES {
        return Err(ApplePasswordsImportError::CsvTooLarge);
    }

    let mut reader = csv_reader(csv_text);
    let columns = columns(reader.headers()?)?;
    let collection = collect_csv_records(
        &mut reader,
        ApplePasswordsImportError::TooManyRecords,
        |record| convert_record(record, columns),
    )?;

    Ok(ApplePasswordsImportPlan {
        items: collection.items,
        source_count: collection.source_count,
        skipped_unsupported: collection.skipped_unsupported,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SecretValue;

    #[test]
    fn imports_login_notes_title_and_authenticator() -> anyhow::Result<()> {
        let csv = concat!(
            "Title,URL,Username,Password,Notes,OTPAuth\n",
            "\"Example, Inc\",https://example.com/login,alice@example.com,secret,",
            "\"Recovery, information\",",
            "\"otpauth://totp/Example%3Aalice%40example.com?",
            "secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA256&digits=8&period=45\"\n"
        );

        let plan = plan_apple_passwords_import(csv)?;

        assert_eq!(plan.source_count, 1);
        assert_eq!(plan.skipped_unsupported, 0);
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
        assert_eq!(authenticator.digits.get(), 8);
        assert_eq!(authenticator.period.get(), 45);
        Ok(())
    }

    #[test]
    fn supports_bom_reordered_headers_and_optional_columns() -> anyhow::Result<()> {
        let csv = "\u{feff}Password,Username,URL,Title\nsecret,alice,,Example\n";

        let plan = plan_apple_passwords_import(csv)?;

        assert_eq!(plan.source_count, 1);
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

        let plan = plan_apple_passwords_import(csv)?;

        assert_eq!(plan.source_count, 2);
        assert_eq!(plan.items.len(), 1);
        assert_eq!(plan.skipped_unsupported, 2);
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

        let plan = plan_apple_passwords_import(csv)?;

        assert_eq!(plan.source_count, 1);
        assert_eq!(plan.items.len(), 1);
        assert!(matches!(plan.items[0], SecretValue::Authenticator(_)));
        assert_eq!(plan.skipped_unsupported, 1);
        Ok(())
    }

    #[test]
    fn preserves_leading_and_trailing_password_whitespace() -> anyhow::Result<()> {
        let csv = "Title,URL,Username,Password\nExample,https://example.com,alice,\" secret \"\n";

        let plan = plan_apple_passwords_import(csv)?;
        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login");
        };

        assert_eq!(login.password, " secret ");
        Ok(())
    }

    #[test]
    fn rejects_non_apple_csv_headers() -> anyhow::Result<()> {
        let error = plan_apple_passwords_import("name,login,secret\nExample,alice,password\n")
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

    fn build_zip(entries: &[(&str, &[u8])]) -> anyhow::Result<Vec<u8>> {
        use std::io::Write;

        use zip::CompressionMethod;
        use zip::ZipWriter;
        use zip::write::SimpleFileOptions;

        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, data) in entries {
            writer.start_file(*name, options)?;
            writer.write_all(data)?;
        }
        Ok(writer.finish()?.into_inner())
    }

    #[test]
    fn imports_safari_browsing_data_zip_passwords_csv() -> anyhow::Result<()> {
        let csv = concat!(
            "Title,URL,Username,Password,Notes,OTPAuth\n",
            "Safari Example,https://safari.example,alice,secret,from safari,\n"
        );
        let zip = build_zip(&[
            ("Bookmarks.html", b"<html></html>"),
            ("Passwords.csv", csv.as_bytes()),
            ("PaymentCards.json", br#"{"payment_cards":[]}"#),
        ])?;

        let plan = plan_apple_passwords_export(&zip)?;

        assert_eq!(plan.source_count, 1);
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
        let zip = build_zip(&[
            ("Notes.csv", other.as_bytes()),
            ("Passwords.csv", passwords.as_bytes()),
        ])?;

        let plan = plan_apple_passwords_export(&zip)?;
        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login");
        };
        assert_eq!(login.username, "alice");
        Ok(())
    }

    #[test]
    fn accepts_localized_csv_name_when_headers_match_apple_passwords() -> anyhow::Result<()> {
        let csv = "Title,URL,Username,Password\nExample,https://example.com,alice,secret\n";
        let zip = build_zip(&[("Пароли.csv", csv.as_bytes())])?;

        let plan = plan_apple_passwords_export(&zip)?;
        assert_eq!(plan.items.len(), 1);
        Ok(())
    }

    #[test]
    fn accepts_raw_csv_bytes_through_export_entry_point() -> anyhow::Result<()> {
        let csv = "Title,URL,Username,Password\nExample,https://example.com,alice,secret\n";
        let plan = plan_apple_passwords_export(csv.as_bytes())?;
        assert_eq!(plan.source_count, 1);
        assert_eq!(plan.items.len(), 1);
        Ok(())
    }

    #[test]
    fn rejects_zip_without_passwords_csv_and_oversized_exports() -> anyhow::Result<()> {
        let missing = build_zip(&[("Bookmarks.html", b"<html></html>")])?;
        assert!(matches!(
            plan_apple_passwords_export(&missing),
            Err(ApplePasswordsImportError::MissingPasswordsFile)
        ));
        let oversized = vec![0_u8; MAX_ARCHIVE_BYTES + 1];
        assert!(matches!(
            plan_apple_passwords_export(&oversized),
            Err(ApplePasswordsImportError::ExportTooLarge)
        ));
        Ok(())
    }
}
