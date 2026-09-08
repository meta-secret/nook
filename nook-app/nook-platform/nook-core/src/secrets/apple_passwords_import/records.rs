#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Original CSV reader and admitted columns consume ordered conversion.
use super::super::import_support::{
    CsvHeader, CsvImportConversion, CsvImportReader, CsvRecordFields, ImportMetadata,
    MAX_CSV_BYTES, SourceLabelMetadata,
};
use super::{ApplePasswordsImportError, ApplePasswordsImportPlan};
use crate::{
    AuthenticatorIssuerHostsError, AuthenticatorSecret, LoginSecret, SecretValue, ValidationError,
};
use csv::StringRecord;
#[derive(Clone, Copy)]
struct ApplePasswordColumns {
    title: usize,
    url: usize,
    username: usize,
    password: usize,
    notes: Option<usize>,
    otp_auth: Option<usize>,
}

/// A CSV input retains its source bytes until the admitted reader is consumed.
/// ```
/// use nook_core::ApplePasswordsCsvInput;
/// let csv = "Title,URL,Username,Password\n";
/// let plan = ApplePasswordsCsvInput::new(csv).plan()?;
/// assert!(plan.items.is_empty());
/// # Ok::<(), nook_core::ApplePasswordsImportError>(())
/// ```
/// ```compile_fail,E0382
/// use nook_core::ApplePasswordsCsvInput;
/// let input = ApplePasswordsCsvInput::new("Title,URL,Username,Password\n");
/// let _first = input.plan();
/// let _second = input.plan();
/// ```
/// ```compile_fail,E0502
/// use nook_core::ApplePasswordsCsvInput;
/// let mut csv = String::from("Title,URL,Username,Password\n");
/// let input = ApplePasswordsCsvInput::new(&csv);
/// csv.clear();
/// let _result = input.plan();
/// ```
/// ```compile_fail,E0599
/// use nook_core::ApplePasswordsCsvInput;
/// let input = ApplePasswordsCsvInput::new("");
/// let _duplicate = input.clone();
/// ```
pub struct ApplePasswordsCsvInput<'a> {
    text: &'a str,
}
impl<'a> ApplePasswordsCsvInput<'a> {
    #[must_use]
    pub fn new(text: &'a str) -> Self {
        Self { text }
    }
    pub fn plan(self) -> Result<ApplePasswordsImportPlan, ApplePasswordsImportError> {
        self.check()?.collect()
    }
    fn check(self) -> Result<CheckedApplePasswordsCsv<'a>, ApplePasswordsImportError> {
        if self.text.len() > MAX_CSV_BYTES {
            return Err(ApplePasswordsImportError::CsvTooLarge);
        }
        let mut reader = CsvImportReader::new(self.text);
        let columns = ApplePasswordHeaders::new(reader.headers()?).admit()?;
        Ok(CheckedApplePasswordsCsv { reader, columns })
    }
}
/// Private admitted readers cannot be constructed by export consumers.
/// ```compile_fail,E0603
/// use nook_core::apple_passwords_import::records::CheckedApplePasswordsCsv;
/// ```
struct CheckedApplePasswordsCsv<'a> {
    reader: CsvImportReader<'a>,
    columns: ApplePasswordColumns,
}
impl CheckedApplePasswordsCsv<'_> {
    fn collect(self) -> Result<ApplePasswordsImportPlan, ApplePasswordsImportError> {
        let collection = self.reader.collect_fallible(CsvImportConversion {
            too_many_records: ApplePasswordsImportError::TooManyRecords,
            convert: |record: &StringRecord| self.columns.convert(record),
        })?;
        Ok(ApplePasswordsImportPlan {
            items: collection.items,
            source_count: collection.source_count.into(),
            skipped_unsupported: collection.skipped_unsupported.into(),
        })
    }
}
struct ApplePasswordHeaders {
    normalized: Vec<String>,
}
impl ApplePasswordHeaders {
    fn new(headers: &StringRecord) -> Self {
        Self {
            normalized: headers
                .iter()
                .map(|header| CsvHeader::new(header).normalized())
                .collect(),
        }
    }
    fn required(&self, name: &'static str) -> Result<usize, ApplePasswordsImportError> {
        self.normalized
            .iter()
            .position(|header| header == &CsvHeader::new(name).normalized())
            .ok_or(ApplePasswordsImportError::MissingColumn(name))
    }
    fn optional(&self, name: &str) -> Option<usize> {
        let expected = CsvHeader::new(name).normalized();
        self.normalized
            .iter()
            .position(|header| header == &expected)
    }
    fn admit(self) -> Result<ApplePasswordColumns, ApplePasswordsImportError> {
        Ok(ApplePasswordColumns {
            title: self.required("Title")?,
            url: self.required("URL")?,
            username: self.required("Username")?,
            password: self.required("Password")?,
            notes: self.optional("Notes"),
            otp_auth: self.optional("OTPAuth"),
        })
    }
}
struct ApplePasswordTitle<'a> {
    title: &'a str,
    website_url: &'a str,
}
impl ApplePasswordTitle<'_> {
    fn append_to(&self, notes: &mut String) {
        if let Some(entry) = (SourceLabelMetadata {
            key: "title",
            label: self.title,
            website_url: self.website_url,
        })
        .entry()
        {
            ImportMetadata {
                heading: "Apple Passwords",
                entries: [entry],
            }
            .append_to(notes);
        }
    }
}
impl ApplePasswordColumns {
    fn convert(
        &self,
        record: &StringRecord,
    ) -> Result<(Vec<SecretValue>, usize), ApplePasswordsImportError> {
        let csv_fields = CsvRecordFields::new(record);
        let title = csv_fields.trimmed(self.title);
        let url = csv_fields.trimmed(self.url);
        let username = csv_fields.trimmed(self.username);
        let password = csv_fields.password(self.password);
        let mut notes = csv_fields.optional(self.notes);
        let otp_auth = csv_fields.optional(self.otp_auth);

        if title.is_empty()
            && url.is_empty()
            && username.is_empty()
            && password.is_empty()
            && notes.is_empty()
            && otp_auth.is_empty()
        {
            return Ok((Vec::new(), 1));
        }

        let website_url = if url.is_empty() { title.clone() } else { url };
        ApplePasswordTitle {
            title: &title,
            website_url: &website_url,
        }
        .append_to(&mut notes);

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
                    if authenticator.website_url.trim().is_empty() && !website_url.trim().is_empty()
                    {
                        authenticator.website_url = website_url;
                    }
                    authenticator.apply_inferred_website_url_if_empty()?;
                    items.push(SecretValue::Authenticator(authenticator));
                }
                Err(ValidationError::AuthenticatorIssuerCatalogInvalid) => {
                    return Err(ApplePasswordsImportError::InvalidIssuerCatalog(
                        AuthenticatorIssuerHostsError::InvalidBundledCatalog,
                    ));
                }
                Err(_) => skipped_unsupported += 1,
            }
        }

        Ok((items, skipped_unsupported))
    }
}

#[cfg(test)]
mod tests {
    use super::{ApplePasswordsCsvInput, ApplePasswordsImportError, MAX_CSV_BYTES};
    use crate::SecretValue;

    #[test]
    fn checked_reader_keeps_reordered_schema_and_exact_password_bytes() -> anyhow::Result<()> {
        let csv = "Password,Username,URL,Title\n\"  sécret 🔑  \",alice,,Example\n";
        let checked = ApplePasswordsCsvInput::new(csv).check()?;
        assert_eq!(checked.columns.password, 0);
        let plan = checked.collect()?;
        let [SecretValue::Login(login)] = plan.items.as_slice() else {
            anyhow::bail!("expected login")
        };
        assert_eq!(login.password, "  sécret 🔑  ");
        Ok(())
    }

    #[test]
    fn required_column_order_and_duplicate_first_match_are_preserved() -> anyhow::Result<()> {
        for (csv, expected) in [
            ("Other\n", "Title"),
            ("Title\n", "URL"),
            ("Title,URL\n", "Username"),
            ("Title,URL,Username\n", "Password"),
        ] {
            match ApplePasswordsCsvInput::new(csv).plan() {
                Err(ApplePasswordsImportError::MissingColumn(column)) => {
                    assert_eq!(column, expected);
                }
                _ => anyhow::bail!("missing required column must reject"),
            }
        }
        let plan = ApplePasswordsCsvInput::new(
            "Title,URL,Username,Password,Password\nExample,,alice,first,second\n",
        )
        .plan()?;
        let [SecretValue::Login(login)] = plan.items.as_slice() else {
            anyhow::bail!("expected login")
        };
        assert_eq!(login.password, "first");
        Ok(())
    }

    #[test]
    fn csv_byte_and_record_limits_precede_schema_or_conversion() {
        let oversized = "x".repeat(MAX_CSV_BYTES + 1);
        assert!(matches!(
            ApplePasswordsCsvInput::new(&oversized).plan(),
            Err(ApplePasswordsImportError::CsvTooLarge)
        ));
        let rows = format!("Title,URL,Username,Password\n{}", ",,,\n".repeat(100_001));
        assert!(matches!(
            ApplePasswordsCsvInput::new(&rows).plan(),
            Err(ApplePasswordsImportError::TooManyRecords)
        ));
    }
}
