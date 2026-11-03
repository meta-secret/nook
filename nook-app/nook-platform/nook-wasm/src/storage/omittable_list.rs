//! A provider list array whose reference does not promise that an empty
//! answer still carries it.

use serde::Deserialize;

/// Boundary conversion: a provider list array its reference does not promise; absence reads as no rows.
#[derive(Debug, Deserialize)]
#[serde(from = "Option<Vec<T>>")]
pub(super) struct OmittableList<T>(Vec<T>);

impl<T> From<Option<Vec<T>>> for OmittableList<T> {
    fn from(rows: Option<Vec<T>>) -> Self {
        match rows {
            Some(rows) => Self(rows),
            None => Self(Vec::new()),
        }
    }
}

impl<T> OmittableList<T> {
    /// The rows, taken once by the adapter that decoded the page.
    pub(super) fn into_rows(self) -> Vec<T> {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[derive(Debug, Deserialize)]
    struct Page {
        rows: OmittableList<u32>,
    }

    #[wasm_bindgen_test]
    fn a_missing_or_null_array_reads_as_no_rows_and_a_present_one_keeps_its_rows()
    -> anyhow::Result<()> {
        let missing: Page = serde_json::from_str("{}")?;
        assert!(missing.rows.into_rows().is_empty());
        let null: Page = serde_json::from_str(r#"{"rows":null}"#)?;
        assert!(null.rows.into_rows().is_empty());
        let present: Page = serde_json::from_str(r#"{"rows":[3,1,2]}"#)?;
        assert_eq!(present.rows.into_rows(), [3, 1, 2]);
        assert!(serde_json::from_str::<Page>(r#"{"rows":"not a list"}"#).is_err());
        Ok(())
    }
}
