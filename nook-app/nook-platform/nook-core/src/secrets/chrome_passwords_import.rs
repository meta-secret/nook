//! Chromium-family password CSV conversion into Nook's typed plaintext model.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use std::iter;

use csv::StringRecord;
use thiserror::Error;

use super::import_support::{
    self, CsvHeader, CsvImportConversion, CsvImportReader, CsvRecordFields, ImportMetadata,
    SourceLabelMetadata,
};
use crate::{LoginSecret, SecretValue};

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
    pub source_count: crate::SecretImportSourceRecordCount,
    pub skipped_unsupported: crate::SecretImportUnsupportedRecordCount,
}

#[derive(Clone, Copy)]
struct ChromePasswordColumns {
    name: Option<usize>,
    url: usize,
    username: usize,
    password: usize,
    note: Option<usize>,
}

struct ChromePasswordsHeaders {
    normalized: Vec<String>,
}
enum ChromeRequiredColumn {
    Url,
    Username,
    Password,
}
impl ChromeRequiredColumn {
    fn name(&self) -> &'static str {
        match self {
            Self::Url => "url",
            Self::Username => "username",
            Self::Password => "password",
        }
    }
    fn aliases(&self) -> &'static [&'static str] {
        match self {
            Self::Url => &["website url", "website"],
            Self::Username => &["user name", "login"],
            Self::Password => &["secret"],
        }
    }
}
impl ChromePasswordsHeaders {
    fn new(headers: &StringRecord) -> Self {
        Self {
            normalized: headers
                .iter()
                .map(|header| CsvHeader::new(header).normalized())
                .collect(),
        }
    }
    fn required(&self, column: &ChromeRequiredColumn) -> Result<usize, ChromePasswordsImportError> {
        iter::once(column.name())
            .chain(column.aliases().iter().copied())
            .find_map(|candidate| {
                let expected = CsvHeader::new(candidate).normalized();
                self.normalized
                    .iter()
                    .position(|header| header == &expected)
            })
            .ok_or(ChromePasswordsImportError::MissingColumn(column.name()))
    }
    fn optional(&self, names: &[&str]) -> Option<usize> {
        names.iter().find_map(|name| {
            let expected = CsvHeader::new(name).normalized();
            self.normalized
                .iter()
                .position(|header| header == &expected)
        })
    }
    fn admit(self) -> Result<ChromePasswordColumns, ChromePasswordsImportError> {
        Ok(ChromePasswordColumns {
            name: self.optional(&["name", "title"]),
            url: self.required(&ChromeRequiredColumn::Url)?,
            username: self.required(&ChromeRequiredColumn::Username)?,
            password: self.required(&ChromeRequiredColumn::Password)?,
            note: self.optional(&["note", "notes"]),
        })
    }
}

struct BrowserPasswordLabel<'a> {
    name: &'a str,
    website_url: &'a str,
}
impl BrowserPasswordLabel<'_> {
    fn append_to(&self, notes: &mut String) {
        if let Some(entry) = (SourceLabelMetadata {
            key: "name",
            label: self.name,
            website_url: self.website_url,
        })
        .entry()
        {
            ImportMetadata {
                heading: "Browser password manager",
                entries: [entry],
            }
            .append_to(notes);
        }
    }
}

impl ChromePasswordColumns {
    fn convert(&self, record: &StringRecord) -> Option<SecretValue> {
        let csv_fields = CsvRecordFields::new(record);
        let name = csv_fields.optional(self.name);
        let url = csv_fields.trimmed(self.url);
        let username = csv_fields.trimmed(self.username);
        let password = csv_fields.password(self.password);
        let mut notes = csv_fields.optional(self.note);

        if password.is_empty() {
            return None;
        }

        if name.is_empty()
            && url.is_empty()
            && username.is_empty()
            && password.is_empty()
            && notes.is_empty()
        {
            return None;
        }

        let website_url = if url.is_empty() { name.clone() } else { url };
        BrowserPasswordLabel {
            name: &name,
            website_url: &website_url,
        }
        .append_to(&mut notes);

        Some(SecretValue::Login(LoginSecret {
            website_url,
            username,
            password,
            notes,
        }))
    }
}

/// Parse a Chrome, Chromium, Brave, or Edge password CSV entirely in memory.
/// Borrowed CSV input whose schema is admitted before records are converted.
///
/// ```
/// use nook_core::ChromePasswordsCsvInput;
/// let input = ChromePasswordsCsvInput::new("url,username,password\n");
/// assert!(input.plan().is_ok());
/// ```
///
/// The input cannot be reused after planning.
/// ```compile_fail,E0382
/// use nook_core::ChromePasswordsCsvInput;
/// let input = ChromePasswordsCsvInput::new("");
/// let _first = input.plan();
/// let _second = input.plan();
/// ```
///
/// The input retains its original borrowed bytes.
/// ```compile_fail,E0502
/// use nook_core::ChromePasswordsCsvInput;
/// let mut csv = String::new();
/// let input = ChromePasswordsCsvInput::new(&csv);
/// csv.clear();
/// let _result = input.plan();
/// ```
///
/// ```compile_fail,E0599
/// use nook_core::ChromePasswordsCsvInput;
/// let input = ChromePasswordsCsvInput::new("");
/// let _copy = input.clone();
/// ```
///
/// The checked state cannot be obtained through a public unchecked route.
/// ```compile_fail,E0624
/// use nook_core::ChromePasswordsCsvInput;
/// let _checked = ChromePasswordsCsvInput::new("").check();
/// ```
/// The admitted reader and schema are not externally constructible.
/// ```compile_fail,E0603
/// use nook_core::chrome_passwords_import::CheckedChromePasswordsCsv;
/// ```
pub struct ChromePasswordsCsvInput<'a> {
    text: &'a str,
}
impl<'a> ChromePasswordsCsvInput<'a> {
    #[must_use]
    pub fn new(text: &'a str) -> Self {
        Self { text }
    }
    pub fn plan(self) -> Result<ChromePasswordsImportPlan, ChromePasswordsImportError> {
        self.check()?.collect()
    }
    fn check(self) -> Result<CheckedChromePasswordsCsv<'a>, ChromePasswordsImportError> {
        if self.text.len() > import_support::MAX_CSV_BYTES {
            return Err(ChromePasswordsImportError::CsvTooLarge);
        }

        let mut reader = CsvImportReader::new(self.text);
        let columns = ChromePasswordsHeaders::new(reader.headers()?).admit()?;
        Ok(CheckedChromePasswordsCsv { reader, columns })
    }
}
struct CheckedChromePasswordsCsv<'a> {
    reader: CsvImportReader<'a>,
    columns: ChromePasswordColumns,
}
impl CheckedChromePasswordsCsv<'_> {
    fn collect(self) -> Result<ChromePasswordsImportPlan, ChromePasswordsImportError> {
        let collection = self.reader.collect(CsvImportConversion {
            too_many_records: ChromePasswordsImportError::TooManyRecords,
            convert: |record: &StringRecord| match self.columns.convert(record) {
                Some(item) => (vec![item], 0),
                None => (Vec::new(), 1),
            },
        })?;

        Ok(ChromePasswordsImportPlan {
            items: collection.items,
            source_count: collection.source_count.into(),
            skipped_unsupported: collection.skipped_unsupported.into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{ChromePasswordsCsvInput, ChromePasswordsImportError, import_support};
    use crate::{LoginSecret, SecretValue};

    #[test]
    fn checked_headers_prefer_canonical_names_then_first_duplicates() -> anyhow::Result<()> {
        let csv = concat!(
            "website,url,url,login,username,secret,password,title,name,notes,note\n",
            "alias,https://canonical,duplicate,alias-user,user,alias-secret, 密碼 ,alias-title,https://canonical,alias-note,note\n",
        );
        let checked = ChromePasswordsCsvInput::new(csv).check()?;
        let plan = checked.collect()?;
        assert_eq!(
            plan.items,
            vec![SecretValue::Login(LoginSecret {
                website_url: "https://canonical".to_owned(),
                username: "user".to_owned(),
                password: " 密碼 ".to_owned(),
                notes: "note".to_owned(),
            })]
        );
        Ok(())
    }

    #[test]
    fn alias_preference_is_independent_of_header_position() -> anyhow::Result<()> {
        let csv = "website,website url,login,user name,secret\nsecond,first,second-user,first-user,password\n";
        let plan = ChromePasswordsCsvInput::new(csv).plan()?;
        assert!(matches!(&plan.items[0], SecretValue::Login(login)
            if login.website_url == "first" && login.username == "first-user"));
        Ok(())
    }

    #[test]
    fn required_columns_and_byte_limit_keep_admission_order() {
        for (csv, column) in [
            ("username,password\n", "url"),
            ("url,password\n", "username"),
            ("url,username\n", "password"),
        ] {
            assert!(matches!(ChromePasswordsCsvInput::new(csv).plan(),
                Err(ChromePasswordsImportError::MissingColumn(name)) if name == column));
        }
        let oversized = "x".repeat(import_support::MAX_CSV_BYTES + 1);
        assert!(matches!(
            ChromePasswordsCsvInput::new(&oversized).plan(),
            Err(ChromePasswordsImportError::CsvTooLarge)
        ));
    }

    #[test]
    fn blank_rows_count_toward_the_existing_record_limit() -> anyhow::Result<()> {
        let mut csv = format!("url,username,password\n{}", ",,\n".repeat(100_000));
        let plan = ChromePasswordsCsvInput::new(&csv).plan()?;
        assert_eq!(usize::from(plan.source_count), 100_000);
        assert_eq!(usize::from(plan.skipped_unsupported), 100_000);
        assert!(plan.items.is_empty());
        csv.push_str(",,\n");
        assert!(matches!(
            ChromePasswordsCsvInput::new(&csv).plan(),
            Err(ChromePasswordsImportError::TooManyRecords)
        ));
        Ok(())
    }

    #[test]
    fn imports_chromium_login_and_preserves_name_and_note() -> anyhow::Result<()> {
        let csv = concat!(
            "name,url,username,password,note\n",
            "\"Example, Inc\",https://example.com/login,alice@example.com,secret,",
            "\"Recovery, information\"\n"
        );

        let plan = ChromePasswordsCsvInput::new(csv).plan()?;

        assert_eq!(usize::from(plan.source_count), 1);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
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
        Ok(())
    }

    #[test]
    fn supports_bom_reordered_headers_and_common_aliases() -> anyhow::Result<()> {
        let csv =
            "\u{feff}Password,User_Name,Website URL,Title,Notes\nsecret,alice,,Example,Personal\n";

        let plan = ChromePasswordsCsvInput::new(csv).plan()?;

        assert_eq!(
            plan.items,
            vec![SecretValue::Login(LoginSecret {
                website_url: "Example".to_owned(),
                username: "alice".to_owned(),
                password: "secret".to_owned(),
                notes: "Personal".to_owned(),
            })]
        );
        Ok(())
    }

    #[test]
    fn accepts_minimal_google_documented_columns_and_skips_empty_rows() -> anyhow::Result<()> {
        let csv = concat!(
            "url,username,password\n",
            "https://example.com,alice,secret\n",
            ",,\n"
        );

        let plan = ChromePasswordsCsvInput::new(csv).plan()?;

        assert_eq!(usize::from(plan.source_count), 2);
        assert_eq!(plan.items.len(), 1);
        assert_eq!(usize::from(plan.skipped_unsupported), 1);
        Ok(())
    }

    #[test]
    fn preserves_leading_and_trailing_password_whitespace() -> anyhow::Result<()> {
        let csv = "url,username,password\nhttps://example.com,alice,\" secret \"\n";

        let plan = ChromePasswordsCsvInput::new(csv).plan()?;
        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login");
        };

        assert_eq!(login.password, " secret ");
        Ok(())
    }

    #[test]
    fn skips_rows_without_a_password_but_preserves_whitespace_only_passwords() -> anyhow::Result<()>
    {
        let csv = concat!(
            "url,username,password\n",
            "https://example.com,alice,\n",
            "https://spaces.example,alice,\"   \"\n"
        );

        let plan = ChromePasswordsCsvInput::new(csv).plan()?;

        assert_eq!(usize::from(plan.source_count), 2);
        assert_eq!(usize::from(plan.skipped_unsupported), 1);
        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login");
        };
        assert_eq!(login.password, "   ");
        Ok(())
    }

    #[test]
    fn rejects_unrelated_csv_headers() -> anyhow::Result<()> {
        let error = ChromePasswordsCsvInput::new("service,login,secret\nExample,alice,password\n")
            .plan()
            .err()
            .ok_or_else(|| {
                anyhow::anyhow!("chrome passwords import test should reject invalid input")
            })?;

        assert!(matches!(
            error,
            ChromePasswordsImportError::MissingColumn("url")
        ));
        Ok(())
    }
}
