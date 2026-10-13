//! Remote namespaces for immutable event logs inside one provider target.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_auth2::{IdentityId, StoreId};

use crate::EventId;

const LEGACY_VAULT_ROOT: &str = "nook-log/v1/events";

/// Where one event log lives inside a provider target.
///
/// A target may hold one identity's control log and every vault that identity
/// owns. A provider row created before identity mounts keeps its vault at the
/// legacy root; nothing is moved remotely.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum EventLogLocation {
    LegacyVaultRoot,
    Vault(StoreId),
    Identity(IdentityId),
}

impl EventLogLocation {
    /// Directory-style root used by path-addressed providers.
    #[must_use]
    pub fn root(&self) -> String {
        match self {
            Self::LegacyVaultRoot => LEGACY_VAULT_ROOT.to_owned(),
            Self::Vault(store_id) => format!("nook-log/v1/vaults/{store_id}/events"),
            Self::Identity(identity_id) => format!("nook-identity/v1/{identity_id}/events"),
        }
    }

    /// Immutable path of one event under this namespace.
    #[must_use]
    pub fn event_path(&self, event_id: &EventId) -> String {
        format!("{}/{}.yaml", self.root(), event_id.encoded_digest())
    }

    /// Opaque namespace tag for providers that label files instead of nesting
    /// them (Drive `appProperties`, `CloudKit` fields). The legacy root has none.
    #[must_use]
    pub fn namespace_tag(&self) -> Option<String> {
        match self {
            Self::LegacyVaultRoot => None,
            Self::Vault(store_id) => Some(format!("vault:{store_id}")),
            Self::Identity(identity_id) => Some(format!("identity:{identity_id}")),
        }
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
    fn namespaces_never_overlap_and_keep_the_legacy_vault_root() -> anyhow::Result<()> {
        let store = StoreId::parse("store_abcdefghijk")?;
        let identity = IdentityId::parse("idn_abcdefghijk")?;
        let event = EventId::parse("sha256u:ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0")?;
        let legacy = EventLogLocation::LegacyVaultRoot;
        let vault = EventLogLocation::Vault(store.clone());
        let identity_log = EventLogLocation::Identity(identity);

        assert_eq!(legacy.event_path(&event), event.storage_path());
        assert_eq!(
            vault.event_path(&event),
            "nook-log/v1/vaults/store_abcdefghijk/events/ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0.yaml"
        );
        assert_eq!(
            identity_log.event_path(&event),
            "nook-identity/v1/idn_abcdefghijk/events/ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0.yaml"
        );
        for location in [&legacy, &vault, &identity_log] {
            assert_eq!(
                location.event_id_from_path(&location.event_path(&event)),
                Some(event.clone())
            );
        }
        // A vault namespace is nested under the legacy prefix family but never
        // matches the legacy root's direct children.
        assert_eq!(legacy.event_id_from_path(&vault.event_path(&event)), None);
        assert_eq!(vault.event_id_from_path(&legacy.event_path(&event)), None);
        assert_eq!(legacy.namespace_tag(), None);
        assert_eq!(
            vault.namespace_tag().as_deref(),
            Some("vault:store_abcdefghijk")
        );
        Ok(())
    }
}
