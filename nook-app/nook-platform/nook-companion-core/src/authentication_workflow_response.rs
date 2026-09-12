//! Typed runtime response boundary for authentication workflow snapshots.

use crate::authentication_workflow::{
    AuthenticationApprovalRequirement, AuthenticationSavedLoginCapability,
    AuthenticationWorkflowAction, AuthenticationWorkflowKind, AuthenticationWorkflowSnapshot,
    AuthenticationWorkflowStage,
};
use crate::{
    AuthenticationObservationBindingToken, AuthenticationPageObservationFacts,
    AuthenticationPageObservationFactsBatch, AuthenticationSavedLoginAccountCount,
    AuthenticationWorkflowCurrentStep, AuthenticationWorkflowObservationIndex,
    AuthenticationWorkflowTotalSteps,
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
    saved_login_capability: AuthenticationSavedLoginCapability,
    observation_index: u32,
}

impl TryFrom<AuthenticationWorkflowSnapshotWire> for AuthenticationWorkflowSnapshot {
    type Error = AuthenticationWorkflowSnapshotResponseDecodeError;
    fn try_from(wire: AuthenticationWorkflowSnapshotWire) -> Result<Self, Self::Error> {
        let snapshot = AuthenticationWorkflowSnapshot {
            kind: wire.kind,
            stage: wire.stage,
            action: wire.action,
            current_step: AuthenticationWorkflowCurrentStep(wire.current_step),
            total_steps: AuthenticationWorkflowTotalSteps(wire.total_steps),
            approval_requirement: wire.approval_requirement,
            saved_login_capability: wire.saved_login_capability,
            observation_index: AuthenticationWorkflowObservationIndex(wire.observation_index),
        };
        if snapshot.matches_classifier_contract() {
            Ok(snapshot)
        } else {
            Err(AuthenticationWorkflowSnapshotResponseDecodeError)
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
    Ready {
        count: AuthenticationSavedLoginAccountCount,
    },
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

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
#[tsify(from_wasm_abi)]
pub enum AuthenticationWorkflowSelectedFactsWire {
    Selected {
        facts: Box<AuthenticationPageObservationFacts>,
    },
    NotApplicable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub enum AuthenticationWorkflowSelectedFacts {
    Selected {
        facts: Box<AuthenticationPageObservationFacts>,
    },
    NotApplicable,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(from_wasm_abi)]
pub struct AuthenticationWorkflowRoutingResponseWire {
    workflow: AuthenticationWorkflowSnapshotResponseWire,
    login_matches: WebsiteLoginMatchAvailabilityWire,
    selected_facts: AuthenticationWorkflowSelectedFactsWire,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub struct AuthenticationWorkflowRoutingResponse {
    pub workflow: AuthenticationWorkflowSnapshotResponse,
    pub login_matches: WebsiteLoginMatchAvailability,
    pub selected_facts: AuthenticationWorkflowSelectedFacts,
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

impl AuthenticationWorkflowSnapshotResponse {
    pub fn decode_authentication_workflow_snapshot_response(
        wire: AuthenticationWorkflowSnapshotResponseWire,
    ) -> Result<
        AuthenticationWorkflowSnapshotResponse,
        AuthenticationWorkflowSnapshotResponseDecodeError,
    > {
        match wire {
            AuthenticationWorkflowSnapshotResponseWire::Matched(
                AuthenticationWorkflowMatchedResponseWire { ok: true, snapshot },
            ) => {
                let snapshot = AuthenticationWorkflowSnapshot::try_from(snapshot)?;
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
            ) if !reason.trim().is_empty() => {
                Ok(AuthenticationWorkflowSnapshotResponse::Rejected {
                    kind: AuthenticationWorkflowSnapshotResponseKind::Rejected,
                    reason,
                })
            }
            AuthenticationWorkflowSnapshotResponseWire::Matched(_)
            | AuthenticationWorkflowSnapshotResponseWire::NoMatch(_)
            | AuthenticationWorkflowSnapshotResponseWire::Rejected(_) => {
                Err(AuthenticationWorkflowSnapshotResponseDecodeError)
            }
        }
    }
}

impl AuthenticationWorkflowRuntimeResponse {
    pub fn decode_authentication_workflow_runtime_response(
        wire: AuthenticationWorkflowRuntimeResponseWire,
    ) -> Result<
        AuthenticationWorkflowRuntimeResponse,
        AuthenticationWorkflowRuntimeResponseDecodeError,
    > {
        let workflow = AuthenticationWorkflowSnapshotResponse::decode_authentication_workflow_snapshot_response(wire.workflow)
        .map_err(|_| AuthenticationWorkflowRuntimeResponseDecodeError)?;
        let login_matches = WebsiteLoginMatchAvailability::try_from(wire.login_matches)?;
        let login_matches_match_workflow = match (login_matches, &workflow) {
            (
                WebsiteLoginMatchAvailability::Ready {
                    count: AuthenticationSavedLoginAccountCount::ZERO,
                }
                | WebsiteLoginMatchAvailability::Unavailable,
                _,
            ) => true,
            (
                WebsiteLoginMatchAvailability::Ready { .. } | WebsiteLoginMatchAvailability::Locked,
                AuthenticationWorkflowSnapshotResponse::Matched { snapshot, .. },
            ) => {
                snapshot.saved_login_capability()
                    == AuthenticationSavedLoginCapability::FillSavedLogin
            }
            (
                WebsiteLoginMatchAvailability::Ready { .. } | WebsiteLoginMatchAvailability::Locked,
                _,
            ) => false,
        };
        if !login_matches_match_workflow {
            return Err(AuthenticationWorkflowRuntimeResponseDecodeError);
        }
        Ok(AuthenticationWorkflowRuntimeResponse {
            workflow,
            login_matches,
        })
    }
}

impl AuthenticationWorkflowRoutingResponse {
    pub fn decode_authentication_workflow_routing_response(
        wire: AuthenticationWorkflowRoutingResponseWire,
    ) -> Result<Self, AuthenticationWorkflowRuntimeResponseDecodeError> {
        let AuthenticationWorkflowRoutingResponseWire {
            workflow,
            login_matches,
            selected_facts,
        } = wire;
        let runtime =
            AuthenticationWorkflowRuntimeResponse::decode_authentication_workflow_runtime_response(
                AuthenticationWorkflowRuntimeResponseWire {
                    workflow,
                    login_matches,
                },
            )?;
        let selected_facts = match (&runtime.workflow, selected_facts) {
            (
                AuthenticationWorkflowSnapshotResponse::Matched { .. },
                AuthenticationWorkflowSelectedFactsWire::Selected { facts },
            ) => {
                AuthenticationObservationBindingToken::bind_authentication_page_observation_facts(
                    &AuthenticationPageObservationFactsBatch {
                        observations: vec![facts.as_ref().clone()],
                    },
                )
                .map_err(|_| AuthenticationWorkflowRuntimeResponseDecodeError)?;
                AuthenticationWorkflowSelectedFacts::Selected { facts }
            }
            (
                AuthenticationWorkflowSnapshotResponse::NoMatch { .. }
                | AuthenticationWorkflowSnapshotResponse::Rejected { .. },
                AuthenticationWorkflowSelectedFactsWire::NotApplicable,
            ) => AuthenticationWorkflowSelectedFacts::NotApplicable,
            (
                AuthenticationWorkflowSnapshotResponse::Matched { .. }
                | AuthenticationWorkflowSnapshotResponse::NoMatch { .. }
                | AuthenticationWorkflowSnapshotResponse::Rejected { .. },
                _,
            ) => return Err(AuthenticationWorkflowRuntimeResponseDecodeError),
        };
        Ok(Self {
            workflow: runtime.workflow,
            login_matches: runtime.login_matches,
            selected_facts,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routing_response_atomically_requires_bounded_selected_facts() -> anyhow::Result<()> {
        let selected_facts = AuthenticationPageObservationFacts::default();
        let response = serde_json::json!({
            "workflow": {
                "ok": true,
                "snapshot": {
                    "kind": 0,
                    "stage": 0,
                    "action": 0,
                    "currentStep": 1,
                    "totalSteps": 3,
                    "approvalRequirement": "explicit-user-approval",
                    "savedLoginCapability": "fill-saved-login",
                    "observationIndex": 0
                }
            },
            "loginMatches": { "kind": "ready", "count": 1 },
            "selectedFacts": { "state": "selected", "facts": selected_facts }
        });
        let wire =
            serde_json::from_value::<AuthenticationWorkflowRoutingResponseWire>(response.clone())?;
        let decoded =
            AuthenticationWorkflowRoutingResponse::decode_authentication_workflow_routing_response(
                wire,
            )?;
        assert_eq!(
            decoded.selected_facts,
            AuthenticationWorkflowSelectedFacts::Selected {
                facts: Box::new(selected_facts)
            }
        );

        let mut missing_facts = response;
        missing_facts
            .as_object_mut()
            .ok_or_else(|| anyhow::anyhow!("routing fixture must be an object"))?
            .remove("selectedFacts");
        assert!(
            serde_json::from_value::<AuthenticationWorkflowRoutingResponseWire>(missing_facts)
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn enforces_closed_approval_requirements() -> anyhow::Result<()> {
        for mismatched in [
            r#"{"ok":true,"snapshot":{"kind":0,"stage":0,"action":0,"currentStep":1,"totalSteps":3,"approvalRequirement":"takeover-required","savedLoginCapability":"unavailable","observationIndex":0}}"#,
            r#"{"ok":true,"snapshot":{"kind":0,"stage":5,"action":6,"currentStep":1,"totalSteps":3,"approvalRequirement":"explicit-user-approval","savedLoginCapability":"unavailable","observationIndex":0}}"#,
        ] {
            let wire =
                serde_json::from_str::<AuthenticationWorkflowSnapshotResponseWire>(mismatched)?;
            assert_eq!(
                AuthenticationWorkflowSnapshotResponse::decode_authentication_workflow_snapshot_response(wire),
                Err(AuthenticationWorkflowSnapshotResponseDecodeError)
            );
        }

        let takeover = serde_json::from_str::<AuthenticationWorkflowSnapshotResponseWire>(
            r#"{"ok":true,"snapshot":{"kind":0,"stage":5,"action":6,"currentStep":1,"totalSteps":3,"approvalRequirement":"takeover-required","savedLoginCapability":"unavailable","observationIndex":0}}"#,
        )?;
        assert!(matches!(
            AuthenticationWorkflowSnapshotResponse::decode_authentication_workflow_snapshot_response(takeover)?,
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
            AuthenticationWorkflowSnapshotResponse::decode_authentication_workflow_snapshot_response(valid)?,
            AuthenticationWorkflowSnapshotResponse::Matched { .. }
        ));

        let continue_without_saved_login = serde_json::from_str::<
            AuthenticationWorkflowSnapshotResponseWire,
        >(
            r#"{"ok":true,"snapshot":{"kind":0,"stage":0,"action":0,"currentStep":1,"totalSteps":3,"approvalRequirement":"explicit-user-approval","savedLoginCapability":"unavailable","observationIndex":0}}"#,
        )?;
        assert_eq!(
            AuthenticationWorkflowSnapshotResponse::decode_authentication_workflow_snapshot_response(continue_without_saved_login),
            Err(AuthenticationWorkflowSnapshotResponseDecodeError)
        );

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
            AuthenticationWorkflowSnapshotResponse::decode_authentication_workflow_snapshot_response(no_match)?,
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
            AuthenticationWorkflowSnapshotResponse::decode_authentication_workflow_snapshot_response(rejected)?,
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
            AuthenticationWorkflowSnapshotResponse::decode_authentication_workflow_snapshot_response(contradictory_matched),
            Err(AuthenticationWorkflowSnapshotResponseDecodeError)
        );

        let impossible_snapshot = serde_json::from_str::<AuthenticationWorkflowSnapshotResponseWire>(
            r#"{"ok":true,"snapshot":{"kind":0,"stage":0,"action":6,"currentStep":1,"totalSteps":3,"approvalRequirement":"takeover-required","savedLoginCapability":"unavailable","observationIndex":0}}"#,
        )?;
        assert_eq!(
            AuthenticationWorkflowSnapshotResponse::decode_authentication_workflow_snapshot_response(impossible_snapshot),
            Err(AuthenticationWorkflowSnapshotResponseDecodeError)
        );

        let out_of_bounds_observation = serde_json::from_str::<
            AuthenticationWorkflowSnapshotResponseWire,
        >(
            r#"{"ok":true,"snapshot":{"kind":0,"stage":0,"action":0,"currentStep":1,"totalSteps":3,"approvalRequirement":"explicit-user-approval","savedLoginCapability":"fill-saved-login","observationIndex":20}}"#,
        )?;
        assert_eq!(
            AuthenticationWorkflowSnapshotResponse::decode_authentication_workflow_snapshot_response(out_of_bounds_observation),
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
                AuthenticationWorkflowSnapshotResponse::decode_authentication_workflow_snapshot_response(malformed),
                Err(AuthenticationWorkflowSnapshotResponseDecodeError)
            );
        }
        Ok(())
    }

    #[test]
    fn enforces_the_closed_runtime_login_match_envelope() -> anyhow::Result<()> {
        for availability in [r#"{"kind":"ready","count":0}"#, r#"{"kind":"unavailable"}"#] {
            let json = format!(r#"{{"workflow":{{"ok":true}},"loginMatches":{availability}}}"#);
            let wire = serde_json::from_str::<AuthenticationWorkflowRuntimeResponseWire>(&json)?;
            assert!(AuthenticationWorkflowRuntimeResponse::decode_authentication_workflow_runtime_response(wire).is_ok());
        }

        for malformed in [
            r#"{"workflow":{"ok":true},"loginMatches":{"kind":"ready"}}"#,
            r#"{"workflow":{"ok":true},"loginMatches":{"kind":"locked","count":0}}"#,
            r#"{"workflow":{"ok":true},"loginMatches":{"kind":"unavailable","count":0}}"#,
        ] {
            let wire =
                serde_json::from_str::<AuthenticationWorkflowRuntimeResponseWire>(malformed)?;
            assert_eq!(
                AuthenticationWorkflowRuntimeResponse::decode_authentication_workflow_runtime_response(wire),
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
    fn rejects_authorizing_login_matches_without_a_saved_login_capability() -> anyhow::Result<()> {
        for contradictory in [
            r#"{"workflow":{"ok":true},"loginMatches":{"kind":"ready","count":1}}"#,
            r#"{"workflow":{"ok":true,"snapshot":{"kind":0,"stage":0,"action":4,"currentStep":1,"totalSteps":3,"approvalRequirement":"explicit-user-approval","savedLoginCapability":"unavailable","observationIndex":0}},"loginMatches":{"kind":"ready","count":1}}"#,
            r#"{"workflow":{"ok":true},"loginMatches":{"kind":"locked"}}"#,
            r#"{"workflow":{"ok":true,"snapshot":{"kind":0,"stage":0,"action":4,"currentStep":1,"totalSteps":3,"approvalRequirement":"explicit-user-approval","savedLoginCapability":"unavailable","observationIndex":0}},"loginMatches":{"kind":"locked"}}"#,
        ] {
            let wire =
                serde_json::from_str::<AuthenticationWorkflowRuntimeResponseWire>(contradictory)?;
            assert_eq!(
                AuthenticationWorkflowRuntimeResponse::decode_authentication_workflow_runtime_response(wire),
                Err(AuthenticationWorkflowRuntimeResponseDecodeError)
            );
        }

        for availability in [r#"{"kind":"ready","count":1}"#, r#"{"kind":"locked"}"#] {
            let json = format!(
                r#"{{"workflow":{{"ok":true,"snapshot":{{"kind":0,"stage":0,"action":4,"currentStep":1,"totalSteps":3,"approvalRequirement":"explicit-user-approval","savedLoginCapability":"fill-saved-login","observationIndex":0}}}},"loginMatches":{availability}}}"#
            );
            let consistent =
                serde_json::from_str::<AuthenticationWorkflowRuntimeResponseWire>(&json)?;
            assert!(AuthenticationWorkflowRuntimeResponse::decode_authentication_workflow_runtime_response(consistent).is_ok());
        }
        Ok(())
    }
}

impl TryFrom<WebsiteLoginMatchAvailabilityWire> for WebsiteLoginMatchAvailability {
    type Error = AuthenticationWorkflowRuntimeResponseDecodeError;
    fn try_from(wire: WebsiteLoginMatchAvailabilityWire) -> Result<Self, Self::Error> {
        Ok(match wire {
            WebsiteLoginMatchAvailabilityWire::WithCount(
                WebsiteLoginMatchAvailabilityWithCountWire {
                    kind: WebsiteLoginMatchAvailabilityKind::Ready,
                    count,
                },
            ) => WebsiteLoginMatchAvailability::Ready {
                count: count.into(),
            },
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
        })
    }
}
impl WebsiteLoginMatchAvailability {
    #[must_use]
    pub fn supports_alternative_saved_login(self, action: AuthenticationWorkflowAction) -> bool {
        matches!(
            action,
            AuthenticationWorkflowAction::UsePasskey | AuthenticationWorkflowAction::CreatePasskey
        ) && match self {
            Self::Ready { count } => count.is_nonzero(),
            Self::Locked => true,
            Self::Unavailable => false,
        }
    }
}
#[derive(Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(from_wasm_abi)]
pub struct SavedLoginActionPresentationRequest {
    pub action: AuthenticationWorkflowAction,
    pub login_matches: WebsiteLoginMatchAvailabilityWire,
}
impl SavedLoginActionPresentationRequest {
    #[must_use]
    pub fn is_available(self) -> bool {
        WebsiteLoginMatchAvailability::try_from(self.login_matches)
            .is_ok_and(|availability| availability.supports_alternative_saved_login(self.action))
    }
}
