use super::NookVaultManager;
use serde::Serialize;
use wasm_bindgen::{JsCast, JsError, prelude::wasm_bindgen};

fn serialize_js_array<T: Serialize>(value: &T) -> Result<js_sys::Array, serde_wasm_bindgen::Error> {
    Ok(value
        .serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true))?
        .unchecked_into())
}

#[wasm_bindgen]
pub struct NookEventLogStorageRecord(super::super::event_log::EventLogStorageRecord);

#[wasm_bindgen]
pub struct NookEventLogRecords(Vec<super::super::event_log::EventLogStorageRecord>);

#[wasm_bindgen]
impl NookEventLogRecords {
    #[wasm_bindgen(js_name = toArray)]
    pub fn to_array(&self) -> Result<js_sys::Array, JsError> {
        serialize_js_array(&self.0).map_err(|error| JsError::new(&error.to_string()))
    }
}

#[wasm_bindgen]
pub struct NookExternalEventLogRecords(Vec<super::super::event_log::ExternalEventLogRecord>);

#[wasm_bindgen]
impl NookExternalEventLogRecords {
    #[wasm_bindgen(js_name = fromArray)]
    pub fn from_array(records: &js_sys::Array) -> Result<Self, JsError> {
        let records = records
            .iter()
            .map(serde_wasm_bindgen::from_value)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self(records))
    }
}

#[wasm_bindgen]
pub struct NookExtensionEventLogImportStatus(
    super::super::event_log::ExtensionEventLogImportStatus,
);

#[wasm_bindgen]
impl NookExtensionEventLogImportStatus {
    #[wasm_bindgen(js_name = toObject)]
    pub fn to_object(&self) -> Result<js_sys::Object, JsError> {
        Ok(serde_wasm_bindgen::to_value(&self.0)?.unchecked_into())
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen(js_name = exportEventLogRecords)]
    pub async fn export_event_log_records_js(&self) -> Result<NookEventLogRecords, JsError> {
        let records = self.export_event_log_records().await?;
        Ok(NookEventLogRecords(records))
    }

    #[wasm_bindgen(js_name = parseEventLogStorageRecord)]
    pub fn parse_event_log_storage_record_js(
        &self,
        event_id: &str,
        path: &str,
        content: &str,
    ) -> Result<NookEventLogStorageRecord, JsError> {
        let record = Self::parse_event_log_storage_record(event_id, path, content)?;
        Ok(NookEventLogStorageRecord(record))
    }

    #[wasm_bindgen(js_name = serializeEventLogStorageRecord)]
    pub fn serialize_event_log_storage_record_js(
        &self,
        record: &NookEventLogStorageRecord,
    ) -> Result<String, JsError> {
        Ok(Self::serialize_event_log_storage_record(&record.0)?)
    }

    #[wasm_bindgen(js_name = syncExternalEventLogRecords)]
    pub async fn sync_external_event_log_records_js(
        &mut self,
        records: NookExternalEventLogRecords,
    ) -> Result<NookEventLogRecords, JsError> {
        let merged = self.sync_external_event_log_records(records.0).await?;
        Ok(NookEventLogRecords(merged))
    }

    #[wasm_bindgen(js_name = importExtensionEventLogRecords)]
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

    #[wasm_bindgen(js_name = eventLogMode)]
    pub fn event_log_mode(&self) -> bool {
        self.event_log.enabled
    }

    #[wasm_bindgen(js_name = listProjectionConflicts)]
    pub async fn list_projection_conflicts(
        &self,
    ) -> Result<Vec<crate::NookReplacementConflict>, JsError> {
        let projection = self.load_projection_conflicts().await?;
        crate::types::replacement_conflicts_to_vec(projection.replacement_conflicts)
            .map_err(Into::into)
    }

    #[wasm_bindgen(js_name = listProjectionSecurityConflicts)]
    pub async fn list_projection_security_conflicts(
        &self,
    ) -> Result<Vec<crate::NookSecurityConflict>, JsError> {
        let projection = self.load_projection_conflicts().await?;
        crate::types::security_conflicts_to_vec(projection.security_conflicts).map_err(Into::into)
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
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
        Ok(js_sys::Reflect::get(target, &js_sys::JsString::from(field))
            .map_err(|_| wasm_bindgen::JsError::new("failed to read reflected field"))?
            .unchecked_into())
    }

    fn get_number(target: &js_sys::Object, field: &str) -> Result<f64, wasm_bindgen::JsError> {
        js_sys::Reflect::get(target, &js_sys::JsString::from(field))
            .map_err(|_| wasm_bindgen::JsError::new("failed to read reflected numeric field"))?
            .as_f64()
            .ok_or_else(|| wasm_bindgen::JsError::new("field is not a number"))
    }

    fn get_string(target: &js_sys::Object, field: &str) -> Result<String, wasm_bindgen::JsError> {
        js_sys::Reflect::get(target, &js_sys::JsString::from(field))
            .map_err(|_| wasm_bindgen::JsError::new("failed to read reflected string field"))?
            .as_string()
            .ok_or_else(|| wasm_bindgen::JsError::new("field is not a string"))
    }

    #[wasm_bindgen_test]
    fn event_log_export_serializes_flattened_signed_events_as_plain_objects()
    -> Result<(), wasm_bindgen::JsError> {
        let value = serialize_js_array(&vec![ExportedRecord {
            event_id: "event-1".to_owned(),
            event: SignedEvent {
                body: SignedEventBody { schema_version: 1 },
                signature: "ed25519:test-signature".to_owned(),
            },
        }])
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        let record: js_sys::Object = value.get(0).unchecked_into();
        let event = get(&record, "event")?;

        assert_eq!(get_number(&event, "schema_version")?, 1.0);
        assert_eq!(get_string(&event, "signature")?, "ed25519:test-signature");
        Ok(())
    }
}
