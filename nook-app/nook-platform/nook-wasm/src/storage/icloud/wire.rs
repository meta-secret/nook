//! CloudKit request schemas. Optional fields preserve CloudKit wire omission.
use super::ICloudEventStore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ICloudZone {
    pub(super) zone_name: String,
    pub(super) owner_record_name: String,
}
#[derive(Serialize)]
pub(super) struct ICloudRequest<T: Serialize> {
    #[serde(flatten)]
    pub(super) payload: T,
    #[serde(rename = "zoneID", skip_serializing_if = "ZoneSelection::is_default")]
    pub(super) zone: ZoneSelection,
}
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ICloudRecordReference {
    pub(super) record_name: String,
}
#[derive(Serialize)]
pub(super) struct ICloudLookup {
    pub(super) records: [ICloudRecordReference; 1],
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ICloudQuery {
    pub(super) record_type: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ICloudQueryPage {
    pub(super) query: ICloudQuery,
    pub(super) results_limit: u16,
    #[serde(skip_serializing_if = "QueryContinuation::is_first")]
    pub(super) continuation_marker: QueryContinuation,
}
#[derive(Serialize)]
pub(super) struct ICloudCreate {
    pub(super) operations: [ICloudCreateOperation; 1],
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ICloudCreateOperation {
    pub(super) operation_type: &'static str,
    pub(super) record: ICloudCreateRecord,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ICloudCreateRecord {
    pub(super) record_type: &'static str,
    pub(super) record_name: String,
    pub(super) fields: ICloudEventFields,
    #[serde(skip_serializing_if = "RecordHierarchy::is_root")]
    pub(super) parent: RecordHierarchy,
}
#[derive(Serialize)]
pub(super) struct ICloudEventFields {
    pub(super) event_id: ICloudTextField,
    pub(super) content: ICloudTextField,
}
#[derive(Serialize)]
pub(super) struct ICloudTextField {
    pub(super) value: String,
}

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub(super) enum ZoneSelection {
    Named(ICloudZone),
    #[default]
    DefaultZone,
}
impl ZoneSelection {
    pub(super) fn is_default(&self) -> bool {
        matches!(self, Self::DefaultZone)
    }
}
#[derive(Clone, Serialize)]
#[serde(untagged)]
pub(super) enum QueryContinuation {
    Continue(String),
    FirstPage,
}
impl QueryContinuation {
    pub(super) fn is_first(&self) -> bool {
        matches!(self, Self::FirstPage)
    }
}
#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub(super) enum RecordHierarchy {
    Child(ICloudRecordReference),
    #[default]
    Root,
}
impl RecordHierarchy {
    pub(super) fn is_root(&self) -> bool {
        matches!(self, Self::Root)
    }
}
#[derive(Default, Deserialize)]
#[serde(untagged)]
pub(super) enum QueryCompletion {
    Continue(String),
    #[default]
    Complete,
}
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub(super) enum FieldText {
    Text(String),
    #[default]
    Unset,
}
#[derive(Deserialize)]
pub(super) struct ICloudFieldValue {
    #[serde(default)]
    pub(super) value: FieldText,
}
#[derive(Default, Deserialize)]
#[serde(untagged)]
pub(super) enum RecordFields {
    Declared(HashMap<String, ICloudFieldValue>),
    #[default]
    Undisclosed,
}
#[derive(Deserialize)]
pub(super) struct ICloudRecord {
    #[serde(rename = "recordName")]
    pub(super) record_name: String,
    #[serde(default)]
    pub(super) fields: RecordFields,
}
#[derive(Deserialize)]
pub(super) struct ICloudRecordsResponse {
    #[serde(default)]
    pub(super) records: Vec<ICloudRecord>,
    #[serde(rename = "continuationMarker", default)]
    pub(super) continuation_marker: QueryCompletion,
}
pub(super) enum RecordLookup {
    Missing,
    Loaded(ICloudRecord),
}
#[derive(Debug, PartialEq, Eq)]
pub(super) enum EventIdentity {
    Missing,
    Declared(String),
    NameDerived(String),
}
impl ICloudRecord {
    pub(super) fn content(&self) -> FieldText {
        self.field(super::ICLOUD_CONTENT_FIELD)
    }
    pub(super) fn field(&self, name: &str) -> FieldText {
        match &self.fields {
            RecordFields::Undisclosed => FieldText::Unset,
            RecordFields::Declared(fields) => match fields.get(name) {
                Some(field) => field.value.clone(),
                None => FieldText::Unset,
            },
        }
    }
    pub(super) fn event_id(&self) -> EventIdentity {
        match self.field(super::ICLOUD_EVENT_ID_FIELD) {
            FieldText::Text(id) => EventIdentity::Declared(id),
            FieldText::Unset => match self.record_name.strip_prefix("nook-event-") {
                Some(digest) if ICloudEventStore::is_sha256_base64url_digest(digest) => {
                    EventIdentity::NameDerived(format!("sha256u:{digest}"))
                }
                _ => EventIdentity::Missing,
            },
        }
    }
}
