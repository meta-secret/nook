//! Identity-level device onboarding and sync-provider mounts.
//!
//! The replicated identity control log is the membership authority. This
//! manager signs identity events with the installation's event signer, stores
//! them in `nook_db.events`, unions them with every identity mount, and caches
//! the resulting membership and this installation's DEK grants in the local
//! identity directory.

mod membership;
mod migration;
mod vault_access;

use nook_core::{
    AppKey, AppKeyIdentityMembership, AuthProvidersSnapshotData, EventLogLocation,
    IdentityControlLog, IdentityControlOperation, IdentityControlSnapshot,
    IdentityControlSnapshotRequest, IdentityControlState, IdentityEventInsertStatus,
    IdentityEventSigning, IdentityId, IdentityMemberKeys, IsoTimestamp, MemberLabel,
    MemberLabelState, ReplicatedIdentityMembership, ReplicatedIdentityStanding,
    ReplicatedMembershipRequest, StorageMode,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

const INVALID_TYPED_INPUT: &str = "Invalid typed WASM input.";
const UNENCODABLE_TYPED_OUTPUT: &str = "Typed WASM output could not be encoded.";

use super::NookVaultManager;
use crate::storage::identity_log::IdentityLogWrite;
use crate::storage::identity_record::IdentityDirectoryWrite;
use crate::storage::remote_event::RemoteEventRead;
use crate::{NookDatabase, NookError};

/// Events moved between this installation and one identity mount.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NookIdentityLogSyncOutcome {
    pub pulled_new_events: bool,
    pub pushed_new_events: bool,
}

impl NookVaultManager {
    /// The unlocked app key, or the localized authorization-required error.
    pub(in crate::manager) fn unlocked_app_key(&self) -> Result<AppKey, NookError> {
        if self.device.identity_private_key.is_empty() {
            return Err(NookError::Decryption(
                nook_core::i18n_keys::ERRORS_DEVICE_PROTECTION_AUTHORIZATION_REQUIRED.to_owned(),
            ));
        }
        self.device_identity()
    }
}

impl NookVaultManager {
    pub(in crate::manager) async fn current_identity_id(
        app_key: &AppKey,
    ) -> Result<IdentityId, NookError> {
        match NookDatabase::load_identity_directory()
            .await?
            .identity_for_app_key(app_key)
            .map_err(NookDatabase::map_domain_error)?
        {
            AppKeyIdentityMembership::Enrolled(identity_id) => Ok(identity_id),
            AppKeyIdentityMembership::Unenrolled => Err(NookError::Database(
                "This app key has no local identity.".to_owned(),
            )),
        }
    }

    /// The public member tuple this installation publishes in its identity.
    pub(in crate::manager) async fn own_identity_member_keys(
        &mut self,
        app_key: &AppKey,
    ) -> Result<IdentityMemberKeys, NookError> {
        let signing = self.ensure_signing_identity().await?;
        let directory = NookDatabase::load_identity_directory().await?;
        let label = directory
            .identities()
            .iter()
            .flat_map(|identity| identity.members.iter())
            .find(|member| &member.app_id == app_key.app_id())
            .map(|member| match &member.label {
                MemberLabelState::Named(label) => label.clone(),
                MemberLabelState::Unnamed => String::new(),
            })
            .unwrap_or_default();
        Ok(IdentityMemberKeys {
            app_id: app_key.app_id().clone(),
            encryption_public_key: app_key.public_key(),
            signing_public_key: signing.public_key(),
            label: MemberLabel::from_trusted(label),
        })
    }

    pub(in crate::manager) fn identity_event_time() -> Result<IsoTimestamp, NookError> {
        IsoTimestamp::parse(&crate::BrowserTimestamp::now().into_iso_string()).map_err(Into::into)
    }

    /// Sign operations as this installation and persist the event locally.
    /// The event must apply: an unauthorized append is an error, never a
    /// silently quarantined local write.
    pub(in crate::manager) async fn append_identity_operations(
        &mut self,
        operations: Vec<IdentityControlOperation>,
    ) -> Result<IdentityControlState, NookError> {
        let app_key = self.unlocked_app_key()?;
        let identity_id = Self::current_identity_id(&app_key).await?;
        let log = NookDatabase::load_identity_log(&identity_id).await?;
        let signing = self.ensure_signing_identity().await?;
        let created_at = Self::identity_event_time()?;
        let event = log.build_append(
            operations,
            &IdentityEventSigning {
                signing_key: signing.signing_key(),
                created_at: &created_at,
            },
        )?;
        let event_id = event.id()?;
        let bytes = event.serialize_storage_yaml()?;
        let inserted = log.insert(event).map_err(|rejection| rejection.cause)?;
        if inserted.status != IdentityEventInsertStatus::Applied {
            return Err(NookError::Database(format!(
                "Identity event did not apply: {:?}",
                inserted.status
            )));
        }
        NookDatabase::save_identity_events(IdentityLogWrite {
            identity_id: &identity_id,
            events: &[(event_id, bytes)],
        })
        .await?;
        let state = IdentityControlState::project(&inserted.log)?;
        Self::apply_identity_state_locally(&app_key, &state).await?;
        Ok(state)
    }

    /// Cache an active member's replicated membership and own DEK grants in
    /// the local directory. A pending or unlisted installation has nothing to
    /// cache; a revoked one is reported.
    pub(in crate::manager) async fn apply_identity_state_locally(
        app_key: &AppKey,
        state: &IdentityControlState,
    ) -> Result<(), NookError> {
        match ReplicatedIdentityStanding::of(state, app_key.app_id()) {
            ReplicatedIdentityStanding::PendingJoin | ReplicatedIdentityStanding::NotListed => {
                return Ok(());
            }
            ReplicatedIdentityStanding::ActiveMember | ReplicatedIdentityStanding::Revoked => {}
        }
        let projection = ReplicatedMembershipRequest { state, app_key }
            .project()
            .map_err(NookDatabase::map_domain_error)?;
        let identity_id = state.identity_id.clone();
        let app_key = app_key.clone();
        NookDatabase::update_identity_directory(move |directory| {
            let directory = directory
                .apply_replicated_membership(&ReplicatedIdentityMembership {
                    identity_id: &identity_id,
                    app_key: &app_key,
                    members: projection.members,
                    revoked: projection.revoked,
                    own_grants: projection.own_grants,
                })
                .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
            Ok(IdentityDirectoryWrite::from(directory))
        })
        .await
    }

    /// Union one identity log with the prepared provider's identity namespace.
    pub(in crate::manager) async fn union_identity_log_with_current_provider(
        &mut self,
        identity_id: &IdentityId,
    ) -> Result<(IdentityControlLog, NookIdentityLogSyncOutcome), NookError> {
        let location = EventLogLocation::Identity(identity_id.clone());
        let mut log = NookDatabase::load_identity_log(identity_id).await?;
        let remote_ids = self.list_provider_event_ids_at(&location).await?;
        let mut pulled = Vec::new();
        let missing = remote_ids
            .iter()
            .filter(|id| !log.contains(id))
            .cloned()
            .collect::<Vec<_>>();
        for event_id in &missing {
            let RemoteEventRead::Retrieved(bytes) =
                self.read_provider_event_at(&location, event_id).await?
            else {
                continue;
            };
            let event = nook_core::IdentityEvent::parse_storage_bytes(&bytes)?;
            if &event.id()? != event_id {
                return Err(NookError::Database(format!(
                    "Identity event {event_id} does not match its content."
                )));
            }
            log = log.insert(event).map_err(|rejection| rejection.cause)?.log;
            pulled.push((event_id.clone(), bytes));
        }
        NookDatabase::save_identity_events(IdentityLogWrite {
            identity_id,
            events: &pulled,
        })
        .await?;
        let mut pushed = false;
        for (event_id, bytes) in log.storage_bytes()? {
            if remote_ids.contains(&event_id) {
                continue;
            }
            self.put_provider_event_at(&location, &event_id, bytes.as_ref())
                .await?;
            pushed = true;
        }
        Ok((
            log,
            NookIdentityLogSyncOutcome {
                pulled_new_events: !pulled.is_empty(),
                pushed_new_events: pushed,
            },
        ))
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Union the current identity's control log with one identity mount and
    /// cache the result locally. `repo` is the Rust-built connect reference
    /// of the provider row, so its layout prefix is preserved.
    #[wasm_bindgen]
    pub async fn sync_identity_log_with_provider(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<tsify::Ts<NookIdentityLogSyncOutcome>, JsError> {
        let app_key = self.unlocked_app_key()?;
        let identity_id = Self::current_identity_id(&app_key).await?;
        let restore_local = self.storage.mode == StorageMode::Local;
        let result = async {
            self.prepare_storage_preserving_vault_metadata(
                &storage_mode,
                &github_pat,
                &github_repo,
            )
            .await?;
            let (log, outcome) = self
                .union_identity_log_with_current_provider(&identity_id)
                .await?;
            if !log.is_empty() {
                let state = IdentityControlState::project(&log)?;
                Self::apply_identity_state_locally(&app_key, &state).await?;
            }
            Ok::<_, NookError>(outcome)
        }
        .await;
        if restore_local {
            self.prepare_storage_preserving_vault_metadata("local", "", "")
                .await?;
        }
        Tsify::into_ts(&result?).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }

    /// The current identity as the Devices and Sync pages present it.
    #[wasm_bindgen]
    pub async fn identity_control_snapshot(
        &mut self,
        snapshot: &tsify::Ts<AuthProvidersSnapshotData>,
    ) -> Result<tsify::Ts<IdentityControlSnapshot>, JsError> {
        let providers = snapshot
            .to_rust()
            .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?
            .providers;
        let app_key = self.unlocked_app_key()?;
        let identity_id = Self::current_identity_id(&app_key).await?;
        let log = NookDatabase::load_identity_log(&identity_id).await?;
        let snapshot = if log.is_empty() {
            IdentityControlSnapshot::not_replicated(&identity_id)
        } else {
            IdentityControlSnapshot::project(&IdentityControlSnapshotRequest {
                state: &IdentityControlState::project(&log)?,
                current_app_id: app_key.app_id(),
                providers: &providers,
            })
        };
        Tsify::into_ts(&snapshot).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }
}
