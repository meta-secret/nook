//! Typed runtime response boundary for website-login options.

use serde::{Deserialize, Serialize, Serializer};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WebsiteLoginAccountWire {
    vault_store_id: String,
    vault_name: String,
    secret_id: String,
    username: String,
    website_url: String,
    website_host: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, tag = "status", rename_all = "kebab-case")]
pub enum WebsiteLoginOptionsAvailableWire {
    Ready {
        ok: bool,
        #[serde(rename = "authorizationGeneration")]
        authorization_generation: String,
        accounts: Vec<WebsiteLoginAccountWire>,
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
pub struct WebsiteLoginOptionsRejectedWire {
    ok: bool,
    reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(untagged, rename_all_fields = "camelCase")]
pub enum WebsiteLoginOptionsWire {
    Available(WebsiteLoginOptionsAvailableWire),
    Rejected(WebsiteLoginOptionsRejectedWire),
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(from_wasm_abi)]
pub struct WebsiteLoginOptionsWireValue(WebsiteLoginOptionsWire);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub struct WebsiteLoginAccountOption {
    pub vault_store_id: String,
    pub vault_name: String,
    pub secret_id: String,
    pub username: String,
    pub website_url: String,
    pub website_host: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(untagged, rename_all_fields = "camelCase")]
#[tsify(into_wasm_abi)]
pub enum WebsiteLoginOptions {
    Ready {
        kind: WebsiteLoginOptionsKind,
        authorization_generation: String,
        accounts: Vec<WebsiteLoginAccountOption>,
    },
    Locked {
        kind: WebsiteLoginOptionsKind,
    },
    Unavailable {
        kind: WebsiteLoginOptionsKind,
    },
    Rejected {
        kind: WebsiteLoginOptionsKind,
        reason: String,
    },
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebsiteLoginOptionsKind {
    Ready,
    Locked,
    Unavailable,
    Rejected,
}

impl Serialize for WebsiteLoginOptionsKind {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(*self as u8)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum WebsiteLoginOptionsDecodeError {
    #[error("website login options response is malformed")]
    Malformed,
}

pub fn decode_website_login_options_json(
    serialized: &str,
) -> Result<WebsiteLoginOptions, WebsiteLoginOptionsDecodeError> {
    let wire = serde_json::from_str::<WebsiteLoginOptionsWireValue>(serialized)
        .map_err(|_| WebsiteLoginOptionsDecodeError::Malformed)?;
    decode_website_login_options(wire)
}

pub fn decode_website_login_options(
    wire: WebsiteLoginOptionsWireValue,
) -> Result<WebsiteLoginOptions, WebsiteLoginOptionsDecodeError> {
    let WebsiteLoginOptionsWireValue(wire) = wire;
    match wire {
        WebsiteLoginOptionsWire::Available(WebsiteLoginOptionsAvailableWire::Ready {
            ok: true,
            authorization_generation,
            accounts,
        }) => {
            if authorization_generation.trim().is_empty()
                || accounts.iter().any(|account| {
                    account.vault_store_id.trim().is_empty() || account.secret_id.trim().is_empty()
                })
            {
                return Err(WebsiteLoginOptionsDecodeError::Malformed);
            }
            Ok(WebsiteLoginOptions::Ready {
                kind: WebsiteLoginOptionsKind::Ready,
                authorization_generation,
                accounts: accounts
                    .into_iter()
                    .map(|account| WebsiteLoginAccountOption {
                        vault_store_id: account.vault_store_id,
                        vault_name: account.vault_name,
                        secret_id: account.secret_id,
                        username: account.username,
                        website_url: account.website_url,
                        website_host: account.website_host,
                    })
                    .collect(),
            })
        }
        WebsiteLoginOptionsWire::Available(WebsiteLoginOptionsAvailableWire::Locked {
            ok: true,
        }) => Ok(WebsiteLoginOptions::Locked {
            kind: WebsiteLoginOptionsKind::Locked,
        }),
        WebsiteLoginOptionsWire::Available(WebsiteLoginOptionsAvailableWire::Unavailable {
            ok: true,
        }) => Ok(WebsiteLoginOptions::Unavailable {
            kind: WebsiteLoginOptionsKind::Unavailable,
        }),
        WebsiteLoginOptionsWire::Rejected(WebsiteLoginOptionsRejectedWire {
            ok: false,
            reason,
        }) if !reason.trim().is_empty() => Ok(WebsiteLoginOptions::Rejected {
            kind: WebsiteLoginOptionsKind::Rejected,
            reason,
        }),
        WebsiteLoginOptionsWire::Available(_)
        | WebsiteLoginOptionsWire::Rejected(WebsiteLoginOptionsRejectedWire { .. }) => {
            Err(WebsiteLoginOptionsDecodeError::Malformed)
        }
    }
}

pub fn decode_website_login_match_availability(
    wire: WebsiteLoginOptionsWireValue,
) -> Result<crate::WebsiteLoginMatchAvailability, WebsiteLoginOptionsDecodeError> {
    Ok(match decode_website_login_options(wire)? {
        WebsiteLoginOptions::Ready { accounts, .. } => {
            crate::WebsiteLoginMatchAvailability::Ready {
                count: u32::try_from(accounts.len())
                    .map_err(|_| WebsiteLoginOptionsDecodeError::Malformed)?,
            }
        }
        WebsiteLoginOptions::Locked { .. } => crate::WebsiteLoginMatchAvailability::Locked,
        WebsiteLoginOptions::Unavailable { .. } | WebsiteLoginOptions::Rejected { .. } => {
            crate::WebsiteLoginMatchAvailability::Unavailable
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_every_login_options_variant_and_invariant() -> anyhow::Result<()> {
        let ready = r#"{"ok":true,"status":"ready","authorizationGeneration":"epoch-1","accounts":[{"vaultStoreId":"vault","vaultName":"Personal","secretId":"secret","username":"alice","websiteUrl":"https://example.com","websiteHost":"example.com"}]}"#;
        assert!(matches!(
            decode_website_login_options_json(ready)?,
            WebsiteLoginOptions::Ready { .. }
        ));
        for serialized in [
            r#"{"ok":true,"status":"locked"}"#,
            r#"{"ok":true,"status":"unavailable"}"#,
            r#"{"ok":false,"reason":"vault-locked"}"#,
        ] {
            assert!(decode_website_login_options_json(serialized).is_ok());
        }
        assert!(
            decode_website_login_options_json(&ready.replacen("\"vault\"", "\"\"", 1)).is_err()
        );
        for malformed in [
            r#"{"ok":true,"status":"ready"}"#,
            r#"{"ok":false,"status":"ready","accounts":[]}"#,
            r#"{"ok":false,"status":"locked"}"#,
            r#"{"ok":false,"status":"unavailable"}"#,
            r#"{"ok":true,"reason":"vault-locked"}"#,
            r#"{"ok":false,"reason":" "}"#,
            r#"{"ok":true,"status":"ready","authorizationGeneration":"epoch-1","accounts":[{"vaultStoreId":"vault","vaultName":"Personal","secretId":"secret","username":"alice","websiteUrl":"https://example.com","websiteHost":"example.com","password":"foreign"}]}"#,
        ] {
            assert!(decode_website_login_options_json(malformed).is_err());
        }
        Ok(())
    }

    #[test]
    fn derives_closed_login_match_availability() -> anyhow::Result<()> {
        for (serialized, expected) in [
            (
                r#"{"ok":true,"status":"ready","authorizationGeneration":"epoch-1","accounts":[{"vaultStoreId":"vault","vaultName":"Personal","secretId":"secret","username":"alice","websiteUrl":"https://example.com","websiteHost":"example.com"}]}"#,
                crate::WebsiteLoginMatchAvailability::Ready { count: 1 },
            ),
            (
                r#"{"ok":true,"status":"locked"}"#,
                crate::WebsiteLoginMatchAvailability::Locked,
            ),
            (
                r#"{"ok":true,"status":"unavailable"}"#,
                crate::WebsiteLoginMatchAvailability::Unavailable,
            ),
            (
                r#"{"ok":false,"reason":"login-forbidden-origin"}"#,
                crate::WebsiteLoginMatchAvailability::Unavailable,
            ),
        ] {
            let wire = serde_json::from_str::<WebsiteLoginOptionsWireValue>(serialized)?;
            assert_eq!(decode_website_login_match_availability(wire)?, expected);
        }
        Ok(())
    }
}
