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

use crate::{EventId, IdentityId, PROVIDER_ROOT_DIR, PlacedNamespace, S3KeyPrefix};

/// The full key of one object in the bucket, prefix included.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct S3ObjectKey(String);

impl S3ObjectKey {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(key) = self;
        key
    }
}

/// A key a listing reported. S3 keys are arbitrary text, so every one is a
/// key; whether it is an event is decided against its namespace.
impl From<String> for S3ObjectKey {
    fn from(key: String) -> Self {
        Self(key)
    }
}

/// The prefix a listing asks for. It always ends with `/`, so a listing never
/// matches a sibling folder that merely shares a name prefix.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3ListPrefix(String);

impl S3ListPrefix {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(prefix) = self;
        prefix
    }
}

/// A folder a delimited listing reported below the listed prefix, ending
/// with `/`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct S3CommonPrefix(String);

impl S3CommonPrefix {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(prefix) = self;
        prefix
    }
}

impl From<String> for S3CommonPrefix {
    fn from(prefix: String) -> Self {
        Self(prefix)
    }
}

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
    pub key: &'a S3ObjectKey,
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
    /// An identity's folder, as the prefix that lists its namespaces.
    Identity(S3ListPrefix),
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

impl S3KeyPrefix {
    /// The key a provider path takes below this prefix.
    fn key_of(&self, path: &str) -> String {
        match self {
            Self::BucketRoot => path.to_owned(),
            Self::Folder(prefix) => format!("{prefix}/{path}"),
        }
    }

    /// The provider path of a key, when the key is below this prefix.
    fn path_of<'a>(&self, key: &'a str) -> KeyBelowPrefix<'a> {
        match self {
            Self::BucketRoot => KeyBelowPrefix::Below(key),
            Self::Folder(prefix) => match key
                .strip_prefix(prefix.as_str())
                .and_then(|rest| rest.strip_prefix('/'))
            {
                Some(path) => KeyBelowPrefix::Below(path),
                None => KeyBelowPrefix::Outside,
            },
        }
    }

    /// The object of one event.
    #[must_use]
    pub fn event_key(&self, event: S3EventAddress<'_>) -> S3ObjectKey {
        S3ObjectKey(self.key_of(&event.placed.event_path(event.event_id)))
    }

    /// The prefix that lists one namespace's event objects.
    #[must_use]
    pub fn namespace_listing(&self, placed: &PlacedNamespace) -> S3ListPrefix {
        S3ListPrefix(format!("{}/", self.key_of(&placed.root())))
    }

    /// Read a key a namespace listing reported. Only `<digest>.yaml`
    /// directly in the namespace's `events/` folder is an event.
    #[must_use]
    pub fn listed_event(&self, listed: S3ListedKey<'_>) -> S3ListedEvent {
        let KeyBelowPrefix::Below(path) = self.path_of(listed.key.as_str()) else {
            return S3ListedEvent::Unrelated;
        };
        match listed.placed.event_id_from_path(path) {
            Some(event_id) => S3ListedEvent::Event(event_id),
            None => S3ListedEvent::Unrelated,
        }
    }

    /// The prefix that lists the identity folders below the provider root.
    #[must_use]
    pub fn identity_folders_listing(&self) -> S3ListPrefix {
        S3ListPrefix(format!("{}/", self.key_of(PROVIDER_ROOT_DIR)))
    }

    /// Read a folder the identity-folder listing reported.
    #[must_use]
    pub fn listed_identity_folder(&self, folder: &S3CommonPrefix) -> S3IdentityFolder {
        let S3ListPrefix(root) = self.identity_folders_listing();
        let Some(identity) = folder
            .as_str()
            .strip_prefix(root.as_str())
            .and_then(|rest| rest.strip_suffix('/'))
        else {
            return S3IdentityFolder::Unrelated;
        };
        match IdentityId::parse(identity) {
            Ok(id) if id.as_str() == identity => {
                S3IdentityFolder::Identity(S3ListPrefix(folder.as_str().to_owned()))
            }
            Ok(_) | Err(_) => S3IdentityFolder::Unrelated,
        }
    }

    /// Read a folder an identity folder's listing reported: the identity's
    /// log, a vault it files, or something unrelated.
    #[must_use]
    pub fn listed_namespace(&self, folder: &S3CommonPrefix) -> S3ListedNamespace {
        let S3ListPrefix(root) = self.identity_folders_listing();
        let Some(rest) = folder
            .as_str()
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
    use super::{
        S3CommonPrefix, S3EventAddress, S3IdentityFolder, S3ListedEvent, S3ListedKey,
        S3ListedNamespace, S3ObjectKey,
    };
    use crate::{EventId, IdentityId, PlacedNamespace, S3KeyPrefix, StoreId};

    const DIGEST: &str = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";

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
    fn event_objects_take_the_local_folder_paths_below_the_prefix() -> anyhow::Result<()> {
        let layout = Layout::new()?;
        let team = S3KeyPrefix::parse("team/vaults/")?;
        assert_eq!(
            team.event_key(S3EventAddress {
                placed: &layout.vault(),
                event_id: &layout.event,
            })
            .as_str(),
            format!(
                "team/vaults/meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/events/{DIGEST}.yaml"
            )
        );
        assert_eq!(
            S3KeyPrefix::BucketRoot
                .event_key(S3EventAddress {
                    placed: &layout.log(),
                    event_id: &layout.event,
                })
                .as_str(),
            format!("meta-secret-nook/idn_abcdefghijk/log/events/{DIGEST}.yaml")
        );
        assert_eq!(
            team.namespace_listing(&layout.log()).as_str(),
            "team/vaults/meta-secret-nook/idn_abcdefghijk/log/events/"
        );
        assert_eq!(
            S3KeyPrefix::BucketRoot.identity_folders_listing().as_str(),
            "meta-secret-nook/"
        );
        Ok(())
    }

    #[test]
    fn a_namespace_listing_keeps_only_its_own_event_objects() -> anyhow::Result<()> {
        let layout = Layout::new()?;
        let team = S3KeyPrefix::parse("team")?;
        let vault = layout.vault();
        let listed = |key: String| {
            team.listed_event(S3ListedKey {
                placed: &vault,
                key: &S3ObjectKey::from(key),
            })
        };
        let events = "team/meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/events";
        assert_eq!(
            listed(format!("{events}/{DIGEST}.yaml")),
            S3ListedEvent::Event(layout.event.clone())
        );
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
                listed(unrelated.clone()),
                S3ListedEvent::Unrelated,
                "{unrelated}"
            );
        }
        Ok(())
    }

    #[test]
    fn folder_listings_name_identities_and_their_namespaces() -> anyhow::Result<()> {
        let layout = Layout::new()?;
        let team = S3KeyPrefix::parse("team")?;
        let folder = |prefix: &str| S3CommonPrefix::from(prefix.to_owned());
        let S3IdentityFolder::Identity(identity) =
            team.listed_identity_folder(&folder("team/meta-secret-nook/idn_abcdefghijk/"))
        else {
            anyhow::bail!("an identity folder lists its namespaces");
        };
        assert_eq!(identity.as_str(), "team/meta-secret-nook/idn_abcdefghijk/");
        for unrelated in [
            "team/meta-secret-nook/backups/",
            "team/meta-secret-nook/IDN_abcdefghijk/",
            "other/meta-secret-nook/idn_abcdefghijk/",
            "team/meta-secret-nook/idn_abcdefghijk/log/",
        ] {
            assert_eq!(
                team.listed_identity_folder(&folder(unrelated)),
                S3IdentityFolder::Unrelated,
                "{unrelated}"
            );
        }

        assert_eq!(
            team.listed_namespace(&folder("team/meta-secret-nook/idn_abcdefghijk/log/")),
            S3ListedNamespace::Namespace(layout.log())
        );
        assert_eq!(
            team.listed_namespace(&folder(
                "team/meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/"
            )),
            S3ListedNamespace::Namespace(layout.vault())
        );
        for unrelated in [
            "team/meta-secret-nook/idn_abcdefghijk/archive/",
            "team/meta-secret-nook/idn_abcdefghijk/",
            "team/meta-secret-nook/idn_abcdefghijk/log/events/",
            "meta-secret-nook/idn_abcdefghijk/log/",
        ] {
            assert_eq!(
                team.listed_namespace(&folder(unrelated)),
                S3ListedNamespace::Unrelated,
                "{unrelated}"
            );
        }
        Ok(())
    }
}
