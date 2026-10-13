//! One-time migration from per-vault membership to an identity control log.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use std::collections::{BTreeMap, BTreeSet};

use nook_auth2::{AppId, IdentityId};

use super::builder::{IdentityEventSigning, IdentityGenesisRequest, OpenedVaultDek};
use super::wire::{
    IdentityControlOperation, IdentityEvent, IdentityLabel, IdentityMemberKeys,
    IdentityProviderMount, IdentityVaultLabel, MemberVaultDek,
};
use crate::{EventResult, VaultAuthorizedRoster};

/// One Simple vault the identity owns, opened by the migrating installation.
pub struct LegacyVaultMembership<'a> {
    pub dek: OpenedVaultDek<'a>,
    pub label: IdentityVaultLabel,
    pub roster: &'a VaultAuthorizedRoster,
}

/// Named values required to migrate per-vault membership into a new
/// identity control log.
pub struct IdentityControlMigration<'a> {
    pub identity_id: &'a IdentityId,
    pub label: IdentityLabel,
    pub founder: IdentityMemberKeys,
    pub vaults: &'a [LegacyVaultMembership<'a>],
    pub mounts: Vec<IdentityProviderMount>,
    pub signing: IdentityEventSigning<'a>,
}

/// Signed migration events and the devices that could not become members.
#[derive(Debug)]
pub struct IdentityControlMigrationOutcome {
    pub events: Vec<IdentityEvent>,
    /// Roster devices whose public keys do not form a valid member tuple.
    pub skipped: Vec<AppId>,
}

impl IdentityControlMigration<'_> {
    /// Build the founder genesis and one event that approves every device
    /// still authorized in at least one owned vault, registers each vault with
    /// envelopes for exactly the devices that vault authorized, and records the
    /// identity's provider mounts. A device revoked from any owned vault is not
    /// carried into the identity.
    pub fn events(self) -> EventResult<IdentityControlMigrationOutcome> {
        let Self {
            identity_id,
            label,
            founder,
            vaults,
            mounts,
            signing,
        } = self;
        founder.signing_actor()?;
        let revoked = vaults
            .iter()
            .flat_map(|vault| vault.roster.revoked.iter().cloned())
            .collect::<BTreeSet<_>>();
        let mut members: BTreeMap<AppId, IdentityMemberKeys> = BTreeMap::new();
        let mut skipped = BTreeSet::new();
        for vault in vaults {
            for device in &vault.roster.members {
                if device.device_id == founder.app_id || revoked.contains(&device.device_id) {
                    continue;
                }
                let keys = IdentityMemberKeys {
                    app_id: device.device_id.clone(),
                    encryption_public_key: device.encryption_public_key.clone(),
                    signing_public_key: device.signing_public_key.clone(),
                    label: device.label.clone(),
                };
                if keys.signing_actor().is_ok() {
                    members.entry(keys.app_id.clone()).or_insert(keys);
                } else {
                    skipped.insert(keys.app_id);
                }
            }
        }

        let mut operations = members
            .values()
            .map(|member| IdentityControlOperation::MemberApproved {
                member: member.clone(),
                vault_deks: Vec::new(),
            })
            .collect::<Vec<_>>();
        for vault in vaults {
            let mut recipients = vec![founder.wrap_vault_keys(vault.dek.keys)?];
            for device in &vault.roster.members {
                if let Some(member) = members.get(&device.device_id) {
                    recipients.push(member.wrap_vault_keys(vault.dek.keys)?);
                }
            }
            recipients.sort_by(|left: &MemberVaultDek, right| left.app_id.cmp(&right.app_id));
            recipients.dedup_by(|left, right| left.app_id == right.app_id);
            operations.push(IdentityControlOperation::VaultRegistered {
                store_id: vault.dek.store_id.clone(),
                label: vault.label.clone(),
                key_epoch: vault.dek.key_epoch.clone(),
                recipients,
            });
        }
        operations.extend(
            mounts
                .into_iter()
                .map(|mount| IdentityControlOperation::ProviderMounted { mount }),
        );

        let genesis = IdentityEvent::genesis(IdentityGenesisRequest {
            identity_id,
            label,
            founder,
            signing: IdentityEventSigning {
                signing_key: signing.signing_key,
                created_at: signing.created_at,
            },
        })?;
        let mut events = vec![genesis.clone()];
        if !operations.is_empty() {
            let log = super::IdentityControlLog::new(identity_id.clone())
                .insert(genesis)
                .map_err(|rejection| rejection.cause)?
                .log;
            events.push(log.build_append(operations, &signing)?);
        }
        Ok(IdentityControlMigrationOutcome {
            events,
            skipped: skipped.into_iter().collect(),
        })
    }
}
