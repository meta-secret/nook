#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::{ActiveVaultScope, ProviderVaultScope, StorageProviderType};

use super::{AuthProvidersSnapshotData, StorageProviderData};

/// Borrowed provider rows; projections preserve each selected row verbatim.
pub struct ProviderRows<'a> {
    pub providers: &'a [StorageProviderData],
}

/// Provider rows paired with an active-vault observation, not an authorization capability.
pub struct ActiveVaultProviderRows<'a> {
    providers: &'a [StorageProviderData],
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
    pub fn active(self) -> Vec<StorageProviderData> {
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
                    provider.provider_type != StorageProviderType::Local
                        || matches!(&provider.store_id, ProviderVaultScope::StoreId(stored) if stored == id.trim())
                })
                .cloned()
                .collect(),
        }
    }
}

/// Replace the complete provider grant set for `incoming`'s active vault while
/// preserving provider rows owned by every other vault.
impl AuthProvidersSnapshotData {
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
            .filter(|provider| match provider.provider_type {
                StorageProviderType::Local => matches!(&provider.store_id, ProviderVaultScope::StoreId(id) if !id.trim().is_empty() && id.trim() != active_store_id),
                StorageProviderType::Github
                | StorageProviderType::OauthFile
                | StorageProviderType::LocalFolder => !incoming_ids.contains(&provider.id.as_str()),
            })
            .cloned()
            .collect::<Vec<_>>();
        providers.extend(incoming.providers.iter().cloned().map(|mut provider| {
            if provider.provider_type == StorageProviderType::Local {
                provider.store_id = ProviderVaultScope::StoreId(active_store_id.to_owned());
            }
            provider
        }));
        AuthProvidersSnapshotData {
            providers,
            active_vault_store_id: ActiveVaultScope::StoreId(active_store_id.to_owned()),
        }
    }
}

impl ActiveVaultProviderRows<'_> {
    #[must_use]
    pub fn sync(self) -> Vec<StorageProviderData> {
        self.active()
            .into_iter()
            .filter(|provider| provider.provider_type != StorageProviderType::Local)
            .collect()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LocalProviderSelection {
    Unseeded,
    Selected(Box<StorageProviderData>),
}
impl ActiveVaultProviderRows<'_> {
    #[must_use]
    pub fn local(self) -> LocalProviderSelection {
        for provider in self.active() {
            if provider.provider_type == StorageProviderType::Local {
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
    pub fn visible_while_locked(self) -> Vec<StorageProviderData> {
        let providers = self.providers;

        providers
            .iter()
            .filter(|provider| provider.provider_type == StorageProviderType::Local)
            .cloned()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        ActiveVaultScope, ProviderSyncCheckpoint, ProviderVaultScope, StoredGithubPat,
        StoredGithubRepository, StoredLocalFolderConfiguration, StoredOAuthFileConfiguration,
    };

    use crate::StorageProviderType;

    use super::{LocalProviderSelection, ProviderEventFlushTarget, ProviderRows};
    use crate::{AuthProvidersSnapshotData, StorageProviderData};

    struct ProviderScopeFixture {
        provider: StorageProviderData,
    }
    impl ProviderScopeFixture {
        fn github(id: &str, repo: &str, pat: &str) -> Self {
            Self {
                provider: StorageProviderData {
                    id: id.to_owned(),
                    provider_type: StorageProviderType::Github,
                    label: "GitHub".to_owned(),
                    github_pat: StoredGithubPat::Token(pat.to_owned()),
                    github_repo: StoredGithubRepository::Repository(repo.to_owned()),
                    oauth_file: StoredOAuthFileConfiguration::NotApplicable,
                    local_folder: StoredLocalFolderConfiguration::NotApplicable,
                    store_id: ProviderVaultScope::Unscoped,
                    sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                    created_at: "2026-06-24T00:00:00.000Z".to_owned(),
                },
            }
        }

        fn local(id: &str, store_id: &str) -> Self {
            let mut fixture = Self::github(id, "ignored", "ignored");
            fixture.provider.provider_type = StorageProviderType::Local;
            fixture.provider.store_id = ProviderVaultScope::StoreId(store_id.to_owned());
            fixture
        }
    }

    #[test]
    fn local_rows_belong_to_one_vault_and_remote_rows_to_the_identity() {
        let local_a = ProviderScopeFixture::local("local-a", "store-a").provider;
        let local_b = ProviderScopeFixture::local("local-b", "store-b").provider;
        let github = ProviderScopeFixture::github("github", "owner/a", "pat-a").provider;
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
    }

    #[test]
    fn an_unselected_or_blank_scope_shows_every_row() {
        let providers = [
            ProviderScopeFixture::local("local", "vault").provider,
            ProviderScopeFixture::github("github", "repo", "token").provider,
        ];
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
    }

    #[test]
    fn local_folders_sync_while_browser_rows_stay_local() {
        let local = ProviderScopeFixture::local("local", "vault").provider;
        let mut folder = ProviderScopeFixture::github("folder", "repo", "token").provider;
        folder.provider_type = StorageProviderType::LocalFolder;
        let providers = [local.clone(), folder.clone()];
        let rows = ProviderRows {
            providers: &providers,
        };
        assert_eq!(
            rows.for_vault(&ActiveVaultScope::StoreId("vault".to_owned()))
                .sync(),
            vec![folder]
        );
    }

    #[test]
    fn incoming_pairing_replaces_that_vaults_local_row_and_merges_mounts() {
        let old_local = ProviderScopeFixture::local("old-local", "store-a").provider;
        let other_local = ProviderScopeFixture::local("other-local", "store-b").provider;
        let kept_mount = ProviderScopeFixture::github("kept", "owner/kept", "pat").provider;
        let replaced_mount = ProviderScopeFixture::github("same", "owner/old", "old").provider;
        let existing = AuthProvidersSnapshotData {
            providers: vec![
                old_local,
                other_local.clone(),
                kept_mount.clone(),
                replaced_mount,
            ],
            active_vault_store_id: ActiveVaultScope::StoreId("store-a".to_owned()),
        };
        let mut new_local = ProviderScopeFixture::local("new-local", "ignored").provider;
        new_local.store_id = ProviderVaultScope::Unscoped;
        let updated_mount = ProviderScopeFixture::github("same", "owner/new", "new").provider;
        let incoming = AuthProvidersSnapshotData {
            providers: vec![new_local.clone(), updated_mount.clone()],
            active_vault_store_id: ActiveVaultScope::StoreId(" store-a ".to_owned()),
        };

        let replaced = existing.replace_active_vault_grants(&incoming);

        let mut bound_local = new_local;
        bound_local.store_id = ProviderVaultScope::StoreId("store-a".to_owned());
        assert_eq!(
            replaced.providers,
            vec![other_local, kept_mount, bound_local, updated_mount]
        );
        assert_eq!(
            replaced.active_vault_store_id,
            ActiveVaultScope::StoreId("store-a".to_owned())
        );
    }

    #[test]
    fn absent_incoming_scope_returns_incoming_verbatim() {
        let existing = AuthProvidersSnapshotData {
            providers: vec![ProviderScopeFixture::local("existing", "vault").provider],
            active_vault_store_id: ActiveVaultScope::StoreId("vault".to_owned()),
        };
        for scope in [
            ActiveVaultScope::Unselected,
            ActiveVaultScope::StoreId(String::new()),
            ActiveVaultScope::StoreId(" ".to_owned()),
        ] {
            let incoming = AuthProvidersSnapshotData {
                providers: vec![ProviderScopeFixture::github("incoming", "repo", "token").provider],
                active_vault_store_id: scope,
            };
            assert_eq!(existing.replace_active_vault_grants(&incoming), incoming);
        }
    }

    #[test]
    fn every_remote_mount_receives_every_vaults_events() {
        let github = ProviderScopeFixture::github("github", "repo", "token").provider;
        let local = ProviderScopeFixture::local("local", "vault").provider;
        let mut folder = github.clone();
        folder.provider_type = StorageProviderType::LocalFolder;
        assert_eq!(
            github.event_flush_target("any-vault"),
            ProviderEventFlushTarget::Remote
        );
        assert_eq!(
            folder.event_flush_target("any-vault"),
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
    }
}

#[derive(Debug, Clone, serde::Deserialize, tsify::Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEventFlushProviderRequest {
    pub snapshot: AuthProvidersSnapshotData,
    pub vault_store_id: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderEventFlushTarget {
    OtherVault,
    LocalOnly,
    Remote,
}
impl StorageProviderData {
    #[must_use]
    pub fn event_flush_target(&self, vault_store_id: &str) -> ProviderEventFlushTarget {
        match self.provider_type {
            StorageProviderType::Local => match &self.store_id {
                ProviderVaultScope::StoreId(id) if id == vault_store_id => {
                    ProviderEventFlushTarget::LocalOnly
                }
                ProviderVaultScope::StoreId(_) | ProviderVaultScope::Unscoped => {
                    ProviderEventFlushTarget::OtherVault
                }
            },
            StorageProviderType::LocalFolder => ProviderEventFlushTarget::LocalOnly,
            StorageProviderType::Github | StorageProviderType::OauthFile => {
                ProviderEventFlushTarget::Remote
            }
        }
    }
}
impl RemoteEventFlushProviderRequest {
    #[must_use]
    pub fn select(self) -> Vec<StorageProviderData> {
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
