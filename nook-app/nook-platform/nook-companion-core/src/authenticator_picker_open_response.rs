//! Typed runtime response boundary for opening the authenticator picker.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use serde::{Deserialize, Serialize, Serializer};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(
    deny_unknown_fields,
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum AuthenticatorPickerOpenAvailableWire {
    Ready {
        ok: bool,
        request_id: String,
        expires_at: f64,
    },
    Locked {
        ok: bool,
    },
    Unavailable {
        ok: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct AuthenticatorPickerOpenRejectedWire {
    ok: bool,
    reason: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(untagged)]
#[tsify(from_wasm_abi)]
pub enum AuthenticatorPickerOpenResponseWire {
    Available(AuthenticatorPickerOpenAvailableWire),
    Rejected(AuthenticatorPickerOpenRejectedWire),
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticatorPickerOpenResponseKind {
    Ready,
    Locked,
    Unavailable,
    Rejected,
}

impl Serialize for AuthenticatorPickerOpenResponseKind {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(*self as u8)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Tsify)]
#[serde(untagged, rename_all_fields = "camelCase")]
#[tsify(into_wasm_abi)]
pub enum AuthenticatorPickerOpenResponse {
    Ready {
        kind: AuthenticatorPickerOpenResponseKind,
        request_id: String,
        expires_at: f64,
    },
    Locked {
        kind: AuthenticatorPickerOpenResponseKind,
    },
    Unavailable {
        kind: AuthenticatorPickerOpenResponseKind,
    },
    Rejected {
        kind: AuthenticatorPickerOpenResponseKind,
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("authenticator picker-open response is malformed")]
pub struct AuthenticatorPickerOpenResponseDecodeError;

impl AuthenticatorPickerOpenResponse {
    pub fn from_wire(
        wire: AuthenticatorPickerOpenResponseWire,
    ) -> Result<AuthenticatorPickerOpenResponse, AuthenticatorPickerOpenResponseDecodeError> {
        match wire {
            AuthenticatorPickerOpenResponseWire::Available(
                AuthenticatorPickerOpenAvailableWire::Ready {
                    ok: true,
                    request_id,
                    expires_at,
                },
            ) if !request_id.trim().is_empty() && expires_at.is_finite() => {
                Ok(AuthenticatorPickerOpenResponse::Ready {
                    kind: AuthenticatorPickerOpenResponseKind::Ready,
                    request_id,
                    expires_at,
                })
            }
            AuthenticatorPickerOpenResponseWire::Available(
                AuthenticatorPickerOpenAvailableWire::Locked { ok: true },
            ) => Ok(AuthenticatorPickerOpenResponse::Locked {
                kind: AuthenticatorPickerOpenResponseKind::Locked,
            }),
            AuthenticatorPickerOpenResponseWire::Available(
                AuthenticatorPickerOpenAvailableWire::Unavailable { ok: true },
            ) => Ok(AuthenticatorPickerOpenResponse::Unavailable {
                kind: AuthenticatorPickerOpenResponseKind::Unavailable,
            }),
            AuthenticatorPickerOpenResponseWire::Rejected(
                AuthenticatorPickerOpenRejectedWire { ok: false, reason },
            ) if !reason.trim().is_empty() => Ok(AuthenticatorPickerOpenResponse::Rejected {
                kind: AuthenticatorPickerOpenResponseKind::Rejected,
                reason,
            }),
            AuthenticatorPickerOpenResponseWire::Available(_)
            | AuthenticatorPickerOpenResponseWire::Rejected(_) => {
                Err(AuthenticatorPickerOpenResponseDecodeError)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_closed_picker_variants() -> anyhow::Result<()> {
        for serialized in [
            r#"{"ok":true,"status":"ready","requestId":"request","expiresAt":42}"#,
            r#"{"ok":true,"status":"locked"}"#,
            r#"{"ok":true,"status":"unavailable"}"#,
            r#"{"ok":false,"reason":"picker-failed"}"#,
        ] {
            let wire = serde_json::from_str::<AuthenticatorPickerOpenResponseWire>(serialized)?;
            assert!(AuthenticatorPickerOpenResponse::from_wire(wire).is_ok());
        }
        Ok(())
    }

    #[test]
    fn rejects_contradictory_and_foreign_picker_fields() {
        for serialized in [
            r#"{"ok":true,"status":"ready","requestId":"request","expiresAt":42,"reason":"picker-failed"}"#,
            r#"{"ok":true,"status":"ready","requestId":" ","expiresAt":42}"#,
            r#"{"ok":true,"status":"ready","requestId":"request","expiresAt":null}"#,
            r#"{"ok":false,"reason":" "}"#,
            r#"{"ok":false,"status":"locked","reason":"picker-failed"}"#,
        ] {
            let decoded = serde_json::from_str::<AuthenticatorPickerOpenResponseWire>(serialized)
                .map_err(|_| AuthenticatorPickerOpenResponseDecodeError)
                .and_then(AuthenticatorPickerOpenResponse::from_wire);
            assert!(decoded.is_err(), "accepted {serialized}");
        }
    }
}
