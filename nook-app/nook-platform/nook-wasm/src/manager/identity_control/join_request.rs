//! Joining an identity by request.
//!
//! A browser that cannot open an identity it found on a sync provider writes
//! a self-signed join request for its fresh app key into that identity's log
//! there. A device of the identity approves it with every vault DEK or
//! denies it. The asking browser completes when the user lists again: once
//! its app key is a member, the identity is added under its original id,
//! through the same adoption an invite join uses.

use nook_core::{
    AppId, DriveEventParent, EventLogLocation, EventStorageBytes, IdentityConnectionKey,
    IdentityControlLog, IdentityControlState, IdentityId, IdentityInvitationBinding,
    IdentityInvitationBindingRequest, IdentityJoinAnswer, IdentityJoinCompletion,
    IdentityJoinCompletionPlan, IdentityJoinKey, IdentityJoinRequestPlan, IdentityJoinRequestWrite,
    PlacedNamespace, ProviderIdentityJoinRequest, StorageMode,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::connection::NookIdentityConnectionStart;
use super::{INVALID_TYPED_INPUT, UNENCODABLE_TYPED_OUTPUT};
use crate::manager::NookVaultManager;
use crate::manager::access_check::NookProviderSource;
use crate::storage::identity_log::IdentityLogWrite;
use crate::storage::identity_record::KeyringDbRebindLocalIdentity;
use crate::storage::local_folder::{LocalFolderEventWrite, LocalFolderHandles, OpenedLocalFolder};
use crate::storage::provider_vault_listing::DriveVaultListing;
use crate::storage::remote_event::RemoteEventRead;
use crate::{DriveStorageClient, NookDatabase, NookError};

/// A join request written into an identity's log at a provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NookIdentityJoinRequested {
    pub identity_id: String,
    /// The asking app key, as the identity's devices list it.
    pub app_id: String,
    /// When the request was written; asking again reports the first one.
    pub requested_at: String,
}

/// Where completing a join request left this browser.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum NookIdentityJoinCompletion {
    /// No device of the identity answered yet; nothing changed.
    Pending,
    /// Approved: the identity is on this browser under its original id.
    Approved,
    /// Denied: nothing changed.
    Denied,
}

/// An identity log's home at one source, opened once per operation.
enum OpenedIdentitySource<'a> {
    CurrentProvider,
    GoogleDrive {
        access_token: &'a str,
        root: DriveEventParent,
    },
    LocalFolder(OpenedLocalFolder),
}

/// One identity's log at an opened source.
struct IdentityLogAtSource<'a> {
    source: &'a OpenedIdentitySource<'a>,
    identity_id: &'a IdentityId,
}

impl NookVaultManager {
    async fn open_identity_source<'a>(
        &self,
        source: &'a NookProviderSource,
    ) -> Result<OpenedIdentitySource<'a>, NookError> {
        Ok(match source {
            NookProviderSource::CurrentProvider => {
                if self.storage.mode == StorageMode::Local {
                    return Err(NookError::Database(
                        "Connect a sync provider to reach this identity.".to_owned(),
                    ));
                }
                OpenedIdentitySource::CurrentProvider
            }
            NookProviderSource::GoogleDrive { access_token } => OpenedIdentitySource::GoogleDrive {
                access_token,
                root: DriveStorageClient::new(access_token)
                    .existing_nook_root()
                    .await?,
            },
            NookProviderSource::LocalFolder { handle_id } => OpenedIdentitySource::LocalFolder(
                LocalFolderHandles::current().open_folder(handle_id).await?,
            ),
        })
    }

    /// The identity's control log events at the source, not yet verified.
    async fn identity_events_at(
        &self,
        at: &IdentityLogAtSource<'_>,
    ) -> Result<Vec<EventStorageBytes>, NookError> {
        match at.source {
            OpenedIdentitySource::CurrentProvider => {
                let location = EventLogLocation::Identity(at.identity_id.clone());
                let mut events = Vec::new();
                for event_id in self.list_provider_event_ids_at(&location).await? {
                    if let RemoteEventRead::Retrieved(bytes) =
                        self.read_provider_event_at(&location, &event_id).await?
                    {
                        events.push(bytes);
                    }
                }
                Ok(events)
            }
            OpenedIdentitySource::GoogleDrive { access_token, root } => {
                DriveVaultListing {
                    token: access_token,
                    root,
                }
                .identity_events(at.identity_id)
                .await
            }
            OpenedIdentitySource::LocalFolder(folder) => Ok(folder
                .read_events(&PlacedNamespace::identity_log(at.identity_id.clone()))
                .await?
                .into_iter()
                .map(|file| EventStorageBytes::from(file.content.into_bytes()))
                .collect()),
        }
    }

    /// Put one signed event into the identity's log at the source.
    async fn put_identity_event_at(
        &self,
        at: &IdentityLogAtSource<'_>,
        write: &IdentityJoinRequestWrite,
    ) -> Result<(), NookError> {
        match at.source {
            OpenedIdentitySource::CurrentProvider => {
                self.put_provider_event_at(
                    &EventLogLocation::Identity(at.identity_id.clone()),
                    &write.event_id,
                    write.bytes.as_ref(),
                )
                .await
            }
            OpenedIdentitySource::GoogleDrive { access_token, root } => {
                DriveVaultListing {
                    token: access_token,
                    root,
                }
                .put_identity_event(at.identity_id, &write.event_id, write.bytes.as_ref())
                .await
            }
            OpenedIdentitySource::LocalFolder(folder) => {
                let content = String::from_utf8(write.bytes.as_ref().to_vec())
                    .map_err(|error| NookError::Serialization(error.to_string()))?;
                folder
                    .write_events(
                        &PlacedNamespace::identity_log(at.identity_id.clone()),
                        &[LocalFolderEventWrite {
                            event_id: write.event_id.as_str().to_owned(),
                            content,
                        }],
                    )
                    .await
            }
        }
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Start asking to join an identity. A fresh unlocked key asks itself; a
    /// key that already belongs to an identity stages a new local identity
    /// named `label`, whose protection ceremony creates the key that asks.
    /// A key already bound to the identity, or an identity another key here
    /// holds, is refused.
    #[wasm_bindgen]
    pub async fn begin_identity_join(
        &mut self,
        identity_id: String,
        label: &str,
    ) -> Result<tsify::Ts<NookIdentityConnectionStart>, JsError> {
        let invited = IdentityId::parse(&identity_id)?;
        let app_key = self.unlocked_app_key()?;
        let local_log = Self::local_identity_log(&app_key).await?;
        let key = IdentityJoinKey {
            directory: &NookDatabase::load_identity_directory().await?,
            app_key: &app_key,
            invited: &invited,
            local_log,
        }
        .choose()?;
        let start = match key {
            IdentityConnectionKey::CurrentAppKey => NookIdentityConnectionStart::CurrentKey,
            IdentityConnectionKey::NewAppKey => {
                self.begin_local_identity_creation(label).await?;
                NookIdentityConnectionStart::NewKeyStaged
            }
        };
        Tsify::into_ts(&start).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }

    /// Ask an identity found at a source to let this browser in. The unlocked
    /// app key must be a fresh one, as an invite join needs: a browser whose
    /// key already belongs to an identity first protects a new key for this
    /// one. The request carries public keys only and opens nothing until a
    /// device of the identity approves it.
    #[wasm_bindgen]
    pub async fn request_identity_join(
        &mut self,
        source: &tsify::Ts<NookProviderSource>,
        identity_id: String,
    ) -> Result<tsify::Ts<NookIdentityJoinRequested>, JsError> {
        let source = source
            .to_rust()
            .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?;
        let identity_id = IdentityId::parse(&identity_id)?;
        let app_key = self.unlocked_app_key()?;
        let local_log = Self::local_identity_log(&app_key).await?;
        let binding = NookDatabase::load_identity_directory()
            .await?
            .invitation_binding(&IdentityInvitationBindingRequest {
                app_key: &app_key,
                invited: &identity_id,
                local_log,
            })
            .map_err(NookDatabase::map_domain_error)?;
        if binding == IdentityInvitationBinding::AlreadyBound {
            return Err(NookError::Database(
                "This browser already belongs to the identity.".to_owned(),
            )
            .into());
        }
        let opened = self.open_identity_source(&source).await?;
        let at = IdentityLogAtSource {
            source: &opened,
            identity_id: &identity_id,
        };
        let events = self.identity_events_at(&at).await?;
        let member = self.own_identity_member_keys(&app_key).await?;
        let signing = self.ensure_signing_identity().await?;
        let created_at = Self::identity_event_time()?;
        let plan = ProviderIdentityJoinRequest {
            identity_id: &identity_id,
            events: &events,
            member: &member,
            signing: &signing,
            created_at: &created_at,
        }
        .plan()?;
        let requested_at = match plan {
            IdentityJoinRequestPlan::Write(write) => {
                self.put_identity_event_at(&at, &write).await?;
                write.requested_at
            }
            IdentityJoinRequestPlan::AlreadyPending { requested_at } => requested_at,
        };
        let requested = NookIdentityJoinRequested {
            identity_id: identity_id.as_str().to_owned(),
            app_id: app_key.app_id().as_str().to_owned(),
            requested_at: requested_at.as_str().to_owned(),
        };
        Tsify::into_ts(&requested).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }

    /// Read the identity's log at the source again. Once a device approved
    /// this browser's request, its fresh local identity takes the identity's
    /// original id beside any other identity here, and the log, membership,
    /// and vault DEKs are stored locally. A pending or denied request changes
    /// nothing.
    #[wasm_bindgen]
    pub async fn complete_identity_join(
        &mut self,
        source: &tsify::Ts<NookProviderSource>,
        identity_id: String,
    ) -> Result<tsify::Ts<NookIdentityJoinCompletion>, JsError> {
        let source = source
            .to_rust()
            .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?;
        let identity_id = IdentityId::parse(&identity_id)?;
        let app_key = self.unlocked_app_key()?;
        let opened = self.open_identity_source(&source).await?;
        let events = self
            .identity_events_at(&IdentityLogAtSource {
                source: &opened,
                identity_id: &identity_id,
            })
            .await?;
        if events.is_empty() {
            return Err(NookError::Database(
                "No identity log was found at this provider.".to_owned(),
            )
            .into());
        }
        let log = IdentityControlLog::new(identity_id.clone())
            .union_storage_bytes(&events)
            .map_err(|rejection| rejection.cause)?;
        let state = IdentityControlState::project(&log)?;
        let plan = IdentityJoinCompletion {
            directory: &NookDatabase::load_identity_directory().await?,
            app_key: &app_key,
            state: &state,
            local_log: Self::local_identity_log(&app_key).await?,
        }
        .plan()?;
        let completion = match plan {
            IdentityJoinCompletionPlan::Pending => NookIdentityJoinCompletion::Pending,
            IdentityJoinCompletionPlan::Denied => NookIdentityJoinCompletion::Denied,
            IdentityJoinCompletionPlan::Join(binding) => {
                if let IdentityInvitationBinding::Adopt { local_identity_id } = binding {
                    NookDatabase::rebind_local_identity(KeyringDbRebindLocalIdentity {
                        local_identity_id: &local_identity_id,
                        replicated_identity_id: &identity_id,
                    })
                    .await?;
                }
                NookDatabase::save_identity_events(IdentityLogWrite {
                    identity_id: &identity_id,
                    events: &log.storage_bytes()?,
                })
                .await?;
                Self::apply_identity_state_locally(&app_key, &state).await?;
                NookIdentityJoinCompletion::Approved
            }
        };
        Tsify::into_ts(&completion).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }

    /// Approve a device asking to join this identity: it becomes a member
    /// with every vault's current DEK wrapped to it. Fails when this
    /// installation cannot open one of the identity's vaults.
    #[wasm_bindgen]
    pub async fn approve_identity_join(&mut self, app_id: String) -> Result<(), JsError> {
        let app_id = AppId::parse(&app_id)?;
        let state = self.current_identity_state().await?;
        let app_key = self.unlocked_app_key()?;
        let operations = IdentityJoinAnswer {
            state: &state,
            approver: &app_key,
            app_id: &app_id,
        }
        .approval()?;
        self.append_identity_operations(operations).await?;
        Ok(())
    }

    /// Deny a device asking to join this identity.
    #[wasm_bindgen]
    pub async fn deny_identity_join(&mut self, app_id: String) -> Result<(), JsError> {
        let app_id = AppId::parse(&app_id)?;
        let state = self.current_identity_state().await?;
        let app_key = self.unlocked_app_key()?;
        let denial = IdentityJoinAnswer {
            state: &state,
            approver: &app_key,
            app_id: &app_id,
        }
        .denial()?;
        self.append_identity_operations(vec![denial]).await?;
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use nook_core::{AppKey, EventId, IdentityMemberKeys, MemberLabel, SigningIdentity};
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn js<T>(result: Result<T, JsError>) -> anyhow::Result<T> {
        result.map_err(|error| anyhow::anyhow!("{error:?}"))
    }

    fn folder_source(handle_id: &str) -> anyhow::Result<tsify::Ts<NookProviderSource>> {
        let source = NookProviderSource::LocalFolder {
            handle_id: handle_id.to_owned(),
        };
        Tsify::into_ts(&source).map_err(|error| anyhow::anyhow!("{error:?}"))
    }

    /// The identity in use and its control log, as this browser stores it.
    async fn identity_in_use() -> anyhow::Result<(IdentityId, Vec<(EventId, EventStorageBytes)>)> {
        let identity_id = NookDatabase::load_identity_directory()
            .await?
            .selected()?
            .identity_id
            .clone();
        let events = NookDatabase::load_identity_log(&identity_id)
            .await?
            .storage_bytes()?;
        Ok((identity_id, events))
    }

    /// Another app asks to join the identity: its request, signed by its own
    /// key on the log's heads, lands in this browser's copy of the log.
    async fn asking_app(identity_id: &IdentityId) -> anyhow::Result<AppId> {
        let app = AppKey::generate()?;
        let signer = SigningIdentity::generate()?.0;
        let member = IdentityMemberKeys {
            app_id: app.app_id().clone(),
            encryption_public_key: app.public_key(),
            signing_public_key: signer.public_key(),
            label: MemberLabel::from_trusted("Phone".to_owned()),
        };
        let events: Vec<EventStorageBytes> = NookDatabase::load_identity_log(identity_id)
            .await?
            .storage_bytes()?
            .into_iter()
            .map(|(_, bytes)| bytes)
            .collect();
        let created_at = NookVaultManager::identity_event_time()?;
        let IdentityJoinRequestPlan::Write(write) = (ProviderIdentityJoinRequest {
            identity_id,
            events: &events,
            member: &member,
            signing: &signer,
            created_at: &created_at,
        })
        .plan()?
        else {
            anyhow::bail!("a new app's first request is written");
        };
        NookDatabase::save_identity_events(IdentityLogWrite {
            identity_id,
            events: &[(write.event_id, write.bytes)],
        })
        .await?;
        Ok(app.app_id().clone())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn a_fresh_browser_asks_to_join_an_identity_in_a_folder_and_waits() -> anyhow::Result<()>
    {
        let folder = format!("join-{}", IdentityId::generate()?.as_str());
        let mut manager = NookVaultManager::new();
        // The identity's founder keeps its control log in the folder.
        js(manager.delete_local_browser_data().await)?;
        js(manager
            .finish_pin_device_protection("join founder pin".to_owned())
            .await)?;
        js(manager.ensure_identity_control_log().await)?;
        let (family, events) = identity_in_use().await?;
        let handles = LocalFolderHandles::current();
        handles.register_private_folder(&folder).await?;
        handles
            .write_identity_log(&folder, &family, &events)
            .await?;

        // Another browser, with a fresh key, finds it there and asks to join.
        js(manager.delete_local_browser_data().await)?;
        js(manager
            .finish_pin_device_protection("join asker pin".to_owned())
            .await)?;
        handles.register_private_folder(&folder).await?;
        let start = js(manager
            .begin_identity_join(family.as_str().to_owned(), "Family")
            .await)?
        .to_rust()
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(start, NookIdentityConnectionStart::CurrentKey);
        let source = folder_source(&folder)?;
        let requested = js(manager
            .request_identity_join(&source, family.as_str().to_owned())
            .await)?
        .to_rust()
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(requested.identity_id, family.as_str());
        // Asking again reports the first request instead of writing another.
        let again = js(manager
            .request_identity_join(&source, family.as_str().to_owned())
            .await)?
        .to_rust()
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(again, requested);

        // No device answered yet: completing changes nothing.
        let completion = js(manager
            .complete_identity_join(&source, family.as_str().to_owned())
            .await)?
        .to_rust()
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(completion, NookIdentityJoinCompletion::Pending);
        // An identity the folder holds no log for cannot be completed.
        assert!(
            manager
                .complete_identity_join(&source, IdentityId::generate()?.as_str().to_owned())
                .await
                .is_err()
        );
        js(manager.delete_local_browser_data().await)?;
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
    async fn a_device_of_the_identity_approves_one_asking_app_and_denies_another()
    -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        js(manager.delete_local_browser_data().await)?;
        js(manager
            .finish_pin_device_protection("join approver pin".to_owned())
            .await)?;
        js(manager.ensure_identity_control_log().await)?;
        let (family, _) = identity_in_use().await?;
        let approved = asking_app(&family).await?;
        let denied = asking_app(&family).await?;

        js(manager
            .approve_identity_join(approved.as_str().to_owned())
            .await)?;
        js(manager.deny_identity_join(denied.as_str().to_owned()).await)?;

        let state =
            IdentityControlState::project(&NookDatabase::load_identity_log(&family).await?)?;
        assert!(state.member(&approved).is_some());
        assert!(state.pending_join(&approved).is_none());
        assert!(state.member(&denied).is_none());
        assert!(state.denied_joins.contains(&denied));
        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }
}
