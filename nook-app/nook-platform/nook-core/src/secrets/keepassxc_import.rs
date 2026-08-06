//! `KeePassXC` CSV conversion into Nook's typed plaintext secret model.

use csv::StringRecord;
use thiserror::Error;

use super::import_support::{
    MAX_CSV_BYTES, append_import_metadata, collect_csv_records, csv_field, csv_password_field,
    csv_reader, normalized_csv_header, optional_csv_field, source_label_metadata,
};
use crate::{AuthenticatorSecret, LoginSecret, SecretValue, SecureNoteSecret};

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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeePassXcImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: usize,
    pub skipped_unsupported: usize,
}

#[derive(Clone, Copy)]
struct KeePassXcColumns {
    group: usize,
    title: usize,
    username: usize,
    password: usize,
    url: usize,
    notes: usize,
    totp: Option<usize>,
}

fn required_column(
    normalized: &[String],
    name: &'static str,
) -> Result<usize, KeePassXcImportError> {
    normalized
        .iter()
        .position(|header| header == &normalized_csv_header(name))
        .ok_or(KeePassXcImportError::MissingColumn(name))
}

fn optional_column(normalized: &[String], name: &str) -> Option<usize> {
    let expected = normalized_csv_header(name);
    normalized.iter().position(|header| header == &expected)
}

fn columns(headers: &StringRecord) -> Result<KeePassXcColumns, KeePassXcImportError> {
    let normalized = headers
        .iter()
        .map(normalized_csv_header)
        .collect::<Vec<_>>();
    Ok(KeePassXcColumns {
        group: required_column(&normalized, "Group")?,
        title: required_column(&normalized, "Title")?,
        username: required_column(&normalized, "Username")?,
        password: required_column(&normalized, "Password")?,
        url: required_column(&normalized, "URL")?,
        notes: required_column(&normalized, "Notes")?,
        totp: optional_column(&normalized, "TOTP"),
    })
}

fn append_keepassxc_metadata(
    notes: &mut String,
    title: &str,
    website_url: &str,
    group: &str,
    totp: &str,
) {
    let mut metadata = Vec::new();
    if let Some(entry) = source_label_metadata("title", title, website_url) {
        metadata.push(entry);
    }
    if !group.trim().is_empty() {
        metadata.push(("group".to_owned(), group.trim().to_owned()));
    }
    if !totp.trim().is_empty() {
        metadata.push(("totp".to_owned(), totp.trim().to_owned()));
    }
    append_import_metadata(notes, "KeePassXC", metadata);
}

fn convert_totp(totp: &str, website_url: &str) -> (Option<SecretValue>, usize) {
    let totp = totp.trim();
    if totp.is_empty() || !totp.to_ascii_lowercase().starts_with("otpauth://") {
        return (None, 0);
    }
    match AuthenticatorSecret::from_otpauth_uri(totp) {
        Ok(mut authenticator) => {
            if authenticator.website_url.trim().is_empty() && !website_url.trim().is_empty() {
                website_url.clone_into(&mut authenticator.website_url);
            }
            authenticator.apply_inferred_website_url_if_empty();
            (Some(SecretValue::Authenticator(authenticator)), 0)
        }
        Err(_) => (None, 1),
    }
}

fn convert_record(record: &StringRecord, columns: KeePassXcColumns) -> (Vec<SecretValue>, usize) {
    let group = csv_field(record, columns.group);
    let title = csv_field(record, columns.title);
    let username = csv_field(record, columns.username);
    let password = csv_password_field(record, columns.password);
    let url = csv_field(record, columns.url);
    let mut notes = csv_field(record, columns.notes);
    let totp = optional_csv_field(record, columns.totp);

    if group.is_empty()
        && title.is_empty()
        && username.is_empty()
        && password.is_empty()
        && url.is_empty()
        && notes.is_empty()
        && totp.is_empty()
    {
        return (Vec::new(), 1);
    }

    let mut items = Vec::new();
    let mut skipped_unsupported = 0;
    let is_login = !password.is_empty() || !username.is_empty() || !url.is_empty();

    if is_login {
        let website_url = if url.is_empty() { title.clone() } else { url };
        let (authenticator, skipped_totp) = convert_totp(&totp, &website_url);
        skipped_unsupported += skipped_totp;
        let totp_for_notes = if authenticator.is_some() {
            ""
        } else {
            totp.as_str()
        };
        append_keepassxc_metadata(&mut notes, &title, &website_url, &group, totp_for_notes);
        items.push(SecretValue::Login(LoginSecret {
            website_url: website_url.clone(),
            username,
            password,
            notes,
        }));
        if let Some(authenticator) = authenticator {
            items.push(authenticator);
        }
        return (items, skipped_unsupported);
    }

    if title.is_empty() && notes.is_empty() {
        return (Vec::new(), 1);
    }

    let (authenticator, skipped_totp) = convert_totp(&totp, "");
    skipped_unsupported += skipped_totp;
    let totp_for_notes = if authenticator.is_some() {
        ""
    } else {
        totp.as_str()
    };
    append_keepassxc_metadata(&mut notes, "", "", &group, totp_for_notes);
    items.push(SecretValue::SecureNote(SecureNoteSecret {
        title,
        note: notes,
    }));
    if let Some(authenticator) = authenticator {
        items.push(authenticator);
    }
    (items, skipped_unsupported)
}

/// Parse a `KeePassXC` CSV export entirely in memory.
pub fn plan_keepassxc_import(csv_text: &str) -> Result<KeePassXcImportPlan, KeePassXcImportError> {
    if csv_text.len() > MAX_CSV_BYTES {
        return Err(KeePassXcImportError::CsvTooLarge);
    }

    let mut reader = csv_reader(csv_text);
    let columns = columns(reader.headers()?)?;
    let collection = collect_csv_records(
        &mut reader,
        KeePassXcImportError::TooManyRecords,
        |record| convert_record(record, columns),
    )?;

    Ok(KeePassXcImportPlan {
        items: collection.items,
        source_count: collection.source_count,
        skipped_unsupported: collection.skipped_unsupported,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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

        let plan = plan_keepassxc_import(csv)?;

        assert_eq!(plan.source_count, 2);
        assert_eq!(plan.skipped_unsupported, 0);
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

        let plan = plan_keepassxc_import(csv)?;

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

        let plan = plan_keepassxc_import(csv)?;

        assert_eq!(plan.source_count, 2);
        assert_eq!(plan.skipped_unsupported, 1);
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
            plan_keepassxc_import("url,username,password\nhttps://example.com,alice,secret\n"),
            Err(KeePassXcImportError::MissingColumn("Group"))
        ));
    }
}
