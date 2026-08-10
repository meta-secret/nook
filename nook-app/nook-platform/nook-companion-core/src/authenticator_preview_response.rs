//! Typed runtime response boundary for validated TOTP enrollment previews.

use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error as _};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "UPPERCASE")]
enum AuthenticatorPreviewAlgorithmWire {
    Sha1,
    Sha256,
    Sha512,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct AuthenticatorPreviewDigits(u32);

impl<'de> Deserialize<'de> for AuthenticatorPreviewDigits {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = u32::deserialize(deserializer)?;
        if (6..=8).contains(&value) {
            Ok(Self(value))
        } else {
            Err(D::Error::custom("TOTP digits must be between 6 and 8"))
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct AuthenticatorPreviewPeriod(u64);

impl<'de> Deserialize<'de> for AuthenticatorPreviewPeriod {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = u64::deserialize(deserializer)?;
        if (15..=300).contains(&value) {
            Ok(Self(value))
        } else {
            Err(D::Error::custom("TOTP period must be between 15 and 300"))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AuthenticatorEnrollmentPreviewWire {
    issuer: String,
    account: String,
    website_url: String,
    algorithm: AuthenticatorPreviewAlgorithmWire,
    #[tsify(type = "number")]
    digits: AuthenticatorPreviewDigits,
    #[tsify(type = "number")]
    period: AuthenticatorPreviewPeriod,
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

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticatorPreviewAlgorithm {
    Sha1,
    Sha256,
    Sha512,
}

impl Serialize for AuthenticatorPreviewAlgorithm {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(*self as u8)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub struct AuthenticatorEnrollmentPreview {
    pub issuer: String,
    pub account: String,
    pub website_url: String,
    pub algorithm: AuthenticatorPreviewAlgorithm,
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
            let algorithm = match preview.algorithm {
                AuthenticatorPreviewAlgorithmWire::Sha1 => AuthenticatorPreviewAlgorithm::Sha1,
                AuthenticatorPreviewAlgorithmWire::Sha256 => AuthenticatorPreviewAlgorithm::Sha256,
                AuthenticatorPreviewAlgorithmWire::Sha512 => AuthenticatorPreviewAlgorithm::Sha512,
            };
            Ok(AuthenticatorPreviewResponse::Ready {
                kind: AuthenticatorPreviewResponseKind::Ready,
                preview: AuthenticatorEnrollmentPreview {
                    issuer: preview.issuer,
                    account: preview.account,
                    website_url: preview.website_url,
                    algorithm,
                    digits: preview.digits.0,
                    period: preview.period.0,
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

    fn preview(algorithm: AuthenticatorPreviewAlgorithmWire) -> AuthenticatorEnrollmentPreviewWire {
        AuthenticatorEnrollmentPreviewWire {
            issuer: "Nook".to_owned(),
            account: "alice".to_owned(),
            website_url: "https://example.com".to_owned(),
            algorithm,
            digits: AuthenticatorPreviewDigits(6),
            period: AuthenticatorPreviewPeriod(30),
        }
    }

    fn ready_wire(
        ok: bool,
        vault_store_id: &str,
        vault_name: &str,
    ) -> AuthenticatorPreviewResponseWire {
        AuthenticatorPreviewResponseWire::Available(AuthenticatorPreviewAvailableWire::Ready {
            ok,
            preview: preview(AuthenticatorPreviewAlgorithmWire::Sha256),
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
                    algorithm: AuthenticatorPreviewAlgorithm::Sha256,
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
