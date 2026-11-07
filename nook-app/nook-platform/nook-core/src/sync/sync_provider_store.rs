//! Persisted sync-provider facade plus the pure transforms the web app runs
//! over it (drafts, saving, local-row seeding, dedup).
//!
//! The browser stores an [`AuthProvidersSnapshot`] in the `nook_auth`
//! `IndexedDB` database. All shaping of that data lives here so it is
//! unit-tested in Rust; `nook-wasm` owns the `IndexedDB` I/O and device-key
//! sealing, and the web layer keeps only thin call adapters plus i18n
//! presentation.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::{ProviderKind, ProviderSecretText};

mod active_credentials;
mod catalog;
mod draft;
mod enrollment;
mod enrollment_projection;
mod identity_mounts;
mod keyring_providers;
mod persistence;
mod provider;
mod save;
mod scope;
mod selection;
mod shared_grant;
mod sign_in;
mod state;
mod storage_args;
mod sync_metadata;
mod wire;

pub use active_credentials::{ActiveProviderCredentialsRequest, ActiveProviderLoginSetup};
pub use catalog::{
    DuplicateCandidatePolicy, DuplicateProviderSelection, LocalProviderRowChange,
    LocalProviderRowOutcome, LocalProviderRowRequest,
};
pub use draft::{
    GithubDraft, GithubDraftForm, GithubDraftToken, GoogleDriveAccess, GoogleDriveDraft,
    GoogleDriveFolder, GoogleDriveFolderBinding, GoogleDriveSignIn, GoogleDriveSignInRequest,
    ICloudAccess, ICloudDraft, ICloudShare, ICloudShareBinding, ICloudSignIn, ICloudSignInRequest,
    LocalFolderDraft, OAuthFileDraft, ProviderCredentialReadiness, ProviderDraft, ProviderDraftGap,
    ProviderDraftMismatch, S3Draft,
};
pub use enrollment::{
    EnrollmentAudience, EnrollmentCredentialChoice, ProviderEnrollmentRequest,
    SharedEnrollmentAudience, SharedGrantProviderSelection,
};
pub use identity_mounts::{
    DeviceJoinReach, IdentityMountCapability, IdentityVaultReach, ProviderReplicationTarget,
    ProviderRowLookup, ProviderVaultPlacement,
};
pub use keyring_providers::AppProviderShare;
pub use persistence::*;
pub use provider::{
    GithubProvider, GoogleDriveAuthorization, GoogleDriveAuthorizationCheck,
    GoogleDriveAuthorizationFreshness, GoogleDriveProvider, ICloudProvider, LocalFolderHandleId,
    LocalFolderName, LocalFolderProvider, OAuthFileProvider, S3SpareKeyAddition, S3SpareKeyRemoval,
    S3SpareKeyRequest, StoredProvider,
};
pub use save::{
    DuplicateProviderHandling, ProviderSaveOutcome, ProviderSaveRequest, ProviderSaveSetup,
};
pub use scope::{
    ActiveVaultProviderRows, LocalProviderSelection, ProviderEventFlushTarget, ProviderRows,
    RemoteEventFlushProviderRequest,
};
pub use selection::{
    ProviderId, ProviderSelection, ProviderSelectionPolicy, ProviderSelectionRequest,
};
pub use shared_grant::*;
pub use sign_in::ProviderSignInUpdate;
pub use state::*;
pub use storage_args::{
    DraftStorageConnection, ProviderLabelLabels, ProviderStorageDetailLabels,
    StagedStorageConnection, StorageConnection,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum DuplicateSyncProvider {
    Unique,
    Duplicate { provider: Box<StorageProvider> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ProviderSyncCheckpoint {
    NeverSynced,
    Synced {
        version: ProviderSyncedVaultVersion,
        synced_at: String,
        revision: ProviderSyncRevision,
        common_content_hash: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "version", rename_all = "camelCase")]
pub enum ProviderSyncedVaultVersion {
    Unknown,
    Version(crate::ProviderSyncedVaultVersionValue),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "revision", rename_all = "camelCase")]
pub enum ProviderSyncRevision {
    Unknown,
    Revision(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderSyncRevisionRef<'a> {
    Unreported,
    Revision(&'a str),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ManagerStoreScopeRef<'a> {
    Unscoped,
    Store(&'a str),
}

/// One persisted sync provider row: what every provider has, and the provider
/// with exactly its own settings and credentials.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StorageProvider {
    pub id: String,
    pub label: String,
    pub store_id: ProviderVaultScope,
    pub sync_checkpoint: ProviderSyncCheckpoint,
    pub created_at: String,
    pub provider: StoredProvider,
}

/// The full persisted snapshot: provider rows plus the active vault scope.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthProvidersSnapshot {
    pub providers: Vec<StorageProvider>,
    pub active_vault_store_id: ActiveVaultScope,
}

impl StorageProvider {
    /// A new row of `provider` that has never synced, labeled as its provider
    /// labels itself.
    #[must_use]
    pub fn never_synced(
        id: String,
        store_id: ProviderVaultScope,
        created_at: String,
        provider: StoredProvider,
    ) -> Self {
        Self {
            id,
            label: provider.label(),
            store_id,
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at,
            provider,
        }
    }

    #[must_use]
    pub const fn kind(&self) -> ProviderKind {
        self.provider.kind()
    }

    /// The same row with each credential replaced by what `transition` makes
    /// of it.
    pub fn transition_secrets<E>(
        &self,
        transition: impl FnMut(&ProviderSecretText) -> Result<ProviderSecretText, E>,
    ) -> Result<Self, E> {
        Ok(Self {
            id: self.id.clone(),
            label: self.label.clone(),
            store_id: self.store_id.clone(),
            sync_checkpoint: self.sync_checkpoint.clone(),
            created_at: self.created_at.clone(),
            provider: self.provider.transition_secrets(transition)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{AuthProvidersSnapshot, StorageProvider, StoredProvider};
    use crate::{ActiveVaultScope, ProviderKind, ProviderVaultScope};
    use serde_json::json;
    use tsify::Tsify;

    impl StorageProvider {
        pub(crate) fn fixture(id: &str, provider: StoredProvider) -> Self {
            Self::never_synced(
                id.to_owned(),
                ProviderVaultScope::Unscoped,
                "2026-06-24T00:00:00.000Z".to_owned(),
                provider,
            )
        }
    }

    #[test]
    fn a_row_reads_back_only_in_its_tagged_shape() -> anyhow::Result<()> {
        for provider in StoredProvider::every_fixture()? {
            let row = StorageProvider::fixture("row", provider);
            let wire = serde_json::to_value(&row)?;
            assert_eq!(
                serde_json::from_value::<StorageProvider>(wire.clone())?,
                row
            );
            // Every common field is required, the checkpoint included.
            for field in [
                "id",
                "label",
                "storeId",
                "syncCheckpoint",
                "createdAt",
                "provider",
            ] {
                let mut missing = wire.clone();
                if let Some(fields) = missing.as_object_mut() {
                    fields.remove(field);
                }
                assert!(
                    serde_json::from_value::<StorageProvider>(missing).is_err(),
                    "{field}"
                );
            }
            for retired in ["type", "githubPat", "oauthFile", "localFolder", "s3"] {
                let mut extra = wire.clone();
                if let Some(fields) = extra.as_object_mut() {
                    fields.insert(retired.to_owned(), json!({ "state": "notApplicable" }));
                }
                assert!(
                    serde_json::from_value::<StorageProvider>(extra).is_err(),
                    "{retired}"
                );
            }
        }
        let github = StorageProvider::fixture("gh", StoredProvider::github_fixture()?);
        assert_eq!(
            serde_json::to_value(&github)?,
            json!({
                "id": "gh",
                "label": "GitHub · team-vault",
                "storeId": { "state": "unscoped" },
                "syncCheckpoint": { "state": "neverSynced" },
                "createdAt": "2026-06-24T00:00:00.000Z",
                "provider": {
                    "type": "github",
                    "repository": { "state": "repository", "value": "team-vault" },
                    "token": "github_pat_11TESTONLYNOTREAL",
                },
            })
        );
        assert_eq!(github.kind(), ProviderKind::Github);
        Ok(())
    }

    #[test]
    fn the_snapshot_holds_rows_and_the_active_vault() -> anyhow::Result<()> {
        let snapshot = AuthProvidersSnapshot {
            providers: vec![StorageProvider::fixture("local", StoredProvider::Local {})],
            active_vault_store_id: ActiveVaultScope::StoreId("store-a".to_owned()),
        };
        let wire = serde_json::to_value(&snapshot)?;
        assert_eq!(
            serde_json::from_value::<AuthProvidersSnapshot>(wire)?,
            snapshot
        );
        assert_eq!(
            AuthProvidersSnapshot::default(),
            AuthProvidersSnapshot {
                providers: Vec::new(),
                active_vault_store_id: ActiveVaultScope::Unselected,
            }
        );
        assert!(StorageProvider::DECL.contains("provider: StoredProvider"));
        Ok(())
    }
}
