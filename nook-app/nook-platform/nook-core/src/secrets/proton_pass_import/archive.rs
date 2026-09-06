#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Selected bounded data entry retains the exact borrowed ZIP file.
use super::ProtonPassImportError;
use std::io::{Cursor, Read};
use zip::{ZipArchive, read::ZipFile, result};
const MAX_EXPORT_DATA_BYTES: u64 = 64 * 1024 * 1024;
pub(super) const DATA_FILE: &str = "Proton Pass/data.json";
pub(super) struct ProtonPassArchive<'a> {
    archive: ZipArchive<Cursor<&'a [u8]>>,
}
impl<'a> ProtonPassArchive<'a> {
    pub(super) fn open(bytes: &'a [u8]) -> Result<Self, ProtonPassImportError> {
        Ok(Self {
            archive: ZipArchive::new(Cursor::new(bytes)).map_err(ProtonPassImportError::invalid)?,
        })
    }
    pub(super) fn select_data(
        &mut self,
    ) -> Result<SelectedProtonPassData<'_, 'a>, ProtonPassImportError> {
        let mut encrypted_data_found = false;
        for index in 0..self.archive.len() {
            let file = self
                .archive
                .by_index(index)
                .map_err(ProtonPassImportError::invalid)?;
            if file.name().ends_with("/data.pgp") || file.name() == "data.pgp" {
                encrypted_data_found = true;
            }
        }

        let file = match self.archive.by_name(DATA_FILE) {
            Ok(file) => file,
            Err(result::ZipError::FileNotFound) if encrypted_data_found => {
                return Err(ProtonPassImportError::EncryptedExport);
            }
            Err(result::ZipError::FileNotFound) => {
                return Err(ProtonPassImportError::MissingDataFile);
            }
            Err(error) => return Err(ProtonPassImportError::invalid(error)),
        };
        if file.size() > MAX_EXPORT_DATA_BYTES {
            return Err(ProtonPassImportError::ExportTooLarge);
        }
        Ok(SelectedProtonPassData { file })
    }
}
/// The selected entry is private and cannot be replaced by an unadmitted file.
/// ```compile_fail,E0603
/// use nook_core::proton_pass_import::archive::SelectedProtonPassData;
/// ```
pub(super) struct SelectedProtonPassData<'archive, 'bytes> {
    file: ZipFile<'archive, Cursor<&'bytes [u8]>>,
}
impl SelectedProtonPassData<'_, '_> {
    pub(super) fn read(self) -> Result<String, ProtonPassImportError> {
        let mut json = String::new();
        self.file
            .take(MAX_EXPORT_DATA_BYTES + 1)
            .read_to_string(&mut json)
            .map_err(ProtonPassImportError::invalid)?;
        if u64::try_from(json.len()).unwrap_or(u64::MAX) > MAX_EXPORT_DATA_BYTES {
            return Err(ProtonPassImportError::ExportTooLarge);
        }
        Ok(json)
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::ProtonPassZipFixture;
    use super::super::{ProtonPassImportError, ProtonPassImportInput};
    use super::{DATA_FILE, MAX_EXPORT_DATA_BYTES, ProtonPassArchive};
    use std::io::{Cursor, Write};
    use zip::{ZipWriter, write::SimpleFileOptions};

    #[test]
    fn plain_data_wins_over_encrypted_sibling_in_both_orders() -> anyhow::Result<()> {
        for names in [["data.pgp", DATA_FILE], [DATA_FILE, "nested/data.pgp"]] {
            let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
            for name in names {
                writer.start_file(name, SimpleFileOptions::default())?;
                writer.write_all(if name == DATA_FILE {
                    br#"{"vaults":{}}"#
                } else {
                    b"encrypted"
                })?;
            }
            let bytes = writer.finish()?.into_inner();
            assert!(
                ProtonPassImportInput::from_bytes(&bytes)
                    .plan()?
                    .items
                    .is_empty()
            );
        }
        Ok(())
    }

    #[test]
    fn selected_entry_reads_original_bytes_and_drop_leaves_archive_available() -> anyhow::Result<()>
    {
        let json = r#"{"vaults":{}}"#;
        let bytes = ProtonPassZipFixture {
            name: DATA_FILE,
            data: json.as_bytes(),
        }
        .build()?;
        let mut archive = ProtonPassArchive::open(&bytes)?;
        {
            let _selected = archive.select_data()?;
        }
        let selected = archive.select_data()?;
        assert_eq!(selected.read()?, json);
        Ok(())
    }

    #[test]
    fn invalid_utf8_selected_data_preserves_archive_error() -> anyhow::Result<()> {
        let bytes = ProtonPassZipFixture {
            name: DATA_FILE,
            data: &[0xff],
        }
        .build()?;
        assert!(matches!(
            ProtonPassImportInput::from_bytes(&bytes).plan(),
            Err(ProtonPassImportError::InvalidExport(_))
        ));
        Ok(())
    }

    #[test]
    fn encrypted_filename_detection_preserves_case_and_suffix_rules() -> anyhow::Result<()> {
        for (name, encrypted) in [
            ("data.pgp", true),
            ("nested/data.pgp", true),
            ("nested/DATA.PGP", false),
            ("otherdata.pgp", false),
        ] {
            let bytes = ProtonPassZipFixture {
                name,
                data: b"encrypted",
            }
            .build()?;
            match ProtonPassImportInput::from_bytes(&bytes).plan() {
                Err(ProtonPassImportError::EncryptedExport) => {
                    assert!(encrypted);
                }
                Err(ProtonPassImportError::MissingDataFile) => {
                    assert!(!encrypted);
                }
                _ => anyhow::bail!("missing data must retain filename classification"),
            }
        }
        Ok(())
    }

    #[test]
    fn zip_limit_does_not_reduce_plain_json_allowance() -> anyhow::Result<()> {
        let mut json = " ".repeat(usize::try_from(MAX_EXPORT_DATA_BYTES)?);
        json.push_str(r#"{"vaults":{}}"#);
        assert!(
            ProtonPassImportInput::from_bytes(json.as_bytes())
                .plan()?
                .items
                .is_empty()
        );
        let bytes = ProtonPassZipFixture {
            name: DATA_FILE,
            data: json.as_bytes(),
        }
        .build()?;
        assert!(matches!(
            ProtonPassImportInput::from_bytes(&bytes).plan(),
            Err(ProtonPassImportError::ExportTooLarge)
        ));
        Ok(())
    }
}
