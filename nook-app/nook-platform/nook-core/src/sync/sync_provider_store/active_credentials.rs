#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! The draft the active provider gives the browser.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::{LocalVaultPresence, ProviderDraft, ProviderKind, StorageProvider};

/// The provider setup the login screen runs, if one runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "providerKind", rename_all = "camelCase")]
pub enum ActiveProviderLoginSetup {
    Inactive,
    Active(ProviderKind),
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActiveProviderCredentialsRequest {
    pub local_vault: LocalVaultPresence,
    pub login_setup: ActiveProviderLoginSetup,
    pub sync_providers: Vec<StorageProvider>,
    pub current: ProviderDraft,
}

impl ActiveProviderCredentialsRequest {
    /// The draft the active provider gives the browser: this browser's store
    /// when its vault is here; the setup's draft while one runs (the current
    /// one when it is that provider, a new one otherwise); else the first sync
    /// provider's; else the current draft.
    #[must_use]
    pub fn project(self) -> ProviderDraft {
        match (self.local_vault, self.login_setup) {
            (LocalVaultPresence::Present, _) => ProviderDraft::Local {},
            (LocalVaultPresence::Absent, ActiveProviderLoginSetup::Active(kind)) => {
                if self.current.kind() == kind {
                    self.current
                } else {
                    ProviderDraft::begin(kind)
                }
            }
            (LocalVaultPresence::Absent, ActiveProviderLoginSetup::Inactive) => {
                match self.sync_providers.into_iter().next() {
                    Some(row) => ProviderDraft::from(row.provider),
                    None => self.current,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ActiveProviderCredentialsRequest, ActiveProviderLoginSetup};
    use crate::{
        LocalVaultPresence, OAuthFilePreset, ProviderDraft, ProviderKind, StorageProvider,
        StoredProvider,
    };
    use serde_json::json;

    impl ActiveProviderCredentialsRequest {
        fn fixture(current: ProviderDraft) -> Self {
            Self {
                local_vault: LocalVaultPresence::Absent,
                login_setup: ActiveProviderLoginSetup::Inactive,
                sync_providers: Vec::new(),
                current,
            }
        }
    }

    #[test]
    fn this_browsers_vault_projects_the_local_draft() -> anyhow::Result<()> {
        let mut request = ActiveProviderCredentialsRequest::fixture(ProviderDraft::from(
            StoredProvider::github_fixture()?,
        ));
        request.local_vault = LocalVaultPresence::Present;
        request.login_setup = ActiveProviderLoginSetup::Active(ProviderKind::S3);
        assert_eq!(request.project(), ProviderDraft::Local {});
        Ok(())
    }

    #[test]
    fn a_running_setup_keeps_its_own_draft_and_begins_another_kind() -> anyhow::Result<()> {
        let github = ProviderDraft::from(StoredProvider::github_fixture()?);
        let mut same = ActiveProviderCredentialsRequest::fixture(github.clone());
        same.login_setup = ActiveProviderLoginSetup::Active(ProviderKind::Github);
        assert_eq!(same.project(), github);
        let icloud = ProviderKind::OauthFile(OAuthFilePreset::ICloud);
        let mut other = ActiveProviderCredentialsRequest::fixture(github);
        other.login_setup = ActiveProviderLoginSetup::Active(icloud);
        assert_eq!(other.project(), ProviderDraft::begin(icloud));
        Ok(())
    }

    #[test]
    fn the_first_sync_provider_becomes_the_draft_and_none_keeps_the_current() -> anyhow::Result<()>
    {
        let current = ProviderDraft::begin(ProviderKind::Github);
        let mut request = ActiveProviderCredentialsRequest::fixture(current.clone());
        request.sync_providers = vec![
            StorageProvider::fixture("s3", StoredProvider::s3_fixture()?),
            StorageProvider::fixture("drive", StoredProvider::google_drive_fixture()?),
        ];
        assert_eq!(
            request.project(),
            ProviderDraft::from(StoredProvider::s3_fixture()?)
        );
        assert_eq!(
            ActiveProviderCredentialsRequest::fixture(current.clone()).project(),
            current
        );
        Ok(())
    }

    #[test]
    fn the_request_reads_named_states_only() -> anyhow::Result<()> {
        let request: ActiveProviderCredentialsRequest = serde_json::from_value(json!({
            "localVault": LocalVaultPresence::Absent as u32,
            "loginSetup": {
                "state": "active",
                "providerKind": { "type": "oauth-file", "preset": "google-drive" },
            },
            "syncProviders": [],
            "current": { "type": "local" },
        }))?;
        assert_eq!(
            request.project(),
            ProviderDraft::begin(ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive))
        );
        assert!(
            serde_json::from_value::<ActiveProviderCredentialsRequest>(json!({
                "localVaultPresent": true,
                "loginSetup": { "state": "inactive" },
                "syncProviders": [],
                "current": { "type": "local" },
            }))
            .is_err()
        );
        Ok(())
    }
}
