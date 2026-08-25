//! Crash-safe Simple-vault genesis marker lifecycle.

use std::{cell::RefCell, rc::Rc};

use serde::{Deserialize, Deserializer, Serialize, de::Error as _};

use super::{
    ensure_local_identity_for_app_key, genesis_flow::PendingSimpleGenesisFlow,
    staged_genesis::StagedSimpleGenesisIdentity,
};
#[cfg(test)]
use crate::storage::indexed_db::idb_delete_key;
use crate::storage::indexed_db::{
    StringUpdateGuard, StringUpdateResult, idb_get_string, idb_update_string,
};
use crate::{NookError, conversion::wasm_iso_timestamp};

pub(crate) const PENDING_SIMPLE_GENESIS_KEY: &str = "pending_simple_genesis_v1";

#[derive(Clone, Debug)]
pub(crate) struct PendingSimpleGenesis {
    pub(crate) store_id: nook_core::StoreId,
    pub(crate) identity_id: nook_core::IdentityId,
    pub(crate) created_at: nook_core::IsoTimestamp,
    pub(crate) event_state: PendingSimpleGenesisEvent,
    pub(crate) flow: PendingSimpleGenesisFlow,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum PendingSimpleGenesisEvent {
    AwaitingEvent,
    LegacyEventPinned {
        #[serde(rename = "eventYaml")]
        event_yaml: String,
    },
    EventPinned {
        #[serde(rename = "eventYaml")]
        event_yaml: String,
        #[serde(rename = "signingSeedEnvelope")]
        signing_seed_envelope: nook_core::AgeArmoredCiphertext,
        #[serde(default, rename = "memberSigningSeedEnvelopes")]
        member_signing_seed_envelopes: Vec<nook_core::MemberDekEnvelope>,
    },
    #[serde(skip_serializing)]
    LegacyUnsealedEventPinned {
        event_yaml: String,
        signing_seed: String,
    },
}

#[derive(Clone, Debug)]
pub(crate) struct PinnedSimpleGenesisEvent {
    pub(crate) event_yaml: String,
    pub(crate) signing_seed: String,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum PendingSimpleGenesisEventWire {
    AwaitingEvent,
    LegacyEventPinned {
        #[serde(rename = "eventYaml")]
        event_yaml: String,
    },
    EventPinned {
        #[serde(rename = "eventYaml")]
        event_yaml: String,
        #[serde(default, rename = "signingSeedEnvelope")]
        signing_seed_envelope: Option<nook_core::AgeArmoredCiphertext>,
        #[serde(default, rename = "signingSeed")]
        signing_seed: Option<String>,
        #[serde(default, rename = "memberSigningSeedEnvelopes")]
        member_signing_seed_envelopes: Vec<nook_core::MemberDekEnvelope>,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingSimpleGenesisWire {
    store_id: nook_core::StoreId,
    identity_id: nook_core::IdentityId,
    #[serde(default = "legacy_simple_genesis_timestamp")]
    created_at: nook_core::IsoTimestamp,
    #[serde(default)]
    event_state: Option<PendingSimpleGenesisEventWire>,
    #[serde(default)]
    event_yaml: Option<String>,
    #[serde(default)]
    flow: Option<PendingSimpleGenesisFlow>,
    #[serde(default)]
    staged_identity: Option<StagedSimpleGenesisIdentity>,
}

impl<'de> Deserialize<'de> for PendingSimpleGenesis {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = PendingSimpleGenesisWire::deserialize(deserializer)?;
        let event_state = match (wire.event_state, wire.event_yaml) {
            (Some(PendingSimpleGenesisEventWire::AwaitingEvent), None) => {
                PendingSimpleGenesisEvent::AwaitingEvent
            }
            (
                Some(
                    PendingSimpleGenesisEventWire::LegacyEventPinned { event_yaml }
                    | PendingSimpleGenesisEventWire::EventPinned {
                        event_yaml,
                        signing_seed_envelope: None,
                        signing_seed: None,
                        ..
                    },
                ),
                None,
            )
            | (None, Some(event_yaml)) => {
                PendingSimpleGenesisEvent::LegacyEventPinned { event_yaml }
            }
            (
                Some(PendingSimpleGenesisEventWire::EventPinned {
                    event_yaml,
                    signing_seed_envelope: None,
                    signing_seed: Some(signing_seed),
                    ..
                }),
                None,
            ) => PendingSimpleGenesisEvent::LegacyUnsealedEventPinned {
                event_yaml,
                signing_seed,
            },
            (
                Some(PendingSimpleGenesisEventWire::EventPinned {
                    event_yaml,
                    signing_seed_envelope: Some(signing_seed_envelope),
                    signing_seed: None,
                    member_signing_seed_envelopes,
                }),
                None,
            ) => PendingSimpleGenesisEvent::EventPinned {
                event_yaml,
                signing_seed_envelope,
                member_signing_seed_envelopes,
            },
            (
                Some(PendingSimpleGenesisEventWire::EventPinned {
                    signing_seed_envelope: Some(_),
                    signing_seed: Some(_),
                    ..
                }),
                None,
            ) => {
                return Err(D::Error::custom(
                    "pending Simple genesis has both sealed and unsealed signing seeds",
                ));
            }
            (None, None) => PendingSimpleGenesisEvent::AwaitingEvent,
            (Some(_), Some(_)) => {
                return Err(D::Error::custom(
                    "pending Simple genesis has both current and legacy event state",
                ));
            }
        };
        let flow = match (wire.flow, wire.staged_identity) {
            (Some(flow), None) => flow,
            (None, Some(staged)) => PendingSimpleGenesisFlow::Staged(staged),
            (None, None) => PendingSimpleGenesisFlow::Ordinary,
            (Some(PendingSimpleGenesisFlow::Staged(current)), Some(legacy))
                if current == legacy =>
            {
                PendingSimpleGenesisFlow::Staged(current)
            }
            (Some(_), Some(_)) => {
                return Err(D::Error::custom(
                    "pending Simple genesis has both current and legacy flow state",
                ));
            }
        };
        Ok(Self {
            store_id: wire.store_id,
            identity_id: wire.identity_id,
            created_at: wire.created_at,
            event_state,
            flow,
        })
    }
}

impl PendingSimpleGenesis {
    pub(crate) fn staged_identity(&self) -> Option<&StagedSimpleGenesisIdentity> {
        match &self.flow {
            PendingSimpleGenesisFlow::Ordinary => None,
            PendingSimpleGenesisFlow::Staged(identity) => Some(identity),
        }
    }

    pub(crate) fn is_staged(&self) -> bool {
        matches!(self.flow, PendingSimpleGenesisFlow::Staged(_))
    }

    #[cfg(test)]
    fn event_yaml(&self) -> Option<&str> {
        match &self.event_state {
            PendingSimpleGenesisEvent::AwaitingEvent => None,
            PendingSimpleGenesisEvent::LegacyEventPinned { event_yaml }
            | PendingSimpleGenesisEvent::EventPinned { event_yaml, .. }
            | PendingSimpleGenesisEvent::LegacyUnsealedEventPinned { event_yaml, .. } => {
                Some(event_yaml)
            }
        }
    }
}

fn legacy_simple_genesis_timestamp() -> nook_core::IsoTimestamp {
    nook_core::IsoTimestamp::from_trusted("1970-01-01T00:00:00.000Z".to_owned())
}

pub(super) fn decode_pending_simple_genesis(raw: &str) -> Result<PendingSimpleGenesis, NookError> {
    serde_json::from_str(raw).map_err(|error| {
        NookError::IndexedDb(format!("Pending Simple genesis decode error: {error}"))
    })
}

pub(super) fn encode_pending_simple_genesis(
    pending: &PendingSimpleGenesis,
) -> Result<String, NookError> {
    serde_json::to_string(pending).map_err(|error| {
        NookError::IndexedDb(format!("Pending Simple genesis encode error: {error}"))
    })
}

fn seal_legacy_signing_seed(
    pending: &mut PendingSimpleGenesis,
    app_key: &nook_core::AppKey,
) -> Result<(), NookError> {
    let PendingSimpleGenesisEvent::LegacyUnsealedEventPinned {
        event_yaml,
        signing_seed,
    } = &pending.event_state
    else {
        return Ok(());
    };
    validate_genesis_signing_seed(event_yaml, signing_seed)?;
    let signing_seed_envelope = app_key
        .seal_utf8(signing_seed)
        .map_err(|error| NookError::Database(error.to_string()))?;
    pending.event_state = PendingSimpleGenesisEvent::EventPinned {
        event_yaml: event_yaml.clone(),
        signing_seed_envelope,
        member_signing_seed_envelopes: Vec::new(),
    };
    Ok(())
}

pub(crate) async fn begin_or_resume_simple_genesis(
    app_key: &nook_core::AppKey,
    label: &str,
) -> Result<PendingSimpleGenesis, NookError> {
    if idb_get_string(PENDING_SIMPLE_GENESIS_KEY).await?.is_some() {
        let selected = Rc::new(RefCell::new(None));
        let captured = Rc::clone(&selected);
        idb_update_string(
            PENDING_SIMPLE_GENESIS_KEY,
            StringUpdateGuard::Unconditional,
            move |current| {
                let raw = current.ok_or_else(|| {
                    NookError::IndexedDb("Pending Simple genesis marker disappeared.".to_owned())
                })?;
                let mut pending = decode_pending_simple_genesis(&raw)?;
                seal_legacy_signing_seed(&mut pending, app_key)?;
                let encoded = encode_pending_simple_genesis(&pending)?;
                *captured.borrow_mut() = Some(pending);
                Ok(encoded)
            },
        )
        .await?;
        return selected.borrow_mut().take().ok_or_else(|| {
            NookError::IndexedDb("Pending Simple genesis produced no result.".to_owned())
        });
    }
    let identity = ensure_local_identity_for_app_key(app_key, label).await?;
    let proposed = PendingSimpleGenesis {
        store_id: nook_core::generate_store_id()
            .map_err(|error| NookError::Database(error.to_string()))?,
        identity_id: identity.identity_id,
        created_at: nook_core::IsoTimestamp::parse(&wasm_iso_timestamp())
            .map_err(|error| NookError::Database(error.to_string()))?,
        event_state: PendingSimpleGenesisEvent::AwaitingEvent,
        flow: PendingSimpleGenesisFlow::Ordinary,
    };
    let selected = Rc::new(RefCell::new(None));
    let captured = Rc::clone(&selected);
    idb_update_string(
        PENDING_SIMPLE_GENESIS_KEY,
        StringUpdateGuard::Unconditional,
        move |current| {
            let pending = current
                .as_deref()
                .map(decode_pending_simple_genesis)
                .transpose()?
                .unwrap_or(proposed);
            let encoded = encode_pending_simple_genesis(&pending)?;
            *captured.borrow_mut() = Some(pending);
            Ok(encoded)
        },
    )
    .await?;
    selected.borrow_mut().take().ok_or_else(|| {
        NookError::IndexedDb("Pending Simple genesis produced no result.".to_owned())
    })
}

fn staged_signing_seed_envelopes(
    pending: &PendingSimpleGenesis,
    signing_seed: &str,
) -> Result<Vec<nook_core::MemberDekEnvelope>, NookError> {
    pending
        .staged_identity()
        .and_then(|staged| {
            staged
                .directory
                .identities()
                .iter()
                .find(|identity| identity.identity_id == pending.identity_id)
        })
        .map(|identity| {
            identity
                .members
                .iter()
                .map(|member| {
                    Ok(nook_core::MemberDekEnvelope {
                        app_id: member.app_id.clone(),
                        envelope: nook_core::encrypt_for_recipient(
                            signing_seed.as_bytes(),
                            &member.public_key,
                        )?,
                    })
                })
                .collect::<Result<Vec<_>, nook_core::MultiDeviceError>>()
        })
        .transpose()
        .map_err(|error| NookError::Database(error.to_string()))
        .map(Option::unwrap_or_default)
}

/// Pin the first complete signed Simple genesis event before any event-log write.
pub(crate) async fn persist_simple_genesis_event(
    pending: &PendingSimpleGenesis,
    app_key: &nook_core::AppKey,
    proposed_yaml: String,
    proposed_signing_seed: String,
) -> Result<PinnedSimpleGenesisEvent, NookError> {
    let proposed_signing_seed_envelope = app_key
        .seal_utf8(&proposed_signing_seed)
        .map_err(|error| NookError::Database(error.to_string()))?;
    let proposed_member_signing_seed_envelopes =
        staged_signing_seed_envelopes(pending, &proposed_signing_seed)?;
    let app_key = app_key.clone();
    let expected = pending.clone();
    let selected = Rc::new(RefCell::new(None));
    let captured = Rc::clone(&selected);
    let disposition = idb_update_string(
        PENDING_SIMPLE_GENESIS_KEY,
        StringUpdateGuard::Unconditional,
        move |raw| {
            let raw = raw.ok_or_else(|| {
                NookError::IndexedDb("Pending Simple genesis marker disappeared.".to_owned())
            })?;
            let mut current = decode_pending_simple_genesis(&raw)?;
            if current.store_id != expected.store_id
                || current.identity_id != expected.identity_id
                || current.created_at != expected.created_at
            {
                return Err(NookError::IndexedDb(
                    "Pending Simple genesis marker changed during event creation.".to_owned(),
                ));
            }
            let pinned = match current.event_state.clone() {
                PendingSimpleGenesisEvent::AwaitingEvent => {
                    current.event_state = PendingSimpleGenesisEvent::EventPinned {
                        event_yaml: proposed_yaml.clone(),
                        signing_seed_envelope: proposed_signing_seed_envelope.clone(),
                        member_signing_seed_envelopes: proposed_member_signing_seed_envelopes
                            .clone(),
                    };
                    PinnedSimpleGenesisEvent {
                        event_yaml: proposed_yaml.clone(),
                        signing_seed: proposed_signing_seed.clone(),
                    }
                }
                PendingSimpleGenesisEvent::LegacyEventPinned { event_yaml } => {
                    validate_genesis_signing_seed(&event_yaml, &proposed_signing_seed)?;
                    current.event_state = PendingSimpleGenesisEvent::EventPinned {
                        event_yaml: event_yaml.clone(),
                        signing_seed_envelope: proposed_signing_seed_envelope.clone(),
                        member_signing_seed_envelopes: proposed_member_signing_seed_envelopes
                            .clone(),
                    };
                    PinnedSimpleGenesisEvent {
                        event_yaml: event_yaml.clone(),
                        signing_seed: proposed_signing_seed.clone(),
                    }
                }
                PendingSimpleGenesisEvent::EventPinned {
                    event_yaml,
                    signing_seed_envelope,
                    member_signing_seed_envelopes,
                } => PinnedSimpleGenesisEvent {
                    event_yaml,
                    signing_seed: member_signing_seed_envelopes
                        .iter()
                        .find(|entry| entry.app_id == *app_key.app_id())
                        .map_or_else(
                            || app_key.open_utf8(&signing_seed_envelope),
                            |entry| app_key.open_utf8(&entry.envelope),
                        )
                        .map_err(|error| NookError::Database(error.to_string()))?,
                },
                PendingSimpleGenesisEvent::LegacyUnsealedEventPinned { .. } => {
                    return Err(NookError::IndexedDb(
                        "Pending Simple genesis retained an unsealed signing seed.".to_owned(),
                    ));
                }
            };
            *captured.borrow_mut() = Some(pinned);
            encode_pending_simple_genesis(&current)
        },
    )
    .await?;
    if disposition != StringUpdateResult::Applied {
        return Err(NookError::IndexedDb(
            "Pending Simple genesis event update was rejected.".to_owned(),
        ));
    }
    selected.borrow_mut().take().ok_or_else(|| {
        NookError::IndexedDb("Pending Simple genesis event produced no result.".to_owned())
    })
}

pub(crate) fn resume_staged_simple_genesis_signing_seed(
    pending: &PendingSimpleGenesis,
    app_key: &nook_core::AppKey,
) -> Result<Option<String>, NookError> {
    if !pending.is_staged() {
        return Ok(None);
    }
    let PendingSimpleGenesisEvent::EventPinned {
        signing_seed_envelope,
        member_signing_seed_envelopes,
        ..
    } = &pending.event_state
    else {
        return Ok(None);
    };
    member_signing_seed_envelopes
        .iter()
        .find(|entry| entry.app_id == *app_key.app_id())
        .map_or_else(
            || app_key.open_utf8(signing_seed_envelope),
            |entry| app_key.open_utf8(&entry.envelope),
        )
        .map(Some)
        .map_err(|error| NookError::Database(error.to_string()))
}

fn validate_genesis_signing_seed(event_yaml: &str, signing_seed: &str) -> Result<(), NookError> {
    let event = nook_core::parse_event_storage_bytes(event_yaml.as_bytes())?;
    let signing = nook_core::SigningIdentity::from_seed_hex_stored(signing_seed)?;
    if event.body.actor_signing_public_key != signing.public_key() {
        return Err(NookError::Database(
            "Pinned Simple genesis event does not match the stored signing seed.".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) async fn pending_simple_genesis_for_store(
    store_id: &str,
) -> Result<Option<PendingSimpleGenesis>, NookError> {
    if store_id.is_empty() {
        return Ok(None);
    }
    let store_id = nook_core::StoreId::parse(store_id)
        .map_err(|error| NookError::Database(error.to_string()))?;
    let Some(pending) = pending_simple_genesis().await? else {
        return Ok(None);
    };
    Ok((pending.store_id == store_id).then_some(pending))
}

pub(crate) async fn pending_simple_genesis() -> Result<Option<PendingSimpleGenesis>, NookError> {
    idb_get_string(PENDING_SIMPLE_GENESIS_KEY)
        .await?
        .map(|raw| decode_pending_simple_genesis(&raw))
        .transpose()
}

#[cfg(test)]
pub(super) async fn clear_pending_simple_genesis_for_test() -> Result<(), NookError> {
    idb_delete_key(PENDING_SIMPLE_GENESIS_KEY).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::identity_record::{
        SimpleGenesisCompletion, clear_identity_directory_for_test, clear_pending_simple_genesis,
        update_identity_directory,
    };
    use crate::storage::indexed_db::idb_put_string;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn pending_genesis_survives_selection_change() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let app_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let pending = begin_or_resume_simple_genesis(&app_key, "Personal").await?;
        let another_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let selected_key = another_key.clone();
        update_identity_directory(move |directory| {
            directory
                .create_identity("Work", &selected_key, None)
                .map_err(map_domain_error)?;
            Ok(())
        })
        .await?;
        let resumed = begin_or_resume_simple_genesis(&app_key, "Ignored").await?;
        assert_eq!(resumed.store_id, pending.store_id);
        assert_eq!(resumed.identity_id, pending.identity_id);
        clear_pending_simple_genesis(SimpleGenesisCompletion::Ordinary { pending: &pending })
            .await?;
        let replacement = begin_or_resume_simple_genesis(&another_key, "Work").await?;
        assert_ne!(replacement.store_id, pending.store_id);
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn migrates_legacy_top_level_event_yaml() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let app_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let identity = ensure_local_identity_for_app_key(&app_key, "Personal").await?;
        let raw = serde_json::json!({
            "storeId": nook_core::generate_store_id().map_err(map_domain_error)?,
            "identityId": identity.identity_id,
            "createdAt": "2026-08-13T00:00:00.000Z",
            "eventYaml": "signed-event\n"
        })
        .to_string();
        idb_put_string(PENDING_SIMPLE_GENESIS_KEY, &raw).await?;
        let marker = begin_or_resume_simple_genesis(&app_key, "Personal").await?;
        assert_eq!(marker.event_yaml(), Some("signed-event\n"));
        let upgraded = idb_get_string(PENDING_SIMPLE_GENESIS_KEY)
            .await?
            .ok_or_else(|| NookError::IndexedDb("Marker disappeared.".to_owned()))?;
        let upgraded: serde_json::Value = serde_json::from_str(&upgraded)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        assert!(upgraded.get("eventState").is_some());
        assert!(upgraded.get("eventYaml").is_none());
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn pending_genesis_reuses_first_complete_signed_event() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let app_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let pending = begin_or_resume_simple_genesis(&app_key, "Personal").await?;
        let first = persist_simple_genesis_event(
            &pending,
            &app_key,
            "first-event\n".to_owned(),
            "first-seed".to_owned(),
        )
        .await?;
        let stored = idb_get_string(PENDING_SIMPLE_GENESIS_KEY)
            .await?
            .ok_or_else(|| NookError::IndexedDb("Marker disappeared.".to_owned()))?;
        assert!(!stored.contains("first-seed"));
        assert!(stored.contains("signingSeedEnvelope"));
        let resumed = persist_simple_genesis_event(
            &pending,
            &app_key,
            "other-event\n".to_owned(),
            "other-seed".to_owned(),
        )
        .await?;
        assert_eq!(resumed.event_yaml, first.event_yaml);
        assert_eq!(resumed.signing_seed, first.signing_seed);
        clear_identity_directory_for_test().await
    }

    #[test]
    fn rejects_mismatched_plaintext_legacy_signing_seed() -> anyhow::Result<()> {
        let app_key = nook_core::AppKey::generate()?;
        let (event_signing, _) = nook_core::SigningIdentity::generate()?;
        let (_, mismatched_seed) = nook_core::SigningIdentity::generate()?;
        let store_id = nook_core::generate_store_id()?;
        let event = nook_core::VaultEvent::sign(
            nook_core::VaultEventBody {
                schema_version: nook_core::VaultEventSchemaVersion::CURRENT,
                store_id: store_id.clone(),
                actor_id: event_signing.actor_id()?,
                actor_signing_public_key: event_signing.public_key(),
                parents: Vec::new(),
                created_at: nook_core::IsoTimestamp::parse("2026-08-14T00:00:00Z")?,
                key_epoch: nook_core::EventId::from_sha256_hex(
                    nook_core::sha256_hex(store_id.as_str().as_bytes()).as_str(),
                )?,
                operations: Vec::new(),
            },
            event_signing.signing_key(),
        )?;
        let event_yaml = String::from_utf8(nook_core::serialize_event_storage_yaml(&event)?)?;
        let mut pending = PendingSimpleGenesis {
            store_id,
            identity_id: nook_core::IdentityId::generate()?,
            created_at: nook_core::IsoTimestamp::parse("2026-08-14T00:00:00Z")?,
            event_state: PendingSimpleGenesisEvent::LegacyUnsealedEventPinned {
                event_yaml,
                signing_seed: mismatched_seed.as_str().to_owned(),
            },
            flow: PendingSimpleGenesisFlow::Ordinary,
        };

        assert!(seal_legacy_signing_seed(&mut pending, &app_key).is_err());
        assert!(matches!(
            pending.event_state,
            PendingSimpleGenesisEvent::LegacyUnsealedEventPinned { .. }
        ));
        Ok(())
    }

    fn map_domain_error(error: nook_core::MultiDeviceError) -> NookError {
        let message = error.to_string();
        drop(error);
        NookError::Database(message)
    }
}
