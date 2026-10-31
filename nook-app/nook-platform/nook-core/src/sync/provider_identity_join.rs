//! Asking an identity this browser cannot open to let one app key in.
//!
//! The request is a self-signed `member-join-requested` carrying the asking
//! app key's public member keys only. It goes on top of the identity log's
//! applicable heads at the provider, so a device of the identity that syncs
//! the log sees it and answers it. Until a member approves it, the request
//! opens nothing.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::errors::VaultResult;
use crate::{
    EventError, EventId, EventStorageBytes, IdentityControlLog, IdentityControlOperation,
    IdentityControlState, IdentityEventInsertStatus, IdentityEventSigning, IdentityId,
    IdentityMemberKeys, IsoTimestamp, ReplicatedIdentityStanding, SigningIdentity,
};

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
}

/// The signed request to put into the identity's log at the provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityJoinRequestWrite {
    pub event_id: EventId,
    pub bytes: EventStorageBytes,
    pub requested_at: IsoTimestamp,
}

/// What asking to join writes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityJoinRequestPlan {
    /// Put this self-signed request into the identity's log.
    Write(IdentityJoinRequestWrite),
    /// The app key already asked, and no member answered yet.
    AlreadyPending { requested_at: IsoTimestamp },
}

impl ProviderIdentityJoinRequest<'_> {
    fn refused(reason: &str) -> EventError {
        EventError::IdentityControlInvalid(reason.to_owned())
    }

    /// Verify the provider's log and sign the request on its heads. A member,
    /// a removed app key, or a log the provider does not hold is refused.
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
        let event = log.build_append(
            vec![IdentityControlOperation::MemberJoinRequested {
                member: self.member.clone(),
            }],
            &IdentityEventSigning {
                signing_key: self.signing.signing_key(),
                created_at: self.created_at,
            },
        )?;
        let event_id = event.id()?;
        let bytes = event.serialize_storage_yaml()?;
        let inserted = log.insert(event).map_err(|rejection| rejection.cause)?;
        if inserted.status != IdentityEventInsertStatus::Applied {
            return Err(
                Self::refused("the join request does not apply to the identity log").into(),
            );
        }
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
    use crate::{AppKey, IdentityEvent, IdentityGenesisRequest};
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
            }
            .plan()?)
        }

        fn put(&mut self, write: &IdentityJoinRequestWrite) -> anyhow::Result<()> {
            let event = IdentityEvent::parse_storage_bytes(&write.bytes)?;
            assert_eq!(event.id()?, write.event_id);
            self.log = self.log.clone().insert(event)?.log;
            Ok(())
        }
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
        }
        .plan();
        assert!(forged.is_err());
        Ok(())
    }
}
