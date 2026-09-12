//! Borrowed merge simulation admits every conflict before moving directory records.
use super::{IdentityDirectory, LegacyIdentityMerge, LegacyMigrationScope};
use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{AppId, IdentityId, IdentityMember, IdentitySelection, StoreId};
use std::collections::{HashMap, HashSet};

struct LegacyIdentityProjection<'a> {
    identity_id: &'a IdentityId,
    members: Vec<&'a IdentityMember>,
    vaults: Vec<&'a StoreId>,
}
impl<'a> LegacyIdentityProjection<'a> {
    fn merge(mut self, incoming: Self) -> MultiDeviceResult<Self> {
        for member in incoming.members {
            if let Some(existing) = self
                .members
                .iter_mut()
                .find(|existing| existing.app_id == member.app_id)
            {
                existing.admit_legacy_peer(member)?;
                if existing.signing_public_key.is_empty() {
                    *existing = member;
                }
            } else {
                self.members.push(member);
            }
        }
        for store_id in incoming.vaults {
            if self.vaults.contains(&store_id) {
                return Err(MultiDeviceError::DuplicateVaultOwnership {
                    store_id: store_id.to_string(),
                });
            }
            self.vaults.push(store_id);
        }
        Ok(self)
    }
}

pub(super) struct LegacyDirectoryAdmission<'a> {
    pub(super) directory: &'a IdentityDirectory,
    pub(super) scope: LegacyMigrationScope<'a>,
}
impl LegacyDirectoryAdmission<'_> {
    pub(super) fn prepare(self) -> MultiDeviceResult<Vec<LegacyIdentityMerge>> {
        let mut identities = self
            .directory
            .identities
            .iter()
            .map(|record| LegacyIdentityProjection {
                identity_id: &record.identity_id,
                members: record.members.iter().collect(),
                vaults: record
                    .vault_deks
                    .iter()
                    .map(|vault| &vault.store_id)
                    .collect(),
            })
            .collect::<Vec<_>>();
        let mut selection = self.directory.selection.clone();
        let mut merges = Vec::new();
        loop {
            let mut owners = HashMap::<&AppId, usize>::new();
            let duplicate = identities.iter().enumerate().find_map(|(index, record)| {
                record.members.iter().find_map(|member| {
                    owners
                        .insert(&member.app_id, index)
                        .filter(|owner| *owner != index)
                        .map(|owner| (owner, index, &member.app_id))
                })
            });
            let Some((left, right, app_id)) = duplicate else {
                break;
            };
            let left_identity = identities
                .get(left)
                .ok_or(MultiDeviceError::InvalidIdentitySelection)?
                .identity_id;
            let right_identity = identities
                .get(right)
                .ok_or(MultiDeviceError::InvalidIdentitySelection)?
                .identity_id;
            if let LegacyMigrationScope::FromBase { components, .. } = &self.scope {
                let left_component = components.get(left_identity);
                let right_component = components.get(right_identity);
                if left_component.is_none() || left_component != right_component {
                    return Err(MultiDeviceError::DuplicateAppKeyOwnership {
                        app_id: app_id.to_string(),
                    });
                }
            }
            let survivor = if self.scope.preserves(right_identity) {
                right
            } else if self.scope.preserves(left_identity) {
                left
            } else if matches!(&selection, IdentitySelection::Selected(identity) if identity == right_identity)
            {
                right
            } else {
                left
            };
            let absorbed = if survivor == left { right } else { left };
            merges.push(LegacyIdentityMerge { survivor, absorbed });
            let incoming = identities.remove(absorbed);
            let index = if absorbed < survivor {
                survivor - 1
            } else {
                survivor
            };
            let record = identities.remove(index);
            if matches!(&selection, IdentitySelection::Selected(identity) if identity == incoming.identity_id)
            {
                selection = IdentitySelection::Selected(record.identity_id.clone());
            }
            identities.insert(index, record.merge(incoming)?);
        }
        let retired: HashSet<_> = self.directory.retired_app_ids.iter().collect();
        if retired.len() != self.directory.retired_app_ids.len() {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "identity directory contains duplicate retired app ids".to_owned(),
            ));
        }
        let mut ids = HashSet::new();
        let mut vaults = HashSet::new();
        let mut apps = HashSet::new();
        for record in identities {
            if !ids.insert(record.identity_id) {
                return Err(MultiDeviceError::DuplicateIdentity {
                    identity_id: record.identity_id.to_string(),
                });
            }
            if record
                .members
                .iter()
                .any(|member| retired.contains(&member.app_id))
            {
                return Err(MultiDeviceError::RetiredAppKey);
            }
            for member in record.members {
                if !apps.insert(&member.app_id) {
                    return Err(MultiDeviceError::DuplicateAppKeyOwnership {
                        app_id: member.app_id.to_string(),
                    });
                }
            }
            for store_id in record.vaults {
                if !vaults.insert(store_id) {
                    return Err(MultiDeviceError::DuplicateVaultOwnership {
                        store_id: store_id.to_string(),
                    });
                }
            }
        }
        if matches!(&selection, IdentitySelection::Selected(identity) if !ids.contains(identity)) {
            return Err(MultiDeviceError::InvalidIdentitySelection);
        }
        Ok(merges)
    }
}
