//! Remote namespaces for immutable event logs inside one provider target.
//!
//! Every provider holds one root, `meta-secret-nook`, with a folder per
//! identity. An identity's folder holds its control log in `log` and each
//! vault it filed in a folder named by the vault's store id:
//!
//! ```text
//! meta-secret-nook/<identity id>/log/events/<event>.yaml
//! meta-secret-nook/<identity id>/<store id>/events/<event>.yaml
//! ```
//!
//! A vault is filed once, under the identity that first wrote it there, and
//! stays in that folder: an identity that later shares the vault reads it
//! where it is. Path providers use these paths as they are, Drive mirrors them
//! as nested folders, and `CloudKit`, which has no folders, carries the same
//! two ids in each record's namespace tag.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_auth2::{IdentityId, StoreId};

use crate::{EventError, EventId, EventResult};

/// The root every provider target keeps its identities and vaults under.
pub const PROVIDER_ROOT_DIR: &str = "meta-secret-nook";
/// The folder that holds an identity's control log inside its identity folder.
pub const IDENTITY_LOG_DIR: &str = "log";
/// The folder that holds a namespace's event files.
const EVENTS_DIR: &str = "events";
const VAULT_TAG_PREFIX: &str = "vault:";
const IDENTITY_TAG_PREFIX: &str = "identity:";

/// Which event log a sync reads or writes: one vault's, or one identity's
/// control log. Where it sits at a provider is its [`PlacedNamespace`].
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum EventLogLocation {
    Vault(StoreId),
    Identity(IdentityId),
}

/// The two kinds of namespace a provider target holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventLogNamespaceKind {
    Vault,
    Identity,
}

impl EventLogLocation {
    #[must_use]
    pub fn kind(&self) -> EventLogNamespaceKind {
        match self {
            Self::Vault(_) => EventLogNamespaceKind::Vault,
            Self::Identity(_) => EventLogNamespaceKind::Identity,
        }
    }
}

/// One namespace filed under the identity folder that holds it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PlacedNamespace {
    identity: IdentityId,
    location: EventLogLocation,
}

impl PlacedNamespace {
    /// An identity's control log, always in its own folder.
    #[must_use]
    pub fn identity_log(identity: IdentityId) -> Self {
        Self {
            location: EventLogLocation::Identity(identity.clone()),
            identity,
        }
    }

    /// A vault filed under `identity`.
    #[must_use]
    pub fn vault(identity: IdentityId, store_id: StoreId) -> Self {
        Self {
            identity,
            location: EventLogLocation::Vault(store_id),
        }
    }

    /// The identity whose folder holds this namespace.
    #[must_use]
    pub fn identity(&self) -> &IdentityId {
        &self.identity
    }

    #[must_use]
    pub fn location(&self) -> &EventLogLocation {
        &self.location
    }

    /// The identity's folder under the provider root.
    #[must_use]
    pub fn identity_dir(&self) -> String {
        format!("{PROVIDER_ROOT_DIR}/{}", self.identity.as_str())
    }

    /// This namespace's folder name inside its identity folder.
    #[must_use]
    pub fn folder_name(&self) -> &str {
        match &self.location {
            EventLogLocation::Vault(store_id) => store_id.as_str(),
            EventLogLocation::Identity(_) => IDENTITY_LOG_DIR,
        }
    }

    /// The folder holding this namespace's event files, for path providers.
    #[must_use]
    pub fn root(&self) -> String {
        format!(
            "{}/{}/{EVENTS_DIR}",
            self.identity_dir(),
            self.folder_name()
        )
    }

    /// Immutable path of one event under this namespace.
    #[must_use]
    pub fn event_path(&self, event_id: &EventId) -> String {
        format!("{}/{}.yaml", self.root(), event_id.encoded_digest())
    }

    /// Derive the event id from a path under this namespace, if it is one.
    #[must_use]
    pub fn event_id_from_path(&self, path: &str) -> Option<EventId> {
        let root = self.root();
        let file = path.strip_prefix(root.as_str())?.strip_prefix('/')?;
        let digest = file.strip_suffix(".yaml")?;
        if digest.contains('/') {
            return None;
        }
        EventId::parse(&format!("sha256u:{digest}")).ok()
    }

    /// The namespace an event file path sits in, when it is an event file
    /// directly under a namespace's `events` folder.
    #[must_use]
    pub fn from_event_path(path: &str) -> Option<Self> {
        let rest = path.strip_prefix(PROVIDER_ROOT_DIR)?.strip_prefix('/')?;
        let mut parts = rest.split('/');
        let (Some(identity), Some(folder), Some(EVENTS_DIR), Some(file), None) = (
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
        ) else {
            return None;
        };
        if file.is_empty() {
            return None;
        }
        Self::from_folders(identity, folder)
    }

    /// The namespace an identity folder name and a folder inside it name.
    #[must_use]
    pub fn from_folders(identity: &str, folder: &str) -> Option<Self> {
        let identity = Self::exact_identity(identity)?;
        if folder == IDENTITY_LOG_DIR {
            return Some(Self::identity_log(identity));
        }
        Self::exact_store(folder).map(|store_id| Self::vault(identity, store_id))
    }

    /// An identity id written out in full, as a folder or tag names it.
    fn exact_identity(raw: &str) -> Option<IdentityId> {
        IdentityId::parse(raw).ok().filter(|id| id.as_str() == raw)
    }

    /// A store id written out in full, as a folder or tag names it.
    fn exact_store(raw: &str) -> Option<StoreId> {
        StoreId::parse(raw).ok().filter(|id| id.as_str() == raw)
    }

    /// `CloudKit`'s namespace tag: `vault:<store id>:<identity id>` or
    /// `identity:<identity id>`. The store id comes first so a vault is found
    /// by prefix without knowing its identity.
    #[must_use]
    pub fn cloudkit_tag(&self) -> String {
        match &self.location {
            EventLogLocation::Vault(store_id) => format!(
                "{VAULT_TAG_PREFIX}{}:{}",
                store_id.as_str(),
                self.identity.as_str()
            ),
            EventLogLocation::Identity(identity) => {
                format!("{IDENTITY_TAG_PREFIX}{}", identity.as_str())
            }
        }
    }

    /// The namespace a `CloudKit` tag names.
    #[must_use]
    pub fn from_cloudkit_tag(tag: &str) -> Option<Self> {
        if let Some(identity) = tag.strip_prefix(IDENTITY_TAG_PREFIX) {
            return Self::exact_identity(identity).map(Self::identity_log);
        }
        let (store_id, identity) = tag.strip_prefix(VAULT_TAG_PREFIX)?.split_once(':')?;
        Some(Self::vault(
            Self::exact_identity(identity)?,
            Self::exact_store(store_id)?,
        ))
    }

    /// The `CloudKit` tag prefix every record of one vault starts with,
    /// whichever identity filed it.
    #[must_use]
    pub fn cloudkit_vault_prefix(store_id: &StoreId) -> String {
        format!("{VAULT_TAG_PREFIX}{}:", store_id.as_str())
    }

    /// The `CloudKit` tag prefix of every namespace of one kind.
    #[must_use]
    pub fn cloudkit_kind_prefix(kind: EventLogNamespaceKind) -> &'static str {
        match kind {
            EventLogNamespaceKind::Vault => VAULT_TAG_PREFIX,
            EventLogNamespaceKind::Identity => IDENTITY_TAG_PREFIX,
        }
    }
}

/// Where a vault already sits at a provider, judged from the namespaces found
/// there for its store id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultPlacement {
    /// The provider holds the vault in this identity's folder.
    Filed(PlacedNamespace),
    /// The provider holds no event of the vault yet.
    Unfiled,
}

impl VaultPlacement {
    /// Judge the placement from every namespace found for `store_id`. A vault
    /// in two identity folders is an error: choosing one would fork its log.
    pub fn of(store_id: &StoreId, found: Vec<PlacedNamespace>) -> EventResult<Self> {
        let mut filed = found
            .into_iter()
            .filter(|placed| placed.location == EventLogLocation::Vault(store_id.clone()))
            .collect::<Vec<_>>();
        filed.sort();
        filed.dedup();
        match filed.len() {
            0 => Ok(Self::Unfiled),
            1 => Ok(filed.pop().map_or(Self::Unfiled, Self::Filed)),
            _ => Err(EventError::VaultFiledTwice {
                store_id: store_id.as_str().to_owned(),
            }),
        }
    }

    /// The namespace a sync uses: where the vault is filed, or, for a vault
    /// the provider does not hold yet, a new folder under `writer`, the
    /// identity writing it there first.
    #[must_use]
    pub fn for_writer(self, store_id: StoreId, writer: IdentityId) -> PlacedNamespace {
        match self {
            Self::Filed(placed) => placed,
            Self::Unfiled => PlacedNamespace::vault(writer, store_id),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids() -> anyhow::Result<(StoreId, IdentityId, IdentityId, EventId)> {
        Ok((
            StoreId::parse("store_abcdefghijk")?,
            IdentityId::parse("idn_abcdefghijk")?,
            IdentityId::parse("idn_zyxwvutsrqp")?,
            EventId::parse("sha256u:ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0")?,
        ))
    }

    #[test]
    fn vaults_sit_in_their_identity_folder_beside_its_log() -> anyhow::Result<()> {
        let (store, identity, _, event) = ids()?;
        let vault = PlacedNamespace::vault(identity.clone(), store);
        let identity_log = PlacedNamespace::identity_log(identity);

        assert_eq!(
            vault.event_path(&event),
            "meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/events/ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0.yaml"
        );
        assert_eq!(
            identity_log.event_path(&event),
            "meta-secret-nook/idn_abcdefghijk/log/events/ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0.yaml"
        );
        for placed in [&vault, &identity_log] {
            let path = placed.event_path(&event);
            assert_eq!(placed.event_id_from_path(&path), Some(event.clone()));
            assert_eq!(
                PlacedNamespace::from_event_path(&path).as_ref(),
                Some(placed)
            );
        }
        assert_eq!(
            vault.event_id_from_path(&identity_log.event_path(&event)),
            None
        );
        Ok(())
    }

    #[test]
    fn only_event_files_directly_under_a_namespace_name_it() -> anyhow::Result<()> {
        let (store, identity, _, _) = ids()?;
        let vault = PlacedNamespace::vault(identity, store);
        assert_eq!(
            PlacedNamespace::from_event_path(&format!("{}/notes.yaml", vault.root())).as_ref(),
            Some(&vault)
        );
        for path in [
            "meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/notes/a.yaml",
            "meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/events",
            "meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/events/",
            "meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/events/a/b.yaml",
            "meta-secret-nook/not-an-identity/store_abcdefghijk/events/a.yaml",
            "meta-secret-nook/idn_abcdefghijk/not-a-vault/events/a.yaml",
            "nook-log/v1/vaults/store_abcdefghijk/events/a.yaml",
        ] {
            assert_eq!(PlacedNamespace::from_event_path(path), None, "{path}");
        }
        Ok(())
    }

    #[test]
    fn cloudkit_tags_carry_both_ids_and_find_a_vault_by_prefix() -> anyhow::Result<()> {
        let (store, identity, _, _) = ids()?;
        let vault = PlacedNamespace::vault(identity.clone(), store.clone());
        let identity_log = PlacedNamespace::identity_log(identity);

        assert_eq!(
            vault.cloudkit_tag(),
            "vault:store_abcdefghijk:idn_abcdefghijk"
        );
        assert!(
            vault
                .cloudkit_tag()
                .starts_with(&PlacedNamespace::cloudkit_vault_prefix(&store))
        );
        assert_eq!(identity_log.cloudkit_tag(), "identity:idn_abcdefghijk");
        for placed in [&vault, &identity_log] {
            assert_eq!(
                PlacedNamespace::from_cloudkit_tag(&placed.cloudkit_tag()).as_ref(),
                Some(placed)
            );
        }
        for tag in ["vault:store_abcdefghijk", "vault:", "identity:", "other"] {
            assert_eq!(PlacedNamespace::from_cloudkit_tag(tag), None, "{tag}");
        }
        Ok(())
    }

    #[test]
    fn a_vault_stays_where_it_is_filed_and_is_new_only_once() -> anyhow::Result<()> {
        let (store, owner, writer, _) = ids()?;
        let other = StoreId::parse("store_otherstore1")?;
        let filed = PlacedNamespace::vault(owner.clone(), store.clone());
        let found = vec![
            filed.clone(),
            filed.clone(),
            PlacedNamespace::vault(writer.clone(), other),
            PlacedNamespace::identity_log(writer.clone()),
        ];

        // Another identity writing the vault keeps it in its owner's folder.
        assert_eq!(
            VaultPlacement::of(&store, found)?.for_writer(store.clone(), writer.clone()),
            filed
        );
        // A vault no folder holds yet is filed under the identity writing it.
        assert_eq!(
            VaultPlacement::of(&store, Vec::new())?.for_writer(store.clone(), writer.clone()),
            PlacedNamespace::vault(writer.clone(), store.clone())
        );
        // Two folders for one vault would fork its log.
        assert!(matches!(
            VaultPlacement::of(
                &store,
                vec![filed, PlacedNamespace::vault(writer, store.clone())]
            ),
            Err(EventError::VaultFiledTwice { .. })
        ));
        Ok(())
    }
}
