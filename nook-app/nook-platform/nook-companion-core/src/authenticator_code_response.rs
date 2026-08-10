//! Typed runtime response boundary for generated authenticator codes.

use serde::{Deserialize, Serialize, Serializer};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct AuthenticatorCodeReadyWire {
    ok: bool,
    code: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct AuthenticatorCodeRejectedWire {
    ok: bool,
    reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(untagged)]
#[tsify(from_wasm_abi)]
pub enum AuthenticatorCodeResponseWire {
    Ready(AuthenticatorCodeReadyWire),
    Rejected(AuthenticatorCodeRejectedWire),
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticatorCodeResponseKind {
    Ready,
    Rejected,
}

impl Serialize for AuthenticatorCodeResponseKind {
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
pub enum AuthenticatorCodeResponse {
    Ready {
        kind: AuthenticatorCodeResponseKind,
        code: String,
    },
    Rejected {
        kind: AuthenticatorCodeResponseKind,
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("authenticator code response is malformed")]
pub struct AuthenticatorCodeResponseDecodeError;

fn is_totp_code(code: &str) -> bool {
    (6..=8).contains(&code.len()) && code.bytes().all(|byte| byte.is_ascii_digit())
}

pub fn decode_authenticator_code_response(
    wire: AuthenticatorCodeResponseWire,
) -> Result<AuthenticatorCodeResponse, AuthenticatorCodeResponseDecodeError> {
    match wire {
        AuthenticatorCodeResponseWire::Ready(AuthenticatorCodeReadyWire { ok: true, code })
            if is_totp_code(&code) =>
        {
            Ok(AuthenticatorCodeResponse::Ready {
                kind: AuthenticatorCodeResponseKind::Ready,
                code,
            })
        }
        AuthenticatorCodeResponseWire::Rejected(AuthenticatorCodeRejectedWire {
            ok: false,
            reason,
        }) if !reason.trim().is_empty() => Ok(AuthenticatorCodeResponse::Rejected {
            kind: AuthenticatorCodeResponseKind::Rejected,
            reason,
        }),
        AuthenticatorCodeResponseWire::Ready(_) | AuthenticatorCodeResponseWire::Rejected(_) => {
            Err(AuthenticatorCodeResponseDecodeError)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_six_to_eight_digit_totp_codes() {
        for code in ["123456", "1234567", "12345678"] {
            let wire = AuthenticatorCodeResponseWire::Ready(AuthenticatorCodeReadyWire {
                ok: true,
                code: code.to_owned(),
            });
            assert!(matches!(
                decode_authenticator_code_response(wire),
                Ok(AuthenticatorCodeResponse::Ready { .. })
            ));
        }
    }

    #[test]
    fn rejects_non_totp_contradictory_and_foreign_code_values() -> anyhow::Result<()> {
        for serialized in [
            r#"{"ok":true,"code":"12345"}"#,
            r#"{"ok":true,"code":"123456789"}"#,
            r#"{"ok":true,"code":"12a456"}"#,
            r#"{"ok":false,"code":"123456"}"#,
            r#"{"ok":true,"reason":"failed"}"#,
            r#"{"ok":false,"reason":" "}"#,
        ] {
            let wire = serde_json::from_str::<AuthenticatorCodeResponseWire>(serialized)?;
            assert!(decode_authenticator_code_response(wire).is_err());
        }
        assert!(
            serde_json::from_str::<AuthenticatorCodeResponseWire>(
                r#"{"ok":true,"code":"123456","reason":"contradiction"}"#,
            )
            .is_err()
        );
        Ok(())
    }
}
