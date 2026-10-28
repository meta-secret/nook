//! Identity-level device onboarding and sync-provider mounts.
//!
//! The replicated identity control log is the membership authority. This
//! manager signs identity events with the installation's event signer, stores
//! them in `nook_db.events`, unions them with every identity mount, and caches
//! the resulting membership and this installation's DEK grants in the local
//! identity directory.

mod connection;
mod invite;
mod join_request;
mod log_creation;
mod membership;
mod merge;
mod vault_access;
mod vault_removal;

use nook_core::i18n_keys;
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
                i18n_keys::ERRORS_DEVICE_PROTECTION_AUTHORIZATION_REQUIRED.to_owned(),
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
                    removed_vaults: projection.removed_vaults,
                })
                .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
            Ok(IdentityDirectoryWrite::from(directory))
        })
        .await?;
        // A vault deleted from the identity everywhere leaves this browser too.
        for store_id in &state.removed_vaults {
            NookDatabase::forget_vault_removed_from_identity(store_id.as_str()).await?;
        }
        Ok(())
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
    /// cache the result locally.
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
        let snapshot = self.current_identity_snapshot(&providers).await?;
        Tsify::into_ts(&snapshot).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }
}

impl NookVaultManager {
    /// Project the current identity's log for this installation.
    pub(in crate::manager) async fn current_identity_snapshot(
        &self,
        providers: &[nook_core::StorageProviderData],
    ) -> Result<IdentityControlSnapshot, NookError> {
        let app_key = self.unlocked_app_key()?;
        let identity_id = Self::current_identity_id(&app_key).await?;
        let log = NookDatabase::load_identity_log(&identity_id).await?;
        let identity_label = NookDatabase::load_identity_directory()
            .await?
            .identities()
            .iter()
            .find(|record| record.identity_id == identity_id)
            .map(|record| record.label.clone())
            .unwrap_or_default();
        Ok(if log.is_empty() {
            IdentityControlSnapshot::not_replicated(&identity_id, &identity_label)
        } else {
            IdentityControlSnapshot::project(&IdentityControlSnapshotRequest {
                state: &IdentityControlState::project(&log)?,
                identity_label: &identity_label,
                current_app_id: app_key.app_id(),
                providers,
            })
        })
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::invite::InviteJoinOperation;
    use super::log_creation::NookIdentityLogEnsureOutcome;
    use super::*;
    use crate::{NookEnrollmentIssueInput, NookEnrollmentProvider};
    use nook_core::{
        ActiveVaultScope, CheckedEnrollmentEnvelope, EnrollmentInvite, ProviderSyncCheckpoint,
        ProviderVaultScope, SigningIdentity, StorageProviderData, StorageProviderType,
        StoredGithubPat, StoredGithubRepository, StoredLocalFolderConfiguration,
        StoredOAuthFileConfiguration,
    };
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    const INVITE_PASSPHRASE: &str = "invite passphrase";

    /// An installation that is not yet part of the founder's identity.
    struct Joiner {
        app: AppKey,
        signer: SigningIdentity,
    }

    impl Joiner {
        fn new() -> anyhow::Result<Self> {
            Ok(Self {
                app: AppKey::generate()?,
                signer: SigningIdentity::generate()?.0,
            })
        }

        /// Sign this installation into the founder's local log with an
        /// invite, as a union with a mount would deliver it.
        async fn join_with_invite(
            &self,
            identity_id: &IdentityId,
            invite: &EnrollmentInvite,
        ) -> anyhow::Result<()> {
            let log = NookDatabase::load_identity_log(identity_id).await?;
            let at = IsoTimestamp::from_trusted("2026-10-13T00:00:00Z".to_owned());
            let operation = InviteJoinOperation {
                identity_id,
                invite,
                member: &IdentityMemberKeys {
                    app_id: self.app.app_id().clone(),
                    encryption_public_key: self.app.public_key(),
                    signing_public_key: self.signer.public_key(),
                    label: MemberLabel::from_trusted(String::new()),
                },
            }
            .operation()
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
            let event = log.build_append(
                vec![operation],
                &IdentityEventSigning {
                    signing_key: self.signer.signing_key(),
                    created_at: &at,
                },
            )?;
            NookDatabase::save_identity_events(IdentityLogWrite {
                identity_id,
                events: &[(event.id()?, event.serialize_storage_yaml()?)],
            })
            .await?;
            Ok(())
        }
    }

    /// A PIN-protected installation with one local vault.
    struct Founder {
        manager: NookVaultManager,
    }

    impl Founder {
        async fn new(pin: &str) -> anyhow::Result<Self> {
            let mut manager = NookVaultManager::new();
            Founder::js(manager.delete_local_browser_data().await)?;
            Founder::js(manager.finish_pin_device_protection(pin.to_owned()).await)?;
            Founder::js(
                manager
                    .connect_fresh("local".to_owned(), String::new(), String::new())
                    .await,
            )?;
            Ok(Self { manager })
        }

        fn js<T>(result: Result<T, JsError>) -> anyhow::Result<T> {
            result.map_err(|error| anyhow::anyhow!("{error:?}"))
        }

        fn store_id(&self) -> String {
            self.manager.vault.store_id.clone()
        }

        fn providers(&self) -> anyhow::Result<tsify::Ts<AuthProvidersSnapshotData>> {
            let row = StorageProviderData {
                id: "github-personal".to_owned(),
                provider_type: StorageProviderType::Github,
                label: "GitHub".to_owned(),
                github_pat: StoredGithubPat::Token("github_pat_fixture".to_owned()),
                github_repo: StoredGithubRepository::Repository("owner/personal".to_owned()),
                oauth_file: StoredOAuthFileConfiguration::NotApplicable,
                local_folder: StoredLocalFolderConfiguration::NotApplicable,
                store_id: ProviderVaultScope::Unscoped,
                sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                created_at: "2026-10-13T00:00:00Z".to_owned(),
            };
            Tsify::into_ts(&AuthProvidersSnapshotData {
                providers: vec![row],
                active_vault_store_id: ActiveVaultScope::Unselected,
            })
            .map_err(|error| anyhow::anyhow!("{error:?}"))
        }

        async fn issue_code(&mut self, identity_id: &IdentityId) -> anyhow::Result<String> {
            let input = NookEnrollmentIssueInput::for_identity(
                NookEnrollmentProvider::local(),
                identity_id.as_str().to_owned(),
                "Work".to_owned(),
                "entry-1".to_owned(),
                "2026-10-13T00:00:00Z".to_owned(),
            );
            Founder::js(
                self.manager
                    .issue_identity_invite_code(&input, INVITE_PASSPHRASE.to_owned())
                    .await,
            )
        }

        /// Issue an invite code and open it as its holder would.
        async fn issue_invite(
            &mut self,
            identity_id: &IdentityId,
        ) -> anyhow::Result<EnrollmentInvite> {
            let code = self.issue_code(identity_id).await?;
            Ok(CheckedEnrollmentEnvelope::parse(&code)?
                .decrypt(INVITE_PASSPHRASE)?
                .invite)
        }

        async fn snapshot(&mut self) -> anyhow::Result<IdentityControlSnapshot> {
            let providers = self.providers()?;
            Founder::js(self.manager.identity_control_snapshot(&providers).await)?
                .to_rust()
                .map_err(|error| anyhow::anyhow!("{error:?}"))
        }
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn founder_replicates_its_identity_and_manages_member_apps() -> anyhow::Result<()> {
        let mut founder = Founder::new("identity founder pin").await?;
        let created = Founder::js(founder.manager.ensure_identity_control_log().await)?
            .to_rust()
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(created, NookIdentityLogEnsureOutcome::Created);
        let existing = Founder::js(founder.manager.ensure_identity_control_log().await)?
            .to_rust()
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(existing, NookIdentityLogEnsureOutcome::Existing);

        // The new log lists only its founder; the open vault joins it when
        // reconciled, and a second reconcile has nothing left to record.
        assert!(founder.snapshot().await?.vaults.is_empty());
        assert!(Founder::js(
            founder
                .manager
                .reconcile_open_vault_with_identity_log()
                .await
        )?);
        assert!(!Founder::js(
            founder
                .manager
                .reconcile_open_vault_with_identity_log()
                .await
        )?);

        let snapshot = founder.snapshot().await?;
        assert_eq!(snapshot.members.len(), 1);
        let [vault] = snapshot.vaults.as_slice() else {
            anyhow::bail!("the founder's identity owns one vault");
        };
        assert_eq!(vault.store_id, founder.store_id());
        assert!(vault.granted_to_current_installation);

        // The remote provider becomes a recorded mount once.
        let providers = founder.providers()?;
        assert!(Founder::js(
            founder
                .manager
                .record_identity_provider_mounts(&providers)
                .await
        )?);
        assert!(!Founder::js(
            founder
                .manager
                .record_identity_provider_mounts(&providers)
                .await
        )?);
        let mounted = founder.snapshot().await?;
        let [mount] = mounted.mounts.as_slice() else {
            anyhow::bail!("one mount is recorded");
        };
        assert!(mount.connected_here);
        let replicating = Founder::js(
            founder
                .manager
                .identity_replication_providers(&providers)
                .await,
        )?
        .to_rust()
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(replicating.providers.len(), 1);
        let vault_row = Founder::js(
            founder
                .manager
                .identity_vault_provider(&providers, &founder.store_id()),
        )?
        .to_rust()
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(vault_row.id, "github-personal");
        // Every identity mount replicates each of its vaults; a malformed id names none.
        assert!(
            founder
                .manager
                .identity_vault_provider(&providers, "not a store")
                .is_err()
        );
        // An empty provider snapshot records no mount.
        let empty = Tsify::into_ts(&AuthProvidersSnapshotData {
            providers: Vec::new(),
            active_vault_store_id: ActiveVaultScope::Unselected,
        })
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert!(!Founder::js(
            founder
                .manager
                .record_identity_provider_mounts(&empty)
                .await
        )?);
        // A browser-local row is never an identity mount.
        let local_row = Tsify::into_ts(&StorageProviderData {
            provider_type: StorageProviderType::Local,
            ..vault_row.clone()
        })
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert!(!Founder::js(
            founder
                .manager
                .remove_identity_provider_mount(&local_row)
                .await
        )?);
        // An invitation must name a valid identity.
        assert!(
            founder
                .manager
                .bind_local_identity_to_invitation("not-an-identity".to_owned())
                .await
                .is_err()
        );

        // An invite holder joins with the vault DEK and no approval, is
        // renamed, then revoked.
        let identity_id = IdentityId::parse(&snapshot.identity_id)?;
        let invite = founder.issue_invite(&identity_id).await?;
        assert_eq!(invite.vaults.len(), 1);
        let phone = Joiner::new()?;
        phone.join_with_invite(&identity_id, &invite).await?;
        let phone_id = phone.app.app_id().as_str().to_owned();
        let joined = founder.snapshot().await?;
        assert_eq!(joined.members.len(), 2);
        assert!(
            joined
                .vaults
                .iter()
                .all(|vault| vault.members_missing_dek.is_empty())
        );
        Founder::js(
            founder
                .manager
                .rename_identity_member(phone_id.clone(), "Phone".to_owned())
                .await,
        )?;
        assert!(
            founder
                .snapshot()
                .await?
                .members
                .iter()
                .any(|member| member.label == "Phone")
        );
        Founder::js(founder.manager.revoke_identity_member(phone_id).await)?;
        assert_eq!(founder.snapshot().await?.members.len(), 1);

        // A fresh invite admits another installation.
        let tablet = Joiner::new()?;
        let second = founder.issue_invite(&identity_id).await?;
        assert_ne!(second.invite_id, invite.invite_id);
        tablet.join_with_invite(&identity_id, &second).await?;
        assert_eq!(founder.snapshot().await?.members.len(), 2);

        // The browser-local cache has no remote namespace to union with.
        Founder::js(
            founder
                .manager
                .sync_identity_log_with_provider("local".to_owned(), String::new(), String::new())
                .await,
        )?;

        // An identity that owns a vault cannot be rebound to an invitation.
        assert!(
            founder
                .manager
                .bind_local_identity_to_invitation(IdentityId::generate()?.as_str().to_owned())
                .await
                .is_err()
        );

        let removal = founder.providers()?;
        let row = removal
            .to_rust()
            .map_err(|error| anyhow::anyhow!("{error:?}"))?
            .providers
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("fixture row"))?;
        let row = Tsify::into_ts(&row).map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert!(Founder::js(
            founder.manager.remove_identity_provider_mount(&row).await
        )?);
        assert!(founder.snapshot().await?.mounts.is_empty());

        // A member joining with an invite is already satisfied.
        let code = founder.issue_code(&identity_id).await?;
        Founder::js(
            founder
                .manager
                .join_identity_with_invite(
                    code,
                    INVITE_PASSPHRASE.to_owned(),
                    "local".to_owned(),
                    String::new(),
                    String::new(),
                )
                .await,
        )?;
        Founder::js(founder.manager.delete_local_browser_data().await)?;
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn a_fresh_app_binds_its_local_identity_to_an_invitation() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        Founder::js(manager.delete_local_browser_data().await)?;
        Founder::js(
            manager
                .finish_pin_device_protection("identity joiner pin".to_owned())
                .await,
        )?;
        let invited = IdentityId::generate()?;
        Founder::js(
            manager
                .bind_local_identity_to_invitation(invited.as_str().to_owned())
                .await,
        )?;
        // Binding again to the same identity is a no-op.
        Founder::js(
            manager
                .bind_local_identity_to_invitation(invited.as_str().to_owned())
                .await,
        )?;
        let app_key = manager.unlocked_app_key()?;
        assert_eq!(
            NookVaultManager::current_identity_id(&app_key).await?,
            invited
        );
        let empty = Tsify::into_ts(&AuthProvidersSnapshotData {
            providers: Vec::new(),
            active_vault_store_id: ActiveVaultScope::Unselected,
        })
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        let snapshot = Founder::js(manager.identity_control_snapshot(&empty).await)?
            .to_rust()
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(snapshot.identity_id, invited.as_str());
        assert!(snapshot.members.is_empty());
        Founder::js(manager.delete_local_browser_data().await)?;
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn a_device_that_only_has_the_event_log_learns_the_vault_name() -> anyhow::Result<()> {
        let mut founder = Founder::new("vault name pin").await?;
        let store_id = founder.store_id();
        assert!(founder.manager.set_vault_name(" ").await.is_err());
        Founder::js(founder.manager.set_vault_name("  Family  ").await)?;

        // A device that joined the identity holds the vault keys and events
        // but no name of its own, and lists the vault under its id.
        founder.manager.vault.vault_name = super::super::VaultNameState::Unnamed;
        founder.manager.vault.projected_name = nook_core::ProjectedVaultName::Unnamed;
        NookDatabase::set_local_vault_label(
            crate::storage::indexed_db::SetLocalVaultLabelRequest {
                store_id: &store_id,
                label: "Vault placeholder",
            },
        )
        .await?;

        founder.manager.adopt_vault_name_from_events().await?;
        founder
            .manager
            .label_local_vault_with_projected_name()
            .await?;
        assert!(matches!(
            &founder.manager.vault.vault_name,
            super::super::VaultNameState::Named(name) if name == "Family"
        ));
        let listed = NookDatabase::list_vault_registry_entries()
            .await?
            .into_iter()
            .find(|entry| entry.store_id == store_id)
            .ok_or_else(|| anyhow::anyhow!("the vault stays registered"))?;
        assert_eq!(listed.label, "Family");
        Founder::js(founder.manager.delete_local_browser_data().await)?;
        Ok(())
    }
}
