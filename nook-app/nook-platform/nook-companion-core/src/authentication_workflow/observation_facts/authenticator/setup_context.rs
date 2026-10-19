//! Pre-consent setup recognition uses instructional copy, never QR payloads or keys.
use super::AuthenticationAuthenticatorSetupObservation;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;

/// Visible media is a capture candidate, not proof of authenticator enrollment.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuthenticationQrMediaObservation {
    Absent,
    Present,
}

/// Visible headings and instructions only. Never supply input values, otpauth
/// attributes, setup keys, recovery codes, or the whole document's text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String")]
pub struct AuthenticationAuthenticatorSetupCopy(String);

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum AuthenticationAuthenticatorSetupCopyError {
    #[error("authenticator setup instructions exceed the observation limit")]
    TooLong,
}

impl TryFrom<String> for AuthenticationAuthenticatorSetupCopy {
    type Error = AuthenticationAuthenticatorSetupCopyError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.len() {
            0..=crate::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES => Ok(Self(value)),
            _ => Err(AuthenticationAuthenticatorSetupCopyError::TooLong),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationAuthenticatorSetupEvidence {
    pub visible_context_copy: AuthenticationAuthenticatorSetupCopy,
    pub qr_media: AuthenticationQrMediaObservation,
}

impl AuthenticationAuthenticatorSetupObservation {
    #[must_use]
    pub fn classify_authentication_authenticator_setup_observation(
        evidence: &AuthenticationAuthenticatorSetupEvidence,
    ) -> Self {
        evidence
            .visible_context_copy
            .classify_setup_instructions(evidence.qr_media)
    }
}

enum SetupQrPurpose {
    Excluded,
    NotExcluded,
}
enum AuthenticatorReference {
    Mentioned,
    NotMentioned,
}
/// Scan-QR copy needs visible media; setup-key copy also admits a manual-key-only view.
enum EnrollmentInstruction {
    ScanQr,
    EnterSetupKey,
    Unrecognized,
}

impl AuthenticationAuthenticatorSetupCopy {
    fn classify_setup_instructions(
        &self,
        qr_media: AuthenticationQrMediaObservation,
    ) -> AuthenticationAuthenticatorSetupObservation {
        let Self(value) = self;
        let normalized = Self(value.to_ascii_lowercase());
        normalized.classify_normalized_setup_instructions(qr_media)
    }

    fn classify_normalized_setup_instructions(
        &self,
        qr_media: AuthenticationQrMediaObservation,
    ) -> AuthenticationAuthenticatorSetupObservation {
        let Self(value) = self;
        let text = crate::AuthenticationControlText::new(value);
        match Self::recognize_excluded_purpose(&text) {
            SetupQrPurpose::Excluded => return AuthenticationAuthenticatorSetupObservation::Absent,
            SetupQrPurpose::NotExcluded => {}
        }
        match Self::recognize_authenticator_reference(&text) {
            AuthenticatorReference::NotMentioned => {
                return AuthenticationAuthenticatorSetupObservation::Absent;
            }
            AuthenticatorReference::Mentioned => {}
        }
        match Self::recognize_enrollment_instruction(&text) {
            EnrollmentInstruction::EnterSetupKey => {
                AuthenticationAuthenticatorSetupObservation::Present
            }
            EnrollmentInstruction::ScanQr => match qr_media {
                AuthenticationQrMediaObservation::Present => {
                    AuthenticationAuthenticatorSetupObservation::Present
                }
                AuthenticationQrMediaObservation::Absent => {
                    AuthenticationAuthenticatorSetupObservation::Absent
                }
            },
            EnrollmentInstruction::Unrecognized => {
                AuthenticationAuthenticatorSetupObservation::Absent
            }
        }
    }
    #[allow(
        clippy::match_bool,
        reason = "Convert the mechanical predicate directly into named recognition outcomes before choosing behavior"
    )]
    fn recognize_excluded_purpose(text: &crate::AuthenticationControlText<'_>) -> SetupQrPurpose {
        match text.contains_any_word(&[
            "sign in",
            "sign-in",
            "signin",
            "log in",
            "log-in",
            "login",
            "pay",
            "payment",
            "learn more",
            "scan to download",
            "scan the qr code to download",
            "scan this qr code to download",
            "scan qr code to download",
            "scan qr to download",
        ]) {
            true => SetupQrPurpose::Excluded,
            false => SetupQrPurpose::NotExcluded,
        }
    }
    #[allow(
        clippy::match_bool,
        reason = "Convert the mechanical predicate directly into named recognition outcomes before choosing behavior"
    )]
    fn recognize_authenticator_reference(
        text: &crate::AuthenticationControlText<'_>,
    ) -> AuthenticatorReference {
        match text.contains_any_word(&["authenticator", "authentication app", "totp app"]) {
            true => AuthenticatorReference::Mentioned,
            false => AuthenticatorReference::NotMentioned,
        }
    }
    #[allow(
        clippy::match_bool,
        reason = "Convert the mechanical predicate directly into named recognition outcomes before choosing behavior"
    )]
    fn recognize_enrollment_instruction(
        text: &crate::AuthenticationControlText<'_>,
    ) -> EnrollmentInstruction {
        match text.contains_word_phrase("enter")
            && text.contains_any_word(&["setup key", "secret key", "manual key"])
        {
            true => EnrollmentInstruction::EnterSetupKey,
            false => match text.contains_word_phrase("scan")
                && text.contains_word_phrase("qr")
                && text.contains_any_word(&["with", "using", "in", "connect", "set up", "setup"])
            {
                true => EnrollmentInstruction::ScanQr,
                false => EnrollmentInstruction::Unrecognized,
            },
        }
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    struct SetupPage {
        copy: &'static str,
        media: AuthenticationQrMediaObservation,
    }

    impl SetupPage {
        fn classify(
            self,
        ) -> Result<
            AuthenticationAuthenticatorSetupObservation,
            AuthenticationAuthenticatorSetupCopyError,
        > {
            Ok(AuthenticationAuthenticatorSetupObservation::classify_authentication_authenticator_setup_observation(
                &AuthenticationAuthenticatorSetupEvidence {
                    visible_context_copy: self.copy.to_owned().try_into()?,
                    qr_media: self.media,
                },
            ))
        }
    }

    #[test]
    fn square_landing_artwork_is_not_authenticator_setup()
    -> Result<(), AuthenticationAuthenticatorSetupCopyError> {
        let page = SetupPage {
            copy: "Skykoi\nSign in\nDiscover your next adventure",
            media: AuthenticationQrMediaObservation::Present,
        };
        assert_eq!(
            page.classify()?,
            AuthenticationAuthenticatorSetupObservation::Absent
        );
        Ok(())
    }

    #[test]
    fn unrelated_qr_and_security_marketing_are_not_setup()
    -> Result<(), AuthenticationAuthenticatorSetupCopyError> {
        for copy in [
            "Scan the QR code to download our app",
            "Scan this QR code to download the authenticator app",
            "Download the authenticator app\nScan QR code",
            "Scan this QR code with your authenticator app to sign in",
            "Scan this QR code with your authenticator app to sign-in",
            "Scan this QR code with your authenticator app to log-in",
            "Scan your passport with an authenticator app",
            "Scan this QR code to pay",
            "Enable two-factor authentication to secure your account",
            "Secure accounts with an authenticator app. Scan to learn more",
            "Set up your authenticator app to protect every account",
            "",
        ] {
            assert_eq!(
                SetupPage {
                    copy,
                    media: AuthenticationQrMediaObservation::Present
                }
                .classify()?,
                AuthenticationAuthenticatorSetupObservation::Absent,
                "{copy}"
            );
        }
        Ok(())
    }

    #[test]
    fn visible_settings_enrollment_instructions_admit_generic_media()
    -> Result<(), AuthenticationAuthenticatorSetupCopyError> {
        for copy in [
            "Set up two-factor authentication\nScan this QR code with your authenticator app",
            "Scan the QR code using Google Authenticator",
            "Connect your authenticator app\nScan QR code",
            "SCAN THIS QR CODE WITH YOUR AUTHENTICATOR APP",
            "Download an authenticator app, then scan this QR code with it",
        ] {
            assert_eq!(
                SetupPage {
                    copy,
                    media: AuthenticationQrMediaObservation::Present
                }
                .classify()?,
                AuthenticationAuthenticatorSetupObservation::Present,
                "{copy}"
            );
            assert_eq!(
                SetupPage {
                    copy,
                    media: AuthenticationQrMediaObservation::Absent
                }
                .classify()?,
                AuthenticationAuthenticatorSetupObservation::Absent
            );
        }
        Ok(())
    }

    #[test]
    fn setup_key_instructions_admit_manual_key_only_views()
    -> Result<(), AuthenticationAuthenticatorSetupCopyError> {
        for copy in [
            "Enter this setup key in your authenticator app",
            "Can't scan? Enter the setup key manually in Google Authenticator",
            "Authenticator app\nEnter the setup key manually",
            "Open your authenticator app and enter this secret key",
        ] {
            for media in [
                AuthenticationQrMediaObservation::Absent,
                AuthenticationQrMediaObservation::Present,
            ] {
                assert_eq!(
                    SetupPage { copy, media }.classify()?,
                    AuthenticationAuthenticatorSetupObservation::Present,
                    "{copy}"
                );
            }
        }
        Ok(())
    }

    #[test]
    fn manual_key_only_views_keep_scan_marketing_and_sign_in_exclusions()
    -> Result<(), AuthenticationAuthenticatorSetupCopyError> {
        for copy in [
            "Scan this QR code with your authenticator app",
            "Protect your account with an authenticator app. Learn more",
            "Sign in with your authenticator app\nEnter the setup key",
            "Log in to enter the secret key in your authenticator app",
            "Enter the setup key to pay with your authenticator app",
            "Enter the setup key manually",
            "Get the authenticator app. Scan to download, then enter the setup key",
        ] {
            assert_eq!(
                SetupPage {
                    copy,
                    media: AuthenticationQrMediaObservation::Absent
                }
                .classify()?,
                AuthenticationAuthenticatorSetupObservation::Absent,
                "{copy}"
            );
        }
        Ok(())
    }

    /// Content scripts prefix each visible heading and paragraph with `\n`.
    pub const UPDATE_AUTHENTICATOR_DIALOG_COPY: &str = "\nUpdate authenticator app\nScan this QR code to set up your account using your preferred authenticator app. Popular choices include Google Authenticator, Microsoft Authenticator, and Authy.";

    #[test]
    fn update_authenticator_dialog_instructions_admit_inline_qr()
    -> Result<(), AuthenticationAuthenticatorSetupCopyError> {
        assert_eq!(
            SetupPage {
                copy: UPDATE_AUTHENTICATOR_DIALOG_COPY,
                media: AuthenticationQrMediaObservation::Present
            }
            .classify()?,
            AuthenticationAuthenticatorSetupObservation::Present
        );
        assert_eq!(
            SetupPage {
                copy: UPDATE_AUTHENTICATOR_DIALOG_COPY,
                media: AuthenticationQrMediaObservation::Absent
            }
            .classify()?,
            AuthenticationAuthenticatorSetupObservation::Absent
        );
        Ok(())
    }

    #[test]
    fn dialog_sign_in_download_and_payment_qr_copy_is_not_setup()
    -> Result<(), AuthenticationAuthenticatorSetupCopyError> {
        for copy in [
            "\nSign in with your authenticator app\nScan this QR code using your preferred authenticator app",
            "\nGet the authenticator app\nScan this QR code to download the authenticator app",
            "\nPay with your authenticator app\nScan this QR code using your authenticator app to pay",
        ] {
            assert_eq!(
                SetupPage {
                    copy,
                    media: AuthenticationQrMediaObservation::Present
                }
                .classify()?,
                AuthenticationAuthenticatorSetupObservation::Absent,
                "{copy}"
            );
        }
        Ok(())
    }

    #[test]
    fn setup_copy_preserves_empty_prose_and_rejects_oversized_observations() -> anyhow::Result<()> {
        let empty = AuthenticationAuthenticatorSetupCopy::try_from(String::new())?;
        assert_eq!(serde_json::to_string(&empty)?, "\"\"");
        assert_eq!(
            AuthenticationAuthenticatorSetupCopy::try_from(
                "x".repeat(crate::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES + 1)
            ),
            Err(AuthenticationAuthenticatorSetupCopyError::TooLong)
        );
        assert_eq!(
            AuthenticationAuthenticatorSetupCopy::try_from("é".repeat(257)),
            Err(AuthenticationAuthenticatorSetupCopyError::TooLong)
        );
        let encoded = serde_json::to_string(&"é".repeat(257))?;
        assert!(serde_json::from_str::<AuthenticationAuthenticatorSetupCopy>(&encoded).is_err());
        Ok(())
    }

    #[test]
    fn setup_evidence_round_trips_with_canonical_names() -> anyhow::Result<()> {
        let evidence = AuthenticationAuthenticatorSetupEvidence {
            visible_context_copy: "Scan this QR code with your authenticator app"
                .to_owned()
                .try_into()?,
            qr_media: AuthenticationQrMediaObservation::Present,
        };
        let encoded = serde_json::to_string(&evidence)?;
        let decoded: AuthenticationAuthenticatorSetupEvidence = serde_json::from_str(&encoded)?;
        assert_eq!(decoded, evidence);
        assert!(serde_json::from_str::<AuthenticationQrMediaObservation>("\"Unknown\"").is_err());
        Ok(())
    }
}

mod batch;
pub use batch::{
    AuthenticationAuthenticatorSetupBatch, AuthenticationAuthenticatorSetupBatchError,
};
