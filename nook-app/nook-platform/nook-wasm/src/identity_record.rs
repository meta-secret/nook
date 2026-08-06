//! WASM surface for the local Identity control record.

use wasm_bindgen::prelude::wasm_bindgen;

use crate::storage::identity_record::load_identity_record;

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
    vault_count: u32,
    fingerprint: String,
}

#[wasm_bindgen]
impl NookIdentitySnapshot {
    #[wasm_bindgen(getter, js_name = identityId)]
    #[must_use]
    pub fn identity_id(&self) -> String {
        self.identity_id.clone()
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    #[wasm_bindgen(getter, js_name = controlEpoch)]
    #[must_use]
    pub fn control_epoch(&self) -> u64 {
        self.control_epoch
    }

    #[wasm_bindgen(getter, js_name = appId)]
    #[must_use]
    pub fn app_id(&self) -> String {
        self.app_id.clone()
    }

    #[wasm_bindgen(getter, js_name = vaultCount)]
    #[must_use]
    pub fn vault_count(&self) -> u32 {
        self.vault_count
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn fingerprint(&self) -> String {
        self.fingerprint.clone()
    }
}

#[wasm_bindgen]
pub struct NookIdentitySnapshotLoad(NookIdentitySnapshotLoadValue);

#[wasm_bindgen]
impl NookIdentitySnapshotLoad {
    #[wasm_bindgen(getter)]
    #[must_use]
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

#[wasm_bindgen(js_name = loadIdentitySnapshot)]
pub async fn load_identity_snapshot() -> Result<NookIdentitySnapshotLoad, wasm_bindgen::JsError> {
    let Some(record) = load_identity_record()
        .await
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?
    else {
        return Ok(NookIdentitySnapshotLoad(
            NookIdentitySnapshotLoadValue::Missing,
        ));
    };
    let app_id = record
        .members
        .first()
        .map(|member| member.app_id.as_str().to_owned())
        .unwrap_or_default();
    Ok(NookIdentitySnapshotLoad(
        NookIdentitySnapshotLoadValue::Present(NookIdentitySnapshot {
            identity_id: record.identity_id.as_str().to_owned(),
            label: record.label.clone(),
            control_epoch: record.control_epoch,
            app_id,
            vault_count: u32::try_from(record.vault_deks.len()).unwrap_or(u32::MAX),
            fingerprint: nook_core::identity_fingerprint(&record.identity_id),
        }),
    ))
}
