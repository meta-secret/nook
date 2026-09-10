//! Field-owned projection into the existing provider storage schema.
use super::{
    ActiveVaultScope, ProviderVaultScope, StoredGithubPat, StoredGithubRepository,
    StoredGoogleDriveFolder, StoredICloudShareTarget, StoredLocalFolderDirectory,
    StoredLocalFolderHandle, StoredOAuthAccessCredential, StoredOAuthAccountIdentity,
    StoredOAuthRefreshCredential, StoredOAuthRemoteFileId, StoredOAuthRemoteFileName,
    StoredOAuthTokenExpiry,
};
use serde::ser::SerializeMap;

impl StoredOAuthRefreshCredential {
    pub(super) fn serialize_storage_field<M: SerializeMap>(
        &self,
        map: &mut M,
    ) -> Result<(), M::Error> {
        match self {
            Self::NotIssued => Ok(()),
            Self::Token(value) => map.serialize_entry("refreshToken", value),
        }
    }
}

impl StoredOAuthTokenExpiry {
    pub(super) fn serialize_storage_field<M: SerializeMap>(
        &self,
        map: &mut M,
    ) -> Result<(), M::Error> {
        match self {
            Self::Unknown => Ok(()),
            Self::ExpiresAt(value) => map.serialize_entry("expiresAt", value),
        }
    }
}

impl StoredOAuthRemoteFileId {
    pub(super) fn serialize_storage_field<M: SerializeMap>(
        &self,
        map: &mut M,
    ) -> Result<(), M::Error> {
        match self {
            Self::Unresolved => Ok(()),
            Self::FileId(value) => map.serialize_entry("fileId", value),
        }
    }
}

impl StoredOAuthRemoteFileName {
    pub(super) fn serialize_storage_field<M: SerializeMap>(
        &self,
        map: &mut M,
    ) -> Result<(), M::Error> {
        match self {
            Self::Unresolved => Ok(()),
            Self::FileName(value) => map.serialize_entry("fileName", value),
        }
    }
}

impl StoredOAuthAccountIdentity {
    pub(super) fn serialize_storage_field<M: SerializeMap>(
        &self,
        map: &mut M,
    ) -> Result<(), M::Error> {
        match self {
            Self::Unknown => Ok(()),
            Self::Email(value) => map.serialize_entry("accountEmail", value),
        }
    }
}

impl StoredGoogleDriveFolder {
    pub(super) fn serialize_storage_field<M: SerializeMap>(
        &self,
        map: &mut M,
    ) -> Result<(), M::Error> {
        match self {
            Self::Root => Ok(()),
            Self::FolderId(value) => map.serialize_entry("folderId", value),
        }
    }
}

impl StoredICloudShareTarget {
    pub(super) fn serialize_storage_field<M: SerializeMap>(
        &self,
        map: &mut M,
    ) -> Result<(), M::Error> {
        match self {
            Self::Personal => Ok(()),
            Self::SharedTarget(value) => map.serialize_entry("iCloudShareTarget", value),
        }
    }
}

impl StoredLocalFolderDirectory {
    pub(super) fn serialize_storage_field<M: SerializeMap>(
        &self,
        map: &mut M,
    ) -> Result<(), M::Error> {
        match self {
            Self::Unnamed => Ok(()),
            Self::DirectoryName(value) => map.serialize_entry("directoryName", value),
        }
    }
}

impl StoredLocalFolderHandle {
    pub(super) fn serialize_storage_field<M: SerializeMap>(
        &self,
        map: &mut M,
    ) -> Result<(), M::Error> {
        match self {
            Self::Unbound => Ok(()),
            Self::HandleId(value) => map.serialize_entry("handleId", value),
        }
    }
}

impl StoredGithubPat {
    pub(super) fn serialize_storage_field<M: SerializeMap>(
        &self,
        map: &mut M,
    ) -> Result<(), M::Error> {
        match self {
            Self::Missing => Ok(()),
            Self::Token(value) => map.serialize_entry("githubPat", value),
        }
    }
}

impl StoredGithubRepository {
    pub(super) fn serialize_storage_field<M: SerializeMap>(
        &self,
        map: &mut M,
    ) -> Result<(), M::Error> {
        match self {
            Self::DefaultRepository => Ok(()),
            Self::Repository(value) => map.serialize_entry("githubRepo", value),
        }
    }
}

impl ProviderVaultScope {
    pub(super) fn serialize_storage_field<M: SerializeMap>(
        &self,
        map: &mut M,
    ) -> Result<(), M::Error> {
        match self {
            Self::Unscoped => Ok(()),
            Self::StoreId(value) => map.serialize_entry("storeId", value),
        }
    }
}

impl ActiveVaultScope {
    pub(super) fn serialize_storage_field<M: SerializeMap>(
        &self,
        map: &mut M,
    ) -> Result<(), M::Error> {
        match self {
            Self::Unselected => Ok(()),
            Self::StoreId(value) => map.serialize_entry("activeVaultStoreId", value),
        }
    }
}

impl StoredOAuthAccessCredential {
    pub(super) fn serialize_storage_field<M: SerializeMap>(
        &self,
        map: &mut M,
    ) -> Result<(), M::Error> {
        match self {
            Self::SignedOut => map.serialize_entry("accessToken", ""),
            Self::AccessToken(value) => map.serialize_entry("accessToken", value),
        }
    }
}
