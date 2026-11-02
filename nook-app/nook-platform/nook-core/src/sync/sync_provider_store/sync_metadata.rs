#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::{
    ManagerStoreScopeRef, ProviderSyncCheckpoint, ProviderSyncRevision, ProviderSyncRevisionRef,
    ProviderSyncedVaultVersion, ProviderVaultScope, StorageProvider,
};

impl StorageProvider {
    /// Apply successful provider-sync metadata without duplicating vault parsing
    /// or hashing in host code.
    #[must_use]
    pub fn update_sync_metadata(
        providers: &[Self],
        provider_id: &str,
        vault_yaml: &str,
        revision: ProviderSyncRevisionRef<'_>,
        manager_store_id: ManagerStoreScopeRef<'_>,
        synced_at: &str,
    ) -> Vec<Self> {
        let version = match crate::VaultFormatDocument::new(vault_yaml).version() {
            Ok(version) => match i64::try_from(u64::from(version)) {
                Ok(version) if version > 0 => ProviderSyncedVaultVersion::Version(version.into()),
                Ok(_) | Err(_) => ProviderSyncedVaultVersion::Unknown,
            },
            Err(_) => ProviderSyncedVaultVersion::Unknown,
        };
        let content_hash = crate::VaultRevision::content_hash(vault_yaml);
        providers
            .iter()
            .cloned()
            .map(|mut provider| {
                if provider.id == provider_id {
                    let (previous_version, previous_revision) = match &provider.sync_checkpoint {
                        ProviderSyncCheckpoint::Synced {
                            version, revision, ..
                        } => (*version, revision.clone()),
                        ProviderSyncCheckpoint::NeverSynced => (
                            ProviderSyncedVaultVersion::Unknown,
                            ProviderSyncRevision::Unknown,
                        ),
                    };
                    provider.sync_checkpoint = ProviderSyncCheckpoint::Synced {
                        version: match version {
                            ProviderSyncedVaultVersion::Unknown => previous_version,
                            ProviderSyncedVaultVersion::Version(_) => version,
                        },
                        synced_at: synced_at.to_owned(),
                        revision: match revision {
                            ProviderSyncRevisionRef::Revision(value)
                                if !value.trim().is_empty() =>
                            {
                                ProviderSyncRevision::Revision(value.trim().to_owned())
                            }
                            ProviderSyncRevisionRef::Unreported
                            | ProviderSyncRevisionRef::Revision(_) => previous_revision,
                        },
                        common_content_hash: content_hash.clone(),
                    };
                    if let ManagerStoreScopeRef::Store(store_id) = manager_store_id
                        && !store_id.trim().is_empty()
                    {
                        provider.store_id = ProviderVaultScope::StoreId(store_id.trim().to_owned());
                    }
                }
                provider
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        ManagerStoreScopeRef, ProviderSyncCheckpoint, ProviderSyncRevision,
        ProviderSyncRevisionRef, ProviderSyncedVaultVersion, StorageProvider, StoredProvider,
    };

    fn github(id: &str) -> anyhow::Result<StorageProvider> {
        Ok(StorageProvider::fixture(
            id,
            StoredProvider::github_fixture()?,
        ))
    }

    #[test]
    fn provider_sync_metadata_update_preserves_unreported_fields() -> anyhow::Result<()> {
        let mut provider = github("github")?;
        provider.sync_checkpoint = ProviderSyncCheckpoint::Synced {
            version: ProviderSyncedVaultVersion::Version(9.into()),
            synced_at: "earlier".to_owned(),
            revision: ProviderSyncRevision::Revision("old-revision".to_owned()),
            common_content_hash: "old-hash".to_owned(),
        };
        let untouched = github("other")?;

        let updated = StorageProvider::update_sync_metadata(
            &[provider, untouched.clone()],
            "github",
            "",
            ProviderSyncRevisionRef::Unreported,
            ManagerStoreScopeRef::Store(" store-1 "),
            "2026-07-17T12:00:00Z",
        );
        assert_eq!(
            updated.first().map(|provider| &provider.sync_checkpoint),
            Some(&ProviderSyncCheckpoint::Synced {
                version: ProviderSyncedVaultVersion::Version(9.into()),
                synced_at: "2026-07-17T12:00:00Z".to_owned(),
                revision: ProviderSyncRevision::Revision("old-revision".to_owned()),
                common_content_hash: crate::VaultRevision::content_hash(""),
            })
        );
        assert_eq!(
            updated.first().map(|provider| &provider.store_id),
            Some(&crate::ProviderVaultScope::StoreId(("store-1").to_owned()))
        );
        assert_eq!(updated.get(1), Some(&untouched));
        Ok(())
    }
}
