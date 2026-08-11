//! Typed runtime response boundary for authentication workflow snapshots.

use crate::authentication_workflow::AuthenticationWorkflowSnapshot;
use serde::{Deserialize, Serialize, Serializer};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

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
#[serde(untagged, rename_all_fields = "camelCase")]
#[tsify(from_wasm_abi)]
pub enum AuthenticationWorkflowSnapshotResponseWire {
    Matched(AuthenticationWorkflowMatchedResponseWire),
    Rejected(AuthenticationWorkflowRejectedResponseWire),
    NoMatch(AuthenticationWorkflowNoMatchResponseWire),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(untagged)]
#[tsify(into_wasm_abi)]
pub enum AuthenticationWorkflowSnapshotResponse {
    Matched {
        kind: AuthenticationWorkflowSnapshotResponseKind,
        snapshot: AuthenticationWorkflowSnapshot,
    },
    NoMatch {
        kind: AuthenticationWorkflowSnapshotResponseKind,
    },
    Rejected {
        kind: AuthenticationWorkflowSnapshotResponseKind,
        reason: String,
    },
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticationWorkflowSnapshotResponseKind {
    Matched,
    NoMatch,
    Rejected,
}

impl Serialize for AuthenticationWorkflowSnapshotResponseKind {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(*self as u8)
    }
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
        ) => Ok(AuthenticationWorkflowSnapshotResponse::Matched {
            kind: AuthenticationWorkflowSnapshotResponseKind::Matched,
            snapshot,
        }),
        AuthenticationWorkflowSnapshotResponseWire::NoMatch(
            AuthenticationWorkflowNoMatchResponseWire { ok: true },
        ) => Ok(AuthenticationWorkflowSnapshotResponse::NoMatch {
            kind: AuthenticationWorkflowSnapshotResponseKind::NoMatch,
        }),
        AuthenticationWorkflowSnapshotResponseWire::Rejected(
            AuthenticationWorkflowRejectedResponseWire { ok: false, reason },
        ) if !reason.trim().is_empty() => Ok(AuthenticationWorkflowSnapshotResponse::Rejected {
            kind: AuthenticationWorkflowSnapshotResponseKind::Rejected,
            reason,
        }),
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

        let no_match = AuthenticationWorkflowSnapshotResponseWire::NoMatch(
            AuthenticationWorkflowNoMatchResponseWire { ok: true },
        );
        assert_eq!(
            decode_authentication_workflow_snapshot_response(no_match)?,
            AuthenticationWorkflowSnapshotResponse::NoMatch {
                kind: AuthenticationWorkflowSnapshotResponseKind::NoMatch,
            }
        );

        let rejected = AuthenticationWorkflowSnapshotResponseWire::Rejected(
            AuthenticationWorkflowRejectedResponseWire {
                ok: false,
                reason: "vault-locked".to_owned(),
            },
        );
        assert_eq!(
            decode_authentication_workflow_snapshot_response(rejected)?,
            AuthenticationWorkflowSnapshotResponse::Rejected {
                kind: AuthenticationWorkflowSnapshotResponseKind::Rejected,
                reason: "vault-locked".to_owned(),
            }
        );

        let contradictory_matched = serde_json::from_str::<
            AuthenticationWorkflowSnapshotResponseWire,
        >(
            r#"{"ok":false,"snapshot":{"kind":0,"stage":0,"action":0,"currentStep":1,"totalSteps":3,"requiresHumanApproval":true,"observationIndex":0}}"#,
        )?;
        assert_eq!(
            decode_authentication_workflow_snapshot_response(contradictory_matched),
            Err(AuthenticationWorkflowSnapshotResponseDecodeError)
        );

        for malformed in [
            AuthenticationWorkflowSnapshotResponseWire::NoMatch(
                AuthenticationWorkflowNoMatchResponseWire { ok: false },
            ),
            AuthenticationWorkflowSnapshotResponseWire::Rejected(
                AuthenticationWorkflowRejectedResponseWire {
                    ok: true,
                    reason: "vault-locked".to_owned(),
                },
            ),
            AuthenticationWorkflowSnapshotResponseWire::Rejected(
                AuthenticationWorkflowRejectedResponseWire {
                    ok: false,
                    reason: " ".to_owned(),
                },
            ),
        ] {
            assert_eq!(
                decode_authentication_workflow_snapshot_response(malformed),
                Err(AuthenticationWorkflowSnapshotResponseDecodeError)
            );
        }
        Ok(())
    }
}
