//! Portable classification of browser-collected extension persistence state.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

/// Extension persistence area inspected by smoke and migration checks.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtensionPersistenceArea {
    Pairing,
    EventLog,
    Provider,
}

impl Serialize for ExtensionPersistenceArea {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u32(*self as u32)
    }
}

impl<'de> Deserialize<'de> for ExtensionPersistenceArea {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        match u32::deserialize(deserializer)? {
            0 => Ok(Self::Pairing),
            1 => Ok(Self::EventLog),
            2 => Ok(Self::Provider),
            value => Err(serde::de::Error::custom(format!(
                "invalid extension persistence area: {value}"
            ))),
        }
    }
}

impl ExtensionPersistenceArea {
    #[must_use]
    pub const fn database_name(self) -> &'static str {
        match self {
            Self::Pairing => "nook_extension",
            Self::EventLog => "nook_db",
            Self::Provider => "nook_auth",
        }
    }

    #[must_use]
    pub fn store_names(self) -> Vec<String> {
        match self {
            Self::Pairing => vec!["pairing".to_owned()],
            Self::EventLog => vec![
                "vault".to_owned(),
                "events".to_owned(),
                "projections".to_owned(),
                "provider_receipts".to_owned(),
                "outbox".to_owned(),
            ],
            Self::Provider => vec!["auth".to_owned()],
        }
    }
}

/// Rust-owned decision for a required extension database.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtensionPersistenceDatabaseState {
    Absent,
    Present,
}

/// Rust-owned decision for the expected stores within an extension database.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtensionPersistenceStoreState {
    Absent,
    Present,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ExtensionPersistenceObservation {
    pub area: ExtensionPersistenceArea,
    pub observed_names: Vec<String>,
}

#[must_use]
pub fn classify_extension_database_names(
    area: ExtensionPersistenceArea,
    observed_names: &[String],
) -> ExtensionPersistenceDatabaseState {
    if observed_names
        .iter()
        .any(|name| name == area.database_name())
    {
        ExtensionPersistenceDatabaseState::Present
    } else {
        ExtensionPersistenceDatabaseState::Absent
    }
}

#[must_use]
pub fn classify_extension_store_names(
    area: ExtensionPersistenceArea,
    observed_names: &[String],
) -> ExtensionPersistenceStoreState {
    let expected = area.store_names();
    if expected
        .iter()
        .any(|name| observed_names.iter().any(|observed| observed == name))
    {
        ExtensionPersistenceStoreState::Present
    } else {
        ExtensionPersistenceStoreState::Absent
    }
}

#[must_use]
pub fn matching_extension_store_names(
    area: ExtensionPersistenceArea,
    observed_names: &[String],
) -> Vec<String> {
    area.store_names()
        .into_iter()
        .filter(|name| observed_names.iter().any(|observed| observed == name))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_required_database_from_browser_observations() {
        let observed = vec!["nook_db".to_owned(), "nook_auth".to_owned()];

        assert_eq!(
            classify_extension_database_names(ExtensionPersistenceArea::EventLog, &observed),
            ExtensionPersistenceDatabaseState::Present
        );
        assert_eq!(
            classify_extension_database_names(ExtensionPersistenceArea::Pairing, &observed),
            ExtensionPersistenceDatabaseState::Absent
        );
    }

    #[test]
    fn classifies_expected_store_from_browser_observations() {
        let observed = vec!["events".to_owned(), "other".to_owned()];

        assert_eq!(
            classify_extension_store_names(ExtensionPersistenceArea::EventLog, &observed),
            ExtensionPersistenceStoreState::Present
        );
        assert_eq!(
            classify_extension_store_names(ExtensionPersistenceArea::Pairing, &observed),
            ExtensionPersistenceStoreState::Absent
        );
        assert_eq!(
            matching_extension_store_names(ExtensionPersistenceArea::EventLog, &observed),
            vec!["events".to_owned()]
        );
    }

    #[test]
    fn persistence_area_owns_database_and_store_vocabulary() {
        assert_eq!(
            ExtensionPersistenceArea::Pairing.database_name(),
            "nook_extension"
        );
        assert_eq!(
            ExtensionPersistenceArea::Provider.store_names(),
            vec!["auth".to_owned()]
        );
    }

    #[test]
    fn persistence_area_uses_the_wasm_numeric_representation() -> anyhow::Result<()> {
        let serialized = serde_json::to_string(&ExtensionPersistenceArea::EventLog)?;
        assert_eq!(serialized, "1");

        let decoded = serde_json::from_str::<ExtensionPersistenceArea>("2")?;
        assert_eq!(decoded, ExtensionPersistenceArea::Provider);
        assert!(serde_json::from_str::<ExtensionPersistenceArea>("3").is_err());
        Ok(())
    }
}
