//! Adding an identity a sync provider holds whose member key is the one in
//! use here.
//!
//! The same passkey made the key that holds the identity in use and is a
//! member of the listed identity. One key holds one identity on a browser,
//! so the listed identity gets a new key here, protected by that same
//! passkey. The key in use, a member, adds the new key itself on its own
//! device (`member-approved`, `same-as` the key in use), as the web app adds
//! the browser extension: no other device answers.
//!
//! The key in use is checked against the provider's log first, so a key that
//! is no member is refused before the passkey is asked for anything.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::errors::VaultResult;
use crate::{
    AppKey, EventError, EventId, EventStorageBytes, IdentityControlLog, IdentityControlState,
    IdentityEventInsertStatus, IdentityEventSigning, IdentityId, IdentityMemberAdd,
    IdentityMemberKeys, IsoTimestamp, SigningIdentity,
};

/// One identity's log at a provider and the key in use here.
pub struct ProviderIdentityKeyInUse<'a> {
    pub identity_id: &'a IdentityId,
    /// The identity's control log events, as the provider holds them.
    pub events: &'a [EventStorageBytes],
    pub key_in_use: &'a AppKey,
}

/// The provider's verified log, which lists the key in use as a member.
pub struct KeyInUseMembership<'a> {
    log: IdentityControlLog,
    state: IdentityControlState,
    key_in_use: &'a AppKey,
}

/// The new key the key in use adds, and what signs the addition.
pub struct KeyInUseAddition<'a> {
    /// The new key's public member keys.
    pub member: &'a IdentityMemberKeys,
    /// The key in use's event signer.
    pub signing: &'a SigningIdentity,
    pub created_at: &'a IsoTimestamp,
}

/// The addition to put into the identity's log at the provider. The new key
/// is a member once it is there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityJoinAdditionWrite {
    pub event_id: EventId,
    pub bytes: EventStorageBytes,
}

fn refused(reason: &str) -> EventError {
    EventError::IdentityControlInvalid(reason.to_owned())
}

impl<'a> ProviderIdentityKeyInUse<'a> {
    /// Verify the provider's log and require the key in use among its
    /// members. A log the provider does not hold is refused too.
    pub fn verify(&self) -> VaultResult<KeyInUseMembership<'a>> {
        if self.events.is_empty() {
            return Err(refused("the provider holds no control log for this identity").into());
        }
        let log = IdentityControlLog::new(self.identity_id.clone())
            .union_storage_bytes(self.events)
            .map_err(|rejection| rejection.cause)?;
        let state = IdentityControlState::project(&log)?;
        if state.member(self.key_in_use.app_id()).is_none() {
            return Err(refused("the key in use here is not a member of this identity").into());
        }
        Ok(KeyInUseMembership {
            log,
            state,
            key_in_use: self.key_in_use,
        })
    }
}

impl KeyInUseMembership<'_> {
    /// Sign the addition of the new key on the log's heads, with every vault
    /// DEK the key in use opens wrapped to it. It must apply there.
    pub fn addition(
        self,
        addition: &KeyInUseAddition<'_>,
    ) -> VaultResult<IdentityJoinAdditionWrite> {
        let operations = IdentityMemberAdd {
            state: &self.state,
            approver: self.key_in_use,
            member: addition.member,
        }
        .addition()?;
        let event = self.log.build_append(
            operations,
            &IdentityEventSigning {
                signing_key: addition.signing.signing_key(),
                created_at: addition.created_at,
            },
        )?;
        let event_id = event.id()?;
        let bytes = event.serialize_storage_yaml()?;
        let inserted = self
            .log
            .insert(event)
            .map_err(|rejection| rejection.cause)?;
        if inserted.status != IdentityEventInsertStatus::Applied {
            return Err(refused("the addition does not apply to the identity log").into());
        }
        Ok(IdentityJoinAdditionWrite { event_id, bytes })
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
                label: MemberLabel::from_trusted("Laptop".to_owned()),
            }
        }
    }

    /// An identity founded by a key, as a provider holds its log.
    struct ProviderLog {
        founder: Device,
        log: IdentityControlLog,
        at: IsoTimestamp,
    }

    impl ProviderLog {
        fn founded() -> anyhow::Result<Self> {
            let founder = Device::new()?;
            let at = IsoTimestamp::from_trusted("2026-10-30T09:00:00Z".to_owned());
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
    }

    #[test]
    fn the_key_in_use_adds_a_new_key_for_the_identity_on_its_own_device() -> anyhow::Result<()> {
        let mut provider = ProviderLog::founded()?;
        let events = provider.events()?;
        let new_key = Device::new()?;

        let write = ProviderIdentityKeyInUse {
            identity_id: provider.log.identity_id(),
            events: &events,
            key_in_use: &provider.founder.app,
        }
        .verify()?
        .addition(&KeyInUseAddition {
            member: &new_key.keys(),
            signing: &provider.founder.signer,
            created_at: &provider.at,
        })?;

        let event = IdentityEvent::parse_storage_bytes(&write.bytes)?;
        assert_eq!(event.id()?, write.event_id);
        provider.log = provider.log.clone().insert(event)?.log;
        let state = IdentityControlState::project(&provider.log)?;
        let added = state
            .member(new_key.app.app_id())
            .ok_or_else(|| anyhow::anyhow!("the new key must be a member"))?;
        assert_eq!(
            added.device,
            MemberDevice::SameAs {
                app_id: provider.founder.app.app_id().clone(),
            }
        );
        // Both keys run on this browser: still one device.
        assert_eq!(state.device_members().count(), 1);
        Ok(())
    }

    #[test]
    fn a_key_that_is_no_member_or_a_missing_log_is_refused_before_anything_is_asked()
    -> anyhow::Result<()> {
        let provider = ProviderLog::founded()?;
        let stranger = Device::new()?;
        assert!(
            ProviderIdentityKeyInUse {
                identity_id: provider.log.identity_id(),
                events: &provider.events()?,
                key_in_use: &stranger.app,
            }
            .verify()
            .is_err()
        );
        assert!(
            ProviderIdentityKeyInUse {
                identity_id: provider.log.identity_id(),
                events: &[],
                key_in_use: &provider.founder.app,
            }
            .verify()
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn an_addition_signed_by_another_key_does_not_apply() -> anyhow::Result<()> {
        let provider = ProviderLog::founded()?;
        let events = provider.events()?;
        let new_key = Device::new()?;
        let impostor = Device::new()?;
        let forged = ProviderIdentityKeyInUse {
            identity_id: provider.log.identity_id(),
            events: &events,
            key_in_use: &provider.founder.app,
        }
        .verify()?
        .addition(&KeyInUseAddition {
            member: &new_key.keys(),
            signing: &impostor.signer,
            created_at: &provider.at,
        });
        assert!(forged.is_err());
        Ok(())
    }
}
