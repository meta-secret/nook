//! Login-picker response decoding at the content-script boundary.

use super::queue::deserialize_finite_f64;
use serde::{Deserialize, Serializer};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(
    deny_unknown_fields,
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum LoginPickerOpenAvailableWire {
    Ready {
        ok: bool,
        request_id: String,
        #[serde(deserialize_with = "deserialize_finite_f64")]
        #[cfg_attr(
            dylint_lib = "nook_domain_api",
            expect(
                raw_numeric_public_api,
                reason = "serialization boundary: decodes the finite JavaScript login-picker deadline timestamp"
            )
        )]
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
pub struct LoginPickerOpenFailedWire {
    ok: bool,
    reason: String,
}

/// Concrete service-worker response presented to the content-script boundary.
#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(untagged)]
#[tsify(from_wasm_abi)]
pub enum LoginPickerOpenResponseWire {
    Available(LoginPickerOpenAvailableWire),
    Failed(LoginPickerOpenFailedWire),
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, Tsify)]
#[serde(untagged, rename_all_fields = "camelCase")]
#[tsify(into_wasm_abi)]
pub enum LoginPickerOpenResponse {
    Failed {
        kind: LoginPickerOpenResponseKind,
    },
    Ready {
        kind: LoginPickerOpenResponseKind,
        request_id: String,
        #[cfg_attr(
            dylint_lib = "nook_domain_api",
            expect(
                raw_numeric_public_api,
                reason = "FFI boundary: returns the login-picker deadline timestamp as a JavaScript number"
            )
        )]
        expires_at: f64,
    },
    Locked {
        kind: LoginPickerOpenResponseKind,
    },
    Unavailable {
        kind: LoginPickerOpenResponseKind,
    },
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginPickerOpenResponseKind {
    Failed,
    Ready,
    Locked,
    Unavailable,
}

impl serde::Serialize for LoginPickerOpenResponseKind {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(*self as u8)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("login picker open response is malformed")]
pub struct LoginPickerOpenResponseDecodeError;

pub fn decode_login_picker_open_response(
    wire: LoginPickerOpenResponseWire,
) -> Result<LoginPickerOpenResponse, LoginPickerOpenResponseDecodeError> {
    match wire {
        LoginPickerOpenResponseWire::Available(LoginPickerOpenAvailableWire::Ready {
            ok,
            request_id,
            expires_at,
        }) if ok && !request_id.trim().is_empty() => Ok(LoginPickerOpenResponse::Ready {
            kind: LoginPickerOpenResponseKind::Ready,
            request_id,
            expires_at,
        }),
        LoginPickerOpenResponseWire::Available(LoginPickerOpenAvailableWire::Locked { ok })
            if ok =>
        {
            Ok(LoginPickerOpenResponse::Locked {
                kind: LoginPickerOpenResponseKind::Locked,
            })
        }
        LoginPickerOpenResponseWire::Available(LoginPickerOpenAvailableWire::Unavailable {
            ok,
        }) if ok => Ok(LoginPickerOpenResponse::Unavailable {
            kind: LoginPickerOpenResponseKind::Unavailable,
        }),
        LoginPickerOpenResponseWire::Failed(LoginPickerOpenFailedWire { ok: false, reason })
            if !reason.trim().is_empty() =>
        {
            Ok(LoginPickerOpenResponse::Failed {
                kind: LoginPickerOpenResponseKind::Failed,
            })
        }
        LoginPickerOpenResponseWire::Available(_)
        | LoginPickerOpenResponseWire::Failed(LoginPickerOpenFailedWire { .. }) => {
            Err(LoginPickerOpenResponseDecodeError)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picker_response_variants_enforce_their_invariants() -> anyhow::Result<()> {
        let ready = serde_json::from_str::<LoginPickerOpenResponseWire>(
            r#"{"ok":true,"status":"ready","requestId":"request","expiresAt":42}"#,
        )?;
        assert_eq!(
            decode_login_picker_open_response(ready)?,
            LoginPickerOpenResponse::Ready {
                kind: LoginPickerOpenResponseKind::Ready,
                request_id: "request".to_owned(),
                expires_at: 42.0,
            }
        );

        assert!(
            serde_json::from_str::<LoginPickerOpenResponseWire>(
                r#"{"ok":true,"status":"ready","expiresAt":42}"#,
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<LoginPickerOpenResponseWire>(
                r#"{"ok":true,"status":"locked","requestId":"request"}"#,
            )
            .is_err()
        );

        for (serialized, expected) in [
            (
                r#"{"ok":true,"status":"locked"}"#,
                LoginPickerOpenResponse::Locked {
                    kind: LoginPickerOpenResponseKind::Locked,
                },
            ),
            (
                r#"{"ok":true,"status":"unavailable"}"#,
                LoginPickerOpenResponse::Unavailable {
                    kind: LoginPickerOpenResponseKind::Unavailable,
                },
            ),
            (
                r#"{"ok":false,"reason":"picker closed"}"#,
                LoginPickerOpenResponse::Failed {
                    kind: LoginPickerOpenResponseKind::Failed,
                },
            ),
        ] {
            let wire = serde_json::from_str::<LoginPickerOpenResponseWire>(serialized)?;
            assert_eq!(decode_login_picker_open_response(wire)?, expected);
        }

        for serialized in [
            r#"{"ok":false,"status":"ready","requestId":"request","expiresAt":42}"#,
            r#"{"ok":true,"status":"ready","requestId":" ","expiresAt":42}"#,
            r#"{"ok":false,"status":"locked"}"#,
            r#"{"ok":false,"status":"unavailable"}"#,
            r#"{"ok":true,"reason":"failure"}"#,
            r#"{"ok":false,"reason":" "}"#,
        ] {
            let wire = serde_json::from_str::<LoginPickerOpenResponseWire>(serialized)?;
            assert!(decode_login_picker_open_response(wire).is_err());
        }
        Ok(())
    }
}
