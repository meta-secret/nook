//! Sentinel draft and share evidence projection, independent of the browser.
use super::{SentinelConfiguration, SentinelPolicy};
use crate::{MultiDeviceError, SentinelParticipantCount, SentinelThreshold, VaultMetaState};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use tsify::Tsify;
impl SentinelPolicy {
    pub fn from_share_records(
        meta: &VaultMetaState,
    ) -> Result<SentinelConfiguration, MultiDeviceError> {
        if meta.sentinel_shares.is_empty() {
            return Ok(SentinelConfiguration::Disabled);
        }
        let mut shares = meta.sentinel_shares.values();
        let first = shares
            .next()
            .ok_or(MultiDeviceError::InvalidSentinelShareEncoding)?;
        let version = first.version;
        let threshold = first.threshold;
        let required = first.required_participants;
        let mut indexes = BTreeSet::new();
        indexes.insert(first.share_index);
        if !threshold.is_valid_for(required)
            || !required.is_supported_quorum()
            || !first.share_index.belongs_to(required)
            || shares.any(|share| {
                share.version != version
                    || share.threshold != threshold
                    || share.required_participants != required
                    || !share.share_index.belongs_to(required)
                    || !indexes.insert(share.share_index)
            })
        {
            return Err(MultiDeviceError::InvalidSentinelShareEncoding);
        }
        let share_count = SentinelParticipantCount::try_from(meta.sentinel_shares.len())
            .map_err(|_| MultiDeviceError::InvalidSentinelThreshold)?;
        Ok(SentinelConfiguration::Enabled(Self {
            threshold,
            required_participants: required,
            ready_participants: share_count,
        }))
    }
}

/// Browser numeric draft; finite integer admission precedes typed policy evaluation.
#[derive(Debug, Deserialize, Tsify)]
#[tsify(from_wasm_abi)]
pub struct SentinelPolicyDraft {
    pub participants: SentinelParticipantDraftValue,
    pub threshold: SentinelThresholdDraftValue,
}
#[derive(Debug, Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SentinelPolicyDraftAdmission {
    InvalidParticipants,
    InvalidThreshold,
    Accepted {
        #[tsify(type = "number")]
        participants: SentinelParticipantCount,
        #[tsify(type = "number")]
        threshold: SentinelThreshold,
    },
}
#[derive(Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub struct SentinelPolicyDraftEvaluation {
    pub admission: SentinelPolicyDraftAdmission,
    #[tsify(type = "number[]")]
    pub participant_choices: Vec<SentinelParticipantCount>,
    #[tsify(type = "number[]")]
    pub threshold_choices: Vec<SentinelThreshold>,
}
impl SentinelPolicyDraft {
    pub fn evaluate(self) -> SentinelPolicyDraftEvaluation {
        let participant_choices = SentinelParticipantCount::supported_quorums();
        let participants = SentinelParticipantCount::try_from(self.participants).ok();
        let Some(participants) = participants.filter(|count| count.is_supported_quorum()) else {
            return SentinelPolicyDraftEvaluation {
                admission: SentinelPolicyDraftAdmission::InvalidParticipants,
                participant_choices,
                threshold_choices: Vec::new(),
            };
        };
        let threshold_choices = SentinelThreshold::supported_for(participants);
        let threshold = SentinelThreshold::try_from(self.threshold).ok();
        let admission = match threshold.filter(|threshold| threshold.is_valid_for(participants)) {
            Some(threshold) => SentinelPolicyDraftAdmission::Accepted {
                participants,
                threshold,
            },
            None => SentinelPolicyDraftAdmission::InvalidThreshold,
        };
        SentinelPolicyDraftEvaluation {
            admission,
            participant_choices,
            threshold_choices,
        }
    }
}

#[derive(Debug, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct SentinelParticipantDraftValue(f64);
#[derive(Debug, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct SentinelThresholdDraftValue(f64);
impl TryFrom<SentinelParticipantDraftValue> for SentinelParticipantCount {
    type Error = MultiDeviceError;
    fn try_from(draft: SentinelParticipantDraftValue) -> Result<Self, Self::Error> {
        let raw = draft.0;
        if !raw.is_finite() || raw.fract() != 0.0 || raw < 0.0 || raw > f64::from(u8::MAX) {
            return Err(MultiDeviceError::InvalidSentinelThreshold);
        }
        Ok(Self::from(raw as u8))
    }
}
impl TryFrom<SentinelThresholdDraftValue> for SentinelThreshold {
    type Error = MultiDeviceError;
    fn try_from(draft: SentinelThresholdDraftValue) -> Result<Self, Self::Error> {
        let raw = draft.0;
        if !raw.is_finite() || raw.fract() != 0.0 || raw < 0.0 || raw > f64::from(u8::MAX) {
            return Err(MultiDeviceError::InvalidSentinelThreshold);
        }
        Ok(Self::from(raw as u8))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct SentinelDraftCase {
        participants: f64,
        threshold: f64,
    }
    impl SentinelDraftCase {
        fn evaluate(self) -> SentinelPolicyDraftEvaluation {
            SentinelPolicyDraft {
                participants: SentinelParticipantDraftValue(self.participants),
                threshold: SentinelThresholdDraftValue(self.threshold),
            }
            .evaluate()
        }
    }
    #[test]
    fn draft_admission_rejects_nonintegral_and_out_of_policy_values() {
        for participants in [f64::NAN, f64::INFINITY, -1.0, 1.0, 2.5, 17.0, 256.0] {
            let result = SentinelDraftCase {
                participants,
                threshold: 2.0,
            }
            .evaluate();
            assert!(matches!(
                result.admission,
                SentinelPolicyDraftAdmission::InvalidParticipants
            ));
            assert!(result.threshold_choices.is_empty());
        }
        for threshold in [f64::NAN, -1.0, 1.0, 2.5, 4.0, 256.0] {
            let result = SentinelDraftCase {
                participants: 3.0,
                threshold,
            }
            .evaluate();
            assert!(matches!(
                result.admission,
                SentinelPolicyDraftAdmission::InvalidThreshold
            ));
        }
        let result = SentinelDraftCase {
            participants: 3.0,
            threshold: 2.0,
        }
        .evaluate();
        assert!(matches!(
            result.admission,
            SentinelPolicyDraftAdmission::Accepted { .. }
        ));
        assert_eq!(result.threshold_choices, vec![2.into(), 3.into()]);
    }
}
