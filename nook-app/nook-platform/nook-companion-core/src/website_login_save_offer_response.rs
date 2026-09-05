#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

//! Typed service-worker response boundary for website login-save offers.

use serde::{Deserialize, Deserializer, Serialize, de::Error as _};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "0 | 1")]
pub struct WebsiteLoginSaveOfferDecision(u32);

impl<'de> Deserialize<'de> for WebsiteLoginSaveOfferDecision {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        match u32::deserialize(deserializer)? {
            decision @ (0 | 1) => Ok(Self(decision)),
            _ => Err(D::Error::custom(
                "login-save offer decision is not supported",
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WebsiteLoginSaveOffer {
    offer_id: String,
    decision: WebsiteLoginSaveOfferDecision,
    vault_store_id: String,
    vault_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(
    deny_unknown_fields,
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum WebsiteLoginSaveOfferResponse {
    OfferAvailable { offer: WebsiteLoginSaveOffer },
    NotRequired {},
    Locked {},
    Unavailable {},
    Rejected { reason: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("website login-save offer response is malformed")]
pub struct WebsiteLoginSaveOfferResponseDecodeError;

impl WebsiteLoginSaveOffer {
    fn is_valid(&self) -> bool {
        !self.offer_id.trim().is_empty()
            && !self.vault_store_id.trim().is_empty()
            && !self.vault_name.trim().is_empty()
    }
}

impl WebsiteLoginSaveOfferResponse {
    pub fn validate(
        self,
    ) -> Result<WebsiteLoginSaveOfferResponse, WebsiteLoginSaveOfferResponseDecodeError> {
        match &self {
            WebsiteLoginSaveOfferResponse::OfferAvailable { offer } if offer.is_valid() => Ok(self),
            WebsiteLoginSaveOfferResponse::NotRequired {}
            | WebsiteLoginSaveOfferResponse::Locked {}
            | WebsiteLoginSaveOfferResponse::Unavailable {} => Ok(self),
            WebsiteLoginSaveOfferResponse::Rejected { reason } if !reason.trim().is_empty() => {
                Ok(self)
            }
            WebsiteLoginSaveOfferResponse::OfferAvailable { .. }
            | WebsiteLoginSaveOfferResponse::Rejected { .. } => {
                Err(WebsiteLoginSaveOfferResponseDecodeError)
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(
    deny_unknown_fields,
    tag = "state",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum WebsiteLoginSavePendingAvailable {
    Unavailable {
        ok: bool,
    },
    Available {
        ok: bool,
        offer: WebsiteLoginSaveOffer,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct WebsiteLoginSavePendingRejected {
    ok: bool,
    reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(untagged)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum WebsiteLoginSavePendingResponse {
    Available(WebsiteLoginSavePendingAvailable),
    Rejected(WebsiteLoginSavePendingRejected),
}

impl WebsiteLoginSavePendingResponse {
    pub fn validate(
        self,
    ) -> Result<WebsiteLoginSavePendingResponse, WebsiteLoginSaveOfferResponseDecodeError> {
        match &self {
            WebsiteLoginSavePendingResponse::Available(
                WebsiteLoginSavePendingAvailable::Unavailable { ok: true },
            ) => Ok(self),
            WebsiteLoginSavePendingResponse::Available(
                WebsiteLoginSavePendingAvailable::Available { ok: true, offer },
            ) if offer.is_valid() => Ok(self),
            WebsiteLoginSavePendingResponse::Rejected(WebsiteLoginSavePendingRejected {
                ok: false,
                reason,
            }) if !reason.trim().is_empty() => Ok(self),
            WebsiteLoginSavePendingResponse::Available(_)
            | WebsiteLoginSavePendingResponse::Rejected(_) => {
                Err(WebsiteLoginSaveOfferResponseDecodeError)
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields, tag = "kind", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum WebsiteLoginSaveActionResponse {
    Completed {},
    Rejected { reason: String },
}

impl WebsiteLoginSaveActionResponse {
    pub fn validate(
        self,
    ) -> Result<WebsiteLoginSaveActionResponse, WebsiteLoginSaveOfferResponseDecodeError> {
        match &self {
            WebsiteLoginSaveActionResponse::Completed {} => Ok(self),
            WebsiteLoginSaveActionResponse::Rejected { reason } if !reason.trim().is_empty() => {
                Ok(self)
            }
            WebsiteLoginSaveActionResponse::Rejected { .. } => {
                Err(WebsiteLoginSaveOfferResponseDecodeError)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_each_login_save_offer_variant() -> anyhow::Result<()> {
        for serialized in [
            r#"{"kind":"offer-available","offer":{"offerId":"offer","decision":0,"vaultStoreId":"vault","vaultName":"Personal"}}"#,
            r#"{"kind":"not-required"}"#,
            r#"{"kind":"locked"}"#,
            r#"{"kind":"unavailable"}"#,
            r#"{"kind":"rejected","reason":"login-save-plan-failed"}"#,
        ] {
            let response = serde_json::from_str::<WebsiteLoginSaveOfferResponse>(serialized)?;
            assert!(WebsiteLoginSaveOfferResponse::validate(response).is_ok());
        }
        Ok(())
    }

    #[test]
    fn rejects_blank_contradictory_and_foreign_offer_values() {
        for serialized in [
            r#"{"kind":"offer-available","offer":{"offerId":"","decision":0,"vaultStoreId":"vault","vaultName":"Personal"}}"#,
            r#"{"kind":"offer-available","offer":{"offerId":"offer","decision":2,"vaultStoreId":"vault","vaultName":"Personal"}}"#,
            r#"{"kind":"offer-available","offer":{"offerId":"offer","decision":0,"vaultStoreId":"vault","vaultName":" "}}"#,
            r#"{"kind":"offer-available","offer":{"offerId":"offer","decision":0,"vaultStoreId":"vault","vaultName":"Personal"},"reason":"login-save-plan-failed"}"#,
            r#"{"kind":"locked","offer":{"offerId":"offer","decision":0,"vaultStoreId":"vault","vaultName":"Personal"}}"#,
            r#"{"kind":"rejected","reason":" "}"#,
        ] {
            let decoded = serde_json::from_str::<WebsiteLoginSaveOfferResponse>(serialized)
                .map_err(|_| WebsiteLoginSaveOfferResponseDecodeError)
                .and_then(WebsiteLoginSaveOfferResponse::validate);
            assert!(decoded.is_err(), "accepted {serialized}");
        }
    }

    #[test]
    fn pending_and_action_variants_are_closed() -> anyhow::Result<()> {
        for serialized in [
            r#"{"ok":true,"state":"unavailable"}"#,
            r#"{"ok":true,"state":"available","offer":{"offerId":"offer","decision":1,"vaultStoreId":"vault","vaultName":"Personal"}}"#,
            r#"{"ok":false,"reason":"login-save-pending-failed"}"#,
        ] {
            let response = serde_json::from_str::<WebsiteLoginSavePendingResponse>(serialized)?;
            assert!(WebsiteLoginSavePendingResponse::validate(response).is_ok());
        }
        for serialized in [
            r#"{"kind":"completed"}"#,
            r#"{"kind":"rejected","reason":"login-save-commit-failed"}"#,
        ] {
            let response = serde_json::from_str::<WebsiteLoginSaveActionResponse>(serialized)?;
            assert!(WebsiteLoginSaveActionResponse::validate(response).is_ok());
        }
        for serialized in [
            r#"{"ok":true,"state":"unavailable","offer":{"offerId":"offer","decision":0,"vaultStoreId":"vault","vaultName":"Personal"}}"#,
            r#"{"ok":false,"reason":" "}"#,
        ] {
            let decoded = serde_json::from_str::<WebsiteLoginSavePendingResponse>(serialized)
                .map_err(|_| WebsiteLoginSaveOfferResponseDecodeError)
                .and_then(WebsiteLoginSavePendingResponse::validate);
            assert!(decoded.is_err(), "accepted {serialized}");
        }
        assert!(
            serde_json::from_str::<WebsiteLoginSaveActionResponse>(
                r#"{"kind":"completed","reason":"contradiction"}"#,
            )
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn preserves_save_decisions_and_string_discriminators() -> anyhow::Result<()> {
        for decision in [0, 1] {
            let wire = format!(
                r#"{{"kind":"offer-available","offer":{{"offerId":"offer","decision":{decision},"vaultStoreId":"vault","vaultName":"Personal"}}}}"#
            );
            let response: WebsiteLoginSaveOfferResponse = serde_json::from_str(&wire)?;
            assert_eq!(serde_json::to_string(&response.validate()?)?, wire);
        }
        let completed: WebsiteLoginSaveActionResponse =
            serde_json::from_str(r#"{"kind":"completed"}"#)?;
        assert_eq!(
            serde_json::to_string(&completed.validate()?)?,
            r#"{"kind":"completed"}"#
        );
        for wire in [
            r#"{"ok":false,"state":"unavailable"}"#,
            r#"{"ok":false,"state":"available","offer":{"offerId":"offer","decision":1,"vaultStoreId":"vault","vaultName":"Personal"}}"#,
            r#"{"ok":true,"reason":"denied"}"#,
            r#"{"ok":true,"state":"available","offer":{"offerId":"offer","decision":1,"vaultStoreId":" ","vaultName":"Personal"}}"#,
        ] {
            let response: WebsiteLoginSavePendingResponse = serde_json::from_str(wire)?;
            assert!(response.validate().is_err());
        }
        let rejected: WebsiteLoginSaveActionResponse =
            serde_json::from_str(r#"{"kind":"rejected","reason":" "}"#)?;
        assert!(rejected.validate().is_err());
        Ok(())
    }
}
