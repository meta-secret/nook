//! What a sync provider already holds, summarized without decrypting it.
//!
//! A provider keeps one Nook root per account. Inside it, the identity log
//! and every vault live in their own namespace subdirectory, so the events
//! of different vaults never share a folder and vaults coexist safely. A
//! listing summarizes each vault namespace from transport metadata alone:
//! when its files were created, how many event files it holds, and a short
//! id. It then relates each vault to the identity on this device. Plaintext
//! vault names stay inside the encrypted vault and appear only after unlock.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use std::cmp::Ordering;

use crate::StoreId;
use crate::errors::{ValidationError, ValidationResult};
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use tsify::Tsify;

/// The fixed name of the one app-owned Nook root each provider account holds.
pub const NOOK_PROVIDER_ROOT_NAME: &str = "Nook";

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
    /// When the namespace subdirectory was created, where reported.
    pub namespace_created: ProviderVaultTime,
    /// One entry per event file in the namespace.
    pub events: Vec<ProviderVaultTime>,
}

/// How a listed vault relates to the identity on this device.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum ProviderVaultRelation {
    /// The local identity holds this vault: it simply syncs.
    ThisIdentity,
    /// Another identity's vault: it can only be imported as a separate vault.
    Other,
}

/// One vault a provider holds, as far as its listing tells without
/// decryption.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ProviderVaultSummary {
    pub store_id: StoreId,
    /// The first characters of the store token, to tell vaults apart.
    pub short_id: String,
    pub created: ProviderVaultTime,
    pub last_activity: ProviderVaultTime,
    #[tsify(type = "number")]
    pub event_count: ProviderEventCount,
    pub relation: ProviderVaultRelation,
}

impl ProviderVaultSummary {
    fn short_id(store_id: &StoreId) -> String {
        let raw = store_id.as_str();
        raw.strip_prefix("store_")
            .unwrap_or(raw)
            .chars()
            .take(SHORT_ID_LENGTH)
            .collect()
    }

    fn summarize(observation: ProviderVaultObservation, relation: ProviderVaultRelation) -> Self {
        let ProviderVaultObservation {
            store_id,
            namespace_created,
            events,
        } = observation;
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
            store_id,
            created: ProviderVaultTime::from_instant(created),
            last_activity: ProviderVaultTime::from_instant(last_activity),
            event_count: ProviderEventCount::of(events.len()),
            relation,
        }
    }

    /// This identity's vaults first, then the most recently active.
    fn listing_order(&self, other: &Self) -> Ordering {
        let relation_rank = |relation: ProviderVaultRelation| match relation {
            ProviderVaultRelation::ThisIdentity => 0,
            ProviderVaultRelation::Other => 1,
        };
        relation_rank(self.relation)
            .cmp(&relation_rank(other.relation))
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

/// The transport's observations and this device's identity and open vault.
pub struct ProviderVaultListingRequest<'a> {
    pub observations: Vec<ProviderVaultObservation>,
    /// Vaults the local identity holds.
    pub identity_vaults: &'a [StoreId],
    pub local_vault: &'a LocalVaultOccupancy,
}

impl ProviderVaultListingRequest<'_> {
    /// Summarize and classify every listed vault. A vault with records is
    /// never merged into another: the provider's other vaults are offered
    /// for import beside it, and only an empty open vault may be replaced.
    #[must_use]
    pub fn listing(self) -> ProviderVaultListing {
        let Self {
            observations,
            identity_vaults,
            local_vault,
        } = self;
        let mut vaults = observations
            .into_iter()
            .map(|observation| {
                let relation = if identity_vaults.contains(&observation.store_id) {
                    ProviderVaultRelation::ThisIdentity
                } else {
                    ProviderVaultRelation::Other
                };
                ProviderVaultSummary::summarize(observation, relation)
            })
            .collect::<Vec<_>>();
        vaults.sort_by(ProviderVaultSummary::listing_order);
        let holds_other = vaults
            .iter()
            .any(|vault| vault.relation == ProviderVaultRelation::Other);
        let replacement = match local_vault.empty_store_id() {
            Some(empty_store_id) if holds_other => EmptyVaultReplacement::Offered {
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
    use std::slice;

    fn at(raw: &str) -> anyhow::Result<ProviderVaultTime> {
        Ok(ProviderVaultTime::Reported {
            at: ProviderInstant::parse_rfc3339(raw)?,
        })
    }

    fn store(token: &str) -> anyhow::Result<StoreId> {
        Ok(StoreId::parse(token)?)
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
                namespace_created: at("2024-01-02T00:00:00Z")?,
                events: vec![
                    at("2024-03-01T00:00:00Z")?,
                    at("2024-01-01T00:00:00Z")?,
                    ProviderVaultTime::Unreported,
                ],
            }],
            identity_vaults: &[],
            local_vault: &LocalVaultOccupancy::Closed,
        }
        .listing();
        assert_eq!(
            listing.vaults,
            [ProviderVaultSummary {
                store_id,
                short_id: "SMypl8K0".to_owned(),
                created: at("2024-01-01T00:00:00Z")?,
                last_activity: at("2024-03-01T00:00:00Z")?,
                event_count: ProviderEventCount(3),
                relation: ProviderVaultRelation::Other,
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
                namespace_created: ProviderVaultTime::Unreported,
                events: vec![ProviderVaultTime::Unreported; 2],
            }],
            identity_vaults: &[],
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
                namespace_created: at("2024-01-02T00:00:00Z")?,
                events: vec![],
            }],
            identity_vaults: &[],
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
    fn this_identitys_vaults_come_first_then_the_most_recent() -> anyhow::Result<()> {
        let own = store("store_ownvault001")?;
        let older = store("store_oldvault001")?;
        let newer = store("store_newvault001")?;
        let observation = |store_id: &StoreId, time: &str| -> anyhow::Result<_> {
            Ok(ProviderVaultObservation {
                store_id: store_id.clone(),
                namespace_created: ProviderVaultTime::Unreported,
                events: vec![at(time)?],
            })
        };
        let listing = ProviderVaultListingRequest {
            observations: vec![
                observation(&older, "2023-01-01T00:00:00Z")?,
                observation(&newer, "2025-01-01T00:00:00Z")?,
                observation(&own, "2020-01-01T00:00:00Z")?,
            ],
            identity_vaults: slice::from_ref(&own),
            local_vault: &LocalVaultOccupancy::Closed,
        }
        .listing();
        let ranked = listing
            .vaults
            .iter()
            .map(|vault| (vault.store_id.clone(), vault.relation))
            .collect::<Vec<_>>();
        assert_eq!(
            ranked,
            [
                (own, ProviderVaultRelation::ThisIdentity),
                (newer, ProviderVaultRelation::Other),
                (older, ProviderVaultRelation::Other),
            ]
        );
        Ok(())
    }

    #[test]
    fn only_an_empty_unshared_open_vault_may_give_way() -> anyhow::Result<()> {
        let local = store("store_localvault1")?;
        let other = store("store_othervault1")?;
        let observations = || {
            vec![
                ProviderVaultObservation {
                    store_id: local.clone(),
                    namespace_created: ProviderVaultTime::Unreported,
                    events: vec![ProviderVaultTime::Unreported],
                },
                ProviderVaultObservation {
                    store_id: other.clone(),
                    namespace_created: ProviderVaultTime::Unreported,
                    events: vec![ProviderVaultTime::Unreported; 5],
                },
            ]
        };
        let identity_vaults = [local.clone()];
        let replacement = |occupancy: LocalVaultOccupancy| {
            ProviderVaultListingRequest {
                observations: observations(),
                identity_vaults: &identity_vaults,
                local_vault: &occupancy,
            }
            .listing()
            .replacement
        };
        assert_eq!(
            replacement(open(&local, 0, 1)),
            EmptyVaultReplacement::Offered {
                empty_store_id: local.clone()
            }
        );
        // Records are never merged away; another app shares the vault.
        assert_eq!(
            replacement(open(&local, 3, 1)),
            EmptyVaultReplacement::Unavailable
        );
        assert_eq!(
            replacement(open(&local, 0, 2)),
            EmptyVaultReplacement::Unavailable
        );
        assert_eq!(
            replacement(LocalVaultOccupancy::Closed),
            EmptyVaultReplacement::Unavailable
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
                namespace_created: ProviderVaultTime::Unreported,
                events: vec![],
            }],
            identity_vaults: &identity_vaults,
            local_vault: &open(&local, 0, 1),
        }
        .listing();
        assert_eq!(listing.replacement, EmptyVaultReplacement::Unavailable);
        Ok(())
    }

    #[test]
    fn listings_cross_the_web_boundary_as_tagged_values() -> anyhow::Result<()> {
        let json = serde_json::to_value(ProviderVaultListing {
            vaults: vec![ProviderVaultSummary {
                store_id: store("store_abcdefghijk")?,
                short_id: "abcdefgh".to_owned(),
                created: ProviderVaultTime::Unreported,
                last_activity: ProviderVaultTime::Reported {
                    at: ProviderInstant(5),
                },
                event_count: ProviderEventCount(1),
                relation: ProviderVaultRelation::ThisIdentity,
            }],
            replacement: EmptyVaultReplacement::Unavailable,
        })?;
        assert_eq!(
            json,
            serde_json::json!({
                "vaults": [{
                    "storeId": "store_abcdefghijk",
                    "shortId": "abcdefgh",
                    "created": { "state": "unreported" },
                    "lastActivity": { "state": "reported", "at": 5 },
                    "eventCount": 1,
                    "relation": "thisIdentity",
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
