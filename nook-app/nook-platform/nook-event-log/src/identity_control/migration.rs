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
    IdentityControlOperation, IdentityEvent, IdentityMemberKeys, IdentityProviderMount,
    MemberVaultDek,
};
use crate::{EventResult, VaultAuthorizedRoster};

/// One Simple vault the identity owns, opened by the migrating installation.
pub struct LegacyVaultMembership<'a> {
    pub dek: OpenedVaultDek<'a>,
    pub roster: &'a VaultAuthorizedRoster,
}

/// Named values required to migrate per-vault membership into a new
/// identity control log.
pub struct IdentityControlMigration<'a> {
    pub identity_id: &'a IdentityId,
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

#[cfg(test)]
mod tests {
    #![allow(clippy::too_many_lines)]

    use crate::identity_control::test_fixtures::*;

    #[test]
    fn migration_carries_authorized_vault_devices_into_the_identity() -> anyhow::Result<()> {
        use crate::{VaultAuthorizedRoster, VaultRosterMember};

        let identity_id = IdentityId::generate()?;
        let at = IsoTimestamp::from_trusted("2026-10-12T00:00:00Z".to_owned());
        let founder = Installation::new()?;
        let phone = Installation::new()?;
        let tablet = Installation::new()?;
        let roster_member = |installation: &Installation, label: &str| VaultRosterMember {
            device_id: installation.app.app_id().clone(),
            encryption_public_key: installation.app.public_key(),
            signing_public_key: public_key(&installation.signer),
            label: MemberLabel::from_trusted(label.to_owned()),
        };
        let malformed = VaultRosterMember {
            device_id: nook_auth2::AppId::parse("0123456789abcdef")?,
            encryption_public_key: phone.app.public_key(),
            signing_public_key: public_key(&phone.signer),
            label: MemberLabel::from_trusted("Mismatched".to_owned()),
        };
        let personal_roster = VaultAuthorizedRoster {
            members: vec![
                roster_member(&founder, "Laptop"),
                roster_member(&phone, "Phone"),
                roster_member(&tablet, "Tablet"),
                malformed,
            ],
            revoked: Vec::new(),
        };
        let work_roster = VaultAuthorizedRoster {
            members: vec![roster_member(&founder, "Laptop")],
            revoked: vec![tablet.app.app_id().clone()],
        };
        let personal_keys = VaultKeys::generate()?;
        let work_keys = VaultKeys::generate()?;
        let personal = StoreId::generate()?;
        let work = StoreId::generate()?;
        let personal_epoch = epoch_id("personal")?;
        let work_epoch = epoch_id("work")?;
        let mount = IdentityProviderMount {
            mount_id: ProviderMountId::generate()?,
            label: "GitHub".to_owned(),
            target: IdentityMountTarget::Github {
                repository: "owner/personal".to_owned(),
            },
            layout: ProviderMountLayout::LegacySingleVault {
                store_id: personal.clone(),
            },
        };
        let vaults = [
            LegacyVaultMembership {
                dek: OpenedVaultDek {
                    store_id: &personal,
                    key_epoch: &personal_epoch,
                    keys: &personal_keys,
                },
                roster: &personal_roster,
            },
            LegacyVaultMembership {
                dek: OpenedVaultDek {
                    store_id: &work,
                    key_epoch: &work_epoch,
                    keys: &work_keys,
                },
                roster: &work_roster,
            },
        ];
        let outcome = IdentityControlMigration {
            identity_id: &identity_id,
            founder: founder.keys("Laptop"),
            vaults: &vaults,
            mounts: vec![mount.clone()],
            signing: founder.signing(&at),
        }
        .events()?;
        assert_eq!(outcome.events.len(), 2);
        assert_eq!(
            outcome.skipped,
            vec![nook_auth2::AppId::parse("0123456789abcdef")?]
        );

        let bytes = outcome
            .events
            .iter()
            .map(IdentityEvent::serialize_storage_yaml)
            .collect::<Result<Vec<_>, _>>()?;
        let log = IdentityControlLog::new(identity_id).union_storage_bytes(&bytes)?;
        let state = IdentityControlState::project(&log)?;
        // The tablet is still listed by the personal vault, but its revocation
        // from the work vault keeps it out of the identity.
        assert_eq!(state.members.len(), 2);
        assert!(state.member(phone.app.app_id()).is_some());
        assert!(state.member(tablet.app.app_id()).is_none());
        assert_eq!(state.mounts, vec![mount]);

        let personal_vault = state
            .vault(&personal)
            .ok_or_else(|| anyhow::anyhow!("personal vault must be registered"))?;
        let IdentityVaultDekLookup::Granted(dek) =
            personal_vault.current_dek_for(phone.app.app_id())
        else {
            anyhow::bail!("phone keeps access to the vault that authorized it");
        };
        assert_eq!(
            phone.app.decrypt_envelope(&dek.secrets_key_ciphertext)?,
            personal_keys.secrets_key
        );
        let work_vault = state
            .vault(&work)
            .ok_or_else(|| anyhow::anyhow!("work vault must be registered"))?;
        assert!(matches!(
            work_vault.current_dek_for(phone.app.app_id()),
            IdentityVaultDekLookup::NotGranted
        ));
        assert_eq!(
            state
                .members_missing_current_dek(&work)
                .iter()
                .map(|member| member.keys.app_id.clone())
                .collect::<Vec<_>>(),
            vec![phone.app.app_id().clone()]
        );
        Ok(())
    }
}
