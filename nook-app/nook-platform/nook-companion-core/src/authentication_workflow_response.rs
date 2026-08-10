//! Typed runtime response boundary for authentication workflow snapshots.

use crate::authentication_workflow::AuthenticationWorkflowSnapshot;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AuthenticationWorkflowMatchedResponseWire {
    ok: bool,
    snapshot: AuthenticationWorkflowSnapshot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationWorkflowNoMatchResponseWire {
    ok: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationWorkflowRejectedResponseWire {
    ok: bool,
    reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(untagged)]
#[tsify(from_wasm_abi)]
pub enum AuthenticationWorkflowSnapshotResponseWire {
    Matched(AuthenticationWorkflowMatchedResponseWire),
    Rejected(AuthenticationWorkflowRejectedResponseWire),
    NoMatch(AuthenticationWorkflowNoMatchResponseWire),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
#[tsify(into_wasm_abi)]
pub enum AuthenticationWorkflowSnapshotResponse {
    Matched {
        snapshot: AuthenticationWorkflowSnapshot,
    },
    NoMatch,
    Rejected {
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("authentication workflow snapshot response is malformed")]
pub struct AuthenticationWorkflowSnapshotResponseDecodeError;

pub fn decode_authentication_workflow_snapshot_response(
    wire: AuthenticationWorkflowSnapshotResponseWire,
) -> Result<AuthenticationWorkflowSnapshotResponse, AuthenticationWorkflowSnapshotResponseDecodeError>
{
    match wire {
        AuthenticationWorkflowSnapshotResponseWire::Matched(
            AuthenticationWorkflowMatchedResponseWire { ok: true, snapshot },
        ) => Ok(AuthenticationWorkflowSnapshotResponse::Matched { snapshot }),
        AuthenticationWorkflowSnapshotResponseWire::NoMatch(
            AuthenticationWorkflowNoMatchResponseWire { ok: true },
        ) => Ok(AuthenticationWorkflowSnapshotResponse::NoMatch),
        AuthenticationWorkflowSnapshotResponseWire::Rejected(
            AuthenticationWorkflowRejectedResponseWire { ok: false, reason },
        ) if !reason.trim().is_empty() => {
            Ok(AuthenticationWorkflowSnapshotResponse::Rejected { reason })
        }
        AuthenticationWorkflowSnapshotResponseWire::Matched(_)
        | AuthenticationWorkflowSnapshotResponseWire::NoMatch(_)
        | AuthenticationWorkflowSnapshotResponseWire::Rejected(_) => {
            Err(AuthenticationWorkflowSnapshotResponseDecodeError)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enforces_the_rust_snapshot_contract() -> anyhow::Result<()> {
        let valid = serde_json::from_str::<AuthenticationWorkflowSnapshotResponseWire>(
            r#"{"ok":true,"snapshot":{"kind":0,"stage":0,"action":0,"currentStep":1,"totalSteps":3,"requiresHumanApproval":true,"observationIndex":0}}"#,
        )?;
        assert!(matches!(
            decode_authentication_workflow_snapshot_response(valid)?,
            AuthenticationWorkflowSnapshotResponse::Matched { .. }
        ));

        assert!(
            serde_json::from_str::<AuthenticationWorkflowSnapshotResponseWire>(
                r#"{"ok":true,"snapshot":{"kind":0,"stage":0,"action":0,"currentStep":-1,"totalSteps":300,"requiresHumanApproval":true,"observationIndex":-1}}"#,
            )
            .is_err()
        );
        Ok(())
    }
}
