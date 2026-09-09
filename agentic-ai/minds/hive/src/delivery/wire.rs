use super::{DeliveryCheck, DeliveryCommit, DeliveryLabel, DeliveryPullRequest};
use serde::Deserialize;

/// GitHub can omit the rollup or return null before checks are available.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireDeliveryPullRequest {
    number: u64,
    title: String,
    state: String,
    head_ref_name: String,
    head_ref_oid: String,
    is_cross_repository: bool,
    labels: Vec<DeliveryLabel>,
    merge_commit: Option<DeliveryCommit>,
    #[serde(default)]
    status_check_rollup: Option<Vec<DeliveryCheck>>,
}

impl From<WireDeliveryPullRequest> for DeliveryPullRequest {
    fn from(wire: WireDeliveryPullRequest) -> Self {
        Self {
            number: wire.number,
            title: wire.title,
            state: wire.state,
            head_ref_name: wire.head_ref_name,
            head_ref_oid: wire.head_ref_oid,
            is_cross_repository: wire.is_cross_repository,
            labels: wire.labels,
            merge_commit: wire.merge_commit,
            status_check_rollup: wire.status_check_rollup.unwrap_or_default(),
        }
    }
}
