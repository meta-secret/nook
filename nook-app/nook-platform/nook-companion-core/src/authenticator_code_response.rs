//! Typed runtime response boundary for generated authenticator codes.

use serde::{Deserialize, Serialize, Serializer};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::Zeroize;

const MAX_SAFE_JAVASCRIPT_INTEGER: f64 = 9_007_199_254_740_991.0;

/// Absolute expiry for an ephemeral TOTP value, expressed in Unix milliseconds.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct AuthenticatorCodeExpiryEpochMilliseconds(f64);

impl AuthenticatorCodeExpiryEpochMilliseconds {
    fn is_valid(self) -> bool {
        self.0.is_finite()
            && self.0 > 0.0
            && self.0.fract() == 0.0
            && self.0 <= MAX_SAFE_JAVASCRIPT_INTEGER
    }
}

#[derive(Debug, Deserialize, Serialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "string")]
pub struct AuthenticatorCodeSecret(String);

impl AuthenticatorCodeSecret {
    fn as_str(&self) -> &str {
        &self.0
    }
}

impl Zeroize for AuthenticatorCodeSecret {
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl Drop for AuthenticatorCodeSecret {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Debug, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct AuthenticatorCodeReadyWire {
    ok: bool,
    code: AuthenticatorCodeSecret,
    #[serde(rename = "expiresAt")]
    expires_at: AuthenticatorCodeExpiryEpochMilliseconds,
}

#[derive(Debug, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct AuthenticatorCodeRejectedWire {
    ok: bool,
    reason: String,
}

#[derive(Debug, Deserialize, Tsify)]
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

#[derive(Debug, Serialize, Tsify)]
#[serde(untagged, rename_all_fields = "camelCase")]
#[tsify(into_wasm_abi)]
pub enum AuthenticatorCodeResponse {
    Ready {
        kind: AuthenticatorCodeResponseKind,
        code: AuthenticatorCodeSecret,
        expires_at: AuthenticatorCodeExpiryEpochMilliseconds,
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
        AuthenticatorCodeResponseWire::Ready(AuthenticatorCodeReadyWire {
            ok: true,
            code,
            expires_at,
        }) if is_totp_code(code.as_str()) && expires_at.is_valid() => {
            Ok(AuthenticatorCodeResponse::Ready {
                kind: AuthenticatorCodeResponseKind::Ready,
                code,
                expires_at,
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
                code: AuthenticatorCodeSecret(code.to_owned()),
                expires_at: AuthenticatorCodeExpiryEpochMilliseconds(1_725_000_030_000.0),
            });
            assert!(matches!(
                decode_authenticator_code_response(wire),
                Ok(AuthenticatorCodeResponse::Ready { expires_at, .. })
                    if expires_at == AuthenticatorCodeExpiryEpochMilliseconds(1_725_000_030_000.0)
            ));
        }
    }

    #[test]
    fn rejects_non_totp_contradictory_and_foreign_code_values() -> anyhow::Result<()> {
        for serialized in [
            r#"{"ok":true,"code":"12345","expiresAt":1725000030000}"#,
            r#"{"ok":true,"code":"123456789","expiresAt":1725000030000}"#,
            r#"{"ok":true,"code":"12a456","expiresAt":1725000030000}"#,
            r#"{"ok":false,"code":"123456","expiresAt":1725000030000}"#,
            r#"{"ok":true,"reason":"failed"}"#,
            r#"{"ok":false,"reason":" "}"#,
            r#"{"ok":true,"code":"123456","expiresAt":0}"#,
            r#"{"ok":true,"code":"123456","expiresAt":1.5}"#,
            r#"{"ok":true,"code":"123456","expiresAt":9007199254740992}"#,
        ] {
            let wire = serde_json::from_str::<AuthenticatorCodeResponseWire>(serialized)?;
            assert!(decode_authenticator_code_response(wire).is_err());
        }
        assert!(
            serde_json::from_str::<AuthenticatorCodeResponseWire>(
                r#"{"ok":true,"code":"123456","expiresAt":1725000030000,"reason":"contradiction"}"#,
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<AuthenticatorCodeResponseWire>(
                r#"{"ok":true,"code":"123456"}"#,
            )
            .is_err()
        );
        Ok(())
    }
}
