#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

//! Typed boundary for passkey account-list session responses.

use serde::{Deserialize, Serialize, Serializer};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WebsitePasskeyAccountWire {
    credential_id: String,
    user_name: String,
    user_display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WebsitePasskeyAccountListWire {
    ok: bool,
    accounts: Vec<WebsitePasskeyAccountWire>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub struct WebsitePasskeyAccount {
    pub credential_id: String,
    pub user_name: String,
    pub user_display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(untagged, rename_all_fields = "camelCase")]
#[tsify(into_wasm_abi)]
pub enum WebsitePasskeyAccountList {
    Ready {
        kind: WebsitePasskeyAccountListKind,
        accounts: Vec<WebsitePasskeyAccount>,
    },
    Invalid {
        kind: WebsitePasskeyAccountListKind,
    },
}

impl WebsitePasskeyAccountList {
    #[must_use]
    pub const fn invalid() -> Self {
        Self::Invalid {
            kind: WebsitePasskeyAccountListKind::Invalid,
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebsitePasskeyAccountListKind {
    Ready,
    Invalid,
}

impl Serialize for WebsitePasskeyAccountListKind {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(*self as u8)
    }
}

impl WebsitePasskeyAccountList {
    #[must_use]
    pub fn from_wire(wire: WebsitePasskeyAccountListWire) -> WebsitePasskeyAccountList {
        if !wire.ok
            || wire
                .accounts
                .iter()
                .any(|account| account.credential_id.trim().is_empty())
        {
            return WebsitePasskeyAccountList::invalid();
        }

        WebsitePasskeyAccountList::Ready {
            kind: WebsitePasskeyAccountListKind::Ready,
            accounts: wire
                .accounts
                .into_iter()
                .map(|account| WebsitePasskeyAccount {
                    credential_id: account.credential_id,
                    user_name: account.user_name,
                    user_display_name: account.user_display_name,
                })
                .collect(),
        }
    }

    #[must_use]
    pub fn from_json(serialized: &str) -> WebsitePasskeyAccountList {
        serde_json::from_str(serialized).map_or_else(
            |_| WebsitePasskeyAccountList::invalid(),
            WebsitePasskeyAccountList::from_wire,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_complete_account_list_atomically() {
        assert!(matches!(
            WebsitePasskeyAccountList::from_json(
                r#"{"ok":true,"accounts":[{"credentialId":"credential-id","userName":"person@example.test","userDisplayName":"Person"}]}"#,
            ),
            WebsitePasskeyAccountList::Ready { accounts, .. } if accounts.len() == 1
        ));
    }

    #[test]
    fn rejects_the_complete_list_when_any_account_is_malformed() {
        for malformed in [
            r#"{"ok":false}"#,
            r#"{"ok":true,"accounts":[{"credentialId":"credential-id","userName":"person@example.test","userDisplayName":"Person"},{"credentialId":"","userName":"other@example.test","userDisplayName":"Other"}]}"#,
            r#"{"ok":true,"accounts":[{"credentialId":"credential-id","userName":"person@example.test"}]}"#,
            r#"{"ok":true,"accounts":[{"credentialId":"credential-id","userName":"person@example.test","userDisplayName":"Person","foreign":true}]}"#,
        ] {
            assert_eq!(
                WebsitePasskeyAccountList::from_json(malformed),
                WebsitePasskeyAccountList::invalid()
            );
        }
    }

    #[test]
    fn preserves_empty_lists_blank_names_and_numeric_kinds() -> anyhow::Result<()> {
        let empty = WebsitePasskeyAccountList::from_json(r#"{"ok":true,"accounts":[]}"#);
        assert_eq!(
            serde_json::to_string(&empty)?,
            r#"{"kind":0,"accounts":[]}"#
        );
        let blank_names = WebsitePasskeyAccountList::from_json(
            r#"{"ok":true,"accounts":[{"credentialId":"credential","userName":"","userDisplayName":""}]}"#,
        );
        assert_eq!(
            serde_json::to_string(&blank_names)?,
            r#"{"kind":0,"accounts":[{"credentialId":"credential","userName":"","userDisplayName":""}]}"#
        );
        for wire in [
            r#"{"ok":false,"accounts":[]}"#,
            r#"{"ok":true,"accounts":[{"credentialId":" ","userName":"","userDisplayName":""}]}"#,
            "not-json",
        ] {
            let rejected = WebsitePasskeyAccountList::from_json(wire);
            assert_eq!(rejected, WebsitePasskeyAccountList::invalid());
            assert_eq!(serde_json::to_string(&rejected)?, r#"{"kind":1}"#);
        }
        Ok(())
    }
}
