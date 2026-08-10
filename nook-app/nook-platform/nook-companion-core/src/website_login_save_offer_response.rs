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

fn offer_is_valid(offer: &WebsiteLoginSaveOffer) -> bool {
    !offer.offer_id.trim().is_empty()
        && !offer.vault_store_id.trim().is_empty()
        && !offer.vault_name.trim().is_empty()
}

pub fn decode_website_login_save_offer_response(
    response: WebsiteLoginSaveOfferResponse,
) -> Result<WebsiteLoginSaveOfferResponse, WebsiteLoginSaveOfferResponseDecodeError> {
    match &response {
        WebsiteLoginSaveOfferResponse::OfferAvailable { offer } if offer_is_valid(offer) => {
            Ok(response)
        }
        WebsiteLoginSaveOfferResponse::NotRequired {}
        | WebsiteLoginSaveOfferResponse::Locked {}
        | WebsiteLoginSaveOfferResponse::Unavailable {} => Ok(response),
        WebsiteLoginSaveOfferResponse::Rejected { reason } if !reason.trim().is_empty() => {
            Ok(response)
        }
        WebsiteLoginSaveOfferResponse::OfferAvailable { .. }
        | WebsiteLoginSaveOfferResponse::Rejected { .. } => {
            Err(WebsiteLoginSaveOfferResponseDecodeError)
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

pub fn decode_website_login_save_pending_response(
    response: WebsiteLoginSavePendingResponse,
) -> Result<WebsiteLoginSavePendingResponse, WebsiteLoginSaveOfferResponseDecodeError> {
    match &response {
        WebsiteLoginSavePendingResponse::Available(
            WebsiteLoginSavePendingAvailable::Unavailable { ok: true },
        ) => Ok(response),
        WebsiteLoginSavePendingResponse::Available(
            WebsiteLoginSavePendingAvailable::Available { ok: true, offer },
        ) if offer_is_valid(offer) => Ok(response),
        WebsiteLoginSavePendingResponse::Rejected(WebsiteLoginSavePendingRejected {
            ok: false,
            reason,
        }) if !reason.trim().is_empty() => Ok(response),
        WebsiteLoginSavePendingResponse::Available(_)
        | WebsiteLoginSavePendingResponse::Rejected(_) => {
            Err(WebsiteLoginSaveOfferResponseDecodeError)
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

pub fn decode_website_login_save_action_response(
    response: WebsiteLoginSaveActionResponse,
) -> Result<WebsiteLoginSaveActionResponse, WebsiteLoginSaveOfferResponseDecodeError> {
    match &response {
        WebsiteLoginSaveActionResponse::Completed {} => Ok(response),
        WebsiteLoginSaveActionResponse::Rejected { reason } if !reason.trim().is_empty() => {
            Ok(response)
        }
        WebsiteLoginSaveActionResponse::Rejected { .. } => {
            Err(WebsiteLoginSaveOfferResponseDecodeError)
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
            assert!(decode_website_login_save_offer_response(response).is_ok());
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
                .and_then(decode_website_login_save_offer_response);
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
            assert!(decode_website_login_save_pending_response(response).is_ok());
        }
        for serialized in [
            r#"{"kind":"completed"}"#,
            r#"{"kind":"rejected","reason":"login-save-commit-failed"}"#,
        ] {
            let response = serde_json::from_str::<WebsiteLoginSaveActionResponse>(serialized)?;
            assert!(decode_website_login_save_action_response(response).is_ok());
        }
        for serialized in [
            r#"{"ok":true,"state":"unavailable","offer":{"offerId":"offer","decision":0,"vaultStoreId":"vault","vaultName":"Personal"}}"#,
            r#"{"ok":false,"reason":" "}"#,
        ] {
            let decoded = serde_json::from_str::<WebsiteLoginSavePendingResponse>(serialized)
                .map_err(|_| WebsiteLoginSaveOfferResponseDecodeError)
                .and_then(decode_website_login_save_pending_response);
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
}
