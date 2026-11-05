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

use crate::{
    ActiveVaultScope, AuthProvidersSnapshot, ProviderCredentialRejection, StorageProvider,
    StoredProvider,
};

/// The keyring's remote providers, sealed to one other app of the keyring.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppProviderShare {
    pub app_id: AppId,
    pub providers: Vec<StorageProvider>,
}

impl AuthProvidersSnapshot {
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
                .filter(|provider| !matches!(provider.provider, StoredProvider::Local {}))
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
    pub fn replace_keyring_providers(&self, incoming: &[StorageProvider]) -> Self {
        let mut providers: Vec<StorageProvider> = self
            .providers
            .iter()
            .filter(|provider| matches!(provider.provider, StoredProvider::Local {}))
            .cloned()
            .collect();
        providers.extend(
            incoming
                .iter()
                .filter(|provider| !matches!(provider.provider, StoredProvider::Local {}))
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
        DeviceIdentity, EventId, GithubProvider, IdentityControlMember, IdentityId,
        IdentityMemberApprover, IdentityMemberKeys, IdentityMemberKind, MemberDevice, MemberLabel,
        SigningIdentity,
    };
    use std::slice;

    fn row(id: &str, provider: StoredProvider) -> StorageProvider {
        StorageProvider {
            label: id.to_owned(),
            ..StorageProvider::fixture(id, provider)
        }
    }

    fn github(id: &str, token: &str) -> anyhow::Result<StorageProvider> {
        Ok(row(
            id,
            StoredProvider::Github(GithubProvider::fixture("nook", token)?),
        ))
    }

    fn local(id: &str) -> StorageProvider {
        row(id, StoredProvider::Local {})
    }

    fn snapshot(providers: Vec<StorageProvider>) -> AuthProvidersSnapshot {
        AuthProvidersSnapshot {
            providers,
            active_vault_store_id: ActiveVaultScope::Unselected,
        }
    }

    fn ids(providers: &[StorageProvider]) -> Vec<&str> {
        providers
            .iter()
            .map(|provider| provider.id.as_str())
            .collect()
    }

    /// The texts of every credential the rows hold.
    fn secrets(providers: &[StorageProvider]) -> Vec<String> {
        providers
            .iter()
            .flat_map(|provider| provider.provider.secrets())
            .map(|secret| secret.expose().to_owned())
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
                    kind: IdentityMemberKind::App {
                        device: MemberDevice::Own,
                    },
                    approved_by: IdentityMemberApprover::Founder,
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
            local("local"),
            github("github", "github_pat_11KEYRING")?,
        ]);

        let shares = providers
            .shares_for_keyring_apps(&state, web.app_id())
            .map_err(ProviderCredentialRejection::into_cause)?;

        let recipients: Vec<&AppId> = shares.iter().map(|share| &share.app_id).collect();
        assert_eq!(recipients, vec![extension.app_id(), phone.app_id()]);
        for (share, app) in shares.iter().zip([&extension, &phone]) {
            assert_eq!(ids(&share.providers), vec!["github"]);
            assert_ne!(secrets(&share.providers), vec!["github_pat_11KEYRING"]);
            let opened = snapshot(share.providers.clone())
                .open_credentials(app)
                .map_err(ProviderCredentialRejection::into_cause)?;
            assert_eq!(secrets(&opened.providers), vec!["github_pat_11KEYRING"]);
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
    fn an_s3_row_reaches_the_other_app_with_its_secret_sealed_to_that_app() -> anyhow::Result<()> {
        let web = DeviceIdentity::generate()?;
        let extension = DeviceIdentity::generate()?;
        let state = keyring(&[&web, &extension])?;
        let s3 = row("s3", StoredProvider::s3_fixture()?);
        let providers = snapshot(vec![local("local"), s3.clone()]);

        let shares = providers
            .shares_for_keyring_apps(&state, web.app_id())
            .map_err(ProviderCredentialRejection::into_cause)?;

        let [share] = shares.as_slice() else {
            anyhow::bail!("the extension gets exactly one share");
        };
        assert_eq!(ids(&share.providers), vec!["s3"]);
        assert_ne!(share.providers, vec![s3.clone()]);
        let opened = snapshot(share.providers.clone())
            .open_credentials(&extension)
            .map_err(ProviderCredentialRejection::into_cause)?;
        assert_eq!(opened.providers, vec![s3]);
        Ok(())
    }

    #[test]
    fn a_keyring_with_no_other_app_shares_nothing() -> anyhow::Result<()> {
        let web = DeviceIdentity::generate()?;
        let state = keyring(&[&web])?;
        let providers = snapshot(vec![github("github", "pat")?]);

        let shares = providers
            .shares_for_keyring_apps(&state, web.app_id())
            .map_err(ProviderCredentialRejection::into_cause)?;

        assert!(shares.is_empty());
        Ok(())
    }

    #[test]
    fn handed_over_providers_replace_the_remote_ones_and_keep_local_rows() -> anyhow::Result<()> {
        let held = snapshot(vec![
            local("local"),
            github("github", "old")?,
            row("removed", StoredProvider::google_drive_fixture()?),
        ]);
        let incoming = vec![
            local("other-browser"),
            github("github", "new")?,
            row("drive", StoredProvider::google_drive_fixture()?),
        ];

        let taken = held.replace_keyring_providers(&incoming);

        assert_eq!(ids(&taken.providers), vec!["local", "github", "drive"]);
        assert_eq!(
            taken
                .providers
                .get(1)
                .map(|provider| secrets(slice::from_ref(provider))),
            Some(vec!["new".to_owned()])
        );
        assert_eq!(taken.active_vault_store_id, held.active_vault_store_id);
        Ok(())
    }

    #[test]
    fn an_empty_hand_over_removes_every_remote_provider() -> anyhow::Result<()> {
        let held = snapshot(vec![local("local"), github("github", "old")?]);

        let taken = held.replace_keyring_providers(&[]);

        assert_eq!(ids(&taken.providers), vec!["local"]);
        Ok(())
    }
}
