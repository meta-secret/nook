//! Shared bounded parsing and metadata helpers for password-manager imports.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use csv::{Reader, ReaderBuilder, StringRecord, Trim};

pub(crate) const MAX_CSV_BYTES: usize = 64 * 1024 * 1024;
const MAX_CSV_RECORDS: usize = 100_000;

/// Number of source records inspected while preparing a secret import.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SecretImportSourceRecordCount(usize);

impl From<usize> for SecretImportSourceRecordCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<SecretImportSourceRecordCount> for usize {
    fn from(value: SecretImportSourceRecordCount) -> Self {
        value.0
    }
}

/// Number of unsupported source records skipped while preparing a secret import.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SecretImportUnsupportedRecordCount(usize);

impl From<usize> for SecretImportUnsupportedRecordCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<SecretImportUnsupportedRecordCount> for usize {
    fn from(value: SecretImportUnsupportedRecordCount) -> Self {
        value.0
    }
}

pub(crate) struct CsvImportCollection<T> {
    pub(crate) items: Vec<T>,
    pub(crate) source_count: usize,
    pub(crate) skipped_unsupported: usize,
}

/// Owns one configured CSV cursor. Format-specific checked states retain this
/// reader with the schema admitted from its headers until collection consumes it.
pub(crate) struct CsvImportReader<'a> {
    reader: Reader<&'a [u8]>,
}

pub(crate) struct CsvImportConversion<E, F> {
    pub(crate) too_many_records: E,
    pub(crate) convert: F,
}

impl<'a> CsvImportReader<'a> {
    pub(crate) fn new(text: &'a str) -> Self {
        Self {
            reader: ReaderBuilder::new()
                .flexible(true)
                .trim(Trim::Headers)
                .from_reader(text.as_bytes()),
        }
    }

    pub(crate) fn headers(&mut self) -> Result<&StringRecord, csv::Error> {
        self.reader.headers()
    }

    pub(crate) fn collect<T, E, F>(
        mut self,
        conversion: CsvImportConversion<E, F>,
    ) -> Result<CsvImportCollection<T>, E>
    where
        E: From<csv::Error>,
        F: FnMut(&StringRecord) -> (Vec<T>, usize),
    {
        let CsvImportConversion {
            too_many_records,
            mut convert,
        } = conversion;
        let mut collection = CsvImportCollection {
            items: Vec::new(),
            source_count: 0,
            skipped_unsupported: 0,
        };
        for record in self.reader.records() {
            if collection.source_count >= MAX_CSV_RECORDS {
                return Err(too_many_records);
            }
            let record = record?;
            collection.source_count += 1;
            let (mut converted, skipped) = convert(&record);
            collection.items.append(&mut converted);
            collection.skipped_unsupported += skipped;
        }
        Ok(collection)
    }

    pub(crate) fn collect_fallible<T, E, F, C>(
        mut self,
        conversion: CsvImportConversion<E, F>,
        cleanup: C,
    ) -> Result<CsvImportCollection<T>, E>
    where
        E: From<csv::Error>,
        F: FnMut(&StringRecord) -> Result<(Vec<T>, usize), E>,
        C: FnOnce(&mut Vec<T>),
    {
        let CsvImportConversion {
            too_many_records,
            mut convert,
        } = conversion;
        let mut collection = CsvImportCollection {
            items: Vec::new(),
            source_count: 0,
            skipped_unsupported: 0,
        };
        for record in self.reader.records() {
            if collection.source_count >= MAX_CSV_RECORDS {
                cleanup(&mut collection.items);
                return Err(too_many_records);
            }
            let record = match record {
                Ok(record) => record,
                Err(error) => {
                    cleanup(&mut collection.items);
                    return Err(error.into());
                }
            };
            collection.source_count += 1;
            let (mut converted, skipped) = match convert(&record) {
                Ok(converted) => converted,
                Err(error) => {
                    cleanup(&mut collection.items);
                    return Err(error);
                }
            };
            collection.items.append(&mut converted);
            collection.skipped_unsupported += skipped;
        }
        Ok(collection)
    }
}

pub(crate) struct CsvHeader<'a> {
    raw: &'a str,
}
impl<'a> CsvHeader<'a> {
    pub(crate) fn new(raw: &'a str) -> Self {
        Self { raw }
    }
    pub(crate) fn normalized(&self) -> String {
        self.raw
            .trim_start_matches('\u{feff}')
            .trim()
            .to_ascii_lowercase()
            .replace([' ', '_', '-'], "")
    }
}

pub(crate) struct CsvRecordFields<'a> {
    record: &'a StringRecord,
}
impl<'a> CsvRecordFields<'a> {
    pub(crate) fn new(record: &'a StringRecord) -> Self {
        Self { record }
    }
    pub(crate) fn trimmed(&self, index: usize) -> String {
        self.record.get(index).unwrap_or_default().trim().to_owned()
    }
    pub(crate) fn password(&self, index: usize) -> String {
        self.record.get(index).unwrap_or_default().to_owned()
    }
    pub(crate) fn optional(&self, index: Option<usize>) -> String {
        index.map_or_else(String::new, |index| self.trimmed(index))
    }
}

pub(crate) struct ImportMetadata<'a, I> {
    pub(crate) heading: &'a str,
    pub(crate) entries: I,
}
impl<I> ImportMetadata<'_, I>
where
    I: IntoIterator<Item = (String, String)>,
{
    pub(crate) fn append_to(self, notes: &mut String) {
        let metadata = self
            .entries
            .into_iter()
            .filter(|(_, value)| !value.trim().is_empty())
            .collect::<Vec<_>>();
        if metadata.is_empty() {
            return;
        }
        if !notes.is_empty() {
            notes.push_str("\n\n");
        }
        notes.push_str("## ");
        notes.push_str(self.heading);
        for (key, value) in metadata {
            notes.push_str("\n- ");
            notes.push_str(&key);
            notes.push_str(": ");
            notes.push_str(&value);
        }
    }
}

/// A source label becomes metadata only when it differs from the URL fallback.
pub(crate) struct SourceLabelMetadata<'a> {
    pub(crate) key: &'a str,
    pub(crate) label: &'a str,
    pub(crate) website_url: &'a str,
}
impl SourceLabelMetadata<'_> {
    pub(crate) fn entry(&self) -> Option<(String, String)> {
        let label = self.label.trim();
        let website_url = self.website_url.trim();
        if label.is_empty() || label == website_url {
            None
        } else {
            Some((self.key.to_owned(), label.to_owned()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CsvHeader, CsvImportConversion, CsvImportReader, CsvRecordFields, ImportMetadata,
        MAX_CSV_RECORDS, SourceLabelMetadata,
    };
    use csv::{ErrorKind, ReaderBuilder, StringRecord, Trim};
    use std::cell::Cell;
    use thiserror::Error;

    #[derive(Debug, Error)]
    enum CsvFixtureError {
        #[error("fixture record limit")]
        Limit,
        #[error("fixture CSV: {0}")]
        Csv(#[from] csv::Error),
    }

    struct CsvBytesFixture {
        bytes: Vec<u8>,
    }
    impl CsvBytesFixture {
        fn invalid_record_after(valid_records: usize) -> Self {
            let mut bytes = b"first,second\n".to_vec();
            for _ in 0..valid_records {
                bytes.extend_from_slice(b"value,other\n");
            }
            bytes.extend_from_slice(&[0xff, b',', b'\n']);
            Self { bytes }
        }

        fn reader(&self) -> CsvImportReader<'_> {
            CsvImportReader {
                reader: ReaderBuilder::new()
                    .flexible(true)
                    .trim(Trim::Headers)
                    .from_reader(self.bytes.as_slice()),
            }
        }
    }

    #[test]
    fn collection_retains_observed_headers_and_exact_record_bytes() -> anyhow::Result<()> {
        let mut reader = CsvImportReader::new(" Password ,Name\n\" 密碼 \nsecond line \", name \n");
        assert_eq!(
            reader.headers()?,
            &StringRecord::from(vec!["Password", "Name"])
        );
        let collection = reader.collect(CsvImportConversion {
            too_many_records: CsvFixtureError::Limit,
            convert: |record: &StringRecord| {
                let fields = CsvRecordFields::new(record);
                (vec![fields.password(0), fields.trimmed(1)], 0)
            },
        })?;
        assert_eq!(collection.items, vec![" 密碼 \nsecond line ", "name"]);
        assert_eq!(collection.source_count, 1);
        assert_eq!(collection.skipped_unsupported, 0);
        Ok(())
    }

    #[test]
    fn collection_keeps_empty_short_and_extra_records_flexible() -> anyhow::Result<()> {
        let reader = CsvImportReader::new("first,second\n,\nshort\nextra,row,ignored\n");
        let collection = reader.collect(CsvImportConversion {
            too_many_records: CsvFixtureError::Limit,
            convert: |record: &StringRecord| {
                let fields = CsvRecordFields::new(record);
                (vec![fields.password(0), fields.password(1)], 2)
            },
        })?;
        assert_eq!(collection.items, vec!["", "", "short", "", "extra", "row"]);
        assert_eq!(collection.source_count, 3);
        assert_eq!(collection.skipped_unsupported, 6);
        Ok(())
    }

    #[test]
    fn conversion_keeps_multiple_items_and_skip_counts_in_source_order() -> anyhow::Result<()> {
        let reader = CsvImportReader::new("kind,value\nskip,ignored\nkeep,first\nkeep,second\n");
        let collection = reader.collect(CsvImportConversion {
            too_many_records: CsvFixtureError::Limit,
            convert: |record: &StringRecord| {
                let fields = CsvRecordFields::new(record);
                if fields.trimmed(0) == "skip" {
                    (Vec::new(), 1)
                } else {
                    let value = fields.password(1);
                    (
                        vec![format!("login:{value}"), format!("authenticator:{value}")],
                        0,
                    )
                }
            },
        })?;
        assert_eq!(
            collection.items,
            vec![
                "login:first",
                "authenticator:first",
                "login:second",
                "authenticator:second"
            ]
        );
        assert_eq!(collection.source_count, 3);
        assert_eq!(collection.skipped_unsupported, 1);
        Ok(())
    }

    #[test]
    fn exact_record_limit_succeeds_and_next_record_is_not_converted() -> anyhow::Result<()> {
        let mut csv = format!("first,second\n{}", ",\n".repeat(MAX_CSV_RECORDS));
        let collection = CsvImportReader::new(&csv).collect(CsvImportConversion {
            too_many_records: CsvFixtureError::Limit,
            convert: |_: &StringRecord| (Vec::<String>::new(), 1),
        })?;
        assert_eq!(collection.source_count, MAX_CSV_RECORDS);
        assert_eq!(collection.skipped_unsupported, MAX_CSV_RECORDS);
        csv.push_str(",\n");
        let calls = Cell::new(0);
        let result = CsvImportReader::new(&csv).collect(CsvImportConversion {
            too_many_records: CsvFixtureError::Limit,
            convert: |_: &StringRecord| {
                calls.set(calls.get() + 1);
                (Vec::<String>::new(), 0)
            },
        });
        assert!(matches!(result, Err(CsvFixtureError::Limit)));
        assert_eq!(calls.get(), MAX_CSV_RECORDS);
        Ok(())
    }

    #[test]
    fn record_limit_precedes_the_next_csv_error() {
        let fixture = CsvBytesFixture::invalid_record_after(MAX_CSV_RECORDS);
        let calls = Cell::new(0);
        let result = fixture.reader().collect(CsvImportConversion {
            too_many_records: CsvFixtureError::Limit,
            convert: |_: &StringRecord| {
                calls.set(calls.get() + 1);
                (Vec::<String>::new(), 0)
            },
        });
        assert!(matches!(result, Err(CsvFixtureError::Limit)));
        assert_eq!(calls.get(), MAX_CSV_RECORDS);
    }

    #[test]
    fn csv_error_before_the_limit_stops_conversion() {
        let fixture = CsvBytesFixture::invalid_record_after(1);
        let calls = Cell::new(0);
        let result = fixture.reader().collect(CsvImportConversion {
            too_many_records: CsvFixtureError::Limit,
            convert: |_: &StringRecord| {
                calls.set(calls.get() + 1);
                (Vec::<String>::new(), 0)
            },
        });
        assert!(matches!(result, Err(CsvFixtureError::Csv(error))
            if matches!(error.kind(), ErrorKind::Utf8 { .. })));
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn empty_input_and_header_only_input_have_no_source_records() -> anyhow::Result<()> {
        for csv in ["", "first,second\n", "\nfirst,second\n\n"] {
            let collection = CsvImportReader::new(csv).collect(CsvImportConversion {
                too_many_records: CsvFixtureError::Limit,
                convert: |record: &StringRecord| (vec![record.clone()], 0),
            })?;
            assert!(collection.items.is_empty());
            assert_eq!(collection.source_count, 0);
            assert_eq!(collection.skipped_unsupported, 0);
        }
        Ok(())
    }

    #[test]
    fn normalization_preserves_the_existing_order_and_ascii_rules() {
        for (raw, expected) in [
            ("\u{feff}  User_Name- ", "username"),
            (" \u{feff} Name", "\u{feff}name"),
            ("ÄCCOUNT", "Äccount"),
            ("A\tB", "a\tb"),
            ("- _ ", ""),
        ] {
            assert_eq!(CsvHeader::new(raw).normalized(), expected);
        }
    }

    #[test]
    fn field_observations_separate_presentation_and_exact_passwords() {
        let record = StringRecord::from(vec!["  alice \r\n", " 密碼 \t", "   ", ""]);
        let fields = CsvRecordFields::new(&record);
        assert_eq!(fields.trimmed(0), "alice");
        assert_eq!(fields.password(1), " 密碼 \t");
        assert_eq!(fields.password(2), "   ");
        assert_eq!(fields.trimmed(2), "");
        assert_eq!(fields.password(3), "");
        assert_eq!(fields.password(9), "");
        assert_eq!(fields.trimmed(9), "");
        assert_eq!(fields.optional(Some(0)), "alice");
        assert_eq!(fields.optional(Some(9)), "");
        assert_eq!(fields.optional(None), "");
        assert_eq!(record.get(1), Some(" 密碼 \t"));
    }

    #[test]
    fn metadata_filters_empty_values_without_trimming_retained_entries() {
        let mut notes = " original \n".to_owned();
        ImportMetadata {
            heading: " Provider ",
            entries: [
                ("omit".to_owned(), " \t\n".to_owned()),
                (" first ".to_owned(), " value \nsecond ".to_owned()),
                ("second".to_owned(), "two".to_owned()),
            ],
        }
        .append_to(&mut notes);
        assert_eq!(
            notes,
            " original \n\n\n##  Provider \n-  first :  value \nsecond \n- second: two"
        );
    }

    #[test]
    fn empty_metadata_keeps_existing_notes_exactly() {
        for original in ["", " ", "note\n"] {
            let mut notes = original.to_owned();
            ImportMetadata {
                heading: "Unused",
                entries: [("key".to_owned(), " \r\n".to_owned())],
            }
            .append_to(&mut notes);
            assert_eq!(notes, original);
        }
    }

    #[test]
    fn metadata_preserves_duplicate_keys_and_appends_without_deduplication() {
        let mut notes = String::new();
        for _ in 0..2 {
            ImportMetadata {
                heading: "Provider",
                entries: [
                    ("key".to_owned(), "one".to_owned()),
                    ("key".to_owned(), "two".to_owned()),
                ],
            }
            .append_to(&mut notes);
        }
        assert_eq!(
            notes,
            "## Provider\n- key: one\n- key: two\n\n## Provider\n- key: one\n- key: two"
        );
    }

    #[test]
    fn source_label_comparison_is_trimmed_but_case_and_key_are_exact() {
        assert_eq!(
            (SourceLabelMetadata {
                key: " title ",
                label: " EXAMPLE ",
                website_url: "example",
            })
            .entry(),
            Some((" title ".to_owned(), "EXAMPLE".to_owned()))
        );
        assert_eq!(
            (SourceLabelMetadata {
                key: "title",
                label: " example ",
                website_url: " example\n",
            })
            .entry(),
            None
        );
    }

    #[test]
    fn source_label_metadata_keeps_distinct_titles() {
        assert_eq!(
            (SourceLabelMetadata {
                key: "name",
                label: " GitHub work ",
                website_url: "https://github.com"
            })
            .entry(),
            Some(("name".to_owned(), "GitHub work".to_owned()))
        );
        assert_eq!(
            (SourceLabelMetadata {
                key: "title",
                label: "https://example.com",
                website_url: "https://example.com"
            })
            .entry(),
            None
        );
        assert_eq!(
            (SourceLabelMetadata {
                key: "name",
                label: "   ",
                website_url: "https://example.com"
            })
            .entry(),
            None
        );
    }
}
