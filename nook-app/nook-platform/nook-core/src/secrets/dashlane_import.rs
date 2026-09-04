//! Dashlane CSV / CSV-ZIP conversion into Nook's typed plaintext secret model.
//!
//! Accepts either a single Dashlane category CSV (`credentials`, secure notes,
//! or payments) or the unencrypted ZIP export that contains those files.

use std::{
    fmt,
    io::{Cursor, Read},
    str,
};

use csv::StringRecord;
use thiserror::Error;
use zip::ZipArchive;

use super::import_support::{
    self, MAX_CSV_BYTES, collect_csv_records, csv_field, csv_password_field, csv_reader,
    normalized_csv_header, optional_csv_field,
};
use crate::{AuthenticatorSecret, CreditCardSecret, LoginSecret, SecretValue, SecureNoteSecret};

const MAX_ARCHIVE_BYTES: usize = 128 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum DashlaneImportError {
    #[error("The Dashlane export is too large to import safely.")]
    ExportTooLarge,
    #[error("The Dashlane CSV export is too large to import safely.")]
    CsvTooLarge,
    #[error("The Dashlane CSV contains too many rows to import safely.")]
    TooManyRecords,
    #[error("This Dashlane archive does not contain a supported CSV export.")]
    MissingSupportedCsv,
    #[error("This is not a valid Dashlane ZIP archive: {0}")]
    InvalidArchive(String),
    #[error("This is not a Dashlane CSV export. The {0} column is missing.")]
    MissingColumn(&'static str),
    #[error("The Dashlane CSV is invalid: {0}")]
    InvalidCsv(#[from] csv::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DashlaneImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: usize,
    pub skipped_unsupported: usize,
}

#[derive(Clone, Copy)]
enum DashlaneCsvKind {
    Credentials,
    SecureNotes,
    Payments,
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

fn is_zip_export(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"PK\x05\x06")
        || bytes.starts_with(b"PK\x07\x08")
}

fn invalid_archive(error: impl fmt::Display) -> DashlaneImportError {
    DashlaneImportError::InvalidArchive(error.to_string())
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

fn normalized_basename(name: &str) -> String {
    normalized_csv_header(csv_entry_basename(name).trim_end_matches(".csv"))
}

fn classify_zip_csv(name: &str) -> Option<DashlaneCsvKind> {
    let base = normalized_basename(name);
    if base == "credentials" || base == "credential" {
        Some(DashlaneCsvKind::Credentials)
    } else if base == "securenotes" || base == "securenote" || base == "notes" {
        Some(DashlaneCsvKind::SecureNotes)
    } else if base == "payments" || base == "payment" {
        Some(DashlaneCsvKind::Payments)
    } else {
        None
    }
}

fn required_column(
    normalized: &[String],
    name: &'static str,
) -> Result<usize, DashlaneImportError> {
    let expected = normalized_csv_header(name);
    normalized
        .iter()
        .position(|header| header == &expected)
        .ok_or(DashlaneImportError::MissingColumn(name))
}

fn optional_column(normalized: &[String], names: &[&str]) -> Option<usize> {
    names.iter().find_map(|name| {
        let expected = normalized_csv_header(name);
        normalized.iter().position(|header| header == &expected)
    })
}

fn detect_csv_kind(headers: &StringRecord) -> Result<DashlaneCsvKind, DashlaneImportError> {
    let normalized = headers
        .iter()
        .map(normalized_csv_header)
        .collect::<Vec<_>>();
    if normalized.iter().any(|header| header == "username")
        && normalized.iter().any(|header| header == "password")
    {
        return Ok(DashlaneCsvKind::Credentials);
    }
    if normalized.first().is_some_and(|header| header == "title")
        && normalized.get(1).is_some_and(|header| header == "note")
        && !normalized.iter().any(|header| header == "username")
    {
        return Ok(DashlaneCsvKind::SecureNotes);
    }
    if normalized.first().is_some_and(|header| header == "type")
        && normalized
            .iter()
            .any(|header| header == "accountname" || header == "ccnumber")
    {
        return Ok(DashlaneCsvKind::Payments);
    }
    Err(DashlaneImportError::MissingColumn("username"))
}

fn credential_columns(headers: &StringRecord) -> Result<CredentialColumns, DashlaneImportError> {
    let normalized = headers
        .iter()
        .map(normalized_csv_header)
        .collect::<Vec<_>>();
    Ok(CredentialColumns {
        username: required_column(&normalized, "username")?,
        username2: optional_column(&normalized, &["username2"]),
        username3: optional_column(&normalized, &["username3"]),
        title: optional_column(&normalized, &["title", "name"]),
        password: required_column(&normalized, "password")?,
        note: optional_column(&normalized, &["note", "notes"]),
        url: optional_column(&normalized, &["url", "website"]),
        category: optional_column(&normalized, &["category", "folder"]),
        otp_secret: optional_column(&normalized, &["otpSecret", "otp_secret"]),
        otp_url: optional_column(&normalized, &["otpUrl", "otp_url"]),
    })
}

fn secure_note_columns(headers: &StringRecord) -> Result<SecureNoteColumns, DashlaneImportError> {
    let normalized = headers
        .iter()
        .map(normalized_csv_header)
        .collect::<Vec<_>>();
    Ok(SecureNoteColumns {
        title: required_column(&normalized, "title")?,
        note: required_column(&normalized, "note")?,
    })
}

fn payment_columns(headers: &StringRecord) -> Result<PaymentColumns, DashlaneImportError> {
    let normalized = headers
        .iter()
        .map(normalized_csv_header)
        .collect::<Vec<_>>();
    Ok(PaymentColumns {
        kind: required_column(&normalized, "type")?,
        account_name: optional_column(&normalized, &["account_name", "account name"]),
        account_holder: optional_column(&normalized, &["account_holder", "account holder"]),
        cc_number: optional_column(&normalized, &["cc_number", "cc number"]),
        code: optional_column(&normalized, &["code", "cvv"]),
        expiration_month: optional_column(&normalized, &["expiration_month", "expiration month"]),
        expiration_year: optional_column(&normalized, &["expiration_year", "expiration year"]),
    })
}

fn append_dashlane_metadata(
    notes: &mut String,
    metadata: impl IntoIterator<Item = (String, String)>,
) {
    import_support::append_import_metadata(notes, "Dashlane", metadata);
}

fn convert_credential_record(
    record: &StringRecord,
    columns: CredentialColumns,
) -> (Vec<SecretValue>, usize) {
    let username = csv_field(record, columns.username);
    let username2 = optional_csv_field(record, columns.username2);
    let username3 = optional_csv_field(record, columns.username3);
    let title = optional_csv_field(record, columns.title);
    let password = csv_password_field(record, columns.password);
    let mut notes = optional_csv_field(record, columns.note);
    let url = optional_csv_field(record, columns.url);
    let category = optional_csv_field(record, columns.category);
    let otp_secret = optional_csv_field(record, columns.otp_secret);
    let otp_url = optional_csv_field(record, columns.otp_url);

    if title.is_empty()
        && url.is_empty()
        && username.is_empty()
        && password.is_empty()
        && notes.is_empty()
        && otp_secret.is_empty()
        && otp_url.is_empty()
    {
        return (Vec::new(), 1);
    }

    let website_url = if url.is_empty() { title.clone() } else { url };

    let mut metadata = Vec::new();
    if let Some(entry) = import_support::source_label_metadata("title", &title, &website_url) {
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
    append_dashlane_metadata(&mut notes, metadata);

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

fn convert_secure_note_record(
    record: &StringRecord,
    columns: SecureNoteColumns,
) -> (Vec<SecretValue>, usize) {
    let title = csv_field(record, columns.title);
    let note = csv_field(record, columns.note);
    if title.is_empty() {
        return (Vec::new(), 1);
    }
    (
        vec![SecretValue::SecureNote(SecureNoteSecret { title, note })],
        0,
    )
}

fn convert_payment_record(
    record: &StringRecord,
    columns: PaymentColumns,
) -> (Vec<SecretValue>, usize) {
    let kind = csv_field(record, columns.kind);
    if kind.trim().eq_ignore_ascii_case("credit_card") {
        let account_name = optional_csv_field(record, columns.account_name);
        let account_holder = optional_csv_field(record, columns.account_holder);
        let number = optional_csv_field(record, columns.cc_number);
        let code = optional_csv_field(record, columns.code);
        let expiration_month = optional_csv_field(record, columns.expiration_month);
        let expiration_year = optional_csv_field(record, columns.expiration_year);
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
        match CreditCardSecret::from_fields(
            &title,
            &cardholder,
            &number,
            &expiration_month,
            &expiration_year,
            &code,
            "",
        ) {
            Ok(mut card) => {
                append_dashlane_metadata(&mut card.notes, [("type".to_owned(), kind)]);
                (vec![SecretValue::CreditCard(card)], 0)
            }
            Err(_) => (Vec::new(), 1),
        }
    } else {
        (Vec::new(), 1)
    }
}

fn plan_csv_text(csv_text: &str) -> Result<DashlaneImportPlan, DashlaneImportError> {
    if csv_text.len() > MAX_CSV_BYTES {
        return Err(DashlaneImportError::CsvTooLarge);
    }
    let mut reader = csv_reader(csv_text);
    let headers = reader.headers()?.clone();
    let kind = detect_csv_kind(&headers)?;
    let collection = match kind {
        DashlaneCsvKind::Credentials => {
            let columns = credential_columns(&headers)?;
            collect_csv_records(&mut reader, DashlaneImportError::TooManyRecords, |record| {
                convert_credential_record(record, columns)
            })?
        }
        DashlaneCsvKind::SecureNotes => {
            let columns = secure_note_columns(&headers)?;
            collect_csv_records(&mut reader, DashlaneImportError::TooManyRecords, |record| {
                convert_secure_note_record(record, columns)
            })?
        }
        DashlaneCsvKind::Payments => {
            let columns = payment_columns(&headers)?;
            collect_csv_records(&mut reader, DashlaneImportError::TooManyRecords, |record| {
                convert_payment_record(record, columns)
            })?
        }
    };
    Ok(DashlaneImportPlan {
        items: collection.items,
        source_count: collection.source_count,
        skipped_unsupported: collection.skipped_unsupported,
    })
}

fn read_zip_entry_text(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    index: usize,
) -> Result<String, DashlaneImportError> {
    let file = archive.by_index(index).map_err(invalid_archive)?;
    if file.size() > MAX_CSV_BYTES as u64 {
        return Err(DashlaneImportError::CsvTooLarge);
    }
    let mut csv = String::new();
    file.take(MAX_CSV_BYTES as u64 + 1)
        .read_to_string(&mut csv)
        .map_err(invalid_archive)?;
    if csv.len() > MAX_CSV_BYTES {
        return Err(DashlaneImportError::CsvTooLarge);
    }
    Ok(csv)
}

fn plan_zip_import(export_bytes: &[u8]) -> Result<DashlaneImportPlan, DashlaneImportError> {
    let mut archive = ZipArchive::new(Cursor::new(export_bytes)).map_err(invalid_archive)?;
    let mut selected = Vec::new();
    for index in 0..archive.len() {
        let name = archive
            .by_index(index)
            .map_err(invalid_archive)?
            .name()
            .to_owned();
        if !is_csv_entry(&name) {
            continue;
        }
        if let Some(kind) = classify_zip_csv(&name) {
            selected.push((kind, index));
        }
    }
    if selected.is_empty() {
        return Err(DashlaneImportError::MissingSupportedCsv);
    }

    let mut plan = DashlaneImportPlan {
        items: Vec::new(),
        source_count: 0,
        skipped_unsupported: 0,
    };
    for (kind, index) in selected {
        let csv = read_zip_entry_text(&mut archive, index)?;
        let mut reader = csv_reader(&csv);
        let headers = reader.headers()?.clone();
        let collection = match kind {
            DashlaneCsvKind::Credentials => {
                let columns = credential_columns(&headers)?;
                collect_csv_records(&mut reader, DashlaneImportError::TooManyRecords, |record| {
                    convert_credential_record(record, columns)
                })?
            }
            DashlaneCsvKind::SecureNotes => {
                let columns = secure_note_columns(&headers)?;
                collect_csv_records(&mut reader, DashlaneImportError::TooManyRecords, |record| {
                    convert_secure_note_record(record, columns)
                })?
            }
            DashlaneCsvKind::Payments => {
                let columns = payment_columns(&headers)?;
                collect_csv_records(&mut reader, DashlaneImportError::TooManyRecords, |record| {
                    convert_payment_record(record, columns)
                })?
            }
        };
        plan.items.extend(collection.items);
        plan.source_count += collection.source_count;
        plan.skipped_unsupported += collection.skipped_unsupported;
    }
    Ok(plan)
}

/// Parse a Dashlane CSV or CSV-ZIP export entirely in memory.
pub fn plan_dashlane_import(
    export_bytes: &[u8],
) -> Result<DashlaneImportPlan, DashlaneImportError> {
    if export_bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(DashlaneImportError::ExportTooLarge);
    }
    if is_zip_export(export_bytes) {
        return plan_zip_import(export_bytes);
    }
    let csv_text = str::from_utf8(export_bytes).map_err(|_| {
        DashlaneImportError::InvalidArchive(
            "expected UTF-8 CSV or a Dashlane CSV ZIP archive".to_owned(),
        )
    })?;
    plan_csv_text(csv_text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SecretValue;

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
    fn imports_credentials_notes_category_and_otp_secret() -> anyhow::Result<()> {
        let csv = concat!(
            "username,username2,username3,title,password,note,url,category,otpSecret\n",
            "alice,,,Example,secret,\"Recovery info\",https://example.com,Work,JBSWY3DPEHPK3PXP\n"
        );

        let plan = plan_dashlane_import(csv.as_bytes())?;
        assert_eq!(plan.source_count, 1);
        assert_eq!(plan.skipped_unsupported, 0);
        assert_eq!(plan.items.len(), 2);
        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login");
        };
        assert_eq!(login.username, "alice");
        assert_eq!(login.password, "secret");
        assert!(login.notes.contains("## Dashlane"));
        assert!(login.notes.contains("category: Work"));
        assert!(matches!(plan.items[1], SecretValue::Authenticator(_)));
        Ok(())
    }

    #[test]
    fn imports_secure_notes_and_credit_cards_from_zip() -> anyhow::Result<()> {
        let credentials = concat!(
            "username,title,password,note,url,category,otpUrl\n",
            "bob,GitHub,pass,,https://github.com,,\n"
        );
        let notes = "title,note\nPrivate,\"Keep offline\"\n";
        let payments = concat!(
            "type,account_name,account_holder,cc_number,code,expiration_month,expiration_year\n",
            "credit_card,Travel,Ada Lovelace,4111111111111111,123,12,2030\n",
            "bank,Checking,Ada,999,,,\n"
        );
        let zip = build_zip(&[
            ("credentials.csv", credentials.as_bytes()),
            ("securenotes.csv", notes.as_bytes()),
            ("payments.csv", payments.as_bytes()),
        ])?;

        let plan = plan_dashlane_import(&zip)?;
        assert_eq!(plan.source_count, 4);
        assert_eq!(plan.skipped_unsupported, 1);
        assert!(
            plan.items
                .iter()
                .any(|item| matches!(item, SecretValue::Login(_)))
        );
        assert!(
            plan.items
                .iter()
                .any(|item| matches!(item, SecretValue::SecureNote(_)))
        );
        assert!(
            plan.items
                .iter()
                .any(|item| matches!(item, SecretValue::CreditCard(_)))
        );
        Ok(())
    }

    #[test]
    fn rejects_unsupported_csv_and_oversized_exports() -> anyhow::Result<()> {
        assert!(matches!(
            plan_dashlane_import(b"name,login,secret\nExample,alice,password\n"),
            Err(DashlaneImportError::MissingColumn("username"))
        ));
        let missing = build_zip(&[("ids.csv", b"type,number,name\npassport,1,Ada\n")])?;
        assert!(matches!(
            plan_dashlane_import(&missing),
            Err(DashlaneImportError::MissingSupportedCsv)
        ));
        let oversized = vec![0_u8; MAX_ARCHIVE_BYTES + 1];
        assert!(matches!(
            plan_dashlane_import(&oversized),
            Err(DashlaneImportError::ExportTooLarge)
        ));
        Ok(())
    }
}
