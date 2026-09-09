//! Directory ownership while an identity record undergoes a consuming transition.
use super::{IdentityDirectory, IdentitySelection};
use crate::{
    AppKey, IdentityId, IdentityMember, IdentityMemberSigningUpdate, IdentityRecord,
    IdentityRecordRejection, IdentityVaultKeys, MultiDeviceError, VaultKeys,
};

#[derive(Debug, thiserror::Error)]
#[error("{cause}")]
pub struct IdentityDirectoryRejection {
    pub directory: IdentityDirectory,
    #[source]
    pub cause: MultiDeviceError,
}
impl IdentityDirectoryRejection {
    pub fn into_cause(self) -> MultiDeviceError {
        self.cause
    }
}

pub struct IdentityCreation<'a> {
    pub label: &'a str,
    pub app_key: &'a AppKey,
    pub member_label: Option<String>,
}

pub struct IdentityDirectoryResolution {
    pub directory: IdentityDirectory,
    pub identity_id: IdentityId,
}

pub struct IdentityDirectoryVaultKeys {
    pub directory: IdentityDirectory,
    pub keys: VaultKeys,
}

pub(super) struct DetachedIdentityRecord {
    directory: IdentityDirectory,
    index: usize,
    record: IdentityRecord,
}

impl IdentityDirectory {
    pub(super) fn take_identity(
        mut self,
        identity_id: &IdentityId,
    ) -> Result<DetachedIdentityRecord, IdentityDirectoryRejection> {
        let Some(index) = self
            .identities
            .iter()
            .position(|record| &record.identity_id == identity_id)
        else {
            return Err(IdentityDirectoryRejection {
                directory: self,
                cause: MultiDeviceError::IdentityNotFound {
                    identity_id: identity_id.to_string(),
                },
            });
        };
        let record = self.identities.remove(index);
        Ok(DetachedIdentityRecord {
            directory: self,
            index,
            record,
        })
    }
}

impl DetachedIdentityRecord {
    pub(super) fn update<F>(
        self,
        operation: F,
    ) -> Result<IdentityDirectory, IdentityDirectoryRejection>
    where
        F: FnOnce(IdentityRecord) -> Result<IdentityRecord, IdentityRecordRejection>,
    {
        let Self {
            mut directory,
            index,
            record,
        } = self;
        match operation(record) {
            Ok(record) => {
                directory.identities.insert(index, record);
                Ok(directory)
            }
            Err(rejected) => {
                directory.identities.insert(index, rejected.identity);
                Err(IdentityDirectoryRejection {
                    directory,
                    cause: rejected.cause,
                })
            }
        }
    }

    pub(super) fn open_keys<F>(
        self,
        operation: F,
    ) -> Result<IdentityDirectoryVaultKeys, IdentityDirectoryRejection>
    where
        F: FnOnce(IdentityRecord) -> Result<IdentityVaultKeys, IdentityRecordRejection>,
    {
        let Self {
            mut directory,
            index,
            record,
        } = self;
        match operation(record) {
            Ok(opened) => {
                directory.identities.insert(index, opened.identity);
                Ok(IdentityDirectoryVaultKeys {
                    directory,
                    keys: opened.keys,
                })
            }
            Err(rejected) => {
                directory.identities.insert(index, rejected.identity);
                Err(IdentityDirectoryRejection {
                    directory,
                    cause: rejected.cause,
                })
            }
        }
    }
}

impl IdentityDirectoryResolution {
    pub(super) fn select(mut self) -> Self {
        self.directory.selection = IdentitySelection::Selected(self.identity_id.clone());
        self
    }
}

pub struct DirectoryMemberSigningUpdate<'a> {
    pub identity_id: &'a IdentityId,
    pub member: IdentityMemberSigningUpdate<'a>,
}

pub struct DirectoryLegacyVaultImport<'a> {
    pub label: &'a str,
    pub app_key: &'a AppKey,
    pub store_id: crate::StoreId,
    pub reconciliation: crate::IdentityVaultDekReconciliation,
}

pub struct DirectoryOwnedVaultOpening<'a> {
    pub identity_id: &'a IdentityId,
    pub vault: crate::IdentityVaultKeyOpening<'a>,
}

pub struct DirectoryVaultEnrollment<'a> {
    pub current_app_key: &'a AppKey,
    pub new_app_key: &'a AppKey,
    pub store_id: &'a crate::StoreId,
}

pub struct DirectoryCreationEnrollment<'a> {
    pub app_key: &'a AppKey,
    pub label: &'a str,
}

pub struct LocalIdentityKeyRetirement<'a> {
    pub identity_id: &'a IdentityId,
    pub app_id: &'a crate::AppId,
}

pub(super) enum IdentityEnrollmentPreparation {
    Existing(IdentityId),
    Grant(PreparedIdentityMembership),
}
pub(super) struct PreparedIdentityMembership {
    pub(super) identity_id: IdentityId,
    pub(super) member: IdentityMember,
    pub(super) keys_by_store: Vec<(crate::StoreId, VaultKeys)>,
}
