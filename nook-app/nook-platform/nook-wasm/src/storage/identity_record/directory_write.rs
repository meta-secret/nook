//! Ownership returned by a successful identity-directory persistence operation.
use nook_core::IdentityDirectory;

pub(crate) struct IdentityDirectoryWrite<T> {
    pub(crate) directory: IdentityDirectory,
    pub(crate) value: T,
}
impl From<IdentityDirectory> for IdentityDirectoryWrite<()> {
    fn from(directory: IdentityDirectory) -> Self {
        Self {
            directory,
            value: (),
        }
    }
}
impl From<nook_core::IdentityDirectoryResolution>
    for IdentityDirectoryWrite<nook_core::IdentityId>
{
    fn from(resolved: nook_core::IdentityDirectoryResolution) -> Self {
        Self {
            directory: resolved.directory,
            value: resolved.identity_id,
        }
    }
}
impl From<nook_core::IdentityDirectoryVaultKeys> for IdentityDirectoryWrite<nook_core::VaultKeys> {
    fn from(opened: nook_core::IdentityDirectoryVaultKeys) -> Self {
        Self {
            directory: opened.directory,
            value: opened.keys,
        }
    }
}
