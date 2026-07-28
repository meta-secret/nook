use super::{
    ManagerStoreScopeRef, ProviderSyncCheckpoint, ProviderSyncRevision, ProviderSyncRevisionRef,
    ProviderSyncedVaultVersion, StorageProviderData,
};

/// Apply successful provider-sync metadata without duplicating vault parsing
/// or hashing in host code.
#[must_use]
pub fn update_provider_sync_metadata(
    providers: &[StorageProviderData],
    provider_id: &str,
    vault_yaml: &str,
    revision: ProviderSyncRevisionRef<'_>,
    manager_store_id: ManagerStoreScopeRef<'_>,
    synced_at: &str,
) -> Vec<StorageProviderData> {
    let version = match crate::read_vault_version(vault_yaml) {
        Ok(version) => match i64::try_from(version) {
            Ok(version) if version > 0 => ProviderSyncedVaultVersion::Version(version),
            Ok(_) | Err(_) => ProviderSyncedVaultVersion::Unknown,
        },
        Err(_) => ProviderSyncedVaultVersion::Unknown,
    };
    let content_hash = crate::vault_content_hash(vault_yaml);
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
                        ProviderSyncRevisionRef::Revision(value) if !value.trim().is_empty() => {
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
                    provider.store_id = Some(store_id.trim().to_owned());
                }
            }
            provider
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use crate::{
        ManagerStoreScopeRef, ProviderSyncCheckpoint, ProviderSyncRevision,
        ProviderSyncRevisionRef, ProviderSyncedVaultVersion, StorageProviderData,
    };

    use super::update_provider_sync_metadata;

    fn github_provider(id: &str, repo: &str, pat: &str) -> StorageProviderData {
        StorageProviderData {
            id: id.to_owned(),
            provider_type: "github".to_owned(),
            label: "GitHub".to_owned(),
            github_pat: Some(pat.to_owned()),
            github_repo: Some(repo.to_owned()),
            oauth_file: None,
            local_folder: None,
            store_id: None,
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: "2026-06-24T00:00:00.000Z".to_owned(),
        }
    }

    #[test]
    fn provider_sync_metadata_update_preserves_unreported_fields() {
        let mut provider = github_provider("github", "owner/repo", "pat");
        provider.sync_checkpoint = ProviderSyncCheckpoint::Synced {
            version: ProviderSyncedVaultVersion::Version(9),
            synced_at: "earlier".to_owned(),
            revision: ProviderSyncRevision::Revision("old-revision".to_owned()),
            common_content_hash: "old-hash".to_owned(),
        };
        let untouched = github_provider("other", "owner/other", "other-pat");

        let updated = update_provider_sync_metadata(
            &[provider, untouched.clone()],
            "github",
            "",
            ProviderSyncRevisionRef::Unreported,
            ManagerStoreScopeRef::Store(" store-1 "),
            "2026-07-17T12:00:00Z",
        );
        assert_eq!(
            updated[0].sync_checkpoint,
            ProviderSyncCheckpoint::Synced {
                version: ProviderSyncedVaultVersion::Version(9),
                synced_at: "2026-07-17T12:00:00Z".to_owned(),
                revision: ProviderSyncRevision::Revision("old-revision".to_owned()),
                common_content_hash: crate::vault_content_hash(""),
            }
        );
        assert_eq!(updated[0].store_id.as_deref(), Some("store-1"));
        assert_eq!(updated[1], untouched);
    }
}
