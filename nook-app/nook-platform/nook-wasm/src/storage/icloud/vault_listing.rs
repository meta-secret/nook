//! A `CloudKit` share as the provider vault listing reads it.
//!
//! `CloudKit` reports how many event records a namespace holds here, so each
//! vault is observed by its event count. An identity's log is named by its
//! namespace. Nothing is decrypted.

use std::future::{self, Future};

use nook_core::{
    EventLogNamespaceKind, ICloudSharedTarget, IdentityId, LocalEventWrite, PlacedNamespace,
    ProviderSecretText, ProviderVaultObservation,
};

use super::ICloudEventStore;
use crate::NookError;
use crate::storage::event_store::EventStore;
use crate::storage::provider_vault_listing::{
    CountedVaultNamespace, ListedVault, NamespaceWrite, ProviderLocation,
};

/// The namespaces in one `CloudKit` share.
#[derive(Clone, Copy)]
pub(crate) struct ICloudLocation<'a> {
    pub(crate) token: &'a ProviderSecretText,
    pub(crate) share: &'a ICloudSharedTarget,
}

impl ICloudLocation<'_> {
    /// The store of one namespace in the share.
    pub(crate) fn store<'b>(&'b self, placed: &'b PlacedNamespace) -> ICloudEventStore<'b> {
        ICloudEventStore {
            web_auth_token: self.token,
            target: self.share,
            placed,
        }
    }
}

impl ProviderLocation for ICloudLocation<'_> {
    type Namespace = PlacedNamespace;
    const PROVIDER: &'static str = "CloudKit";

    async fn namespaces(
        &self,
        kind: EventLogNamespaceKind,
    ) -> Result<Vec<PlacedNamespace>, NookError> {
        ICloudEventStore::list_icloud_namespaces(self.token, self.share, kind).await
    }

    fn placed(namespace: &PlacedNamespace) -> &PlacedNamespace {
        namespace
    }

    /// A vault, by how many event records it holds.
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

    /// The identity's log, named by its namespace with no request.
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
