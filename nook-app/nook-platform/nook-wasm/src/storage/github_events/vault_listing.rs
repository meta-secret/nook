//! A GitHub repository as the provider vault listing reads it.
//!
//! GitHub reports how many event files a namespace holds, not when they were
//! made, so each vault is observed by its event count. An identity's log is
//! named by its path. Nothing is decrypted.

use std::future::{self, Future};

use nook_core::{
    EventLogNamespaceKind, IdentityId, LocalEventWrite, PlacedNamespace, ProviderVaultObservation,
};

use super::{GitHubEventStore, GitHubRepository};
use crate::NookError;
use crate::storage::event_store::EventStore;
use crate::storage::provider_vault_listing::{
    CountedVaultNamespace, ListedVault, NamespaceWrite, ProviderLocation,
};

impl GitHubRepository<'_> {
    /// The store of one namespace in the repository.
    pub(crate) fn store<'b>(&'b self, placed: &'b PlacedNamespace) -> GitHubEventStore<'b> {
        GitHubEventStore {
            token: self.token,
            repo: self.repo,
            placed,
        }
    }
}

impl ProviderLocation for GitHubRepository<'_> {
    type Namespace = PlacedNamespace;
    const PROVIDER: &'static str = "GitHub";

    async fn namespaces(
        &self,
        kind: EventLogNamespaceKind,
    ) -> Result<Vec<PlacedNamespace>, NookError> {
        GitHubRepository::namespaces(self, kind).await
    }

    fn placed(namespace: &PlacedNamespace) -> &PlacedNamespace {
        namespace
    }

    /// A vault, by how many event files it holds.
    async fn observation(
        &self,
        vault: ListedVault<PlacedNamespace>,
    ) -> Result<ProviderVaultObservation, NookError> {
        let event_count = self.store(&vault.namespace).event_ids().await?.len();
        Ok(CountedVaultNamespace {
            identity: vault.namespace.identity().clone(),
            store_id: vault.store_id,
            event_count,
        }
        .observation())
    }

    async fn events(&self, placed: &PlacedNamespace) -> Result<Vec<LocalEventWrite>, NookError> {
        self.store(placed).events().await
    }

    /// The identity's log, named by its path with no request.
    fn identity_log(
        &self,
        identity_id: &IdentityId,
    ) -> impl Future<Output = Result<PlacedNamespace, NookError>> {
        future::ready(Ok(PlacedNamespace::identity_log(identity_id.clone())))
    }

    async fn put_event(&self, write: NamespaceWrite<'_, PlacedNamespace>) -> Result<(), NookError> {
        self.store(write.namespace).put_checked(write.event).await
    }
}
