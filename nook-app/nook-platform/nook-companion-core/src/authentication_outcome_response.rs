//! Typed runtime response boundary for authentication outcome classification.

use crate::AuthenticationOutcomeDecision;
use serde::{Deserialize, Serialize, Serializer};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationOutcomeCompletedWire {
    ok: bool,
    verdict: AuthenticationOutcomeDecision,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationOutcomeRejectedWire {
    ok: bool,
    reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(untagged)]
#[tsify(from_wasm_abi)]
pub enum AuthenticationOutcomeResponseWire {
    Completed(AuthenticationOutcomeCompletedWire),
    Rejected(AuthenticationOutcomeRejectedWire),
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticationOutcomeResponseKind {
    Completed,
    Rejected,
}

impl Serialize for AuthenticationOutcomeResponseKind {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(*self as u8)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(untagged)]
#[tsify(into_wasm_abi)]
pub enum AuthenticationOutcomeResponse {
    Completed {
        kind: AuthenticationOutcomeResponseKind,
        verdict: AuthenticationOutcomeDecision,
    },
    Rejected {
        kind: AuthenticationOutcomeResponseKind,
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("authentication outcome response is malformed")]
pub struct AuthenticationOutcomeResponseDecodeError;

pub fn decode_authentication_outcome_response(
    wire: AuthenticationOutcomeResponseWire,
) -> Result<AuthenticationOutcomeResponse, AuthenticationOutcomeResponseDecodeError> {
    match wire {
        AuthenticationOutcomeResponseWire::Completed(AuthenticationOutcomeCompletedWire {
            ok: true,
            verdict,
        }) => Ok(AuthenticationOutcomeResponse::Completed {
            kind: AuthenticationOutcomeResponseKind::Completed,
            verdict,
        }),
        AuthenticationOutcomeResponseWire::Rejected(AuthenticationOutcomeRejectedWire {
            ok: false,
            reason,
        }) if !reason.trim().is_empty() => Ok(AuthenticationOutcomeResponse::Rejected {
            kind: AuthenticationOutcomeResponseKind::Rejected,
            reason,
        }),
        AuthenticationOutcomeResponseWire::Completed(_)
        | AuthenticationOutcomeResponseWire::Rejected(_) => {
            Err(AuthenticationOutcomeResponseDecodeError)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_closed_outcome_variants() -> anyhow::Result<()> {
        for serialized in [
            r#"{"ok":true,"verdict":{"verdict":0,"allowsCredentialCommit":true}}"#,
            r#"{"ok":false,"reason":"outcome-classify-failed"}"#,
        ] {
            let wire = serde_json::from_str::<AuthenticationOutcomeResponseWire>(serialized)?;
            assert!(decode_authentication_outcome_response(wire).is_ok());
        }
        Ok(())
    }

    #[test]
    fn rejects_contradictory_and_foreign_outcome_fields() {
        for serialized in [
            r#"{"ok":true,"verdict":{"verdict":0,"allowsCredentialCommit":true},"reason":"outcome-classify-failed"}"#,
            r#"{"ok":false,"reason":"outcome-classify-failed","verdict":{"verdict":0,"allowsCredentialCommit":true}}"#,
            r#"{"ok":false,"reason":" "}"#,
            r#"{"ok":false,"verdict":{"verdict":0,"allowsCredentialCommit":true}}"#,
        ] {
            let decoded = serde_json::from_str::<AuthenticationOutcomeResponseWire>(serialized)
                .map_err(|_| AuthenticationOutcomeResponseDecodeError)
                .and_then(decode_authentication_outcome_response);
            assert!(decoded.is_err(), "accepted {serialized}");
        }
    }
}
