//! Typed runtime response boundary for validated TOTP enrollment previews.

use nook_authenticator_domain::{TotpAlgorithm, TotpDigits, TotpPeriod};
use serde::{Deserialize, Serialize, Serializer};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AuthenticatorEnrollmentPreviewWire {
    issuer: String,
    account: String,
    website_url: String,
    #[tsify(type = "'SHA1' | 'SHA256' | 'SHA512'")]
    algorithm: TotpAlgorithm,
    #[tsify(type = "number")]
    digits: TotpDigits,
    #[tsify(type = "number")]
    period: TotpPeriod,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(
    deny_unknown_fields,
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum AuthenticatorPreviewAvailableWire {
    Ready {
        ok: bool,
        preview: AuthenticatorEnrollmentPreviewWire,
        vault_store_id: String,
        vault_name: String,
    },
    Unavailable {
        ok: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct AuthenticatorPreviewRejectedWire {
    ok: bool,
    reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(untagged, rename_all_fields = "camelCase")]
#[tsify(from_wasm_abi)]
pub enum AuthenticatorPreviewResponseWire {
    Available(AuthenticatorPreviewAvailableWire),
    Rejected(AuthenticatorPreviewRejectedWire),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub struct AuthenticatorEnrollmentPreview {
    pub issuer: String,
    pub account: String,
    pub website_url: String,
    #[tsify(type = "'SHA1' | 'SHA256' | 'SHA512'")]
    pub algorithm: TotpAlgorithm,
    pub digits: u32,
    pub period: u64,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticatorPreviewResponseKind {
    Ready,
    Unavailable,
    Rejected,
}

impl Serialize for AuthenticatorPreviewResponseKind {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(*self as u8)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(untagged, rename_all_fields = "camelCase")]
#[tsify(into_wasm_abi)]
pub enum AuthenticatorPreviewResponse {
    Ready {
        kind: AuthenticatorPreviewResponseKind,
        preview: AuthenticatorEnrollmentPreview,
        vault_store_id: String,
    },
    Unavailable {
        kind: AuthenticatorPreviewResponseKind,
    },
    Rejected {
        kind: AuthenticatorPreviewResponseKind,
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("authenticator preview response is malformed")]
pub struct AuthenticatorPreviewResponseDecodeError;

pub fn decode_authenticator_preview_response(
    wire: AuthenticatorPreviewResponseWire,
) -> Result<AuthenticatorPreviewResponse, AuthenticatorPreviewResponseDecodeError> {
    match wire {
        AuthenticatorPreviewResponseWire::Available(AuthenticatorPreviewAvailableWire::Ready {
            ok: true,
            preview,
            vault_store_id,
            vault_name,
        }) if !vault_store_id.trim().is_empty() && !vault_name.trim().is_empty() => {
            Ok(AuthenticatorPreviewResponse::Ready {
                kind: AuthenticatorPreviewResponseKind::Ready,
                preview: AuthenticatorEnrollmentPreview {
                    issuer: preview.issuer,
                    account: preview.account,
                    website_url: preview.website_url,
                    algorithm: preview.algorithm,
                    digits: preview.digits.get(),
                    period: preview.period.get(),
                },
                vault_store_id,
            })
        }
        AuthenticatorPreviewResponseWire::Available(
            AuthenticatorPreviewAvailableWire::Unavailable { ok: true },
        ) => Ok(AuthenticatorPreviewResponse::Unavailable {
            kind: AuthenticatorPreviewResponseKind::Unavailable,
        }),
        AuthenticatorPreviewResponseWire::Rejected(AuthenticatorPreviewRejectedWire {
            ok: false,
            reason,
        }) if !reason.trim().is_empty() => Ok(AuthenticatorPreviewResponse::Rejected {
            kind: AuthenticatorPreviewResponseKind::Rejected,
            reason,
        }),
        AuthenticatorPreviewResponseWire::Available(_)
        | AuthenticatorPreviewResponseWire::Rejected(_) => {
            Err(AuthenticatorPreviewResponseDecodeError)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preview(algorithm: TotpAlgorithm) -> AuthenticatorEnrollmentPreviewWire {
        AuthenticatorEnrollmentPreviewWire {
            issuer: "Nook".to_owned(),
            account: "alice".to_owned(),
            website_url: "https://example.com".to_owned(),
            algorithm,
            digits: TotpDigits::default(),
            period: TotpPeriod::default(),
        }
    }

    fn ready_wire(
        ok: bool,
        vault_store_id: &str,
        vault_name: &str,
    ) -> AuthenticatorPreviewResponseWire {
        AuthenticatorPreviewResponseWire::Available(AuthenticatorPreviewAvailableWire::Ready {
            ok,
            preview: preview(TotpAlgorithm::Sha256),
            vault_store_id: vault_store_id.to_owned(),
            vault_name: vault_name.to_owned(),
        })
    }

    #[test]
    fn decodes_each_authenticator_preview_response_variant() {
        assert_eq!(
            decode_authenticator_preview_response(ready_wire(true, "vault", "Personal")),
            Ok(AuthenticatorPreviewResponse::Ready {
                kind: AuthenticatorPreviewResponseKind::Ready,
                preview: AuthenticatorEnrollmentPreview {
                    issuer: "Nook".to_owned(),
                    account: "alice".to_owned(),
                    website_url: "https://example.com".to_owned(),
                    algorithm: TotpAlgorithm::Sha256,
                    digits: 6,
                    period: 30,
                },
                vault_store_id: "vault".to_owned(),
            })
        );
        assert_eq!(
            decode_authenticator_preview_response(AuthenticatorPreviewResponseWire::Available(
                AuthenticatorPreviewAvailableWire::Unavailable { ok: true },
            )),
            Ok(AuthenticatorPreviewResponse::Unavailable {
                kind: AuthenticatorPreviewResponseKind::Unavailable,
            })
        );
        assert_eq!(
            decode_authenticator_preview_response(AuthenticatorPreviewResponseWire::Rejected(
                AuthenticatorPreviewRejectedWire {
                    ok: false,
                    reason: "vault-locked".to_owned(),
                },
            )),
            Ok(AuthenticatorPreviewResponse::Rejected {
                kind: AuthenticatorPreviewResponseKind::Rejected,
                reason: "vault-locked".to_owned(),
            })
        );
    }

    #[test]
    fn rejects_contradictory_authenticator_preview_success_states() {
        for contradictory in [
            ready_wire(false, "vault", "Personal"),
            AuthenticatorPreviewResponseWire::Available(
                AuthenticatorPreviewAvailableWire::Unavailable { ok: false },
            ),
            AuthenticatorPreviewResponseWire::Rejected(AuthenticatorPreviewRejectedWire {
                ok: true,
                reason: "vault-locked".to_owned(),
            }),
        ] {
            assert_eq!(
                decode_authenticator_preview_response(contradictory),
                Err(AuthenticatorPreviewResponseDecodeError)
            );
        }
    }

    #[test]
    fn rejects_missing_authenticator_preview_domain_identity() {
        for malformed in [
            ready_wire(true, " ", "Personal"),
            ready_wire(true, "vault", " "),
            AuthenticatorPreviewResponseWire::Rejected(AuthenticatorPreviewRejectedWire {
                ok: false,
                reason: " ".to_owned(),
            }),
        ] {
            assert_eq!(
                decode_authenticator_preview_response(malformed),
                Err(AuthenticatorPreviewResponseDecodeError)
            );
        }
    }

    #[test]
    fn rejects_invalid_totp_preview_metadata() {
        for malformed in [
            r#"{"ok":true,"status":"ready","preview":{"issuer":"Nook","account":"alice","websiteUrl":"https://example.com","algorithm":"MD5","digits":6,"period":30},"vaultStoreId":"vault","vaultName":"Personal"}"#,
            r#"{"ok":true,"status":"ready","preview":{"issuer":"Nook","account":"alice","websiteUrl":"https://example.com","algorithm":"SHA1","digits":6.5,"period":30},"vaultStoreId":"vault","vaultName":"Personal"}"#,
            r#"{"ok":true,"status":"ready","preview":{"issuer":"Nook","account":"alice","websiteUrl":"https://example.com","algorithm":"SHA1","digits":6,"period":-1},"vaultStoreId":"vault","vaultName":"Personal"}"#,
        ] {
            assert!(serde_json::from_str::<AuthenticatorPreviewResponseWire>(malformed).is_err());
        }
    }
}
