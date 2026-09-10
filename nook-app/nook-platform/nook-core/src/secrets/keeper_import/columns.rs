#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Keeper header aliases and ordered custom-field schema.
use super::super::import_support::CsvHeader;
use super::KeeperImportError;
use crate::secrets::import_support::CsvExportColumn;
use csv::StringRecord;
use std::{collections, iter};
#[derive(Clone)]
pub(super) struct KeeperColumns {
    pub(super) folder: CsvExportColumn,
    pub(super) title: usize,
    pub(super) login: usize,
    pub(super) password: usize,
    pub(super) website: usize,
    pub(super) notes: usize,
    pub(super) shared_folder: CsvExportColumn,
    pub(super) custom_fields: Vec<CustomFieldColumn>,
}

#[derive(Clone)]
pub(super) enum CustomFieldColumn {
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

pub(super) struct KeeperHeaders<'a> {
    record: &'a StringRecord,
    normalized: Vec<String>,
}
struct KeeperRequiredColumn<'a> {
    name: &'static str,
    aliases: &'a [&'a str],
}
impl<'a> KeeperHeaders<'a> {
    #[must_use]
    pub(super) fn new(record: &'a StringRecord) -> Self {
        Self {
            record,
            normalized: record
                .iter()
                .map(|header| CsvHeader::new(header).normalized())
                .collect(),
        }
    }
    fn required(&self, request: &KeeperRequiredColumn<'_>) -> Result<usize, KeeperImportError> {
        let name = request.name;
        let aliases = request.aliases;
        iter::once(name)
            .chain(aliases.iter().copied())
            .find_map(|candidate| {
                let expected = CsvHeader::new(candidate).normalized();
                self.normalized
                    .iter()
                    .position(|header| header == &expected)
            })
            .ok_or(KeeperImportError::MissingColumn(name))
    }
    fn optional(&self, names: &[&str]) -> CsvExportColumn {
        let column = names.iter().find_map(|name| {
            let expected = CsvHeader::new(name).normalized();
            self.normalized
                .iter()
                .position(|header| header == &expected)
        });
        match column {
            Some(index) => CsvExportColumn::Exported(index),
            None => CsvExportColumn::NotExported,
        }
    }
    pub(super) fn admit(self) -> Result<KeeperColumns, KeeperImportError> {
        let folder = self.optional(&["folder"]);
        let title = self.required(&KeeperRequiredColumn {
            name: "title",
            aliases: &["name"],
        })?;
        let login = self.required(&KeeperRequiredColumn {
            name: "login",
            aliases: &["username", "user name"],
        })?;
        let password = self.required(&KeeperRequiredColumn {
            name: "password",
            aliases: &[],
        })?;
        let website = self.required(&KeeperRequiredColumn {
            name: "website address",
            aliases: &["login url", "url", "website", "website url"],
        })?;
        let notes = self.required(&KeeperRequiredColumn {
            name: "notes",
            aliases: &["note"],
        })?;
        let shared_folder = self.optional(&["shared folder", "sharedfolder"]);

        let known = [
            folder,
            CsvExportColumn::Exported(title),
            CsvExportColumn::Exported(login),
            CsvExportColumn::Exported(password),
            CsvExportColumn::Exported(website),
            CsvExportColumn::Exported(notes),
            shared_folder,
        ]
        .into_iter()
        .filter_map(|column| match column {
            CsvExportColumn::Exported(index) => Some(index),
            CsvExportColumn::NotExported => None,
        })
        .collect::<collections::HashSet<_>>();

        Ok(KeeperColumns {
            folder,
            title,
            login,
            password,
            website,
            notes,
            shared_folder,
            custom_fields: self.custom_columns(&known),
        })
    }

    fn custom_columns(&self, known: &collections::HashSet<usize>) -> Vec<CustomFieldColumn> {
        let mut paired = collections::BTreeMap::<usize, KeeperCustomPairColumns>::new();
        let mut named = Vec::new();
        let mut blob = CsvExportColumn::NotExported;
        let mut trailing = Vec::new();

        for (index, header) in self.record.iter().enumerate() {
            if known.contains(&index) {
                continue;
            }
            let raw = header.trim_start_matches('\u{feff}').trim();
            if raw.is_empty() {
                continue;
            }
            if let Ok(pair) = KeeperCustomPairHeader::parse(raw) {
                let entry = paired.entry(pair.index).or_default();
                match pair.component {
                    KeeperCustomPairComponent::Name => {
                        entry.name = CsvExportColumn::Exported(index)
                    }
                    KeeperCustomPairComponent::Value => {
                        entry.value = CsvExportColumn::Exported(index)
                    }
                }
                continue;
            }
            let normalized_header = CsvHeader::new(raw).normalized();
            if normalized_header == "customfields" {
                blob = CsvExportColumn::Exported(index);
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
        for (_, pair) in paired {
            if let (CsvExportColumn::Exported(name_index), CsvExportColumn::Exported(value_index)) =
                (pair.name, pair.value)
            {
                custom_fields.push(CustomFieldColumn::Paired {
                    name_index,
                    value_index,
                });
            }
        }
        custom_fields.append(&mut named);
        if let CsvExportColumn::Exported(index) = blob {
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

        custom_fields
    }
}
#[derive(Default)]
struct KeeperCustomPairColumns {
    name: CsvExportColumn,
    value: CsvExportColumn,
}
enum KeeperCustomPairComponent {
    Name,
    Value,
}
struct KeeperCustomHeaderError;
struct KeeperCustomPairHeader {
    index: usize,
    component: KeeperCustomPairComponent,
}
impl KeeperCustomPairHeader {
    fn parse(header: &str) -> Result<Self, KeeperCustomHeaderError> {
        let trimmed = header.trim();
        let lower = trimmed.to_ascii_lowercase();
        let rest = lower
            .strip_prefix("custom field")
            .ok_or(KeeperCustomHeaderError)?;
        let rest = rest.trim_start();
        let (number, kind) = if let Some(rest) = rest.strip_suffix(" name") {
            (rest.trim(), KeeperCustomPairComponent::Name)
        } else {
            let rest = rest.strip_suffix(" value").ok_or(KeeperCustomHeaderError)?;
            (rest.trim(), KeeperCustomPairComponent::Value)
        };
        let index = number
            .parse::<usize>()
            .map_err(|_| KeeperCustomHeaderError)?;
        if index == 0 {
            return Err(KeeperCustomHeaderError);
        }
        Ok(Self {
            index,
            component: kind,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CustomFieldColumn, KeeperCustomPairComponent, KeeperCustomPairHeader, KeeperHeaders,
    };
    use csv::StringRecord;

    #[test]
    fn aliases_choose_primary_name_before_earlier_alias_columns() -> anyhow::Result<()> {
        let headers = StringRecord::from(vec![
            "Name",
            "Username",
            "Login URL",
            "Note",
            "Title",
            "Login",
            "Password",
            "Website Address",
            "Notes",
            "Title",
        ]);
        let columns = KeeperHeaders::new(&headers).admit()?;
        assert_eq!(columns.title, 4);
        assert_eq!(columns.login, 5);
        assert_eq!(columns.website, 7);
        assert_eq!(columns.notes, 8);
        Ok(())
    }

    #[test]
    fn paired_headers_keep_positive_index_and_component_rules() {
        for header in [
            "Custom Field0 Name",
            "Custom Field-1 Value",
            "Custom Field1 Other",
            "Field1 Name",
        ] {
            assert!(KeeperCustomPairHeader::parse(header).is_err());
        }
        let Ok(pair) = KeeperCustomPairHeader::parse("  CUSTOM FIELD 12 VALUE  ") else {
            panic!("expected value component")
        };
        assert_eq!(pair.index, 12);
        assert!(matches!(pair.component, KeeperCustomPairComponent::Value));
    }

    #[test]
    fn numbered_pairs_sort_and_duplicate_components_choose_last_column() -> anyhow::Result<()> {
        let headers = StringRecord::from(vec![
            "Title",
            "Login",
            "Password",
            "Website Address",
            "Notes",
            "Custom Field2 Name",
            "Custom Field2 Value",
            "Custom Field1 Name",
            "Custom Field1 Value",
            "Custom Field1 Name",
            "Custom Field3 Name",
            "$type",
        ]);
        let columns = KeeperHeaders::new(&headers).admit()?;
        assert!(matches!(
            columns.custom_fields.as_slice(),
            [
                CustomFieldColumn::Paired {
                    name_index: 9,
                    value_index: 8
                },
                CustomFieldColumn::Paired {
                    name_index: 5,
                    value_index: 6
                },
                CustomFieldColumn::Named {
                    value_index: 11,
                    ..
                }
            ]
        ));
        Ok(())
    }
}
