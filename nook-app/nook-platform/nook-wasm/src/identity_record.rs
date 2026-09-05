//! Typed WASM surface for the local identity directory.

use crate::storage::identity_record;
use crate::{
    NookError,
    device_access::{self, NookDeviceAccessSnapshot, NookDeviceVaultAccess},
};
use nook_core::{
    AppId, DeviceAccessProtectionKind, IdentityId, IdentitySelection, IdentityVaultAppGrantKind,
};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::storage::{
    identity_record::{load_keyring, load_local_identity_projection, load_selected_identity},
    indexed_db::load_wrapped_device_identity,
};

mod identity_directory_projection;

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
    ThisBrowser,
    OtherInstallation,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookSelectedVaultIdentityContextKind {
    Empty,
    LinkedWithoutCurrent,
    LinkedWithCurrent,
}

struct LocalAppProtection {
    app_id: nook_core::AppId,
    protection: nook_core::DeviceAccessProtectionKind,
}

fn local_app_protections(keyring: &nook_core::LocalIdentityKeyring) -> Vec<LocalAppProtection> {
    keyring
        .entries()
        .iter()
        .map(|entry| LocalAppProtection {
            app_id: entry.app_id().clone(),
            protection: nook_core::classify_device_access_protection(Some(entry.wrapped_app_key())),
        })
        .collect()
}

pub(crate) async fn provider_vault_identity_observations(
    session_app_id: &str,
    store_id: &nook_core::StoreId,
) -> Result<Vec<nook_core::ProviderVaultIdentityObservation>, crate::NookError> {
    let projection = load_local_identity_projection(session_app_id).await?;
    Ok(provider_vault_identity_observations_from_projection(
        session_app_id,
        store_id,
        &projection,
    ))
}

fn provider_vault_identity_observations_from_projection(
    session_app_id: &str,
    store_id: &nook_core::StoreId,
    projection: &identity_record::LocalIdentityProjection,
) -> Vec<nook_core::ProviderVaultIdentityObservation> {
    let local_protections = local_app_protections(&projection.keyring);
    let current_app_id = AppId::parse(session_app_id).ok();

    projection
        .directory
        .identities()
        .iter()
        .map(|identity| {
            let protected_members = identity
                .members
                .iter()
                .filter(|member| {
                    local_protections.iter().any(|entry| {
                        entry.app_id == member.app_id
                            && entry.protection != DeviceAccessProtectionKind::Missing
                    })
                })
                .collect::<Vec<_>>();
            let candidate = protected_members
                .iter()
                .copied()
                .find(|member| {
                    current_app_id.as_ref() == Some(&member.app_id)
                        && nook_core::classify_identity_vault_app_grant(
                            identity,
                            store_id,
                            &member.app_id,
                        ) == IdentityVaultAppGrantKind::Granted
                })
                .or_else(|| {
                    protected_members.iter().copied().find(|member| {
                        nook_core::classify_identity_vault_app_grant(
                            identity,
                            store_id,
                            &member.app_id,
                        ) == IdentityVaultAppGrantKind::Granted
                    })
                })
                .or_else(|| {
                    protected_members
                        .iter()
                        .copied()
                        .find(|member| current_app_id.as_ref() == Some(&member.app_id))
                })
                .or_else(|| protected_members.first().copied());

            nook_core::ProviderVaultIdentityObservation {
                identity_id: identity.identity_id.as_str().to_owned(),
                identity_label: identity.label.clone(),
                linked_to_provider_vault: identity.owns_vault(store_id),
                protected_local_app_available: candidate.is_some(),
                is_current_app: candidate
                    .is_some_and(|member| current_app_id.as_ref() == Some(&member.app_id)),
                app_grant: candidate.map_or(IdentityVaultAppGrantKind::NotGranted, |member| {
                    nook_core::classify_identity_vault_app_grant(identity, store_id, &member.app_id)
                }),
            }
        })
        .collect()
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookIdentityMemberSnapshot {
    app_id: String,
    label: Option<String>,
    current_browser: bool,
    local_protection: nook_core::DeviceAccessProtectionKind,
}

impl NookIdentityMemberSnapshot {
    fn from_member(
        member: &nook_core::IdentityMember,
        current_app_id: Option<&str>,
        local_protections: &[LocalAppProtection],
    ) -> Self {
        Self {
            app_id: member.app_id.as_str().to_owned(),
            label: member.label.clone(),
            current_browser: current_app_id.is_some_and(|app_id| member.app_id.as_str() == app_id),
            local_protection: local_protections
                .iter()
                .find(|entry| entry.app_id == member.app_id)
                .map_or(DeviceAccessProtectionKind::Missing, |entry| {
                    entry.protection
                }),
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

    #[wasm_bindgen(getter, js_name = localProtection)]
    pub fn local_protection(&self) -> nook_core::DeviceAccessProtectionKind {
        self.local_protection
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
            .ok_or_else(|| JsError::new("Identity member label is unknown"))
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
    vaults: Vec<NookDeviceVaultAccess>,
    app_key_count: u32,
    vault_count: u32,
    fingerprint: String,
    local_access: NookIdentityLocalAccessKind,
}

impl NookIdentitySnapshot {
    fn from_record(
        record: &nook_core::IdentityRecord,
        current_app_id: Option<&str>,
        local_protections: &[LocalAppProtection],
    ) -> Self {
        let current_app_id = current_app_id.and_then(|value| AppId::parse(value).ok());
        let app_id = record
            .members
            .first()
            .map(|member| member.app_id.as_str().to_owned())
            .unwrap_or_default();
        Self {
            identity_id: record.identity_id.as_str().to_owned(),
            label: record.label.clone(),
            control_epoch: record.control_epoch.into(),
            app_id,
            members: record
                .members
                .iter()
                .map(|member| {
                    NookIdentityMemberSnapshot::from_member(
                        member,
                        current_app_id.as_ref().map(AppId::as_str),
                        local_protections,
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
            } else if local_protections
                .iter()
                .any(|entry| record.has_app_id(&entry.app_id))
            {
                NookIdentityLocalAccessKind::ThisBrowser
            } else {
                NookIdentityLocalAccessKind::OtherInstallation
            },
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
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the identity control epoch to JavaScript as a bigint"
        )
    )]
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
    pub fn vaults(&self) -> Vec<NookDeviceVaultAccess> {
        self.vaults.clone()
    }

    #[wasm_bindgen(getter, js_name = appKeyCount)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `app_key_count` count through a JavaScript Number scalar"
        )
    )]
    pub fn app_key_count(&self) -> u32 {
        self.app_key_count
    }

    #[wasm_bindgen(getter, js_name = vaultCount)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `vault_count` count through a JavaScript Number scalar"
        )
    )]
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
            NookIdentitySnapshotLoadValue::Missing => {
                Err(JsError::new("Local identity snapshot is missing"))
            }
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
        IdentitySelection::Empty => NookIdentityDirectorySelection::Empty,
        IdentitySelection::Selected(identity_id) => {
            NookIdentityDirectorySelection::Selected(identity_id.as_str().to_owned())
        }
    }
}

#[wasm_bindgen]
pub struct NookIdentityDirectorySnapshot {
    identities: Vec<NookIdentitySnapshot>,
    selection: NookIdentityDirectorySelection,
    access: NookDeviceAccessSnapshot,
    selected_vault_current_app_granted: bool,
}

#[wasm_bindgen]
pub struct NookIdentityDirectorySnapshotRequest {
    session_app_id: String,
    session_unlocked: bool,
    selected_store_id: Option<nook_core::StoreId>,
}

impl NookIdentityDirectorySnapshotRequest {
    pub(crate) fn new(session_app_id: String, session_unlocked: bool) -> Self {
        Self {
            session_app_id,
            session_unlocked,
            selected_store_id: None,
        }
    }

    pub(crate) fn for_selected_vault(
        session_app_id: String,
        session_unlocked: bool,
        selected_store_id: nook_core::StoreId,
    ) -> Self {
        Self {
            session_app_id,
            session_unlocked,
            selected_store_id: Some(selected_store_id),
        }
    }
}

#[wasm_bindgen]
impl NookIdentityDirectorySnapshotRequest {
    pub async fn resolve(&self) -> Result<NookIdentityDirectorySnapshot, wasm_bindgen::JsError> {
        identity_directory_snapshot_for_session(
            &self.session_app_id,
            self.session_unlocked,
            self.selected_store_id.as_ref(),
        )
        .await
    }
}

async fn identity_directory_snapshot_for_session(
    session_app_id: &str,
    session_unlocked: bool,
    selected_store_id: Option<&nook_core::StoreId>,
) -> Result<NookIdentityDirectorySnapshot, wasm_bindgen::JsError> {
    let session_app_id = session_app_id.trim();
    let projection = load_local_identity_projection(session_app_id)
        .await
        .map_err(|error| JsError::new(&error.to_string()))?;
    let protected = projection.protected;
    let protected_app_id = protected.as_ref().map(|(app_id, _)| app_id.clone());
    let current_app_id = if session_app_id.is_empty() {
        protected_app_id
    } else {
        Some(session_app_id.to_owned())
    };
    let directory = projection.directory;
    let keyring = projection.keyring;
    let local_protections = local_app_protections(&keyring);
    let access = device_access::device_access_snapshot_for_session_with_protected(
        session_app_id,
        session_unlocked,
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
    let local_app_ids = local_protections
        .iter()
        .map(|entry| entry.app_id.clone())
        .collect::<Vec<_>>();
    let selected_identities = selected_store_id.map_or_else(
        || directory.identities().iter().collect(),
        |store_id| nook_core::identities_linked_to_vault(&directory, store_id),
    );
    let current_app = current_app_id
        .as_deref()
        .and_then(|app_id| AppId::parse(app_id).ok());
    let selected_vault_current_app_granted = selected_vault_current_app_granted(
        &selected_identities,
        selected_store_id,
        current_app.as_ref(),
    );
    let mut identities = Vec::new();
    for record in selected_identities {
        let mut snapshot = NookIdentitySnapshot::from_record(
            record,
            current_app_id.as_deref(),
            &local_protections,
        );
        snapshot.vaults =
            device_access::device_vault_access_for_identity(record, &local_app_ids, session_app_id)
                .await?;
        identities.push(snapshot);
    }
    Ok(NookIdentityDirectorySnapshot {
        identities,
        selection,
        access,
        selected_vault_current_app_granted,
    })
}

fn current_browser_identity(identities: &[NookIdentitySnapshot]) -> Option<&NookIdentitySnapshot> {
    identities
        .iter()
        .find(|identity| identity.local_access == NookIdentityLocalAccessKind::CurrentBrowser)
}

fn selected_vault_current_app_granted(
    identities: &[&nook_core::IdentityRecord],
    selected_store_id: Option<&nook_core::StoreId>,
    current_app_id: Option<&nook_core::AppId>,
) -> bool {
    selected_store_id
        .zip(current_app_id)
        .is_some_and(|(store_id, app_id)| {
            identities.iter().any(|identity| {
                nook_core::classify_identity_vault_app_grant(identity, store_id, app_id)
                    == IdentityVaultAppGrantKind::Granted
            })
        })
}

fn selected_vault_context_kind(
    identities: &[NookIdentitySnapshot],
    current_app_granted: bool,
) -> NookSelectedVaultIdentityContextKind {
    if identities.is_empty() {
        return NookSelectedVaultIdentityContextKind::Empty;
    }
    if current_app_granted && current_browser_identity(identities).is_some() {
        NookSelectedVaultIdentityContextKind::LinkedWithCurrent
    } else {
        NookSelectedVaultIdentityContextKind::LinkedWithoutCurrent
    }
}

#[wasm_bindgen]
pub async fn load_identity_directory_snapshot()
-> Result<NookIdentityDirectorySnapshot, wasm_bindgen::JsError> {
    identity_directory_snapshot_for_session("", false, None).await
}

#[wasm_bindgen]
pub async fn select_identity(identity_id: String) -> Result<(), wasm_bindgen::JsError> {
    let identity_id =
        IdentityId::parse(&identity_id).map_err(|error| JsError::new(&error.to_string()))?;
    identity_record::update_identity_directory(move |directory| {
        directory
            .select(&identity_id)
            .map_err(|error| NookError::Database(error.to_string()))
    })
    .await
    .map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub async fn load_identity_snapshot() -> Result<NookIdentitySnapshotLoad, wasm_bindgen::JsError> {
    let current_app_id = load_wrapped_device_identity()
        .await
        .map_err(|error| JsError::new(&error.to_string()))?
        .map(|(app_id, _)| app_id);
    let Some(record) = load_selected_identity()
        .await
        .map_err(|error| JsError::new(&error.to_string()))?
    else {
        return Ok(NookIdentitySnapshotLoad(
            NookIdentitySnapshotLoadValue::Missing,
        ));
    };
    let keyring = load_keyring()
        .await
        .map_err(|error| JsError::new(&error.to_string()))?;
    let local_protections = local_app_protections(&keyring);
    Ok(NookIdentitySnapshotLoad(
        NookIdentitySnapshotLoadValue::Present(NookIdentitySnapshot::from_record(
            &record,
            current_app_id.as_deref(),
            &local_protections,
        )),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::{
        AppKey, CurrentVaultReplaceability, IdentityDirectory, IdentityRecord,
        LocalIdentityKeyring, LocalIdentityKeyringEntry,
    };

    #[test]
    fn identity_snapshot_enumerates_public_members_and_vault_ids() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut record =
            IdentityRecord::create_with_app_key("Personal", &app_key, Some("MacBook".to_owned()))?;
        let store_id = nook_core::generate_store_id()?;
        record.generate_vault_dek(store_id.clone())?;
        let local_protections = [LocalAppProtection {
            app_id: app_key.app_id().clone(),
            protection: DeviceAccessProtectionKind::PasskeyStandard,
        }];

        let snapshot = NookIdentitySnapshot::from_record(
            &record,
            Some(app_key.app_id().as_str()),
            &local_protections,
        );
        let members = snapshot.members();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].app_id(), app_key.app_id().as_str());
        assert_eq!(members[0].label_kind(), NookIdentityMemberLabelKind::Known);
        assert!(members[0].current_browser());
        assert_eq!(
            members[0].local_protection(),
            DeviceAccessProtectionKind::PasskeyStandard
        );
        assert_eq!(
            snapshot.local_access(),
            NookIdentityLocalAccessKind::CurrentBrowser
        );
        assert_eq!(
            members[0].label().expect("member label should be present"),
            "MacBook"
        );
        assert_eq!(snapshot.vault_store_ids(), vec![store_id.to_string()]);

        let peer_snapshot =
            NookIdentitySnapshot::from_record(&record, Some("peer-app"), &local_protections);
        assert!(!peer_snapshot.members()[0].current_browser());
        assert_eq!(
            peer_snapshot.members()[0].local_protection(),
            DeviceAccessProtectionKind::PasskeyStandard
        );
        assert_eq!(
            peer_snapshot.local_access(),
            NookIdentityLocalAccessKind::ThisBrowser
        );
        let remote_snapshot = NookIdentitySnapshot::from_record(&record, Some("peer-app"), &[]);
        assert_eq!(
            remote_snapshot.local_access(),
            NookIdentityLocalAccessKind::OtherInstallation
        );
        Ok(())
    }

    #[test]
    fn unmatched_live_session_does_not_select_persisted_identity() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let record = IdentityRecord::create_with_app_key("Personal", &app_key, None)?;
        let persisted = IdentitySelection::Selected(record.identity_id.clone());

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

    #[test]
    fn selected_vault_context_resolves_current_browser() -> anyhow::Result<()> {
        let personal_key = AppKey::generate()?;
        let store_id = nook_core::generate_store_id()?;
        let mut personal = IdentityRecord::create_with_app_key("Personal", &personal_key, None)?;
        personal.generate_vault_dek(store_id.clone())?;
        let linked = [&personal];
        let current_app_granted = selected_vault_current_app_granted(
            &linked,
            Some(&store_id),
            Some(personal_key.app_id()),
        );
        let snapshots = linked
            .iter()
            .map(|record| {
                NookIdentitySnapshot::from_record(record, Some(personal_key.app_id().as_str()), &[])
            })
            .collect::<Vec<_>>();

        assert_eq!(
            snapshots
                .iter()
                .map(NookIdentitySnapshot::label)
                .collect::<Vec<_>>(),
            vec!["Personal"]
        );
        assert_eq!(
            selected_vault_context_kind(&snapshots, current_app_granted),
            NookSelectedVaultIdentityContextKind::LinkedWithCurrent
        );
        let current = current_browser_identity(&snapshots)
            .ok_or_else(|| anyhow::anyhow!("expected the personal current-browser identity"))?;
        assert_eq!(current.label(), "Personal");
        Ok(())
    }

    #[test]
    fn selected_vault_context_keeps_other_browser_identity_without_current() -> anyhow::Result<()> {
        let work_key = AppKey::generate()?;
        let travel_key = AppKey::generate()?;
        let work = IdentityRecord::create_with_app_key("Work", &work_key, None)?;
        let travel = IdentityRecord::create_with_app_key("Travel", &travel_key, None)?;
        let local_protections = [LocalAppProtection {
            app_id: work_key.app_id().clone(),
            protection: DeviceAccessProtectionKind::PinOrPassphrase,
        }];

        let snapshots = [&work, &travel]
            .iter()
            .map(|record| {
                NookIdentitySnapshot::from_record(
                    record,
                    Some("app_otherbrowser"),
                    &local_protections,
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(snapshots.len(), 2);
        assert_eq!(
            snapshots[0].local_access(),
            NookIdentityLocalAccessKind::ThisBrowser
        );
        assert_eq!(
            snapshots[1].local_access(),
            NookIdentityLocalAccessKind::OtherInstallation
        );
        assert_eq!(
            selected_vault_context_kind(&snapshots, false),
            NookSelectedVaultIdentityContextKind::LinkedWithoutCurrent
        );
        assert!(current_browser_identity(&snapshots).is_none());
        Ok(())
    }

    #[test]
    fn selected_vault_context_classifies_empty_projection() {
        assert_eq!(
            selected_vault_context_kind(&[], false),
            NookSelectedVaultIdentityContextKind::Empty
        );
    }

    #[test]
    fn selected_vault_context_rejects_current_member_without_vault_grant() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let store_id = nook_core::generate_store_id()?;
        let mut identity = IdentityRecord::create_with_app_key("Personal", &app_key, None)?;
        identity.generate_vault_dek(store_id.clone())?;
        let vault = identity
            .vault_deks
            .iter_mut()
            .find(|vault| vault.store_id == store_id)
            .ok_or_else(|| anyhow::anyhow!("selected vault DEK is missing"))?;
        vault
            .secrets_envelopes
            .retain(|envelope| envelope.app_id != *app_key.app_id());
        vault
            .members_envelopes
            .retain(|envelope| envelope.app_id != *app_key.app_id());
        let linked = [&identity];
        let current_app_granted =
            selected_vault_current_app_granted(&linked, Some(&store_id), Some(app_key.app_id()));
        let snapshots = [NookIdentitySnapshot::from_record(
            &identity,
            Some(app_key.app_id().as_str()),
            &[],
        )];

        assert_eq!(
            snapshots[0].local_access(),
            NookIdentityLocalAccessKind::CurrentBrowser
        );
        assert_eq!(
            selected_vault_context_kind(&snapshots, current_app_granted),
            NookSelectedVaultIdentityContextKind::LinkedWithoutCurrent
        );
        Ok(())
    }

    use nook_core::{
        ProviderVaultDecision as Decision, ProviderVaultDecisionReason as Reason,
        ProviderVaultIdentityEligibility as Eligibility,
    };

    fn keyring_entry(
        identity: &nook_core::IdentityRecord,
        app_key: &nook_core::AppKey,
    ) -> anyhow::Result<nook_core::LocalIdentityKeyringEntry> {
        let wrapped = nook_core::wrap_device_identity_with_pin(&app_key.secret_string(), "123456")?;
        Ok(LocalIdentityKeyringEntry::legacy(
            identity.identity_id.clone(),
            app_key.app_id().clone(),
            wrapped,
        ))
    }

    fn projection(
        identities: Vec<nook_core::IdentityRecord>,
        selected: nook_core::IdentityId,
        entries: Vec<nook_core::LocalIdentityKeyringEntry>,
    ) -> anyhow::Result<identity_record::LocalIdentityProjection> {
        Ok(identity_record::LocalIdentityProjection {
            directory: IdentityDirectory::from_records(
                identities,
                IdentitySelection::Selected(selected),
            )?,
            keyring: LocalIdentityKeyring::from_entries(entries)?,
            protected: None,
        })
    }

    fn decision(
        session_app_id: &str,
        store_id: &nook_core::StoreId,
        projection: &identity_record::LocalIdentityProjection,
    ) -> nook_core::ProviderVaultDecisionProjection {
        nook_core::project_provider_vault_decision(
            CurrentVaultReplaceability::Replaceable,
            provider_vault_identity_observations_from_projection(
                session_app_id,
                store_id,
                projection,
            ),
        )
    }

    #[test]
    fn current_and_other_protected_identities_keep_distinct_eligibility() -> anyhow::Result<()> {
        let current_key = AppKey::generate()?;
        let other_key = AppKey::generate()?;
        let store_id = nook_core::generate_store_id()?;
        let current = IdentityRecord::create_with_app_key("Personal", &current_key, None)?;
        let current_id = current.identity_id.clone();
        let current_entry = keyring_entry(&current, &current_key)?;
        let mut other = IdentityRecord::create_with_app_key("Work", &other_key, None)?;
        other.generate_vault_dek(store_id.clone())?;
        let other_entry = keyring_entry(&other, &other_key)?;
        let projection = projection(
            vec![current, other],
            current_id,
            vec![current_entry, other_entry],
        )?;

        let decision = decision(current_key.app_id().as_str(), &store_id, &projection);
        assert_eq!(decision.decision, Decision::AdoptProviderVault);
        assert_eq!(decision.identities[0].eligibility, Eligibility::NotLinked);
        assert!(decision.identities[0].is_current_app);
        assert_eq!(
            decision.identities[1].eligibility,
            Eligibility::LinkedAndPrepared
        );
        assert!(!decision.identities[1].is_current_app);
        Ok(())
    }

    #[test]
    fn linked_identity_without_a_protected_keyring_entry_is_unavailable() -> anyhow::Result<()> {
        let current_key = AppKey::generate()?;
        let linked_key = AppKey::generate()?;
        let store_id = nook_core::generate_store_id()?;
        let current = IdentityRecord::create_with_app_key("Personal", &current_key, None)?;
        let current_id = current.identity_id.clone();
        let current_entry = keyring_entry(&current, &current_key)?;
        let mut linked = IdentityRecord::create_with_app_key("Work", &linked_key, None)?;
        linked.generate_vault_dek(store_id.clone())?;
        let projection = projection(vec![current, linked], current_id, vec![current_entry])?;

        let decision = decision(current_key.app_id().as_str(), &store_id, &projection);
        assert_eq!(decision.decision, Decision::PreserveBoth);
        assert_eq!(decision.reason, Reason::LinkedIdentityUnavailable);
        assert_eq!(
            decision.identities[1].eligibility,
            Eligibility::LinkedButUnavailable
        );
        Ok(())
    }

    #[test]
    fn revoked_or_missing_dek_envelopes_make_a_protected_identity_unavailable() -> anyhow::Result<()>
    {
        let app_key = AppKey::generate()?;
        let store_id = nook_core::generate_store_id()?;
        let mut base = IdentityRecord::create_with_app_key("Personal", &app_key, None)?;
        base.generate_vault_dek(store_id.clone())?;
        let entry = keyring_entry(&base, &app_key)?;

        for (remove_secrets, remove_members) in [(true, false), (false, true), (true, true)] {
            let mut identity = base.clone();
            let vault = identity
                .vault_deks
                .first_mut()
                .ok_or_else(|| anyhow::anyhow!("missing test vault grant"))?;
            if remove_secrets {
                vault.secrets_envelopes.clear();
            }
            if remove_members {
                vault.members_envelopes.clear();
            }
            let identity_id = identity.identity_id.clone();
            let projection = projection(vec![identity], identity_id, vec![entry.clone()])?;
            let decision = decision(app_key.app_id().as_str(), &store_id, &projection);
            assert_eq!(decision.decision, Decision::PreserveBoth);
            assert_eq!(
                decision.identities[0].eligibility,
                Eligibility::LinkedButUnavailable
            );
            assert!(decision.identities[0].is_current_app);
        }
        Ok(())
    }
}
