//! Remote namespaces for immutable event logs inside one provider target.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_auth2::{IdentityId, StoreId};

use crate::EventId;

/// Where one event log lives inside a provider target.
///
/// A target holds one identity's control log and every vault that identity
/// owns, each in its own namespace.
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

impl EventLogNamespaceKind {
    /// Directory holding every namespace of this kind, for path-addressed
    /// providers.
    #[must_use]
    pub fn parent_dir(self) -> &'static str {
        match self {
            Self::Vault => "nook-log/v1/vaults",
            Self::Identity => "nook-identity/v1",
        }
    }

    /// Prefix of the namespace tag providers that label files use.
    #[must_use]
    pub fn tag_prefix(self) -> &'static str {
        match self {
            Self::Vault => "vault:",
            Self::Identity => "identity:",
        }
    }

    /// The namespace id a path names, when the path is an event file of one
    /// namespace of this kind.
    #[must_use]
    pub fn id_from_path(self, path: &str) -> Option<String> {
        let rest = path.strip_prefix(self.parent_dir())?.strip_prefix('/')?;
        let (id, tail) = rest.split_once('/')?;
        let file = tail.strip_prefix("events/")?;
        (!id.is_empty() && !file.is_empty() && !file.contains('/')).then(|| id.to_owned())
    }

    /// The namespace id a tag names, when the tag is of this kind.
    #[must_use]
    pub fn id_from_tag(self, tag: &str) -> Option<String> {
        tag.strip_prefix(self.tag_prefix())
            .filter(|id| !id.is_empty())
            .map(str::to_owned)
    }
}

impl EventLogLocation {
    #[must_use]
    pub fn kind(&self) -> EventLogNamespaceKind {
        match self {
            Self::Vault(_) => EventLogNamespaceKind::Vault,
            Self::Identity(_) => EventLogNamespaceKind::Identity,
        }
    }

    fn id(&self) -> &str {
        match self {
            Self::Vault(store_id) => store_id.as_str(),
            Self::Identity(identity_id) => identity_id.as_str(),
        }
    }

    /// Directory-style root used by path-addressed providers.
    #[must_use]
    pub fn root(&self) -> String {
        format!("{}/{}/events", self.kind().parent_dir(), self.id())
    }

    /// Immutable path of one event under this namespace.
    #[must_use]
    pub fn event_path(&self, event_id: &EventId) -> String {
        format!("{}/{}.yaml", self.root(), event_id.encoded_digest())
    }

    /// Namespace tag for providers that label files instead of nesting them
    /// (Drive folder names, `CloudKit` fields).
    #[must_use]
    pub fn namespace_tag(&self) -> String {
        format!("{}{}", self.kind().tag_prefix(), self.id())
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_and_identity_namespaces_never_overlap() -> anyhow::Result<()> {
        let store = StoreId::parse("store_abcdefghijk")?;
        let identity = IdentityId::parse("idn_abcdefghijk")?;
        let event = EventId::parse("sha256u:ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0")?;
        let vault = EventLogLocation::Vault(store.clone());
        let identity_log = EventLogLocation::Identity(identity);

        assert_eq!(
            vault.event_path(&event),
            "nook-log/v1/vaults/store_abcdefghijk/events/ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0.yaml"
        );
        assert_eq!(
            identity_log.event_path(&event),
            "nook-identity/v1/idn_abcdefghijk/events/ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0.yaml"
        );
        for location in [&vault, &identity_log] {
            assert_eq!(
                location.event_id_from_path(&location.event_path(&event)),
                Some(event.clone())
            );
        }
        assert_eq!(
            vault.event_id_from_path(&identity_log.event_path(&event)),
            None
        );
        assert_eq!(vault.namespace_tag(), "vault:store_abcdefghijk");
        assert_eq!(identity_log.namespace_tag(), "identity:idn_abcdefghijk");
        Ok(())
    }

    #[test]
    fn namespace_ids_are_read_back_from_paths_and_tags() -> anyhow::Result<()> {
        let store = StoreId::parse("store_abcdefghijk")?;
        let event = EventId::parse("sha256u:ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0")?;
        let vault = EventLogLocation::Vault(store);
        let kind = EventLogNamespaceKind::Vault;

        assert_eq!(
            kind.id_from_path(&vault.event_path(&event)).as_deref(),
            Some("store_abcdefghijk")
        );
        // Only event files directly under a namespace's events name it.
        assert_eq!(
            kind.id_from_path("nook-log/v1/vaults/store_x/notes/a.yaml"),
            None
        );
        assert_eq!(kind.id_from_path("nook-log/v1/vaults/store_x/events"), None);
        assert_eq!(
            EventLogNamespaceKind::Identity.id_from_path(&vault.event_path(&event)),
            None
        );
        assert_eq!(
            kind.id_from_tag(&vault.namespace_tag()).as_deref(),
            Some("store_abcdefghijk")
        );
        assert_eq!(kind.id_from_tag("identity:idn_abcdefghijk"), None);
        assert_eq!(kind.id_from_tag("vault:"), None);
        Ok(())
    }
}
