//! Signed vault roster derived from approvals and revocations.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use std::collections::BTreeMap;

use nook_auth2::{DeviceId, DevicePublicKey, DeviceSigningPublicKey, MemberLabel};

use super::EventGraph;
use crate::event::VaultOperation;
use crate::{EventId, EventResult};

/// One device authorized by the vault's signed event graph.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultRosterMember {
    pub device_id: DeviceId,
    pub encryption_public_key: DevicePublicKey,
    pub signing_public_key: DeviceSigningPublicKey,
    pub label: MemberLabel,
}

/// Active and revoked devices of one vault.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct VaultAuthorizedRoster {
    pub members: Vec<VaultRosterMember>,
    pub revoked: Vec<DeviceId>,
}

impl EventGraph {
    /// Devices whose `join-approved` causally follows every revocation of the
    /// same device. A revocation concurrent with an approval wins.
    pub fn authorized_roster(&self) -> EventResult<VaultAuthorizedRoster> {
        let mut approvals: Vec<(EventId, VaultRosterMember)> = Vec::new();
        let mut revocations: Vec<(EventId, DeviceId)> = Vec::new();
        let mut labels: BTreeMap<DeviceId, MemberLabel> = BTreeMap::new();
        for id in self.topological_order()? {
            let Some(event) = self.events.get(&id) else {
                continue;
            };
            for operation in &event.body.operations {
                match operation {
                    VaultOperation::JoinApproved {
                        device_id,
                        encryption_public_key,
                        signing_public_key,
                        label,
                        ..
                    } if !signing_public_key.is_empty() => approvals.push((
                        id.clone(),
                        VaultRosterMember {
                            device_id: device_id.clone(),
                            encryption_public_key: encryption_public_key.clone(),
                            signing_public_key: signing_public_key.clone(),
                            label: label.clone(),
                        },
                    )),
                    VaultOperation::DeviceRevoked { device_id } => {
                        revocations.push((id.clone(), device_id.clone()));
                    }
                    VaultOperation::MemberRenamed { device_id, label } => {
                        labels.insert(device_id.clone(), label.clone());
                    }
                    _ => {}
                }
            }
        }
        let mut members: BTreeMap<DeviceId, VaultRosterMember> = BTreeMap::new();
        for (approval, member) in approvals {
            let survives = revocations
                .iter()
                .filter(|(_, revoked)| *revoked == member.device_id)
                .all(|(revocation, _)| self.is_ancestor(revocation, &approval));
            if survives {
                members.insert(member.device_id.clone(), member);
            }
        }
        for (device_id, label) in labels {
            if let Some(member) = members.get_mut(&device_id) {
                member.label = label;
            }
        }
        let mut revoked = revocations
            .into_iter()
            .map(|(_, device_id)| device_id)
            .filter(|device_id| !members.contains_key(device_id))
            .collect::<Vec<_>>();
        revoked.sort();
        revoked.dedup();
        Ok(VaultAuthorizedRoster {
            members: members.into_values().collect(),
            revoked,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::super::authorization::tests::{STORE_STR, genesis_event, signed_operation};
    use super::*;
    use crate::test_support::{public_key, signing_key};
    use crate::{EventGraphInsert, EventResult};
    use nook_auth2::AgeArmoredCiphertext;

    fn approval(device: &str, signer: &ed25519_dalek::SigningKey) -> EventResult<VaultOperation> {
        Ok(VaultOperation::JoinApproved {
            device_id: DeviceId::parse(device)?,
            encryption_public_key: DevicePublicKey::from_trusted(format!("age-{device}")),
            signing_public_key: public_key(signer),
            label: MemberLabel::from_trusted(String::new()),
            secrets_key_ciphertext: AgeArmoredCiphertext::from_trusted("s".to_owned()),
            members_key_ciphertext: AgeArmoredCiphertext::from_trusted("m".to_owned()),
        })
    }

    #[test]
    fn roster_keeps_approved_devices_and_drops_revoked_ones() -> EventResult<()> {
        let owner = signing_key();
        let phone = signing_key();
        let tablet = signing_key();
        let genesis = genesis_event(&owner)?;
        let genesis_id = genesis.id()?;
        let approve = signed_operation(
            vec![genesis_id],
            approval("0123456789abcdef", &phone)?,
            &owner,
        )?;
        let approve_id = approve.id()?;
        let approve_tablet = signed_operation(
            vec![approve_id],
            approval("fedcba9876543210", &tablet)?,
            &owner,
        )?;
        let approve_tablet_id = approve_tablet.id()?;
        let rename = signed_operation(
            vec![approve_tablet_id],
            VaultOperation::MemberRenamed {
                device_id: DeviceId::parse("0123456789abcdef")?,
                label: MemberLabel::from_trusted("Phone".to_owned()),
            },
            &owner,
        )?;
        let rename_id = rename.id()?;
        let revoke = signed_operation(
            vec![rename_id],
            VaultOperation::DeviceRevoked {
                device_id: DeviceId::parse("fedcba9876543210")?,
            },
            &owner,
        )?;
        let mut graph = EventGraph::new();
        for event in [genesis, approve, approve_tablet, rename, revoke] {
            graph = graph
                .insert(EventGraphInsert {
                    event,
                    expected_store_id: STORE_STR,
                })
                .map_err(|rejection| rejection.cause)?
                .graph;
        }
        let roster = graph.authorized_roster()?;
        assert_eq!(roster.members.len(), 1);
        let member = roster
            .members
            .first()
            .ok_or_else(|| crate::EventError::MissingEvent {
                event_id: "roster member".to_owned(),
            })?;
        assert_eq!(member.device_id.as_str(), "0123456789abcdef");
        assert_eq!(member.label.as_str(), "Phone");
        assert_eq!(member.signing_public_key, public_key(&phone));
        assert_eq!(roster.revoked, vec![DeviceId::parse("fedcba9876543210")?]);
        Ok(())
    }
}
