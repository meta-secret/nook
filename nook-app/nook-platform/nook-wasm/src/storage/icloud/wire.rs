//! CloudKit request schemas. Optional fields preserve CloudKit wire omission.
use serde::Serialize;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ICloudZone {
    pub(super) zone_name: String,
    pub(super) owner_record_name: String,
}
#[derive(Serialize)]
pub(super) struct ICloudRequest<T: Serialize> {
    #[serde(flatten)]
    pub(super) payload: T,
    #[serde(rename = "zoneID", skip_serializing_if = "Option::is_none")]
    pub(super) zone: Option<ICloudZone>,
}
#[derive(Serialize)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) continuation_marker: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) parent: Option<ICloudRecordReference>,
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
