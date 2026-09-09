#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! CSV schema admission and conversion bound to the original reader.
use super::super::import_support::{
    CsvHeader, CsvImportConversion, CsvImportReader, CsvRecordFields, ImportMetadata,
    MAX_CSV_BYTES, SourceLabelMetadata,
};
use super::{DashlaneImportError, DashlaneImportPlan};
use crate::CreditCardFields;
use crate::{
    AuthenticatorIssuerHostsError, AuthenticatorSecret, CreditCardSecret, LoginSecret, SecretValue,
    SecureNoteSecret, ValidationError,
};
use csv::StringRecord;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DashlaneCsvKind {
    Credentials,
    SecureNotes,
    Payments,
}
pub(super) enum DashlaneCsvSelection {
    Detect,
    Archive(DashlaneCsvKind),
}
pub(super) struct DashlaneCsvInput<'a> {
    pub(super) text: &'a str,
    pub(super) selection: DashlaneCsvSelection,
}
impl<'a> DashlaneCsvInput<'a> {
    pub(super) fn check(self) -> Result<CheckedDashlaneCsv<'a>, DashlaneImportError> {
        if self.text.len() > MAX_CSV_BYTES {
            return Err(DashlaneImportError::CsvTooLarge);
        }
        let reader = CsvImportReader::new(self.text);
        let read = reader.headers()?;
        let reader = read.reader;
        let headers = read.headers;
        let headers = NormalizedDashlaneHeaders::from_record(&headers);
        let kind = match self.selection {
            DashlaneCsvSelection::Detect => headers.detect()?,
            DashlaneCsvSelection::Archive(kind) => kind,
        };
        let columns = match kind {
            DashlaneCsvKind::Credentials => {
                DashlaneColumns::Credentials(CredentialColumns::from_headers(&headers)?)
            }
            DashlaneCsvKind::SecureNotes => {
                DashlaneColumns::SecureNotes(SecureNoteColumns::from_headers(&headers)?)
            }
            DashlaneCsvKind::Payments => {
                DashlaneColumns::Payments(PaymentColumns::from_headers(&headers)?)
            }
        };
        Ok(CheckedDashlaneCsv { reader, columns })
    }
}
/// Reader and admitted columns cannot be replaced independently by consumers.
/// ```compile_fail,E0603
/// use nook_core::dashlane_import::rows::CheckedDashlaneCsv;
/// ```
pub(super) struct CheckedDashlaneCsv<'a> {
    reader: CsvImportReader<'a>,
    columns: DashlaneColumns,
}
impl CheckedDashlaneCsv<'_> {
    pub(super) fn collect(self) -> Result<DashlaneImportPlan, DashlaneImportError> {
        let collection = self.reader.collect_fallible(
            CsvImportConversion {
                too_many_records: DashlaneImportError::TooManyRecords,
                convert: |record: &StringRecord| self.columns.convert(record),
            },
            |items: Vec<SecretValue>| {
                for mut item in items {
                    item.zeroize_plaintext();
                }
            },
        )?;
        Ok(DashlaneImportPlan {
            items: collection.items,
            source_count: collection.source_count.into(),
            skipped_unsupported: collection.skipped_unsupported.into(),
        })
    }
}
enum DashlaneColumns {
    Credentials(CredentialColumns),
    SecureNotes(SecureNoteColumns),
    Payments(PaymentColumns),
}
impl DashlaneColumns {
    fn convert(
        &self,
        record: &StringRecord,
    ) -> Result<(Vec<SecretValue>, usize), DashlaneImportError> {
        match self {
            Self::Credentials(columns) => columns.convert(record),
            Self::SecureNotes(columns) => Ok(columns.convert(record)),
            Self::Payments(columns) => Ok(columns.convert(record)),
        }
    }
}
struct NormalizedDashlaneHeaders {
    values: Vec<String>,
}
impl NormalizedDashlaneHeaders {
    fn from_record(headers: &StringRecord) -> Self {
        Self {
            values: headers
                .iter()
                .map(|header| CsvHeader::new(header).normalized())
                .collect(),
        }
    }
    fn required(&self, name: &'static str) -> Result<usize, DashlaneImportError> {
        let expected = CsvHeader::new(name).normalized();
        self.values
            .iter()
            .position(|header| header == &expected)
            .ok_or(DashlaneImportError::MissingColumn(name))
    }
    fn optional(&self, names: &[&str]) -> Option<usize> {
        names.iter().find_map(|name| {
            let expected = CsvHeader::new(name).normalized();
            self.values.iter().position(|header| header == &expected)
        })
    }
    fn detect(&self) -> Result<DashlaneCsvKind, DashlaneImportError> {
        if self.values.iter().any(|header| header == "username")
            && self.values.iter().any(|header| header == "password")
        {
            return Ok(DashlaneCsvKind::Credentials);
        }
        if self.values.first().is_some_and(|header| header == "title")
            && self.values.get(1).is_some_and(|header| header == "note")
            && !self.values.iter().any(|header| header == "username")
        {
            return Ok(DashlaneCsvKind::SecureNotes);
        }
        if self.values.first().is_some_and(|header| header == "type")
            && self
                .values
                .iter()
                .any(|header| header == "accountname" || header == "ccnumber")
        {
            return Ok(DashlaneCsvKind::Payments);
        }
        Err(DashlaneImportError::MissingColumn("username"))
    }
}
#[derive(Clone, Copy)]
struct CredentialColumns {
    username: usize,
    username2: Option<usize>,
    username3: Option<usize>,
    title: Option<usize>,
    password: usize,
    note: Option<usize>,
    url: Option<usize>,
    category: Option<usize>,
    otp_secret: Option<usize>,
    otp_url: Option<usize>,
}

#[derive(Clone, Copy)]
struct SecureNoteColumns {
    title: usize,
    note: usize,
}

#[derive(Clone, Copy)]
struct PaymentColumns {
    kind: usize,
    account_name: Option<usize>,
    account_holder: Option<usize>,
    cc_number: Option<usize>,
    code: Option<usize>,
    expiration_month: Option<usize>,
    expiration_year: Option<usize>,
}

impl CredentialColumns {
    fn from_headers(headers: &NormalizedDashlaneHeaders) -> Result<Self, DashlaneImportError> {
        Ok(CredentialColumns {
            username: headers.required("username")?,
            username2: headers.optional(&["username2"]),
            username3: headers.optional(&["username3"]),
            title: headers.optional(&["title", "name"]),
            password: headers.required("password")?,
            note: headers.optional(&["note", "notes"]),
            url: headers.optional(&["url", "website"]),
            category: headers.optional(&["category", "folder"]),
            otp_secret: headers.optional(&["otpSecret", "otp_secret"]),
            otp_url: headers.optional(&["otpUrl", "otp_url"]),
        })
    }
    fn convert(
        &self,
        record: &StringRecord,
    ) -> Result<(Vec<SecretValue>, usize), DashlaneImportError> {
        let csv_fields = CsvRecordFields::new(record);
        let username = csv_fields.trimmed(self.username);
        let username2 = csv_fields.optional(self.username2);
        let username3 = csv_fields.optional(self.username3);
        let title = csv_fields.optional(self.title);
        let password = csv_fields.password(self.password);
        let mut notes = csv_fields.optional(self.note);
        let url = csv_fields.optional(self.url);
        let category = csv_fields.optional(self.category);
        let otp_secret = csv_fields.optional(self.otp_secret);
        let otp_url = csv_fields.optional(self.otp_url);

        if title.is_empty()
            && url.is_empty()
            && username.is_empty()
            && password.is_empty()
            && notes.is_empty()
            && otp_secret.is_empty()
            && otp_url.is_empty()
        {
            return Ok((Vec::new(), 1));
        }

        let website_url = if url.is_empty() { title.clone() } else { url };

        let mut metadata = Vec::new();
        if let Some(entry) = (SourceLabelMetadata {
            key: "title",
            label: &title,
            website_url: &website_url,
        })
        .entry()
        {
            metadata.push(entry);
        }
        if !category.trim().is_empty() {
            metadata.push(("category".to_owned(), category.trim().to_owned()));
        }
        if !username2.trim().is_empty() && username2.trim() != username.trim() {
            metadata.push(("username2".to_owned(), username2.trim().to_owned()));
        }
        if !username3.trim().is_empty() && username3.trim() != username.trim() {
            metadata.push(("username3".to_owned(), username3.trim().to_owned()));
        }
        DashlaneNotes { notes: &mut notes }.append(metadata);

        let mut items = Vec::new();
        let mut skipped_unsupported = 0;
        if password.is_empty() {
            skipped_unsupported += 1;
        } else {
            items.push(SecretValue::Login(LoginSecret {
                website_url: website_url.clone(),
                username: username.clone(),
                password,
                notes,
            }));
        }

        let otp_value = if otp_url.is_empty() {
            otp_secret
        } else {
            otp_url
        };
        if !otp_value.is_empty() {
            let authenticator = if otp_value.trim().starts_with("otpauth://") {
                AuthenticatorSecret::from_otpauth_uri(&otp_value)
            } else {
                AuthenticatorSecret::from_form_fields(
                    &title,
                    &username,
                    &otp_value,
                    "SHA1",
                    "6",
                    "30",
                    "",
                    &website_url,
                )
            };
            match authenticator {
                Ok(mut authenticator) => {
                    if authenticator.website_url.trim().is_empty() && !website_url.trim().is_empty()
                    {
                        authenticator.website_url = website_url;
                    }
                    let authenticator = match authenticator.apply_inferred_website_url_if_empty() {
                        Ok(authenticator) => authenticator,
                        Err(error) => {
                            for item in &mut items {
                                item.zeroize_plaintext();
                            }
                            return Err(error.into());
                        }
                    };
                    items.push(SecretValue::Authenticator(authenticator));
                }
                Err(ValidationError::AuthenticatorIssuerCatalogInvalid) => {
                    for item in &mut items {
                        item.zeroize_plaintext();
                    }
                    return Err(DashlaneImportError::InvalidIssuerCatalog(
                        AuthenticatorIssuerHostsError::InvalidBundledCatalog,
                    ));
                }
                Err(_) => skipped_unsupported += 1,
            }
        }

        Ok((items, skipped_unsupported))
    }
}
impl SecureNoteColumns {
    fn from_headers(headers: &NormalizedDashlaneHeaders) -> Result<Self, DashlaneImportError> {
        Ok(SecureNoteColumns {
            title: headers.required("title")?,
            note: headers.required("note")?,
        })
    }
    fn convert(&self, record: &StringRecord) -> (Vec<SecretValue>, usize) {
        let csv_fields = CsvRecordFields::new(record);
        let title = csv_fields.trimmed(self.title);
        let note = csv_fields.trimmed(self.note);
        if title.is_empty() {
            return (Vec::new(), 1);
        }
        (
            vec![SecretValue::SecureNote(SecureNoteSecret { title, note })],
            0,
        )
    }
}
impl PaymentColumns {
    fn from_headers(headers: &NormalizedDashlaneHeaders) -> Result<Self, DashlaneImportError> {
        Ok(PaymentColumns {
            kind: headers.required("type")?,
            account_name: headers.optional(&["account_name", "account name"]),
            account_holder: headers.optional(&["account_holder", "account holder"]),
            cc_number: headers.optional(&["cc_number", "cc number"]),
            code: headers.optional(&["code", "cvv"]),
            expiration_month: headers.optional(&["expiration_month", "expiration month"]),
            expiration_year: headers.optional(&["expiration_year", "expiration year"]),
        })
    }
    fn convert(&self, record: &StringRecord) -> (Vec<SecretValue>, usize) {
        let csv_fields = CsvRecordFields::new(record);
        let kind = csv_fields.trimmed(self.kind);
        if kind.trim().eq_ignore_ascii_case("credit_card") {
            let account_name = csv_fields.optional(self.account_name);
            let account_holder = csv_fields.optional(self.account_holder);
            let number = csv_fields.optional(self.cc_number);
            let code = csv_fields.optional(self.code);
            let expiration_month = csv_fields.optional(self.expiration_month);
            let expiration_year = csv_fields.optional(self.expiration_year);
            let title = if account_name.is_empty() {
                "Credit card".to_owned()
            } else {
                account_name.clone()
            };
            let cardholder = if account_holder.is_empty() {
                account_name
            } else {
                account_holder
            };
            match CreditCardSecret::from_fields(CreditCardFields {
                title: &title,
                cardholder_name: &cardholder,
                number: &number,
                expiration_month: &expiration_month,
                expiration_year: &expiration_year,
                cvv: &code,
                notes: "",
            }) {
                Ok(mut card) => {
                    DashlaneNotes {
                        notes: &mut card.notes,
                    }
                    .append([("type".to_owned(), kind)]);
                    (vec![SecretValue::CreditCard(card)], 0)
                }
                Err(_) => (Vec::new(), 1),
            }
        } else {
            (Vec::new(), 1)
        }
    }
}
struct DashlaneNotes<'a> {
    notes: &'a mut String,
}
impl DashlaneNotes<'_> {
    fn append(self, metadata: impl IntoIterator<Item = (String, String)>) {
        ImportMetadata {
            heading: "Dashlane",
            entries: metadata,
        }
        .append_to(self.notes);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        DashlaneColumns, DashlaneCsvInput, DashlaneCsvKind, DashlaneCsvSelection,
        DashlaneImportError,
    };
    use crate::SecretValue;

    #[test]
    fn checked_reader_keeps_reordered_columns_and_exact_password_bytes() -> anyhow::Result<()> {
        let text = "password,username,title,url,note\n\"  sécret 🔑  \", alice ,Example,https://example.com, notes \n";
        let checked = DashlaneCsvInput {
            text,
            selection: DashlaneCsvSelection::Detect,
        }
        .check()?;
        let DashlaneColumns::Credentials(columns) = &checked.columns else {
            anyhow::bail!("credentials must be admitted")
        };
        assert_eq!(columns.password, 0);
        assert_eq!(columns.username, 1);
        let plan = checked.collect()?;
        let [SecretValue::Login(login)] = plan.items.as_slice() else {
            anyhow::bail!("expected one login")
        };
        assert_eq!(login.password, "  sécret 🔑  ");
        assert_eq!(login.username, "alice");
        assert_eq!(login.notes, "notes\n\n## Dashlane\n- title: Example");
        Ok(())
    }

    #[test]
    fn header_precedence_and_required_columns_are_unchanged() -> anyhow::Result<()> {
        for (text, expected) in [
            (
                "title,note,username,password\n",
                DashlaneCsvKind::Credentials,
            ),
            ("title,note\n", DashlaneCsvKind::SecureNotes),
            ("type,account_name\n", DashlaneCsvKind::Payments),
        ] {
            let checked = DashlaneCsvInput {
                text,
                selection: DashlaneCsvSelection::Detect,
            }
            .check()?;
            assert!(matches!(
                (expected, &checked.columns),
                (
                    DashlaneCsvKind::Credentials,
                    DashlaneColumns::Credentials(_)
                ) | (
                    DashlaneCsvKind::SecureNotes,
                    DashlaneColumns::SecureNotes(_)
                ) | (DashlaneCsvKind::Payments, DashlaneColumns::Payments(_))
            ));
            assert_eq!(usize::from(checked.collect()?.source_count), 0);
        }
        for (text, category, missing) in [
            ("password\n", DashlaneCsvKind::Credentials, "username"),
            ("username\n", DashlaneCsvKind::Credentials, "password"),
            ("title\n", DashlaneCsvKind::SecureNotes, "note"),
            ("account_name\n", DashlaneCsvKind::Payments, "type"),
        ] {
            match (DashlaneCsvInput {
                text,
                selection: DashlaneCsvSelection::Archive(category),
            })
            .check()
            {
                Err(DashlaneImportError::MissingColumn(column)) => {
                    assert_eq!(column, missing);
                }
                _ => anyhow::bail!("category-specific required column must reject admission"),
            }
        }
        Ok(())
    }

    #[test]
    fn metadata_order_and_secondary_usernames_are_preserved() -> anyhow::Result<()> {
        let text = "username,username2,username3,title,password,note,url,category\nalice,bob,carol,Work Login,pw,original,https://example.com,Team\n";
        let plan = DashlaneCsvInput {
            text,
            selection: DashlaneCsvSelection::Detect,
        }
        .check()?
        .collect()?;
        let [SecretValue::Login(login)] = plan.items.as_slice() else {
            anyhow::bail!("expected login")
        };
        assert_eq!(
            login.notes,
            "original\n\n## Dashlane\n- title: Work Login\n- category: Team\n- username2: bob\n- username3: carol"
        );
        Ok(())
    }

    #[test]
    fn otp_url_precedence_and_missing_password_counts_are_preserved() -> anyhow::Result<()> {
        let text = "username,password,title,otpSecret,otpUrl\nalice,,Example,JBSWY3DPEHPK3PXP,0\nbob,,Example,JBSWY3DPEHPK3PXP,\n";
        let plan = DashlaneCsvInput {
            text,
            selection: DashlaneCsvSelection::Detect,
        }
        .check()?
        .collect()?;
        assert_eq!(usize::from(plan.source_count), 2);
        assert_eq!(usize::from(plan.skipped_unsupported), 3);
        assert!(matches!(
            plan.items.as_slice(),
            [SecretValue::Authenticator(_)]
        ));
        Ok(())
    }

    #[test]
    fn unsupported_payment_and_empty_note_rows_keep_skip_counts() -> anyhow::Result<()> {
        for (text, selection, skipped) in [
            (
                "type,account_name,cc_number\nbank,Checking,1\ncredit_card,Bad,invalid\n",
                DashlaneCsvSelection::Detect,
                2,
            ),
            ("title,note\n,content\n", DashlaneCsvSelection::Detect, 1),
        ] {
            let plan = DashlaneCsvInput { text, selection }.check()?.collect()?;
            assert_eq!(usize::from(plan.source_count), skipped);
            assert_eq!(usize::from(plan.skipped_unsupported), skipped);
            assert!(plan.items.is_empty());
        }
        Ok(())
    }

    #[test]
    fn collection_retains_the_per_csv_record_limit() -> anyhow::Result<()> {
        let text = format!("username,password\n{}", "alice,secret\n".repeat(100_001));
        let checked = DashlaneCsvInput {
            text: &text,
            selection: DashlaneCsvSelection::Detect,
        }
        .check()?;
        assert!(matches!(
            checked.collect(),
            Err(DashlaneImportError::TooManyRecords)
        ));
        Ok(())
    }
}
