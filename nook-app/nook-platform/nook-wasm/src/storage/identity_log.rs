//! `IndexedDB` persistence for replicated identity control events.
//!
//! Identity events share the `events` object store with vault events under
//! their own key prefix, so no browser schema upgrade is required. Each write
//! commits the event rows and the identity's index in one transaction.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use std::collections::BTreeSet;

use nook_core::{EventId, EventStorageBytes, IdentityControlLog, IdentityId};
use rexie::TransactionMode;
use wasm_bindgen::JsValue;

use crate::{NookDatabase, NookError};

const STORE_EVENTS: &str = "events";

/// Named values required by `NookDatabase::save_identity_events`.
pub(crate) struct IdentityLogWrite<'a> {
    pub(crate) identity_id: &'a IdentityId,
    pub(crate) events: &'a [(EventId, EventStorageBytes)],
}

/// Named values required by `NookDatabase::identity_event_key`.
#[derive(Clone, Copy)]
struct IdentityEventKey<'a> {
    identity_id: &'a IdentityId,
    event_id: &'a str,
}

impl NookDatabase {
    fn identity_event_key(request: IdentityEventKey<'_>) -> String {
        format!(
            "identity_event:{}:{}",
            request.identity_id, request.event_id
        )
    }

    fn identity_event_index_key(identity_id: &IdentityId) -> String {
        format!("identity_event_index:{identity_id}")
    }

    fn js_key(key: &str) -> Result<JsValue, NookError> {
        serde_wasm_bindgen::to_value(key)
            .map_err(|error| NookError::IndexedDb(format!("Identity log key error: {error:?}")))
    }

    async fn read_identity_index(
        store: &rexie::Store,
        identity_id: &IdentityId,
    ) -> Result<Vec<String>, NookError> {
        let value = store
            .get(Self::js_key(&Self::identity_event_index_key(identity_id))?)
            .await
            .map_err(|error| {
                NookError::IndexedDb(format!("Identity index read error: {error:?}"))
            })?;
        match value.filter(|value| !value.is_undefined() && !value.is_null()) {
            None => Ok(Vec::new()),
            Some(value) => {
                let json: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
                    NookError::IndexedDb(format!("Identity index decode error: {error:?}"))
                })?;
                serde_json::from_str(&json)
                    .map_err(|error| NookError::Serialization(error.to_string()))
            }
        }
    }

    /// Load and validate every stored identity event. A malformed or foreign
    /// row fails the load instead of being skipped.
    pub(crate) async fn load_identity_log(
        identity_id: &IdentityId,
    ) -> Result<IdentityControlLog, NookError> {
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&[STORE_EVENTS], TransactionMode::ReadOnly)
            .map_err(|error| NookError::IndexedDb(format!("Transaction error: {error:?}")))?;
        let store = transaction
            .store(STORE_EVENTS)
            .map_err(|error| NookError::IndexedDb(format!("Store error: {error:?}")))?;
        let mut stored = Vec::new();
        for raw_id in Self::read_identity_index(&store, identity_id).await? {
            let key = Self::identity_event_key(IdentityEventKey {
                identity_id,
                event_id: &raw_id,
            });
            let value = store
                .get(Self::js_key(&key)?)
                .await
                .map_err(|error| {
                    NookError::IndexedDb(format!("Identity event read error: {error:?}"))
                })?
                .filter(|value| !value.is_undefined() && !value.is_null())
                .ok_or_else(|| {
                    NookError::IndexedDb(format!(
                        "Identity index references missing event {raw_id}."
                    ))
                })?;
            let text: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
                NookError::IndexedDb(format!("Identity event decode error: {error:?}"))
            })?;
            stored.push(EventStorageBytes::from(text.into_bytes()));
        }
        transaction
            .done()
            .await
            .map_err(|error| NookError::IndexedDb(format!("Transaction done error: {error:?}")))?;
        IdentityControlLog::new(identity_id.clone())
            .union_storage_bytes(&stored)
            .map_err(|rejection| NookError::from(rejection.cause))
    }

    /// Persist identity events and extend the identity index atomically.
    pub(crate) async fn save_identity_events(
        request: IdentityLogWrite<'_>,
    ) -> Result<(), NookError> {
        let IdentityLogWrite {
            identity_id,
            events,
        } = request;
        if events.is_empty() {
            return Ok(());
        }
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&[STORE_EVENTS], TransactionMode::ReadWrite)
            .map_err(|error| NookError::IndexedDb(format!("Transaction error: {error:?}")))?;
        let store = transaction
            .store(STORE_EVENTS)
            .map_err(|error| NookError::IndexedDb(format!("Store error: {error:?}")))?;
        let mut index = Self::read_identity_index(&store, identity_id)
            .await?
            .into_iter()
            .collect::<BTreeSet<_>>();
        for (event_id, bytes) in events {
            let text = String::from_utf8(Vec::from(bytes.clone())).map_err(|error| {
                NookError::Serialization(format!("Identity event bytes are not UTF-8: {error}"))
            })?;
            let key = Self::identity_event_key(IdentityEventKey {
                identity_id,
                event_id: event_id.as_str(),
            });
            let value = serde_wasm_bindgen::to_value(&text).map_err(|error| {
                NookError::IndexedDb(format!("Identity event value error: {error:?}"))
            })?;
            store
                .put(&value, Some(&Self::js_key(&key)?))
                .await
                .map_err(|error| {
                    NookError::IndexedDb(format!("Identity event write error: {error:?}"))
                })?;
            index.insert(event_id.as_str().to_owned());
        }
        let index_json = serde_json::to_string(&index.into_iter().collect::<Vec<_>>())
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        let index_value = serde_wasm_bindgen::to_value(&index_json).map_err(|error| {
            NookError::IndexedDb(format!("Identity index value error: {error:?}"))
        })?;
        store
            .put(
                &index_value,
                Some(&Self::js_key(&Self::identity_event_index_key(identity_id))?),
            )
            .await
            .map_err(|error| {
                NookError::IndexedDb(format!("Identity index write error: {error:?}"))
            })?;
        transaction
            .done()
            .await
            .map_err(|error| NookError::IndexedDb(format!("Transaction done error: {error:?}")))?;
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use nook_core::{
        AppKey, IdentityControlState, IdentityEvent, IdentityEventSigning, IdentityGenesisRequest,
        IdentityMemberKeys, IsoTimestamp, MemberLabel, SigningIdentity,
    };
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn identity_events_round_trip_through_indexed_db() -> anyhow::Result<()> {
        let identity_id = IdentityId::generate()?;
        let app = AppKey::generate()?;
        let (signer, _) = SigningIdentity::generate()?;
        let at = IsoTimestamp::from_trusted("2026-10-12T00:00:00Z".to_owned());
        let genesis = IdentityEvent::genesis(IdentityGenesisRequest {
            identity_id: &identity_id,
            founder: IdentityMemberKeys {
                app_id: app.app_id().clone(),
                encryption_public_key: app.public_key(),
                signing_public_key: signer.public_key(),
                label: MemberLabel::from_trusted("Laptop".to_owned()),
            },
            signing: IdentityEventSigning {
                signing_key: signer.signing_key(),
                created_at: &at,
            },
        })?;
        let event_id = genesis.id()?;
        NookDatabase::save_identity_events(IdentityLogWrite {
            identity_id: &identity_id,
            events: &[(event_id.clone(), genesis.serialize_storage_yaml()?)],
        })
        .await?;
        let log = NookDatabase::load_identity_log(&identity_id).await?;
        assert!(log.contains(&event_id));
        assert_eq!(IdentityControlState::project(&log)?.members.len(), 1);

        let empty = NookDatabase::load_identity_log(&IdentityId::generate()?).await?;
        assert!(empty.is_empty());
        Ok(())
    }
}
