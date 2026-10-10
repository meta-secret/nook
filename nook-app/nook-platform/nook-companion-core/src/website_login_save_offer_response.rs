#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Typed service-worker response boundary for website login-save offers.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify, Deserialize)]
#[serde(try_from = "u32")]
#[tsify(type = "0 | 1")]
pub struct WebsiteLoginSaveOfferDecision(u32);

impl TryFrom<u32> for WebsiteLoginSaveOfferDecision {
    type Error = String;
    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
            decision @ (0 | 1) => Ok(Self(decision)),
            _ => Err("login-save offer decision is not supported".to_owned()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WebsiteLoginSaveOffer {
    offer_id: String,
    decision: WebsiteLoginSaveOfferDecision,
    vault_store_id: String,
    vault_name: String,
    baseline: crate::LoginSaveCaptureBaseline,
    selection: crate::LoginSaveCaptureSelection,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(
    deny_unknown_fields,
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
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
        match self.selection.validate_baseline(&self.baseline) {
            Ok(()) => {
                !self.offer_id.trim().is_empty()
                    && !self.vault_store_id.trim().is_empty()
                    && !self.vault_name.trim().is_empty()
            }
            Err(_) => false,
        }
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

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
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
        offer: Box<WebsiteLoginSaveOffer>,
    },
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct WebsiteLoginSavePendingRejected {
    ok: bool,
    reason: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(untagged)]
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

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields, tag = "kind", rename_all = "kebab-case")]
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
    use crate::LoginCapturedFieldIndex;
    use crate::LoginSaveCaptureSelection;
    use crate::LoginSaveCaptureSource;
    use crate::credential_fill::field::Index;
    use crate::{
        AuthenticationWorkflowKind, LoginAuthFieldPresence, LoginSaveCaptureBaseline,
        LoginSubmissionPageUrl,
    };
    use anyhow::Error as AnyhowError;
    struct Fixture;
    impl Fixture {
        fn offer(decision: WebsiteLoginSaveOfferDecision) -> anyhow::Result<WebsiteLoginSaveOffer> {
            Ok(WebsiteLoginSaveOffer {
                offer_id: "offer".to_owned(),
                decision,
                vault_store_id: "vault".to_owned(),
                vault_name: "Personal".to_owned(),
                selection: LoginSaveCaptureSelection::SubmittedLogin {
                    username_field_index: LoginCapturedFieldIndex::from(Index::ZERO),
                    password_field_index: LoginCapturedFieldIndex::from(Index::ONE),
                },
                baseline: LoginSaveCaptureBaseline {
                    source: LoginSaveCaptureSource::SubmittedLogin,
                    submitted_at: serde_json::from_str("1000")?,
                    submitted_url: LoginSubmissionPageUrl::try_from(
                        "https://example.test/login".to_owned(),
                    )?,
                    captured_workflow: AuthenticationWorkflowKind::Login,
                    initial_auth_fields: LoginAuthFieldPresence::Present,
                    controls: Vec::new(),
                },
            })
        }
    }
    #[test]
    fn preserves_save_decisions_and_capture_baseline_across_offer_and_pending() -> anyhow::Result<()>
    {
        for decision in [0, 1] {
            let offer = Fixture::offer(
                WebsiteLoginSaveOfferDecision::try_from(decision).map_err(AnyhowError::msg)?,
            )?;
            let response = WebsiteLoginSaveOfferResponse::OfferAvailable {
                offer: offer.clone(),
            };
            let encoded = serde_json::to_string(&response)?;
            let decoded: WebsiteLoginSaveOfferResponse = serde_json::from_str(&encoded)?;
            assert_eq!(decoded.validate()?, response);
            let pending = WebsiteLoginSavePendingResponse::Available(
                WebsiteLoginSavePendingAvailable::Available {
                    ok: true,
                    offer: Box::new(offer),
                },
            );
            let encoded = serde_json::to_string(&pending)?;
            let decoded: WebsiteLoginSavePendingResponse = serde_json::from_str(&encoded)?;
            assert_eq!(decoded.validate()?, pending);
        }
        Ok(())
    }
    #[test]
    fn rejects_blank_offer_metadata_and_missing_capture_baseline() -> anyhow::Result<()> {
        let valid =
            Fixture::offer(WebsiteLoginSaveOfferDecision::try_from(0).map_err(AnyhowError::msg)?)?;
        let mut offer = valid.clone();
        offer.offer_id.clear();
        assert!(
            WebsiteLoginSaveOfferResponse::OfferAvailable { offer }
                .validate()
                .is_err()
        );
        let mut offer = valid.clone();
        offer.vault_store_id.clear();
        assert!(
            WebsiteLoginSaveOfferResponse::OfferAvailable { offer }
                .validate()
                .is_err()
        );
        let mut offer = valid;
        offer.vault_name = " ".to_owned();
        assert!(
            WebsiteLoginSaveOfferResponse::OfferAvailable { offer }
                .validate()
                .is_err()
        );
        assert!(serde_json::from_str::<WebsiteLoginSaveOfferResponse>(r#"{"kind":"offer-available","offer":{"offerId":"offer","decision":0,"vaultStoreId":"vault","vaultName":"Personal"}}"#).is_err());
        assert!(WebsiteLoginSaveOfferDecision::try_from(2).is_err());
        Ok(())
    }
    #[test]
    fn pending_and_action_variants_remain_closed_and_consistent() -> anyhow::Result<()> {
        for response in [
            WebsiteLoginSaveOfferResponse::NotRequired {},
            WebsiteLoginSaveOfferResponse::Locked {},
            WebsiteLoginSaveOfferResponse::Unavailable {},
            WebsiteLoginSaveOfferResponse::Rejected {
                reason: "failed".to_owned(),
            },
        ] {
            let encoded = serde_json::to_string(&response)?;
            let decoded: WebsiteLoginSaveOfferResponse = serde_json::from_str(&encoded)?;
            assert_eq!(decoded.validate()?, response);
        }
        let valid = WebsiteLoginSavePendingResponse::Available(
            WebsiteLoginSavePendingAvailable::Unavailable { ok: true },
        );
        let encoded = serde_json::to_string(&valid)?;
        assert_eq!(
            serde_json::from_str::<WebsiteLoginSavePendingResponse>(&encoded)?.validate()?,
            valid
        );
        assert!(
            WebsiteLoginSavePendingResponse::Available(
                WebsiteLoginSavePendingAvailable::Unavailable { ok: false }
            )
            .validate()
            .is_err()
        );
        assert!(
            WebsiteLoginSavePendingResponse::Rejected(WebsiteLoginSavePendingRejected {
                ok: true,
                reason: "failed".to_owned()
            })
            .validate()
            .is_err()
        );
        assert!(
            WebsiteLoginSaveActionResponse::Rejected {
                reason: " ".to_owned()
            }
            .validate()
            .is_err()
        );
        assert!(
            serde_json::from_str::<WebsiteLoginSaveActionResponse>(
                r#"{"kind":"completed","reason":"contradiction"}"#
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<WebsiteLoginSaveOfferResponse>(
                r#"{"kind":"locked","offer":{}}"#
            )
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn offer_selection_rejects_conflicting_source_duplicate_and_unbounded_indices()
    -> anyhow::Result<()> {
        let valid =
            Fixture::offer(WebsiteLoginSaveOfferDecision::try_from(0).map_err(AnyhowError::msg)?)?;
        for selection in [
            LoginSaveCaptureSelection::ExplicitAuthentication,
            LoginSaveCaptureSelection::SubmittedLogin {
                username_field_index: LoginCapturedFieldIndex::from(Index::ZERO),
                password_field_index: LoginCapturedFieldIndex::from(Index::ZERO),
            },
            LoginSaveCaptureSelection::SubmittedLogin {
                username_field_index: LoginCapturedFieldIndex::from(Index::ZERO),
                password_field_index: LoginCapturedFieldIndex::from(Index::from(
                    crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
                )),
            },
        ] {
            let mut offer = valid.clone();
            offer.selection = selection;
            assert!(
                WebsiteLoginSaveOfferResponse::OfferAvailable { offer }
                    .validate()
                    .is_err()
            );
        }
        let mut wire = serde_json::to_value(valid)?;
        wire.as_object_mut()
            .ok_or_else(|| anyhow::anyhow!("offer fixture"))?
            .remove("selection");
        assert!(serde_json::from_value::<WebsiteLoginSaveOffer>(wire).is_err());
        Ok(())
    }
}
