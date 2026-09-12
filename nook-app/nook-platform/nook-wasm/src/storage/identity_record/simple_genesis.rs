#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Crash-safe Simple-vault genesis marker lifecycle.

use crate::BrowserTimestamp;
use crate::IdentityDbEnsureLocalIdentityForAppKey;
use crate::StoredStringRecord;
use crate::{IndexedDbUpdate, NookDatabase};
use nook_core::{IsoTimestamp, StoreId};
mod event;
mod wire;
pub(crate) use event::SimpleGenesisEventInput;

use std::{cell::RefCell, rc::Rc};

use serde::Serialize;

use super::{genesis_flow::PendingSimpleGenesisFlow, staged_genesis::StagedSimpleGenesisIdentity};
use crate::NookError;
use crate::storage::indexed_db::StringUpdateGuard;

pub(crate) const PENDING_SIMPLE_GENESIS_KEY: &str = "pending_simple_genesis_v1";

#[derive(Clone, Debug)]
pub(crate) struct PendingSimpleGenesis {
    pub(crate) store_id: nook_core::StoreId,
    pub(crate) identity_id: nook_core::IdentityId,
    pub(crate) created_at: nook_core::IsoTimestamp,
    pub(crate) event_state: PendingSimpleGenesisEvent,
    pub(crate) flow: PendingSimpleGenesisFlow,
}

#[derive(Clone, Debug, Serialize)]
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

#[derive(Debug)]
pub(crate) enum SimpleGenesisProgress {
    NotPending,
    Pending(Box<PendingSimpleGenesis>),
}
impl SimpleGenesisProgress {
    pub(crate) fn pending(pending: PendingSimpleGenesis) -> Self {
        Self::Pending(Box::new(pending))
    }

    #[cfg(test)]
    pub(crate) fn require_pending(self) -> Result<PendingSimpleGenesis, NookError> {
        match self {
            Self::Pending(pending) => Ok(*pending),
            Self::NotPending => Err(NookError::IndexedDb(
                "Pending Simple genesis is missing.".to_owned(),
            )),
        }
    }
}

impl PendingSimpleGenesis {
    pub(crate) fn require_staged_identity(
        &self,
    ) -> Result<&StagedSimpleGenesisIdentity, NookError> {
        match &self.flow {
            PendingSimpleGenesisFlow::Staged(identity) => Ok(identity),
            PendingSimpleGenesisFlow::Ordinary => Err(NookError::IndexedDb(
                "Staged genesis identity is required.".to_owned(),
            )),
        }
    }

    pub(crate) fn is_staged(&self) -> bool {
        matches!(self.flow, PendingSimpleGenesisFlow::Staged(_))
    }

    #[cfg(test)]
    fn event_yaml(&self) -> Result<&str, NookError> {
        match &self.event_state {
            PendingSimpleGenesisEvent::AwaitingEvent => Err(NookError::IndexedDb(
                "Genesis event has not been pinned.".to_owned(),
            )),
            PendingSimpleGenesisEvent::LegacyEventPinned { event_yaml }
            | PendingSimpleGenesisEvent::EventPinned { event_yaml, .. }
            | PendingSimpleGenesisEvent::LegacyUnsealedEventPinned { event_yaml, .. } => {
                Ok(event_yaml)
            }
        }
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
    pub(crate) async fn load_for_store(store_id: &str) -> Result<SimpleGenesisProgress, NookError> {
        if store_id.is_empty() {
            return Ok(SimpleGenesisProgress::NotPending);
        }
        let store_id =
            StoreId::parse(store_id).map_err(|error| NookError::Database(error.to_string()))?;
        let SimpleGenesisProgress::Pending(pending) = PendingSimpleGenesis::load().await? else {
            return Ok(SimpleGenesisProgress::NotPending);
        };
        Ok(if pending.store_id == store_id {
            SimpleGenesisProgress::pending(*pending)
        } else {
            SimpleGenesisProgress::NotPending
        })
    }
    pub(crate) async fn load() -> Result<SimpleGenesisProgress, NookError> {
        match NookDatabase::idb_get_string(PENDING_SIMPLE_GENESIS_KEY).await? {
            StoredStringRecord::MissingKey => Ok(SimpleGenesisProgress::NotPending),
            StoredStringRecord::Stored(raw) => {
                PendingSimpleGenesis::decode(&raw).map(SimpleGenesisProgress::pending)
            }
        }
    }
}
pub(crate) struct OrdinarySimpleGenesisRequest<'a> {
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) label: &'a str,
}
impl OrdinarySimpleGenesisRequest<'_> {
    pub(crate) async fn begin_or_resume(self) -> Result<PendingSimpleGenesis, NookError> {
        let Self { app_key, label } = self;
        if matches!(
            NookDatabase::idb_get_string(PENDING_SIMPLE_GENESIS_KEY).await?,
            StoredStringRecord::Stored(_)
        ) {
            let selected = Rc::new(RefCell::new(Err(NookError::IndexedDb(
                "Pending Simple genesis produced no result.".to_owned(),
            ))));
            let captured = Rc::clone(&selected);
            NookDatabase::idb_update_string(IndexedDbUpdate {
                key: PENDING_SIMPLE_GENESIS_KEY,
                guard: StringUpdateGuard::Unconditional,
                update: move |current| {
                    let raw = match current {
                        StoredStringRecord::Stored(raw) => raw,
                        StoredStringRecord::MissingKey => {
                            return Err(NookError::IndexedDb(
                                "Pending Simple genesis marker disappeared.".to_owned(),
                            ));
                        }
                    };
                    let mut pending = PendingSimpleGenesis::decode(&raw)?;
                    pending.seal_legacy_signing_seed(app_key)?;
                    let encoded = pending.encode()?;
                    *captured.borrow_mut() = Ok(pending);
                    Ok(encoded)
                },
            })
            .await?;
            return selected.replace(Err(NookError::IndexedDb(
                "Pending Simple genesis produced no result.".to_owned(),
            )));
        }
        let identity = NookDatabase::ensure_local_identity_for_app_key(
            IdentityDbEnsureLocalIdentityForAppKey { app_key, label },
        )
        .await?;
        let proposed = PendingSimpleGenesis {
            store_id: nook_core::StoreId::generate()
                .map_err(|error| NookError::Database(error.to_string()))?,
            identity_id: identity.identity_id,
            created_at: IsoTimestamp::parse(&BrowserTimestamp::now().into_iso_string())
                .map_err(|error| NookError::Database(error.to_string()))?,
            event_state: PendingSimpleGenesisEvent::AwaitingEvent,
            flow: PendingSimpleGenesisFlow::Ordinary,
        };
        let selected = Rc::new(RefCell::new(Err(NookError::IndexedDb(
            "Pending Simple genesis produced no result.".to_owned(),
        ))));
        let captured = Rc::clone(&selected);
        NookDatabase::idb_update_string(IndexedDbUpdate {
            key: PENDING_SIMPLE_GENESIS_KEY,
            guard: StringUpdateGuard::Unconditional,
            update: move |current| {
                let pending = match current {
                    StoredStringRecord::MissingKey => proposed,
                    StoredStringRecord::Stored(raw) => PendingSimpleGenesis::decode(&raw)?,
                };
                let encoded = pending.encode()?;
                *captured.borrow_mut() = Ok(pending);
                Ok(encoded)
            },
        })
        .await?;
        selected.replace(Err(NookError::IndexedDb(
            "Pending Simple genesis produced no result.".to_owned(),
        )))
    }
}
#[cfg(test)]
mod tests {
    use crate::storage::identity_record::IdentityDirectoryWrite;
    use crate::{
        IdbPutStringRequest, IdentityDbEnsureLocalIdentityForAppKey, NookDatabase,
        StoredStringRecord,
    };

    use nook_core::IdentityCreation;

    use nook_core::{AppKey, IdentityId, IsoTimestamp};

    use super::{
        OrdinarySimpleGenesisRequest, PENDING_SIMPLE_GENESIS_KEY, PendingSimpleGenesis,
        PendingSimpleGenesisEvent, PendingSimpleGenesisFlow,
    };
    use crate::NookError;
    use crate::storage::identity_record;

    use identity_record::SimpleGenesisCompletion;
    use nook_core::MemberLabelState;

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
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let pending = OrdinarySimpleGenesisRequest {
            app_key: &app_key,
            label: "Personal",
        }
        .begin_or_resume()
        .await?;
        let another_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let selected_key = another_key.clone();
        NookDatabase::update_identity_directory(move |mut directory| {
            let resolved_identity = directory
                .create_identity(IdentityCreation {
                    label: "Work",
                    app_key: &selected_key,
                    member_label: MemberLabelState::Unnamed,
                })
                .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
            directory = resolved_identity.directory;
            Ok(IdentityDirectoryWrite::from(directory))
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
        NookDatabase::clear_identity_directory_for_test().await
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
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let pending = OrdinarySimpleGenesisRequest {
            app_key: &app_key,
            label: "Personal",
        }
        .begin_or_resume()
        .await?;
        let original = match NookDatabase::idb_get_string(PENDING_SIMPLE_GENESIS_KEY).await? {
            StoredStringRecord::Stored(value) => Ok(value),
            StoredStringRecord::MissingKey => Err(NookError::Database(
                "Pending genesis marker is missing.".to_owned(),
            )),
        }?;
        let different_store = PendingSimpleGenesis {
            store_id: nook_core::StoreId::generate().map_err(NookDatabase::map_domain_error)?,
            ..pending.clone()
        };
        let different_identity = PendingSimpleGenesis {
            identity_id: IdentityId::generate().map_err(NookDatabase::map_domain_error)?,
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
                NookDatabase::idb_get_string(PENDING_SIMPLE_GENESIS_KEY).await?,
                StoredStringRecord::Stored(original.clone())
            );
        }
        SimpleGenesisCompletion::Ordinary { pending: &pending }
            .clear_pending()
            .await?;
        assert!(matches!(
            NookDatabase::idb_get_string(PENDING_SIMPLE_GENESIS_KEY).await?,
            StoredStringRecord::MissingKey
        ));
        NookDatabase::clear_identity_directory_for_test().await
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
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let identity = NookDatabase::ensure_local_identity_for_app_key(
            IdentityDbEnsureLocalIdentityForAppKey {
                app_key: &app_key,
                label: "Personal",
            },
        )
        .await?;
        let raw = serde_json::to_string(&LegacyGenesisMarker {
            store_id: nook_core::StoreId::generate().map_err(NookDatabase::map_domain_error)?,
            identity_id: identity.identity_id,
            created_at: "2026-08-13T00:00:00.000Z",
            event_yaml: "signed-event\n",
        })
        .map_err(|error| NookError::Serialization(error.to_string()))?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: PENDING_SIMPLE_GENESIS_KEY,
            value: &raw,
        })
        .await?;
        let marker = OrdinarySimpleGenesisRequest {
            app_key: &app_key,
            label: "Personal",
        }
        .begin_or_resume()
        .await?;
        assert_eq!(marker.event_yaml()?, "signed-event\n");
        let upgraded = match NookDatabase::idb_get_string(PENDING_SIMPLE_GENESIS_KEY).await? {
            StoredStringRecord::Stored(value) => Ok(value),
            StoredStringRecord::MissingKey => {
                Err(NookError::IndexedDb("Marker disappeared.".to_owned()))
            }
        }?;
        let upgraded: UpgradedGenesisMarker = serde_json::from_str(&upgraded)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        assert!(
            matches!(upgraded.event_state, PendingSimpleGenesisEvent::LegacyEventPinned { event_yaml } if event_yaml == "signed-event\n")
        );
        assert_eq!(upgraded.store_id, marker.store_id);
        assert_eq!(upgraded.identity_id, marker.identity_id);
        assert_eq!(upgraded.created_at, marker.created_at);
        assert!(matches!(upgraded.flow, PendingSimpleGenesisFlow::Ordinary));
        NookDatabase::clear_identity_directory_for_test().await
    }
}
