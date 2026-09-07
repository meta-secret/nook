#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::errors::ValidationResult;
use crate::{ActiveVaultScope, ProviderVaultScope, StorageProviderType};

use super::{AuthProvidersSnapshotData, StorageProviderData};

/// Borrowed provider rows; projections preserve each selected row verbatim.
pub struct ProviderRows<'a> {
    pub providers: &'a [StorageProviderData],
}

/// Provider rows paired with an active-vault observation, not an authorization capability.
pub struct ActiveVaultProviderRows<'a> {
    providers: &'a [StorageProviderData],
    active_store_id: Option<&'a str>,
}
impl<'a> ProviderRows<'a> {
    #[must_use]
    pub fn for_vault(self, active_store_id: Option<&'a str>) -> ActiveVaultProviderRows<'a> {
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
}

/// Replace the complete provider grant set for `incoming`'s active vault while
/// preserving provider rows owned by every other vault.
impl AuthProvidersSnapshotData {
    #[must_use]
    pub fn replace_active_vault_grants(&self, incoming: &Self) -> Self {
        let existing = self;

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
            provider.store_id = ProviderVaultScope::StoreId(active_store_id.to_owned());
            provider
        }));
        AuthProvidersSnapshotData {
            providers,
            active_vault_store_id: ActiveVaultScope::StoreId(active_store_id.to_owned()),
        }
    }
}

impl ActiveVaultProviderRows<'_> {
    pub fn sync(self) -> ValidationResult<Vec<StorageProviderData>> {
        Ok(self
            .active()
            .into_iter()
            .filter(|provider| provider.provider_type != StorageProviderType::Local)
            .collect())
    }
}

impl ActiveVaultProviderRows<'_> {
    pub fn local(self) -> ValidationResult<Option<StorageProviderData>> {
        for provider in self.active() {
            if provider.provider_type == StorageProviderType::Local {
                return Ok(Some(provider));
            }
        }
        Ok(None)
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

    use super::ProviderRows;
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
    }

    #[test]
    fn active_vault_provider_scope_and_roles_are_core_owned() -> anyhow::Result<()> {
        let mut local_a = ProviderScopeFixture::github("local-a", "ignored", "ignored").provider;
        local_a.provider_type = StorageProviderType::Local;
        local_a.store_id = ProviderVaultScope::StoreId("store-a".to_owned());
        let mut github_a = ProviderScopeFixture::github("github-a", "owner/a", "pat-a").provider;
        github_a.store_id = ProviderVaultScope::StoreId("store-a".to_owned());
        let mut github_b = ProviderScopeFixture::github("github-b", "owner/b", "pat-b").provider;
        github_b.store_id = ProviderVaultScope::StoreId("store-b".to_owned());
        let unscoped =
            ProviderScopeFixture::github("unscoped", "owner/unscoped", "pat-unscoped").provider;
        let providers = vec![local_a.clone(), github_a.clone(), github_b, unscoped];

        assert_eq!(
            ProviderRows {
                providers: &providers
            }
            .for_vault(Some(" store-a "))
            .active(),
            vec![local_a.clone(), github_a.clone()]
        );
        assert_eq!(
            ProviderRows {
                providers: &providers
            }
            .for_vault(Some("store-a"))
            .sync()?,
            vec![github_a]
        );
        assert_eq!(
            ProviderRows {
                providers: &providers
            }
            .for_vault(Some("store-a"))
            .local()?,
            Some(local_a.clone())
        );
        assert_eq!(
            ProviderRows {
                providers: &providers
            }
            .label("github-b"),
            "GitHub"
        );
        assert_eq!(
            ProviderRows {
                providers: &providers
            }
            .label("removed"),
            "removed"
        );
        assert_eq!(
            ProviderRows {
                providers: &providers
            }
            .visible_while_locked(),
            vec![local_a]
        );
        Ok(())
    }

    #[test]
    fn incoming_pairing_replaces_only_that_vaults_provider_grants() {
        let mut removed_a =
            ProviderScopeFixture::github("removed-a", "owner/old", "pat-old").provider;
        removed_a.store_id = ProviderVaultScope::StoreId("store-a".to_owned());
        let mut retained_b =
            ProviderScopeFixture::github("retained-b", "owner/b", "pat-b").provider;
        retained_b.store_id = ProviderVaultScope::StoreId("store-b".to_owned());
        let mut replacement_a =
            ProviderScopeFixture::github("replacement-a", "owner/new", "pat-new").provider;
        replacement_a.store_id = ProviderVaultScope::Unscoped;
        let existing = AuthProvidersSnapshotData {
            providers: vec![removed_a, retained_b.clone()],
            active_vault_store_id: ActiveVaultScope::StoreId("store-a".to_owned()),
        };
        let incoming = AuthProvidersSnapshotData {
            providers: vec![replacement_a],
            active_vault_store_id: ActiveVaultScope::StoreId("store-a".to_owned()),
        };

        let replaced = existing.replace_active_vault_grants(&incoming);

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
        assert!(
            replaced
                .providers
                .iter()
                .all(|provider| provider.id != "removed-a")
        );
    }

    #[test]
    fn incoming_pairing_discards_unscoped_rows() {
        let unscoped = ProviderScopeFixture::github("unscoped-a", "owner/a", "pat-a").provider;
        let existing = AuthProvidersSnapshotData {
            providers: vec![unscoped],
            active_vault_store_id: ActiveVaultScope::StoreId("store-a".to_owned()),
        };
        let incoming = AuthProvidersSnapshotData {
            providers: Vec::new(),
            active_vault_store_id: ActiveVaultScope::StoreId("store-b".to_owned()),
        };

        let replaced = existing.replace_active_vault_grants(&incoming);

        assert!(replaced.providers.is_empty());
    }

    #[test]
    fn empty_incoming_pairing_removes_every_provider_for_that_vault() {
        let mut removed_a = ProviderScopeFixture::github("removed-a", "owner/a", "pat-a").provider;
        removed_a.store_id = ProviderVaultScope::StoreId("store-a".to_owned());
        let mut retained_b =
            ProviderScopeFixture::github("retained-b", "owner/b", "pat-b").provider;
        retained_b.store_id = ProviderVaultScope::StoreId("store-b".to_owned());
        let existing = AuthProvidersSnapshotData {
            providers: vec![removed_a, retained_b.clone()],
            active_vault_store_id: ActiveVaultScope::StoreId("store-a".to_owned()),
        };
        let incoming = AuthProvidersSnapshotData {
            providers: Vec::new(),
            active_vault_store_id: ActiveVaultScope::StoreId("store-a".to_owned()),
        };

        let replaced = existing.replace_active_vault_grants(&incoming);

        assert_eq!(replaced.providers, vec![retained_b]);
    }

    impl ProviderScopeFixture {
        fn scoped(mut self, store_id: &str) -> Self {
            self.provider.store_id = ProviderVaultScope::StoreId(store_id.to_owned());
            self
        }
    }

    #[test]
    fn view_trims_only_observed_scope_and_blank_scope_retains_all_rows() {
        let exact = ProviderScopeFixture::github("exact", "repo", " token ")
            .scoped("vault")
            .provider;
        let padded = ProviderScopeFixture::github("padded", "repo", "token")
            .scoped(" vault ")
            .provider;
        let unscoped = ProviderScopeFixture::github("unscoped", "repo", "token").provider;
        let providers = [exact.clone(), padded, unscoped];
        let before = providers.clone();
        for scope in [None, Some(""), Some(" \t")] {
            assert_eq!(
                ProviderRows {
                    providers: &providers
                }
                .for_vault(scope)
                .active(),
                providers
            );
        }
        for scope in ["vault", " vault "] {
            assert_eq!(
                ProviderRows {
                    providers: &providers
                }
                .for_vault(Some(scope))
                .active(),
                vec![exact.clone()]
            );
        }
        assert!(
            ProviderRows {
                providers: &providers
            }
            .for_vault(Some("other"))
            .active()
            .is_empty()
        );
        assert_eq!(providers, before);
    }

    #[test]
    fn role_views_keep_local_folder_and_copy_local_rows_verbatim() -> anyhow::Result<()> {
        let mut first = ProviderScopeFixture::github("first", "repo", " retained credential ")
            .scoped("vault")
            .provider;
        first.provider_type = StorageProviderType::Local;
        let mut second = first.clone();
        second.id = "second".to_owned();
        let mut folder = first.clone();
        folder.id = "folder".to_owned();
        folder.provider_type = StorageProviderType::LocalFolder;
        let providers = [first.clone(), folder.clone(), second.clone()];
        assert_eq!(
            ProviderRows {
                providers: &providers
            }
            .for_vault(Some("vault"))
            .sync()?,
            vec![folder]
        );
        assert_eq!(
            ProviderRows {
                providers: &providers
            }
            .for_vault(Some("vault"))
            .local()?,
            Some(first.clone())
        );
        assert_eq!(
            ProviderRows {
                providers: &providers
            }
            .visible_while_locked(),
            vec![first, second]
        );
        Ok(())
    }

    #[test]
    fn label_projection_keeps_first_duplicate_and_raw_fallback() {
        let first = ProviderScopeFixture::github("same", "repo", "token").provider;
        let mut second = first.clone();
        second.label = "later label".to_owned();
        let providers = [first.clone(), second];
        assert_eq!(
            ProviderRows {
                providers: &providers
            }
            .label("same"),
            first.label
        );
        assert_eq!(
            ProviderRows {
                providers: &providers
            }
            .label(" missing "),
            " missing "
        );
    }

    #[test]
    fn replacement_trims_scopes_keeps_order_duplicates_and_inputs() {
        let removed = ProviderScopeFixture::github("removed", "old", "old")
            .scoped(" vault ")
            .provider;
        let retained_first = ProviderScopeFixture::github("first", "a", " first-token ")
            .scoped(" other ")
            .provider;
        let retained_last = ProviderScopeFixture::github("last", "b", "last-token")
            .scoped("last")
            .provider;
        let unscoped = ProviderScopeFixture::github("unscoped", "c", "token").provider;
        let existing = AuthProvidersSnapshotData {
            providers: vec![
                retained_first.clone(),
                removed,
                unscoped,
                retained_last.clone(),
            ],
            active_vault_store_id: ActiveVaultScope::StoreId("other".to_owned()),
        };
        let incoming_row = ProviderScopeFixture::github("duplicate", "new", " exact bytes ")
            .scoped("ignored")
            .provider;
        let incoming = AuthProvidersSnapshotData {
            providers: vec![incoming_row.clone(), incoming_row.clone()],
            active_vault_store_id: ActiveVaultScope::StoreId(" vault ".to_owned()),
        };
        let before_existing = existing.clone();
        let before_incoming = incoming.clone();
        let replaced = existing.replace_active_vault_grants(&incoming);
        let mut rebound = incoming_row;
        rebound.store_id = ProviderVaultScope::StoreId("vault".to_owned());
        assert_eq!(
            replaced.providers,
            vec![retained_first, retained_last, rebound.clone(), rebound]
        );
        assert_eq!(replaced.active_vault_store_id.as_deref(), Some("vault"));
        assert_eq!(existing, before_existing);
        assert_eq!(incoming, before_incoming);
    }

    #[test]
    fn absent_incoming_scope_returns_incoming_verbatim() {
        let existing = AuthProvidersSnapshotData {
            providers: vec![
                ProviderScopeFixture::github("existing", "repo", "token")
                    .scoped("vault")
                    .provider,
            ],
            active_vault_store_id: ActiveVaultScope::StoreId("vault".to_owned()),
        };
        for scope in [
            ActiveVaultScope::Unselected,
            ActiveVaultScope::StoreId(String::new()),
            ActiveVaultScope::StoreId(" ".to_owned()),
        ] {
            let incoming = AuthProvidersSnapshotData {
                providers: vec![
                    ProviderScopeFixture::github("incoming", "repo", "token")
                        .scoped(" original ")
                        .provider,
                ],
                active_vault_store_id: scope,
            };
            assert_eq!(existing.replace_active_vault_grants(&incoming), incoming);
        }
    }
}
