//! Bounded, non-secret visible instruction projections for one browser scan.
use super::{
    AuthenticationAuthenticatorSetupCopy, AuthenticationAuthenticatorSetupEvidence,
    AuthenticationAuthenticatorSetupObservation, AuthenticationQrMediaObservation,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

const MAX_SETUP_MEDIA_CANDIDATES: usize = 8;

/// Media presence accompanying copies collected from those visible media candidates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum AuthenticationAuthenticatorSetupBatchMedia {
    Absent,
    Present,
}

/// No QR pixels, payloads, attributes, codes, keys, or input values are admitted.
/// Each copy retains the existing 512-byte instruction boundary; at most eight
/// visible media candidates belong to one scan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(
    rename_all = "camelCase",
    try_from = "AuthenticationAuthenticatorSetupBatchWire"
)]
#[tsify(from_wasm_abi)]
pub struct AuthenticationAuthenticatorSetupBatch {
    #[tsify(type = "string[]")]
    visible_instruction_copies: Vec<AuthenticationAuthenticatorSetupCopy>,
    qr_media: AuthenticationAuthenticatorSetupBatchMedia,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthenticationAuthenticatorSetupBatchWire {
    visible_instruction_copies: Vec<AuthenticationAuthenticatorSetupCopy>,
    qr_media: AuthenticationAuthenticatorSetupBatchMedia,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum AuthenticationAuthenticatorSetupBatchError {
    #[error("authenticator setup scan exceeds eight visible media candidates")]
    TooManyCandidates,
}

impl TryFrom<AuthenticationAuthenticatorSetupBatchWire> for AuthenticationAuthenticatorSetupBatch {
    type Error = AuthenticationAuthenticatorSetupBatchError;

    fn try_from(value: AuthenticationAuthenticatorSetupBatchWire) -> Result<Self, Self::Error> {
        match value.visible_instruction_copies.len() {
            0..=MAX_SETUP_MEDIA_CANDIDATES => Ok(Self {
                visible_instruction_copies: value.visible_instruction_copies,
                qr_media: value.qr_media,
            }),
            _ => Err(AuthenticationAuthenticatorSetupBatchError::TooManyCandidates),
        }
    }
}

impl AuthenticationAuthenticatorSetupBatch {
    #[must_use]
    pub fn classify(&self) -> AuthenticationAuthenticatorSetupObservation {
        match self.qr_media {
            AuthenticationAuthenticatorSetupBatchMedia::Absent => {
                return AuthenticationAuthenticatorSetupObservation::Absent;
            }
            AuthenticationAuthenticatorSetupBatchMedia::Present => {}
        }
        for copy in &self.visible_instruction_copies {
            let evidence = AuthenticationAuthenticatorSetupEvidence {
                visible_context_copy: copy.clone(),
                qr_media: AuthenticationQrMediaObservation::Present,
            };
            match AuthenticationAuthenticatorSetupObservation::classify_authentication_authenticator_setup_observation(&evidence) {
                AuthenticationAuthenticatorSetupObservation::Absent => {},
                AuthenticationAuthenticatorSetupObservation::Present => return AuthenticationAuthenticatorSetupObservation::Present,
            }
        }
        AuthenticationAuthenticatorSetupObservation::Absent
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    struct SetupScan;
    impl SetupScan {
        fn batch(
            copies: Vec<String>,
            media: &str,
        ) -> serde_json::Result<AuthenticationAuthenticatorSetupBatch> {
            let copies = serde_json::to_value(copies)?;
            serde_json::from_value(
                serde_json::json!({"visibleInstructionCopies":copies,"qrMedia":media}),
            )
        }
    }

    #[test]
    fn setup_batch_aggregates_existing_media_bound_instruction_decisions() -> anyhow::Result<()> {
        let setup = "Scan this QR code with your authenticator app";
        for copies in [
            vec!["Sign in", setup],
            vec![setup, "Sign in"],
            vec!["Download an authenticator app", setup],
        ] {
            let copies = copies.into_iter().map(str::to_owned).collect();
            assert_eq!(
                SetupScan::batch(copies, "present")?.classify(),
                AuthenticationAuthenticatorSetupObservation::Present
            );
        }
        for copies in [
            vec![],
            vec!["Sign in"],
            vec!["Scan this QR code with your authenticator app to sign in"],
            vec!["Scan this QR code to pay"],
            vec!["Scan this QR code to download the authenticator app"],
        ] {
            let copies = copies.into_iter().map(str::to_owned).collect();
            assert_eq!(
                SetupScan::batch(copies, "present")?.classify(),
                AuthenticationAuthenticatorSetupObservation::Absent
            );
        }
        assert_eq!(
            SetupScan::batch(vec![setup.to_owned()], "absent")?.classify(),
            AuthenticationAuthenticatorSetupObservation::Absent
        );
        assert_eq!(
            SetupScan::batch(vec![], "absent")?.classify(),
            AuthenticationAuthenticatorSetupObservation::Absent
        );
        Ok(())
    }

    #[test]
    fn setup_batch_rejects_whole_projection_outside_candidate_or_utf8_bounds() -> anyhow::Result<()>
    {
        let exact = SetupScan::batch(vec!["é".repeat(256); 8], "present")?;
        assert_eq!(
            exact.classify(),
            AuthenticationAuthenticatorSetupObservation::Absent
        );
        assert!(SetupScan::batch(vec![String::new(); 9], "present").is_err());
        for oversized in ["a".repeat(513), "é".repeat(257)] {
            assert!(
                SetupScan::batch(
                    vec![
                        "Scan this QR code with your authenticator app".to_owned(),
                        oversized
                    ],
                    "present"
                )
                .is_err()
            );
        }
        assert!(SetupScan::batch(vec![], "unknown").is_err());
        assert!(serde_json::from_value::<AuthenticationAuthenticatorSetupBatch>(serde_json::json!({"visibleInstructionCopies":[],"qrMedia":"present","otpauthUri":"not-admitted"})).is_err());
        Ok(())
    }

    #[test]
    fn setup_batch_generated_transport_declares_only_bounded_instruction_metadata()
    -> anyhow::Result<()> {
        let batch = SetupScan::batch(vec!["Instructions".to_owned()], "present")?;
        assert_eq!(
            serde_json::to_value(batch)?,
            serde_json::json!({"visibleInstructionCopies":["Instructions"],"qrMedia":"present"})
        );
        assert!(
            AuthenticationAuthenticatorSetupBatch::DECL
                .contains("visibleInstructionCopies: string[]")
        );
        assert!(
            AuthenticationAuthenticatorSetupBatch::DECL
                .contains("qrMedia: AuthenticationAuthenticatorSetupBatchMedia")
        );
        Ok(())
    }
}
