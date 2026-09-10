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
            if let Some(index) = self
                .members
                .iter()
                .position(|existing| existing.app_id == member.app_id)
            {
                self.members[index].admit_legacy_peer(member)?;
                if self.members[index].signing_public_key.is_empty() {
                    self.members[index] = member;
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
        let mut selection = match &self.directory.selection {
            IdentitySelection::Empty => None,
            IdentitySelection::Selected(identity) => Some(identity),
        };
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
            if let LegacyMigrationScope::FromBase { components, .. } = &self.scope {
                let left_component = components.get(identities[left].identity_id);
                let right_component = components.get(identities[right].identity_id);
                if left_component.is_none() || left_component != right_component {
                    return Err(MultiDeviceError::DuplicateAppKeyOwnership {
                        app_id: app_id.to_string(),
                    });
                }
            }
            let survivor = if self.scope.preserves(identities[right].identity_id) {
                right
            } else if self.scope.preserves(identities[left].identity_id) {
                left
            } else if selection == Some(identities[right].identity_id) {
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
            if selection == Some(incoming.identity_id) {
                selection = Some(record.identity_id);
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
        if selection.is_some_and(|identity| !ids.contains(identity)) {
            return Err(MultiDeviceError::InvalidIdentitySelection);
        }
        Ok(merges)
    }
}
