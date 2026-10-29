//! The keyring's sync providers as one of its apps hands them to the others.
//!
//! Each app keeps provider credentials sealed to its own key. The web app
//! seals the keyring's remote providers to each other member app's key, so
//! the browser extension syncs through them without setting any up itself.
//! Browser-local rows stay with the installation that has them.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_auth2::AppId;
use nook_event_log::IdentityControlState;

use super::{ActiveVaultScope, AuthProvidersSnapshotData, StorageProviderData};
use crate::{ProviderCredentialRejection, StorageProviderType};

/// The keyring's remote providers, sealed to one other app of the keyring.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppProviderShare {
    pub app_id: AppId,
    pub providers: Vec<StorageProviderData>,
}

impl StorageProviderData {
    /// Whether this is a browser-local cache row of the installation holding it.
    fn is_browser_local(&self) -> bool {
        matches!(self.provider_type, StorageProviderType::Local)
    }
}

impl AuthProvidersSnapshotData {
    /// The keyring's remote providers sealed to each member app but `own`,
    /// with the member's key from the keyring's log.
    pub fn shares_for_keyring_apps(
        &self,
        state: &IdentityControlState,
        own: &AppId,
    ) -> Result<Vec<AppProviderShare>, ProviderCredentialRejection> {
        let remote = Self {
            providers: self
                .providers
                .iter()
                .filter(|provider| !provider.is_browser_local())
                .cloned()
                .collect(),
            active_vault_store_id: ActiveVaultScope::Unselected,
        };
        state
            .members
            .iter()
            .filter(|member| &member.keys.app_id != own)
            .map(|member| {
                let sealed = remote
                    .clone()
                    .seal_credentials_for(&member.keys.encryption_public_key)?;
                Ok(AppProviderShare {
                    app_id: member.keys.app_id.clone(),
                    providers: sealed.providers,
                })
            })
            .collect()
    }

    /// Take the keyring's remote providers another of its apps handed over.
    /// They replace this app's remote rows, so a provider removed there is
    /// gone here too. This installation's browser-local rows stay, and
    /// handed-over ones, another installation's, are not taken.
    #[must_use]
    pub fn replace_keyring_providers(&self, incoming: &[StorageProviderData]) -> Self {
        let mut providers: Vec<StorageProviderData> = self
            .providers
            .iter()
            .filter(|provider| provider.is_browser_local())
            .cloned()
            .collect();
        providers.extend(
            incoming
                .iter()
                .filter(|provider| !provider.is_browser_local())
                .cloned(),
        );
        Self {
            providers,
            active_vault_store_id: self.active_vault_store_id.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        DeviceIdentity, EventId, IdentityControlMember, IdentityId, IdentityMemberKeys,
        MemberLabel, ProviderSyncCheckpoint, ProviderVaultScope, SigningIdentity,
        StorageProviderType, StoredGithubPat, StoredGithubRepository,
        StoredLocalFolderConfiguration, StoredOAuthFileConfiguration,
    };

    fn row(id: &str, provider_type: StorageProviderType, pat: &str) -> StorageProviderData {
        StorageProviderData {
            id: id.to_owned(),
            provider_type,
            label: id.to_owned(),
            github_pat: StoredGithubPat::Token(pat.to_owned()),
            github_repo: StoredGithubRepository::Repository("owner/nook".to_owned()),
            oauth_file: StoredOAuthFileConfiguration::NotApplicable,
            local_folder: StoredLocalFolderConfiguration::NotApplicable,
            store_id: ProviderVaultScope::Unscoped,
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: "2026-10-29T00:00:00Z".to_owned(),
        }
    }

    fn snapshot(providers: Vec<StorageProviderData>) -> AuthProvidersSnapshotData {
        AuthProvidersSnapshotData {
            providers,
            active_vault_store_id: ActiveVaultScope::Unselected,
        }
    }

    fn ids(providers: &[StorageProviderData]) -> Vec<&str> {
        providers
            .iter()
            .map(|provider| provider.id.as_str())
            .collect()
    }

    /// A keyring whose log lists these apps as members.
    fn keyring(apps: &[&DeviceIdentity]) -> anyhow::Result<IdentityControlState> {
        let members = apps
            .iter()
            .map(|app| {
                Ok(IdentityControlMember {
                    keys: IdentityMemberKeys {
                        app_id: app.app_id().clone(),
                        encryption_public_key: app.public_key(),
                        signing_public_key: SigningIdentity::generate()?.0.public_key(),
                        label: MemberLabel::from_trusted("app".to_owned()),
                    },
                    approved_in: EventId::parse(&format!("sha256u:{}A", "a".repeat(42)))?,
                })
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
        Ok(IdentityControlState {
            identity_id: IdentityId::generate()?,
            members,
            revoked: Vec::new(),
            pending_joins: Vec::new(),
            denied_joins: Vec::new(),
            vaults: Vec::new(),
            removed_vaults: Vec::new(),
            mounts: Vec::new(),
            sealed_name: Vec::new(),
            heads: Vec::new(),
        })
    }

    #[test]
    fn each_other_app_gets_the_remote_providers_sealed_to_its_own_key() -> anyhow::Result<()> {
        let web = DeviceIdentity::generate()?;
        let extension = DeviceIdentity::generate()?;
        let phone = DeviceIdentity::generate()?;
        let state = keyring(&[&web, &extension, &phone])?;
        let providers = snapshot(vec![
            row("local", StorageProviderType::Local, ""),
            row(
                "github",
                StorageProviderType::Github,
                "github_pat_11KEYRING",
            ),
        ]);

        let shares = providers
            .shares_for_keyring_apps(&state, web.app_id())
            .map_err(ProviderCredentialRejection::into_cause)?;

        let recipients: Vec<&AppId> = shares.iter().map(|share| &share.app_id).collect();
        assert_eq!(recipients, vec![extension.app_id(), phone.app_id()]);
        for (share, app) in shares.iter().zip([&extension, &phone]) {
            assert_eq!(ids(&share.providers), vec!["github"]);
            assert!(!share.providers.iter().any(|provider| provider.github_pat
                == StoredGithubPat::Token("github_pat_11KEYRING".to_owned())));
            let opened = snapshot(share.providers.clone())
                .open_credentials(app)
                .map_err(ProviderCredentialRejection::into_cause)?;
            assert_eq!(
                opened
                    .providers
                    .first()
                    .map(|provider| &provider.github_pat),
                Some(&StoredGithubPat::Token("github_pat_11KEYRING".to_owned()))
            );
        }
        // Another app's copy does not open with this key.
        let phone_copy = shares
            .get(1)
            .ok_or_else(|| anyhow::anyhow!("the phone's copy must exist"))?;
        assert!(
            snapshot(phone_copy.providers.clone())
                .open_credentials(&extension)
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn a_keyring_with_no_other_app_shares_nothing() -> anyhow::Result<()> {
        let web = DeviceIdentity::generate()?;
        let state = keyring(&[&web])?;
        let providers = snapshot(vec![row("github", StorageProviderType::Github, "pat")]);

        let shares = providers
            .shares_for_keyring_apps(&state, web.app_id())
            .map_err(ProviderCredentialRejection::into_cause)?;

        assert!(shares.is_empty());
        Ok(())
    }

    #[test]
    fn handed_over_providers_replace_the_remote_ones_and_keep_local_rows() {
        let held = snapshot(vec![
            row("local", StorageProviderType::Local, ""),
            row("github", StorageProviderType::Github, "old"),
            row("removed", StorageProviderType::OauthFile, "gone"),
        ]);
        let incoming = vec![
            row("other-browser", StorageProviderType::Local, ""),
            row("github", StorageProviderType::Github, "new"),
            row("drive", StorageProviderType::OauthFile, "added"),
        ];

        let taken = held.replace_keyring_providers(&incoming);

        assert_eq!(ids(&taken.providers), vec!["local", "github", "drive"]);
        assert_eq!(
            taken.providers.get(1).map(|provider| &provider.github_pat),
            Some(&StoredGithubPat::Token("new".to_owned()))
        );
        assert_eq!(taken.active_vault_store_id, held.active_vault_store_id);
    }

    #[test]
    fn an_empty_hand_over_removes_every_remote_provider() {
        let held = snapshot(vec![
            row("local", StorageProviderType::Local, ""),
            row("github", StorageProviderType::Github, "old"),
        ]);

        let taken = held.replace_keyring_providers(&[]);

        assert_eq!(ids(&taken.providers), vec!["local"]);
    }
}
