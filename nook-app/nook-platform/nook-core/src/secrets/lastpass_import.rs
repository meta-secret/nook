//! `LastPass` CSV conversion into Nook's typed plaintext secret model.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::import_support::{ImportMetadata, SourceLabelMetadata};
use crate::secrets::import_support::{ImportItemDisposition, ImportSkipReason};

use std::collections::HashMap;

use csv::{Reader, ReaderBuilder, StringRecord, Trim};
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
    pub source_count: crate::SecretImportSourceRecordCount,
    pub skipped_unsupported: crate::SecretImportUnsupportedRecordCount,
}

struct LastPassColumns {
    indexes: HashMap<&'static str, usize>,
}
impl LastPassColumns {
    fn admit(headers: &StringRecord) -> Result<Self, LastPassImportError> {
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
        Ok(Self { indexes })
    }
}

struct LastPassRecord<'a> {
    record: &'a StringRecord,
    columns: &'a LastPassColumns,
}
impl<'a> LastPassRecord<'a> {
    fn field(&self, name: &'static str) -> &'a str {
        self.columns
            .indexes
            .get(name)
            .and_then(|index| self.record.get(*index))
            .unwrap_or_default()
    }
}

struct LastPassMetadata<'a> {
    name: &'a str,
    website_url: &'a str,
    grouping: &'a str,
    favorite: &'a str,
    totp: &'a str,
}
impl LastPassMetadata<'_> {
    fn append_to(&self, notes: &mut String) {
        let mut metadata = Vec::new();
        if let Ok((key, value)) = (SourceLabelMetadata {
            key: "name",
            label: self.name,
            website_url: self.website_url,
        })
        .entry()
        {
            metadata.push((key, value));
        }
        if !self.grouping.trim().is_empty() {
            metadata.push(("group".to_owned(), self.grouping.trim().to_owned()));
        }
        if matches!(
            self.favorite.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes"
        ) {
            metadata.push(("favorite".to_owned(), "true".to_owned()));
        }
        if !self.totp.trim().is_empty() {
            metadata.push(("totp".to_owned(), self.totp.trim().to_owned()));
        }
        ImportMetadata {
            heading: "LastPass",
            entries: metadata,
        }
        .append_to(notes);
    }
}

struct LastPassUrl<'a> {
    url: &'a str,
}
impl LastPassUrl<'_> {
    fn is_secure_note(&self) -> bool {
        self.url
            .trim()
            .trim_end_matches('/')
            .eq_ignore_ascii_case("http://sn")
    }
}

impl LastPassRecord<'_> {
    fn convert(&self) -> ImportItemDisposition {
        if self.record.iter().all(|value| value.trim().is_empty()) {
            return ImportItemDisposition::Skipped(ImportSkipReason::EmptyRecord);
        }
        let url = self.field("url").trim();
        let name = self.field("name").trim();
        let mut notes = self.field("extra").to_owned();

        if (LastPassUrl { url }).is_secure_note() {
            LastPassMetadata {
                name: "",
                website_url: "",
                grouping: self.field("grouping"),
                favorite: self.field("fav"),
                totp: self.field("totp"),
            }
            .append_to(&mut notes);
            return ImportItemDisposition::Imported(SecretValue::SecureNote(SecureNoteSecret {
                title: name.to_owned(),
                note: notes,
            }));
        }

        let website_url = if url.is_empty() { name } else { url }.to_owned();
        LastPassMetadata {
            name,
            website_url: &website_url,
            grouping: self.field("grouping"),
            favorite: self.field("fav"),
            totp: self.field("totp"),
        }
        .append_to(&mut notes);

        ImportItemDisposition::Imported(SecretValue::Login(LoginSecret {
            website_url,
            username: self.field("username").to_owned(),
            password: self.field("password").to_owned(),
            notes,
        }))
    }
}

/// Parse a plaintext `LastPass` generic CSV export in memory. The canonical
/// `LastPass` columns may appear in any order; additional columns are ignored.
/// Borrowed CSV input whose schema is admitted before records are converted.
///
/// ```
/// use nook_core::LastPassCsvInput;
/// let input = LastPassCsvInput::new("url,username,password,extra,name,grouping,fav\n");
/// assert!(input.plan().is_ok());
/// ```
///
/// The input cannot be reused after planning.
/// ```compile_fail,E0382
/// use nook_core::LastPassCsvInput;
/// let input = LastPassCsvInput::new("");
/// let _first = input.plan();
/// let _second = input.plan();
/// ```
///
/// The input retains its original borrowed bytes.
/// ```compile_fail,E0502
/// use nook_core::LastPassCsvInput;
/// let mut csv = String::new();
/// let input = LastPassCsvInput::new(&csv);
/// csv.clear();
/// let _result = input.plan();
/// ```
///
/// ```compile_fail,E0599
/// use nook_core::LastPassCsvInput;
/// let input = LastPassCsvInput::new("");
/// let _copy = input.clone();
/// ```
///
/// The checked state cannot be obtained through a public unchecked route.
/// ```compile_fail,E0624
/// use nook_core::LastPassCsvInput;
/// let _checked = LastPassCsvInput::new("").check();
/// ```
/// The admitted reader and schema are not externally constructible.
/// ```compile_fail,E0603
/// use nook_core::lastpass_import::CheckedLastPassCsv;
/// ```
pub struct LastPassCsvInput<'a> {
    text: &'a str,
}
impl<'a> LastPassCsvInput<'a> {
    #[must_use]
    pub fn new(text: &'a str) -> Self {
        Self { text }
    }
    pub fn plan(self) -> Result<LastPassImportPlan, LastPassImportError> {
        self.check()?.collect()
    }
    fn check(self) -> Result<CheckedLastPassCsv<'a>, LastPassImportError> {
        if self.text.len() > MAX_EXPORT_BYTES {
            return Err(LastPassImportError::ExportTooLarge);
        }
        let mut reader = ReaderBuilder::new()
            .flexible(true)
            .trim(Trim::Headers)
            .from_reader(self.text.as_bytes());
        let read = reader.headers()?;
        let reader = read.reader;
        let headers = read.headers;
        let columns = LastPassColumns::admit(&headers)?;
        Ok(CheckedLastPassCsv { reader, columns })
    }
}
struct CheckedLastPassCsv<'a> {
    reader: Reader<&'a [u8]>,
    columns: LastPassColumns,
}
impl CheckedLastPassCsv<'_> {
    fn collect(mut self) -> Result<LastPassImportPlan, LastPassImportError> {
        let mut items = Vec::new();
        for record in self.reader.records() {
            if let ImportItemDisposition::Imported(item) = (LastPassRecord {
                record: &record?,
                columns: &self.columns,
            })
            .convert()
            {
                items.push(item);
            }
        }
        Ok(LastPassImportPlan {
            source_count: items.len().into(),
            items,
            skipped_unsupported: 0.into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{LastPassCsvInput, LastPassImportError, MAX_EXPORT_BYTES};
    use crate::{LoginSecret, SecretValue, SecureNoteSecret};

    #[test]
    fn duplicate_headers_precede_missing_columns_without_shared_normalization() {
        for (csv, expected) in [
            ("url,url\n", "column `url` appears more than once"),
            ("totp,TOTP\n", "column `totp` appears more than once"),
            (
                "url,user_name,password,extra,name,grouping,fav\n",
                "missing required columns: username",
            ),
            (
                "url\n",
                "missing required columns: username, password, extra, name, grouping, fav",
            ),
        ] {
            assert!(matches!(LastPassCsvInput::new(csv).plan(),
                Err(LastPassImportError::InvalidHeader(message)) if message == expected));
        }
    }

    #[test]
    fn checked_collection_preserves_raw_fields_and_imported_item_count() -> anyhow::Result<()> {
        let csv = concat!(
            "password,username,url,extra,name,grouping,fav\n",
            " 密碼 , user , https://example.com , note ,https://example.com,,\n",
            ",,,,,,\n",
        );
        let checked = LastPassCsvInput::new(csv).check()?;
        let plan = checked.collect()?;
        assert_eq!(usize::from(plan.source_count), 1);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        assert_eq!(
            plan.items,
            vec![SecretValue::Login(LoginSecret {
                website_url: "https://example.com".to_owned(),
                username: " user ".to_owned(),
                password: " 密碼 ".to_owned(),
                notes: " note ".to_owned(),
            })]
        );
        Ok(())
    }

    #[test]
    fn secure_note_marker_and_metadata_keep_original_case_rules() -> anyhow::Result<()> {
        let csv = concat!(
            "url,username,password,extra,name,grouping,fav,totp\n",
            " HTTP://SN/// ,,, raw note , Title , Group , YeS , raw-totp \n",
            "https://sn,,,note,Title,,false,\n",
        );
        let plan = LastPassCsvInput::new(csv).plan()?;
        assert_eq!(
            plan.items[0],
            SecretValue::SecureNote(SecureNoteSecret {
                title: "Title".to_owned(),
                note:
                    " raw note \n\n## LastPass\n- group: Group\n- favorite: true\n- totp: raw-totp"
                        .to_owned(),
            })
        );
        assert!(
            matches!(&plan.items[1], SecretValue::Login(login) if login.website_url == "https://sn")
        );
        Ok(())
    }

    #[test]
    fn blank_records_do_not_gain_the_other_importers_row_limit() -> anyhow::Result<()> {
        let csv = format!(
            "url,username,password,extra,name,grouping,fav\n{}",
            ",,,,,,\n".repeat(100_001)
        );
        let plan = LastPassCsvInput::new(&csv).plan()?;
        assert!(plan.items.is_empty());
        assert_eq!(usize::from(plan.source_count), 0);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        Ok(())
    }

    #[test]
    fn converts_logins_and_secure_notes_with_quoted_multiline_values() -> anyhow::Result<()> {
        let export = concat!(
            "url,username,password,extra,name,grouping,fav\n",
            "https://github.com/login,alice,secret,\"Recovery codes,\nelsewhere\",GitHub,Work,1\n",
            "http://sn,,,\"# Private note\n\nKeep offline\",Recovery,Personal,0\n",
        );
        let plan = LastPassCsvInput::new(export).plan()?;
        assert_eq!(usize::from(plan.source_count), 2);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        assert_eq!(
            plan.items[0],
            SecretValue::Login(LoginSecret {
                website_url: "https://github.com/login".to_owned(),
                username: "alice".to_owned(),
                password: "secret".to_owned(),
                notes: "Recovery codes,\nelsewhere\n\n## LastPass\n- name: GitHub\n- group: Work\n- favorite: true"
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
        Ok(())
    }

    #[test]
    fn accepts_reordered_headers_bom_extra_columns_and_blank_rows() -> anyhow::Result<()> {
        let export = concat!(
            "\u{feff}name,password,url,extra,username,fav,grouping,totp,ignored\n",
            "Router,router-secret,,note,admin,false,Home,otpauth://totp/router?secret=ABC,value\n",
            ",,,,,,,,\n",
        );
        let plan = LastPassCsvInput::new(export).plan()?;
        assert_eq!(usize::from(plan.source_count), 1);
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
        Ok(())
    }

    #[test]
    fn rejects_missing_duplicate_and_malformed_headers() {
        let missing = LastPassCsvInput::new("url,username,password\n").plan();
        assert!(matches!(
            missing,
            Err(LastPassImportError::InvalidHeader(_))
        ));

        let duplicate =
            LastPassCsvInput::new("url,username,password,extra,name,grouping,fav,url\n").plan();
        assert!(matches!(
            duplicate,
            Err(LastPassImportError::InvalidHeader(_))
        ));
    }

    #[test]
    fn rejects_oversized_exports_before_parsing() {
        let export = "x".repeat(MAX_EXPORT_BYTES + 1);
        assert!(matches!(
            LastPassCsvInput::new(&export).plan(),
            Err(LastPassImportError::ExportTooLarge)
        ));
    }
}
