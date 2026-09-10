//! Provider outbox persistence and its event-projection integration.
use super::*;

impl NookDatabase {
    fn outbox_key(request: EventDbOutboxKey<'_>) -> String {
        let EventDbOutboxKey {
            provider_id,
            event_id,
        } = request;
        format!("outbox:{provider_id}:{event_id}")
    }
}

impl NookDatabase {
    pub(crate) async fn queue_outbox_entry(
        request: EventDbQueueOutboxEntry<'_>,
    ) -> Result<(), NookError> {
        let EventDbQueueOutboxEntry {
            provider_id,
            event_id,
            bytes,
        } = request;
        let value = String::from_utf8(bytes.to_vec())
            .map_err(|e| NookError::Serialization(format!("Event bytes not UTF-8: {e}")))?;
        NookDatabase::store_put(EventDbStorePut {
            store_name: STORE_OUTBOX,
            key: &NookDatabase::outbox_key(EventDbOutboxKey {
                provider_id: provider_id,
                event_id: event_id,
            }),
            value: &value,
        })
        .await
    }
}

impl NookDatabase {
    pub(crate) async fn load_outbox(
        provider_id: &str,
    ) -> Result<Vec<(String, Vec<u8>)>, NookError> {
        let index_key = format!("outbox_index:{provider_id}");
        let entries = match NookDatabase::store_get(EventDbStoreGet {
            store_name: STORE_OUTBOX,
            key: &index_key,
        })
        .await?
        {
            StoredStringRecord::MissingKey => Vec::new(),
            StoredStringRecord::Stored(json) => serde_json::from_str::<Vec<String>>(&json)
                .map_err(|e| NookError::Serialization(e.to_string()))?,
        };
        let mut out = Vec::new();
        for event_id in entries {
            let key = NookDatabase::outbox_key(EventDbOutboxKey {
                provider_id: provider_id,
                event_id: &event_id,
            });
            if let StoredStringRecord::Stored(text) = NookDatabase::store_get(EventDbStoreGet {
                store_name: STORE_OUTBOX,
                key: &key,
            })
            .await?
            {
                out.push((event_id, text.into_bytes()));
            }
        }
        Ok(out)
    }
}

impl NookDatabase {
    pub(crate) async fn append_outbox_index(
        request: EventDbAppendOutboxIndex<'_>,
    ) -> Result<(), NookError> {
        let EventDbAppendOutboxIndex {
            provider_id,
            event_id,
        } = request;
        let index_key = format!("outbox_index:{provider_id}");
        let mut ids: Vec<String> = match NookDatabase::store_get(EventDbStoreGet {
            store_name: STORE_OUTBOX,
            key: &index_key,
        })
        .await?
        {
            StoredStringRecord::MissingKey => Vec::new(),
            StoredStringRecord::Stored(json) => {
                serde_json::from_str(&json).map_err(|e| NookError::Serialization(e.to_string()))?
            }
        };
        if !ids.iter().any(|id| id == event_id) {
            ids.push(event_id.to_owned());
            let json =
                serde_json::to_string(&ids).map_err(|e| NookError::Serialization(e.to_string()))?;
            NookDatabase::store_put(EventDbStorePut {
                store_name: STORE_OUTBOX,
                key: &index_key,
                value: &json,
            })
            .await?;
        }
        Ok(())
    }
}

impl NookDatabase {
    pub(crate) async fn remove_outbox_entry(
        request: EventDbRemoveOutboxEntry<'_>,
    ) -> Result<(), NookError> {
        let EventDbRemoveOutboxEntry {
            provider_id,
            event_id,
        } = request;
        NookDatabase::store_put(EventDbStorePut {
            store_name: STORE_OUTBOX,
            key: &NookDatabase::outbox_key(EventDbOutboxKey {
                provider_id: provider_id,
                event_id: event_id,
            }),
            value: "",
        })
        .await?;
        let index_key = format!("outbox_index:{provider_id}");
        if let StoredStringRecord::Stored(json) = NookDatabase::store_get(EventDbStoreGet {
            store_name: STORE_OUTBOX,
            key: &index_key,
        })
        .await?
        {
            let mut ids: Vec<String> =
                serde_json::from_str(&json).map_err(|e| NookError::Serialization(e.to_string()))?;
            ids.retain(|id| id != event_id);
            let json =
                serde_json::to_string(&ids).map_err(|e| NookError::Serialization(e.to_string()))?;
            NookDatabase::store_put(EventDbStorePut {
                store_name: STORE_OUTBOX,
                key: &index_key,
                value: &json,
            })
            .await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;
    #[wasm_bindgen_test]
    async fn event_log_and_outbox_projections_round_trip() -> Result<(), NookError> {
        NookDatabase::store_delete(EventDbStoreDelete {
            store_name: STORE_VAULT,
            key: EVENT_LOG_MODE_KEY,
        })
        .await?;
        assert!(!NookDatabase::is_event_log_mode().await?);
        NookDatabase::set_event_log_mode().await?;
        assert!(NookDatabase::is_event_log_mode().await?);

        NookDatabase::save_signing_seed("seed-material").await?;
        assert_eq!(
            NookDatabase::load_signing_seed().await?,
            StoredSigningSeed::Stored("seed-material".to_owned())
        );

        let store_id = "projection-round-trip";
        let heads = vec!["head-b".to_owned(), "head-a".to_owned()];
        NookDatabase::save_heads(EventDbSaveHeads {
            store_id: store_id,
            heads: &heads,
        })
        .await?;
        assert_eq!(NookDatabase::load_heads(store_id).await?, heads);
        NookDatabase::save_key_epoch(EventDbSaveKeyEpoch {
            store_id: store_id,
            epoch: "epoch-2",
        })
        .await?;
        assert_eq!(
            NookDatabase::load_key_epoch(store_id).await?,
            StoredKeyEpoch::Recorded("epoch-2".to_owned())
        );

        NookDatabase::queue_outbox_entry(EventDbQueueOutboxEntry {
            provider_id: "drive",
            event_id: "event-2",
            bytes: b"encrypted-two",
        })
        .await?;
        NookDatabase::queue_outbox_entry(EventDbQueueOutboxEntry {
            provider_id: "drive",
            event_id: "event-1",
            bytes: b"encrypted-one",
        })
        .await?;
        NookDatabase::append_outbox_index(EventDbAppendOutboxIndex {
            provider_id: "drive",
            event_id: "event-2",
        })
        .await?;
        NookDatabase::append_outbox_index(EventDbAppendOutboxIndex {
            provider_id: "drive",
            event_id: "event-2",
        })
        .await?;
        NookDatabase::append_outbox_index(EventDbAppendOutboxIndex {
            provider_id: "drive",
            event_id: "event-1",
        })
        .await?;
        assert_eq!(
            NookDatabase::load_outbox("drive").await?,
            vec![
                ("event-2".to_owned(), b"encrypted-two".to_vec()),
                ("event-1".to_owned(), b"encrypted-one".to_vec()),
            ]
        );
        NookDatabase::remove_outbox_entry(EventDbRemoveOutboxEntry {
            provider_id: "drive",
            event_id: "event-2",
        })
        .await?;
        assert_eq!(
            NookDatabase::load_outbox("drive").await?,
            vec![("event-1".to_owned(), b"encrypted-one".to_vec())]
        );

        NookDatabase::clear_local_event_store(store_id).await?;
        NookDatabase::store_delete(EventDbStoreDelete {
            store_name: STORE_OUTBOX,
            key: &NookDatabase::outbox_key(EventDbOutboxKey {
                provider_id: "drive",
                event_id: "event-1",
            }),
        })
        .await?;
        NookDatabase::store_delete(EventDbStoreDelete {
            store_name: STORE_OUTBOX,
            key: "outbox_index:drive",
        })
        .await?;
        NookDatabase::store_delete(EventDbStoreDelete {
            store_name: STORE_VAULT,
            key: SIGNING_SEED_KEY,
        })
        .await?;
        NookDatabase::store_delete(EventDbStoreDelete {
            store_name: STORE_VAULT,
            key: EVENT_LOG_MODE_KEY,
        })
        .await?;
        Ok(())
    }
}
