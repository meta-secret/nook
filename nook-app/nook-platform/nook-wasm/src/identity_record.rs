//! Typed WASM surface for the local identity directory.

use wasm_bindgen::prelude::wasm_bindgen;

use crate::storage::identity_record::{load_identity_directory, load_selected_identity};

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookIdentitySnapshotKind {
    Missing,
    Present,
}

#[derive(Clone)]
enum NookIdentitySnapshotLoadValue {
    Missing,
    Present(NookIdentitySnapshot),
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookIdentitySnapshot {
    identity_id: String,
    label: String,
    control_epoch: u64,
    app_id: String,
    app_key_count: u32,
    vault_count: u32,
    fingerprint: String,
}

impl NookIdentitySnapshot {
    pub(crate) fn from_record(record: &nook_core::IdentityRecord) -> Self {
        let app_id = record
            .members
            .first()
            .map(|member| member.app_id.as_str().to_owned())
            .unwrap_or_default();
        Self {
            identity_id: record.identity_id.as_str().to_owned(),
            label: record.label.clone(),
            control_epoch: record.control_epoch,
            app_id,
            app_key_count: u32::try_from(record.members.len()).unwrap_or(u32::MAX),
            vault_count: u32::try_from(record.vault_deks.len() + record.sentinel_vaults.len())
                .unwrap_or(u32::MAX),
            fingerprint: nook_core::identity_fingerprint(&record.identity_id),
        }
    }
}

#[wasm_bindgen]
impl NookIdentitySnapshot {
    #[wasm_bindgen(getter, js_name = identityId)]
    pub fn identity_id(&self) -> String {
        self.identity_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    #[wasm_bindgen(getter, js_name = controlEpoch)]
    pub fn control_epoch(&self) -> u64 {
        self.control_epoch
    }

    #[wasm_bindgen(getter, js_name = appId)]
    pub fn app_id(&self) -> String {
        self.app_id.clone()
    }

    #[wasm_bindgen(getter, js_name = appKeyCount)]
    pub fn app_key_count(&self) -> u32 {
        self.app_key_count
    }

    #[wasm_bindgen(getter, js_name = vaultCount)]
    pub fn vault_count(&self) -> u32 {
        self.vault_count
    }

    #[wasm_bindgen(getter)]
    pub fn fingerprint(&self) -> String {
        self.fingerprint.clone()
    }
}

#[wasm_bindgen]
pub struct NookIdentitySnapshotLoad(NookIdentitySnapshotLoadValue);

#[wasm_bindgen]
impl NookIdentitySnapshotLoad {
    #[wasm_bindgen(getter)]
    pub fn kind(&self) -> NookIdentitySnapshotKind {
        match self.0 {
            NookIdentitySnapshotLoadValue::Missing => NookIdentitySnapshotKind::Missing,
            NookIdentitySnapshotLoadValue::Present(_) => NookIdentitySnapshotKind::Present,
        }
    }

    pub fn snapshot(&self) -> Result<NookIdentitySnapshot, wasm_bindgen::JsError> {
        match &self.0 {
            NookIdentitySnapshotLoadValue::Missing => Err(wasm_bindgen::JsError::new(
                "Local identity snapshot is missing",
            )),
            NookIdentitySnapshotLoadValue::Present(snapshot) => Ok(snapshot.clone()),
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookIdentityDirectorySelectionKind {
    Empty,
    Selected,
}

enum NookIdentityDirectorySelection {
    Empty,
    Selected(String),
}

#[wasm_bindgen]
pub struct NookIdentityDirectorySnapshot {
    identities: Vec<NookIdentitySnapshot>,
    selection: NookIdentityDirectorySelection,
}

#[wasm_bindgen]
impl NookIdentityDirectorySnapshot {
    #[wasm_bindgen(getter)]
    pub fn length(&self) -> usize {
        self.identities.len()
    }

    pub fn identity(&self, index: usize) -> Result<NookIdentitySnapshot, wasm_bindgen::JsError> {
        self.identities
            .get(index)
            .cloned()
            .ok_or_else(|| wasm_bindgen::JsError::new("Identity index is out of bounds"))
    }

    #[wasm_bindgen(getter, js_name = selectionKind)]
    pub fn selection_kind(&self) -> NookIdentityDirectorySelectionKind {
        match self.selection {
            NookIdentityDirectorySelection::Empty => NookIdentityDirectorySelectionKind::Empty,
            NookIdentityDirectorySelection::Selected(_) => {
                NookIdentityDirectorySelectionKind::Selected
            }
        }
    }

    #[wasm_bindgen(getter, js_name = selectedIdentityId)]
    pub fn selected_identity_id(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.selection {
            NookIdentityDirectorySelection::Empty => Err(wasm_bindgen::JsError::new(
                "Identity directory has no selection",
            )),
            NookIdentityDirectorySelection::Selected(identity_id) => Ok(identity_id.clone()),
        }
    }
}

#[wasm_bindgen]
pub async fn load_identity_directory_snapshot()
-> Result<NookIdentityDirectorySnapshot, wasm_bindgen::JsError> {
    let directory = load_identity_directory()
        .await
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
    let selection = match directory.selection() {
        nook_core::IdentitySelection::Empty => NookIdentityDirectorySelection::Empty,
        nook_core::IdentitySelection::Selected(identity_id) => {
            NookIdentityDirectorySelection::Selected(identity_id.as_str().to_owned())
        }
    };
    Ok(NookIdentityDirectorySnapshot {
        identities: directory
            .identities()
            .iter()
            .map(NookIdentitySnapshot::from_record)
            .collect(),
        selection,
    })
}

#[wasm_bindgen]
pub async fn select_identity(identity_id: String) -> Result<(), wasm_bindgen::JsError> {
    let identity_id = nook_core::IdentityId::parse(&identity_id)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
    crate::storage::identity_record::update_identity_directory(move |directory| {
        directory
            .select(&identity_id)
            .map_err(|error| crate::NookError::Database(error.to_string()))
    })
    .await
    .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub async fn load_identity_snapshot() -> Result<NookIdentitySnapshotLoad, wasm_bindgen::JsError> {
    let Some(record) = load_selected_identity()
        .await
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?
    else {
        return Ok(NookIdentitySnapshotLoad(
            NookIdentitySnapshotLoadValue::Missing,
        ));
    };
    Ok(NookIdentitySnapshotLoad(
        NookIdentitySnapshotLoadValue::Present(NookIdentitySnapshot::from_record(&record)),
    ))
}
