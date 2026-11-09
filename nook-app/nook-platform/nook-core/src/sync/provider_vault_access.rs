//! Whether this device can open a vault a provider holds, decided without
//! decrypting it, and what the user may do with it.
//!
//! A provider's Nook root can hold vaults of several identities. The identity
//! in use syncs its own vaults. Any other vault opens only with keys this
//! browser already holds under another identity, or with a key a member
//! granted this device. A vault nothing here can open is shown as such: a
//! device that can open it must grant this one access.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::errors::VaultResult;
use crate::{
    IdentityDirectory, IdentitySelection, IdentitySession, IdentityVaultAppGrant,
    IdentityVaultAppGrantKind, ListingAppKey, ListingIdentity, ListingLocalIdentity,
    LocalEventStore, LocalEventWrite, LocalIdentityKeyring, LocalIdentityLog, StoreId,
    VaultMetaGraphProjection, VaultMetaState,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// A vault another identity on this browser holds keys for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BrowserIdentityVault {
    pub store_id: StoreId,
    /// The label of the identity that holds it.
    pub identity_label: String,
}

/// The identities on this browser and the app keys it holds for them.
pub struct BrowserVaultKeys<'a> {
    pub directory: &'a IdentityDirectory,
    pub keyring: &'a LocalIdentityKeyring,
}

impl BrowserVaultKeys<'_> {
    /// Vaults the identity in use holds. No identity in use holds none.
    #[must_use]
    pub fn identity_vaults(&self) -> Vec<StoreId> {
        let IdentitySelection::Selected(selected) = self.directory.selection() else {
            return Vec::new();
        };
        self.directory
            .identities()
            .iter()
            .filter(|identity| &identity.identity_id == selected)
            .flat_map(|identity| identity.vault_deks.iter())
            .map(|dek| dek.store_id.clone())
            .collect()
    }

    /// The identity in use and this browser's app key under it, which a
    /// listing relates every identity's log and every vault to: whether it
    /// holds the identity, asked to join it, or asked for a vault's access.
    /// `local_log` is the identity in use's own control log here; with it,
    /// or with vaults, the key can no longer take another identity's id.
    #[must_use]
    pub fn listing_identity(&self, local_log: LocalIdentityLog) -> ListingIdentity {
        let IdentitySelection::Selected(selected) = self.directory.selection() else {
            return ListingIdentity::NoIdentityInUse;
        };
        let Some(entry) = self
            .keyring
            .entries()
            .iter()
            .find(|entry| entry.identity_id() == selected)
        else {
            return ListingIdentity::NoIdentityInUse;
        };
        let fresh = self
            .directory
            .identities()
            .iter()
            .find(|identity| &identity.identity_id == selected)
            .is_some_and(|identity| identity.is_fresh_local_identity(local_log));
        ListingIdentity::InUse(ListingAppKey {
            app_id: entry.app_id().clone(),
            identity_id: selected.clone(),
            local: if fresh {
                ListingLocalIdentity::Fresh
            } else {
                ListingLocalIdentity::InUse
            },
        })
    }

    /// Vaults another identity on this browser holds, where that identity's
    /// app key here was granted the vault's keys.
    #[must_use]
    pub fn other_identity_vaults(&self) -> Vec<BrowserIdentityVault> {
        let selected = match self.directory.selection() {
            IdentitySelection::Selected(selected) => Some(selected),
            IdentitySelection::Empty => None,
        };
        let mut held = Vec::new();
        for entry in self.keyring.entries() {
            if Some(entry.identity_id()) == selected {
                continue;
            }
            let Some(identity) = self
                .directory
                .identities()
                .iter()
                .find(|identity| &identity.identity_id == entry.identity_id())
            else {
                continue;
            };
            for dek in &identity.vault_deks {
                let grant = IdentityVaultAppGrant {
                    identity,
                    store_id: &dek.store_id,
                    app_id: entry.app_id(),
                }
                .classify();
                if grant == IdentityVaultAppGrantKind::Granted
                    && !held
                        .iter()
                        .any(|vault: &BrowserIdentityVault| vault.store_id == dek.store_id)
                {
                    held.push(BrowserIdentityVault {
                        store_id: dek.store_id.clone(),
                        identity_label: identity.label.clone(),
                    });
                }
            }
        }
        held
    }
}

/// A listed vault's events, read from the provider without its keys.
pub struct ProviderVaultEvents<'a> {
    pub store_id: &'a StoreId,
    pub events: Vec<LocalEventWrite>,
}

/// Where this device stands with a vault it holds no identity keys for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderVaultStanding {
    /// This device never asked for access.
    Stranger,
    /// This device asked for access; no member has granted it yet.
    Requested,
    /// A member granted this device access with its app key.
    Granted,
}

/// What a vault's events tell without its keys.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProviderVaultInspection {
    pub standing: ProviderVaultStanding,
}

impl ProviderVaultEvents<'_> {
    /// Read whether this device's app key asked for or was granted access.
    /// Membership is readable without the vault keys.
    pub fn inspect(self, this_browser: &ListingIdentity) -> VaultResult<ProviderVaultInspection> {
        let store = self
            .events
            .into_iter()
            .fold(LocalEventStore::new(), LocalEventStore::put_event);
        let graph = store.load_graph(self.store_id.as_str())?;
        let mut meta = VaultMetaState::default();
        VaultMetaGraphProjection::new(&graph).materialize(&mut meta)?;
        let standing = match this_browser {
            ListingIdentity::InUse(key) if meta.enrolled_devices.contains_key(&key.app_id) => {
                ProviderVaultStanding::Granted
            }
            ListingIdentity::InUse(key) if meta.joins.contains_key(&key.app_id) => {
                ProviderVaultStanding::Requested
            }
            ListingIdentity::InUse(_) | ListingIdentity::NoIdentityInUse => {
                ProviderVaultStanding::Stranger
            }
        };
        Ok(ProviderVaultInspection { standing })
    }
}

/// What this device holds that opens a listed vault.
#[derive(Clone, Copy, Debug)]
pub struct ProviderVaultKeyholding<'a> {
    /// Vaults the identity in use holds.
    pub identity_vaults: &'a [StoreId],
    /// Vaults other identities on this browser hold.
    pub browser_vaults: &'a [BrowserIdentityVault],
    /// Vaults a member granted this device's app key.
    pub granted_vaults: &'a [StoreId],
    /// Vaults this device asked to be granted.
    pub requested_vaults: &'a [StoreId],
    /// Whether an identity is in use on this browser. Without one nothing
    /// here was checked: the user's passkey may still recover the identity
    /// that owns a vault.
    pub session: IdentitySession,
}

impl ProviderVaultKeyholding<'_> {
    /// No keys at all, as before any identity exists on this browser.
    pub const NONE: ProviderVaultKeyholding<'static> = ProviderVaultKeyholding {
        identity_vaults: &[],
        browser_vaults: &[],
        granted_vaults: &[],
        requested_vaults: &[],
        session: IdentitySession::NoIdentity,
    };

    /// The way this device can open one listed vault.
    #[must_use]
    pub fn access(&self, store_id: &StoreId) -> ProviderVaultAccess {
        if self.identity_vaults.contains(store_id) {
            return ProviderVaultAccess::Syncs;
        }
        if let Some(held) = self
            .browser_vaults
            .iter()
            .find(|held| &held.store_id == store_id)
        {
            return ProviderVaultAccess::OtherIdentityHere {
                identity_label: held.identity_label.clone(),
            };
        }
        if self.granted_vaults.contains(store_id) {
            return ProviderVaultAccess::Granted;
        }
        if self.session == IdentitySession::NoIdentity {
            return ProviderVaultAccess::Unchecked;
        }
        if self.requested_vaults.contains(store_id) {
            return ProviderVaultAccess::Requested;
        }
        ProviderVaultAccess::Locked
    }
}

/// How this device can open a listed vault.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ProviderVaultAccess {
    /// The identity in use holds it: it simply syncs.
    Syncs,
    /// Another identity on this browser holds it; it opens from there.
    #[serde(rename_all = "camelCase")]
    OtherIdentityHere { identity_label: String },
    /// A member granted this device access: its app key opens it.
    Granted,
    /// No identity is in use on this browser, so no key was checked; the
    /// user's passkey may still open it.
    Unchecked,
    /// This device asked for access and waits for a member to grant it.
    Requested,
    /// Nothing on this device opens it; a device that can must grant access.
    Locked,
}

impl ProviderVaultAccess {
    /// The order the listing shows vaults in: the ones that sync, then the
    /// ones this device can bring in, then the ones it cannot open.
    pub(crate) fn listing_rank(&self) -> u8 {
        match self {
            Self::Syncs => 0,
            Self::Granted => 1,
            Self::OtherIdentityHere { .. } => 2,
            Self::Unchecked => 3,
            Self::Requested => 4,
            Self::Locked => 5,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::slice;

    fn store(token: &str) -> anyhow::Result<StoreId> {
        Ok(StoreId::parse(token)?)
    }

    #[test]
    fn each_vault_opens_by_the_strongest_key_this_device_holds() -> anyhow::Result<()> {
        let own = store("store_ownvault001")?;
        let travel = store("store_travelvault")?;
        let stranger = store("store_strangervlt")?;
        let identity_vaults = [own.clone()];
        let browser_vaults = [BrowserIdentityVault {
            store_id: travel.clone(),
            identity_label: "Travel".to_owned(),
        }];
        let granted = store("store_grantedvlt1")?;
        let asked = store("store_askedvault1")?;
        let granted_vaults = [granted.clone()];
        let requested_vaults = [asked.clone()];
        let keys = ProviderVaultKeyholding {
            identity_vaults: &identity_vaults,
            browser_vaults: &browser_vaults,
            granted_vaults: &granted_vaults,
            requested_vaults: &requested_vaults,
            session: IdentitySession::IdentityInUse,
        };
        assert_eq!(keys.access(&granted), ProviderVaultAccess::Granted);
        assert_eq!(keys.access(&asked), ProviderVaultAccess::Requested);
        assert_eq!(keys.access(&own), ProviderVaultAccess::Syncs);
        assert_eq!(
            keys.access(&travel),
            ProviderVaultAccess::OtherIdentityHere {
                identity_label: "Travel".to_owned()
            }
        );
        assert_eq!(keys.access(&stranger), ProviderVaultAccess::Locked);
        // Without an identity in use nothing was checked, so recovery may
        // still open the vault with the user's passkey.
        assert_eq!(
            ProviderVaultKeyholding::NONE.access(&own),
            ProviderVaultAccess::Unchecked
        );
        Ok(())
    }

    /// Two identities on one browser, each with its own app key and vault.
    struct TwoIdentityBrowser {
        directory: IdentityDirectory,
        keyring: LocalIdentityKeyring,
        travel_identity: crate::IdentityId,
        personal_vault: StoreId,
        travel_vault: StoreId,
    }

    impl TwoIdentityBrowser {
        fn identity(
            directory: IdentityDirectory,
            label: &str,
            app_key: &crate::AppKey,
            store_id: &StoreId,
        ) -> anyhow::Result<(IdentityDirectory, crate::IdentityId)> {
            let created = directory
                .create_identity(crate::IdentityCreation {
                    label,
                    app_key,
                    member_label: crate::MemberLabelState::Unnamed,
                })
                .map_err(|rejected| anyhow::anyhow!("{:?}", rejected.cause))?;
            let directory = created
                .directory
                .open_or_generate_vault_dek(crate::IdentityVaultKeyOpening {
                    app_key,
                    store_id: store_id.clone(),
                })
                .map_err(|rejected| anyhow::anyhow!("{:?}", rejected.cause))?
                .directory;
            Ok((directory, created.identity_id))
        }

        fn entry(
            identity_id: crate::IdentityId,
            app_key: &crate::AppKey,
            seed: &str,
        ) -> anyhow::Result<crate::LocalIdentityKeyringEntry> {
            let wrapped = crate::DeviceIdentityProtection::new(&app_key.secret_string())
                .with_pin("correct horse battery staple")?;
            Ok(crate::LocalIdentityKeyringEntry::protected(
                identity_id,
                app_key,
                wrapped,
                seed,
            )?)
        }

        fn new() -> anyhow::Result<Self> {
            let personal_key = crate::AppKey::generate()?;
            let travel_key = crate::AppKey::generate()?;
            let personal_vault = store("store_personalvlt")?;
            let travel_vault = store("store_travelvault")?;
            let (directory, personal) = Self::identity(
                IdentityDirectory::empty(),
                "Personal",
                &personal_key,
                &personal_vault,
            )?;
            let (directory, travel) =
                Self::identity(directory, "Travel", &travel_key, &travel_vault)?;
            let directory = directory
                .select(&personal)
                .map_err(|rejected| anyhow::anyhow!("{:?}", rejected.cause))?;
            let keyring = LocalIdentityKeyring::from_entries(vec![
                Self::entry(personal, &personal_key, &"11".repeat(32))?,
                Self::entry(travel.clone(), &travel_key, &"22".repeat(32))?,
            ])?;
            Ok(Self {
                directory,
                keyring,
                travel_identity: travel,
                personal_vault,
                travel_vault,
            })
        }
    }

    #[test]
    fn the_browser_holds_its_identity_vaults_and_other_identities_ones() -> anyhow::Result<()> {
        let browser = TwoIdentityBrowser::new()?;
        let keys = BrowserVaultKeys {
            directory: &browser.directory,
            keyring: &browser.keyring,
        };
        assert_eq!(
            keys.identity_vaults(),
            slice::from_ref(&browser.personal_vault)
        );
        let ListingIdentity::InUse(key) = keys.listing_identity(LocalIdentityLog::Empty) else {
            anyhow::bail!("the selected identity has its app key here");
        };
        assert_eq!(
            Some(&key.app_id),
            browser
                .keyring
                .entries()
                .first()
                .map(crate::LocalIdentityKeyringEntry::app_id)
        );
        assert_eq!(
            keys.other_identity_vaults(),
            [BrowserIdentityVault {
                store_id: browser.travel_vault.clone(),
                identity_label: "Travel".to_owned(),
            }]
        );
        // An identity whose app key is not on this browser opens nothing here.
        let only_personal = LocalIdentityKeyring::from_entries(
            browser
                .keyring
                .entries()
                .iter()
                .filter(|entry| entry.identity_id() != &browser.travel_identity)
                .cloned()
                .collect(),
        )?;
        assert!(
            BrowserVaultKeys {
                directory: &browser.directory,
                keyring: &only_personal,
            }
            .other_identity_vaults()
            .is_empty()
        );
        Ok(())
    }

    /// An identity in use here whose key is `app_id`.
    fn in_use_with(app_id: &crate::AppId) -> anyhow::Result<ListingIdentity> {
        Ok(ListingIdentity::InUse(ListingAppKey {
            app_id: app_id.clone(),
            identity_id: crate::IdentityId::parse("idn_joinerjoine")?,
            local: ListingLocalIdentity::InUse,
        }))
    }

    #[test]
    fn a_join_request_then_its_approval_change_where_this_device_stands() -> anyhow::Result<()> {
        let owner = crate::SigningIdentity::generate()?.0;
        let joiner = crate::SigningIdentity::generate()?.0;
        let joiner_app = crate::DeviceIdentity::generate()?;
        let store_id = store("store_requestvlt1")?;
        let epoch = crate::EventId::from_sha256_hex(
            nook_auth2::Sha256Hex::from_trusted("1".repeat(64)).as_str(),
        )?;
        let at = crate::IsoTimestamp::parse("2026-07-22T00:00:00Z")?;
        let genesis = crate::VaultEvent::build_genesis_import_event(crate::GenesisImportRequest {
            store_id: &store_id,
            actor_id: &owner.actor_id()?,
            key_epoch: &epoch,
            payload: crate::GenesisImportPayload {
                source_content_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
                secrets: vec![],
            },
            created_at: &at,
            signing_key: owner.signing_key(),
        })?;
        let event = |signer: &crate::SigningIdentity,
                     parent: &crate::VaultEvent,
                     operation: crate::VaultOperation|
         -> anyhow::Result<crate::VaultEvent> {
            Ok(crate::VaultEvent::sign(
                crate::VaultEventBody {
                    schema_version: crate::VaultEventSchemaVersion::CURRENT,
                    store_id: store_id.clone(),
                    actor_id: signer.actor_id()?,
                    actor_signing_public_key: signer.public_key(),
                    parents: vec![parent.id()?],
                    created_at: at.clone(),
                    key_epoch: epoch.clone(),
                    operations: vec![operation],
                },
                signer.signing_key(),
            )?)
        };
        let requested = event(
            &joiner,
            &genesis,
            crate::VaultOperation::JoinRequested {
                device_id: joiner_app.device_id().clone(),
                encryption_public_key: joiner_app.public_key().clone(),
                signing_public_key: joiner.public_key(),
                label: crate::MemberLabel::from_trusted(String::new()),
            },
        )?;
        let sealed = crate::VaultCrypto::new(&crate::VaultKeys::generate()?.secrets_key)?;
        let approved = event(
            &owner,
            &requested,
            crate::VaultOperation::JoinApproved {
                device_id: joiner_app.device_id().clone(),
                encryption_public_key: joiner_app.public_key().clone(),
                signing_public_key: joiner.public_key(),
                label: crate::MemberLabel::from_trusted(String::new()),
                secrets_key_ciphertext: sealed.encrypt_value("secrets")?,
                members_key_ciphertext: sealed.encrypt_value("members")?,
            },
        )?;
        let standing = |events: &[&crate::VaultEvent],
                        this_browser: &ListingIdentity|
         -> anyhow::Result<ProviderVaultStanding> {
            let writes = events
                .iter()
                .map(|event| {
                    Ok(LocalEventWrite {
                        event_id: event.id()?,
                        bytes: crate::VaultEvent::serialize_event_storage_yaml(event)?,
                    })
                })
                .collect::<anyhow::Result<Vec<_>>>()?;
            Ok(ProviderVaultEvents {
                store_id: &store_id,
                events: writes,
            }
            .inspect(this_browser)?
            .standing)
        };
        let app_id = &in_use_with(joiner_app.device_id())?;
        let nobody = &ListingIdentity::NoIdentityInUse;
        assert_eq!(
            standing(&[&genesis], app_id)?,
            ProviderVaultStanding::Stranger
        );
        assert_eq!(
            standing(&[&genesis, &requested], app_id)?,
            ProviderVaultStanding::Requested
        );
        assert_eq!(
            standing(&[&genesis, &requested, &approved], app_id)?,
            ProviderVaultStanding::Granted
        );
        // Without an app key on this browser, nothing is requested or granted.
        assert_eq!(
            standing(&[&genesis, &requested, &approved], nobody)?,
            ProviderVaultStanding::Stranger
        );
        Ok(())
    }

    #[test]
    fn access_crosses_the_web_boundary_as_a_tagged_value() -> anyhow::Result<()> {
        assert_eq!(
            serde_json::to_value(ProviderVaultAccess::OtherIdentityHere {
                identity_label: "Travel".to_owned()
            })?,
            serde_json::json!({ "state": "otherIdentityHere", "identityLabel": "Travel" })
        );
        assert_eq!(
            serde_json::to_value(ProviderVaultAccess::Locked)?,
            serde_json::json!({ "state": "locked" })
        );
        Ok(())
    }
}
