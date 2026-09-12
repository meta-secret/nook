#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Bounded archive reads and format admission bound to the original ZIP.
use super::items::ExportData;
use super::{OnePasswordImportError, OnePasswordImportPlan};
use serde::Deserialize;
use std::io::{Cursor, Read};
use zip::{ZipArchive, result};
const SUPPORTED_1PUX_VERSION: u32 = 3;
pub(super) const MAX_ARCHIVE_BYTES: usize = 128 * 1024 * 1024;
const MAX_EXPORT_DATA_BYTES: u64 = 64 * 1024 * 1024;
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportAttributes {
    version: u32,
    description: String,
}

pub(super) struct OnePasswordArchive<'a> {
    archive: BoundedOnePasswordZip<'a>,
}
impl<'a> OnePasswordArchive<'a> {
    pub(super) fn open(bytes: &'a [u8]) -> Result<Self, OnePasswordImportError> {
        if bytes.len() > MAX_ARCHIVE_BYTES {
            return Err(OnePasswordImportError::ArchiveTooLarge);
        }
        Ok(Self {
            archive: BoundedOnePasswordZip {
                archive: ZipArchive::new(Cursor::new(bytes))
                    .map_err(OnePasswordImportError::archive)?,
            },
        })
    }
    pub(super) fn check(self) -> Result<CheckedOnePasswordArchive<'a>, OnePasswordImportError> {
        let read = self.archive.read(OnePasswordEntry::Attributes)?;
        let attributes_json = read.text;
        let attributes: ExportAttributes = serde_json::from_str(&attributes_json)
            .map_err(OnePasswordImportError::InvalidAttributes)?;
        if attributes.description != "1Password Unencrypted Export" {
            return Err(OnePasswordImportError::archive(
                "export.attributes has an unexpected description",
            ));
        }
        if attributes.version != SUPPORTED_1PUX_VERSION {
            return Err(OnePasswordImportError::UnsupportedVersion(
                attributes.version.into(),
            ));
        }
        Ok(CheckedOnePasswordArchive {
            archive: read.archive,
        })
    }
}
/// Consumers cannot construct an admitted archive or replace its ZIP.
/// ```compile_fail,E0603
/// use nook_core::onepassword_import::archive::CheckedOnePasswordArchive;
/// ```
pub(super) struct CheckedOnePasswordArchive<'a> {
    archive: BoundedOnePasswordZip<'a>,
}
impl CheckedOnePasswordArchive<'_> {
    pub(super) fn plan(self) -> Result<OnePasswordImportPlan, OnePasswordImportError> {
        let data = self.archive.read(OnePasswordEntry::Data)?;
        ExportData::parse(&data.text).map(ExportData::plan)
    }
}
enum OnePasswordEntry {
    Attributes,
    Data,
}
impl OnePasswordEntry {
    fn specification(self) -> (&'static str, u64) {
        match self {
            Self::Attributes => ("export.attributes", 64 * 1024),
            Self::Data => ("export.data", MAX_EXPORT_DATA_BYTES),
        }
    }
}
struct BoundedOnePasswordZip<'a> {
    archive: ZipArchive<Cursor<&'a [u8]>>,
}
struct ReadOnePasswordEntry<'a> {
    archive: BoundedOnePasswordZip<'a>,
    text: String,
}
impl<'a> BoundedOnePasswordZip<'a> {
    fn read(
        mut self,
        entry: OnePasswordEntry,
    ) -> Result<ReadOnePasswordEntry<'a>, OnePasswordImportError> {
        let (name, max_bytes) = entry.specification();
        let file = self.archive.by_name(name).map_err(|error| match error {
            result::ZipError::FileNotFound => OnePasswordImportError::MissingEntry(name),
            other => OnePasswordImportError::archive(other),
        })?;
        if file.size() > max_bytes {
            return Err(if name == "export.data" {
                OnePasswordImportError::ExportDataTooLarge
            } else {
                OnePasswordImportError::ArchiveTooLarge
            });
        }
        let mut text = String::new();
        file.take(max_bytes + 1)
            .read_to_string(&mut text)
            .map_err(OnePasswordImportError::archive)?;
        if u64::try_from(text.len()).unwrap_or(u64::MAX) > max_bytes {
            return Err(if name == "export.data" {
                OnePasswordImportError::ExportDataTooLarge
            } else {
                OnePasswordImportError::ArchiveTooLarge
            });
        }
        Ok(ReadOnePasswordEntry {
            archive: self,
            text,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::OnePasswordArchiveFixture;
    use super::{MAX_EXPORT_DATA_BYTES, OnePasswordArchive, OnePasswordImportError};

    #[test]
    fn admission_retains_original_archive_until_consuming_data_read() -> anyhow::Result<()> {
        let bytes = OnePasswordArchiveFixture {
            attributes: OnePasswordArchiveFixture::current_attributes(),
            data: "invalid data",
        }
        .build()?;
        let original = bytes.clone();
        let checked = OnePasswordArchive::open(&bytes)?.check()?;
        assert!(matches!(
            checked.plan(),
            Err(OnePasswordImportError::InvalidData(_))
        ));
        assert_eq!(bytes, original);
        Ok(())
    }

    #[test]
    fn dropping_admission_preserves_original_input() -> anyhow::Result<()> {
        let bytes = OnePasswordArchiveFixture {
            attributes: OnePasswordArchiveFixture::current_attributes(),
            data: r#"{"accounts":[]}"#,
        }
        .build()?;
        let original = bytes.clone();
        {
            let _checked = OnePasswordArchive::open(&bytes)?.check()?;
        }
        assert_eq!(bytes, original);
        assert!(
            OnePasswordArchive::open(&bytes)?
                .check()?
                .plan()?
                .items
                .is_empty()
        );
        Ok(())
    }

    #[test]
    fn description_rejection_precedes_version_and_data_errors() -> anyhow::Result<()> {
        let bytes = OnePasswordArchiveFixture {
            attributes: r#"{"version":4,"description":"wrong"}"#,
            data: "invalid data",
        }
        .build()?;
        match OnePasswordArchive::open(&bytes)?.check() {
            Err(OnePasswordImportError::InvalidArchive(message)) => {
                assert_eq!(message, "export.attributes has an unexpected description");
            }
            _ => anyhow::bail!("description must reject first"),
        }
        Ok(())
    }

    #[test]
    fn oversized_attributes_reject_before_json_parsing() -> anyhow::Result<()> {
        let attributes = "x".repeat(64 * 1024 + 1);
        let bytes = OnePasswordArchiveFixture {
            attributes: &attributes,
            data: "invalid data",
        }
        .build()?;
        assert!(matches!(
            OnePasswordArchive::open(&bytes)?.check(),
            Err(OnePasswordImportError::ArchiveTooLarge)
        ));
        Ok(())
    }

    #[test]
    fn oversized_data_is_rejected_only_after_attribute_admission() -> anyhow::Result<()> {
        let data = "x".repeat(usize::try_from(MAX_EXPORT_DATA_BYTES)? + 1);
        let bytes = OnePasswordArchiveFixture {
            attributes: OnePasswordArchiveFixture::current_attributes(),
            data: &data,
        }
        .build()?;
        let checked = OnePasswordArchive::open(&bytes)?.check()?;
        assert!(matches!(
            checked.plan(),
            Err(OnePasswordImportError::ExportDataTooLarge)
        ));
        Ok(())
    }
}
