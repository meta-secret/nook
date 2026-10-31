//! Asking an identity this browser cannot open to let one app key in.
//!
//! The request is a self-signed `member-join-requested` carrying the asking
//! app key's public member keys only. It goes on top of the identity log's
//! applicable heads at the provider, so a device of the identity that syncs
//! the log sees it and answers it. Until a member approves it, the request
//! opens nothing.
//!
//! A browser that already holds a member key of the identity, as the key of
//! another keyring here made from the same passkey, needs no answer: that
//! key adds the asking key itself, on its own device, as the web app adds
//! the browser extension.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::errors::VaultResult;
use crate::{
    AppKey, EventError, EventId, EventStorageBytes, IdentityControlLog, IdentityControlOperation,
    IdentityControlState, IdentityEventInsertStatus, IdentityEventSigning, IdentityId,
    IdentityMemberAdd, IdentityMemberKeys, IsoTimestamp, ReplicatedIdentityStanding,
    SigningIdentity,
};

/// A member key of the identity this browser holds beside the asking key.
#[derive(Clone, Copy)]
pub enum IdentityJoinSponsor<'a> {
    /// None here: a device of the identity answers the request.
    None,
    /// The key in use when the join began, with its event signer. It adds
    /// the asking key when the identity lists it as a member.
    Held {
        app_key: &'a AppKey,
        signing: &'a SigningIdentity,
    },
}

/// One identity's log at a provider and the app key asking to join it.
pub struct ProviderIdentityJoinRequest<'a> {
    pub identity_id: &'a IdentityId,
    /// The identity's control log events, as the provider holds them.
    pub events: &'a [EventStorageBytes],
    /// The asking app key's public member keys.
    pub member: &'a IdentityMemberKeys,
    /// The asking app key's event signer; it signs its own request.
    pub signing: &'a SigningIdentity,
    pub created_at: &'a IsoTimestamp,
    pub sponsor: IdentityJoinSponsor<'a>,
}

/// The signed request to put into the identity's log at the provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityJoinRequestWrite {
    pub event_id: EventId,
    pub bytes: EventStorageBytes,
    pub requested_at: IsoTimestamp,
}

/// A member key's addition of the asking key, to put into the identity's
/// log at the provider. The asking key is a member once it is there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityJoinAdditionWrite {
    pub event_id: EventId,
    pub bytes: EventStorageBytes,
}

/// What asking to join writes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityJoinRequestPlan {
    /// Put this self-signed request into the identity's log.
    Write(IdentityJoinRequestWrite),
    /// The app key already asked, and no member answered yet.
    AlreadyPending { requested_at: IsoTimestamp },
    /// A member key held here added the asking key: put its addition there.
    Added(IdentityJoinAdditionWrite),
}

impl ProviderIdentityJoinRequest<'_> {
    fn refused(reason: &str) -> EventError {
        EventError::IdentityControlInvalid(reason.to_owned())
    }

    /// Sign the operations on the log's heads; they must apply there.
    fn appended(
        &self,
        log: IdentityControlLog,
        operations: Vec<IdentityControlOperation>,
        signing: &SigningIdentity,
    ) -> VaultResult<(EventId, EventStorageBytes)> {
        let event = log.build_append(
            operations,
            &IdentityEventSigning {
                signing_key: signing.signing_key(),
                created_at: self.created_at,
            },
        )?;
        let event_id = event.id()?;
        let bytes = event.serialize_storage_yaml()?;
        let inserted = log.insert(event).map_err(|rejection| rejection.cause)?;
        if inserted.status != IdentityEventInsertStatus::Applied {
            return Err(Self::refused("the join does not apply to the identity log").into());
        }
        Ok((event_id, bytes))
    }

    /// Verify the provider's log and sign on its heads: the addition by a
    /// member key held here, otherwise the request. A member, a removed app
    /// key, or a log the provider does not hold is refused.
    pub fn plan(&self) -> VaultResult<IdentityJoinRequestPlan> {
        if self.events.is_empty() {
            return Err(
                Self::refused("the provider holds no control log for this identity").into(),
            );
        }
        let log = IdentityControlLog::new(self.identity_id.clone())
            .union_storage_bytes(self.events)
            .map_err(|rejection| rejection.cause)?;
        let state = IdentityControlState::project(&log)?;
        let app_id = &self.member.app_id;
        match ReplicatedIdentityStanding::of(&state, app_id) {
            ReplicatedIdentityStanding::ActiveMember => {
                return Err(
                    Self::refused("this app key is already a member of the identity").into(),
                );
            }
            ReplicatedIdentityStanding::Revoked => {
                return Err(Self::refused("this app key was removed from the identity").into());
            }
            ReplicatedIdentityStanding::PendingJoin => {
                let requested_at = state
                    .pending_join(app_id)
                    .map(|request| request.requested_at.clone())
                    .ok_or_else(|| Self::refused("the pending join request disappeared"))?;
                return Ok(IdentityJoinRequestPlan::AlreadyPending { requested_at });
            }
            ReplicatedIdentityStanding::NotListed => {}
        }
        if let IdentityJoinSponsor::Held { app_key, signing } = self.sponsor
            && state.member(app_key.app_id()).is_some()
        {
            let operations = IdentityMemberAdd {
                state: &state,
                approver: app_key,
                member: self.member,
            }
            .addition()?;
            let (event_id, bytes) = self.appended(log, operations, signing)?;
            return Ok(IdentityJoinRequestPlan::Added(IdentityJoinAdditionWrite {
                event_id,
                bytes,
            }));
        }
        let (event_id, bytes) = self.appended(
            log,
            vec![IdentityControlOperation::MemberJoinRequested {
                member: self.member.clone(),
            }],
            self.signing,
        )?;
        Ok(IdentityJoinRequestPlan::Write(IdentityJoinRequestWrite {
            event_id,
            bytes,
            requested_at: self.created_at.clone(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{IdentityEvent, IdentityGenesisRequest, MemberDevice};
    use nook_auth2::MemberLabel;

    struct Device {
        app: AppKey,
        signer: SigningIdentity,
    }

    impl Device {
        fn new() -> anyhow::Result<Self> {
            Ok(Self {
                app: AppKey::generate()?,
                signer: SigningIdentity::generate()?.0,
            })
        }

        fn keys(&self) -> IdentityMemberKeys {
            IdentityMemberKeys {
                app_id: self.app.app_id().clone(),
                encryption_public_key: self.app.public_key(),
                signing_public_key: self.signer.public_key(),
                label: MemberLabel::from_trusted("Phone".to_owned()),
            }
        }
    }

    struct ProviderLog {
        founder: Device,
        log: IdentityControlLog,
        at: IsoTimestamp,
    }

    impl ProviderLog {
        fn founded() -> anyhow::Result<Self> {
            let founder = Device::new()?;
            let at = IsoTimestamp::from_trusted("2026-10-27T09:00:00Z".to_owned());
            let identity_id = IdentityId::generate()?;
            let log = IdentityControlLog::new(identity_id.clone())
                .insert(IdentityEvent::genesis(IdentityGenesisRequest {
                    identity_id: &identity_id,
                    founder: founder.keys(),
                    signing: IdentityEventSigning {
                        signing_key: founder.signer.signing_key(),
                        created_at: &at,
                    },
                })?)?
                .log;
            Ok(Self { founder, log, at })
        }

        fn events(&self) -> anyhow::Result<Vec<EventStorageBytes>> {
            Ok(self
                .log
                .storage_bytes()?
                .into_iter()
                .map(|(_, bytes)| bytes)
                .collect())
        }

        fn ask(&self, device: &Device) -> anyhow::Result<IdentityJoinRequestPlan> {
            Ok(ProviderIdentityJoinRequest {
                identity_id: self.log.identity_id(),
                events: &self.events()?,
                member: &device.keys(),
                signing: &device.signer,
                created_at: &self.at,
                sponsor: IdentityJoinSponsor::None,
            }
            .plan()?)
        }

        /// Ask with a key of another keyring held beside the asking one.
        fn ask_beside(
            &self,
            device: &Device,
            held: &Device,
        ) -> anyhow::Result<IdentityJoinRequestPlan> {
            Ok(ProviderIdentityJoinRequest {
                identity_id: self.log.identity_id(),
                events: &self.events()?,
                member: &device.keys(),
                signing: &device.signer,
                created_at: &self.at,
                sponsor: IdentityJoinSponsor::Held {
                    app_key: &held.app,
                    signing: &held.signer,
                },
            }
            .plan()?)
        }

        fn put(&mut self, write: &IdentityJoinRequestWrite) -> anyhow::Result<()> {
            self.put_event(&write.event_id, &write.bytes)
        }

        fn put_event(&mut self, id: &EventId, bytes: &EventStorageBytes) -> anyhow::Result<()> {
            let event = IdentityEvent::parse_storage_bytes(bytes)?;
            assert_eq!(&event.id()?, id);
            self.log = self.log.clone().insert(event)?.log;
            Ok(())
        }
    }

    #[test]
    fn a_member_key_held_here_adds_the_asking_key_on_its_own_device() -> anyhow::Result<()> {
        let mut provider = ProviderLog::founded()?;
        let asking = Device::new()?;

        // The founder's key holds another keyring on this browser.
        let IdentityJoinRequestPlan::Added(write) =
            provider.ask_beside(&asking, &provider.founder)?
        else {
            anyhow::bail!("a member key held here must add the asking key");
        };
        provider.put_event(&write.event_id, &write.bytes)?;
        let state = IdentityControlState::project(&provider.log)?;
        let member = state
            .member(asking.app.app_id())
            .ok_or_else(|| anyhow::anyhow!("the asking key must be a member"))?;
        assert_eq!(
            member.device,
            MemberDevice::SameAs {
                app_id: provider.founder.app.app_id().clone(),
            }
        );
        assert!(state.pending_joins.is_empty());
        // Both keys run on this browser: still one device.
        assert_eq!(state.device_members().count(), 1);
        Ok(())
    }

    #[test]
    fn a_held_key_that_is_no_member_leaves_the_request_to_the_identity() -> anyhow::Result<()> {
        let provider = ProviderLog::founded()?;
        let asking = Device::new()?;
        let stranger = Device::new()?;
        assert!(matches!(
            provider.ask_beside(&asking, &stranger)?,
            IdentityJoinRequestPlan::Write(_)
        ));
        Ok(())
    }

    #[test]
    fn a_locked_browser_asks_once_and_its_request_waits_for_a_member() -> anyhow::Result<()> {
        let mut provider = ProviderLog::founded()?;
        let asking = Device::new()?;

        let IdentityJoinRequestPlan::Write(write) = provider.ask(&asking)? else {
            anyhow::bail!("a browser outside the identity must write its request");
        };
        provider.put(&write)?;
        let state = IdentityControlState::project(&provider.log)?;
        let pending = state
            .pending_join(asking.app.app_id())
            .ok_or_else(|| anyhow::anyhow!("the request must be pending"))?;
        assert_eq!(pending.member, asking.keys());
        // The request opens nothing: the asking key is no member yet.
        assert!(state.member(asking.app.app_id()).is_none());
        assert_eq!(state.members.len(), 1);

        // Asking again reports the unanswered request instead of a second one.
        assert_eq!(
            provider.ask(&asking)?,
            IdentityJoinRequestPlan::AlreadyPending {
                requested_at: write.requested_at,
            }
        );
        Ok(())
    }

    #[test]
    fn a_member_or_a_missing_log_cannot_ask_to_join() -> anyhow::Result<()> {
        let provider = ProviderLog::founded()?;
        assert!(provider.ask(&provider.founder).is_err());

        let asking = Device::new()?;
        let missing = ProviderIdentityJoinRequest {
            identity_id: provider.log.identity_id(),
            events: &[],
            member: &asking.keys(),
            signing: &asking.signer,
            created_at: &provider.at,
            sponsor: IdentityJoinSponsor::None,
        }
        .plan();
        assert!(missing.is_err());
        Ok(())
    }

    #[test]
    fn a_request_signed_by_another_key_is_refused() -> anyhow::Result<()> {
        let provider = ProviderLog::founded()?;
        let asking = Device::new()?;
        let impostor = Device::new()?;
        let forged = ProviderIdentityJoinRequest {
            identity_id: provider.log.identity_id(),
            events: &provider.events()?,
            member: &asking.keys(),
            signing: &impostor.signer,
            created_at: &provider.at,
            sponsor: IdentityJoinSponsor::None,
        }
        .plan();
        assert!(forged.is_err());
        Ok(())
    }
}
