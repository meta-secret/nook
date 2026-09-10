use super::super::event_log::{
    EventLogStorageRecord, ExtensionEventLogImportStatus, ExternalEventLogRecord,
};
use super::NookVaultManager;
use crate::NookReplacementConflict;
use crate::NookSecurityConflict;
use crate::types;
#[cfg(test)]
use serde::Serialize;
#[cfg(test)]
use wasm_bindgen::JsCast;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
pub struct NookEventLogStorageRecord(EventLogStorageRecord);

#[wasm_bindgen]
pub struct NookEventLogRecords(Vec<EventLogStorageRecord>);

#[wasm_bindgen]
impl NookEventLogRecords {
    #[wasm_bindgen]
    pub fn to_array(&self) -> Vec<EventLogStorageRecord> {
        self.0.clone()
    }
}

#[wasm_bindgen]
pub struct NookExternalEventLogRecords(pub(in crate::manager) Vec<ExternalEventLogRecord>);

#[wasm_bindgen]
impl NookExternalEventLogRecords {
    #[wasm_bindgen]
    pub fn from_array(records: Vec<ExternalEventLogRecord>) -> Self {
        Self(records)
    }
}

#[wasm_bindgen]
pub struct NookExtensionEventLogImportStatus(ExtensionEventLogImportStatus);

#[wasm_bindgen]
impl NookExtensionEventLogImportStatus {
    #[wasm_bindgen]
    pub fn to_object(&self) -> Result<nook_core::ImportedExtensionEventLog, JsError> {
        let evidence = nook_core::ImportedExtensionEventLog {
            vault_store_id: self.0.vault_store_id.clone(),
            event_count: u32::try_from(self.0.event_count)
                .map_err(|_| JsError::new("imported event count exceeds the browser contract"))?
                .into(),
            heads: self.0.heads.clone(),
            access_granted: self.0.access_granted,
        };
        evidence
            .admit()
            .map_err(|error| JsError::new(&error.to_string()))
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen]
    pub async fn export_event_log_records_js(&self) -> Result<NookEventLogRecords, JsError> {
        let records = self.export_event_log_records().await?;
        Ok(NookEventLogRecords(records))
    }

    #[wasm_bindgen]
    pub fn parse_event_log_storage_record_js(
        &self,
        event_id: &str,
        path: &str,
        content: &str,
    ) -> Result<NookEventLogStorageRecord, JsError> {
        let record = Self::parse_event_log_storage_record(event_id, path, content)?;
        Ok(NookEventLogStorageRecord(record))
    }

    #[wasm_bindgen]
    pub fn serialize_event_log_storage_record_js(
        &self,
        record: &NookEventLogStorageRecord,
    ) -> Result<String, JsError> {
        Ok(Self::serialize_event_log_storage_record(&record.0)?)
    }

    #[wasm_bindgen]
    pub async fn sync_external_event_log_records_js(
        &mut self,
        records: NookExternalEventLogRecords,
    ) -> Result<NookEventLogRecords, JsError> {
        let merged = self.sync_external_event_log_records(records.0).await?;
        Ok(NookEventLogRecords(merged))
    }

    #[wasm_bindgen]
    pub async fn import_extension_event_log_records_js(
        &mut self,
        expected_store_id: &str,
        expected_device_id: &str,
        expected_device_public_key: &str,
        expected_device_signing_public_key: &str,
        records: NookExternalEventLogRecords,
    ) -> Result<NookExtensionEventLogImportStatus, JsError> {
        let status = self
            .import_extension_event_log_records(
                expected_store_id,
                expected_device_id,
                expected_device_public_key,
                expected_device_signing_public_key,
                records.0,
            )
            .await?;
        Ok(NookExtensionEventLogImportStatus(status))
    }

    #[wasm_bindgen]
    pub fn event_log_mode(&self) -> bool {
        self.event_log.enabled
    }

    #[wasm_bindgen]
    pub async fn list_projection_conflicts(
        &self,
    ) -> Result<Vec<crate::NookReplacementConflict>, JsError> {
        let projection = self.load_projection_conflicts().await?;
        NookReplacementConflict::replacement_conflicts_to_vec(projection.replacement_conflicts)
            .map_err(Into::into)
    }

    #[wasm_bindgen]
    pub async fn list_projection_security_conflicts(
        &self,
    ) -> Result<Vec<crate::NookSecurityConflict>, JsError> {
        let projection = self.load_projection_conflicts().await?;
        NookSecurityConflict::security_conflicts_to_vec(projection.security_conflicts)
            .map_err(Into::into)
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use js_sys::{Array, JsString, Object, Reflect};
    use wasm_bindgen_test::*;

    #[derive(Serialize)]
    struct SignedEventBody {
        schema_version: u32,
    }

    #[derive(Serialize)]
    struct SignedEvent {
        #[serde(flatten)]
        body: SignedEventBody,
        signature: String,
    }

    #[derive(Serialize)]
    struct ExportedRecord {
        event_id: String,
        event: SignedEvent,
    }

    fn get(target: &js_sys::Object, field: &str) -> Result<js_sys::Object, wasm_bindgen::JsError> {
        Ok(Reflect::get(target, &JsString::from(field))
            .map_err(|_| JsError::new("failed to read reflected field"))?
            .unchecked_into())
    }

    fn get_number(target: &js_sys::Object, field: &str) -> Result<f64, wasm_bindgen::JsError> {
        Reflect::get(target, &JsString::from(field))
            .map_err(|_| JsError::new("failed to read reflected numeric field"))?
            .as_f64()
            .ok_or_else(|| JsError::new("field is not a number"))
    }

    fn get_string(target: &js_sys::Object, field: &str) -> Result<String, wasm_bindgen::JsError> {
        Reflect::get(target, &JsString::from(field))
            .map_err(|_| JsError::new("failed to read reflected string field"))?
            .as_string()
            .ok_or_else(|| JsError::new("field is not a string"))
    }

    fn get_bool(target: &js_sys::Object, field: &str) -> Result<bool, JsError> {
        Reflect::get(target, &JsString::from(field))
            .map_err(|_| JsError::new("failed to read reflected boolean field"))?
            .as_bool()
            .ok_or_else(|| JsError::new("field is not a boolean"))
    }

    fn get_array(target: &js_sys::Object, field: &str) -> Result<Array, JsError> {
        Reflect::get(target, &JsString::from(field))
            .map_err(|_| JsError::new("failed to read reflected array field"))
            .map(|value| value.unchecked_into())
    }

    fn event_fixture() -> Result<(nook_core::VaultEvent, String, String), JsError> {
        let (signing_identity, _) = nook_core::SigningIdentity::generate()
            .map_err(|error| JsError::new(&error.to_string()))?;
        let store_id =
            nook_core::StoreId::generate().map_err(|error| JsError::new(&error.to_string()))?;
        let key_epoch = nook_core::EventId::from_sha256_hex(
            nook_auth2::Sha256Hex::from_bytes(b"nook-wasm-event-log-wrapper-test").as_str(),
        )
        .map_err(|error| JsError::new(&error.to_string()))?;
        let actor_id = signing_identity
            .actor_id()
            .map_err(|error| JsError::new(&error.to_string()))?;
        let created_at = nook_core::IsoTimestamp::parse("2026-01-01T00:00:00Z")
            .map_err(|error| JsError::new(&error.to_string()))?;
        let (event, bytes) = nook_core::AppendEventInput::build(nook_core::AppendEventInput {
            store_id: &store_id,
            actor_id: &actor_id,
            signing_identity: &signing_identity,
            parents: Vec::new(),
            key_epoch: &key_epoch,
            created_at: &created_at,
            operations: vec![nook_core::VaultOperation::VaultCleared],
        })
        .map_err(|error| JsError::new(&error.to_string()))?;
        let event_id = event
            .id()
            .map_err(|error| JsError::new(&error.to_string()))?
            .to_string();
        let content =
            String::from_utf8(bytes.into()).map_err(|error| JsError::new(&error.to_string()))?;
        Ok((event, event_id, content))
    }

    #[wasm_bindgen_test]
    fn event_log_export_serializes_flattened_signed_events_as_plain_objects()
    -> Result<(), wasm_bindgen::JsError> {
        let value = serde_wasm_bindgen::to_value(&vec![ExportedRecord {
            event_id: "event-1".to_owned(),
            event: SignedEvent {
                body: SignedEventBody { schema_version: 1 },
                signature: "ed25519:test-signature".to_owned(),
            },
        }])
        .map_err(|error| JsError::new(&error.to_string()))?;
        let value: Array = value.unchecked_into();
        let record: js_sys::Object = value.get(0).unchecked_into();
        let event = get(&record, "event")?;

        assert_eq!(get_number(&event, "schema_version")?, 1.0);
        assert_eq!(get_string(&event, "signature")?, "ed25519:test-signature");
        Ok(())
    }

    #[wasm_bindgen_test]
    fn event_log_storage_records_round_trip_through_js_wrappers() -> Result<(), JsError> {
        let (event, event_id, content) = event_fixture()?;
        let records = NookEventLogRecords(vec![EventLogStorageRecord {
            event_id: event_id.clone(),
            path: "events/fixture.yaml".to_owned(),
            event: event.clone(),
        }]);
        let array: Array = serde_wasm_bindgen::to_value(&records.to_array())?.unchecked_into();
        assert_eq!(array.length(), 1);
        let record: Object = array.get(0).unchecked_into();
        assert_eq!(get_string(&record, "eventId")?, event_id);
        assert_eq!(get_string(&record, "path")?, "events/fixture.yaml");
        let event_object = get(&record, "event")?;
        assert_eq!(get_number(&event_object, "schema_version")?, 3.0);

        let manager = NookVaultManager::new();
        let parsed = manager.parse_event_log_storage_record_js(
            &get_string(&record, "eventId")?,
            &get_string(&record, "path")?,
            &content,
        )?;
        assert_eq!(
            manager.serialize_event_log_storage_record_js(&parsed)?,
            content
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn external_event_log_records_accept_valid_objects_and_reject_missing_events()
    -> Result<(), JsError> {
        let (event, event_id, _) = event_fixture()?;
        let valid = Object::new();
        Reflect::set(
            &valid,
            &JsString::from("eventId"),
            &JsString::from(event_id.as_str()),
        )
        .map_err(|_| JsError::new("failed to set event id"))?;
        let event_value = serde_wasm_bindgen::to_value(&event)?;
        Reflect::set(&valid, &JsString::from("event"), &event_value)
            .map_err(|_| JsError::new("failed to set event"))?;
        let valid_records = Array::new();
        valid_records.push(&valid);
        let admitted: Vec<ExternalEventLogRecord> =
            serde_wasm_bindgen::from_value(valid_records.into())?;
        let _records = NookExternalEventLogRecords::from_array(admitted);

        let malformed = Object::new();
        Reflect::set(
            &malformed,
            &JsString::from("eventId"),
            &JsString::from(event_id.as_str()),
        )
        .map_err(|_| JsError::new("failed to set malformed event id"))?;
        let malformed_records = Array::new();
        malformed_records.push(&malformed);
        assert!(
            serde_wasm_bindgen::from_value::<Vec<ExternalEventLogRecord>>(malformed_records.into())
                .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn extension_import_status_projects_plain_js_values() -> Result<(), JsError> {
        let status = NookExtensionEventLogImportStatus(ExtensionEventLogImportStatus {
            vault_store_id: "store-fixture".to_owned(),
            event_count: 3,
            heads: vec!["head-a".to_owned(), "head-b".to_owned()],
            access_granted: true,
        });
        let object = status.to_object()?;
        assert_eq!(object.vault_store_id, "store-fixture");
        assert_eq!(u32::from(object.event_count), 3);
        assert!(object.access_granted);
        assert_eq!(object.heads, ["head-a", "head-b"]);
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn empty_manager_exports_no_event_log_records() -> Result<(), JsError> {
        let manager = NookVaultManager::new();
        let records = manager.export_event_log_records_js().await?;
        assert_eq!(records.to_array().len(), 0);
        assert!(!manager.event_log_mode());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn event_log_sync_and_extension_import_fail_closed_without_a_vault() -> Result<(), JsError>
    {
        let mut manager = NookVaultManager::new();
        let synced = manager
            .sync_external_event_log_records_js(NookExternalEventLogRecords(Vec::new()))
            .await?;
        assert_eq!(synced.to_array().len(), 0);
        assert!(
            manager
                .import_extension_event_log_records_js(
                    "store-fixture",
                    "device-fixture",
                    "public-key-fixture",
                    "signing-key-fixture",
                    NookExternalEventLogRecords(Vec::new()),
                )
                .await
                .is_err()
        );
        Ok(())
    }
}
