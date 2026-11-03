//! A local folder as the provider vault listing reads it.
//!
//! A folder reports how many event files a namespace holds, so each vault is
//! observed by its event count. An identity's log is named by its path; a
//! log the folder does not hold reads as empty. Nothing is decrypted.

use std::future::{self, Future};

use nook_core::{
    EventId, EventLogNamespaceKind, IdentityId, LocalEventWrite, PlacedNamespace,
    ProviderVaultObservation,
};

use super::{LocalFolderEventWrite, OpenedLocalFolder};
use crate::NookError;
use crate::storage::provider_vault_listing::{
    CountedVaultNamespace, ListedVault, NamespaceWrite, ProviderLocation,
};

/// The namespaces in one local folder the user picked.
pub(crate) struct LocalFolderLocation {
    pub(crate) folder: OpenedLocalFolder,
}

impl ProviderLocation for LocalFolderLocation {
    type Namespace = PlacedNamespace;
    const PROVIDER: &'static str = "Folder";

    async fn namespaces(
        &self,
        kind: EventLogNamespaceKind,
    ) -> Result<Vec<PlacedNamespace>, NookError> {
        self.folder.list_namespaces(kind).await
    }

    fn placed(namespace: &PlacedNamespace) -> &PlacedNamespace {
        namespace
    }

    /// A vault, by how many event files it holds.
    async fn observation(
        &self,
        vault: ListedVault<PlacedNamespace>,
    ) -> Result<ProviderVaultObservation, NookError> {
        let event_count = self.folder.count_events(&vault.namespace).await?;
        Ok(CountedVaultNamespace {
            identity: vault.namespace.identity().clone(),
            store_id: vault.store_id,
            event_count,
        }
        .observation())
    }

    async fn events(&self, placed: &PlacedNamespace) -> Result<Vec<LocalEventWrite>, NookError> {
        self.folder
            .read_events(placed)
            .await?
            .into_iter()
            .map(|file| {
                Ok(LocalEventWrite {
                    event_id: EventId::parse(&file.event_id)?,
                    bytes: file.content.into_bytes().into(),
                })
            })
            .collect()
    }

    /// The identity's log, named by its path with no request.
    fn identity_log(
        &self,
        identity_id: &IdentityId,
    ) -> impl Future<Output = Result<PlacedNamespace, NookError>> {
        future::ready(Ok(PlacedNamespace::identity_log(identity_id.clone())))
    }

    async fn put_event(&self, write: NamespaceWrite<'_, PlacedNamespace>) -> Result<(), NookError> {
        let content = String::from_utf8(write.event.bytes().to_vec())
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        self.folder
            .write_events(
                write.namespace,
                &[LocalFolderEventWrite {
                    event_id: write.event.event_id().as_str().to_owned(),
                    content,
                }],
            )
            .await
    }
}
