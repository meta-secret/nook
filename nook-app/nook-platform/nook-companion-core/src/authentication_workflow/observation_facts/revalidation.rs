use super::{AuthenticationPageObservationFacts, AuthenticationPageObservationFactsBatch};
use crate::{
    AuthenticationObservationBindingToken, AuthenticationWorkflowMatch,
    AuthenticationWorkflowObservationIndex,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(from_wasm_abi)]
pub struct ApprovedAuthenticationWorkflowRevalidation {
    pub approved: AuthenticationPageObservationFacts,
    pub live: AuthenticationPageObservationFactsBatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[tsify(into_wasm_abi)]
pub enum ApprovedAuthenticationWorkflowDecision {
    Rejected,
    Matched {
        #[serde(rename = "observationIndex")]
        observation_index: AuthenticationWorkflowObservationIndex,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ApprovedObservationCompatibility {
    Unchanged,
    Changed,
}

impl ApprovedAuthenticationWorkflowRevalidation {
    /// Reclassify in the original observation order. Browser scope identity remains
    /// a host check on the selected index; this result grants no execution authority.
    pub fn revalidate(mut self) -> ApprovedAuthenticationWorkflowDecision {
        use ApprovedAuthenticationWorkflowDecision::{Matched, Rejected};
        let approved_passkey = self
            .approved
            .authenticator
            .detailed_passkey_control
            .authentication_passkey_control_evidence_is_safe();
        if !approved_passkey
            && self.live.observations.iter().any(|facts| {
                facts
                    .authenticator
                    .detailed_passkey_control
                    .authentication_passkey_control_evidence_is_safe()
            })
        {
            return Rejected;
        }
        for facts in &mut self.live.observations {
            facts.authenticator.passkey_account_availability =
                self.approved.authenticator.passkey_account_availability;
            facts.authenticator.matching_passkey_account_count = if facts
                .authenticator
                .detailed_passkey_control
                .authentication_passkey_control_evidence_is_safe()
            {
                self.approved.authenticator.matching_passkey_account_count
            } else {
                0u32.into()
            };
        }
        let AuthenticationWorkflowMatch::Matched(snapshot) = self.live.classify() else {
            return Rejected;
        };
        let Some(selected) = self
            .live
            .observations
            .get(u32::from(snapshot.observation_index) as usize)
        else {
            return Rejected;
        };
        let approved = AuthenticationPageObservationFactsBatch {
            observations: vec![self.approved],
        };
        let live = AuthenticationPageObservationFactsBatch {
            observations: vec![selected.clone()],
        };
        let Ok(binding) =
            AuthenticationObservationBindingToken::bind_authentication_page_observation_facts(
                &approved,
            )
        else {
            return Rejected;
        };
        if !AuthenticationObservationBindingToken::authentication_page_observation_facts_match_binding(&binding, &live) {
            return Rejected;
        }
        let approved_facts = &approved.observations[0];
        if selected
            .ceremony
            .authentication_context
            .approved_scope_compatibility(&approved_facts.ceremony.authentication_context)
            == ApprovedObservationCompatibility::Changed
        {
            return Rejected;
        }
        if selected
            .fields
            .approved_role_compatibility(approved_facts.fields)
            == ApprovedObservationCompatibility::Changed
        {
            return Rejected;
        }
        match live
            .classify()
            .approved_semantics_compatibility(approved.classify())
        {
            ApprovedObservationCompatibility::Changed => Rejected,
            ApprovedObservationCompatibility::Unchanged => Matched {
                observation_index: snapshot.observation_index,
            },
        }
    }
}

impl AuthenticationWorkflowMatch {
    fn approved_semantics_compatibility(self, approved: Self) -> ApprovedObservationCompatibility {
        use ApprovedObservationCompatibility::{Changed, Unchanged};
        match (self, approved) {
            (Self::NoMatch, Self::NoMatch) | (Self::Rejected, Self::Rejected) => Unchanged,
            (Self::Matched(live), Self::Matched(approved))
                if live.kind == approved.kind && live.action == approved.action =>
            {
                Unchanged
            }
            _ => Changed,
        }
    }
}
