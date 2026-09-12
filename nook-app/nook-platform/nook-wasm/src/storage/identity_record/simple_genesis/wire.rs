//! Admission of existing genesis marker layouts into the canonical lifecycle.
//! Parser-local accumulators describe incoming property omission only. No optional
//! fields survive admission, and stored field names and conflict diagnostics stay fixed.
use super::super::staged_genesis::StagedSimpleGenesisIdentity;
use super::{PendingSimpleGenesis, PendingSimpleGenesisEvent, PendingSimpleGenesisFlow};
use nook_core::{AgeArmoredCiphertext, IsoTimestamp};
use serde::de::{Error, IgnoredAny, MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use std::{collections::HashSet, fmt};

enum GenesisEventInput {
    Unspecified,
    Current(PendingSimpleGenesisEvent),
}
impl<'de> Deserialize<'de> for GenesisEventInput {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_option(Self::Unspecified)
    }
}
impl<'de> Visitor<'de> for GenesisEventInput {
    type Value = Self;
    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("option")
    }
    fn visit_none<E: Error>(self) -> Result<Self, E> {
        Ok(Self::Unspecified)
    }
    fn visit_unit<E: Error>(self) -> Result<Self, E> {
        Ok(Self::Unspecified)
    }
    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self, D::Error> {
        PendingSimpleGenesisEvent::deserialize(deserializer).map(Self::Current)
    }
}

enum GenesisLegacyEventInput {
    Unspecified,
    Pinned(String),
}
impl<'de> Deserialize<'de> for GenesisLegacyEventInput {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_option(Self::Unspecified)
    }
}
impl<'de> Visitor<'de> for GenesisLegacyEventInput {
    type Value = Self;
    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("option")
    }
    fn visit_none<E: Error>(self) -> Result<Self, E> {
        Ok(Self::Unspecified)
    }
    fn visit_unit<E: Error>(self) -> Result<Self, E> {
        Ok(Self::Unspecified)
    }
    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer).map(Self::Pinned)
    }
}

enum GenesisFlowInput {
    Unspecified,
    Current(PendingSimpleGenesisFlow),
}
impl<'de> Deserialize<'de> for GenesisFlowInput {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_option(Self::Unspecified)
    }
}
impl<'de> Visitor<'de> for GenesisFlowInput {
    type Value = Self;
    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("option")
    }
    fn visit_none<E: Error>(self) -> Result<Self, E> {
        Ok(Self::Unspecified)
    }
    fn visit_unit<E: Error>(self) -> Result<Self, E> {
        Ok(Self::Unspecified)
    }
    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self, D::Error> {
        PendingSimpleGenesisFlow::deserialize(deserializer).map(Self::Current)
    }
}

enum GenesisStagedInput {
    Unspecified,
    Staged(StagedSimpleGenesisIdentity),
}
impl<'de> Deserialize<'de> for GenesisStagedInput {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_option(Self::Unspecified)
    }
}
impl<'de> Visitor<'de> for GenesisStagedInput {
    type Value = Self;
    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("option")
    }
    fn visit_none<E: Error>(self) -> Result<Self, E> {
        Ok(Self::Unspecified)
    }
    fn visit_unit<E: Error>(self) -> Result<Self, E> {
        Ok(Self::Unspecified)
    }
    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self, D::Error> {
        StagedSimpleGenesisIdentity::deserialize(deserializer).map(Self::Staged)
    }
}

enum GenesisEnvelopeInput {
    Unspecified,
    Sealed(AgeArmoredCiphertext),
}
impl<'de> Deserialize<'de> for GenesisEnvelopeInput {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_option(Self::Unspecified)
    }
}
impl<'de> Visitor<'de> for GenesisEnvelopeInput {
    type Value = Self;
    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("option")
    }
    fn visit_none<E: Error>(self) -> Result<Self, E> {
        Ok(Self::Unspecified)
    }
    fn visit_unit<E: Error>(self) -> Result<Self, E> {
        Ok(Self::Unspecified)
    }
    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self, D::Error> {
        AgeArmoredCiphertext::deserialize(deserializer).map(Self::Sealed)
    }
}

enum GenesisSeedInput {
    Unspecified,
    Unsealed(String),
}
impl<'de> Deserialize<'de> for GenesisSeedInput {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_option(Self::Unspecified)
    }
}
impl<'de> Visitor<'de> for GenesisSeedInput {
    type Value = Self;
    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("option")
    }
    fn visit_none<E: Error>(self) -> Result<Self, E> {
        Ok(Self::Unspecified)
    }
    fn visit_unit<E: Error>(self) -> Result<Self, E> {
        Ok(Self::Unspecified)
    }
    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer).map(Self::Unsealed)
    }
}

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
        let mut store_id = Err(A::Error::missing_field("storeId"));
        let mut identity_id = Err(A::Error::missing_field("identityId"));
        let mut created_at = IsoTimestamp::from_trusted("1970-01-01T00:00:00.000Z".to_owned());
        let mut event_state = GenesisEventInput::Unspecified;
        let mut event_yaml = GenesisLegacyEventInput::Unspecified;
        let mut flow = GenesisFlowInput::Unspecified;
        let mut staged_identity = GenesisStagedInput::Unspecified;
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
                "storeId" => store_id = Ok(map.next_value()?),
                "identityId" => identity_id = Ok(map.next_value()?),
                "createdAt" => created_at = map.next_value()?,
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
            (GenesisEventInput::Current(event), GenesisLegacyEventInput::Unspecified) => event,
            (GenesisEventInput::Unspecified, GenesisLegacyEventInput::Pinned(event_yaml)) => {
                PendingSimpleGenesisEvent::LegacyEventPinned { event_yaml }
            }
            (GenesisEventInput::Unspecified, GenesisLegacyEventInput::Unspecified) => {
                PendingSimpleGenesisEvent::AwaitingEvent
            }
            (GenesisEventInput::Current(_), GenesisLegacyEventInput::Pinned(_)) => {
                return Err(A::Error::custom(
                    "pending Simple genesis has both current and legacy event state",
                ));
            }
        };
        let flow = match (flow, staged_identity) {
            (GenesisFlowInput::Current(flow), GenesisStagedInput::Unspecified) => flow,
            (GenesisFlowInput::Unspecified, GenesisStagedInput::Staged(staged)) => {
                PendingSimpleGenesisFlow::Staged(staged)
            }
            (GenesisFlowInput::Unspecified, GenesisStagedInput::Unspecified) => {
                PendingSimpleGenesisFlow::Ordinary
            }
            (
                GenesisFlowInput::Current(PendingSimpleGenesisFlow::Staged(current)),
                GenesisStagedInput::Staged(legacy),
            ) if current == legacy => PendingSimpleGenesisFlow::Staged(current),
            (GenesisFlowInput::Current(_), GenesisStagedInput::Staged(_)) => {
                return Err(A::Error::custom(
                    "pending Simple genesis has both current and legacy flow state",
                ));
            }
        };
        Ok(PendingSimpleGenesis {
            store_id: store_id?,
            identity_id: identity_id?,
            created_at,
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
        let mut signing_seed_envelope = GenesisEnvelopeInput::Unspecified;
        let mut signing_seed = GenesisSeedInput::Unspecified;
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
            (GenesisEnvelopeInput::Unspecified, GenesisSeedInput::Unspecified) => {
                Ok(GenesisSigningMaterial::LegacyEventOnly)
            }
            (GenesisEnvelopeInput::Unspecified, GenesisSeedInput::Unsealed(unsealed_seed)) => {
                Ok(GenesisSigningMaterial::LegacyUnsealed(unsealed_seed))
            }
            (GenesisEnvelopeInput::Sealed(envelope), GenesisSeedInput::Unspecified) => {
                Ok(GenesisSigningMaterial::Sealed(SealedGenesisSigner {
                    envelope,
                    members: member_signing_seed_envelopes,
                }))
            }
            (GenesisEnvelopeInput::Sealed(_), GenesisSeedInput::Unsealed(_)) => {
                Err(A::Error::custom(
                    "pending Simple genesis has both sealed and unsealed signing seeds",
                ))
            }
        }
    }
}
