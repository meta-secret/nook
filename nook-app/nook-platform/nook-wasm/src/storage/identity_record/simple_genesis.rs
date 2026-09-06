#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Crash-safe Simple-vault genesis marker lifecycle.

use nook_core::{IsoTimestamp, StoreId};
mod event;
use crate::storage::identity_record;
pub(crate) use event::SimpleGenesisEventInput;

use std::{cell::RefCell, rc::Rc};

use serde::{Deserialize, Deserializer, Serialize, de::Error as _};

use super::{genesis_flow::PendingSimpleGenesisFlow, staged_genesis::StagedSimpleGenesisIdentity};
use crate::storage::indexed_db;
use crate::storage::indexed_db::StringUpdateGuard;
use crate::{NookError, conversion};

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
    #[serde(default = "PendingSimpleGenesisWire::legacy_timestamp")]
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

impl PendingSimpleGenesisWire {
    fn legacy_timestamp() -> IsoTimestamp {
        IsoTimestamp::from_trusted("1970-01-01T00:00:00.000Z".to_owned())
    }
}
impl PendingSimpleGenesis {
    pub(super) fn decode(raw: &str) -> Result<Self, NookError> {
        serde_json::from_str(raw).map_err(|error| {
            NookError::IndexedDb(format!("Pending Simple genesis decode error: {error}"))
        })
    }
    pub(super) fn encode(&self) -> Result<String, NookError> {
        let pending = self;
        serde_json::to_string(pending).map_err(|error| {
            NookError::IndexedDb(format!("Pending Simple genesis encode error: {error}"))
        })
    }
    pub(crate) async fn load_for_store(store_id: &str) -> Result<Option<Self>, NookError> {
        if store_id.is_empty() {
            return Ok(None);
        }
        let store_id =
            StoreId::parse(store_id).map_err(|error| NookError::Database(error.to_string()))?;
        let Some(pending) = PendingSimpleGenesis::load().await? else {
            return Ok(None);
        };
        Ok((pending.store_id == store_id).then_some(pending))
    }
    pub(crate) async fn load() -> Result<Option<Self>, NookError> {
        indexed_db::idb_get_string(PENDING_SIMPLE_GENESIS_KEY)
            .await?
            .map(|raw| PendingSimpleGenesis::decode(&raw))
            .transpose()
    }
}
pub(crate) struct OrdinarySimpleGenesisRequest<'a> {
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) label: &'a str,
}
impl OrdinarySimpleGenesisRequest<'_> {
    pub(crate) async fn begin_or_resume(self) -> Result<PendingSimpleGenesis, NookError> {
        let Self { app_key, label } = self;
        if indexed_db::idb_get_string(PENDING_SIMPLE_GENESIS_KEY)
            .await?
            .is_some()
        {
            let selected = Rc::new(RefCell::new(None));
            let captured = Rc::clone(&selected);
            indexed_db::idb_update_string(
                PENDING_SIMPLE_GENESIS_KEY,
                StringUpdateGuard::Unconditional,
                move |current| {
                    let raw = current.ok_or_else(|| {
                        NookError::IndexedDb(
                            "Pending Simple genesis marker disappeared.".to_owned(),
                        )
                    })?;
                    let mut pending = PendingSimpleGenesis::decode(&raw)?;
                    pending.seal_legacy_signing_seed(app_key)?;
                    let encoded = pending.encode()?;
                    *captured.borrow_mut() = Some(pending);
                    Ok(encoded)
                },
            )
            .await?;
            return selected.borrow_mut().take().ok_or_else(|| {
                NookError::IndexedDb("Pending Simple genesis produced no result.".to_owned())
            });
        }
        let identity = identity_record::ensure_local_identity_for_app_key(app_key, label).await?;
        let proposed = PendingSimpleGenesis {
            store_id: nook_core::generate_store_id()
                .map_err(|error| NookError::Database(error.to_string()))?,
            identity_id: identity.identity_id,
            created_at: IsoTimestamp::parse(&conversion::wasm_iso_timestamp())
                .map_err(|error| NookError::Database(error.to_string()))?,
            event_state: PendingSimpleGenesisEvent::AwaitingEvent,
            flow: PendingSimpleGenesisFlow::Ordinary,
        };
        let selected = Rc::new(RefCell::new(None));
        let captured = Rc::clone(&selected);
        indexed_db::idb_update_string(
            PENDING_SIMPLE_GENESIS_KEY,
            StringUpdateGuard::Unconditional,
            move |current| {
                let pending = current
                    .as_deref()
                    .map(PendingSimpleGenesis::decode)
                    .transpose()?
                    .unwrap_or(proposed);
                let encoded = pending.encode()?;
                *captured.borrow_mut() = Some(pending);
                Ok(encoded)
            },
        )
        .await?;
        selected.borrow_mut().take().ok_or_else(|| {
            NookError::IndexedDb("Pending Simple genesis produced no result.".to_owned())
        })
    }
}
#[cfg(test)]
mod tests {
    use nook_core::{AppKey, IdentityId, IsoTimestamp};

    use super::{
        OrdinarySimpleGenesisRequest, PENDING_SIMPLE_GENESIS_KEY, PendingSimpleGenesis,
        PendingSimpleGenesisEvent, PendingSimpleGenesisFlow,
    };
    use crate::storage::identity_record;
    use crate::{NookError, storage::indexed_db};
    use identity_record::SimpleGenesisCompletion;

    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct LegacyGenesisMarker {
        store_id: nook_core::StoreId,
        identity_id: IdentityId,
        created_at: &'static str,
        event_yaml: &'static str,
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct UpgradedGenesisMarker {
        store_id: nook_core::StoreId,
        identity_id: IdentityId,
        created_at: IsoTimestamp,
        event_state: PendingSimpleGenesisEvent,
        flow: PendingSimpleGenesisFlow,
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn pending_genesis_survives_selection_change() -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let pending = OrdinarySimpleGenesisRequest {
            app_key: &app_key,
            label: "Personal",
        }
        .begin_or_resume()
        .await?;
        let another_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let selected_key = another_key.clone();
        identity_record::update_identity_directory(move |directory| {
            directory
                .create_identity("Work", &selected_key, None)
                .map_err(identity_record::map_domain_error)?;
            Ok(())
        })
        .await?;
        let resumed = OrdinarySimpleGenesisRequest {
            app_key: &app_key,
            label: "Ignored",
        }
        .begin_or_resume()
        .await?;
        assert_eq!(resumed.store_id, pending.store_id);
        assert_eq!(resumed.identity_id, pending.identity_id);
        SimpleGenesisCompletion::Ordinary { pending: &pending }
            .clear_pending()
            .await?;
        let replacement = OrdinarySimpleGenesisRequest {
            app_key: &another_key,
            label: "Work",
        }
        .begin_or_resume()
        .await?;
        assert_ne!(replacement.store_id, pending.store_id);
        identity_record::clear_identity_directory_for_test().await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn cleanup_preserves_marker_when_any_completion_identity_differs() -> Result<(), NookError>
    {
        identity_record::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let pending = OrdinarySimpleGenesisRequest {
            app_key: &app_key,
            label: "Personal",
        }
        .begin_or_resume()
        .await?;
        let original = indexed_db::idb_get_string(PENDING_SIMPLE_GENESIS_KEY)
            .await?
            .ok_or_else(|| NookError::Database("Pending genesis marker is missing.".to_owned()))?;
        let different_store = PendingSimpleGenesis {
            store_id: nook_core::generate_store_id().map_err(identity_record::map_domain_error)?,
            ..pending.clone()
        };
        let different_identity = PendingSimpleGenesis {
            identity_id: IdentityId::generate().map_err(identity_record::map_domain_error)?,
            ..pending.clone()
        };
        let different_time = PendingSimpleGenesis {
            created_at: IsoTimestamp::parse("2000-01-01T00:00:00Z")?,
            ..pending.clone()
        };
        assert_ne!(different_store.store_id, pending.store_id);
        assert_ne!(different_identity.identity_id, pending.identity_id);
        assert_ne!(different_time.created_at, pending.created_at);
        for completed in [different_store, different_identity, different_time] {
            SimpleGenesisCompletion::Ordinary {
                pending: &completed,
            }
            .clear_pending()
            .await?;
            assert_eq!(
                indexed_db::idb_get_string(PENDING_SIMPLE_GENESIS_KEY)
                    .await?
                    .as_ref(),
                Some(&original)
            );
        }
        SimpleGenesisCompletion::Ordinary { pending: &pending }
            .clear_pending()
            .await?;
        assert!(
            indexed_db::idb_get_string(PENDING_SIMPLE_GENESIS_KEY)
                .await?
                .is_none()
        );
        identity_record::clear_identity_directory_for_test().await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn migrates_legacy_top_level_event_yaml() -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let identity =
            identity_record::ensure_local_identity_for_app_key(&app_key, "Personal").await?;
        let raw = serde_json::to_string(&LegacyGenesisMarker {
            store_id: nook_core::generate_store_id().map_err(identity_record::map_domain_error)?,
            identity_id: identity.identity_id,
            created_at: "2026-08-13T00:00:00.000Z",
            event_yaml: "signed-event\n",
        })
        .map_err(|error| NookError::Serialization(error.to_string()))?;
        indexed_db::idb_put_string(PENDING_SIMPLE_GENESIS_KEY, &raw).await?;
        let marker = OrdinarySimpleGenesisRequest {
            app_key: &app_key,
            label: "Personal",
        }
        .begin_or_resume()
        .await?;
        assert_eq!(marker.event_yaml(), Some("signed-event\n"));
        let upgraded = indexed_db::idb_get_string(PENDING_SIMPLE_GENESIS_KEY)
            .await?
            .ok_or_else(|| NookError::IndexedDb("Marker disappeared.".to_owned()))?;
        let upgraded: UpgradedGenesisMarker = serde_json::from_str(&upgraded)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        assert!(
            matches!(upgraded.event_state, PendingSimpleGenesisEvent::LegacyEventPinned { event_yaml } if event_yaml == "signed-event\n")
        );
        assert_eq!(upgraded.store_id, marker.store_id);
        assert_eq!(upgraded.identity_id, marker.identity_id);
        assert_eq!(upgraded.created_at, marker.created_at);
        assert!(matches!(upgraded.flow, PendingSimpleGenesisFlow::Ordinary));
        identity_record::clear_identity_directory_for_test().await
    }
}
