//! What an identity's control log tells anyone who can read the provider
//! folder.
//!
//! The control log under `meta-secret-nook/<identity>/log` is signed, not
//! encrypted: its members' public keys, when each joined, and which vaults
//! the identity registered are already readable by the provider. A listing
//! can show those facts on a browser that holds no key without exposing
//! anything new. Names stay encrypted elsewhere.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::errors::VaultResult;
use crate::{
    AppId, EventStorageBytes, IdentityControlLog, IdentityControlState, IdentityId,
    IdentityJoinProgress, ProviderInstant, ProviderVaultTime,
};

/// How many devices or vaults a control log lists.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProviderLogCount(u32);

impl From<u32> for ProviderLogCount {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

impl ProviderLogCount {
    fn of(len: usize) -> Self {
        Self(u32::try_from(len).unwrap_or(u32::MAX))
    }
}

/// An identity's public facts, as its control log on the provider tells them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ProviderIdentityLog {
    /// The provider holds no control log for the identity.
    Absent,
    #[serde(rename_all = "camelCase")]
    Read {
        /// Devices its members run on now: apps sharing one device count
        /// once, and revoked ones are not counted.
        #[tsify(type = "number")]
        devices: ProviderLogCount,
        /// When the most recently approved device joined.
        newest_device: ProviderVaultTime,
        /// Vaults the identity keeps; removed ones are not counted.
        #[tsify(type = "number")]
        vaults: ProviderLogCount,
        /// This browser's own app key is one of its devices and this browser
        /// holds the identity, so it and every vault it keeps open here.
        this_browser: bool,
        /// Where this browser's request to join the identity stands.
        join: ProviderIdentityJoin,
    },
}

/// Where this browser's request to join an identity stands in its log.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum ProviderIdentityJoin {
    /// This browser did not ask, or already holds the identity.
    NotAsked,
    /// This browser asked; no device of the identity answered yet.
    Requested,
    /// A device of the identity denied the request.
    Denied,
    /// A device approved it: the key is a member, and this browser has not
    /// added the identity yet.
    Approved,
    /// The key is a member, but here it already holds the identity in use,
    /// which has its own log or vaults: one key holds one identity, so this
    /// one joins here with a new key, which that member key adds.
    KeyInUse,
}

/// Whether the identity in use can still take another identity's id, as
/// finishing an approved join does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ListingLocalIdentity {
    /// Nothing ties it to an identity yet: a join a device approved finishes
    /// here.
    Fresh,
    /// It holds its own log or vaults: its key cannot take another identity.
    InUse,
}

/// The app key of the identity in use on this browser, and that identity.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ListingAppKey {
    pub app_id: AppId,
    /// The local identity the key belongs to on this browser.
    pub identity_id: IdentityId,
    /// Whether that identity can still take another identity's id.
    pub local: ListingLocalIdentity,
}

impl ListingAppKey {
    /// Whether this browser holds the identity, and where its join stands.
    fn standing_in(&self, state: &IdentityControlState) -> (bool, ProviderIdentityJoin) {
        match IdentityJoinProgress::of(state, &self.app_id) {
            IdentityJoinProgress::Approved if self.identity_id == state.identity_id => {
                (true, ProviderIdentityJoin::NotAsked)
            }
            IdentityJoinProgress::Approved => match self.local {
                ListingLocalIdentity::Fresh => (false, ProviderIdentityJoin::Approved),
                ListingLocalIdentity::InUse => (false, ProviderIdentityJoin::KeyInUse),
            },
            IdentityJoinProgress::Pending => (false, ProviderIdentityJoin::Requested),
            IdentityJoinProgress::Denied => (false, ProviderIdentityJoin::Denied),
            IdentityJoinProgress::Revoked | IdentityJoinProgress::NotRequested => {
                (false, ProviderIdentityJoin::NotAsked)
            }
        }
    }
}

/// One identity's control log events, as a provider holds them.
#[derive(Clone, Debug)]
pub struct ProviderIdentityLogEvents {
    pub identity_id: IdentityId,
    pub events: Vec<EventStorageBytes>,
}

/// One listed identity with its public facts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ListedIdentityLog {
    pub identity_id: IdentityId,
    pub log: ProviderIdentityLog,
}

impl ProviderIdentityLogEvents {
    /// Verify the log and read its facts. Every event must parse and carry a
    /// valid signature, as when the identity syncs its own log.
    pub fn read(self, this_browser: Option<&ListingAppKey>) -> VaultResult<ListedIdentityLog> {
        let Self {
            identity_id,
            events,
        } = self;
        if events.is_empty() {
            return Ok(ListedIdentityLog {
                identity_id,
                log: ProviderIdentityLog::Absent,
            });
        }
        let log = IdentityControlLog::new(identity_id.clone())
            .union_storage_bytes(&events)
            .map_err(|rejection| rejection.cause)?;
        let state = IdentityControlState::project(&log)?;
        let mut joining_time = Vec::with_capacity(state.members.len());
        for member in &state.members {
            if let Some(event) = log.event(&member.approved_in) {
                joining_time.push(ProviderInstant::parse_rfc3339(
                    event.body.created_at.as_str(),
                )?);
            }
        }
        let (held_here, join) = this_browser
            .map_or((false, ProviderIdentityJoin::NotAsked), |key| {
                key.standing_in(&state)
            });
        Ok(ListedIdentityLog {
            identity_id,
            log: ProviderIdentityLog::Read {
                devices: ProviderLogCount::of(state.device_members().count()),
                newest_device: joining_time
                    .into_iter()
                    .max()
                    .map_or(ProviderVaultTime::Unreported, |at| {
                        ProviderVaultTime::Reported { at }
                    }),
                vaults: ProviderLogCount::of(state.vaults.len()),
                this_browser: held_here,
                join,
            },
        })
    }
}

impl ListedIdentityLog {
    /// The facts listed for one identity; an identity the listing read no log
    /// for has none.
    #[must_use]
    pub fn of(identity_id: &IdentityId, logs: &[Self]) -> ProviderIdentityLog {
        logs.iter()
            .find(|listed| &listed.identity_id == identity_id)
            .map_or(ProviderIdentityLog::Absent, |listed| listed.log)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AppKey, IdentityApprovalRequest, IdentityControlOperation, IdentityEvent,
        IdentityEventSigning, IdentityGenesisRequest, IdentityMemberKeys,
        IdentityVaultRegistration, OpenedVaultDek, SigningIdentity, StoreId,
    };
    use nook_auth2::{IsoTimestamp, MemberLabel, VaultKeys};
    use nook_event_log::EventId;

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
                label: MemberLabel::from_trusted(String::new()),
            }
        }
    }

    /// A founder registers one vault on Oct 12; a second device joins on Oct 27.
    fn two_device_log() -> anyhow::Result<(IdentityControlLog, AppId)> {
        let founder = Device::new()?;
        let joiner = Device::new()?;
        let founding_time = IsoTimestamp::from_trusted("2026-10-12T00:00:00Z".to_owned());
        let joining_time = IsoTimestamp::from_trusted("2026-10-27T17:28:00Z".to_owned());
        let identity_id = IdentityId::generate()?;
        let store_id = StoreId::generate()?;
        let keys = VaultKeys::generate()?;
        let epoch = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
        let dek = OpenedVaultDek {
            store_id: &store_id,
            key_epoch: &epoch,
            keys: &keys,
        };
        let at_founding = IdentityEventSigning {
            signing_key: founder.signer.signing_key(),
            created_at: &founding_time,
        };
        let mut log = IdentityControlLog::new(identity_id.clone())
            .insert(IdentityEvent::genesis(IdentityGenesisRequest {
                identity_id: &identity_id,
                founder: founder.keys(),
                signing: IdentityEventSigning {
                    signing_key: founder.signer.signing_key(),
                    created_at: &founding_time,
                },
            })?)?
            .log;
        let register = IdentityControlState::project(&log)?
            .vault_registration_operation(IdentityVaultRegistration { dek })?;
        log = log
            .clone()
            .insert(log.build_append(vec![register], &at_founding)?)?
            .log;
        let request = log.build_append(
            vec![IdentityControlOperation::MemberJoinRequested {
                member: joiner.keys(),
            }],
            &IdentityEventSigning {
                signing_key: joiner.signer.signing_key(),
                created_at: &joining_time,
            },
        )?;
        log = log.insert(request)?.log;
        let approve =
            IdentityControlState::project(&log)?.approval_operation(&IdentityApprovalRequest {
                app_id: joiner.app.app_id(),
                vaults: &[dek],
            })?;
        let at_joining = IdentityEventSigning {
            signing_key: founder.signer.signing_key(),
            created_at: &joining_time,
        };
        let founder_app = founder.app.app_id().clone();
        Ok((
            log.clone()
                .insert(log.build_append(vec![approve], &at_joining)?)?
                .log,
            founder_app,
        ))
    }

    fn provider_events(log: &IdentityControlLog) -> anyhow::Result<ProviderIdentityLogEvents> {
        Ok(ProviderIdentityLogEvents {
            identity_id: log.identity_id().clone(),
            events: log
                .storage_bytes()?
                .into_iter()
                .map(|(_, bytes)| bytes)
                .collect(),
        })
    }

    #[test]
    fn a_signed_log_tells_its_devices_their_newest_join_and_its_vaults() -> anyhow::Result<()> {
        let (log, founder) = two_device_log()?;
        let listed = provider_events(&log)?.read(None)?;

        assert_eq!(
            listed.log,
            ProviderIdentityLog::Read {
                devices: ProviderLogCount::from(2),
                newest_device: ProviderVaultTime::Reported {
                    at: ProviderInstant::parse_rfc3339("2026-10-27T17:28:00Z")?,
                },
                vaults: ProviderLogCount::from(1),
                this_browser: false,
                join: ProviderIdentityJoin::NotAsked,
            }
        );
        assert_eq!(&listed.identity_id, log.identity_id());
        // A browser whose app key is one of the devices opens it.
        let key = ListingAppKey {
            app_id: founder,
            identity_id: log.identity_id().clone(),
            local: ListingLocalIdentity::InUse,
        };
        let here = provider_events(&log)?.read(Some(&key))?;
        assert!(matches!(
            here.log,
            ProviderIdentityLog::Read {
                this_browser: true,
                join: ProviderIdentityJoin::NotAsked,
                ..
            }
        ));
        Ok(())
    }

    /// Where the log tells one asking key's join stands.
    fn join_of(
        log: &IdentityControlLog,
        key: &ListingAppKey,
    ) -> anyhow::Result<(bool, ProviderIdentityJoin)> {
        match provider_events(log)?.read(Some(key))?.log {
            ProviderIdentityLog::Read {
                this_browser, join, ..
            } => Ok((this_browser, join)),
            ProviderIdentityLog::Absent => anyhow::bail!("the log must be read"),
        }
    }

    /// A log one founder signs, and the device asking to join it.
    struct AskedLog {
        founder: Device,
        asking: Device,
        log: IdentityControlLog,
        at: IsoTimestamp,
    }

    impl AskedLog {
        fn founded() -> anyhow::Result<Self> {
            let founder = Device::new()?;
            let at = IsoTimestamp::from_trusted("2026-10-28T08:00:00Z".to_owned());
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
            Ok(Self {
                founder,
                asking: Device::new()?,
                log,
                at,
            })
        }

        fn append(
            &mut self,
            signer: Signer,
            operation: IdentityControlOperation,
        ) -> anyhow::Result<()> {
            let device = match signer {
                Signer::Founder => &self.founder,
                Signer::Asking => &self.asking,
            };
            let event = self.log.build_append(
                vec![operation],
                &IdentityEventSigning {
                    signing_key: device.signer.signing_key(),
                    created_at: &self.at,
                },
            )?;
            self.log = self.log.clone().insert(event)?.log;
            Ok(())
        }

        fn state(&self) -> anyhow::Result<IdentityControlState> {
            Ok(IdentityControlState::project(&self.log)?)
        }
    }

    #[derive(Clone, Copy)]
    enum Signer {
        Founder,
        Asking,
    }

    #[test]
    fn the_log_tells_this_browser_where_its_join_request_stands() -> anyhow::Result<()> {
        let mut asked = AskedLog::founded()?;
        // The asking key sits under a fresh local identity of its own.
        let key = ListingAppKey {
            app_id: asked.asking.app.app_id().clone(),
            identity_id: IdentityId::generate()?,
            local: ListingLocalIdentity::Fresh,
        };
        assert_eq!(
            join_of(&asked.log, &key)?,
            (false, ProviderIdentityJoin::NotAsked)
        );

        let request = IdentityControlOperation::MemberJoinRequested {
            member: asked.asking.keys(),
        };
        asked.append(Signer::Asking, request)?;
        assert_eq!(
            join_of(&asked.log, &key)?,
            (false, ProviderIdentityJoin::Requested)
        );

        // A denial is told apart from a key that never asked.
        let mut denied = AskedLog {
            founder: Device {
                app: asked.founder.app.clone(),
                signer: asked.founder.signer.clone(),
            },
            asking: Device {
                app: asked.asking.app.clone(),
                signer: asked.asking.signer.clone(),
            },
            log: asked.log.clone(),
            at: asked.at.clone(),
        };
        let denial = denied
            .state()?
            .denial_operation(asked.asking.app.app_id())?;
        denied.append(Signer::Founder, denial)?;
        assert_eq!(
            join_of(&denied.log, &key)?,
            (false, ProviderIdentityJoin::Denied)
        );

        // Approved, the key is a device, but this browser has not added the
        // identity under its id yet.
        let approval = asked
            .state()?
            .approval_operation(&IdentityApprovalRequest {
                app_id: asked.asking.app.app_id(),
                vaults: &[],
            })?;
        asked.append(Signer::Founder, approval)?;
        assert_eq!(
            join_of(&asked.log, &key)?,
            (false, ProviderIdentityJoin::Approved)
        );

        // The same member key whose identity here already has a log or
        // vaults cannot take this identity too: nothing offers to finish.
        let in_use = ListingAppKey {
            local: ListingLocalIdentity::InUse,
            ..key.clone()
        };
        assert_eq!(
            join_of(&asked.log, &in_use)?,
            (false, ProviderIdentityJoin::KeyInUse)
        );

        // Once the key's local identity takes the identity's id, it is held.
        let added = ListingAppKey {
            app_id: key.app_id.clone(),
            identity_id: asked.log.identity_id().clone(),
            local: ListingLocalIdentity::InUse,
        };
        assert_eq!(
            join_of(&asked.log, &added)?,
            (true, ProviderIdentityJoin::NotAsked)
        );
        Ok(())
    }

    #[test]
    fn a_folder_without_log_events_has_no_facts_and_a_damaged_log_fails() -> anyhow::Result<()> {
        let identity_id = IdentityId::generate()?;
        let empty = ProviderIdentityLogEvents {
            identity_id: identity_id.clone(),
            events: Vec::new(),
        }
        .read(None)?;
        assert_eq!(empty.log, ProviderIdentityLog::Absent);
        assert_eq!(
            ListedIdentityLog::of(&identity_id, &[empty]),
            ProviderIdentityLog::Absent
        );

        // A log event that does not parse is reported, not skipped.
        let mut damaged = provider_events(&two_device_log()?.0)?;
        damaged.events.push(EventStorageBytes::from(
            b"not: an identity event\n".to_vec(),
        ));
        assert!(damaged.read(None).is_err());
        Ok(())
    }
}
