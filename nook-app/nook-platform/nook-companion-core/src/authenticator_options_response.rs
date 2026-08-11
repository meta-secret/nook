//! Typed runtime response boundary for website authenticator identities.

use serde::{Deserialize, Serialize, Serializer};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WebsiteAuthenticatorOptionWire {
    vault_store_id: String,
    vault_name: String,
    secret_id: String,
    issuer: String,
    account: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(
    deny_unknown_fields,
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum AuthenticatorOptionsAvailableWire {
    Ready {
        ok: bool,
        accounts: Vec<WebsiteAuthenticatorOptionWire>,
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
pub struct AuthenticatorOptionsRejectedWire {
    ok: bool,
    reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(untagged)]
#[tsify(from_wasm_abi)]
pub enum AuthenticatorOptionsResponseWire {
    Available(AuthenticatorOptionsAvailableWire),
    Rejected(AuthenticatorOptionsRejectedWire),
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticatorOptionsResponseKind {
    Ready,
    Locked,
    Unavailable,
    Rejected,
}

impl Serialize for AuthenticatorOptionsResponseKind {
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
pub struct WebsiteAuthenticatorOption {
    pub vault_store_id: String,
    pub vault_name: String,
    pub secret_id: String,
    pub issuer: String,
    pub account: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(untagged)]
#[tsify(into_wasm_abi)]
pub enum AuthenticatorOptionsResponse {
    Ready {
        kind: AuthenticatorOptionsResponseKind,
        accounts: Vec<WebsiteAuthenticatorOption>,
    },
    Locked {
        kind: AuthenticatorOptionsResponseKind,
    },
    Unavailable {
        kind: AuthenticatorOptionsResponseKind,
    },
    Rejected {
        kind: AuthenticatorOptionsResponseKind,
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("authenticator options response is malformed")]
pub struct AuthenticatorOptionsResponseDecodeError;

fn decode_account(
    account: WebsiteAuthenticatorOptionWire,
) -> Result<WebsiteAuthenticatorOption, AuthenticatorOptionsResponseDecodeError> {
    if account.vault_store_id.trim().is_empty()
        || account.vault_name.trim().is_empty()
        || account.secret_id.trim().is_empty()
        || account.issuer.trim().is_empty()
    {
        return Err(AuthenticatorOptionsResponseDecodeError);
    }
    Ok(WebsiteAuthenticatorOption {
        vault_store_id: account.vault_store_id,
        vault_name: account.vault_name,
        secret_id: account.secret_id,
        issuer: account.issuer,
        account: account.account,
    })
}

pub fn decode_authenticator_options_response(
    wire: AuthenticatorOptionsResponseWire,
) -> Result<AuthenticatorOptionsResponse, AuthenticatorOptionsResponseDecodeError> {
    match wire {
        AuthenticatorOptionsResponseWire::Available(AuthenticatorOptionsAvailableWire::Ready {
            ok: true,
            accounts,
        }) => Ok(AuthenticatorOptionsResponse::Ready {
            kind: AuthenticatorOptionsResponseKind::Ready,
            accounts: accounts
                .into_iter()
                .map(decode_account)
                .collect::<Result<Vec<_>, _>>()?,
        }),
        AuthenticatorOptionsResponseWire::Available(
            AuthenticatorOptionsAvailableWire::Locked { ok: true },
        ) => Ok(AuthenticatorOptionsResponse::Locked {
            kind: AuthenticatorOptionsResponseKind::Locked,
        }),
        AuthenticatorOptionsResponseWire::Available(
            AuthenticatorOptionsAvailableWire::Unavailable { ok: true },
        ) => Ok(AuthenticatorOptionsResponse::Unavailable {
            kind: AuthenticatorOptionsResponseKind::Unavailable,
        }),
        AuthenticatorOptionsResponseWire::Rejected(AuthenticatorOptionsRejectedWire {
            ok: false,
            reason,
        }) if !reason.trim().is_empty() => Ok(AuthenticatorOptionsResponse::Rejected {
            kind: AuthenticatorOptionsResponseKind::Rejected,
            reason,
        }),
        AuthenticatorOptionsResponseWire::Available(_)
        | AuthenticatorOptionsResponseWire::Rejected(_) => {
            Err(AuthenticatorOptionsResponseDecodeError)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(
        vault_store_id: &str,
        secret_id: &str,
        issuer: &str,
    ) -> WebsiteAuthenticatorOptionWire {
        WebsiteAuthenticatorOptionWire {
            vault_store_id: vault_store_id.to_owned(),
            vault_name: "Personal".to_owned(),
            secret_id: secret_id.to_owned(),
            issuer: issuer.to_owned(),
            account: "alice@example.test".to_owned(),
        }
    }

    #[test]
    fn decodes_each_authenticator_options_variant() {
        let ready =
            AuthenticatorOptionsResponseWire::Available(AuthenticatorOptionsAvailableWire::Ready {
                ok: true,
                accounts: vec![account("vault", "secret", "Nook")],
            });
        assert!(matches!(
            decode_authenticator_options_response(ready),
            Ok(AuthenticatorOptionsResponse::Ready { accounts, .. }) if accounts.len() == 1
        ));
        for (wire, expected) in [
            (
                AuthenticatorOptionsAvailableWire::Locked { ok: true },
                AuthenticatorOptionsResponseKind::Locked,
            ),
            (
                AuthenticatorOptionsAvailableWire::Unavailable { ok: true },
                AuthenticatorOptionsResponseKind::Unavailable,
            ),
        ] {
            let decoded = decode_authenticator_options_response(
                AuthenticatorOptionsResponseWire::Available(wire),
            );
            assert!(matches!(
                decoded,
                Ok(
                    AuthenticatorOptionsResponse::Locked { kind }
                        | AuthenticatorOptionsResponse::Unavailable { kind },
                ) if kind == expected
            ));
        }
        assert!(matches!(
            decode_authenticator_options_response(AuthenticatorOptionsResponseWire::Rejected(
                AuthenticatorOptionsRejectedWire {
                    ok: false,
                    reason: "authenticator-locked".to_owned(),
                },
            )),
            Ok(AuthenticatorOptionsResponse::Rejected { .. })
        ));
    }

    #[test]
    fn rejects_blank_authenticator_account_identity() {
        let mut blank_vault_name = account("vault", "secret", "Nook");
        blank_vault_name.vault_name = " ".to_owned();
        for malformed in [
            blank_vault_name,
            account(" ", "secret", "Nook"),
            account("vault", " ", "Nook"),
            account("vault", "secret", " "),
        ] {
            let wire = AuthenticatorOptionsResponseWire::Available(
                AuthenticatorOptionsAvailableWire::Ready {
                    ok: true,
                    accounts: vec![malformed],
                },
            );
            assert_eq!(
                decode_authenticator_options_response(wire),
                Err(AuthenticatorOptionsResponseDecodeError)
            );
        }
    }

    #[test]
    fn rejects_contradictory_authenticator_options_states() {
        for wire in [
            AuthenticatorOptionsResponseWire::Available(AuthenticatorOptionsAvailableWire::Ready {
                ok: false,
                accounts: Vec::new(),
            }),
            AuthenticatorOptionsResponseWire::Available(
                AuthenticatorOptionsAvailableWire::Locked { ok: false },
            ),
            AuthenticatorOptionsResponseWire::Available(
                AuthenticatorOptionsAvailableWire::Unavailable { ok: false },
            ),
            AuthenticatorOptionsResponseWire::Rejected(AuthenticatorOptionsRejectedWire {
                ok: true,
                reason: "authenticator-locked".to_owned(),
            }),
            AuthenticatorOptionsResponseWire::Rejected(AuthenticatorOptionsRejectedWire {
                ok: false,
                reason: " ".to_owned(),
            }),
        ] {
            assert_eq!(
                decode_authenticator_options_response(wire),
                Err(AuthenticatorOptionsResponseDecodeError)
            );
        }
    }
}
