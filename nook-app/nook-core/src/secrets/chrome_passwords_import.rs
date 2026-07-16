//! Chromium-family password CSV conversion into Nook's typed plaintext model.

use csv::{ReaderBuilder, StringRecord, Trim};
use thiserror::Error;

use crate::{LoginSecret, SecretValue};

const MAX_CSV_BYTES: usize = 64 * 1024 * 1024;
const MAX_RECORDS: usize = 100_000;

#[derive(Debug, Error)]
pub enum ChromePasswordsImportError {
    #[error("The browser password CSV export is too large to import safely.")]
    CsvTooLarge,
    #[error("The browser password CSV contains too many rows to import safely.")]
    TooManyRecords,
    #[error("This is not a supported browser password CSV export. The {0} column is missing.")]
    MissingColumn(&'static str),
    #[error("The browser password CSV is invalid: {0}")]
    InvalidCsv(#[from] csv::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChromePasswordsImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: usize,
    pub skipped_unsupported: usize,
}

#[derive(Clone, Copy)]
struct ChromePasswordColumns {
    name: Option<usize>,
    url: usize,
    username: usize,
    password: usize,
    note: Option<usize>,
}

fn normalized_header(header: &str) -> String {
    header
        .trim_start_matches('\u{feff}')
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '_', '-'], "")
}

fn required_column(
    normalized: &[String],
    name: &'static str,
    aliases: &[&str],
) -> Result<usize, ChromePasswordsImportError> {
    std::iter::once(name)
        .chain(aliases.iter().copied())
        .find_map(|candidate| {
            let expected = normalized_header(candidate);
            normalized.iter().position(|header| header == &expected)
        })
        .ok_or(ChromePasswordsImportError::MissingColumn(name))
}

fn optional_column(normalized: &[String], names: &[&str]) -> Option<usize> {
    names.iter().find_map(|name| {
        let expected = normalized_header(name);
        normalized.iter().position(|header| header == &expected)
    })
}

fn columns(headers: &StringRecord) -> Result<ChromePasswordColumns, ChromePasswordsImportError> {
    let normalized = headers.iter().map(normalized_header).collect::<Vec<_>>();
    Ok(ChromePasswordColumns {
        name: optional_column(&normalized, &["name", "title"]),
        url: required_column(&normalized, "url", &["website url", "website"])?,
        username: required_column(&normalized, "username", &["user name", "login"])?,
        password: required_column(&normalized, "password", &["secret"])?,
        note: optional_column(&normalized, &["note", "notes"]),
    })
}

fn field(record: &StringRecord, index: usize) -> String {
    record.get(index).unwrap_or_default().trim().to_owned()
}

fn password_field(record: &StringRecord, index: usize) -> String {
    record.get(index).unwrap_or_default().to_owned()
}

fn optional_field(record: &StringRecord, index: Option<usize>) -> String {
    index.map_or_else(String::new, |index| field(record, index))
}

fn append_name_metadata(notes: &mut String, name: &str, website_url: &str) {
    if name.is_empty() || name == website_url {
        return;
    }
    if !notes.is_empty() {
        notes.push_str("\n\n");
    }
    notes.push_str("## Browser password manager\n- name: ");
    notes.push_str(name);
}

fn convert_record(record: &StringRecord, columns: ChromePasswordColumns) -> Option<SecretValue> {
    let name = optional_field(record, columns.name);
    let url = field(record, columns.url);
    let username = field(record, columns.username);
    let password = password_field(record, columns.password);
    let mut notes = optional_field(record, columns.note);

    if name.is_empty()
        && url.is_empty()
        && username.is_empty()
        && password.is_empty()
        && notes.is_empty()
    {
        return None;
    }

    let website_url = if url.is_empty() { name.clone() } else { url };
    append_name_metadata(&mut notes, &name, &website_url);

    Some(SecretValue::Login(LoginSecret {
        website_url,
        username,
        password,
        notes,
    }))
}

/// Parse a Chrome, Chromium, Brave, or Edge password CSV entirely in memory.
pub fn plan_chrome_passwords_import(
    csv_text: &str,
) -> Result<ChromePasswordsImportPlan, ChromePasswordsImportError> {
    if csv_text.len() > MAX_CSV_BYTES {
        return Err(ChromePasswordsImportError::CsvTooLarge);
    }

    let mut reader = ReaderBuilder::new()
        .flexible(true)
        .trim(Trim::Headers)
        .from_reader(csv_text.as_bytes());
    let columns = columns(reader.headers()?)?;
    let mut items = Vec::new();
    let mut source_count = 0;
    let mut skipped_unsupported = 0;

    for record in reader.records() {
        if source_count >= MAX_RECORDS {
            return Err(ChromePasswordsImportError::TooManyRecords);
        }
        let record = record?;
        source_count += 1;
        match convert_record(&record, columns) {
            Some(item) => items.push(item),
            None => skipped_unsupported += 1,
        }
    }

    Ok(ChromePasswordsImportPlan {
        items,
        source_count,
        skipped_unsupported,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_chromium_login_and_preserves_name_and_note() {
        let csv = concat!(
            "name,url,username,password,note\n",
            "\"Example, Inc\",https://example.com/login,alice@example.com,secret,",
            "\"Recovery, information\"\n"
        );

        let plan = plan_chrome_passwords_import(csv).unwrap();

        assert_eq!(plan.source_count, 1);
        assert_eq!(plan.skipped_unsupported, 0);
        assert_eq!(
            plan.items,
            vec![SecretValue::Login(LoginSecret {
                website_url: "https://example.com/login".to_owned(),
                username: "alice@example.com".to_owned(),
                password: "secret".to_owned(),
                notes: "Recovery, information\n\n## Browser password manager\n- name: Example, Inc"
                    .to_owned(),
            })]
        );
    }

    #[test]
    fn supports_bom_reordered_headers_and_common_aliases() {
        let csv =
            "\u{feff}Password,User_Name,Website URL,Title,Notes\nsecret,alice,,Example,Personal\n";

        let plan = plan_chrome_passwords_import(csv).unwrap();

        assert_eq!(
            plan.items,
            vec![SecretValue::Login(LoginSecret {
                website_url: "Example".to_owned(),
                username: "alice".to_owned(),
                password: "secret".to_owned(),
                notes: "Personal".to_owned(),
            })]
        );
    }

    #[test]
    fn accepts_minimal_google_documented_columns_and_skips_empty_rows() {
        let csv = concat!(
            "url,username,password\n",
            "https://example.com,alice,secret\n",
            ",,\n"
        );

        let plan = plan_chrome_passwords_import(csv).unwrap();

        assert_eq!(plan.source_count, 2);
        assert_eq!(plan.items.len(), 1);
        assert_eq!(plan.skipped_unsupported, 1);
    }

    #[test]
    fn preserves_leading_and_trailing_password_whitespace() {
        let csv = "url,username,password\nhttps://example.com,alice,\" secret \"\n";

        let plan = plan_chrome_passwords_import(csv).unwrap();
        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login");
        };

        assert_eq!(login.password, " secret ");
    }

    #[test]
    fn rejects_unrelated_csv_headers() {
        let error = plan_chrome_passwords_import("service,login,secret\nExample,alice,password\n")
            .unwrap_err();

        assert!(matches!(
            error,
            ChromePasswordsImportError::MissingColumn("url")
        ));
    }
}
