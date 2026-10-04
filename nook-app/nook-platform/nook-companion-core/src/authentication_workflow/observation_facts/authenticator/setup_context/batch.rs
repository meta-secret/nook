//! Bounded, non-secret visible instruction projections for one browser scan.
use super::{
    AuthenticationAuthenticatorSetupCopy, AuthenticationAuthenticatorSetupEvidence,
    AuthenticationAuthenticatorSetupObservation, AuthenticationQrMediaObservation,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Structural spelling for the new batch edge only; canonical media stays in the domain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum AuthenticationQrMediaBatchWire {
    Absent,
    Present,
}

impl From<AuthenticationQrMediaBatchWire> for AuthenticationQrMediaObservation {
    fn from(value: AuthenticationQrMediaBatchWire) -> Self {
        match value {
            AuthenticationQrMediaBatchWire::Absent => Self::Absent,
            AuthenticationQrMediaBatchWire::Present => Self::Present,
        }
    }
}

impl From<AuthenticationQrMediaObservation> for AuthenticationQrMediaBatchWire {
    fn from(value: AuthenticationQrMediaObservation) -> Self {
        match value {
            AuthenticationQrMediaObservation::Absent => Self::Absent,
            AuthenticationQrMediaObservation::Present => Self::Present,
        }
    }
}

/// No QR pixels, payloads, attributes, codes, keys, or input values are admitted.
/// Each copy retains the existing 512-byte instruction boundary; at most eight
/// visible media candidates belong to one scan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(
    rename_all = "camelCase",
    try_from = "AuthenticationAuthenticatorSetupBatchWire",
    into = "AuthenticationAuthenticatorSetupBatchWire"
)]
pub struct AuthenticationAuthenticatorSetupBatch {
    #[tsify(type = "string[]")]
    visible_instruction_copies: Vec<AuthenticationAuthenticatorSetupCopy>,
    #[tsify(type = "'absent' | 'present'")]
    qr_media: AuthenticationQrMediaObservation,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthenticationAuthenticatorSetupBatchWire {
    visible_instruction_copies: Vec<AuthenticationAuthenticatorSetupCopy>,
    qr_media: AuthenticationQrMediaBatchWire,
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
            0..=Self::MAX_SETUP_MEDIA_CANDIDATES => Ok(Self {
                visible_instruction_copies: value.visible_instruction_copies,
                qr_media: value.qr_media.into(),
            }),
            _ => Err(AuthenticationAuthenticatorSetupBatchError::TooManyCandidates),
        }
    }
}

impl From<AuthenticationAuthenticatorSetupBatch> for AuthenticationAuthenticatorSetupBatchWire {
    fn from(value: AuthenticationAuthenticatorSetupBatch) -> Self {
        Self {
            visible_instruction_copies: value.visible_instruction_copies,
            qr_media: value.qr_media.into(),
        }
    }
}

impl AuthenticationAuthenticatorSetupBatch {
    const MAX_SETUP_MEDIA_CANDIDATES: usize = 8;

    #[must_use]
    pub fn classify(&self) -> AuthenticationAuthenticatorSetupObservation {
        match self.qr_media {
            AuthenticationQrMediaObservation::Absent => {
                return AuthenticationAuthenticatorSetupObservation::Absent;
            }
            AuthenticationQrMediaObservation::Present => {}
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

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct SetupScan {
        visible_instruction_copies: Vec<String>,
        qr_media: &'static str,
    }
    impl SetupScan {
        fn batch(self) -> serde_json::Result<AuthenticationAuthenticatorSetupBatch> {
            serde_json::from_value(serde_json::to_value(self)?)
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
                SetupScan {
                    visible_instruction_copies: copies,
                    qr_media: "present"
                }
                .batch()?
                .classify(),
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
                SetupScan {
                    visible_instruction_copies: copies,
                    qr_media: "present"
                }
                .batch()?
                .classify(),
                AuthenticationAuthenticatorSetupObservation::Absent
            );
        }
        assert_eq!(
            SetupScan {
                visible_instruction_copies: vec![setup.to_owned()],
                qr_media: "absent"
            }
            .batch()?
            .classify(),
            AuthenticationAuthenticatorSetupObservation::Absent
        );
        assert_eq!(
            SetupScan {
                visible_instruction_copies: vec![],
                qr_media: "absent"
            }
            .batch()?
            .classify(),
            AuthenticationAuthenticatorSetupObservation::Absent
        );
        Ok(())
    }

    #[test]
    fn setup_batch_rejects_whole_projection_outside_candidate_or_utf8_bounds() -> anyhow::Result<()>
    {
        let exact = SetupScan {
            visible_instruction_copies: vec!["é".repeat(256); 8],
            qr_media: "present",
        }
        .batch()?;
        assert_eq!(
            exact.classify(),
            AuthenticationAuthenticatorSetupObservation::Absent
        );
        assert!(
            SetupScan {
                visible_instruction_copies: vec![String::new(); 9],
                qr_media: "present"
            }
            .batch()
            .is_err()
        );
        for oversized in ["a".repeat(513), "é".repeat(257)] {
            assert!(
                SetupScan {
                    visible_instruction_copies: vec![
                        "Scan this QR code with your authenticator app".to_owned(),
                        oversized
                    ],
                    qr_media: "present"
                }
                .batch()
                .is_err()
            );
        }
        assert!(
            SetupScan {
                visible_instruction_copies: vec![],
                qr_media: "unknown"
            }
            .batch()
            .is_err()
        );
        assert!(serde_json::from_value::<AuthenticationAuthenticatorSetupBatch>(serde_json::json!({"visibleInstructionCopies":[],"qrMedia":"present","otpauthUri":"not-admitted"})).is_err());
        Ok(())
    }

    #[test]
    fn setup_batch_generated_transport_declares_only_bounded_instruction_metadata()
    -> anyhow::Result<()> {
        let batch = SetupScan {
            visible_instruction_copies: vec!["Instructions".to_owned()],
            qr_media: "present",
        }
        .batch()?;
        assert_eq!(
            serde_json::to_value(batch)?,
            serde_json::json!({"visibleInstructionCopies":["Instructions"],"qrMedia":"present"})
        );
        assert!(
            AuthenticationAuthenticatorSetupBatch::DECL
                .contains("visibleInstructionCopies: string[]")
        );
        assert!(
            AuthenticationAuthenticatorSetupBatch::DECL.contains("qrMedia: 'absent' | 'present'")
        );
        Ok(())
    }
}
