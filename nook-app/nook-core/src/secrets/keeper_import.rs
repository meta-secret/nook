//! Keeper Password Manager CSV conversion into Nook's typed plaintext model.

use csv::StringRecord;
use thiserror::Error;

use super::import_support::{
    MAX_CSV_BYTES, append_import_metadata, collect_csv_records, csv_field, csv_password_field,
    csv_reader, normalized_csv_header, optional_csv_field, source_label_metadata,
};
use crate::{LoginSecret, SecretValue, SecureNoteSecret};

#[derive(Debug, Error)]
pub enum KeeperImportError {
    #[error("The Keeper CSV export is too large to import safely.")]
    CsvTooLarge,
    #[error("The Keeper CSV export contains too many rows to import safely.")]
    TooManyRecords,
    #[error("This is not a Keeper CSV export. The {0} column is missing.")]
    MissingColumn(&'static str),
    #[error("The Keeper CSV export is invalid: {0}")]
    InvalidCsv(#[from] csv::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeeperImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: usize,
    pub skipped_unsupported: usize,
}

#[derive(Clone)]
struct KeeperColumns {
    folder: Option<usize>,
    title: usize,
    login: usize,
    password: usize,
    website: usize,
    notes: usize,
    shared_folder: Option<usize>,
    custom_fields: Vec<CustomFieldColumn>,
}

#[derive(Clone)]
enum CustomFieldColumn {
    Named {
        name: String,
        value_index: usize,
    },
    Paired {
        name_index: usize,
        value_index: usize,
    },
    Blob {
        index: usize,
    },
}

fn required_column(
    normalized: &[String],
    name: &'static str,
    aliases: &[&str],
) -> Result<usize, KeeperImportError> {
    std::iter::once(name)
        .chain(aliases.iter().copied())
        .find_map(|candidate| {
            let expected = normalized_csv_header(candidate);
            normalized.iter().position(|header| header == &expected)
        })
        .ok_or(KeeperImportError::MissingColumn(name))
}

fn optional_column(normalized: &[String], names: &[&str]) -> Option<usize> {
    names.iter().find_map(|name| {
        let expected = normalized_csv_header(name);
        normalized.iter().position(|header| header == &expected)
    })
}

fn parse_custom_field_pair_header(header: &str) -> Option<(usize, bool)> {
    let trimmed = header.trim();
    let lower = trimmed.to_ascii_lowercase();
    let rest = lower.strip_prefix("custom field")?;
    let rest = rest.trim_start();
    let (number, kind) = if let Some(rest) = rest.strip_suffix(" name") {
        (rest.trim(), false)
    } else if let Some(rest) = rest.strip_suffix(" value") {
        (rest.trim(), true)
    } else {
        return None;
    };
    let index = number.parse::<usize>().ok()?;
    if index == 0 {
        return None;
    }
    Some((index, kind))
}

fn columns(headers: &StringRecord) -> Result<KeeperColumns, KeeperImportError> {
    let normalized = headers
        .iter()
        .map(normalized_csv_header)
        .collect::<Vec<_>>();
    let folder = optional_column(&normalized, &["folder"]);
    let title = required_column(&normalized, "title", &["name"])?;
    let login = required_column(&normalized, "login", &["username", "user name"])?;
    let password = required_column(&normalized, "password", &[])?;
    let website = required_column(
        &normalized,
        "website address",
        &["login url", "url", "website", "website url"],
    )?;
    let notes = required_column(&normalized, "notes", &["note"])?;
    let shared_folder = optional_column(&normalized, &["shared folder", "sharedfolder"]);

    let known = [
        folder,
        Some(title),
        Some(login),
        Some(password),
        Some(website),
        Some(notes),
        shared_folder,
    ]
    .into_iter()
    .flatten()
    .collect::<std::collections::HashSet<_>>();

    let mut paired = std::collections::BTreeMap::<usize, (Option<usize>, Option<usize>)>::new();
    let mut named = Vec::new();
    let mut blob = None;
    let mut trailing = Vec::new();

    for (index, header) in headers.iter().enumerate() {
        if known.contains(&index) {
            continue;
        }
        let raw = header.trim_start_matches('\u{feff}').trim();
        if raw.is_empty() {
            continue;
        }
        if let Some((pair_index, is_value)) = parse_custom_field_pair_header(raw) {
            let entry = paired.entry(pair_index).or_insert((None, None));
            if is_value {
                entry.1 = Some(index);
            } else {
                entry.0 = Some(index);
            }
            continue;
        }
        let normalized_header = normalized_csv_header(raw);
        if normalized_header == "customfields" {
            blob = Some(index);
            continue;
        }
        if raw.starts_with('$') {
            named.push(CustomFieldColumn::Named {
                name: raw.to_owned(),
                value_index: index,
            });
            continue;
        }
        trailing.push(index);
    }

    let mut custom_fields = Vec::new();
    for (_, (name_index, value_index)) in paired {
        if let (Some(name_index), Some(value_index)) = (name_index, value_index) {
            custom_fields.push(CustomFieldColumn::Paired {
                name_index,
                value_index,
            });
        }
    }
    custom_fields.append(&mut named);
    if let Some(index) = blob {
        custom_fields.push(CustomFieldColumn::Blob { index });
    } else {
        for chunk in trailing.chunks(2) {
            match *chunk {
                [name_index, value_index] => {
                    custom_fields.push(CustomFieldColumn::Paired {
                        name_index,
                        value_index,
                    });
                }
                [index] => custom_fields.push(CustomFieldColumn::Blob { index }),
                _ => {}
            }
        }
    }

    Ok(KeeperColumns {
        folder,
        title,
        login,
        password,
        website,
        notes,
        shared_folder,
        custom_fields,
    })
}

fn collect_custom_fields(record: &StringRecord, columns: &KeeperColumns) -> Vec<(String, String)> {
    let mut fields = Vec::new();
    for column in &columns.custom_fields {
        match column {
            CustomFieldColumn::Named { name, value_index } => {
                let value = csv_field(record, *value_index);
                if !value.is_empty() {
                    fields.push((name.clone(), value));
                }
            }
            CustomFieldColumn::Paired {
                name_index,
                value_index,
            } => {
                let name = csv_field(record, *name_index);
                let value = csv_field(record, *value_index);
                if !name.is_empty() && !value.is_empty() {
                    fields.push((name, value));
                }
            }
            CustomFieldColumn::Blob { index } => {
                let blob = csv_field(record, *index);
                for line in blob.lines() {
                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }
                    if let Some((name, value)) = line.split_once(':') {
                        let name = name.trim();
                        let value = value.trim();
                        if !name.is_empty() && !value.is_empty() {
                            fields.push((name.to_owned(), value.to_owned()));
                        }
                    } else {
                        fields.push(("custom field".to_owned(), line.to_owned()));
                    }
                }
            }
        }
    }
    fields
}

fn append_keeper_metadata(
    notes: &mut String,
    title: &str,
    website_url: &str,
    folder: &str,
    shared_folder: &str,
    custom_fields: &[(String, String)],
) {
    let mut metadata = Vec::new();
    if let Some(entry) = source_label_metadata("title", title, website_url) {
        metadata.push(entry);
    }
    if !folder.trim().is_empty() {
        metadata.push(("folder".to_owned(), folder.trim().to_owned()));
    }
    if !shared_folder.trim().is_empty() {
        metadata.push(("shared folder".to_owned(), shared_folder.trim().to_owned()));
    }
    for (name, value) in custom_fields {
        let key = if name.starts_with('$') {
            format!("field.{name}")
        } else {
            format!("field.{}", name.trim())
        };
        metadata.push((key, value.clone()));
    }
    append_import_metadata(notes, "Keeper", metadata);
}

fn convert_record(record: &StringRecord, columns: &KeeperColumns) -> Option<SecretValue> {
    let title = csv_field(record, columns.title);
    let login = csv_field(record, columns.login);
    let password = csv_password_field(record, columns.password);
    let website = csv_field(record, columns.website);
    let mut notes = csv_field(record, columns.notes);
    let folder = optional_csv_field(record, columns.folder);
    let shared_folder = optional_csv_field(record, columns.shared_folder);
    let custom_fields = collect_custom_fields(record, columns);

    if title.is_empty()
        && login.is_empty()
        && password.trim().is_empty()
        && website.is_empty()
        && notes.is_empty()
        && folder.is_empty()
        && shared_folder.is_empty()
        && custom_fields.is_empty()
    {
        return None;
    }

    let looks_like_login = !login.is_empty() || !password.trim().is_empty() || !website.is_empty();
    if !looks_like_login {
        if title.is_empty() && notes.is_empty() && custom_fields.is_empty() {
            return None;
        }
        append_keeper_metadata(&mut notes, "", "", &folder, &shared_folder, &custom_fields);
        return Some(SecretValue::SecureNote(SecureNoteSecret {
            title: if title.is_empty() {
                "Keeper note".to_owned()
            } else {
                title
            },
            note: notes,
        }));
    }

    let website_url = if website.is_empty() {
        title.clone()
    } else {
        website
    };
    append_keeper_metadata(
        &mut notes,
        &title,
        &website_url,
        &folder,
        &shared_folder,
        &custom_fields,
    );
    Some(SecretValue::Login(LoginSecret {
        website_url,
        username: login,
        password,
        notes,
    }))
}

/// Parse a plaintext Keeper CSV vault export entirely in memory.
pub fn plan_keeper_import(csv_text: &str) -> Result<KeeperImportPlan, KeeperImportError> {
    if csv_text.len() > MAX_CSV_BYTES {
        return Err(KeeperImportError::CsvTooLarge);
    }

    let mut reader = csv_reader(csv_text);
    let columns = columns(reader.headers()?)?;
    let collection =
        collect_csv_records(&mut reader, KeeperImportError::TooManyRecords, |record| {
            match convert_record(record, &columns) {
                Some(item) => (vec![item], 0),
                None => (Vec::new(), 1),
            }
        })?;

    Ok(KeeperImportPlan {
        items: collection.items,
        source_count: collection.source_count,
        skipped_unsupported: collection.skipped_unsupported,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_logins_and_secure_notes_with_folder_and_custom_fields() -> anyhow::Result<()> {
        let csv = concat!(
            "Folder,Title,Login,Password,Website Address,Notes,Shared Folder,",
            "Custom Field1 Name,Custom Field1 Value,Custom Field2 Name,Custom Field2 Value\n",
            "Work\\Apps,GitHub,alice,secret,https://github.com/login,Recovery codes,,",
            "$oneTimeCode,otpauth://totp/GitHub?secret=ABC,$type,login\n",
            "Personal,Recovery,,,,\"# Offline note\",Team,,,,\n",
        );

        let plan = plan_keeper_import(csv)?;
        assert_eq!(plan.source_count, 2);
        assert_eq!(plan.skipped_unsupported, 0);
        assert_eq!(
            plan.items[0],
            SecretValue::Login(LoginSecret {
                website_url: "https://github.com/login".to_owned(),
                username: "alice".to_owned(),
                password: "secret".to_owned(),
                notes: concat!(
                    "Recovery codes\n\n## Keeper\n- title: GitHub\n- folder: Work\\Apps\n",
                    "- field.$oneTimeCode: otpauth://totp/GitHub?secret=ABC\n",
                    "- field.$type: login",
                )
                .to_owned(),
            })
        );
        assert_eq!(
            plan.items[1],
            SecretValue::SecureNote(SecureNoteSecret {
                title: "Recovery".to_owned(),
                note: "# Offline note\n\n## Keeper\n- folder: Personal\n- shared folder: Team"
                    .to_owned(),
            })
        );
        Ok(())
    }

    #[test]
    fn accepts_bom_aliases_dollar_headers_and_blank_rows() -> anyhow::Result<()> {
        let csv = concat!(
            "\u{feff}Title,Password,Login URL,Login,Notes,$type,$oneTimeCode\n",
            "Router,router-secret,,admin,Home gear,login,otpauth://totp/router?secret=ABC\n",
            ",,,,,,\n",
            "Wi-Fi memo,,,,Guest network details,general,\n",
        );

        let plan = plan_keeper_import(csv)?;
        assert_eq!(plan.source_count, 3);
        assert_eq!(plan.skipped_unsupported, 1);
        assert_eq!(plan.items.len(), 2);
        assert_eq!(
            plan.items[0],
            SecretValue::Login(LoginSecret {
                website_url: "Router".to_owned(),
                username: "admin".to_owned(),
                password: "router-secret".to_owned(),
                notes: concat!(
                    "Home gear\n\n## Keeper\n",
                    "- field.$type: login\n",
                    "- field.$oneTimeCode: otpauth://totp/router?secret=ABC",
                )
                .to_owned(),
            })
        );
        assert_eq!(
            plan.items[1],
            SecretValue::SecureNote(SecureNoteSecret {
                title: "Wi-Fi memo".to_owned(),
                note: "Guest network details\n\n## Keeper\n- field.$type: general".to_owned(),
            })
        );
        Ok(())
    }

    #[test]
    fn rejects_missing_columns_and_oversized_exports() {
        assert!(matches!(
            plan_keeper_import("Title,Login,Password\n"),
            Err(KeeperImportError::MissingColumn(_))
        ));
        let export = "x".repeat(MAX_CSV_BYTES + 1);
        assert!(matches!(
            plan_keeper_import(&export),
            Err(KeeperImportError::CsvTooLarge)
        ));
    }
}
