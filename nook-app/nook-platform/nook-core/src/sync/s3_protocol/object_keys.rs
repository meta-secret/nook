#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! Object keys of an S3 provider: the local-folder layout below the key
//! prefix.
//!
//! Every namespace keeps the path a local folder gives it, as a key below the
//! optional prefix:
//!
//! ```text
//! [prefix/]meta-secret-nook/<identity id>/log/events/<digest>.yaml
//! [prefix/]meta-secret-nook/<identity id>/<store id>/events/<digest>.yaml
//! ```
//!
//! Listings read keys back the way the folder adapter reads file names: an
//! event key directly in a namespace's `events/` folder whose name is
//! `<digest>.yaml` is an event, and every other key is unrelated and ignored.
//! S3 keys are arbitrary text, and a URL parser may rewrite one holding `.` or
//! `..` segments, so a listed key is only read back, never sent: requests
//! address an [`S3EventAddress`], whose key the layout builds.

use crate::{EventId, IdentityId, PROVIDER_ROOT_DIR, PlacedNamespace, S3Connection};

/// One event's object in one namespace.
#[derive(Clone, Copy)]
pub struct S3EventAddress<'a> {
    pub placed: &'a PlacedNamespace,
    pub event_id: &'a EventId,
}

/// A key a namespace listing reported, read against that namespace.
#[derive(Clone, Copy)]
pub struct S3ListedKey<'a> {
    pub placed: &'a PlacedNamespace,
    pub key: &'a str,
}

/// What a listed key is to the namespace it was listed in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum S3ListedEvent {
    Event(EventId),
    /// Anything else: another folder, another file name, a damaged digest.
    Unrelated,
}

/// What a folder below the provider root is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum S3IdentityFolder {
    /// An identity's folder; [`S3Connection::identity_namespaces_listing`]
    /// lists its namespaces.
    Identity(IdentityId),
    Unrelated,
}

/// What a folder inside an identity folder is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum S3ListedNamespace {
    Namespace(PlacedNamespace),
    Unrelated,
}

/// Where a key sits relative to the location's prefix.
enum KeyBelowPrefix<'a> {
    Below(&'a str),
    Outside,
}

impl S3Connection {
    /// The key a provider path takes below the key prefix.
    fn key_of(&self, path: &str) -> String {
        match self.key_prefix.as_str() {
            "" => path.to_owned(),
            prefix => format!("{prefix}/{path}"),
        }
    }

    /// The provider path of a key, when the key is below the key prefix.
    fn path_of<'a>(&self, key: &'a str) -> KeyBelowPrefix<'a> {
        match self.key_prefix.as_str() {
            "" => KeyBelowPrefix::Below(key),
            prefix => match key
                .strip_prefix(prefix)
                .and_then(|rest| rest.strip_prefix('/'))
            {
                Some(path) => KeyBelowPrefix::Below(path),
                None => KeyBelowPrefix::Outside,
            },
        }
    }

    /// The full key, prefix included, of one event's object.
    pub(super) fn event_key(&self, event: S3EventAddress<'_>) -> String {
        self.key_of(&event.placed.event_path(event.event_id))
    }

    /// The prefix that lists one namespace's event objects. Every listing
    /// prefix ends with `/`, so it never matches a sibling folder that merely
    /// shares a name prefix.
    #[must_use]
    pub fn namespace_listing(&self, placed: &PlacedNamespace) -> String {
        format!("{}/", self.key_of(&placed.root()))
    }

    /// Read a key a namespace listing reported. Only `<digest>.yaml`
    /// directly in the namespace's `events/` folder is an event.
    #[must_use]
    pub fn listed_event(&self, listed: S3ListedKey<'_>) -> S3ListedEvent {
        let KeyBelowPrefix::Below(path) = self.path_of(listed.key) else {
            return S3ListedEvent::Unrelated;
        };
        match listed.placed.event_id_from_path(path) {
            Some(event_id) => S3ListedEvent::Event(event_id),
            None => S3ListedEvent::Unrelated,
        }
    }

    /// The prefix that lists the identity folders below the provider root.
    #[must_use]
    pub fn identity_folders_listing(&self) -> String {
        format!("{}/", self.key_of(PROVIDER_ROOT_DIR))
    }

    /// Read a folder the identity-folder listing reported.
    #[must_use]
    pub fn listed_identity_folder(&self, folder: &str) -> S3IdentityFolder {
        let root = self.identity_folders_listing();
        let Some(identity) = folder
            .strip_prefix(root.as_str())
            .and_then(|rest| rest.strip_suffix('/'))
        else {
            return S3IdentityFolder::Unrelated;
        };
        match IdentityId::parse(identity) {
            Ok(id) if id.as_str() == identity => S3IdentityFolder::Identity(id),
            Ok(_) | Err(_) => S3IdentityFolder::Unrelated,
        }
    }

    /// The prefix that lists the namespaces in one identity's folder.
    #[must_use]
    pub fn identity_namespaces_listing(&self, identity: &IdentityId) -> String {
        format!(
            "{}/",
            self.key_of(&PlacedNamespace::identity_log(identity.clone()).identity_dir())
        )
    }

    /// Read a folder an identity folder's listing reported: the identity's
    /// log, a vault it files, or something unrelated.
    #[must_use]
    pub fn listed_namespace(&self, folder: &str) -> S3ListedNamespace {
        let root = self.identity_folders_listing();
        let Some(rest) = folder
            .strip_prefix(root.as_str())
            .and_then(|rest| rest.strip_suffix('/'))
        else {
            return S3ListedNamespace::Unrelated;
        };
        let Some((identity, namespace)) = rest.split_once('/') else {
            return S3ListedNamespace::Unrelated;
        };
        match PlacedNamespace::from_folders(identity, namespace) {
            Some(placed) => S3ListedNamespace::Namespace(placed),
            None => S3ListedNamespace::Unrelated,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{S3EventAddress, S3IdentityFolder, S3ListedEvent, S3ListedKey, S3ListedNamespace};
    use crate::{EventId, IdentityId, PlacedNamespace, S3Connection, S3ConnectionDraft, StoreId};

    const DIGEST: &str = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";

    /// A connection that keeps its objects below this key prefix.
    fn below(prefix: &str) -> anyhow::Result<S3Connection> {
        let mut draft = S3ConnectionDraft::fixture();
        draft.key_prefix = prefix.to_owned();
        Ok(S3Connection::try_from(draft)?)
    }

    struct Layout {
        identity: IdentityId,
        store: StoreId,
        event: EventId,
    }

    impl Layout {
        fn new() -> anyhow::Result<Self> {
            Ok(Self {
                identity: IdentityId::parse("idn_abcdefghijk")?,
                store: StoreId::parse("store_abcdefghijk")?,
                event: EventId::parse(&format!("sha256u:{DIGEST}"))?,
            })
        }

        fn vault(&self) -> PlacedNamespace {
            PlacedNamespace::vault(self.identity.clone(), self.store.clone())
        }

        fn log(&self) -> PlacedNamespace {
            PlacedNamespace::identity_log(self.identity.clone())
        }
    }

    #[test]
    fn event_objects_take_the_local_folder_paths_and_read_back_as_their_events()
    -> anyhow::Result<()> {
        let layout = Layout::new()?;
        let (team, root) = (below("team/vaults/")?, below("")?);
        let (vault, log) = (layout.vault(), layout.log());
        for (prefix, placed, key) in [
            (
                &team,
                &vault,
                format!(
                    "team/vaults/meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/events/{DIGEST}.yaml"
                ),
            ),
            (
                &root,
                &log,
                format!("meta-secret-nook/idn_abcdefghijk/log/events/{DIGEST}.yaml"),
            ),
        ] {
            let built = prefix.event_key(S3EventAddress {
                placed,
                event_id: &layout.event,
            });
            assert_eq!(built, key);
            assert_eq!(
                prefix.listed_event(S3ListedKey {
                    placed,
                    key: &built
                }),
                S3ListedEvent::Event(layout.event.clone())
            );
        }
        assert_eq!(
            team.namespace_listing(&log),
            "team/vaults/meta-secret-nook/idn_abcdefghijk/log/events/"
        );
        assert_eq!(root.identity_folders_listing(), "meta-secret-nook/");
        Ok(())
    }

    #[test]
    fn a_namespace_listing_keeps_only_its_own_event_objects() -> anyhow::Result<()> {
        let layout = Layout::new()?;
        let team = below("team")?;
        let vault = layout.vault();
        let events = "team/meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/events";
        for unrelated in [
            format!("{events}/{DIGEST}.yml"),
            format!("{events}/notes.txt"),
            format!("{events}/nested/{DIGEST}.yaml"),
            format!("{events}/{}.yaml", "!".repeat(43)),
            format!("meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/events/{DIGEST}.yaml"),
            format!("team/meta-secret-nook/idn_abcdefghijk/log/events/{DIGEST}.yaml"),
            format!(
                "teamwork/meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/events/{DIGEST}.yaml"
            ),
        ] {
            assert_eq!(
                team.listed_event(S3ListedKey {
                    placed: &vault,
                    key: &unrelated,
                }),
                S3ListedEvent::Unrelated,
                "{unrelated}"
            );
        }
        Ok(())
    }

    #[test]
    fn folder_listings_name_identities_and_their_namespaces() -> anyhow::Result<()> {
        let layout = Layout::new()?;
        let team = below("team")?;
        let S3IdentityFolder::Identity(identity) =
            team.listed_identity_folder("team/meta-secret-nook/idn_abcdefghijk/")
        else {
            anyhow::bail!("an identity folder lists its namespaces");
        };
        assert_eq!(identity, layout.identity);
        // Its namespaces are listed below a prefix the layout builds again.
        assert_eq!(
            team.identity_namespaces_listing(&identity),
            "team/meta-secret-nook/idn_abcdefghijk/"
        );
        for unrelated in [
            "team/meta-secret-nook/backups/",
            "team/meta-secret-nook/IDN_abcdefghijk/",
            "other/meta-secret-nook/idn_abcdefghijk/",
            "team/meta-secret-nook/idn_abcdefghijk/log/",
        ] {
            assert_eq!(
                team.listed_identity_folder(unrelated),
                S3IdentityFolder::Unrelated,
                "{unrelated}"
            );
        }

        assert_eq!(
            team.listed_namespace("team/meta-secret-nook/idn_abcdefghijk/log/"),
            S3ListedNamespace::Namespace(layout.log())
        );
        assert_eq!(
            team.listed_namespace("team/meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/"),
            S3ListedNamespace::Namespace(layout.vault())
        );
        for unrelated in [
            "team/meta-secret-nook/idn_abcdefghijk/archive/",
            "team/meta-secret-nook/idn_abcdefghijk/",
            "team/meta-secret-nook/idn_abcdefghijk/log/events/",
            "meta-secret-nook/idn_abcdefghijk/log/",
        ] {
            assert_eq!(
                team.listed_namespace(unrelated),
                S3ListedNamespace::Unrelated,
                "{unrelated}"
            );
        }
        Ok(())
    }
}
