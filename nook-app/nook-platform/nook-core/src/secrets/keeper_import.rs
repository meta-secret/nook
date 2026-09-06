#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Keeper CSV schema admission into typed plaintext secrets.
mod columns;
mod records;
use super::import_support::{CsvImportConversion, CsvImportReader, MAX_CSV_BYTES};
use crate::SecretValue;
use columns::{KeeperColumns, KeeperHeaders};
use csv::StringRecord;
use records::KeeperRecord;
use thiserror::Error;
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
    pub source_count: crate::SecretImportSourceRecordCount,
    pub skipped_unsupported: crate::SecretImportUnsupportedRecordCount,
}

/// The CSV remains borrowed until its admitted reader is consumed.
/// ```
/// use nook_core::KeeperCsvInput;
/// let plan = KeeperCsvInput::new("Title,Login,Password,Website Address,Notes\n").plan()?;
/// assert!(plan.items.is_empty());
/// # Ok::<(), nook_core::KeeperImportError>(())
/// ```
/// ```compile_fail,E0502
/// use nook_core::KeeperCsvInput;
/// let mut csv = String::new();
/// let input = KeeperCsvInput::new(&csv);
/// csv.clear();
/// let _ = input.plan();
/// ```
/// ```compile_fail,E0599
/// use nook_core::KeeperCsvInput;
/// let input = KeeperCsvInput::new("");
/// let duplicate = input.clone();
/// ```
/// ```compile_fail,E0382
/// use nook_core::KeeperCsvInput;
/// let input = KeeperCsvInput::new("");
/// let _ = input.plan();
/// let _ = input.plan();
/// ```
pub struct KeeperCsvInput<'a> {
    text: &'a str,
}
impl<'a> KeeperCsvInput<'a> {
    #[must_use]
    pub fn new(text: &'a str) -> Self {
        Self { text }
    }
    pub fn plan(self) -> Result<KeeperImportPlan, KeeperImportError> {
        self.check()?.collect()
    }
    fn check(self) -> Result<CheckedKeeperCsv<'a>, KeeperImportError> {
        if self.text.len() > MAX_CSV_BYTES {
            return Err(KeeperImportError::CsvTooLarge);
        }
        let mut reader = CsvImportReader::new(self.text);
        let columns = KeeperHeaders::new(reader.headers()?).admit()?;
        Ok(CheckedKeeperCsv { reader, columns })
    }
}
/// Private fields bind schema to its original reader.
/// ```compile_fail,E0603
/// use nook_core::keeper_import::CheckedKeeperCsv;
/// ```
struct CheckedKeeperCsv<'a> {
    reader: CsvImportReader<'a>,
    columns: KeeperColumns,
}
impl CheckedKeeperCsv<'_> {
    fn collect(self) -> Result<KeeperImportPlan, KeeperImportError> {
        let collection = self.reader.collect(CsvImportConversion {
            too_many_records: KeeperImportError::TooManyRecords,
            convert: |record: &StringRecord| match (KeeperRecord {
                record,
                columns: &self.columns,
            })
            .convert()
            {
                Some(item) => (vec![item], 0),
                None => (Vec::new(), 1),
            },
        })?;
        Ok(KeeperImportPlan {
            items: collection.items,
            source_count: collection.source_count.into(),
            skipped_unsupported: collection.skipped_unsupported.into(),
        })
    }
}
#[cfg(test)]
mod tests {
    use super::{KeeperCsvInput, KeeperImportError, MAX_CSV_BYTES};
    use crate::{LoginSecret, SecretValue, SecureNoteSecret};

    #[test]
    fn checked_reader_keeps_original_schema_and_password_bytes() -> anyhow::Result<()> {
        let csv = "Password,Notes,Login,Title,Website Address\n\"  sécret 🔑  \",, alice ,Example,https://example.com\n";
        let checked = KeeperCsvInput::new(csv).check()?;
        assert_eq!(checked.columns.password, 0);
        assert_eq!(checked.columns.login, 2);
        let plan = checked.collect()?;
        let [SecretValue::Login(login)] = plan.items.as_slice() else {
            anyhow::bail!("expected login")
        };
        assert_eq!(login.password, "  sécret 🔑  ");
        assert_eq!(login.username, "alice");
        Ok(())
    }

    #[test]
    fn required_column_errors_keep_admission_order() {
        for (csv, missing) in [
            ("Other\n", "title"),
            ("Title\n", "login"),
            ("Title,Login\n", "password"),
            ("Title,Login,Password\n", "website address"),
            ("Title,Login,Password,Website Address\n", "notes"),
        ] {
            match KeeperCsvInput::new(csv).plan() {
                Err(KeeperImportError::MissingColumn(name)) => {
                    assert_eq!(name, missing);
                }
                _ => panic!("required column admission must reject"),
            }
        }
    }

    #[test]
    fn record_limit_counts_skipped_rows_before_next_record_conversion() {
        let csv = format!(
            "Title,Login,Password,Website Address,Notes\n{}",
            ",,,,\n".repeat(100_001)
        );
        assert!(matches!(
            KeeperCsvInput::new(&csv).plan(),
            Err(KeeperImportError::TooManyRecords)
        ));
    }

    #[test]
    fn imports_logins_and_secure_notes_with_folder_and_custom_fields() -> anyhow::Result<()> {
        let csv = concat!(
            "Folder,Title,Login,Password,Website Address,Notes,Shared Folder,",
            "Custom Field1 Name,Custom Field1 Value,Custom Field2 Name,Custom Field2 Value\n",
            "Work\\Apps,GitHub,alice,secret,https://github.com/login,Recovery codes,,",
            "$oneTimeCode,otpauth://totp/GitHub?secret=ABC,$type,login\n",
            "Personal,Recovery,,,,\"# Offline note\",Team,,,,\n",
        );

        let plan = KeeperCsvInput::new(csv).plan()?;
        assert_eq!(usize::from(plan.source_count), 2);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
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

        let plan = KeeperCsvInput::new(csv).plan()?;
        assert_eq!(usize::from(plan.source_count), 3);
        assert_eq!(usize::from(plan.skipped_unsupported), 1);
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
            KeeperCsvInput::new("Title,Login,Password\n").plan(),
            Err(KeeperImportError::MissingColumn(_))
        ));
        let export = "x".repeat(MAX_CSV_BYTES + 1);
        assert!(matches!(
            KeeperCsvInput::new(&export).plan(),
            Err(KeeperImportError::CsvTooLarge)
        ));
    }
}
