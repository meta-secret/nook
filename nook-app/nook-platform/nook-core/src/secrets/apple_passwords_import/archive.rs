#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Stable Safari CSV candidate ordering and bounded reads.
use super::super::import_support::MAX_CSV_BYTES;
use super::{ApplePasswordsCsvInput, ApplePasswordsImportError, ApplePasswordsImportPlan};
use std::{
    cmp::Ordering,
    io::{Cursor, Read},
};
use zeroize::Zeroizing;
use zip::ZipArchive;
pub(super) struct SafariArchive<'a> {
    archive: ZipArchive<Cursor<&'a [u8]>>,
}
impl<'a> SafariArchive<'a> {
    pub(super) fn open(bytes: &'a [u8]) -> Result<Self, ApplePasswordsImportError> {
        Ok(Self {
            archive: ZipArchive::new(Cursor::new(bytes))
                .map_err(ApplePasswordsImportError::archive)?,
        })
    }
    fn candidates(mut self) -> Result<SelectedSafariCandidates<'a>, ApplePasswordsImportError> {
        let mut candidates = Vec::new();
        for index in 0..self.archive.len() {
            let name = self
                .archive
                .by_index(index)
                .map_err(ApplePasswordsImportError::archive)?
                .name()
                .to_owned();
            let entry = SafariEntryName { name: &name };
            if entry.is_csv() {
                candidates.push(SafariCsvCandidate {
                    priority: entry.priority(),
                    name,
                    index,
                });
            }
        }
        candidates.sort_by(SafariCsvCandidate::compare);
        Ok(SelectedSafariCandidates {
            archive: self,
            candidates,
        })
    }
    pub(super) fn plan(self) -> Result<ApplePasswordsImportPlan, ApplePasswordsImportError> {
        let SelectedSafariCandidates {
            mut archive,
            candidates,
        } = self.candidates()?;
        let mut last_missing_column = None;
        for candidate in candidates {
            let read = archive.read(candidate)?;
            archive = read.archive;
            let csv = read.csv;
            match ApplePasswordsCsvInput::new(&csv).plan() {
                Ok(plan) => return Ok(plan),
                Err(ApplePasswordsImportError::MissingColumn(column)) => {
                    last_missing_column = Some(column);
                }
                Err(error) => return Err(error),
            }
        }
        if let Some(column) = last_missing_column {
            return Err(ApplePasswordsImportError::MissingColumn(column));
        }
        Err(ApplePasswordsImportError::MissingPasswordsFile)
    }
    fn read(
        mut self,
        candidate: SafariCsvCandidate,
    ) -> Result<ReadSafariCandidate<'a>, ApplePasswordsImportError> {
        let file = self
            .archive
            .by_index(candidate.index)
            .map_err(ApplePasswordsImportError::archive)?;
        if file.size() > MAX_CSV_BYTES as u64 {
            return Err(ApplePasswordsImportError::CsvTooLarge);
        }
        let mut csv = Zeroizing::new(String::new());
        file.take(MAX_CSV_BYTES as u64 + 1)
            .read_to_string(&mut csv)
            .map_err(ApplePasswordsImportError::archive)?;
        if csv.len() > MAX_CSV_BYTES {
            return Err(ApplePasswordsImportError::CsvTooLarge);
        }
        Ok(ReadSafariCandidate { archive: self, csv })
    }
}

struct SelectedSafariCandidates<'a> {
    archive: SafariArchive<'a>,
    candidates: Vec<SafariCsvCandidate>,
}
struct ReadSafariCandidate<'a> {
    archive: SafariArchive<'a>,
    csv: Zeroizing<String>,
}

#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum SafariCsvPriority {
    Passwords,
    Other,
}
struct SafariCsvCandidate {
    priority: SafariCsvPriority,
    name: String,
    index: usize,
}
impl SafariCsvCandidate {
    fn compare(&self, other: &Self) -> Ordering {
        self.priority.cmp(&other.priority).then_with(|| {
            self.name
                .to_ascii_lowercase()
                .cmp(&other.name.to_ascii_lowercase())
        })
    }
}
struct SafariEntryName<'a> {
    name: &'a str,
}
impl SafariEntryName<'_> {
    fn basename(&self) -> &str {
        self.name.rsplit(['/', '\\']).next().unwrap_or(self.name)
    }
    fn is_csv(&self) -> bool {
        !self.name.ends_with(['/', '\\'])
            && self
                .basename()
                .rsplit_once('.')
                .is_some_and(|(_, extension)| extension.eq_ignore_ascii_case("csv"))
    }
    fn priority(&self) -> SafariCsvPriority {
        if self.basename().eq_ignore_ascii_case("passwords.csv") {
            SafariCsvPriority::Passwords
        } else {
            SafariCsvPriority::Other
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::SafariZipFixture;
    use super::super::{ApplePasswordsExportInput, ApplePasswordsImportError};
    use super::{SafariArchive, SafariCsvPriority, SafariEntryName};
    use crate::SecretValue;

    #[test]
    fn candidates_keep_password_priority_and_stable_lowercase_name_ties() -> anyhow::Result<()> {
        let bytes = SafariZipFixture {
            entries: &[
                ("z.csv", b""),
                ("a.CSV", b""),
                ("A.csv", b""),
                ("nested/Passwords.CSV", b""),
                ("other.txt", b""),
            ],
        }
        .build()?;
        let archive = SafariArchive::open(&bytes)?;
        let names = archive
            .candidates()?
            .candidates
            .into_iter()
            .map(|candidate| candidate.name)
            .collect::<Vec<_>>();
        assert_eq!(names, ["nested/Passwords.CSV", "a.CSV", "A.csv", "z.csv"]);
        Ok(())
    }

    #[test]
    fn names_keep_both_separators_and_directory_exclusion() {
        for name in ["nested/Passwords.csv", "nested\\PASSWORDS.CSV"] {
            let entry = SafariEntryName { name };
            assert!(entry.is_csv());
            assert!(matches!(entry.priority(), SafariCsvPriority::Passwords));
        }
        for name in ["Passwords.csv/", "Passwords.csv\\", "Passwords.csv.txt"] {
            assert!(!(SafariEntryName { name }).is_csv());
        }
    }

    #[test]
    fn first_successful_empty_csv_stops_candidate_search() -> anyhow::Result<()> {
        let empty = b"Title,URL,Username,Password\n";
        let valid = b"Title,URL,Username,Password\nExample,,alice,secret\n";
        let bytes = SafariZipFixture {
            entries: &[("Passwords.csv", empty), ("other.csv", valid)],
        }
        .build()?;
        let plan = ApplePasswordsExportInput::from_bytes(&bytes).plan()?;
        assert!(plan.items.is_empty());
        assert_eq!(usize::from(plan.source_count), 0);
        Ok(())
    }

    #[test]
    fn missing_columns_continue_but_utf8_failure_stops_search() -> anyhow::Result<()> {
        let valid = b"Title,URL,Username,Password\nExample,,alice,secret\n";
        let bytes = SafariZipFixture {
            entries: &[("Passwords.csv", b"Other\n"), ("other.csv", valid)],
        }
        .build()?;
        let plan = ApplePasswordsExportInput::from_bytes(&bytes).plan()?;
        let [SecretValue::Login(login)] = plan.items.as_slice() else {
            anyhow::bail!("expected later candidate login")
        };
        assert_eq!(login.username, "alice");
        let bytes = SafariZipFixture {
            entries: &[("Passwords.csv", &[0xff]), ("other.csv", valid)],
        }
        .build()?;
        assert!(matches!(
            ApplePasswordsExportInput::from_bytes(&bytes).plan(),
            Err(ApplePasswordsImportError::InvalidArchive(_))
        ));
        Ok(())
    }

    #[test]
    fn final_missing_column_comes_from_last_sorted_candidate() -> anyhow::Result<()> {
        let bytes = SafariZipFixture {
            entries: &[("z.csv", b"Title,URL,Username\n"), ("a.csv", b"Title\n")],
        }
        .build()?;
        assert!(matches!(
            ApplePasswordsExportInput::from_bytes(&bytes).plan(),
            Err(ApplePasswordsImportError::MissingColumn("Password"))
        ));
        Ok(())
    }
}
