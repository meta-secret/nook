use super::{DeliveryCheck, DeliveryLabel, DeliveryPullRequest};
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
    #[serde(default)]
    merge_commit: super::DeliveryMerge,
    #[serde(default)]
    status_check_rollup: CheckRollup,
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
            status_check_rollup: match wire.status_check_rollup {
                CheckRollup::Checks(checks) => checks,
                CheckRollup::Unavailable => Vec::new(),
            },
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(untagged)]
enum CheckRollup {
    Checks(Vec<DeliveryCheck>),
    #[default]
    Unavailable,
}
