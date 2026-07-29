use crate::errors::ValidationResult;
use crate::StorageProviderType;

use super::{AuthProvidersSnapshotData, StorageProviderData};

/// Provider rows visible for the active vault.
#[must_use]
pub fn active_vault_providers(
    providers: &[StorageProviderData],
    active_store_id: Option<&str>,
) -> Vec<StorageProviderData> {
    let active_store_id = active_store_id.map(str::trim).filter(|id| !id.is_empty());
    match active_store_id {
        None => providers.to_vec(),
        Some(active_store_id) => providers
            .iter()
            .filter(|provider| provider.store_id.as_deref() == Some(active_store_id))
            .cloned()
            .collect(),
    }
}

/// Replace the complete provider grant set for `incoming`'s active vault while
/// preserving provider rows owned by every other vault.
#[must_use]
pub fn replace_active_vault_provider_grants(
    existing: &AuthProvidersSnapshotData,
    incoming: &AuthProvidersSnapshotData,
) -> AuthProvidersSnapshotData {
    let Some(active_store_id) = incoming
        .active_vault_store_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    else {
        return incoming.clone();
    };
    let mut providers = existing
        .providers
        .iter()
        .filter_map(|provider| {
            let provider_store_id = provider
                .store_id
                .as_deref()
                .map(str::trim)
                .filter(|id| !id.is_empty());
            match provider_store_id {
                Some(store_id) if store_id == active_store_id => None,
                Some(_) => Some(provider.clone()),
                None => None,
            }
        })
        .collect::<Vec<_>>();
    providers.extend(incoming.providers.iter().cloned().map(|mut provider| {
        provider.store_id = Some(active_store_id.to_owned());
        provider
    }));
    AuthProvidersSnapshotData {
        providers,
        active_vault_store_id: Some(active_store_id.to_owned()),
    }
}

pub fn sync_providers_for_active_vault(
    providers: &[StorageProviderData],
    active_store_id: Option<&str>,
) -> ValidationResult<Vec<StorageProviderData>> {
    active_vault_providers(providers, active_store_id)
        .into_iter()
        .filter_map(|provider| {
            StorageProviderType::parse(&provider.provider_type)
                .map(|provider_type| {
                    (provider_type != StorageProviderType::Local).then_some(provider)
                })
                .transpose()
        })
        .collect()
}

pub fn local_provider_for_active_vault(
    providers: &[StorageProviderData],
    active_store_id: Option<&str>,
) -> ValidationResult<Option<StorageProviderData>> {
    for provider in active_vault_providers(providers, active_store_id) {
        if StorageProviderType::parse(&provider.provider_type)? == StorageProviderType::Local {
            return Ok(Some(provider));
        }
    }
    Ok(None)
}

#[must_use]
pub fn provider_label_by_id(providers: &[StorageProviderData], provider_id: &str) -> String {
    providers
        .iter()
        .find(|provider| provider.id == provider_id)
        .map_or_else(|| provider_id.to_owned(), |provider| provider.label.clone())
}

/// Keep only non-secret local rows while the device identity is locked.
/// Unknown or malformed provider types fail closed and are discarded.
#[must_use]
pub fn providers_visible_while_device_locked(
    providers: &[StorageProviderData],
) -> Vec<StorageProviderData> {
    providers
        .iter()
        .filter(|provider| provider.provider_type == StorageProviderType::Local.as_str())
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use crate::StorageProviderType;

    use super::{
        active_vault_providers, local_provider_for_active_vault, provider_label_by_id,
        providers_visible_while_device_locked, replace_active_vault_provider_grants,
        sync_providers_for_active_vault,
    };
    use crate::{AuthProvidersSnapshotData, StorageProviderData};

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
            sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
            created_at: "2026-06-24T00:00:00.000Z".to_owned(),
        }
    }

    #[test]
    fn active_vault_provider_scope_and_roles_are_core_owned() -> anyhow::Result<()> {
        let mut local_a = github_provider("local-a", "ignored", "ignored");
        local_a.provider_type = StorageProviderType::Local.as_str().to_owned();
        local_a.store_id = Some("store-a".to_owned());
        let mut github_a = github_provider("github-a", "owner/a", "pat-a");
        github_a.store_id = Some("store-a".to_owned());
        let mut github_b = github_provider("github-b", "owner/b", "pat-b");
        github_b.store_id = Some("store-b".to_owned());
        let unscoped = github_provider("unscoped", "owner/unscoped", "pat-unscoped");
        let providers = vec![local_a.clone(), github_a.clone(), github_b, unscoped];

        assert_eq!(
            active_vault_providers(&providers, Some(" store-a ")),
            vec![local_a.clone(), github_a.clone()]
        );
        assert_eq!(
            sync_providers_for_active_vault(&providers, Some("store-a"))?,
            vec![github_a]
        );
        assert_eq!(
            local_provider_for_active_vault(&providers, Some("store-a"))?,
            Some(local_a.clone())
        );
        assert_eq!(provider_label_by_id(&providers, "github-b"), "GitHub");
        assert_eq!(provider_label_by_id(&providers, "removed"), "removed");
        assert_eq!(
            providers_visible_while_device_locked(&providers),
            vec![local_a]
        );
        Ok(())
    }

    #[test]
    fn incoming_pairing_replaces_only_that_vaults_provider_grants() {
        let mut removed_a = github_provider("removed-a", "owner/old", "pat-old");
        removed_a.store_id = Some("store-a".to_owned());
        let mut retained_b = github_provider("retained-b", "owner/b", "pat-b");
        retained_b.store_id = Some("store-b".to_owned());
        let mut replacement_a = github_provider("replacement-a", "owner/new", "pat-new");
        replacement_a.store_id = None;
        let existing = AuthProvidersSnapshotData {
            providers: vec![removed_a, retained_b.clone()],
            active_vault_store_id: Some("store-a".to_owned()),
        };
        let incoming = AuthProvidersSnapshotData {
            providers: vec![replacement_a],
            active_vault_store_id: Some("store-a".to_owned()),
        };

        let replaced = replace_active_vault_provider_grants(&existing, &incoming);

        assert_eq!(replaced.providers.len(), 2);
        assert!(replaced.providers.contains(&retained_b));
        assert_eq!(
            replaced
                .providers
                .iter()
                .find(|provider| provider.id == "replacement-a")
                .and_then(|provider| provider.store_id.as_deref()),
            Some("store-a")
        );
        assert!(replaced
            .providers
            .iter()
            .all(|provider| provider.id != "removed-a"));
    }

    #[test]
    fn incoming_pairing_discards_unscoped_rows() {
        let unscoped = github_provider("unscoped-a", "owner/a", "pat-a");
        let existing = AuthProvidersSnapshotData {
            providers: vec![unscoped],
            active_vault_store_id: Some("store-a".to_owned()),
        };
        let incoming = AuthProvidersSnapshotData {
            providers: Vec::new(),
            active_vault_store_id: Some("store-b".to_owned()),
        };

        let replaced = replace_active_vault_provider_grants(&existing, &incoming);

        assert!(replaced.providers.is_empty());
    }

    #[test]
    fn empty_incoming_pairing_removes_every_provider_for_that_vault() {
        let mut removed_a = github_provider("removed-a", "owner/a", "pat-a");
        removed_a.store_id = Some("store-a".to_owned());
        let mut retained_b = github_provider("retained-b", "owner/b", "pat-b");
        retained_b.store_id = Some("store-b".to_owned());
        let existing = AuthProvidersSnapshotData {
            providers: vec![removed_a, retained_b.clone()],
            active_vault_store_id: Some("store-a".to_owned()),
        };
        let incoming = AuthProvidersSnapshotData {
            providers: Vec::new(),
            active_vault_store_id: Some("store-a".to_owned()),
        };

        let replaced = replace_active_vault_provider_grants(&existing, &incoming);

        assert_eq!(replaced.providers, vec![retained_b]);
    }
}
