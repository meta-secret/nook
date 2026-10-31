//! Joining an identity by request.
//!
//! A browser that cannot open an identity it found on a sync provider writes
//! a self-signed join request for its fresh app key into that identity's log
//! there. A device of the identity approves it with every vault DEK or
//! denies it. The asking browser completes when the user lists again: once
//! its app key is a member, the identity is added under its original id,
//! through the same adoption an invite join uses.
//!
//! The browser extension completes the same way, from the log the web app
//! hands it after adding it to the keyring: its key is a member already.
//!
//! A browser whose key in use is already a member of the identity needs no
//! request: one tap of that key's passkey protects a new key for the
//! identity, and the key in use adds it (`add_identity_with_passkey_in_use`).

use nook_core::{
    AppId, AppKey, DriveEventParent, EventId, EventLogLocation, EventStorageBytes,
    IdentityConnectionKey, IdentityControlLog, IdentityControlState, IdentityId,
    IdentityInvitationBinding, IdentityInvitationBindingRequest, IdentityJoinAnswer,
    IdentityJoinCompletion, IdentityJoinCompletionPlan, IdentityJoinKey, IdentityJoinRequestPlan,
    IdentityMemberKeys, KeyInUseAddition, PasskeyDeviceProtectionMode, PasskeyRegistration,
    PasskeyRegistrationInput, PlacedNamespace, ProviderIdentityJoinRequest,
    ProviderIdentityKeyInUse, ProviderIdentityLogEvents, SigningIdentity, StorageMode,
    WebAuthnPrfInput, WebAuthnPrfOutput,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroizing;

use super::connection::NookIdentityConnectionStart;
use super::passkey_addition::NookIdentityAdded;
use super::{INVALID_TYPED_INPUT, UNENCODABLE_TYPED_OUTPUT};
use crate::manager::NookVaultManager;
use crate::manager::access_check::NookProviderSource;
use crate::storage::identity_log::IdentityLogWrite;
use crate::storage::identity_record::{
    KeyringDbRebindLocalIdentity, KeyringDbSaveAddedPasskeyIdentity, StoredIdentityProtection,
};
use crate::storage::local_folder::{LocalFolderEventWrite, LocalFolderHandles, OpenedLocalFolder};
use crate::storage::provider_vault_listing::DriveVaultListing;
use crate::storage::remote_event::RemoteEventRead;
use crate::{
    BrowserPasskeyClient, BrowserPasskeyRequestOptions, DriveStorageClient,
    IdentityDbEnsureLocalIdentityForAppKey, NookDatabase, NookError,
};

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

/// An identity's control log, read and not yet verified, for the app key
/// that completes its join.
struct IdentityJoinLog<'a> {
    identity_id: &'a IdentityId,
    app_key: &'a nook_core::AppKey,
    events: &'a [EventStorageBytes],
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

/// One signed identity event to put at a source.
#[derive(Clone, Copy)]
struct IdentityEventPut<'a> {
    event_id: &'a EventId,
    bytes: &'a EventStorageBytes,
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

    /// Verify the identity's log and complete the join it records for this
    /// app key: once the key is a member, its local identity takes the
    /// identity's id and the membership and DEK grants are kept here.
    async fn complete_join_from_log(
        join: IdentityJoinLog<'_>,
    ) -> Result<NookIdentityJoinCompletion, NookError> {
        let IdentityJoinLog {
            identity_id,
            app_key,
            events,
        } = join;
        let log = IdentityControlLog::new(identity_id.clone())
            .union_storage_bytes(events)
            .map_err(|rejection| rejection.cause)?;
        let state = IdentityControlState::project(&log)?;
        let plan = IdentityJoinCompletion {
            directory: &NookDatabase::load_identity_directory().await?,
            app_key,
            state: &state,
            local_log: Self::local_identity_log(app_key).await?,
        }
        .plan()?;
        Ok(match plan {
            IdentityJoinCompletionPlan::Pending => NookIdentityJoinCompletion::Pending,
            IdentityJoinCompletionPlan::Denied => NookIdentityJoinCompletion::Denied,
            IdentityJoinCompletionPlan::Join(binding) => {
                if let IdentityInvitationBinding::Adopt { local_identity_id } = binding {
                    NookDatabase::rebind_local_identity(KeyringDbRebindLocalIdentity {
                        local_identity_id: &local_identity_id,
                        replicated_identity_id: identity_id,
                    })
                    .await?;
                }
                NookDatabase::save_identity_events(IdentityLogWrite {
                    identity_id,
                    events: &log.storage_bytes()?,
                })
                .await?;
                Self::apply_identity_state_locally(app_key, &state).await?;
                NookIdentityJoinCompletion::Approved
            }
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
        event: &IdentityEventPut<'_>,
    ) -> Result<(), NookError> {
        let IdentityEventPut { event_id, bytes } = *event;
        match at.source {
            OpenedIdentitySource::CurrentProvider => {
                self.put_provider_event_at(
                    &EventLogLocation::Identity(at.identity_id.clone()),
                    event_id,
                    bytes.as_ref(),
                )
                .await
            }
            OpenedIdentitySource::GoogleDrive { access_token, root } => {
                DriveVaultListing {
                    token: access_token,
                    root,
                }
                .put_identity_event(at.identity_id, event_id, bytes.as_ref())
                .await
            }
            OpenedIdentitySource::LocalFolder(folder) => {
                let content = String::from_utf8(bytes.as_ref().to_vec())
                    .map_err(|error| NookError::Serialization(error.to_string()))?;
                folder
                    .write_events(
                        &PlacedNamespace::identity_log(at.identity_id.clone()),
                        &[LocalFolderEventWrite {
                            event_id: event_id.as_str().to_owned(),
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
                let put = IdentityEventPut {
                    event_id: &write.event_id,
                    bytes: &write.bytes,
                };
                self.put_identity_event_at(&at, &put).await?;
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
        let completion = Self::complete_join_from_log(IdentityJoinLog {
            identity_id: &identity_id,
            app_key: &app_key,
            events: &events,
        })
        .await?;
        Tsify::into_ts(&completion).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }

    /// Join the keyring the web app just added this app to, from the
    /// keyring's control log it handed over: this app's own key is a member
    /// there with every vault DEK, so its local identity takes the
    /// keyring's id. The browser extension does this; nothing is read from a
    /// provider.
    #[wasm_bindgen]
    pub async fn join_identity_from_log(
        &mut self,
        identity_id: String,
        member_label: String,
        events: Vec<String>,
    ) -> Result<(), JsError> {
        let identity_id = IdentityId::parse(&identity_id)?;
        let app_key = self.unlocked_app_key()?;
        let events = events
            .into_iter()
            .map(|event| EventStorageBytes::from(event.into_bytes()))
            .collect::<Vec<_>>();
        if events.is_empty() {
            return Err(
                NookError::Database("The web app handed over no identity log.".to_owned()).into(),
            );
        }
        NookDatabase::ensure_local_identity_for_app_key(IdentityDbEnsureLocalIdentityForAppKey {
            app_key: &app_key,
            label: &member_label,
        })
        .await?;
        match Self::complete_join_from_log(IdentityJoinLog {
            identity_id: &identity_id,
            app_key: &app_key,
            events: &events,
        })
        .await?
        {
            NookIdentityJoinCompletion::Approved => Ok(()),
            NookIdentityJoinCompletion::Pending | NookIdentityJoinCompletion::Denied => {
                Err(NookError::Database(
                    "The web app has not added this app to the keyring.".to_owned(),
                )
                .into())
            }
        }
    }

    /// Add an identity found at a source whose member key is the key in use
    /// here, which already holds the identity in use. One tap of the passkey
    /// that protects the key in use wraps a new key for the identity, and
    /// the key in use, a member, adds that key itself on this device. The
    /// identity is added under its original id beside the one in use, which
    /// stays selected; no other device answers. A key in use that is no
    /// member is refused before the passkey is asked for.
    #[wasm_bindgen]
    pub async fn add_identity_with_passkey_in_use(
        &mut self,
        source: &tsify::Ts<NookProviderSource>,
        identity_id: String,
        rp_id: &str,
    ) -> Result<tsify::Ts<NookIdentityAdded>, JsError> {
        let source = source
            .to_rust()
            .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?;
        let identity_id = IdentityId::parse(&identity_id)?;
        let key_in_use = self.unlocked_app_key()?;
        let in_use_member = self.own_identity_member_keys(&key_in_use).await?;
        let key_in_use_signing = self.ensure_signing_identity().await?;
        let opened = self.open_identity_source(&source).await?;
        let at = IdentityLogAtSource {
            source: &opened,
            identity_id: &identity_id,
        };
        let mut events = self.identity_events_at(&at).await?;
        let membership = ProviderIdentityKeyInUse {
            identity_id: &identity_id,
            events: &events,
            key_in_use: &key_in_use,
        }
        .verify()?;
        let StoredIdentityProtection::Protected(entry) =
            NookDatabase::load_entry_for_app_id(key_in_use.app_id()).await?
        else {
            return Err(NookError::Database(
                "The key in use here has no passkey to protect another keyring.".to_owned(),
            )
            .into());
        };
        let credential_id = entry.wrapped_app_key().credential_id()?;
        let user_handle = entry.wrapped_app_key().user_handle()?;
        let prf_input = WebAuthnPrfInput::deterministic();
        let request_options =
            BrowserPasskeyClient::request_options(BrowserPasskeyRequestOptions {
                rp_id,
                credential_id: credential_id.as_ref(),
                prf_input: prf_input.as_ref(),
            })?;
        let credential = BrowserPasskeyClient::get_credential(&request_options).await?;
        let prf_output = Zeroizing::new(BrowserPasskeyClient::require_prf_output(&credential)?);
        let material = PasskeyRegistration::new(PasskeyRegistrationInput {
            credential_id: &credential_id,
            user_handle: &user_handle,
            prf_input: &prf_input,
            mode: PasskeyDeviceProtectionMode::AntiHacker,
        })
        .complete(&WebAuthnPrfOutput::try_from(prf_output.to_vec())?)?;
        let new_key = AppKey::from_secret_str(material.identity_secret())?;
        let (new_signing, new_signer) = SigningIdentity::generate()?;
        let new_member = IdentityMemberKeys {
            app_id: new_key.app_id().clone(),
            encryption_public_key: new_key.public_key(),
            signing_public_key: new_signing.public_key(),
            label: in_use_member.label,
        };
        let write = membership.addition(&KeyInUseAddition {
            member: &new_member,
            signing: &key_in_use_signing,
            created_at: &Self::identity_event_time()?,
        })?;
        let put = IdentityEventPut {
            event_id: &write.event_id,
            bytes: &write.bytes,
        };
        self.put_identity_event_at(&at, &put).await?;
        events.push(write.bytes);
        let selection =
            NookDatabase::save_added_passkey_identity(KeyringDbSaveAddedPasskeyIdentity {
                app_key: &new_key,
                record: material.record(),
                signer: &new_signer,
                identity_id: &identity_id,
                identity_logs: &[ProviderIdentityLogEvents {
                    identity_id: identity_id.clone(),
                    events,
                }],
            })
            .await?;
        Tsify::into_ts(&NookIdentityAdded {
            identity_id,
            selection,
        })
        .map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
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
