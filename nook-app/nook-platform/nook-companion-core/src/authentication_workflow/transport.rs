//! Canonical browser transport admission and non-secret recovery copy projection.
use super::{AuthenticationBackupCodesObservation, AuthenticationPageObservationFacts};
use crate::{AuthenticationBackupCodesEvidence, BackupCodeCandidatePresence, BackupCodePageText};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum AuthenticationWorkflowTransportType {
    #[serde(rename = "nook:authentication-workflow-snapshot")]
    Snapshot,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationWorkflowSnapshotTransport {
    #[serde(rename = "type")]
    pub message_type: AuthenticationWorkflowTransportType,
    pub payload: AuthenticationWorkflowTransportPayload,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub struct AuthenticationWorkflowTransportPayload {
    pub origin: String,
    pub observations: Vec<AuthenticationPageObservationFacts>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationWorkflowTransportAdmission {
    Rejected,
    Accepted {
        message: AuthenticationWorkflowSnapshotTransport,
    },
}
impl AuthenticationWorkflowSnapshotTransport {
    #[must_use]
    pub fn admit(self) -> AuthenticationWorkflowTransportAdmission {
        // Transport batches precede candidate classification (whose independent cap is 20).
        if self.payload.observations.is_empty()
            || self.payload.observations.len() > 64
            || self
                .payload
                .observations
                .iter()
                .any(|facts| !facts.is_bounded())
        {
            AuthenticationWorkflowTransportAdmission::Rejected
        } else {
            AuthenticationWorkflowTransportAdmission::Accepted { message: self }
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationRecoveryCopyRequest {
    pub texts: Vec<String>,
}
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationRecoveryCopyEvidence {
    pub copy: String,
    pub hint: AuthenticationBackupCodesObservation,
}
impl AuthenticationRecoveryCopyRequest {
    #[must_use]
    pub fn project(self) -> AuthenticationRecoveryCopyEvidence {
        let candidate_presence = if self
            .texts
            .iter()
            .any(|text| BackupCodePageText::new(text).contains_backup_code_candidate())
        {
            BackupCodeCandidatePresence::Present
        } else {
            BackupCodeCandidatePresence::Absent
        };
        let safe: Vec<_> = self
            .texts
            .iter()
            .filter(|text| !BackupCodePageText::new(text).contains_backup_code_candidate())
            .collect();
        let mut selected: Vec<_> = safe.iter().copied().filter(|text| {
            AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation(
                AuthenticationBackupCodesEvidence { text, candidate_presence: BackupCodeCandidatePresence::Absent }) == AuthenticationBackupCodesObservation::Present
        }).collect();
        if candidate_presence == BackupCodeCandidatePresence::Present {
            // Match the original filter against the initial strict set, not incrementally.
            let contextual: Vec<_> = safe.iter().copied().filter(|text| !selected.contains(text) &&
                AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation(
                    AuthenticationBackupCodesEvidence { text, candidate_presence: BackupCodeCandidatePresence::Present }) == AuthenticationBackupCodesObservation::Present
            ).collect();
            selected.extend(contextual);
        }
        let hint = if selected.is_empty() {
            AuthenticationBackupCodesObservation::Absent
        } else {
            AuthenticationBackupCodesObservation::Present
        };
        let mut copy = String::new();
        for text in selected {
            let separator = if copy.is_empty() { "" } else { " " };
            let remaining = 128usize.saturating_sub(copy.chars().count() + separator.len());
            if remaining == 0 {
                break;
            }
            copy.push_str(separator);
            copy.extend(text.chars().take(remaining));
        }
        AuthenticationRecoveryCopyEvidence { copy, hint }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_copy_never_discloses_candidates() {
        let evidence = AuthenticationRecoveryCopyRequest {
            texts: vec!["Save your recovery codes".into(), "A1B2-C3D4-E5F6".into()],
        }
        .project();
        assert_eq!(evidence.copy, "Save your recovery codes");
        assert_eq!(evidence.hint, AuthenticationBackupCodesObservation::Present);
    }
    #[test]
    fn recovery_copy_budget_counts_unicode_scalars() {
        let text = format!("Save your recovery codes {}", "🔐".repeat(150));
        let evidence = AuthenticationRecoveryCopyRequest { texts: vec![text] }.project();
        assert!(evidence.copy.chars().count() <= 128);
        assert!(!evidence.copy.contains("A1B2-C3D4-E5F6"));
    }
    #[test]
    fn transport_cap_is_independent_from_classifier_cap() {
        let message = AuthenticationWorkflowSnapshotTransport {
            message_type: AuthenticationWorkflowTransportType::Snapshot,
            payload: AuthenticationWorkflowTransportPayload {
                origin: "https://example.test".into(),
                observations: vec![AuthenticationPageObservationFacts::default(); 65],
            },
        };
        assert!(matches!(
            message.admit(),
            AuthenticationWorkflowTransportAdmission::Rejected
        ));
    }
}
