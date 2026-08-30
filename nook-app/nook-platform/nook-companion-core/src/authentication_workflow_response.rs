//! Typed runtime response boundary for authentication workflow snapshots.

use crate::authentication_workflow::{
    AuthenticationApprovalRequirement, AuthenticationSavedLoginCapability,
    AuthenticationWorkflowAction, AuthenticationWorkflowKind, AuthenticationWorkflowSnapshot,
    AuthenticationWorkflowStage,
};
use serde::{Deserialize, Serialize, Serializer};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AuthenticationWorkflowSnapshotWire {
    kind: AuthenticationWorkflowKind,
    stage: AuthenticationWorkflowStage,
    action: AuthenticationWorkflowAction,
    current_step: u8,
    total_steps: u8,
    approval_requirement: AuthenticationApprovalRequirement,
    saved_login_capability: crate::authentication_workflow::AuthenticationSavedLoginCapability,
    observation_index: u32,
}

impl AuthenticationWorkflowSnapshotWire {
    const fn into_snapshot(self) -> Option<AuthenticationWorkflowSnapshot> {
        let snapshot = AuthenticationWorkflowSnapshot {
            kind: self.kind,
            stage: self.stage,
            action: self.action,
            current_step: self.current_step,
            total_steps: self.total_steps,
            approval_requirement: self.approval_requirement,
            saved_login_capability: self.saved_login_capability,
            observation_index: self.observation_index,
        };
        if snapshot.matches_classifier_contract() {
            Some(snapshot)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AuthenticationWorkflowMatchedResponseWire {
    ok: bool,
    snapshot: AuthenticationWorkflowSnapshotWire,
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
        ) => {
            let Some(snapshot) = snapshot.into_snapshot() else {
                return Err(AuthenticationWorkflowSnapshotResponseDecodeError);
            };
            Ok(AuthenticationWorkflowSnapshotResponse::Matched {
                kind: AuthenticationWorkflowSnapshotResponseKind::Matched,
                snapshot,
            })
        }
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
    let login_matches_match_workflow = match (login_matches, &workflow) {
        (
            WebsiteLoginMatchAvailability::Ready { count: 0 }
            | WebsiteLoginMatchAvailability::Locked
            | WebsiteLoginMatchAvailability::Unavailable,
            _,
        ) => true,
        (
            WebsiteLoginMatchAvailability::Ready { .. },
            AuthenticationWorkflowSnapshotResponse::Matched { snapshot, .. },
        ) => {
            snapshot.saved_login_capability() == AuthenticationSavedLoginCapability::FillSavedLogin
        }
        (WebsiteLoginMatchAvailability::Ready { .. }, _) => false,
    };
    if !login_matches_match_workflow {
        return Err(AuthenticationWorkflowRuntimeResponseDecodeError);
    }
    Ok(AuthenticationWorkflowRuntimeResponse {
        workflow,
        login_matches,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enforces_closed_approval_requirements() -> anyhow::Result<()> {
        for mismatched in [
            r#"{"ok":true,"snapshot":{"kind":0,"stage":0,"action":0,"currentStep":1,"totalSteps":3,"approvalRequirement":"takeover-required","savedLoginCapability":"unavailable","observationIndex":0}}"#,
            r#"{"ok":true,"snapshot":{"kind":0,"stage":5,"action":6,"currentStep":1,"totalSteps":3,"approvalRequirement":"explicit-user-approval","savedLoginCapability":"unavailable","observationIndex":0}}"#,
        ] {
            let wire =
                serde_json::from_str::<AuthenticationWorkflowSnapshotResponseWire>(mismatched)?;
            assert_eq!(
                decode_authentication_workflow_snapshot_response(wire),
                Err(AuthenticationWorkflowSnapshotResponseDecodeError)
            );
        }

        let takeover = serde_json::from_str::<AuthenticationWorkflowSnapshotResponseWire>(
            r#"{"ok":true,"snapshot":{"kind":0,"stage":5,"action":6,"currentStep":1,"totalSteps":3,"approvalRequirement":"takeover-required","savedLoginCapability":"unavailable","observationIndex":0}}"#,
        )?;
        assert!(matches!(
            decode_authentication_workflow_snapshot_response(takeover)?,
            AuthenticationWorkflowSnapshotResponse::Matched {
                snapshot: AuthenticationWorkflowSnapshot {
                    approval_requirement: AuthenticationApprovalRequirement::TakeoverRequired,
                    ..
                },
                ..
            }
        ));

        for legacy_or_unknown in [
            r#"{"ok":true,"snapshot":{"kind":0,"stage":0,"action":0,"currentStep":1,"totalSteps":3,"requiresHumanApproval":true,"savedLoginCapability":"fill-saved-login","observationIndex":0}}"#,
            r#"{"ok":true,"snapshot":{"kind":0,"stage":0,"action":0,"currentStep":1,"totalSteps":3,"approvalRequirement":"automatic","savedLoginCapability":"fill-saved-login","observationIndex":0}}"#,
        ] {
            assert!(
                serde_json::from_str::<AuthenticationWorkflowSnapshotResponseWire>(
                    legacy_or_unknown
                )
                .is_err()
            );
        }
        Ok(())
    }

    #[test]
    fn enforces_the_rust_snapshot_contract() -> anyhow::Result<()> {
        let valid = serde_json::from_str::<AuthenticationWorkflowSnapshotResponseWire>(
            r#"{"ok":true,"snapshot":{"kind":0,"stage":0,"action":0,"currentStep":1,"totalSteps":3,"approvalRequirement":"explicit-user-approval","savedLoginCapability":"fill-saved-login","observationIndex":0}}"#,
        )?;
        assert!(matches!(
            decode_authentication_workflow_snapshot_response(valid)?,
            AuthenticationWorkflowSnapshotResponse::Matched { .. }
        ));

        assert!(
            serde_json::from_str::<AuthenticationWorkflowSnapshotResponseWire>(
                r#"{"ok":true,"snapshot":{"kind":0,"stage":0,"action":0,"currentStep":-1,"totalSteps":300,"approvalRequirement":"explicit-user-approval","savedLoginCapability":"fill-saved-login","observationIndex":-1}}"#,
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
            r#"{"ok":false,"snapshot":{"kind":0,"stage":0,"action":0,"currentStep":1,"totalSteps":3,"approvalRequirement":"explicit-user-approval","savedLoginCapability":"fill-saved-login","observationIndex":0}}"#,
        )?;
        assert_eq!(
            decode_authentication_workflow_snapshot_response(contradictory_matched),
            Err(AuthenticationWorkflowSnapshotResponseDecodeError)
        );

        let impossible_snapshot = serde_json::from_str::<AuthenticationWorkflowSnapshotResponseWire>(
            r#"{"ok":true,"snapshot":{"kind":0,"stage":0,"action":6,"currentStep":1,"totalSteps":3,"approvalRequirement":"takeover-required","savedLoginCapability":"unavailable","observationIndex":0}}"#,
        )?;
        assert_eq!(
            decode_authentication_workflow_snapshot_response(impossible_snapshot),
            Err(AuthenticationWorkflowSnapshotResponseDecodeError)
        );

        let out_of_bounds_observation = serde_json::from_str::<
            AuthenticationWorkflowSnapshotResponseWire,
        >(
            r#"{"ok":true,"snapshot":{"kind":0,"stage":0,"action":0,"currentStep":1,"totalSteps":3,"approvalRequirement":"explicit-user-approval","savedLoginCapability":"fill-saved-login","observationIndex":20}}"#,
        )?;
        assert_eq!(
            decode_authentication_workflow_snapshot_response(out_of_bounds_observation),
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

    #[test]
    fn enforces_the_closed_runtime_login_match_envelope() -> anyhow::Result<()> {
        for availability in [
            r#"{"kind":"ready","count":0}"#,
            r#"{"kind":"locked"}"#,
            r#"{"kind":"unavailable"}"#,
        ] {
            let json = format!(r#"{{"workflow":{{"ok":true}},"loginMatches":{availability}}}"#);
            let wire = serde_json::from_str::<AuthenticationWorkflowRuntimeResponseWire>(&json)?;
            assert!(decode_authentication_workflow_runtime_response(wire).is_ok());
        }

        for malformed in [
            r#"{"workflow":{"ok":true},"loginMatches":{"kind":"ready"}}"#,
            r#"{"workflow":{"ok":true},"loginMatches":{"kind":"locked","count":0}}"#,
            r#"{"workflow":{"ok":true},"loginMatches":{"kind":"unavailable","count":0}}"#,
        ] {
            let wire =
                serde_json::from_str::<AuthenticationWorkflowRuntimeResponseWire>(malformed)?;
            assert_eq!(
                decode_authentication_workflow_runtime_response(wire),
                Err(AuthenticationWorkflowRuntimeResponseDecodeError)
            );
        }

        for malformed in [
            r#"{"workflow":{"ok":true},"loginMatches":{"kind":"ready","count":-1}}"#,
            r#"{"workflow":{"ok":true},"loginMatches":{"kind":"other"}}"#,
        ] {
            assert!(
                serde_json::from_str::<AuthenticationWorkflowRuntimeResponseWire>(malformed)
                    .is_err()
            );
        }
        Ok(())
    }

    #[test]
    fn rejects_ready_login_matches_without_a_saved_login_capability() -> anyhow::Result<()> {
        for contradictory in [
            r#"{"workflow":{"ok":true},"loginMatches":{"kind":"ready","count":1}}"#,
            r#"{"workflow":{"ok":true,"snapshot":{"kind":0,"stage":0,"action":4,"currentStep":1,"totalSteps":3,"approvalRequirement":"explicit-user-approval","savedLoginCapability":"unavailable","observationIndex":0}},"loginMatches":{"kind":"ready","count":1}}"#,
        ] {
            let wire =
                serde_json::from_str::<AuthenticationWorkflowRuntimeResponseWire>(contradictory)?;
            assert_eq!(
                decode_authentication_workflow_runtime_response(wire),
                Err(AuthenticationWorkflowRuntimeResponseDecodeError)
            );
        }

        let consistent = serde_json::from_str::<AuthenticationWorkflowRuntimeResponseWire>(
            r#"{"workflow":{"ok":true,"snapshot":{"kind":0,"stage":0,"action":4,"currentStep":1,"totalSteps":3,"approvalRequirement":"explicit-user-approval","savedLoginCapability":"fill-saved-login","observationIndex":0}},"loginMatches":{"kind":"ready","count":1}}"#,
        )?;
        assert!(decode_authentication_workflow_runtime_response(consistent).is_ok());
        Ok(())
    }
}
