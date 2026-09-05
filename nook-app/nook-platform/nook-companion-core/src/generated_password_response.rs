//! Typed runtime response boundary for generated passwords.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use serde::{Deserialize, Serialize, Serializer};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::Zeroize;

#[derive(Debug, Deserialize, Serialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "string")]
pub struct GeneratedPasswordSecret(String);

impl GeneratedPasswordSecret {
    fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl Zeroize for GeneratedPasswordSecret {
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl Drop for GeneratedPasswordSecret {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Debug, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct GeneratedPasswordWire {
    ok: bool,
    password: GeneratedPasswordSecret,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct GeneratedPasswordRejectedWire {
    ok: bool,
    reason: String,
}

#[derive(Debug, Deserialize, Tsify)]
#[serde(untagged)]
#[tsify(from_wasm_abi)]
pub enum GeneratedPasswordResponseWire {
    Generated(GeneratedPasswordWire),
    Rejected(GeneratedPasswordRejectedWire),
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GeneratedPasswordResponseKind {
    Generated,
    Rejected,
}

impl Serialize for GeneratedPasswordResponseKind {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(*self as u8)
    }
}

#[derive(Debug, Serialize, Tsify)]
#[serde(untagged)]
#[tsify(into_wasm_abi)]
pub enum GeneratedPasswordResponse {
    Generated {
        kind: GeneratedPasswordResponseKind,
        password: GeneratedPasswordSecret,
    },
    Rejected {
        kind: GeneratedPasswordResponseKind,
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("generated password response is malformed")]
pub struct GeneratedPasswordResponseDecodeError;

impl GeneratedPasswordResponse {
    pub fn from_wire(
        wire: GeneratedPasswordResponseWire,
    ) -> Result<Self, GeneratedPasswordResponseDecodeError> {
        match wire {
            GeneratedPasswordResponseWire::Generated(GeneratedPasswordWire {
                ok: true,
                password,
            }) if !password.is_empty() => Ok(Self::Generated {
                kind: GeneratedPasswordResponseKind::Generated,
                password,
            }),
            GeneratedPasswordResponseWire::Rejected(GeneratedPasswordRejectedWire {
                ok: false,
                reason,
            }) if !reason.trim().is_empty() => Ok(Self::Rejected {
                kind: GeneratedPasswordResponseKind::Rejected,
                reason,
            }),
            GeneratedPasswordResponseWire::Generated(_)
            | GeneratedPasswordResponseWire::Rejected(_) => {
                Err(GeneratedPasswordResponseDecodeError)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_generated_and_rejected_password_outcomes() -> anyhow::Result<()> {
        let generated = serde_json::from_str::<GeneratedPasswordResponseWire>(
            r#"{"ok":true,"password":"correct horse battery staple"}"#,
        )?;
        assert!(matches!(
            GeneratedPasswordResponse::from_wire(generated)?,
            GeneratedPasswordResponse::Generated { .. }
        ));
        let rejected = serde_json::from_str::<GeneratedPasswordResponseWire>(
            r#"{"ok":false,"reason":"authenticator-locked"}"#,
        )?;
        assert!(matches!(
            GeneratedPasswordResponse::from_wire(rejected)?,
            GeneratedPasswordResponse::Rejected { .. }
        ));
        Ok(())
    }

    #[test]
    fn rejects_blank_contradictory_and_foreign_password_values() -> anyhow::Result<()> {
        for serialized in [
            r#"{"ok":true,"password":""}"#,
            r#"{"ok":false,"password":"password"}"#,
            r#"{"ok":true,"reason":"failed"}"#,
            r#"{"ok":false,"reason":" "}"#,
        ] {
            let wire = serde_json::from_str::<GeneratedPasswordResponseWire>(serialized)?;
            assert!(GeneratedPasswordResponse::from_wire(wire).is_err());
        }
        assert!(
            serde_json::from_str::<GeneratedPasswordResponseWire>(
                r#"{"ok":true,"password":"password","reason":"contradiction"}"#,
            )
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn preserves_nonempty_password_bytes() -> anyhow::Result<()> {
        for password in [" ", " \t\n", "  é🔐密碼\n"] {
            let wire = serde_json::from_value::<GeneratedPasswordResponseWire>(
                serde_json::json!({"ok": true, "password": password}),
            )?;
            let response = GeneratedPasswordResponse::from_wire(wire)?;
            let serialized = serde_json::to_value(response)?;
            assert_eq!(serialized["password"].as_str(), Some(password));
        }
        Ok(())
    }

    #[test]
    fn serializes_numeric_kinds_and_preserves_original_rejection_reason() -> anyhow::Result<()> {
        for (wire, expected) in [
            (
                serde_json::json!({"ok": true, "password": "fixture password"}),
                serde_json::json!({"kind": 0, "password": "fixture password"}),
            ),
            (
                serde_json::json!({"ok": false, "reason": "  locked\n"}),
                serde_json::json!({"kind": 1, "reason": "  locked\n"}),
            ),
        ] {
            let response = GeneratedPasswordResponse::from_wire(serde_json::from_value(wire)?)?;
            assert_eq!(serde_json::to_value(response)?, expected);
        }
        assert_eq!(
            GeneratedPasswordResponseDecodeError.to_string(),
            "generated password response is malformed"
        );
        Ok(())
    }
}
