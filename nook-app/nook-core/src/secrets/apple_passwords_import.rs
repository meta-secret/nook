//! Apple Passwords CSV conversion into Nook's typed plaintext secret model.

use csv::StringRecord;
use thiserror::Error;

use super::import_support::{
    MAX_CSV_BYTES, collect_csv_records, csv_field, csv_password_field, csv_reader,
    normalized_csv_header, optional_csv_field,
};
use crate::{AuthenticatorSecret, LoginSecret, SecretValue};

#[derive(Debug, Error)]
pub enum ApplePasswordsImportError {
    #[error("The Apple Passwords CSV export is too large to import safely.")]
    CsvTooLarge,
    #[error("The Apple Passwords CSV contains too many rows to import safely.")]
    TooManyRecords,
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
    if title.is_empty() || title == website_url {
        return;
    }
    if !notes.is_empty() {
        notes.push_str("\n\n");
    }
    notes.push_str("## Apple Passwords\n- title: ");
    notes.push_str(title);
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
    fn imports_login_notes_title_and_authenticator() {
        let csv = concat!(
            "Title,URL,Username,Password,Notes,OTPAuth\n",
            "\"Example, Inc\",https://example.com/login,alice@example.com,secret,",
            "\"Recovery, information\",",
            "\"otpauth://totp/Example%3Aalice%40example.com?",
            "secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA256&digits=8&period=45\"\n"
        );

        let plan = plan_apple_passwords_import(csv).unwrap();

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
    }

    #[test]
    fn supports_bom_reordered_headers_and_optional_columns() {
        let csv = "\u{feff}Password,Username,URL,Title\nsecret,alice,,Example\n";

        let plan = plan_apple_passwords_import(csv).unwrap();

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
    }

    #[test]
    fn skips_empty_rows_and_invalid_otp_without_losing_the_login() {
        let csv = concat!(
            "Title,URL,Username,Password,Notes,OTPAuth\n",
            "Example,https://example.com,alice,secret,,not-an-otp-uri\n",
            ",,,,,\n"
        );

        let plan = plan_apple_passwords_import(csv).unwrap();

        assert_eq!(plan.source_count, 2);
        assert_eq!(plan.items.len(), 1);
        assert_eq!(plan.skipped_unsupported, 2);
    }

    #[test]
    fn imports_an_otp_only_row_without_creating_an_empty_login() {
        let csv = concat!(
            "Title,URL,Username,Password,Notes,OTPAuth\n",
            "Example,https://example.com,alice,,,",
            "\"otpauth://totp/Example%3Aalice?",
            "secret=JBSWY3DPEHPK3PXP&issuer=Example\"\n"
        );

        let plan = plan_apple_passwords_import(csv).unwrap();

        assert_eq!(plan.source_count, 1);
        assert_eq!(plan.items.len(), 1);
        assert!(matches!(plan.items[0], SecretValue::Authenticator(_)));
        assert_eq!(plan.skipped_unsupported, 1);
    }

    #[test]
    fn preserves_leading_and_trailing_password_whitespace() {
        let csv = "Title,URL,Username,Password\nExample,https://example.com,alice,\" secret \"\n";

        let plan = plan_apple_passwords_import(csv).unwrap();
        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login");
        };

        assert_eq!(login.password, " secret ");
    }

    #[test]
    fn rejects_non_apple_csv_headers() {
        let error =
            plan_apple_passwords_import("name,login,secret\nExample,alice,password\n").unwrap_err();

        assert!(matches!(
            error,
            ApplePasswordsImportError::MissingColumn("Title")
        ));
    }
}
