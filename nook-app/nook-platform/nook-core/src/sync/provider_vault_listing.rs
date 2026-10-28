//! What a sync provider already holds, summarized without decrypting it.
//!
//! A provider keeps one Nook root per account. Inside it, the identity log
//! and every vault live in their own namespace subdirectory, so the events
//! of different vaults never share a folder and vaults coexist safely. A
//! listing summarizes each vault namespace from transport metadata alone:
//! when its files were created, how many event files it holds, and a short
//! id. It then relates each vault to the identity on this device. Vault names
//! travel only encrypted under each vault's key, so a listed vault shows its
//! name only when this browser already keeps it for a vault it holds.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use std::cmp::Ordering;

use crate::errors::{ValidationError, ValidationResult};
use crate::provider_vault_access::{
    OpenVaultContents, ProviderVaultAccess, ProviderVaultAction, ProviderVaultKeyholding,
};
use crate::{IdentityId, IdentityWords, ListedIdentityLog, ProviderIdentityLog, StoreId};
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use tsify::Tsify;

/// The fixed name of the one app-owned root each provider account holds.
pub const NOOK_PROVIDER_ROOT_NAME: &str = nook_event_log::PROVIDER_ROOT_DIR;

/// Characters of a store token shown as a vault's short id.
const SHORT_ID_LENGTH: usize = 8;
const NANOS_PER_MILLI: i128 = 1_000_000;

/// A moment a provider reported for a listed file: milliseconds since the
/// Unix epoch, in UTC.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct ProviderInstant(i64);

impl ProviderInstant {
    /// Parse an RFC 3339 timestamp such as Drive's `createdTime`
    /// (`2024-05-01T12:30:00.123Z`). Offsets other than `Z` are applied.
    pub fn parse_rfc3339(raw: &str) -> ValidationResult<Self> {
        let parsed = time::OffsetDateTime::parse(raw.trim(), &Rfc3339)
            .map_err(|_| ValidationError::IsoTimestampInvalid)?;
        i64::try_from(parsed.unix_timestamp_nanos() / NANOS_PER_MILLI)
            .map(Self)
            .map_err(|_| ValidationError::IsoTimestampInvalid)
    }
}

/// When a provider says a listed item was created. Transports whose
/// listings carry no cheap timestamps report nothing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ProviderVaultTime {
    Unreported,
    Reported {
        #[tsify(type = "number")]
        at: ProviderInstant,
    },
}

impl ProviderVaultTime {
    fn instant(self) -> Option<ProviderInstant> {
        match self {
            Self::Unreported => None,
            Self::Reported { at } => Some(at),
        }
    }

    fn from_instant(instant: Option<ProviderInstant>) -> Self {
        instant.map_or(Self::Unreported, |at| Self::Reported { at })
    }
}

/// How many event files a vault namespace holds.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProviderEventCount(u32);

impl ProviderEventCount {
    fn of(len: usize) -> Self {
        Self(u32::try_from(len).unwrap_or(u32::MAX))
    }
}

/// What a transport listed for one vault namespace.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderVaultObservation {
    pub store_id: StoreId,
    /// The identity whose folder files the vault.
    pub identity: IdentityId,
    /// When the namespace subdirectory was created, where reported.
    pub namespace_created: ProviderVaultTime,
    /// One entry per event file in the namespace.
    pub events: Vec<ProviderVaultTime>,
}

/// A vault's name as this browser already keeps it, for a vault it holds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KnownVaultName {
    pub store_id: StoreId,
    pub name: String,
}

/// What a listed vault is called. Its name is encrypted under the vault's
/// own key, so only a vault this browser holds can be named here.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ProviderVaultName {
    /// This browser does not know the name; the short id tells it apart.
    Unknown,
    Named {
        name: String,
    },
}

impl ProviderVaultName {
    /// A decrypted or kept name; a blank one is none.
    pub(crate) fn named(name: &str) -> Self {
        let name = name.trim();
        if name.is_empty() {
            Self::Unknown
        } else {
            Self::Named {
                name: name.to_owned(),
            }
        }
    }

    fn of(store_id: &StoreId, names: &[KnownVaultName]) -> Self {
        names
            .iter()
            .find(|known| &known.store_id == store_id)
            .map(|known| known.name.trim())
            .filter(|name| !name.is_empty())
            .map_or(Self::Unknown, |name| Self::Named {
                name: name.to_owned(),
            })
    }
}

/// An identity's label as this browser keeps it, for an identity it holds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KnownIdentityName {
    pub identity_id: IdentityId,
    pub name: String,
}

/// The names this browser keeps for the vaults and identities it holds.
#[derive(Clone, Copy, Debug)]
pub struct BrowserNames<'a> {
    pub vaults: &'a [KnownVaultName],
    pub identities: &'a [KnownIdentityName],
}

impl BrowserNames<'_> {
    /// A browser that holds no vault and no identity.
    pub const NONE: BrowserNames<'static> = BrowserNames {
        vaults: &[],
        identities: &[],
    };
}

/// What a listing knows about the identities that file its vaults.
#[derive(Clone, Copy, Debug)]
struct KnownIdentity<'a> {
    names: &'a [KnownIdentityName],
    logs: &'a [ListedIdentityLog],
}

/// The identity whose folder files a listed vault: the vault came from it,
/// whichever identities share the vault since.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct FilingIdentity {
    #[tsify(type = "string")]
    pub identity_id: IdentityId,
    /// The first characters of the identity token, to tell identities apart.
    pub short_id: String,
    /// Its label when an identity on this browser is that identity.
    pub name: ProviderVaultName,
    /// Three words derived from its id, the same ones its identity card shows.
    pub words: IdentityWords,
    /// What its public control log on the provider tells.
    pub log: ProviderIdentityLog,
}

impl FilingIdentity {
    fn of(identity_id: IdentityId, known: KnownIdentity<'_>) -> Self {
        let raw = identity_id.as_str();
        let short_id = raw
            .strip_prefix("idn_")
            .unwrap_or(raw)
            .chars()
            .take(SHORT_ID_LENGTH)
            .collect();
        let name = known
            .names
            .iter()
            .find(|known| known.identity_id == identity_id)
            .map(|known| known.name.trim())
            .filter(|name| !name.is_empty())
            .map_or(ProviderVaultName::Unknown, |name| {
                ProviderVaultName::Named {
                    name: name.to_owned(),
                }
            });
        Self {
            words: IdentityWords::of(&identity_id),
            log: ListedIdentityLog::of(&identity_id, known.logs),
            identity_id,
            short_id,
            name,
        }
    }
}

/// One vault a provider holds, as far as its listing tells without
/// decryption.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ProviderVaultSummary {
    pub store_id: StoreId,
    /// The first characters of the store token, to tell vaults apart.
    pub short_id: String,
    /// What this browser calls it.
    pub name: ProviderVaultName,
    /// The identity whose folder files it.
    pub identity: FilingIdentity,
    pub created: ProviderVaultTime,
    pub last_activity: ProviderVaultTime,
    #[tsify(type = "number")]
    pub event_count: ProviderEventCount,
    /// How this device can open it.
    pub access: ProviderVaultAccess,
    /// What the user may do with it, the recommended action first.
    pub actions: Vec<ProviderVaultAction>,
}

impl ProviderVaultSummary {
    pub(crate) fn short_id(store_id: &StoreId) -> String {
        let raw = store_id.as_str();
        raw.strip_prefix("store_")
            .unwrap_or(raw)
            .chars()
            .take(SHORT_ID_LENGTH)
            .collect()
    }

    fn summarize(
        observation: ProviderVaultObservation,
        keys: &ProviderVaultKeyholding<'_>,
        names: BrowserNames<'_>,
        identity_logs: &[ListedIdentityLog],
        contents: OpenVaultContents,
    ) -> Self {
        let ProviderVaultObservation {
            store_id,
            identity,
            namespace_created,
            events,
        } = observation;
        let access = keys.access(&store_id);
        let actions = contents.actions(&access);
        let event_times = events
            .iter()
            .filter_map(|time| time.instant())
            .collect::<Vec<_>>();
        let created = namespace_created
            .instant()
            .into_iter()
            .chain(event_times.iter().copied())
            .min();
        let last_activity = event_times
            .iter()
            .copied()
            .max()
            .or_else(|| namespace_created.instant());
        Self {
            short_id: Self::short_id(&store_id),
            name: ProviderVaultName::of(&store_id, names.vaults),
            identity: FilingIdentity::of(
                identity,
                KnownIdentity {
                    names: names.identities,
                    logs: identity_logs,
                },
            ),
            store_id,
            created: ProviderVaultTime::from_instant(created),
            last_activity: ProviderVaultTime::from_instant(last_activity),
            event_count: ProviderEventCount::of(events.len()),
            access,
            actions,
        }
    }

    /// The vaults that sync first, then by access, then the most recently active.
    fn listing_order(&self, other: &Self) -> Ordering {
        self.access
            .listing_rank()
            .cmp(&other.access.listing_rank())
            .then_with(|| {
                other
                    .last_activity
                    .instant()
                    .cmp(&self.last_activity.instant())
            })
            .then_with(|| self.store_id.cmp(&other.store_id))
    }
}

/// How many items a local vault holds.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct LocalVaultItemCount(u32);

impl From<u32> for LocalVaultItemCount {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

/// How many app keys the local identity has, this one included.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct IdentityAppCount(u32);

impl From<u32> for IdentityAppCount {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

/// The vault this device has open, as far as a replacement offer needs it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum LocalVaultOccupancy {
    /// No vault is open on this device.
    Closed,
    #[serde(rename_all = "camelCase")]
    Open {
        store_id: StoreId,
        #[tsify(type = "number")]
        item_count: LocalVaultItemCount,
        #[tsify(type = "number")]
        identity_app_count: IdentityAppCount,
    },
}

impl LocalVaultOccupancy {
    /// The open vault holds nothing and nobody else shares it.
    fn empty_store_id(&self) -> Option<&StoreId> {
        match self {
            Self::Open {
                store_id,
                item_count,
                identity_app_count,
            } if item_count.0 == 0 && identity_app_count.0 <= 1 => Some(store_id),
            Self::Closed | Self::Open { .. } => None,
        }
    }

    fn contents(&self) -> OpenVaultContents {
        match (self, self.empty_store_id()) {
            (Self::Closed, _) => OpenVaultContents::Closed,
            (Self::Open { .. }, Some(_)) => OpenVaultContents::Empty,
            (Self::Open { .. }, None) => OpenVaultContents::Occupied,
        }
    }
}

/// Whether this device may swap its empty vault for one the provider holds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum EmptyVaultReplacement {
    Unavailable,
    /// The open vault is empty; after an explicit confirmation it may give
    /// way to one of the provider's other vaults.
    #[serde(rename_all = "camelCase")]
    Offered {
        empty_store_id: StoreId,
    },
}

/// The vaults a provider holds and what this device may do with them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ProviderVaultListing {
    pub vaults: Vec<ProviderVaultSummary>,
    pub replacement: EmptyVaultReplacement,
}

/// The transport's observations, the keys this device holds, and its open
/// vault.
pub struct ProviderVaultListingRequest<'a> {
    pub observations: Vec<ProviderVaultObservation>,
    pub keys: ProviderVaultKeyholding<'a>,
    /// The names this browser keeps for the vaults and identities it holds.
    pub names: BrowserNames<'a>,
    /// The public control logs of the listed identities, where read.
    pub identity_logs: &'a [ListedIdentityLog],
    pub local_vault: &'a LocalVaultOccupancy,
}

impl ProviderVaultListingRequest<'_> {
    /// Summarize every listed vault, decide how this device can open it, and
    /// offer what the user may do: a vault this device can open replaces an
    /// empty open vault, merges into one with records, or comes in beside
    /// it; a vault nothing here opens can only be requested.
    #[must_use]
    pub fn listing(self) -> ProviderVaultListing {
        let Self {
            observations,
            keys,
            names,
            identity_logs,
            local_vault,
        } = self;
        let contents = local_vault.contents();
        let mut vaults = observations
            .into_iter()
            .map(|observation| {
                ProviderVaultSummary::summarize(observation, &keys, names, identity_logs, contents)
            })
            .collect::<Vec<_>>();
        vaults.sort_by(ProviderVaultSummary::listing_order);
        let offers_replacement = vaults
            .iter()
            .any(|vault| vault.actions.contains(&ProviderVaultAction::UseInstead));
        let replacement = match local_vault.empty_store_id() {
            Some(empty_store_id) if offers_replacement => EmptyVaultReplacement::Offered {
                empty_store_id: empty_store_id.clone(),
            },
            Some(_) | None => EmptyVaultReplacement::Unavailable,
        };
        ProviderVaultListing {
            vaults,
            replacement,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ProviderLogCount;
    use std::slice;

    fn at(raw: &str) -> anyhow::Result<ProviderVaultTime> {
        Ok(ProviderVaultTime::Reported {
            at: ProviderInstant::parse_rfc3339(raw)?,
        })
    }

    fn store(token: &str) -> anyhow::Result<StoreId> {
        Ok(StoreId::parse(token)?)
    }

    /// The identity whose folder files every listed test vault.
    fn filer() -> anyhow::Result<IdentityId> {
        Ok(IdentityId::parse("idn_filerfilerf")?)
    }

    fn open(store_id: &StoreId, items: u32, apps: u32) -> LocalVaultOccupancy {
        LocalVaultOccupancy::Open {
            store_id: store_id.clone(),
            item_count: items.into(),
            identity_app_count: apps.into(),
        }
    }

    #[test]
    fn rfc3339_timestamps_become_epoch_milliseconds() -> anyhow::Result<()> {
        assert_eq!(
            ProviderInstant::parse_rfc3339("1970-01-01T00:00:00Z")?,
            ProviderInstant(0)
        );
        assert_eq!(
            ProviderInstant::parse_rfc3339("2024-05-01T12:30:00.123Z")?,
            ProviderInstant(1_714_566_600_123)
        );
        assert_eq!(
            ProviderInstant::parse_rfc3339("2024-05-01T14:30:00.5+02:00")?,
            ProviderInstant(1_714_566_600_500)
        );
        assert_eq!(
            ProviderInstant::parse_rfc3339("2024-02-29T00:00:00-01:30")?,
            ProviderInstant::parse_rfc3339("2024-02-29T01:30:00Z")?
        );
        assert_eq!(
            ProviderInstant::parse_rfc3339("1969-12-31T23:59:59Z")?,
            ProviderInstant(-1_000)
        );
        Ok(())
    }

    #[test]
    fn malformed_timestamps_are_rejected() {
        for raw in [
            "",
            "2024-05-01",
            "2024-13-01T00:00:00Z",
            "2023-02-29T00:00:00Z",
            "2024-05-01T24:00:00Z",
            "2024-05-01T12:30:00.1aZ",
            "2024-05-01T12:30:00+2:00",
            "24-05-01T12:30:00Z",
        ] {
            assert_eq!(
                ProviderInstant::parse_rfc3339(raw),
                Err(ValidationError::IsoTimestampInvalid),
                "{raw}"
            );
        }
    }

    #[test]
    fn a_vault_summary_spans_its_listed_files() -> anyhow::Result<()> {
        let store_id = store("store_SMypl8K0w9Y")?;
        let listing = ProviderVaultListingRequest {
            observations: vec![ProviderVaultObservation {
                store_id: store_id.clone(),
                identity: filer()?,
                namespace_created: at("2024-01-02T00:00:00Z")?,
                events: vec![
                    at("2024-03-01T00:00:00Z")?,
                    at("2024-01-01T00:00:00Z")?,
                    ProviderVaultTime::Unreported,
                ],
            }],
            keys: ProviderVaultKeyholding::NONE,
            names: BrowserNames::NONE,
            identity_logs: &[],
            local_vault: &LocalVaultOccupancy::Closed,
        }
        .listing();
        assert_eq!(
            listing.vaults,
            [ProviderVaultSummary {
                store_id,
                short_id: "SMypl8K0".to_owned(),
                name: ProviderVaultName::Unknown,
                identity: FilingIdentity {
                    identity_id: filer()?,
                    short_id: "filerfil".to_owned(),
                    name: ProviderVaultName::Unknown,
                    words: IdentityWords::of(&filer()?),
                    log: ProviderIdentityLog::Absent,
                },
                created: at("2024-01-01T00:00:00Z")?,
                last_activity: at("2024-03-01T00:00:00Z")?,
                event_count: ProviderEventCount(3),
                access: ProviderVaultAccess::Unchecked,
                actions: vec![ProviderVaultAction::ImportSeparately],
            }]
        );
        assert_eq!(listing.replacement, EmptyVaultReplacement::Unavailable);
        Ok(())
    }

    #[test]
    fn transports_without_timestamps_report_only_counts() -> anyhow::Result<()> {
        let listing = ProviderVaultListingRequest {
            observations: vec![ProviderVaultObservation {
                store_id: store("store_abcdefghijk")?,
                identity: filer()?,
                namespace_created: ProviderVaultTime::Unreported,
                events: vec![ProviderVaultTime::Unreported; 2],
            }],
            keys: ProviderVaultKeyholding::NONE,
            names: BrowserNames::NONE,
            identity_logs: &[],
            local_vault: &LocalVaultOccupancy::Closed,
        }
        .listing();
        let [vault] = listing.vaults.as_slice() else {
            anyhow::bail!("one vault is listed");
        };
        assert_eq!(vault.created, ProviderVaultTime::Unreported);
        assert_eq!(vault.last_activity, ProviderVaultTime::Unreported);
        assert_eq!(vault.event_count, ProviderEventCount(2));
        Ok(())
    }

    #[test]
    fn an_empty_namespace_reports_when_it_was_created() -> anyhow::Result<()> {
        let listing = ProviderVaultListingRequest {
            observations: vec![ProviderVaultObservation {
                store_id: store("store_abcdefghijk")?,
                identity: filer()?,
                namespace_created: at("2024-01-02T00:00:00Z")?,
                events: vec![],
            }],
            keys: ProviderVaultKeyholding::NONE,
            names: BrowserNames::NONE,
            identity_logs: &[],
            local_vault: &LocalVaultOccupancy::Closed,
        }
        .listing();
        let [vault] = listing.vaults.as_slice() else {
            anyhow::bail!("one vault is listed");
        };
        assert_eq!(vault.created, at("2024-01-02T00:00:00Z")?);
        assert_eq!(vault.last_activity, at("2024-01-02T00:00:00Z")?);
        assert_eq!(vault.event_count, ProviderEventCount(0));
        Ok(())
    }

    #[test]
    fn syncing_vaults_come_first_then_openable_then_locked_most_recent_first() -> anyhow::Result<()>
    {
        let own = store("store_ownvault001")?;
        let backed = store("store_backedvault")?;
        let older = store("store_oldvault001")?;
        let newer = store("store_newvault001")?;
        let observation = |store_id: &StoreId, time: &str| -> anyhow::Result<_> {
            Ok(ProviderVaultObservation {
                store_id: store_id.clone(),
                identity: filer()?,
                namespace_created: ProviderVaultTime::Unreported,
                events: vec![at(time)?],
            })
        };
        let listing = ProviderVaultListingRequest {
            observations: vec![
                observation(&older, "2023-01-01T00:00:00Z")?,
                observation(&newer, "2025-01-01T00:00:00Z")?,
                observation(&backed, "2019-01-01T00:00:00Z")?,
                observation(&own, "2020-01-01T00:00:00Z")?,
            ],
            keys: ProviderVaultKeyholding {
                identity_vaults: slice::from_ref(&own),
                password_vaults: slice::from_ref(&backed),
                identity_in_use: true,
                ..ProviderVaultKeyholding::NONE
            },
            names: BrowserNames::NONE,
            identity_logs: &[],
            local_vault: &LocalVaultOccupancy::Closed,
        }
        .listing();
        let ranked = listing
            .vaults
            .iter()
            .map(|vault| (vault.store_id.clone(), vault.access.clone()))
            .collect::<Vec<_>>();
        assert_eq!(
            ranked,
            [
                (own, ProviderVaultAccess::Syncs),
                (backed, ProviderVaultAccess::BackupPassword),
                (newer, ProviderVaultAccess::Locked),
                (older, ProviderVaultAccess::Locked),
            ]
        );
        Ok(())
    }

    #[test]
    fn an_openable_vault_replaces_an_empty_vault_and_merges_into_a_full_one() -> anyhow::Result<()>
    {
        use ProviderVaultAction::{ImportSeparately, MergeIntoOpen, RequestAccess, UseInstead};
        let local = store("store_localvault1")?;
        let other = store("store_othervault1")?;
        let identity = filer()?;
        let observations = || {
            vec![
                ProviderVaultObservation {
                    store_id: local.clone(),
                    identity: identity.clone(),
                    namespace_created: ProviderVaultTime::Unreported,
                    events: vec![ProviderVaultTime::Unreported],
                },
                ProviderVaultObservation {
                    store_id: other.clone(),
                    identity: identity.clone(),
                    namespace_created: ProviderVaultTime::Unreported,
                    events: vec![ProviderVaultTime::Unreported; 5],
                },
            ]
        };
        let identity_vaults = [local.clone()];
        let listed = |occupancy: LocalVaultOccupancy, password_vaults: &[StoreId]| {
            let listing = ProviderVaultListingRequest {
                observations: observations(),
                keys: ProviderVaultKeyholding {
                    identity_vaults: &identity_vaults,
                    password_vaults,
                    identity_in_use: true,
                    ..ProviderVaultKeyholding::NONE
                },
                names: BrowserNames::NONE,
                identity_logs: &[],
                local_vault: &occupancy,
            }
            .listing();
            let actions = listing
                .vaults
                .iter()
                .find(|vault| vault.store_id == other)
                .map(|vault| vault.actions.clone())
                .unwrap_or_default();
            (listing.replacement, actions)
        };
        let openable = [other.clone()];
        assert_eq!(
            listed(open(&local, 0, 1), &openable),
            (
                EmptyVaultReplacement::Offered {
                    empty_store_id: local.clone()
                },
                vec![UseInstead, ImportSeparately]
            )
        );
        // An open vault with records or another app merges instead.
        for occupancy in [open(&local, 3, 1), open(&local, 0, 2)] {
            assert_eq!(
                listed(occupancy, &openable),
                (
                    EmptyVaultReplacement::Unavailable,
                    vec![MergeIntoOpen, ImportSeparately]
                )
            );
        }
        assert_eq!(
            listed(LocalVaultOccupancy::Closed, &openable),
            (EmptyVaultReplacement::Unavailable, vec![ImportSeparately])
        );
        // A vault nothing here opens can only be requested, so it never
        // replaces the empty vault.
        assert_eq!(
            listed(open(&local, 0, 1), &[]),
            (EmptyVaultReplacement::Unavailable, vec![RequestAccess])
        );
        Ok(())
    }

    #[test]
    fn nothing_replaces_the_empty_vault_without_another_vault() -> anyhow::Result<()> {
        let local = store("store_localvault1")?;
        let identity_vaults = [local.clone()];
        let listing = ProviderVaultListingRequest {
            observations: vec![ProviderVaultObservation {
                store_id: local.clone(),
                identity: filer()?,
                namespace_created: ProviderVaultTime::Unreported,
                events: vec![],
            }],
            keys: ProviderVaultKeyholding {
                identity_vaults: &identity_vaults,
                ..ProviderVaultKeyholding::NONE
            },
            names: BrowserNames::NONE,
            identity_logs: &[],
            local_vault: &open(&local, 0, 1),
        }
        .listing();
        assert_eq!(listing.replacement, EmptyVaultReplacement::Unavailable);
        Ok(())
    }

    #[test]
    fn a_vault_this_browser_keeps_a_name_for_is_listed_by_it() -> anyhow::Result<()> {
        let own = store("store_ownvault001")?;
        let other = store("store_othervault1")?;
        let blank = store("store_blankname01")?;
        let names = [
            KnownVaultName {
                store_id: own.clone(),
                name: "  Family  ".to_owned(),
            },
            KnownVaultName {
                store_id: blank.clone(),
                name: "   ".to_owned(),
            },
        ];
        let identity = filer()?;
        let observation = |store_id: &StoreId| ProviderVaultObservation {
            store_id: store_id.clone(),
            identity: identity.clone(),
            namespace_created: ProviderVaultTime::Unreported,
            events: vec![],
        };
        let listing = ProviderVaultListingRequest {
            observations: vec![observation(&own), observation(&other), observation(&blank)],
            keys: ProviderVaultKeyholding::NONE,
            names: BrowserNames {
                vaults: &names,
                identities: &[],
            },
            identity_logs: &[],
            local_vault: &LocalVaultOccupancy::Closed,
        }
        .listing();
        let name_of = |store_id: &StoreId| {
            listing
                .vaults
                .iter()
                .find(|vault| &vault.store_id == store_id)
                .map(|vault| vault.name.clone())
        };
        assert_eq!(
            name_of(&own),
            Some(ProviderVaultName::Named {
                name: "Family".to_owned()
            })
        );
        // Another identity's vault keeps its name sealed; a blank name is none.
        assert_eq!(name_of(&other), Some(ProviderVaultName::Unknown));
        assert_eq!(name_of(&blank), Some(ProviderVaultName::Unknown));
        Ok(())
    }

    #[test]
    fn each_vault_names_the_identity_whose_folder_files_it() -> anyhow::Result<()> {
        let mine = IdentityId::parse("idn_personalide")?;
        let theirs = IdentityId::parse("idn_strangerabc")?;
        let identities = [KnownIdentityName {
            identity_id: mine.clone(),
            name: " Personal ".to_owned(),
        }];
        // Only the stranger's control log was read from the provider.
        let theirs_facts = ProviderIdentityLog::Read {
            devices: ProviderLogCount::from(2),
            newest_device: at("2026-10-27T17:28:00Z")?,
            vaults: ProviderLogCount::from(1),
            this_browser: false,
        };
        let theirs_log = [ListedIdentityLog {
            identity_id: theirs.clone(),
            log: theirs_facts,
        }];
        let observation = |identity: &IdentityId, token: &str| -> anyhow::Result<_> {
            Ok(ProviderVaultObservation {
                store_id: store(token)?,
                identity: identity.clone(),
                namespace_created: ProviderVaultTime::Unreported,
                events: vec![],
            })
        };
        let listing = ProviderVaultListingRequest {
            observations: vec![
                observation(&mine, "store_ownvault001")?,
                observation(&theirs, "store_othervault1")?,
            ],
            keys: ProviderVaultKeyholding::NONE,
            names: BrowserNames {
                vaults: &[],
                identities: &identities,
            },
            identity_logs: &theirs_log,
            local_vault: &LocalVaultOccupancy::Closed,
        }
        .listing();
        let identity_of = |token: &str| {
            listing
                .vaults
                .iter()
                .find(|vault| vault.store_id.as_str() == token)
                .map(|vault| vault.identity.clone())
        };
        assert_eq!(
            identity_of("store_ownvault001"),
            Some(FilingIdentity {
                words: IdentityWords::of(&mine),
                log: ProviderIdentityLog::Absent,
                identity_id: mine,
                short_id: "personal".to_owned(),
                name: ProviderVaultName::Named {
                    name: "Personal".to_owned()
                },
            })
        );
        // An identity this browser does not hold is told apart by its id.
        assert_eq!(
            identity_of("store_othervault1"),
            Some(FilingIdentity {
                words: IdentityWords::of(&theirs),
                log: theirs_facts,
                identity_id: theirs,
                short_id: "stranger".to_owned(),
                name: ProviderVaultName::Unknown,
            })
        );
        Ok(())
    }

    #[test]
    fn listings_cross_the_web_boundary_as_tagged_values() -> anyhow::Result<()> {
        let json = serde_json::to_value(ProviderVaultListing {
            vaults: vec![ProviderVaultSummary {
                store_id: store("store_abcdefghijk")?,
                short_id: "abcdefgh".to_owned(),
                name: ProviderVaultName::Named {
                    name: "Family".to_owned(),
                },
                identity: FilingIdentity {
                    identity_id: filer()?,
                    short_id: "filerfil".to_owned(),
                    name: ProviderVaultName::Named {
                        name: "Personal".to_owned(),
                    },
                    words: IdentityWords::of(&filer()?),
                    log: ProviderIdentityLog::Read {
                        devices: ProviderLogCount::from(2),
                        newest_device: ProviderVaultTime::Reported {
                            at: ProviderInstant(7),
                        },
                        vaults: ProviderLogCount::from(3),
                        this_browser: false,
                    },
                },
                created: ProviderVaultTime::Unreported,
                last_activity: ProviderVaultTime::Reported {
                    at: ProviderInstant(5),
                },
                event_count: ProviderEventCount(1),
                access: ProviderVaultAccess::Syncs,
                actions: Vec::new(),
            }],
            replacement: EmptyVaultReplacement::Unavailable,
        })?;
        assert_eq!(
            json,
            serde_json::json!({
                "vaults": [{
                    "storeId": "store_abcdefghijk",
                    "shortId": "abcdefgh",
                    "name": { "state": "named", "name": "Family" },
                    "identity": {
                        "identityId": "idn_filerfilerf",
                        "shortId": "filerfil",
                        "name": { "state": "named", "name": "Personal" },
                        "words": IdentityWords::of(&filer()?).words(),
                        "log": {
                            "state": "read",
                            "devices": 2,
                            "newestDevice": { "state": "reported", "at": 7 },
                            "vaults": 3,
                            "thisBrowser": false,
                        },
                    },
                    "created": { "state": "unreported" },
                    "lastActivity": { "state": "reported", "at": 5 },
                    "eventCount": 1,
                    "access": { "state": "syncs" },
                    "actions": [],
                }],
                "replacement": { "state": "unavailable" },
            })
        );
        let occupancy: LocalVaultOccupancy = serde_json::from_value(serde_json::json!({
            "state": "open",
            "storeId": "store_abcdefghijk",
            "itemCount": 0,
            "identityAppCount": 1,
        }))?;
        assert_eq!(occupancy, open(&store("store_abcdefghijk")?, 0, 1));
        Ok(())
    }
}
