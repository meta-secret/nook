#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! Saving the provider being set up into the snapshot.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::{
    ActiveVaultScope, AuthProvidersSnapshot, DuplicateCandidatePolicy, DuplicateProviderSelection,
    DuplicateSyncProvider, LocalProviderRowOutcome, LocalProviderRowRequest,
    LocalProviderSelection, ProviderDraft, ProviderDraftGap, ProviderKind, ProviderRows,
    ProviderSelection, ProviderVaultScope, StorageProvider, StoredProvider,
};

/// Whether the save adds a provider or saves the one already chosen.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum ProviderSaveSetup {
    Existing,
    New,
}

/// What a new provider that is already saved does to the save.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum DuplicateProviderHandling {
    /// The person added it on purpose: report the duplicate.
    Reject,
    /// A setup reached it again: keep the saved row.
    KeepExisting,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderSaveRequest {
    pub snapshot: AuthProvidersSnapshot,
    pub provider_store_id: ProviderVaultScope,
    pub setup: ProviderSaveSetup,
    pub duplicates: DuplicateProviderHandling,
    pub draft: ProviderDraft,
    pub new_provider_id: String,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ProviderSaveOutcome {
    /// The snapshot to persist and the draft the setup continues with.
    Saved {
        snapshot: AuthProvidersSnapshot,
        draft: Box<ProviderDraft>,
    },
    Duplicate,
    /// A new provider was requested from a draft that cannot be saved yet.
    Incomplete {
        gap: ProviderDraftGap,
    },
}

/// What the new-provider step did to the rows.
enum NewProviderStep {
    Added {
        rows: Vec<StorageProvider>,
        merge_target: ProviderSelection,
    },
    Stopped(ProviderSaveOutcome),
}

impl ProviderSaveRequest {
    /// A new remote provider is added unless it is saved already; otherwise
    /// this browser's row is seeded or scoped. A signed-in, bound OAuth draft
    /// then refreshes the saved row it reaches.
    #[must_use]
    pub fn apply(self) -> ProviderSaveOutcome {
        let kind = self.draft.kind();
        let (providers, merge_target) = match (self.setup, kind) {
            (ProviderSaveSetup::New, ProviderKind::Local) | (ProviderSaveSetup::Existing, _) => {
                (self.seeded_local_rows(), ProviderSelection::Unavailable)
            }
            (ProviderSaveSetup::New, _) => match self.add_new_provider() {
                NewProviderStep::Added { rows, merge_target } => (rows, merge_target),
                NewProviderStep::Stopped(outcome) => return outcome,
            },
        };
        let (providers, draft) = self.merge_oauth_sign_in(providers, merge_target);
        ProviderSaveOutcome::Saved {
            snapshot: AuthProvidersSnapshot {
                providers,
                active_vault_store_id: self.snapshot.active_vault_store_id,
            },
            draft: Box::new(draft),
        }
    }

    fn add_new_provider(&self) -> NewProviderStep {
        let provider = match self.draft.clone().complete() {
            Ok(provider) => provider,
            Err(gap) => return NewProviderStep::Stopped(ProviderSaveOutcome::Incomplete { gap }),
        };
        // Every remote row is an identity mount that keeps each vault apart.
        let row = StorageProvider::never_synced(
            self.new_provider_id.clone(),
            ProviderVaultScope::Unscoped,
            self.created_at.clone(),
            provider,
        );
        let active = ProviderRows {
            providers: &self.snapshot.providers,
        }
        .for_vault(&self.snapshot.active_vault_store_id)
        .active();
        let duplicate = DuplicateProviderSelection {
            providers: &active,
            candidate: &row,
            policy: DuplicateCandidatePolicy::IncludeAll,
        }
        .find();
        let mut rows = self.snapshot.providers.clone();
        match (duplicate, self.duplicates) {
            (DuplicateSyncProvider::Duplicate { .. }, DuplicateProviderHandling::Reject) => {
                NewProviderStep::Stopped(ProviderSaveOutcome::Duplicate)
            }
            (DuplicateSyncProvider::Duplicate { .. }, DuplicateProviderHandling::KeepExisting) => {
                NewProviderStep::Added {
                    rows,
                    merge_target: ProviderSelection::Unavailable,
                }
            }
            (DuplicateSyncProvider::Unique, _) => {
                let merge_target = match row.provider {
                    StoredProvider::OauthFile(_) => {
                        ProviderSelection::Selected(row.id.clone().into())
                    }
                    StoredProvider::Local {}
                    | StoredProvider::LocalFolder(_)
                    | StoredProvider::Github(_)
                    | StoredProvider::S3(_) => ProviderSelection::Unavailable,
                };
                rows.push(row);
                NewProviderStep::Added { rows, merge_target }
            }
        }
    }

    /// Seed this browser's row when the setup adds it, scope the active
    /// vault's row, or seed one for a vault the save names.
    fn seeded_local_rows(&self) -> Vec<StorageProvider> {
        let local = ProviderRows {
            providers: &self.snapshot.providers,
        }
        .for_vault(&self.snapshot.active_vault_store_id)
        .local();
        let mut providers = self.snapshot.providers.clone();
        match (
            self.setup,
            self.draft.kind(),
            local,
            &self.provider_store_id,
        ) {
            (ProviderSaveSetup::New, ProviderKind::Local, LocalProviderSelection::Unseeded, _) => {
                providers.push(StorageProvider::never_synced(
                    self.new_provider_id.clone(),
                    self.provider_store_id.clone(),
                    self.created_at.clone(),
                    StoredProvider::Local {},
                ));
                providers
            }
            (_, _, LocalProviderSelection::Selected(local), _) => {
                for provider in &mut providers {
                    if provider.id == local.id {
                        provider.store_id = self.provider_store_id.clone();
                    }
                }
                providers
            }
            (_, _, LocalProviderSelection::Unseeded, ProviderVaultScope::StoreId(store_id)) => {
                let LocalProviderRowOutcome { snapshot, .. } = AuthProvidersSnapshot {
                    providers,
                    active_vault_store_id: self.snapshot.active_vault_store_id.clone(),
                }
                .ensure_local_row(LocalProviderRowRequest {
                    active_store_id: &ActiveVaultScope::StoreId(store_id.clone()),
                    new_id: &self.new_provider_id,
                    created_at: &self.created_at,
                });
                snapshot.providers
            }
            (_, _, LocalProviderSelection::Unseeded, ProviderVaultScope::Unscoped) => providers,
        }
    }

    /// A complete OAuth draft refreshes the saved row it reaches: the row just
    /// added, or the active vault's row with the same target. The outcome's
    /// draft is that merged row, or the request's draft when nothing merged.
    fn merge_oauth_sign_in(
        &self,
        mut providers: Vec<StorageProvider>,
        merge_target: ProviderSelection,
    ) -> (Vec<StorageProvider>, ProviderDraft) {
        let Ok(StoredProvider::OauthFile(fresh)) = self.draft.clone().complete() else {
            return (providers, self.draft.clone());
        };
        let target = match merge_target {
            ProviderSelection::Selected(id) => ProviderSelection::Selected(id),
            ProviderSelection::Unavailable => {
                let candidate = StorageProvider::never_synced(
                    self.new_provider_id.clone(),
                    ProviderVaultScope::Unscoped,
                    self.created_at.clone(),
                    StoredProvider::OauthFile(fresh.clone()),
                );
                let sync = ProviderRows {
                    providers: &providers,
                }
                .for_vault(&self.snapshot.active_vault_store_id)
                .sync();
                match (DuplicateProviderSelection {
                    providers: &sync,
                    candidate: &candidate,
                    policy: DuplicateCandidatePolicy::IncludeAll,
                })
                .find()
                {
                    DuplicateSyncProvider::Duplicate { provider } => {
                        ProviderSelection::Selected(provider.id.into())
                    }
                    DuplicateSyncProvider::Unique => ProviderSelection::Unavailable,
                }
            }
        };
        let ProviderSelection::Selected(target) = target else {
            return (providers, self.draft.clone());
        };
        let mut draft = self.draft.clone();
        for provider in &mut providers {
            if provider.id == target.as_str()
                && let StoredProvider::OauthFile(saved) = &provider.provider
            {
                let merged = StoredProvider::OauthFile(fresh.clone().merged_into(saved));
                draft = ProviderDraft::from(merged.clone());
                provider.provider = merged;
            }
        }
        (providers, draft)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        DuplicateProviderHandling, ProviderSaveOutcome, ProviderSaveRequest, ProviderSaveSetup,
    };
    use crate::{
        ActiveVaultScope, AuthProvidersSnapshot, GoogleDriveAccess, GoogleDriveAuthorization,
        GoogleDriveFolderId, OAuthAccountIdentity, OAuthFilePreset, ProviderDraft,
        ProviderDraftGap, ProviderKind, ProviderVaultScope, S3Connection, StorageProvider,
        StoredProvider,
    };

    impl ProviderSaveRequest {
        fn fixture(draft: ProviderDraft) -> Self {
            Self {
                snapshot: AuthProvidersSnapshot {
                    providers: Vec::new(),
                    active_vault_store_id: ActiveVaultScope::StoreId("store-a".to_owned()),
                },
                provider_store_id: ProviderVaultScope::StoreId("store-a".to_owned()),
                setup: ProviderSaveSetup::New,
                duplicates: DuplicateProviderHandling::Reject,
                draft,
                new_provider_id: "new-row".to_owned(),
                created_at: "2026-06-24T00:00:00.000Z".to_owned(),
            }
        }
    }

    fn saved(
        outcome: ProviderSaveOutcome,
    ) -> anyhow::Result<(AuthProvidersSnapshot, ProviderDraft)> {
        match outcome {
            ProviderSaveOutcome::Saved { snapshot, draft } => Ok((snapshot, *draft)),
            other => anyhow::bail!("expected a save, got {other:?}"),
        }
    }

    fn drive_draft(token: &str, account: OAuthAccountIdentity) -> anyhow::Result<ProviderDraft> {
        Ok(
            ProviderDraft::begin(ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive))
                .with_google_drive_access(GoogleDriveAccess {
                    authorization: GoogleDriveAuthorization::fixture(token)?,
                    account,
                })
                .with_google_drive_folder(GoogleDriveFolderId::parse("folder-1")?)?,
        )
    }

    #[test]
    fn a_new_provider_of_each_kind_is_an_unscoped_identity_mount() -> anyhow::Result<()> {
        for provider in StoredProvider::every_fixture()? {
            if matches!(provider, StoredProvider::Local {}) {
                continue;
            }
            let draft = ProviderDraft::from(provider.clone());
            let (snapshot, returned) = saved(ProviderSaveRequest::fixture(draft.clone()).apply())?;
            let [row] = snapshot.providers.as_slice() else {
                anyhow::bail!("one row is added");
            };
            assert_eq!(row.provider, provider);
            assert_eq!(row.label, provider.label());
            assert_eq!(row.store_id, ProviderVaultScope::Unscoped);
            assert_eq!(returned, draft);
        }
        Ok(())
    }

    #[test]
    fn an_incomplete_draft_of_each_kind_names_its_gap() {
        for (kind, gap) in [
            (ProviderKind::LocalFolder, ProviderDraftGap::LocalFolder),
            (ProviderKind::Github, ProviderDraftGap::GithubToken),
            (
                ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive),
                ProviderDraftGap::OAuthSignIn,
            ),
            (
                ProviderKind::OauthFile(OAuthFilePreset::ICloud),
                ProviderDraftGap::OAuthSignIn,
            ),
            (ProviderKind::S3, ProviderDraftGap::S3Connection),
        ] {
            assert_eq!(
                ProviderSaveRequest::fixture(ProviderDraft::begin(kind)).apply(),
                ProviderSaveOutcome::Incomplete { gap }
            );
        }
    }

    #[test]
    fn a_duplicate_is_rejected_or_kept_as_the_setup_asks() -> anyhow::Result<()> {
        let existing = StorageProvider::fixture("s3-a", StoredProvider::s3_fixture()?);
        let mut request = ProviderSaveRequest::fixture(ProviderDraft::from(StoredProvider::S3(
            S3Connection::fixture()?,
        )));
        request.snapshot.providers = vec![existing.clone()];
        assert_eq!(request.clone().apply(), ProviderSaveOutcome::Duplicate);
        request.duplicates = DuplicateProviderHandling::KeepExisting;
        let (snapshot, _) = saved(request.apply())?;
        assert_eq!(snapshot.providers, vec![existing]);
        Ok(())
    }

    #[test]
    fn this_browsers_row_is_seeded_once_and_scoped_to_the_vault() -> anyhow::Result<()> {
        let (snapshot, _) = saved(ProviderSaveRequest::fixture(ProviderDraft::Local {}).apply())?;
        let [local] = snapshot.providers.as_slice() else {
            anyhow::bail!("this browser's row is seeded");
        };
        assert_eq!(local.provider, StoredProvider::Local {});
        assert_eq!(
            local.store_id,
            ProviderVaultScope::StoreId("store-a".to_owned())
        );
        // Saving the chosen provider scopes the vault's row instead.
        let mut existing = ProviderSaveRequest::fixture(ProviderDraft::Local {});
        existing.setup = ProviderSaveSetup::Existing;
        existing.snapshot.providers = snapshot.providers.clone();
        existing.provider_store_id = ProviderVaultScope::StoreId("store-a".to_owned());
        let (scoped, _) = saved(existing.apply())?;
        assert_eq!(scoped.providers, snapshot.providers);
        // An existing save for a known vault seeds its row.
        let mut known = ProviderSaveRequest::fixture(ProviderDraft::Local {});
        known.setup = ProviderSaveSetup::Existing;
        known.snapshot.active_vault_store_id = ActiveVaultScope::Unselected;
        known.provider_store_id = ProviderVaultScope::StoreId("store-b".to_owned());
        let (seeded, _) = saved(known.apply())?;
        assert_eq!(
            seeded.providers.first().map(|row| &row.store_id),
            Some(&ProviderVaultScope::StoreId("store-b".to_owned()))
        );
        Ok(())
    }

    #[test]
    fn an_oauth_sign_in_refreshes_the_saved_row_it_reaches() -> anyhow::Result<()> {
        let account = OAuthAccountIdentity::Email("owner@example.com".to_owned());
        let (first, _) = saved(
            ProviderSaveRequest::fixture(drive_draft("TEST-ONLY-old", account.clone())?).apply(),
        )?;
        // The same folder and account reached again with a fresh token.
        let mut again = ProviderSaveRequest::fixture(drive_draft("TEST-ONLY-new", account)?);
        again.setup = ProviderSaveSetup::Existing;
        again.snapshot = first.clone();
        let (merged, draft) = saved(again.apply())?;
        // The existing save also seeds this browser's row for the vault.
        let drive_rows = merged
            .providers
            .iter()
            .filter(|row| matches!(row.provider, StoredProvider::OauthFile(_)))
            .collect::<Vec<_>>();
        let [row] = drive_rows.as_slice() else {
            anyhow::bail!("the saved row is refreshed, not duplicated");
        };
        let StoredProvider::OauthFile(oauth) = &row.provider else {
            anyhow::bail!("the row stays a Drive row");
        };
        assert_eq!(oauth.token().expose(), "TEST-ONLY-new");
        assert_eq!(draft, ProviderDraft::from(row.provider.clone()));
        // A draft that is not signed in merges nothing and comes back as sent.
        let unsigned = ProviderDraft::begin(ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive));
        let mut pending = ProviderSaveRequest::fixture(unsigned.clone());
        pending.setup = ProviderSaveSetup::Existing;
        pending.snapshot = first;
        let (kept, returned) = saved(pending.apply())?;
        assert_eq!(returned, unsigned);
        assert_eq!(
            kept.providers
                .iter()
                .filter(|row| matches!(row.provider, StoredProvider::OauthFile(_)))
                .count(),
            1
        );
        Ok(())
    }
}
