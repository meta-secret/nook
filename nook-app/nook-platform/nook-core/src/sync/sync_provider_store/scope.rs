#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::{
    ActiveVaultScope, AuthProvidersSnapshot, ProviderVaultScope, StorageProvider, StoredProvider,
};

/// Borrowed provider rows; projections preserve each selected row verbatim.
pub struct ProviderRows<'a> {
    pub providers: &'a [StorageProvider],
}

/// Provider rows paired with an active-vault observation, not an authorization capability.
pub struct ActiveVaultProviderRows<'a> {
    providers: &'a [StorageProvider],
    active_store_id: &'a ActiveVaultScope,
}
impl<'a> ProviderRows<'a> {
    #[must_use]
    pub fn for_vault(self, active_store_id: &'a ActiveVaultScope) -> ActiveVaultProviderRows<'a> {
        ActiveVaultProviderRows {
            providers: self.providers,
            active_store_id,
        }
    }
}

/// Provider rows visible for the active vault.
impl ActiveVaultProviderRows<'_> {
    #[must_use]
    pub fn active(self) -> Vec<StorageProvider> {
        let Self {
            providers,
            active_store_id,
        } = self;

        match active_store_id {
            ActiveVaultScope::Unselected => providers.to_vec(),
            ActiveVaultScope::StoreId(id) if id.trim().is_empty() => providers.to_vec(),
            ActiveVaultScope::StoreId(id) => providers
                .iter()
                .filter(|provider| {
                    !matches!(provider.provider, StoredProvider::Local {})
                        || matches!(&provider.store_id, ProviderVaultScope::StoreId(stored) if stored == id.trim())
                })
                .cloned()
                .collect(),
        }
    }
}

/// Replace the complete provider grant set for `incoming`'s active vault while
/// preserving provider rows owned by every other vault.
impl AuthProvidersSnapshot {
    #[must_use]
    pub fn replace_active_vault_grants(&self, incoming: &Self) -> Self {
        let existing = self;

        let ActiveVaultScope::StoreId(active_store_id) = &incoming.active_vault_store_id else {
            return incoming.clone();
        };
        let active_store_id = active_store_id.trim();
        if active_store_id.is_empty() {
            return incoming.clone();
        }
        let incoming_ids = incoming
            .providers
            .iter()
            .map(|provider| provider.id.as_str())
            .collect::<Vec<_>>();
        let mut providers = existing
            .providers
            .iter()
            .filter(|provider| match provider.provider {
                StoredProvider::Local {} => matches!(&provider.store_id, ProviderVaultScope::StoreId(id) if !id.trim().is_empty() && id.trim() != active_store_id),
                StoredProvider::LocalFolder(_)
                | StoredProvider::Github(_)
                | StoredProvider::OauthFile(_)
                | StoredProvider::S3(_) => !incoming_ids.contains(&provider.id.as_str()),
            })
            .cloned()
            .collect::<Vec<_>>();
        providers.extend(incoming.providers.iter().cloned().map(|mut provider| {
            if matches!(provider.provider, StoredProvider::Local {}) {
                provider.store_id = ProviderVaultScope::StoreId(active_store_id.to_owned());
            }
            provider
        }));
        AuthProvidersSnapshot {
            providers,
            active_vault_store_id: ActiveVaultScope::StoreId(active_store_id.to_owned()),
        }
    }
}

impl ActiveVaultProviderRows<'_> {
    #[must_use]
    pub fn sync(self) -> Vec<StorageProvider> {
        self.active()
            .into_iter()
            .filter(|provider| !matches!(provider.provider, StoredProvider::Local {}))
            .collect()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LocalProviderSelection {
    Unseeded,
    Selected(Box<StorageProvider>),
}
impl ActiveVaultProviderRows<'_> {
    #[must_use]
    pub fn local(self) -> LocalProviderSelection {
        for provider in self.active() {
            if matches!(provider.provider, StoredProvider::Local {}) {
                return LocalProviderSelection::Selected(Box::new(provider));
            }
        }
        LocalProviderSelection::Unseeded
    }
}

impl ProviderRows<'_> {
    #[must_use]
    pub fn label(&self, provider_id: &str) -> String {
        let providers = self.providers;

        providers
            .iter()
            .find(|provider| provider.id == provider_id)
            .map_or_else(|| provider_id.to_owned(), |provider| provider.label.clone())
    }
}

/// Project Local rows while the device identity is locked.
/// Selected rows are copied verbatim; this does not inspect or scrub credential fields.
impl ProviderRows<'_> {
    #[must_use]
    pub fn visible_while_locked(self) -> Vec<StorageProvider> {
        let providers = self.providers;

        providers
            .iter()
            .filter(|provider| matches!(provider.provider, StoredProvider::Local {}))
            .cloned()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::{LocalProviderSelection, ProviderEventFlushTarget, ProviderRows};
    use crate::{
        ActiveVaultScope, AuthProvidersSnapshot, GithubProvider, ProviderVaultScope,
        StorageProvider, StoredProvider,
    };

    fn github(id: &str, repository: &str, token: &str) -> anyhow::Result<StorageProvider> {
        Ok(StorageProvider {
            label: "GitHub".to_owned(),
            ..StorageProvider::fixture(
                id,
                StoredProvider::Github(GithubProvider::fixture(repository, token)?),
            )
        })
    }

    fn local(id: &str, store_id: &str) -> StorageProvider {
        StorageProvider {
            store_id: ProviderVaultScope::StoreId(store_id.to_owned()),
            ..StorageProvider::fixture(id, StoredProvider::Local {})
        }
    }

    #[test]
    fn local_rows_belong_to_one_vault_and_remote_rows_to_the_identity() -> anyhow::Result<()> {
        let local_a = local("local-a", "store-a");
        let local_b = local("local-b", "store-b");
        let github = github("github", "owner-a", "pat-a")?;
        let providers = vec![local_a.clone(), local_b.clone(), github.clone()];
        let rows = || ProviderRows {
            providers: &providers,
        };
        assert_eq!(
            rows()
                .for_vault(&ActiveVaultScope::StoreId(" store-a ".to_owned()))
                .active(),
            vec![local_a.clone(), github.clone()]
        );
        assert_eq!(
            rows()
                .for_vault(&ActiveVaultScope::StoreId("store-b".to_owned()))
                .sync(),
            vec![github]
        );
        assert_eq!(
            rows()
                .for_vault(&ActiveVaultScope::StoreId("store-a".to_owned()))
                .local(),
            LocalProviderSelection::Selected(Box::new(local_a.clone()))
        );
        assert_eq!(
            rows()
                .for_vault(&ActiveVaultScope::StoreId("store-c".to_owned()))
                .local(),
            LocalProviderSelection::Unseeded
        );
        assert_eq!(rows().visible_while_locked(), vec![local_a, local_b]);
        assert_eq!(rows().label("github"), "GitHub");
        assert_eq!(rows().label("removed"), "removed");
        Ok(())
    }

    #[test]
    fn an_unselected_or_blank_scope_shows_every_row() -> anyhow::Result<()> {
        let providers = [local("local", "vault"), github("github", "repo", "token")?];
        for scope in [
            ActiveVaultScope::Unselected,
            ActiveVaultScope::StoreId(String::new()),
            ActiveVaultScope::StoreId(" \t".to_owned()),
        ] {
            assert_eq!(
                ProviderRows {
                    providers: &providers
                }
                .for_vault(&scope)
                .active(),
                providers
            );
        }
        Ok(())
    }

    #[test]
    fn local_folders_sync_while_browser_rows_stay_local() -> anyhow::Result<()> {
        let folder = StorageProvider::fixture("folder", StoredProvider::local_folder_fixture()?);
        let providers = [local("local", "vault"), folder.clone()];
        assert_eq!(
            ProviderRows {
                providers: &providers
            }
            .for_vault(&ActiveVaultScope::StoreId("vault".to_owned()))
            .sync(),
            vec![folder]
        );
        Ok(())
    }

    #[test]
    fn incoming_pairing_replaces_that_vaults_local_row_and_merges_mounts() -> anyhow::Result<()> {
        let other_local = local("other-local", "store-b");
        let kept_mount = github("kept", "kept", "pat")?;
        let existing = AuthProvidersSnapshot {
            providers: vec![
                local("old-local", "store-a"),
                other_local.clone(),
                kept_mount.clone(),
                github("same", "old", "old")?,
            ],
            active_vault_store_id: ActiveVaultScope::StoreId("store-a".to_owned()),
        };
        let new_local = StorageProvider::fixture("new-local", StoredProvider::Local {});
        let updated_mount = github("same", "new", "new")?;
        let incoming = AuthProvidersSnapshot {
            providers: vec![new_local.clone(), updated_mount.clone()],
            active_vault_store_id: ActiveVaultScope::StoreId(" store-a ".to_owned()),
        };
        let replaced = existing.replace_active_vault_grants(&incoming);
        let bound_local = StorageProvider {
            store_id: ProviderVaultScope::StoreId("store-a".to_owned()),
            ..new_local
        };
        assert_eq!(
            replaced.providers,
            vec![other_local, kept_mount, bound_local, updated_mount]
        );
        assert_eq!(
            replaced.active_vault_store_id,
            ActiveVaultScope::StoreId("store-a".to_owned())
        );
        Ok(())
    }

    #[test]
    fn absent_incoming_scope_returns_incoming_verbatim() -> anyhow::Result<()> {
        let existing = AuthProvidersSnapshot {
            providers: vec![local("existing", "vault")],
            active_vault_store_id: ActiveVaultScope::StoreId("vault".to_owned()),
        };
        for scope in [
            ActiveVaultScope::Unselected,
            ActiveVaultScope::StoreId(String::new()),
            ActiveVaultScope::StoreId(" ".to_owned()),
        ] {
            let incoming = AuthProvidersSnapshot {
                providers: vec![github("incoming", "repo", "token")?],
                active_vault_store_id: scope,
            };
            assert_eq!(existing.replace_active_vault_grants(&incoming), incoming);
        }
        Ok(())
    }

    #[test]
    fn every_remote_mount_receives_every_vaults_events() -> anyhow::Result<()> {
        let local = local("local", "vault");
        for remote in [
            StoredProvider::github_fixture()?,
            StoredProvider::google_drive_fixture()?,
            StoredProvider::s3_fixture()?,
        ] {
            assert_eq!(
                StorageProvider::fixture("remote", remote).event_flush_target("any-vault"),
                ProviderEventFlushTarget::Remote
            );
        }
        assert_eq!(
            StorageProvider::fixture("folder", StoredProvider::local_folder_fixture()?)
                .event_flush_target("any-vault"),
            ProviderEventFlushTarget::LocalOnly
        );
        assert_eq!(
            local.event_flush_target("vault"),
            ProviderEventFlushTarget::LocalOnly
        );
        assert_eq!(
            local.event_flush_target("other"),
            ProviderEventFlushTarget::OtherVault
        );
        Ok(())
    }
}

#[derive(Debug, Clone, serde::Deserialize, tsify::Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEventFlushProviderRequest {
    pub snapshot: AuthProvidersSnapshot,
    pub vault_store_id: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderEventFlushTarget {
    OtherVault,
    LocalOnly,
    Remote,
}
impl StorageProvider {
    #[must_use]
    pub fn event_flush_target(&self, vault_store_id: &str) -> ProviderEventFlushTarget {
        match self.provider {
            StoredProvider::Local {} => match &self.store_id {
                ProviderVaultScope::StoreId(id) if id == vault_store_id => {
                    ProviderEventFlushTarget::LocalOnly
                }
                ProviderVaultScope::StoreId(_) | ProviderVaultScope::Unscoped => {
                    ProviderEventFlushTarget::OtherVault
                }
            },
            StoredProvider::LocalFolder(_) => ProviderEventFlushTarget::LocalOnly,
            StoredProvider::Github(_) | StoredProvider::OauthFile(_) | StoredProvider::S3(_) => {
                ProviderEventFlushTarget::Remote
            }
        }
    }
}
impl RemoteEventFlushProviderRequest {
    #[must_use]
    pub fn select(self) -> Vec<StorageProvider> {
        self.snapshot
            .providers
            .into_iter()
            .filter(|provider| {
                matches!(
                    provider.event_flush_target(&self.vault_store_id),
                    ProviderEventFlushTarget::Remote
                )
            })
            .collect()
    }
}
