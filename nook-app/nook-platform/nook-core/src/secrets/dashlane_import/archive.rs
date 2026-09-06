#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Archive traversal and per-entry byte bounds for Dashlane exports.
use super::super::import_support::{CsvHeader, MAX_CSV_BYTES};
use super::rows::{DashlaneCsvInput, DashlaneCsvKind, DashlaneCsvSelection};
use super::{DashlaneImportError, DashlaneImportPlan};
use std::io::{Cursor, Read};
use zip::ZipArchive;
pub(super) struct DashlaneArchive<'a> {
    archive: ZipArchive<Cursor<&'a [u8]>>,
}
impl<'a> DashlaneArchive<'a> {
    pub(super) fn open(bytes: &'a [u8]) -> Result<Self, DashlaneImportError> {
        Ok(Self {
            archive: ZipArchive::new(Cursor::new(bytes)).map_err(DashlaneImportError::archive)?,
        })
    }
    pub(super) fn plan(mut self) -> Result<DashlaneImportPlan, DashlaneImportError> {
        let mut selected = Vec::new();
        for index in 0..self.archive.len() {
            let name = self
                .archive
                .by_index(index)
                .map_err(DashlaneImportError::archive)?
                .name()
                .to_owned();
            if !(DashlaneEntryName { name: &name }).is_csv() {
                continue;
            }
            if let Some(kind) = (DashlaneEntryName { name: &name }).kind() {
                selected.push((kind, index));
            }
        }
        if selected.is_empty() {
            return Err(DashlaneImportError::MissingSupportedCsv);
        }

        let mut plan = DashlaneImportPlan {
            items: Vec::new(),
            source_count: 0.into(),
            skipped_unsupported: 0.into(),
        };
        for (kind, index) in selected {
            let csv = self.read_entry(index)?;
            let collection = DashlaneCsvInput {
                text: &csv,
                selection: DashlaneCsvSelection::Archive(kind),
            }
            .check()?
            .collect()?;
            plan.items.extend(collection.items);
            plan.source_count =
                (usize::from(plan.source_count) + usize::from(collection.source_count)).into();
            plan.skipped_unsupported = (usize::from(plan.skipped_unsupported)
                + usize::from(collection.skipped_unsupported))
            .into();
        }
        Ok(plan)
    }
    fn read_entry(&mut self, index: usize) -> Result<String, DashlaneImportError> {
        let file = self
            .archive
            .by_index(index)
            .map_err(DashlaneImportError::archive)?;
        if file.size() > MAX_CSV_BYTES as u64 {
            return Err(DashlaneImportError::CsvTooLarge);
        }
        let mut csv = String::new();
        file.take(MAX_CSV_BYTES as u64 + 1)
            .read_to_string(&mut csv)
            .map_err(DashlaneImportError::archive)?;
        if csv.len() > MAX_CSV_BYTES {
            return Err(DashlaneImportError::CsvTooLarge);
        }
        Ok(csv)
    }
}
struct DashlaneEntryName<'a> {
    name: &'a str,
}
impl DashlaneEntryName<'_> {
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
    fn normalized(&self) -> String {
        CsvHeader::new(self.basename().trim_end_matches(".csv")).normalized()
    }
    fn kind(&self) -> Option<DashlaneCsvKind> {
        let base = self.normalized();
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
}
#[cfg(test)]
pub(super) mod tests {
    use super::super::DashlaneExport;
    use super::{DashlaneCsvKind, DashlaneEntryName, DashlaneImportError, MAX_CSV_BYTES};
    use crate::SecretValue;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};
    pub(in super::super) struct ZipFixtureEntry<'a> {
        pub(in super::super) name: &'a str,
        pub(in super::super) bytes: &'a [u8],
    }
    pub(in super::super) struct DashlaneZipFixture<'a> {
        pub(in super::super) entries: &'a [ZipFixtureEntry<'a>],
    }
    impl DashlaneZipFixture<'_> {
        pub(in super::super) fn build(self) -> anyhow::Result<Vec<u8>> {
            let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
            let options =
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
            for entry in self.entries {
                writer.start_file(entry.name, options)?;
                writer.write_all(entry.bytes)?;
            }
            Ok(writer.finish()?.into_inner())
        }
    }

    #[test]
    fn entry_names_preserve_basename_extension_and_category_rules() {
        for (name, csv, kind) in [
            (
                "nested/credentials.csv",
                true,
                Some(DashlaneCsvKind::Credentials),
            ),
            (
                "nested\\notes.csv",
                true,
                Some(DashlaneCsvKind::SecureNotes),
            ),
            ("PAYMENTS.csv", true, Some(DashlaneCsvKind::Payments)),
            ("credentials.CSV", true, None),
            ("credentials.csv/", false, None),
            ("credentials.txt", false, None),
            ("ids.csv", true, None),
        ] {
            let entry = DashlaneEntryName { name };
            assert_eq!(entry.is_csv(), csv);
            assert_eq!(entry.kind(), kind);
        }
    }

    #[test]
    fn duplicate_categories_preserve_archive_entry_order() -> anyhow::Result<()> {
        let zip = DashlaneZipFixture {
            entries: &[
                ZipFixtureEntry {
                    name: "first/credentials.csv",
                    bytes: b"username,password\nfirst,secret1\n",
                },
                ZipFixtureEntry {
                    name: "second/credentials.csv",
                    bytes: b"username,password\nsecond,secret2\n",
                },
                ZipFixtureEntry {
                    name: "ignored.csv",
                    bytes: b"not even a category header",
                },
            ],
        }
        .build()?;
        let plan = DashlaneExport::from_bytes(&zip).plan()?;
        assert_eq!(usize::from(plan.source_count), 2);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        let [SecretValue::Login(first), SecretValue::Login(second)] = plan.items.as_slice() else {
            anyhow::bail!("both credential entries must be retained")
        };
        assert_eq!(first.username, "first");
        assert_eq!(second.username, "second");
        Ok(())
    }

    #[test]
    fn archive_category_controls_admission_instead_of_header_inference() -> anyhow::Result<()> {
        let zip = DashlaneZipFixture {
            entries: &[ZipFixtureEntry {
                name: "notes.csv",
                bytes: b"username,password\nalice,secret\n",
            }],
        }
        .build()?;
        assert!(matches!(
            DashlaneExport::from_bytes(&zip).plan(),
            Err(DashlaneImportError::MissingColumn("title"))
        ));
        let malformed = DashlaneZipFixture {
            entries: &[ZipFixtureEntry {
                name: "credentials.csv",
                bytes: &[0xff],
            }],
        }
        .build()?;
        assert!(matches!(
            DashlaneExport::from_bytes(&malformed).plan(),
            Err(DashlaneImportError::InvalidArchive(_))
        ));
        Ok(())
    }

    #[test]
    fn oversized_selected_entry_is_rejected_before_csv_admission() -> anyhow::Result<()> {
        let bytes = vec![b'x'; MAX_CSV_BYTES + 1];
        let zip = DashlaneZipFixture {
            entries: &[ZipFixtureEntry {
                name: "credentials.csv",
                bytes: &bytes,
            }],
        }
        .build()?;
        assert!(matches!(
            DashlaneExport::from_bytes(&zip).plan(),
            Err(DashlaneImportError::CsvTooLarge)
        ));
        Ok(())
    }
}
