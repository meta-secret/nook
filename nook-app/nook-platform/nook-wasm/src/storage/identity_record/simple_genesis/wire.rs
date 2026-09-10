//! Admission of existing genesis marker layouts into the canonical lifecycle.
//! Parser-local accumulators describe incoming property omission only. No optional
//! fields survive admission, and stored field names and conflict diagnostics stay fixed.
use super::{PendingSimpleGenesis, PendingSimpleGenesisEvent, PendingSimpleGenesisFlow};
use nook_core::IsoTimestamp;
use serde::de::{Error, IgnoredAny, MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use std::{collections::HashSet, fmt};

struct GenesisMarkerAdmission;
struct GenesisSigningAdmission;

impl<'de> Deserialize<'de> for PendingSimpleGenesis {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(GenesisMarkerAdmission)
    }
}
impl<'de> Visitor<'de> for GenesisMarkerAdmission {
    type Value = PendingSimpleGenesis;
    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a pending Simple genesis marker")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut seen = HashSet::new();
        let mut store_id = None;
        let mut identity_id = None;
        let mut created_at = None;
        let mut event_state = None;
        let mut event_yaml = None;
        let mut flow = None;
        let mut staged_identity = None;
        while let Some(key) = map.next_key::<String>()? {
            if matches!(
                key.as_str(),
                "storeId"
                    | "identityId"
                    | "createdAt"
                    | "eventState"
                    | "eventYaml"
                    | "flow"
                    | "stagedIdentity"
            ) && !seen.insert(key.clone())
            {
                return Err(A::Error::custom(format!("duplicate field `{key}`")));
            }
            match key.as_str() {
                "storeId" => store_id = Some(map.next_value()?),
                "identityId" => identity_id = Some(map.next_value()?),
                "createdAt" => created_at = Some(map.next_value()?),
                "eventState" => event_state = map.next_value()?,
                "eventYaml" => event_yaml = map.next_value()?,
                "flow" => flow = map.next_value()?,
                "stagedIdentity" => staged_identity = map.next_value()?,
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        let event_state = match (event_state, event_yaml) {
            (Some(event), None) => event,
            (None, Some(event_yaml)) => PendingSimpleGenesisEvent::LegacyEventPinned { event_yaml },
            (None, None) => PendingSimpleGenesisEvent::AwaitingEvent,
            (Some(_), Some(_)) => {
                return Err(A::Error::custom(
                    "pending Simple genesis has both current and legacy event state",
                ));
            }
        };
        let flow = match (flow, staged_identity) {
            (Some(flow), None) => flow,
            (None, Some(staged)) => PendingSimpleGenesisFlow::Staged(staged),
            (None, None) => PendingSimpleGenesisFlow::Ordinary,
            (Some(PendingSimpleGenesisFlow::Staged(current)), Some(legacy))
                if current == legacy =>
            {
                PendingSimpleGenesisFlow::Staged(current)
            }
            (Some(_), Some(_)) => {
                return Err(A::Error::custom(
                    "pending Simple genesis has both current and legacy flow state",
                ));
            }
        };
        Ok(PendingSimpleGenesis {
            store_id: store_id.ok_or_else(|| A::Error::missing_field("storeId"))?,
            identity_id: identity_id.ok_or_else(|| A::Error::missing_field("identityId"))?,
            created_at: created_at.unwrap_or_else(|| {
                IsoTimestamp::from_trusted("1970-01-01T00:00:00.000Z".to_owned())
            }),
            event_state,
            flow,
        })
    }
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum GenesisEventWire {
    AwaitingEvent,
    LegacyEventPinned {
        #[serde(rename = "eventYaml")]
        event_yaml: String,
    },
    EventPinned {
        #[serde(rename = "eventYaml")]
        event_yaml: String,
        #[serde(flatten)]
        signing: GenesisSigningMaterial,
    },
}

enum GenesisSigningMaterial {
    LegacyEventOnly,
    LegacyUnsealed(String),
    Sealed(SealedGenesisSigner),
}
struct SealedGenesisSigner {
    envelope: nook_core::AgeArmoredCiphertext,
    members: Vec<nook_core::MemberDekEnvelope>,
}
impl<'de> Deserialize<'de> for PendingSimpleGenesisEvent {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(match GenesisEventWire::deserialize(deserializer)? {
            GenesisEventWire::AwaitingEvent => Self::AwaitingEvent,
            GenesisEventWire::LegacyEventPinned { event_yaml }
            | GenesisEventWire::EventPinned {
                event_yaml,
                signing: GenesisSigningMaterial::LegacyEventOnly,
            } => Self::LegacyEventPinned { event_yaml },
            GenesisEventWire::EventPinned {
                event_yaml,
                signing: GenesisSigningMaterial::LegacyUnsealed(signing_seed),
            } => Self::LegacyUnsealedEventPinned {
                event_yaml,
                signing_seed,
            },
            GenesisEventWire::EventPinned {
                event_yaml,
                signing: GenesisSigningMaterial::Sealed(signer),
            } => Self::EventPinned {
                event_yaml,
                signing_seed_envelope: signer.envelope,
                member_signing_seed_envelopes: signer.members,
            },
        })
    }
}
impl<'de> Deserialize<'de> for GenesisSigningMaterial {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(GenesisSigningAdmission)
    }
}
impl<'de> Visitor<'de> for GenesisSigningAdmission {
    type Value = GenesisSigningMaterial;
    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("existing genesis signing seed fields")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut seen = HashSet::new();
        let mut signing_seed_envelope = None;
        let mut signing_seed = None;
        let mut member_signing_seed_envelopes = Vec::new();
        while let Some(key) = map.next_key::<String>()? {
            if matches!(
                key.as_str(),
                "signingSeedEnvelope" | "signingSeed" | "memberSigningSeedEnvelopes"
            ) && !seen.insert(key.clone())
            {
                return Err(A::Error::custom(format!("duplicate field `{key}`")));
            }
            match key.as_str() {
                "signingSeedEnvelope" => signing_seed_envelope = map.next_value()?,
                "signingSeed" => signing_seed = map.next_value()?,
                "memberSigningSeedEnvelopes" => member_signing_seed_envelopes = map.next_value()?,
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        match (signing_seed_envelope, signing_seed) {
            (None, None) => Ok(GenesisSigningMaterial::LegacyEventOnly),
            (None, Some(seed)) => Ok(GenesisSigningMaterial::LegacyUnsealed(seed)),
            (Some(envelope), None) => Ok(GenesisSigningMaterial::Sealed(SealedGenesisSigner {
                envelope,
                members: member_signing_seed_envelopes,
            })),
            (Some(_), Some(_)) => Err(A::Error::custom(
                "pending Simple genesis has both sealed and unsealed signing seeds",
            )),
        }
    }
}
