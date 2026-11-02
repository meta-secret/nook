//! `CloudKit` request schemas. Optional fields preserve `CloudKit` wire omission.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::storage::omittable_list::OmittableList;

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
    #[serde(rename = "zoneID")]
    pub(super) zone: ICloudZone,
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
    pub(super) filter_by: Vec<ICloudFilter>,
}
/// One query condition on a queryable string field.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ICloudFilter {
    pub(super) comparator: &'static str,
    pub(super) field_name: &'static str,
    pub(super) field_value: ICloudTextField,
}
/// Force-delete records by name, one request per page of records.
#[derive(Serialize)]
pub(super) struct ICloudDelete {
    pub(super) operations: Vec<ICloudDeleteOperation>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ICloudDeleteOperation {
    pub(super) operation_type: &'static str,
    pub(super) record: ICloudRecordReference,
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
    /// Every event record is a child of the share root, so it joins the share.
    pub(super) parent: ICloudRecordReference,
}
#[derive(Serialize)]
pub(super) struct ICloudEventFields {
    pub(super) location: ICloudTextField,
    pub(super) event_id: ICloudTextField,
    pub(super) content: ICloudTextField,
}
#[derive(Serialize)]
pub(super) struct ICloudTextField {
    pub(super) value: String,
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
/// Boundary conversion: `CloudKit`'s optional `continuationMarker`, read here as continue or complete.
#[derive(Debug, PartialEq, Eq, Deserialize)]
#[serde(from = "Option<String>")]
pub(super) enum QueryCompletion {
    Continue(String),
    Complete,
}
impl From<Option<String>> for QueryCompletion {
    fn from(marker: Option<String>) -> Self {
        match marker {
            Some(marker) => Self::Continue(marker),
            None => Self::Complete,
        }
    }
}
/// One record field's text, or that the record does not carry the field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum FieldText {
    Text(String),
    Unset,
}
/// A field object always carries its value.
#[derive(Deserialize)]
pub(super) struct ICloudFieldValue {
    pub(super) value: String,
}
/// Boundary conversion: `CloudKit`'s optional record `fields`, read here as declared or undisclosed.
#[derive(Deserialize)]
#[serde(from = "Option<HashMap<String, ICloudFieldValue>>")]
pub(super) enum RecordFields {
    Declared(HashMap<String, ICloudFieldValue>),
    Undisclosed,
}
impl From<Option<HashMap<String, ICloudFieldValue>>> for RecordFields {
    fn from(fields: Option<HashMap<String, ICloudFieldValue>>) -> Self {
        match fields {
            Some(fields) => Self::Declared(fields),
            None => Self::Undisclosed,
        }
    }
}
#[derive(Deserialize)]
pub(super) struct ICloudRecord {
    #[serde(rename = "recordName")]
    pub(super) record_name: String,
    pub(super) fields: RecordFields,
}
/// One page of a `records/query` answer.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ICloudQueryResponse {
    pub(super) records: OmittableList<ICloudRecord>,
    pub(super) continuation_marker: QueryCompletion,
}
/// A `records/lookup` or `records/modify` answer: one result per requested
/// record or operation, so `records` is always there.
#[derive(Deserialize)]
pub(super) struct ICloudRecordsResponse {
    pub(super) records: Vec<ICloudRecord>,
}
pub(super) enum RecordLookup {
    Missing,
    Loaded(ICloudRecord),
}
#[derive(Debug, PartialEq, Eq)]
pub(super) enum EventIdentity {
    Missing,
    Declared(String),
}
impl ICloudRecord {
    pub(super) fn content(&self) -> FieldText {
        self.field(super::ICLOUD_CONTENT_FIELD)
    }
    pub(super) fn field(&self, name: &str) -> FieldText {
        match &self.fields {
            RecordFields::Undisclosed => FieldText::Unset,
            RecordFields::Declared(fields) => match fields.get(name) {
                Some(field) => FieldText::Text(field.value.clone()),
                None => FieldText::Unset,
            },
        }
    }
    pub(super) fn event_id(&self) -> EventIdentity {
        match self.field(super::ICLOUD_EVENT_ID_FIELD) {
            FieldText::Text(id) => EventIdentity::Declared(id),
            FieldText::Unset => EventIdentity::Missing,
        }
    }
    pub(super) fn location(&self) -> FieldText {
        self.field(super::ICLOUD_LOCATION_FIELD)
    }
}
