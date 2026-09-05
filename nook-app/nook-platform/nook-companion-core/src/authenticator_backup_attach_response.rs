//! Typed runtime response boundary for backup-code attachment.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use serde::{Deserialize, Serialize, Serializer};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct AuthenticatorBackupAttachCompletedWire {
    ok: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct AuthenticatorBackupAttachRejectedWire {
    ok: bool,
    reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(untagged)]
#[tsify(from_wasm_abi)]
pub enum AuthenticatorBackupAttachResponseWire {
    Completed(AuthenticatorBackupAttachCompletedWire),
    Rejected(AuthenticatorBackupAttachRejectedWire),
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticatorBackupAttachResponseKind {
    Completed,
    Rejected,
}

impl Serialize for AuthenticatorBackupAttachResponseKind {
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
pub enum AuthenticatorBackupAttachResponse {
    Completed {
        kind: AuthenticatorBackupAttachResponseKind,
    },
    Rejected {
        kind: AuthenticatorBackupAttachResponseKind,
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("authenticator backup attach response is malformed")]
pub struct AuthenticatorBackupAttachResponseDecodeError;

impl AuthenticatorBackupAttachResponse {
    pub fn from_wire(
        wire: AuthenticatorBackupAttachResponseWire,
    ) -> Result<AuthenticatorBackupAttachResponse, AuthenticatorBackupAttachResponseDecodeError>
    {
        match wire {
            AuthenticatorBackupAttachResponseWire::Completed(
                AuthenticatorBackupAttachCompletedWire { ok: true },
            ) => Ok(AuthenticatorBackupAttachResponse::Completed {
                kind: AuthenticatorBackupAttachResponseKind::Completed,
            }),
            AuthenticatorBackupAttachResponseWire::Rejected(
                AuthenticatorBackupAttachRejectedWire { ok: false, reason },
            ) if !reason.trim().is_empty() => Ok(AuthenticatorBackupAttachResponse::Rejected {
                kind: AuthenticatorBackupAttachResponseKind::Rejected,
                reason,
            }),
            AuthenticatorBackupAttachResponseWire::Completed(_)
            | AuthenticatorBackupAttachResponseWire::Rejected(_) => {
                Err(AuthenticatorBackupAttachResponseDecodeError)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_completed_and_rejected_backup_attachment() {
        assert_eq!(
            AuthenticatorBackupAttachResponse::from_wire(
                AuthenticatorBackupAttachResponseWire::Completed(
                    AuthenticatorBackupAttachCompletedWire { ok: true },
                ),
            ),
            Ok(AuthenticatorBackupAttachResponse::Completed {
                kind: AuthenticatorBackupAttachResponseKind::Completed,
            })
        );
        assert_eq!(
            AuthenticatorBackupAttachResponse::from_wire(
                AuthenticatorBackupAttachResponseWire::Rejected(
                    AuthenticatorBackupAttachRejectedWire {
                        ok: false,
                        reason: "authenticator-locked".to_owned(),
                    },
                ),
            ),
            Ok(AuthenticatorBackupAttachResponse::Rejected {
                kind: AuthenticatorBackupAttachResponseKind::Rejected,
                reason: "authenticator-locked".to_owned(),
            })
        );
    }

    #[test]
    fn rejects_contradictory_or_incomplete_backup_attachment() {
        for malformed in [
            AuthenticatorBackupAttachResponseWire::Rejected(
                AuthenticatorBackupAttachRejectedWire {
                    ok: true,
                    reason: "authenticator-locked".to_owned(),
                },
            ),
            AuthenticatorBackupAttachResponseWire::Completed(
                AuthenticatorBackupAttachCompletedWire { ok: false },
            ),
            AuthenticatorBackupAttachResponseWire::Rejected(
                AuthenticatorBackupAttachRejectedWire {
                    ok: false,
                    reason: " ".to_owned(),
                },
            ),
        ] {
            assert_eq!(
                AuthenticatorBackupAttachResponse::from_wire(malformed),
                Err(AuthenticatorBackupAttachResponseDecodeError)
            );
        }
    }

    #[test]
    fn rejects_unknown_backup_attachment_fields() {
        assert!(
            serde_json::from_str::<AuthenticatorBackupAttachResponseWire>(
                r#"{"ok":true,"extra":"value"}"#,
            )
            .is_err()
        );
    }
}
