//! Shared bounded parsing and metadata helpers for password-manager imports.

use csv::{Reader, ReaderBuilder, StringRecord, Trim};

pub(crate) const MAX_CSV_BYTES: usize = 64 * 1024 * 1024;
const MAX_CSV_RECORDS: usize = 100_000;

pub(crate) struct CsvImportCollection<T> {
    pub(crate) items: Vec<T>,
    pub(crate) source_count: usize,
    pub(crate) skipped_unsupported: usize,
}

pub(crate) fn csv_reader(csv_text: &str) -> Reader<&[u8]> {
    ReaderBuilder::new()
        .flexible(true)
        .trim(Trim::Headers)
        .from_reader(csv_text.as_bytes())
}

pub(crate) fn collect_csv_records<T, E, F>(
    reader: &mut Reader<&[u8]>,
    too_many_records: E,
    mut convert: F,
) -> Result<CsvImportCollection<T>, E>
where
    E: From<csv::Error>,
    F: FnMut(&StringRecord) -> (Vec<T>, usize),
{
    let mut collection = CsvImportCollection {
        items: Vec::new(),
        source_count: 0,
        skipped_unsupported: 0,
    };
    for record in reader.records() {
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

pub(crate) fn normalized_csv_header(header: &str) -> String {
    header
        .trim_start_matches('\u{feff}')
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '_', '-'], "")
}

pub(crate) fn csv_field(record: &StringRecord, index: usize) -> String {
    record.get(index).unwrap_or_default().trim().to_owned()
}

pub(crate) fn csv_password_field(record: &StringRecord, index: usize) -> String {
    record.get(index).unwrap_or_default().to_owned()
}

pub(crate) fn optional_csv_field(record: &StringRecord, index: Option<usize>) -> String {
    index.map_or_else(String::new, |index| csv_field(record, index))
}

pub(crate) fn append_import_metadata(
    notes: &mut String,
    heading: &str,
    metadata: impl IntoIterator<Item = (String, String)>,
) {
    let metadata = metadata
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
    notes.push_str(heading);
    for (key, value) in metadata {
        notes.push_str("\n- ");
        notes.push_str(&key);
        notes.push_str(": ");
        notes.push_str(&value);
    }
}
