//! `KeePassXC` CSV conversion into Nook's typed plaintext secret model.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::secrets::import_support::CsvExportColumn;
use csv::StringRecord;
use thiserror::Error;

use super::import_support::{
    self, CsvHeader, CsvImportConversion, CsvImportReader, CsvRecordFields, ImportMetadata,
    SourceLabelMetadata,
};
use crate::{
    AuthenticatorIssuerHostsError, AuthenticatorSecret, LoginSecret, SecretValue, SecureNoteSecret,
    ValidationError,
};

#[derive(Debug, Error)]
pub enum KeePassXcImportError {
    #[error("The KeePassXC CSV export is too large to import safely.")]
    CsvTooLarge,
    #[error("The KeePassXC CSV contains too many rows to import safely.")]
    TooManyRecords,
    #[error("This is not a KeePassXC CSV export. The {0} column is missing.")]
    MissingColumn(&'static str),
    #[error("The KeePassXC CSV is invalid: {0}")]
    InvalidCsv(#[from] csv::Error),
    #[error("The bundled authenticator issuer catalog is invalid: {0}")]
    InvalidIssuerCatalog(#[from] AuthenticatorIssuerHostsError),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeePassXcImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: crate::SecretImportSourceRecordCount,
    pub skipped_unsupported: crate::SecretImportUnsupportedRecordCount,
}

#[derive(Clone, Copy)]
struct KeePassXcColumns {
    group: usize,
    title: usize,
    username: usize,
    password: usize,
    url: usize,
    notes: usize,
    totp: CsvExportColumn,
}

struct KeePassXcHeaders {
    normalized: Vec<String>,
}
impl KeePassXcHeaders {
    fn new(headers: &StringRecord) -> Self {
        Self {
            normalized: headers
                .iter()
                .map(|header| CsvHeader::new(header).normalized())
                .collect(),
        }
    }
    fn required(&self, name: &'static str) -> Result<usize, KeePassXcImportError> {
        self.normalized
            .iter()
            .position(|header| header == &CsvHeader::new(name).normalized())
            .ok_or(KeePassXcImportError::MissingColumn(name))
    }
    fn optional(&self, name: &str) -> CsvExportColumn {
        let expected = CsvHeader::new(name).normalized();
        let column = self
            .normalized
            .iter()
            .position(|header| header == &expected);
        match column {
            Some(index) => CsvExportColumn::Exported(index),
            None => CsvExportColumn::NotExported,
        }
    }
    fn admit(self) -> Result<KeePassXcColumns, KeePassXcImportError> {
        Ok(KeePassXcColumns {
            group: self.required("Group")?,
            title: self.required("Title")?,
            username: self.required("Username")?,
            password: self.required("Password")?,
            url: self.required("URL")?,
            notes: self.required("Notes")?,
            totp: self.optional("TOTP"),
        })
    }
}

struct KeePassXcMetadata<'a> {
    title: &'a str,
    website_url: &'a str,
    group: &'a str,
    totp: &'a str,
}
impl KeePassXcMetadata<'_> {
    fn append_to(&self, notes: &mut String) {
        let mut metadata = Vec::new();
        if let Ok(entry) = (SourceLabelMetadata {
            key: "title",
            label: self.title,
            website_url: self.website_url,
        })
        .entry()
        {
            metadata.push(entry);
        }
        if !self.group.trim().is_empty() {
            metadata.push(("group".to_owned(), self.group.trim().to_owned()));
        }
        if !self.totp.trim().is_empty() {
            metadata.push(("totp".to_owned(), self.totp.trim().to_owned()));
        }
        ImportMetadata {
            heading: "KeePassXC",
            entries: metadata,
        }
        .append_to(notes);
    }
}

enum KeePassXcTotpDisposition {
    NotAnOtpUri,
    Imported(AuthenticatorSecret),
    UnsupportedOtpUri,
}
impl KeePassXcTotpDisposition {
    fn skipped_count(&self) -> usize {
        match self {
            Self::UnsupportedOtpUri => 1,
            Self::NotAnOtpUri | Self::Imported(_) => 0,
        }
    }
    fn notes_text<'a>(&self, original: &'a str) -> &'a str {
        match self {
            Self::Imported(_) => "",
            Self::NotAnOtpUri | Self::UnsupportedOtpUri => original,
        }
    }
    fn append(self, items: &mut Vec<SecretValue>) {
        match self {
            Self::Imported(authenticator) => items.push(SecretValue::Authenticator(authenticator)),
            Self::NotAnOtpUri | Self::UnsupportedOtpUri => {}
        }
    }
}
struct KeePassXcTotp<'a> {
    text: &'a str,
    website_url: &'a str,
}
impl KeePassXcTotp<'_> {
    fn convert(&self) -> Result<KeePassXcTotpDisposition, KeePassXcImportError> {
        let totp = self.text.trim();
        if totp.is_empty() || !totp.to_ascii_lowercase().starts_with("otpauth://") {
            return Ok(KeePassXcTotpDisposition::NotAnOtpUri);
        }
        match AuthenticatorSecret::from_otpauth_uri(totp) {
            Ok(mut authenticator) => {
                if authenticator.website_url.trim().is_empty()
                    && !self.website_url.trim().is_empty()
                {
                    self.website_url.clone_into(&mut authenticator.website_url);
                }
                let authenticator = authenticator.apply_inferred_website_url_if_empty()?;
                Ok(KeePassXcTotpDisposition::Imported(authenticator))
            }
            Err(ValidationError::AuthenticatorIssuerCatalogInvalid) => {
                Err(KeePassXcImportError::InvalidIssuerCatalog(
                    AuthenticatorIssuerHostsError::InvalidBundledCatalog,
                ))
            }
            Err(_) => Ok(KeePassXcTotpDisposition::UnsupportedOtpUri),
        }
    }
}

impl KeePassXcColumns {
    fn convert(
        &self,
        record: &StringRecord,
    ) -> Result<(Vec<SecretValue>, usize), KeePassXcImportError> {
        let csv_fields = CsvRecordFields::new(record);
        let group = csv_fields.trimmed(self.group);
        let title = csv_fields.trimmed(self.title);
        let username = csv_fields.trimmed(self.username);
        let password = csv_fields.password(self.password);
        let url = csv_fields.trimmed(self.url);
        let mut notes = csv_fields.trimmed(self.notes);
        let totp = csv_fields.optional(self.totp);

        if group.is_empty()
            && title.is_empty()
            && username.is_empty()
            && password.is_empty()
            && url.is_empty()
            && notes.is_empty()
            && totp.is_empty()
        {
            return Ok((Vec::new(), 1));
        }

        let mut items = Vec::new();
        let mut skipped_unsupported = 0;
        let is_login = !password.is_empty() || !username.is_empty() || !url.is_empty();

        if is_login {
            let website_url = if url.is_empty() { title.clone() } else { url };
            let authenticator = KeePassXcTotp {
                text: &totp,
                website_url: &website_url,
            }
            .convert()?;
            skipped_unsupported += authenticator.skipped_count();
            let totp_for_notes = authenticator.notes_text(&totp);
            KeePassXcMetadata {
                title: &title,
                website_url: &website_url,
                group: &group,
                totp: totp_for_notes,
            }
            .append_to(&mut notes);
            items.push(SecretValue::Login(LoginSecret {
                website_url: website_url.clone(),
                username,
                password,
                notes,
            }));
            authenticator.append(&mut items);
            return Ok((items, skipped_unsupported));
        }

        if title.is_empty() && notes.is_empty() {
            return Ok((Vec::new(), 1));
        }

        let authenticator = KeePassXcTotp {
            text: &totp,
            website_url: "",
        }
        .convert()?;
        skipped_unsupported += authenticator.skipped_count();
        let totp_for_notes = authenticator.notes_text(&totp);
        KeePassXcMetadata {
            title: "",
            website_url: "",
            group: &group,
            totp: totp_for_notes,
        }
        .append_to(&mut notes);
        items.push(SecretValue::SecureNote(SecureNoteSecret {
            title,
            note: notes,
        }));
        authenticator.append(&mut items);
        Ok((items, skipped_unsupported))
    }
}

/// Parse a `KeePassXC` CSV export entirely in memory.
/// Borrowed CSV input whose schema is admitted before records are converted.
///
/// ```
/// use nook_core::KeePassXcCsvInput;
/// let input = KeePassXcCsvInput::new("Group,Title,Username,Password,URL,Notes\n");
/// assert!(input.plan().is_ok());
/// ```
///
/// The input cannot be reused after planning.
/// ```compile_fail,E0382
/// use nook_core::KeePassXcCsvInput;
/// let input = KeePassXcCsvInput::new("");
/// let _first = input.plan();
/// let _second = input.plan();
/// ```
///
/// The input retains its original borrowed bytes.
/// ```compile_fail,E0502
/// use nook_core::KeePassXcCsvInput;
/// let mut csv = String::new();
/// let input = KeePassXcCsvInput::new(&csv);
/// csv.clear();
/// let _result = input.plan();
/// ```
///
/// ```compile_fail,E0599
/// use nook_core::KeePassXcCsvInput;
/// let input = KeePassXcCsvInput::new("");
/// let _copy = input.clone();
/// ```
///
/// The checked state cannot be obtained through a public unchecked route.
/// ```compile_fail,E0624
/// use nook_core::KeePassXcCsvInput;
/// let _checked = KeePassXcCsvInput::new("").check();
/// ```
/// The admitted reader and schema are not externally constructible.
/// ```compile_fail,E0603
/// use nook_core::keepassxc_import::CheckedKeePassXcCsv;
/// ```
pub struct KeePassXcCsvInput<'a> {
    text: &'a str,
}
impl<'a> KeePassXcCsvInput<'a> {
    #[must_use]
    pub fn new(text: &'a str) -> Self {
        Self { text }
    }
    pub fn plan(self) -> Result<KeePassXcImportPlan, KeePassXcImportError> {
        self.check()?.collect()
    }
    fn check(self) -> Result<CheckedKeePassXcCsv<'a>, KeePassXcImportError> {
        if self.text.len() > import_support::MAX_CSV_BYTES {
            return Err(KeePassXcImportError::CsvTooLarge);
        }

        let reader = CsvImportReader::new(self.text);
        let read = reader.headers()?;
        let reader = read.reader;
        let columns = KeePassXcHeaders::new(&read.headers).admit()?;
        Ok(CheckedKeePassXcCsv { reader, columns })
    }
}
struct CheckedKeePassXcCsv<'a> {
    reader: CsvImportReader<'a>,
    columns: KeePassXcColumns,
}
impl CheckedKeePassXcCsv<'_> {
    fn collect(self) -> Result<KeePassXcImportPlan, KeePassXcImportError> {
        let collection = self.reader.collect_fallible(
            CsvImportConversion {
                too_many_records: KeePassXcImportError::TooManyRecords,
                convert: |record: &StringRecord| self.columns.convert(record),
            },
            |items: Vec<SecretValue>| {
                for mut item in items {
                    item.zeroize_plaintext();
                }
            },
        )?;

        Ok(KeePassXcImportPlan {
            items: collection.items,
            source_count: collection.source_count.into(),
            skipped_unsupported: collection.skipped_unsupported.into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{KeePassXcCsvInput, KeePassXcImportError, import_support};
    use crate::{LoginSecret, SecretValue, SecureNoteSecret};

    #[test]
    fn checked_headers_keep_first_duplicates_and_password_bytes() -> anyhow::Result<()> {
        let csv = concat!(
            "Password,Password,Notes,URL,Username,Title,Group\n",
            " 密碼 ,wrong, note ,https://example.com, user ,https://example.com,\n",
        );
        let checked = KeePassXcCsvInput::new(csv).check()?;
        let plan = checked.collect()?;
        assert_eq!(
            plan.items,
            vec![SecretValue::Login(LoginSecret {
                website_url: "https://example.com".to_owned(),
                username: "user".to_owned(),
                password: " 密碼 ".to_owned(),
                notes: "note".to_owned(),
            })]
        );
        Ok(())
    }

    #[test]
    fn malformed_totp_is_counted_and_retained_in_notes() -> anyhow::Result<()> {
        let csv = concat!(
            "Group,Title,Username,Password,URL,Notes,TOTP\n",
            ",https://example.com,user,password,https://example.com,note,otpauth://totp/account?secret=!\n",
        );
        let plan = KeePassXcCsvInput::new(csv).plan()?;
        assert_eq!(usize::from(plan.source_count), 1);
        assert_eq!(usize::from(plan.skipped_unsupported), 1);
        assert_eq!(plan.items.len(), 1);
        assert!(matches!(&plan.items[0], SecretValue::Login(login)
            if login.notes == "note\n\n## KeePassXC\n- totp: otpauth://totp/account?secret=!"));
        Ok(())
    }

    #[test]
    fn secure_note_precedes_its_successful_authenticator() -> anyhow::Result<()> {
        let csv = concat!(
            "Group,Title,Username,Password,URL,Notes,TOTP\n",
            ",Offline,,,,note,otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example\n",
        );
        let plan = KeePassXcCsvInput::new(csv).plan()?;
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        assert_eq!(plan.items.len(), 2);
        assert_eq!(
            plan.items[0],
            SecretValue::SecureNote(SecureNoteSecret {
                title: "Offline".to_owned(),
                note: "note".to_owned(),
            })
        );
        assert!(
            matches!(&plan.items[1], SecretValue::Authenticator(auth) if auth.account == "alice")
        );
        Ok(())
    }

    #[test]
    fn byte_and_record_bounds_preserve_existing_error_precedence() -> anyhow::Result<()> {
        let oversized = "x".repeat(import_support::MAX_CSV_BYTES + 1);
        assert!(matches!(
            KeePassXcCsvInput::new(&oversized).plan(),
            Err(KeePassXcImportError::CsvTooLarge)
        ));
        let mut csv = format!(
            "Group,Title,Username,Password,URL,Notes\n{}",
            ",,,,,\n".repeat(100_000)
        );
        let plan = KeePassXcCsvInput::new(&csv).plan()?;
        assert_eq!(usize::from(plan.source_count), 100_000);
        assert_eq!(usize::from(plan.skipped_unsupported), 100_000);
        csv.push_str(",,,,,\n");
        assert!(matches!(
            KeePassXcCsvInput::new(&csv).plan(),
            Err(KeePassXcImportError::TooManyRecords)
        ));
        assert!(matches!(
            KeePassXcCsvInput::new("Group,Password\n").plan(),
            Err(KeePassXcImportError::MissingColumn("Title"))
        ));
        Ok(())
    }

    #[test]
    fn imports_login_secure_note_and_otpauth_totp() -> anyhow::Result<()> {
        let csv = concat!(
            "Group,Title,Username,Password,URL,Notes,TOTP,Icon,Last Modified,Created\n",
            "Root/Work,\"GitHub, Inc\",alice,secret,https://github.com/login,",
            "\"Recovery codes,\nelsewhere\",",
            "\"otpauth://totp/GitHub%3Aalice?secret=JBSWY3DPEHPK3PXP&issuer=GitHub\",",
            "0,2024-01-01T00:00:00Z,2023-01-01T00:00:00Z\n",
            "Root/Personal,Recovery,,,,\"# Offline note\n\nKeep offline\",,0,,\n",
        );

        let plan = KeePassXcCsvInput::new(csv).plan()?;

        assert_eq!(usize::from(plan.source_count), 2);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        assert_eq!(plan.items.len(), 3);
        assert_eq!(
            plan.items[0],
            SecretValue::Login(LoginSecret {
                website_url: "https://github.com/login".to_owned(),
                username: "alice".to_owned(),
                password: "secret".to_owned(),
                notes: concat!(
                    "Recovery codes,\nelsewhere\n\n",
                    "## KeePassXC\n- title: GitHub, Inc\n- group: Root/Work"
                )
                .to_owned(),
            })
        );
        assert!(matches!(
            &plan.items[1],
            SecretValue::Authenticator(auth)
                if auth.issuer == "GitHub" && auth.account == "alice"
        ));
        assert_eq!(
            plan.items[2],
            SecretValue::SecureNote(SecureNoteSecret {
                title: "Recovery".to_owned(),
                note: "# Offline note\n\nKeep offline\n\n## KeePassXC\n- group: Root/Personal"
                    .to_owned(),
            })
        );
        Ok(())
    }

    #[test]
    fn preserves_non_otpauth_totp_in_notes_and_supports_bom() -> anyhow::Result<()> {
        let csv = concat!(
            "\u{feff}Group,Title,Username,Password,URL,Notes,TOTP\n",
            "Root,Example,alice,secret,https://example.com,Personal,",
            "key=JBSWY3DPEHPK3PXP&period=30&digits=6\n",
        );

        let plan = KeePassXcCsvInput::new(csv).plan()?;

        assert_eq!(plan.items.len(), 1);
        assert_eq!(
            plan.items[0],
            SecretValue::Login(LoginSecret {
                website_url: "https://example.com".to_owned(),
                username: "alice".to_owned(),
                password: "secret".to_owned(),
                notes: concat!(
                    "Personal\n\n## KeePassXC\n- title: Example\n- group: Root\n",
                    "- totp: key=JBSWY3DPEHPK3PXP&period=30&digits=6"
                )
                .to_owned(),
            })
        );
        Ok(())
    }

    #[test]
    fn uses_title_when_url_empty_and_skips_blank_rows() -> anyhow::Result<()> {
        let csv = concat!(
            "Group,Title,Username,Password,URL,Notes\n",
            "Root,Local service,alice,secret,,\n",
            ",,,,,\n",
        );

        let plan = KeePassXcCsvInput::new(csv).plan()?;

        assert_eq!(usize::from(plan.source_count), 2);
        assert_eq!(usize::from(plan.skipped_unsupported), 1);
        assert_eq!(
            plan.items,
            vec![SecretValue::Login(LoginSecret {
                website_url: "Local service".to_owned(),
                username: "alice".to_owned(),
                password: "secret".to_owned(),
                notes: "## KeePassXC\n- group: Root".to_owned(),
            })]
        );
        Ok(())
    }

    #[test]
    fn rejects_missing_required_columns() {
        assert!(matches!(
            KeePassXcCsvInput::new("url,username,password\nhttps://example.com,alice,secret\n")
                .plan(),
            Err(KeePassXcImportError::MissingColumn("Group"))
        ));
    }
}
