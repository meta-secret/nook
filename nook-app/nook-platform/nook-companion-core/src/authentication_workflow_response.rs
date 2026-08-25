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
#[serde(untagged, rename_all_fields = "camelCase")]
#[tsify(from_wasm_abi)]
pub enum AuthenticationWorkflowSnapshotResponseWire {
    Matched(AuthenticationWorkflowMatchedResponseWire),
    Rejected(AuthenticationWorkflowRejectedResponseWire),
    NoMatch(AuthenticationWorkflowNoMatchResponseWire),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum WebsiteLoginMatchAvailabilityKind {
    Ready,
    Locked,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WebsiteLoginMatchAvailabilityWithCountWire {
    kind: WebsiteLoginMatchAvailabilityKind,
    count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WebsiteLoginMatchAvailabilityWithoutCountWire {
    kind: WebsiteLoginMatchAvailabilityKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(untagged)]
#[tsify(from_wasm_abi)]
pub enum WebsiteLoginMatchAvailabilityWire {
    WithCount(WebsiteLoginMatchAvailabilityWithCountWire),
    WithoutCount(WebsiteLoginMatchAvailabilityWithoutCountWire),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[tsify(into_wasm_abi)]
pub enum WebsiteLoginMatchAvailability {
    Ready { count: u32 },
    Locked,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(from_wasm_abi)]
pub struct AuthenticationWorkflowRuntimeResponseWire {
    workflow: AuthenticationWorkflowSnapshotResponseWire,
    login_matches: WebsiteLoginMatchAvailabilityWire,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub struct AuthenticationWorkflowRuntimeResponse {
    pub workflow: AuthenticationWorkflowSnapshotResponse,
    pub login_matches: WebsiteLoginMatchAvailability,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("authentication workflow snapshot response is malformed")]
pub struct AuthenticationWorkflowSnapshotResponseDecodeError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("authentication workflow runtime response is malformed")]
pub struct AuthenticationWorkflowRuntimeResponseDecodeError;

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

pub fn decode_authentication_workflow_runtime_response(
    wire: AuthenticationWorkflowRuntimeResponseWire,
) -> Result<AuthenticationWorkflowRuntimeResponse, AuthenticationWorkflowRuntimeResponseDecodeError>
{
    let workflow = decode_authentication_workflow_snapshot_response(wire.workflow)
        .map_err(|_| AuthenticationWorkflowRuntimeResponseDecodeError)?;
    let login_matches = match wire.login_matches {
        WebsiteLoginMatchAvailabilityWire::WithCount(
            WebsiteLoginMatchAvailabilityWithCountWire {
                kind: WebsiteLoginMatchAvailabilityKind::Ready,
                count,
            },
        ) => WebsiteLoginMatchAvailability::Ready { count },
        WebsiteLoginMatchAvailabilityWire::WithoutCount(
            WebsiteLoginMatchAvailabilityWithoutCountWire {
                kind: WebsiteLoginMatchAvailabilityKind::Locked,
            },
        ) => WebsiteLoginMatchAvailability::Locked,
        WebsiteLoginMatchAvailabilityWire::WithoutCount(
            WebsiteLoginMatchAvailabilityWithoutCountWire {
                kind: WebsiteLoginMatchAvailabilityKind::Unavailable,
            },
        ) => WebsiteLoginMatchAvailability::Unavailable,
        WebsiteLoginMatchAvailabilityWire::WithCount(_)
        | WebsiteLoginMatchAvailabilityWire::WithoutCount(_) => {
            return Err(AuthenticationWorkflowRuntimeResponseDecodeError);
        }
    };
    Ok(AuthenticationWorkflowRuntimeResponse {
        workflow,
        login_matches,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enforces_the_rust_snapshot_contract() -> anyhow::Result<()> {
        let valid = serde_json::from_str::<AuthenticationWorkflowSnapshotResponseWire>(
            r#"{"ok":true,"snapshot":{"kind":"login","stage":"credentials","action":"continue-with-nook","currentStep":1,"totalSteps":3,"approvalRequirement":"explicit-user-approval","observationIndex":0}}"#,
        )?;
        assert!(matches!(
            decode_authentication_workflow_snapshot_response(valid)?,
            AuthenticationWorkflowSnapshotResponse::Matched { .. }
        ));

        assert!(
            serde_json::from_str::<AuthenticationWorkflowSnapshotResponseWire>(
                r#"{"ok":true,"snapshot":{"kind":"login","stage":"credentials","action":"continue-with-nook","currentStep":-1,"totalSteps":300,"approvalRequirement":"explicit-user-approval","observationIndex":-1}}"#,
            )
            .is_err()
        );

        let no_match = AuthenticationWorkflowSnapshotResponseWire::NoMatch(
            AuthenticationWorkflowNoMatchResponseWire { ok: true },
        );
        assert_eq!(
            decode_authentication_workflow_snapshot_response(no_match)?,
            AuthenticationWorkflowSnapshotResponse::NoMatch
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
                reason: "vault-locked".to_owned(),
            }
        );

        let contradictory_matched = serde_json::from_str::<
            AuthenticationWorkflowSnapshotResponseWire,
        >(
            r#"{"ok":false,"snapshot":{"kind":"login","stage":"credentials","action":"continue-with-nook","currentStep":1,"totalSteps":3,"approvalRequirement":"explicit-user-approval","observationIndex":0}}"#,
        )?;
        assert_eq!(
            decode_authentication_workflow_snapshot_response(contradictory_matched),
            Err(AuthenticationWorkflowSnapshotResponseDecodeError)
        );

        assert!(
            serde_json::from_str::<AuthenticationWorkflowSnapshotResponseWire>(
                r#"{"ok":true,"snapshot":{"kind":"login","stage":"credentials","action":"continue-with-nook","currentStep":1,"totalSteps":3,"observationIndex":0}}"#,
            )
            .is_err()
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

    #[test]
    fn enforces_the_runtime_login_match_envelope() -> anyhow::Result<()> {
        for availability in [
            r#"{"kind":"ready","count":0}"#,
            r#"{"kind":"locked"}"#,
            r#"{"kind":"unavailable"}"#,
        ] {
            let json = format!(r#"{{"workflow":{{"ok":true}},"loginMatches":{availability}}}"#);
            let wire = serde_json::from_str::<AuthenticationWorkflowRuntimeResponseWire>(&json)?;
            assert!(decode_authentication_workflow_runtime_response(wire).is_ok());
        }

        for malformed_wire in [
            r#"{"workflow":{"ok":true},"loginMatches":{"kind":"ready","count":-1}}"#,
            r#"{"workflow":{"ok":true},"loginMatches":{"kind":"other"}}"#,
        ] {
            assert!(
                serde_json::from_str::<AuthenticationWorkflowRuntimeResponseWire>(malformed_wire)
                    .is_err(),
                "accepted malformed runtime response: {malformed_wire}",
            );
        }

        for contradictory_wire in [
            r#"{"workflow":{"ok":true},"loginMatches":{"kind":"ready"}}"#,
            r#"{"workflow":{"ok":true},"loginMatches":{"kind":"locked","count":0}}"#,
            r#"{"workflow":{"ok":true},"loginMatches":{"kind":"unavailable","count":0}}"#,
        ] {
            let wire = serde_json::from_str::<AuthenticationWorkflowRuntimeResponseWire>(
                contradictory_wire,
            )?;
            assert_eq!(
                decode_authentication_workflow_runtime_response(wire),
                Err(AuthenticationWorkflowRuntimeResponseDecodeError),
            );
        }
        Ok(())
    }
}
