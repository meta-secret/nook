//! Typed runtime response boundaries for authenticator enrollment.

use serde::{Deserialize, Serialize, Serializer};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AuthenticatorEnrollmentStagedWire {
    ok: bool,
    stage_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct AuthenticatorEnrollmentRejectedWire {
    ok: bool,
    reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(untagged)]
#[tsify(from_wasm_abi)]
pub enum AuthenticatorEnrollmentStageResponseWire {
    Staged(AuthenticatorEnrollmentStagedWire),
    Rejected(AuthenticatorEnrollmentRejectedWire),
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticatorEnrollmentStageResponseKind {
    Staged,
    Rejected,
}

impl Serialize for AuthenticatorEnrollmentStageResponseKind {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(*self as u8)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(untagged, rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub enum AuthenticatorEnrollmentStageResponse {
    Staged {
        kind: AuthenticatorEnrollmentStageResponseKind,
        stage_id: String,
    },
    Rejected {
        kind: AuthenticatorEnrollmentStageResponseKind,
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AuthenticatorEnrollmentCompletedWire {
    ok: bool,
    secret_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(untagged)]
#[tsify(from_wasm_abi)]
pub enum AuthenticatorEnrollmentConfirmResponseWire {
    Completed(AuthenticatorEnrollmentCompletedWire),
    Rejected(AuthenticatorEnrollmentRejectedWire),
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticatorEnrollmentConfirmResponseKind {
    Completed,
    Rejected,
}

impl Serialize for AuthenticatorEnrollmentConfirmResponseKind {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(*self as u8)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(untagged, rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub enum AuthenticatorEnrollmentConfirmResponse {
    Completed {
        kind: AuthenticatorEnrollmentConfirmResponseKind,
        secret_id: String,
    },
    Rejected {
        kind: AuthenticatorEnrollmentConfirmResponseKind,
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("authenticator enrollment response is malformed")]
pub struct AuthenticatorEnrollmentResponseDecodeError;

pub fn decode_authenticator_enrollment_stage_response(
    wire: AuthenticatorEnrollmentStageResponseWire,
) -> Result<AuthenticatorEnrollmentStageResponse, AuthenticatorEnrollmentResponseDecodeError> {
    match wire {
        AuthenticatorEnrollmentStageResponseWire::Staged(AuthenticatorEnrollmentStagedWire {
            ok: true,
            stage_id,
        }) if !stage_id.trim().is_empty() => Ok(AuthenticatorEnrollmentStageResponse::Staged {
            kind: AuthenticatorEnrollmentStageResponseKind::Staged,
            stage_id,
        }),
        AuthenticatorEnrollmentStageResponseWire::Rejected(
            AuthenticatorEnrollmentRejectedWire { ok: false, reason },
        ) if !reason.trim().is_empty() => Ok(AuthenticatorEnrollmentStageResponse::Rejected {
            kind: AuthenticatorEnrollmentStageResponseKind::Rejected,
            reason,
        }),
        AuthenticatorEnrollmentStageResponseWire::Staged(_)
        | AuthenticatorEnrollmentStageResponseWire::Rejected(_) => {
            Err(AuthenticatorEnrollmentResponseDecodeError)
        }
    }
}

pub fn decode_authenticator_enrollment_confirm_response(
    wire: AuthenticatorEnrollmentConfirmResponseWire,
) -> Result<AuthenticatorEnrollmentConfirmResponse, AuthenticatorEnrollmentResponseDecodeError> {
    match wire {
        AuthenticatorEnrollmentConfirmResponseWire::Completed(
            AuthenticatorEnrollmentCompletedWire {
                ok: true,
                secret_id,
            },
        ) if !secret_id.trim().is_empty() => {
            Ok(AuthenticatorEnrollmentConfirmResponse::Completed {
                kind: AuthenticatorEnrollmentConfirmResponseKind::Completed,
                secret_id,
            })
        }
        AuthenticatorEnrollmentConfirmResponseWire::Rejected(
            AuthenticatorEnrollmentRejectedWire { ok: false, reason },
        ) if !reason.trim().is_empty() => Ok(AuthenticatorEnrollmentConfirmResponse::Rejected {
            kind: AuthenticatorEnrollmentConfirmResponseKind::Rejected,
            reason,
        }),
        AuthenticatorEnrollmentConfirmResponseWire::Completed(_)
        | AuthenticatorEnrollmentConfirmResponseWire::Rejected(_) => {
            Err(AuthenticatorEnrollmentResponseDecodeError)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_enrollment_domain_outcomes() -> anyhow::Result<()> {
        let staged = serde_json::from_str::<AuthenticatorEnrollmentStageResponseWire>(
            r#"{"ok":true,"stageId":"stage-1"}"#,
        )?;
        assert_eq!(
            decode_authenticator_enrollment_stage_response(staged)?,
            AuthenticatorEnrollmentStageResponse::Staged {
                kind: AuthenticatorEnrollmentStageResponseKind::Staged,
                stage_id: "stage-1".to_owned(),
            }
        );

        let completed = serde_json::from_str::<AuthenticatorEnrollmentConfirmResponseWire>(
            r#"{"ok":true,"secretId":"secret-1"}"#,
        )?;
        assert_eq!(
            decode_authenticator_enrollment_confirm_response(completed)?,
            AuthenticatorEnrollmentConfirmResponse::Completed {
                kind: AuthenticatorEnrollmentConfirmResponseKind::Completed,
                secret_id: "secret-1".to_owned(),
            }
        );
        Ok(())
    }

    #[test]
    fn rejects_blank_contradictory_and_foreign_enrollment_values() -> anyhow::Result<()> {
        for serialized in [
            r#"{"ok":true,"stageId":" "}"#,
            r#"{"ok":false,"stageId":"stage-1"}"#,
            r#"{"ok":false,"reason":" "}"#,
        ] {
            let wire =
                serde_json::from_str::<AuthenticatorEnrollmentStageResponseWire>(serialized)?;
            assert!(decode_authenticator_enrollment_stage_response(wire).is_err());
        }
        for serialized in [
            r#"{"ok":true,"secretId":" "}"#,
            r#"{"ok":false,"secretId":"secret-1"}"#,
            r#"{"ok":true,"reason":"authenticator-locked"}"#,
        ] {
            let wire =
                serde_json::from_str::<AuthenticatorEnrollmentConfirmResponseWire>(serialized)?;
            assert!(decode_authenticator_enrollment_confirm_response(wire).is_err());
        }
        assert!(
            serde_json::from_str::<AuthenticatorEnrollmentConfirmResponseWire>(
                r#"{"ok":true,"secretId":"secret-1","reason":"contradiction"}"#,
            )
            .is_err()
        );
        Ok(())
    }
}
