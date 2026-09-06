#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Keeper record classification and exact ordered metadata.
use super::super::import_support;
use super::columns::{CustomFieldColumn, KeeperColumns};
use crate::{LoginSecret, SecretValue, SecureNoteSecret};
use csv::StringRecord;
struct KeeperCustomFields<'a> {
    columns: &'a [CustomFieldColumn],
}
impl KeeperCustomFields<'_> {
    fn collect(&self, record: &StringRecord) -> Vec<(String, String)> {
        let mut fields = Vec::new();
        for column in self.columns {
            match column {
                CustomFieldColumn::Named { name, value_index } => {
                    let value = import_support::csv_field(record, *value_index);
                    if !value.is_empty() {
                        fields.push((name.clone(), value));
                    }
                }
                CustomFieldColumn::Paired {
                    name_index,
                    value_index,
                } => {
                    let name = import_support::csv_field(record, *name_index);
                    let value = import_support::csv_field(record, *value_index);
                    if !name.is_empty() && !value.is_empty() {
                        fields.push((name, value));
                    }
                }
                CustomFieldColumn::Blob { index } => {
                    let blob = import_support::csv_field(record, *index);
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
}
struct KeeperMetadata<'a> {
    title: &'a str,
    website_url: &'a str,
    folder: &'a str,
    shared_folder: &'a str,
    custom_fields: &'a [(String, String)],
}
impl KeeperMetadata<'_> {
    fn append_to(&self, notes: &mut String) {
        let Self {
            title,
            website_url,
            folder,
            shared_folder,
            custom_fields,
        } = self;
        let mut metadata = Vec::new();
        if let Some(entry) = import_support::source_label_metadata("title", title, website_url) {
            metadata.push(entry);
        }
        if !folder.trim().is_empty() {
            metadata.push(("folder".to_owned(), folder.trim().to_owned()));
        }
        if !shared_folder.trim().is_empty() {
            metadata.push(("shared folder".to_owned(), shared_folder.trim().to_owned()));
        }
        for (name, value) in *custom_fields {
            let key = if name.starts_with('$') {
                format!("field.{name}")
            } else {
                format!("field.{}", name.trim())
            };
            metadata.push((key, value.clone()));
        }
        import_support::append_import_metadata(notes, "Keeper", metadata);
    }
}
pub(super) struct KeeperRecord<'a> {
    pub(super) record: &'a StringRecord,
    pub(super) columns: &'a KeeperColumns,
}
impl KeeperRecord<'_> {
    pub(super) fn convert(self) -> Option<SecretValue> {
        let record = self.record;
        let columns = self.columns;
        let title = import_support::csv_field(record, columns.title);
        let login = import_support::csv_field(record, columns.login);
        let password = import_support::csv_password_field(record, columns.password);
        let website = import_support::csv_field(record, columns.website);
        let mut notes = import_support::csv_field(record, columns.notes);
        let folder = import_support::optional_csv_field(record, columns.folder);
        let shared_folder = import_support::optional_csv_field(record, columns.shared_folder);
        let custom_fields = KeeperCustomFields {
            columns: &columns.custom_fields,
        }
        .collect(record);

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

        let looks_like_login =
            !login.is_empty() || !password.trim().is_empty() || !website.is_empty();
        if !looks_like_login {
            if title.is_empty() && notes.is_empty() && custom_fields.is_empty() {
                return None;
            }
            KeeperMetadata {
                title: "",
                website_url: "",
                folder: &folder,
                shared_folder: &shared_folder,
                custom_fields: &custom_fields,
            }
            .append_to(&mut notes);
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
        KeeperMetadata {
            title: &title,
            website_url: &website_url,
            folder: &folder,
            shared_folder: &shared_folder,
            custom_fields: &custom_fields,
        }
        .append_to(&mut notes);
        Some(SecretValue::Login(LoginSecret {
            website_url,
            username: login,
            password,
            notes,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::super::KeeperCsvInput;
    use crate::SecretValue;

    #[test]
    fn explicit_blob_suppresses_trailing_fields_and_preserves_first_colon() -> anyhow::Result<()> {
        let csv = "Title,Login,Password,Website Address,Notes,Custom Fields,Trailing Name,Trailing Value\nExample,alice,pw,https://example.com,original,\"a: b:c\nloose\",ignored,value\n";
        let plan = KeeperCsvInput::new(csv).plan()?;
        let [SecretValue::Login(login)] = plan.items.as_slice() else {
            anyhow::bail!("expected login")
        };
        assert_eq!(
            login.notes,
            "original\n\n## Keeper\n- title: Example\n- field.a: b:c\n- field.custom field: loose"
        );
        Ok(())
    }

    #[test]
    fn named_fields_precede_trailing_pairs_and_final_blob() -> anyhow::Result<()> {
        let csv = "Title,Login,Password,Website Address,Notes,A,B,C,$kind\nExample,alice,pw,,base,pair,value,loose,named\n";
        let plan = KeeperCsvInput::new(csv).plan()?;
        let [SecretValue::Login(login)] = plan.items.as_slice() else {
            anyhow::bail!("expected login")
        };
        assert_eq!(
            login.notes,
            "base\n\n## Keeper\n- field.$kind: named\n- field.pair: value\n- field.custom field: loose"
        );
        Ok(())
    }

    #[test]
    fn whitespace_password_is_preserved_when_another_login_field_selects_login()
    -> anyhow::Result<()> {
        let csv =
            "Title,Login,Password,Website Address,Notes\nLogin,alice,   ,,\nNote,,   ,,memo\n";
        let plan = KeeperCsvInput::new(csv).plan()?;
        let [SecretValue::Login(login), SecretValue::SecureNote(note)] = plan.items.as_slice()
        else {
            anyhow::bail!("expected login then note")
        };
        assert_eq!(login.password, "   ");
        assert_eq!(note.title, "Note");
        assert_eq!(note.note, "memo");
        Ok(())
    }

    #[test]
    fn folder_only_is_skipped_and_custom_only_note_keeps_fallback_title() -> anyhow::Result<()> {
        let csv = "Title,Login,Password,Website Address,Notes,Folder,$custom\n,,,,,folder,\n,,,,,,value\n";
        let plan = KeeperCsvInput::new(csv).plan()?;
        assert_eq!(usize::from(plan.source_count), 2);
        assert_eq!(usize::from(plan.skipped_unsupported), 1);
        let [SecretValue::SecureNote(note)] = plan.items.as_slice() else {
            anyhow::bail!("expected note")
        };
        assert_eq!(note.title, "Keeper note");
        assert_eq!(note.note, "## Keeper\n- field.$custom: value");
        Ok(())
    }
}
