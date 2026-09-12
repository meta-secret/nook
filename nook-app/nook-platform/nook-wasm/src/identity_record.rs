//! Typed WASM surface for the local identity directory.

use crate::BrowserDeviceAccessSnapshotForSessionWithProtected;
use crate::BrowserDeviceVaultAccessForIdentity;
use crate::NookDatabase;
use crate::storage::identity_record;
use crate::storage::identity_record::IdentityDirectoryWrite;
use crate::storage::identity_record::{ProtectedIdentityLookup, SelectedIdentityRecord};
use crate::{
    NookError,
    device_access::{NookDeviceAccessSnapshot, NookDeviceVaultAccess},
};
use nook_core::MemberLabelState;
use nook_core::{
    DeviceAccessProtectionKind, IdentityId, IdentitySelection, IdentityVaultAppGrant,
    IdentityVaultAppGrantKind, IdentityVaultLinks, IdentityVaultLinksRequest,
};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

mod identity_directory_projection;
mod snapshot_scope;
use snapshot_scope::{CurrentAppIdentity, SnapshotVaultSelection, VaultSnapshotScope};

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

mod provider_observation;

struct LocalAppProtection {
    app_id: nook_core::AppId,
    protection: nook_core::DeviceAccessProtectionKind,
}

impl LocalAppProtection {
    fn local_app_protections(keyring: &nook_core::LocalIdentityKeyring) -> Vec<LocalAppProtection> {
        keyring
            .entries()
            .iter()
            .map(|entry| LocalAppProtection {
                app_id: entry.app_id().clone(),
                protection: nook_core::DeviceAccessProtectionKind::classify(
                    entry.wrapped_app_key(),
                ),
            })
            .collect()
    }
}

/// Named values required by `NookIdentityDirectorySnapshot::provider_vault_identity_observations`.
pub(crate) struct BrowserProviderVaultIdentityObservations<'a> {
    pub(crate) session_app_id: &'a str,
    pub(crate) store_id: &'a nook_core::StoreId,
}

/// Named values required by `NookIdentityDirectorySnapshot::provider_vault_identity_observations_from_projection`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserProviderVaultIdentityObservationsFromProjection<'a> {
    pub(crate) session_app_id: &'a str,
    pub(crate) store_id: &'a nook_core::StoreId,
    pub(crate) projection: &'a identity_record::LocalIdentityProjection,
}

/// Named values required by `NookIdentityDirectorySnapshot::identity_directory_snapshot_for_session`.
pub(crate) struct BrowserIdentityDirectorySnapshotForSession<'a> {
    pub(crate) session_app_id: &'a str,
    pub(crate) session_unlocked: nook_core::DeviceSessionLockState,
    pub(crate) selected_store_id: VaultSnapshotScope<'a>,
}

/// Named values required by `NookIdentityDirectorySnapshot::selected_vault_current_app_granted`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserSelectedVaultCurrentAppGranted<'a> {
    pub(crate) identities: &'a [&'a nook_core::IdentityRecord],
    pub(crate) selected_store_id: VaultSnapshotScope<'a>,
    pub(crate) current_app_id: &'a CurrentAppIdentity,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookIdentityMemberSnapshot {
    app_id: String,
    label: MemberLabelState,
    current_browser: bool,
    local_protection: nook_core::DeviceAccessProtectionKind,
}

impl NookIdentityMemberSnapshot {
    fn from_member(
        member: &nook_core::IdentityMember,
        current_app_id: &CurrentAppIdentity,
        local_protections: &[LocalAppProtection],
    ) -> Self {
        Self {
            app_id: member.app_id.as_str().to_owned(),
            label: member.label.clone(),
            current_browser: matches!(current_app_id, CurrentAppIdentity::Identified(app_id) if member.app_id == *app_id),
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
            MemberLabelState::Named(_) => NookIdentityMemberLabelKind::Known,
            MemberLabelState::Unnamed => NookIdentityMemberLabelKind::Unknown,
        }
    }

    pub fn label(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.label {
            MemberLabelState::Named(label) => Ok(label.clone()),
            MemberLabelState::Unnamed => Err(JsError::new("Identity member label is unknown")),
        }
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
        current_app_id: &CurrentAppIdentity,
        local_protections: &[LocalAppProtection],
    ) -> Self {
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
                        current_app_id,
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
            fingerprint: IdentityId::identity_fingerprint(&record.identity_id),
            local_access: if matches!(current_app_id, CurrentAppIdentity::Identified(app_id) if record.has_app_id(app_id))
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

/// Named values required by `NookIdentityDirectorySelection::directory_selection_for_session`.
pub(crate) struct BrowserDirectorySelectionForSession<'a> {
    pub(crate) persisted_selection: &'a nook_core::IdentitySelection,
    pub(crate) current_identity_id: IdentitySelection,
    pub(crate) allow_persisted_fallback: bool,
}

impl NookIdentityDirectorySelection {
    fn directory_selection_for_session(
        request: BrowserDirectorySelectionForSession<'_>,
    ) -> NookIdentityDirectorySelection {
        let BrowserDirectorySelectionForSession {
            persisted_selection,
            current_identity_id,
            allow_persisted_fallback,
        } = request;
        if let IdentitySelection::Selected(identity_id) = current_identity_id {
            return NookIdentityDirectorySelection::Selected(identity_id.to_string());
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
    session_unlocked: nook_core::DeviceSessionLockState,
    selected_store_id: SnapshotVaultSelection,
}

impl NookIdentityDirectorySnapshotRequest {
    pub(crate) fn new(
        session_app_id: String,
        session_unlocked: nook_core::DeviceSessionLockState,
    ) -> Self {
        Self {
            session_app_id,
            session_unlocked,
            selected_store_id: SnapshotVaultSelection::Directory,
        }
    }

    pub(crate) fn for_selected_vault(
        session_app_id: String,
        session_unlocked: nook_core::DeviceSessionLockState,
        selected_store_id: nook_core::StoreId,
    ) -> Self {
        Self {
            session_app_id,
            session_unlocked,
            selected_store_id: SnapshotVaultSelection::Selected(selected_store_id),
        }
    }
}

#[wasm_bindgen]
impl NookIdentityDirectorySnapshotRequest {
    pub async fn resolve(&self) -> Result<NookIdentityDirectorySnapshot, wasm_bindgen::JsError> {
        NookIdentityDirectorySnapshot::identity_directory_snapshot_for_session(
            BrowserIdentityDirectorySnapshotForSession {
                session_app_id: &self.session_app_id,
                session_unlocked: self.session_unlocked,
                selected_store_id: self.selected_store_id.scope(),
            },
        )
        .await
    }
}

impl NookIdentityDirectorySnapshot {
    async fn identity_directory_snapshot_for_session(
        request: BrowserIdentityDirectorySnapshotForSession<'_>,
    ) -> Result<NookIdentityDirectorySnapshot, wasm_bindgen::JsError> {
        let BrowserIdentityDirectorySnapshotForSession {
            session_app_id,
            session_unlocked,
            selected_store_id,
        } = request;
        let session_app_id = session_app_id.trim();
        let projection = NookDatabase::load_local_identity_projection(session_app_id)
            .await
            .map_err(|error| JsError::new(&error.to_string()))?;
        let protected = projection.protected;
        let current_app = if session_app_id.is_empty() {
            match &protected {
                ProtectedIdentityLookup::Configured(identity) => {
                    CurrentAppIdentity::Identified(identity.app_id.clone())
                }
                ProtectedIdentityLookup::Unconfigured => CurrentAppIdentity::Unidentified,
            }
        } else {
            CurrentAppIdentity::observe(session_app_id)
        };
        let directory = projection.directory;
        let keyring = projection.keyring;
        let local_protections = LocalAppProtection::local_app_protections(&keyring);
        let access = NookDeviceAccessSnapshot::device_access_snapshot_for_session_with_protected(
            BrowserDeviceAccessSnapshotForSessionWithProtected {
                session_device_id: session_app_id,
                session_unlocked,
                protected,
            },
        )
        .await?;
        let current_identity = match &current_app {
            CurrentAppIdentity::Unidentified => IdentitySelection::Empty,
            CurrentAppIdentity::Identified(app_id) => match directory
                .identities()
                .iter()
                .find(|record| record.members.iter().any(|member| &member.app_id == app_id))
            {
                Some(record) => IdentitySelection::Selected(record.identity_id.clone()),
                None => IdentitySelection::Empty,
            },
        };
        let selection = NookIdentityDirectorySelection::directory_selection_for_session(
            BrowserDirectorySelectionForSession {
                persisted_selection: directory.selection(),
                current_identity_id: current_identity,
                allow_persisted_fallback: session_app_id.is_empty(),
            },
        );
        let local_app_ids = local_protections
            .iter()
            .map(|entry| entry.app_id.clone())
            .collect::<Vec<_>>();
        let selected_identities = match selected_store_id {
            VaultSnapshotScope::Directory => directory.identities().iter().collect(),
            VaultSnapshotScope::Selected(store_id) => {
                IdentityVaultLinks::new(&IdentityVaultLinksRequest {
                    directory: &directory,
                    store_id,
                })
                .collect()
            }
        };
        let selected_vault_current_app_granted =
            NookIdentityDirectorySnapshot::selected_vault_current_app_granted(
                BrowserSelectedVaultCurrentAppGranted {
                    identities: &selected_identities,
                    selected_store_id,
                    current_app_id: &current_app,
                },
            );
        let mut identities = Vec::new();
        for record in selected_identities {
            let mut snapshot =
                NookIdentitySnapshot::from_record(record, &current_app, &local_protections);
            snapshot.vaults = NookDeviceVaultAccess::device_vault_access_for_identity(
                BrowserDeviceVaultAccessForIdentity {
                    identity: record,
                    local_app_ids: &local_app_ids,
                    session_app_id,
                },
            )
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
}

impl NookIdentitySnapshot {
    fn current_browser_identity(
        identities: &[NookIdentitySnapshot],
    ) -> Result<&NookIdentitySnapshot, JsError> {
        identities
            .iter()
            .find(|identity| identity.local_access == NookIdentityLocalAccessKind::CurrentBrowser)
            .ok_or_else(|| JsError::new("No linked identity belongs to this browser"))
    }
}

impl NookIdentityDirectorySnapshot {
    fn selected_vault_current_app_granted(
        request: BrowserSelectedVaultCurrentAppGranted<'_>,
    ) -> bool {
        let BrowserSelectedVaultCurrentAppGranted {
            identities,
            selected_store_id,
            current_app_id,
        } = request;
        let (VaultSnapshotScope::Selected(store_id), CurrentAppIdentity::Identified(app_id)) =
            (selected_store_id, current_app_id)
        else {
            return false;
        };
        identities.iter().any(|identity| {
            IdentityVaultAppGrant {
                identity,
                store_id,
                app_id,
            }
            .classify()
                == IdentityVaultAppGrantKind::Granted
        })
    }
}

/// Named values required by `NookSelectedVaultIdentityContextKind::selected_vault_context_kind`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserSelectedVaultContextKind<'a> {
    pub(crate) identities: &'a [NookIdentitySnapshot],
    pub(crate) current_app_granted: bool,
}

impl NookSelectedVaultIdentityContextKind {
    fn selected_vault_context_kind(
        request: BrowserSelectedVaultContextKind<'_>,
    ) -> NookSelectedVaultIdentityContextKind {
        let BrowserSelectedVaultContextKind {
            identities,
            current_app_granted,
        } = request;
        if identities.is_empty() {
            return NookSelectedVaultIdentityContextKind::Empty;
        }
        if current_app_granted && NookIdentitySnapshot::current_browser_identity(identities).is_ok()
        {
            NookSelectedVaultIdentityContextKind::LinkedWithCurrent
        } else {
            NookSelectedVaultIdentityContextKind::LinkedWithoutCurrent
        }
    }
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub async fn load_identity_directory_snapshot()
-> Result<NookIdentityDirectorySnapshot, wasm_bindgen::JsError> {
    NookIdentityDirectorySnapshot::identity_directory_snapshot_for_session(
        BrowserIdentityDirectorySnapshotForSession {
            session_app_id: "",
            session_unlocked: false.into(),
            selected_store_id: VaultSnapshotScope::Directory,
        },
    )
    .await
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub async fn select_identity(identity_id: String) -> Result<(), wasm_bindgen::JsError> {
    let identity_id =
        IdentityId::parse(&identity_id).map_err(|error| JsError::new(&error.to_string()))?;
    NookDatabase::update_identity_directory(move |directory| {
        directory
            .select(&identity_id)
            .map(IdentityDirectoryWrite::from)
            .map_err(|rejected| NookError::Database(rejected.into_cause().to_string()))
    })
    .await
    .map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub async fn load_identity_snapshot() -> Result<NookIdentitySnapshotLoad, wasm_bindgen::JsError> {
    let current_app = match NookDatabase::load_wrapped_device_identity()
        .await
        .map_err(|error| JsError::new(&error.to_string()))?
    {
        ProtectedIdentityLookup::Configured(identity) => {
            CurrentAppIdentity::Identified(identity.app_id)
        }
        ProtectedIdentityLookup::Unconfigured => CurrentAppIdentity::Unidentified,
    };
    let SelectedIdentityRecord::Selected(record) = NookDatabase::load_selected_identity()
        .await
        .map_err(|error| JsError::new(&error.to_string()))?
    else {
        return Ok(NookIdentitySnapshotLoad(
            NookIdentitySnapshotLoadValue::Missing,
        ));
    };
    let keyring = NookDatabase::load_keyring()
        .await
        .map_err(|error| JsError::new(&error.to_string()))?;
    let local_protections = LocalAppProtection::local_app_protections(&keyring);
    Ok(NookIdentitySnapshotLoad(
        NookIdentitySnapshotLoadValue::Present(NookIdentitySnapshot::from_record(
            &record,
            &current_app,
            &local_protections,
        )),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::{AppKey, IdentityRecord};
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn identity_snapshot_enumerates_public_members_and_vault_ids() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut record = IdentityRecord::create_with_app_key(
            "Personal",
            &app_key,
            MemberLabelState::Named("MacBook".to_owned()),
        )?;
        let store_id = nook_core::StoreId::generate()?;
        let opened_identity = record
            .generate_vault_dek(store_id.clone())
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        record = opened_identity.identity;
        let local_protections = [LocalAppProtection {
            app_id: app_key.app_id().clone(),
            protection: DeviceAccessProtectionKind::PasskeyStandard,
        }];

        let snapshot = NookIdentitySnapshot::from_record(
            &record,
            &CurrentAppIdentity::observe(app_key.app_id().as_str()),
            &local_protections,
        );
        let members = snapshot.members();
        assert_eq!(members.len(), 1);
        let member = members
            .first()
            .ok_or_else(|| anyhow::anyhow!("identity member must be present"))?;
        assert_eq!(member.app_id(), app_key.app_id().as_str());
        assert_eq!(member.label_kind(), NookIdentityMemberLabelKind::Known);
        assert!(member.current_browser());
        assert_eq!(
            member.local_protection(),
            DeviceAccessProtectionKind::PasskeyStandard
        );
        assert_eq!(
            snapshot.local_access(),
            NookIdentityLocalAccessKind::CurrentBrowser
        );
        assert_eq!(
            member
                .label()
                .map_err(|_| anyhow::anyhow!("member label must be present"))?,
            "MacBook"
        );
        assert_eq!(snapshot.vault_store_ids(), vec![store_id.to_string()]);

        let peer_snapshot = NookIdentitySnapshot::from_record(
            &record,
            &CurrentAppIdentity::observe("peer-app"),
            &local_protections,
        );
        let peer_members = peer_snapshot.members();
        let peer_member = peer_members
            .first()
            .ok_or_else(|| anyhow::anyhow!("peer identity member must be present"))?;
        assert!(!peer_member.current_browser());
        assert_eq!(
            peer_member.local_protection(),
            DeviceAccessProtectionKind::PasskeyStandard
        );
        assert_eq!(
            peer_snapshot.local_access(),
            NookIdentityLocalAccessKind::ThisBrowser
        );
        let remote_snapshot = NookIdentitySnapshot::from_record(
            &record,
            &CurrentAppIdentity::observe("peer-app"),
            &[],
        );
        assert_eq!(
            remote_snapshot.local_access(),
            NookIdentityLocalAccessKind::OtherInstallation
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn unmatched_live_session_does_not_select_persisted_identity() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let record =
            IdentityRecord::create_with_app_key("Personal", &app_key, MemberLabelState::Unnamed)?;
        let persisted = IdentitySelection::Selected(record.identity_id.clone());

        assert!(matches!(
            NookIdentityDirectorySelection::directory_selection_for_session(
                BrowserDirectorySelectionForSession {
                    persisted_selection: &persisted,
                    current_identity_id: IdentitySelection::Empty,
                    allow_persisted_fallback: false
                }
            ),
            NookIdentityDirectorySelection::Empty
        ));
        assert!(matches!(
            NookIdentityDirectorySelection::directory_selection_for_session(BrowserDirectorySelectionForSession { persisted_selection: &persisted, current_identity_id: IdentitySelection::Empty, allow_persisted_fallback: true }),
            NookIdentityDirectorySelection::Selected(identity_id)
                if identity_id == record.identity_id.as_str()
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    fn selected_vault_context_resolves_current_browser() -> anyhow::Result<()> {
        let personal_key = AppKey::generate()?;
        let store_id = nook_core::StoreId::generate()?;
        let mut personal = IdentityRecord::create_with_app_key(
            "Personal",
            &personal_key,
            MemberLabelState::Unnamed,
        )?;
        let opened_identity = personal
            .generate_vault_dek(store_id.clone())
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        personal = opened_identity.identity;
        let linked = [&personal];
        let current_app_granted = NookIdentityDirectorySnapshot::selected_vault_current_app_granted(
            BrowserSelectedVaultCurrentAppGranted {
                identities: &linked,
                selected_store_id: VaultSnapshotScope::Selected(&store_id),
                current_app_id: &CurrentAppIdentity::Identified(personal_key.app_id().clone()),
            },
        );
        let snapshots = linked
            .iter()
            .map(|record| {
                NookIdentitySnapshot::from_record(
                    record,
                    &CurrentAppIdentity::observe(personal_key.app_id().as_str()),
                    &[],
                )
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
            NookSelectedVaultIdentityContextKind::selected_vault_context_kind(
                BrowserSelectedVaultContextKind {
                    identities: &snapshots,
                    current_app_granted
                }
            ),
            NookSelectedVaultIdentityContextKind::LinkedWithCurrent
        );
        let current = NookIdentitySnapshot::current_browser_identity(&snapshots)
            .map_err(|_| anyhow::anyhow!("expected the personal current-browser identity"))?;
        assert_eq!(current.label(), "Personal");
        Ok(())
    }

    #[wasm_bindgen_test]
    fn selected_vault_context_keeps_other_browser_identity_without_current() -> anyhow::Result<()> {
        let work_key = AppKey::generate()?;
        let travel_key = AppKey::generate()?;
        let work =
            IdentityRecord::create_with_app_key("Work", &work_key, MemberLabelState::Unnamed)?;
        let travel =
            IdentityRecord::create_with_app_key("Travel", &travel_key, MemberLabelState::Unnamed)?;
        let local_protections = [LocalAppProtection {
            app_id: work_key.app_id().clone(),
            protection: DeviceAccessProtectionKind::PinOrPassphrase,
        }];

        let snapshots = [&work, &travel]
            .iter()
            .map(|record| {
                NookIdentitySnapshot::from_record(
                    record,
                    &CurrentAppIdentity::observe("app_otherbrowser"),
                    &local_protections,
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(snapshots.len(), 2);
        let work = snapshots
            .first()
            .ok_or_else(|| anyhow::anyhow!("work identity snapshot must be present"))?;
        let travel = snapshots
            .get(1)
            .ok_or_else(|| anyhow::anyhow!("travel identity snapshot must be present"))?;
        assert_eq!(
            work.local_access(),
            NookIdentityLocalAccessKind::ThisBrowser
        );
        assert_eq!(
            travel.local_access(),
            NookIdentityLocalAccessKind::OtherInstallation
        );
        assert_eq!(
            NookSelectedVaultIdentityContextKind::selected_vault_context_kind(
                BrowserSelectedVaultContextKind {
                    identities: &snapshots,
                    current_app_granted: false
                }
            ),
            NookSelectedVaultIdentityContextKind::LinkedWithoutCurrent
        );
        assert!(NookIdentitySnapshot::current_browser_identity(&snapshots).is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn selected_vault_context_classifies_empty_projection() {
        assert_eq!(
            NookSelectedVaultIdentityContextKind::selected_vault_context_kind(
                BrowserSelectedVaultContextKind {
                    identities: &[],
                    current_app_granted: false
                }
            ),
            NookSelectedVaultIdentityContextKind::Empty
        );
    }

    #[wasm_bindgen_test]
    fn selected_vault_context_rejects_current_member_without_vault_grant() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let store_id = nook_core::StoreId::generate()?;
        let mut identity =
            IdentityRecord::create_with_app_key("Personal", &app_key, MemberLabelState::Unnamed)?;
        let opened_identity = identity
            .generate_vault_dek(store_id.clone())
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        identity = opened_identity.identity;
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
        let current_app_granted = NookIdentityDirectorySnapshot::selected_vault_current_app_granted(
            BrowserSelectedVaultCurrentAppGranted {
                identities: &linked,
                selected_store_id: VaultSnapshotScope::Selected(&store_id),
                current_app_id: &CurrentAppIdentity::Identified(app_key.app_id().clone()),
            },
        );
        let snapshots = [NookIdentitySnapshot::from_record(
            &identity,
            &CurrentAppIdentity::observe(app_key.app_id().as_str()),
            &[],
        )];

        assert_eq!(
            snapshots[0].local_access(),
            NookIdentityLocalAccessKind::CurrentBrowser
        );
        assert_eq!(
            NookSelectedVaultIdentityContextKind::selected_vault_context_kind(
                BrowserSelectedVaultContextKind {
                    identities: &snapshots,
                    current_app_granted
                }
            ),
            NookSelectedVaultIdentityContextKind::LinkedWithoutCurrent
        );
        Ok(())
    }
}
