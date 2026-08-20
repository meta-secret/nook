//! Typed WASM surface for the local identity directory.

use wasm_bindgen::prelude::wasm_bindgen;

use crate::storage::{
    identity_record::{load_identity_directory, load_selected_identity},
    indexed_db::load_wrapped_device_identity,
};

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookIdentitySnapshotKind {
    Missing,
    Present,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookIdentityMemberLabelKind {
    Unknown,
    Known,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookIdentityLocalAccessKind {
    CurrentBrowser,
    OtherInstallation,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookIdentityMemberSnapshot {
    app_id: String,
    label: Option<String>,
    current_browser: bool,
}

impl NookIdentityMemberSnapshot {
    fn from_member(member: &nook_core::IdentityMember, current_app_id: Option<&str>) -> Self {
        Self {
            app_id: member.app_id.as_str().to_owned(),
            label: member.label.clone(),
            current_browser: current_app_id.is_some_and(|app_id| member.app_id.as_str() == app_id),
        }
    }
}

#[wasm_bindgen]
impl NookIdentityMemberSnapshot {
    #[wasm_bindgen(getter, js_name = appId)]
    pub fn app_id(&self) -> String {
        self.app_id.clone()
    }

    #[wasm_bindgen(getter, js_name = currentBrowser)]
    pub fn current_browser(&self) -> bool {
        self.current_browser
    }

    #[wasm_bindgen(getter, js_name = labelKind)]
    pub fn label_kind(&self) -> NookIdentityMemberLabelKind {
        match self.label {
            Some(_) => NookIdentityMemberLabelKind::Known,
            None => NookIdentityMemberLabelKind::Unknown,
        }
    }

    pub fn label(&self) -> Result<String, wasm_bindgen::JsError> {
        self.label
            .clone()
            .ok_or_else(|| wasm_bindgen::JsError::new("Identity member label is unknown"))
    }
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
    members: Vec<NookIdentityMemberSnapshot>,
    vault_store_ids: Vec<String>,
    vaults: Vec<crate::device_access::NookDeviceVaultAccess>,
    app_key_count: u32,
    vault_count: u32,
    fingerprint: String,
    local_access: NookIdentityLocalAccessKind,
}

impl NookIdentitySnapshot {
    pub(crate) fn from_record(
        record: &nook_core::IdentityRecord,
        current_app_id: Option<&str>,
    ) -> Self {
        let current_app_id = current_app_id.and_then(|value| nook_core::AppId::parse(value).ok());
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
            members: record
                .members
                .iter()
                .map(|member| {
                    NookIdentityMemberSnapshot::from_member(
                        member,
                        current_app_id.as_ref().map(nook_core::AppId::as_str),
                    )
                })
                .collect(),
            vault_store_ids: record
                .vault_deks
                .iter()
                .map(|entry| entry.store_id.as_str().to_owned())
                .collect(),
            vaults: Vec::new(),
            app_key_count: u32::try_from(record.members.len()).unwrap_or(u32::MAX),
            vault_count: u32::try_from(record.vault_deks.len()).unwrap_or(u32::MAX),
            fingerprint: nook_core::identity_fingerprint(&record.identity_id),
            local_access: if current_app_id
                .as_ref()
                .is_some_and(|app_id| record.has_app_id(app_id))
            {
                NookIdentityLocalAccessKind::CurrentBrowser
            } else {
                NookIdentityLocalAccessKind::OtherInstallation
            },
        }
    }

    fn from_record_with_access(
        record: &nook_core::IdentityRecord,
        current_app_id: Option<&str>,
        access: &crate::device_access::NookDeviceAccessSnapshot,
    ) -> Self {
        let mut snapshot = Self::from_record(record, current_app_id);
        snapshot.vaults = access.vaults_for_identity(record);
        snapshot
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

    #[wasm_bindgen]
    pub fn members(&self) -> Vec<NookIdentityMemberSnapshot> {
        self.members.clone()
    }

    #[wasm_bindgen]
    pub fn vault_store_ids(&self) -> Vec<String> {
        self.vault_store_ids.clone()
    }

    #[wasm_bindgen]
    pub fn vaults(&self) -> Vec<crate::device_access::NookDeviceVaultAccess> {
        self.vaults.clone()
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

    #[wasm_bindgen(getter, js_name = localAccess)]
    pub fn local_access(&self) -> NookIdentityLocalAccessKind {
        self.local_access
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

fn directory_selection_for_session(
    persisted_selection: &nook_core::IdentitySelection,
    current_identity_id: Option<String>,
    allow_persisted_fallback: bool,
) -> NookIdentityDirectorySelection {
    if let Some(identity_id) = current_identity_id {
        return NookIdentityDirectorySelection::Selected(identity_id);
    }
    if !allow_persisted_fallback {
        return NookIdentityDirectorySelection::Empty;
    }
    match persisted_selection {
        nook_core::IdentitySelection::Empty => NookIdentityDirectorySelection::Empty,
        nook_core::IdentitySelection::Selected(identity_id) => {
            NookIdentityDirectorySelection::Selected(identity_id.as_str().to_owned())
        }
    }
}

#[wasm_bindgen]
pub struct NookIdentityDirectorySnapshot {
    identities: Vec<NookIdentitySnapshot>,
    selection: NookIdentityDirectorySelection,
}

#[wasm_bindgen]
pub struct NookIdentityDirectorySnapshotRequest {
    session_app_id: String,
}

impl NookIdentityDirectorySnapshotRequest {
    pub(crate) fn new(session_app_id: String) -> Self {
        Self { session_app_id }
    }
}

#[wasm_bindgen]
impl NookIdentityDirectorySnapshotRequest {
    pub async fn resolve(&self) -> Result<NookIdentityDirectorySnapshot, wasm_bindgen::JsError> {
        identity_directory_snapshot_for_session(&self.session_app_id).await
    }
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

async fn identity_directory_snapshot_for_session(
    session_app_id: &str,
) -> Result<NookIdentityDirectorySnapshot, wasm_bindgen::JsError> {
    let protected = load_wrapped_device_identity()
        .await
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
    let protected_app_id = protected.as_ref().map(|(app_id, _)| app_id.clone());
    let session_app_id = session_app_id.trim();
    let current_app_id = if session_app_id.is_empty() {
        protected_app_id
    } else {
        Some(session_app_id.to_owned())
    };
    let directory = load_identity_directory()
        .await
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
    let access = crate::device_access::device_access_snapshot_for_session_with_protected(
        session_app_id,
        !session_app_id.is_empty(),
        protected,
    )
    .await?;
    let current_identity_id = current_app_id.as_deref().and_then(|app_id| {
        directory.identities().iter().find_map(|record| {
            record
                .members
                .iter()
                .any(|member| member.app_id.as_str() == app_id)
                .then(|| record.identity_id.as_str().to_owned())
        })
    });
    let selection = directory_selection_for_session(
        directory.selection(),
        current_identity_id,
        session_app_id.is_empty(),
    );
    Ok(NookIdentityDirectorySnapshot {
        identities: directory
            .identities()
            .iter()
            .map(|record| {
                NookIdentitySnapshot::from_record_with_access(
                    record,
                    current_app_id.as_deref(),
                    &access,
                )
            })
            .collect(),
        selection,
    })
}

#[wasm_bindgen]
pub async fn load_identity_directory_snapshot()
-> Result<NookIdentityDirectorySnapshot, wasm_bindgen::JsError> {
    identity_directory_snapshot_for_session("").await
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
    let current_app_id = load_wrapped_device_identity()
        .await
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?
        .map(|(app_id, _)| app_id);
    let Some(record) = load_selected_identity()
        .await
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?
    else {
        return Ok(NookIdentitySnapshotLoad(
            NookIdentitySnapshotLoadValue::Missing,
        ));
    };
    Ok(NookIdentitySnapshotLoad(
        NookIdentitySnapshotLoadValue::Present(NookIdentitySnapshot::from_record(
            &record,
            current_app_id.as_deref(),
        )),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_snapshot_enumerates_public_members_and_vault_ids() -> anyhow::Result<()> {
        let app_key = nook_core::AppKey::generate()?;
        let mut record = nook_core::IdentityRecord::create_with_app_key(
            "Personal",
            &app_key,
            Some("MacBook".to_owned()),
        )?;
        let store_id = nook_core::generate_store_id()?;
        record.generate_vault_dek(store_id.clone())?;

        let snapshot = NookIdentitySnapshot::from_record(&record, Some(app_key.app_id().as_str()));
        let members = snapshot.members();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].app_id(), app_key.app_id().as_str());
        assert_eq!(members[0].label_kind(), NookIdentityMemberLabelKind::Known);
        assert!(members[0].current_browser());
        assert_eq!(
            snapshot.local_access(),
            NookIdentityLocalAccessKind::CurrentBrowser
        );
        assert_eq!(
            members[0].label().expect("member label should be present"),
            "MacBook"
        );
        assert_eq!(snapshot.vault_store_ids(), vec![store_id.to_string()]);

        let peer_snapshot = NookIdentitySnapshot::from_record(&record, Some("peer-app"));
        assert!(!peer_snapshot.members()[0].current_browser());
        assert_eq!(
            peer_snapshot.local_access(),
            NookIdentityLocalAccessKind::OtherInstallation
        );
        Ok(())
    }

    #[test]
    fn unmatched_live_session_does_not_select_persisted_identity() -> anyhow::Result<()> {
        let app_key = nook_core::AppKey::generate()?;
        let record = nook_core::IdentityRecord::create_with_app_key("Personal", &app_key, None)?;
        let persisted = nook_core::IdentitySelection::Selected(record.identity_id.clone());

        assert!(matches!(
            directory_selection_for_session(&persisted, None, false),
            NookIdentityDirectorySelection::Empty
        ));
        assert!(matches!(
            directory_selection_for_session(&persisted, None, true),
            NookIdentityDirectorySelection::Selected(identity_id)
                if identity_id == record.identity_id.as_str()
        ));
        Ok(())
    }
}
