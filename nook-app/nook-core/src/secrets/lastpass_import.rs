//! `LastPass` CSV conversion into Nook's typed plaintext secret model.

use std::collections::HashMap;

use csv::{ReaderBuilder, StringRecord, Trim};
use thiserror::Error;

use crate::{LoginSecret, SecretValue, SecureNoteSecret};

const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;
const REQUIRED_COLUMNS: [&str; 7] = [
    "url", "username", "password", "extra", "name", "grouping", "fav",
];
const OPTIONAL_COLUMNS: [&str; 1] = ["totp"];

#[derive(Debug, Error)]
pub enum LastPassImportError {
    #[error("The LastPass CSV export is too large to import safely.")]
    ExportTooLarge,
    #[error("This is not a LastPass CSV export: {0}")]
    InvalidHeader(String),
    #[error("The LastPass CSV export is invalid: {0}")]
    InvalidCsv(#[from] csv::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LastPassImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: usize,
    pub skipped_unsupported: usize,
}

fn header_indexes(
    headers: &StringRecord,
) -> Result<HashMap<&'static str, usize>, LastPassImportError> {
    let mut indexes = HashMap::with_capacity(REQUIRED_COLUMNS.len() + OPTIONAL_COLUMNS.len());
    for (index, header) in headers.iter().enumerate() {
        let normalized = header
            .trim_start_matches('\u{feff}')
            .trim()
            .to_ascii_lowercase();
        if let Some(column) = REQUIRED_COLUMNS
            .iter()
            .chain(OPTIONAL_COLUMNS.iter())
            .find(|column| normalized == **column)
            && indexes.insert(*column, index).is_some()
        {
            return Err(LastPassImportError::InvalidHeader(format!(
                "column `{column}` appears more than once"
            )));
        }
    }
    let missing = REQUIRED_COLUMNS
        .iter()
        .filter(|column| !indexes.contains_key(**column))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(LastPassImportError::InvalidHeader(format!(
            "missing required columns: {}",
            missing.join(", ")
        )));
    }
    Ok(indexes)
}

fn field<'a>(
    record: &'a StringRecord,
    indexes: &HashMap<&'static str, usize>,
    name: &'static str,
) -> &'a str {
    indexes
        .get(name)
        .and_then(|index| record.get(*index))
        .unwrap_or_default()
}

fn append_lastpass_metadata(notes: &mut String, grouping: &str, favorite: &str, totp: &str) {
    let mut metadata = Vec::new();
    if !grouping.trim().is_empty() {
        metadata.push(("group", grouping.trim()));
    }
    if matches!(
        favorite.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes"
    ) {
        metadata.push(("favorite", "true"));
    }
    if !totp.trim().is_empty() {
        metadata.push(("totp", totp.trim()));
    }
    if metadata.is_empty() {
        return;
    }
    if !notes.is_empty() {
        notes.push_str("\n\n");
    }
    notes.push_str("## LastPass");
    for (key, value) in metadata {
        notes.push_str("\n- ");
        notes.push_str(key);
        notes.push_str(": ");
        notes.push_str(value);
    }
}

fn is_secure_note_url(url: &str) -> bool {
    url.trim()
        .trim_end_matches('/')
        .eq_ignore_ascii_case("http://sn")
}

fn convert_record(
    record: &StringRecord,
    indexes: &HashMap<&'static str, usize>,
) -> Option<SecretValue> {
    if record.iter().all(|value| value.trim().is_empty()) {
        return None;
    }
    let url = field(record, indexes, "url").trim();
    let name = field(record, indexes, "name").trim();
    let mut notes = field(record, indexes, "extra").to_owned();
    append_lastpass_metadata(
        &mut notes,
        field(record, indexes, "grouping"),
        field(record, indexes, "fav"),
        field(record, indexes, "totp"),
    );

    if is_secure_note_url(url) {
        return Some(SecretValue::SecureNote(SecureNoteSecret {
            title: name.to_owned(),
            note: notes,
        }));
    }

    Some(SecretValue::Login(LoginSecret {
        website_url: if url.is_empty() { name } else { url }.to_owned(),
        username: field(record, indexes, "username").to_owned(),
        password: field(record, indexes, "password").to_owned(),
        notes,
    }))
}

/// Parse a plaintext `LastPass` generic CSV export in memory. The canonical
/// `LastPass` columns may appear in any order; additional columns are ignored.
pub fn plan_lastpass_import(csv: &str) -> Result<LastPassImportPlan, LastPassImportError> {
    if csv.len() > MAX_EXPORT_BYTES {
        return Err(LastPassImportError::ExportTooLarge);
    }
    let mut reader = ReaderBuilder::new()
        .flexible(true)
        .trim(Trim::Headers)
        .from_reader(csv.as_bytes());
    let headers = reader.headers()?.clone();
    let indexes = header_indexes(&headers)?;
    let mut items = Vec::new();
    for record in reader.records() {
        if let Some(item) = convert_record(&record?, &indexes) {
            items.push(item);
        }
    }
    Ok(LastPassImportPlan {
        source_count: items.len(),
        items,
        skipped_unsupported: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_logins_and_secure_notes_with_quoted_multiline_values() {
        let export = concat!(
            "url,username,password,extra,name,grouping,fav\n",
            "https://github.com/login,alice,secret,\"Recovery codes,\nelsewhere\",GitHub,Work,1\n",
            "http://sn,,,\"# Private note\n\nKeep offline\",Recovery,Personal,0\n",
        );
        let plan = plan_lastpass_import(export).unwrap();
        assert_eq!(plan.source_count, 2);
        assert_eq!(plan.skipped_unsupported, 0);
        assert_eq!(
            plan.items[0],
            SecretValue::Login(LoginSecret {
                website_url: "https://github.com/login".to_owned(),
                username: "alice".to_owned(),
                password: "secret".to_owned(),
                notes: "Recovery codes,\nelsewhere\n\n## LastPass\n- group: Work\n- favorite: true"
                    .to_owned(),
            })
        );
        assert_eq!(
            plan.items[1],
            SecretValue::SecureNote(SecureNoteSecret {
                title: "Recovery".to_owned(),
                note: "# Private note\n\nKeep offline\n\n## LastPass\n- group: Personal".to_owned(),
            })
        );
    }

    #[test]
    fn accepts_reordered_headers_bom_extra_columns_and_blank_rows() {
        let export = concat!(
            "\u{feff}name,password,url,extra,username,fav,grouping,totp,ignored\n",
            "Router,router-secret,,note,admin,false,Home,otpauth://totp/router?secret=ABC,value\n",
            ",,,,,,,,\n",
        );
        let plan = plan_lastpass_import(export).unwrap();
        assert_eq!(plan.source_count, 1);
        assert_eq!(
            plan.items,
            vec![SecretValue::Login(LoginSecret {
                website_url: "Router".to_owned(),
                username: "admin".to_owned(),
                password: "router-secret".to_owned(),
                notes: concat!(
                    "note\n\n## LastPass\n- group: Home\n",
                    "- totp: otpauth://totp/router?secret=ABC",
                )
                .to_owned(),
            })]
        );
    }

    #[test]
    fn rejects_missing_duplicate_and_malformed_headers() {
        let missing = plan_lastpass_import("url,username,password\n");
        assert!(matches!(
            missing,
            Err(LastPassImportError::InvalidHeader(_))
        ));

        let duplicate = plan_lastpass_import("url,username,password,extra,name,grouping,fav,url\n");
        assert!(matches!(
            duplicate,
            Err(LastPassImportError::InvalidHeader(_))
        ));
    }

    #[test]
    fn rejects_oversized_exports_before_parsing() {
        let export = "x".repeat(MAX_EXPORT_BYTES + 1);
        assert!(matches!(
            plan_lastpass_import(&export),
            Err(LastPassImportError::ExportTooLarge)
        ));
    }
}
