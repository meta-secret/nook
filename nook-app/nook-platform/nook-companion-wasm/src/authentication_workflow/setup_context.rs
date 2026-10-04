//! Thin generated class boundary for pre-consent, non-secret setup observations.
use nook_companion_core::{
    AuthenticationAuthenticatorSetupBatch, AuthenticationAuthenticatorSetupEvidence,
    AuthenticationAuthenticatorSetupObservation,
};
use tsify::Tsify;
use wasm_bindgen::JsError;
#[cfg(all(test, target_arch = "wasm32"))]
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;

pub use nook_companion_core::AuthenticationQrMediaObservation;

#[wasm_bindgen]
pub struct AuthenticationAuthenticatorSetupRequest {
    evidence: AuthenticationAuthenticatorSetupEvidence,
}

#[wasm_bindgen]
impl AuthenticationAuthenticatorSetupRequest {
    /// The generated wasm-bindgen constructor receives separate JS ABI scalars;
    /// the portable classifier receives the canonical typed evidence record.
    #[wasm_bindgen(constructor)]
    pub fn new(
        visible_context_copy: &str,
        qr_media: AuthenticationQrMediaObservation,
    ) -> Result<Self, JsError> {
        let visible_context_copy = visible_context_copy.to_owned().try_into().map_err(
            |error: nook_companion_core::AuthenticationAuthenticatorSetupCopyError| {
                JsError::new(&error.to_string())
            },
        )?;
        Ok(Self {
            evidence: AuthenticationAuthenticatorSetupEvidence {
                visible_context_copy,
                qr_media,
            },
        })
    }

    pub fn classify_authentication_authenticator_setup_observation(
        &self,
    ) -> Result<tsify::Ts<AuthenticationAuthenticatorSetupObservation>, wasm_bindgen::JsError> {
        let result = {
            AuthenticationAuthenticatorSetupObservation::classify_authentication_authenticator_setup_observation(&self.evidence)
        };
        Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_batch_bridge_preserves_typed_instruction_metadata() -> serde_json::Result<()> {
        for (copies, media, expected) in [
            (
                vec!["Sign in", "Scan this QR code with your authenticator app"],
                "present",
                AuthenticationAuthenticatorSetupObservation::Present,
            ),
            (
                vec!["Scan this QR code with your authenticator app"],
                "absent",
                AuthenticationAuthenticatorSetupObservation::Absent,
            ),
            (
                vec![],
                "absent",
                AuthenticationAuthenticatorSetupObservation::Absent,
            ),
        ] {
            let input = serde_json::from_value::<AuthenticationAuthenticatorSetupBatch>(
                serde_json::json!({"visibleInstructionCopies":copies,"qrMedia":media}),
            )?;
            assert_eq!(input.classify(), expected);
        }
        Ok(())
    }

    #[test]
    fn setup_bridge_preserves_portable_context_decision() -> Result<(), JsError> {
        let request = AuthenticationAuthenticatorSetupRequest::new(
            "Sign in\nWelcome to Skykoi",
            AuthenticationQrMediaObservation::Present,
        )?;
        assert_eq!(
            AuthenticationAuthenticatorSetupObservation::classify_authentication_authenticator_setup_observation(&request.evidence),
            AuthenticationAuthenticatorSetupObservation::Absent
        );
        Ok(())
    }

    #[test]
    fn setup_bridge_preserves_media_and_instruction_evidence() -> Result<(), JsError> {
        let request = AuthenticationAuthenticatorSetupRequest::new(
            "Scan this QR code with your authenticator app",
            AuthenticationQrMediaObservation::Present,
        )?;
        assert_eq!(
            AuthenticationAuthenticatorSetupObservation::classify_authentication_authenticator_setup_observation(&request.evidence),
            AuthenticationAuthenticatorSetupObservation::Present
        );
        let request = AuthenticationAuthenticatorSetupRequest::new(
            "Scan this QR code with your authenticator app",
            AuthenticationQrMediaObservation::Absent,
        )?;
        assert_eq!(
            AuthenticationAuthenticatorSetupObservation::classify_authentication_authenticator_setup_observation(&request.evidence),
            AuthenticationAuthenticatorSetupObservation::Absent
        );
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use serde::Serialize;
    use tsify::Ts;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn generated_request_rejects_oversized_utf8_copy() {
        assert!(
            AuthenticationAuthenticatorSetupRequest::new(
                &"é".repeat(257),
                AuthenticationQrMediaObservation::Present,
            )
            .is_err()
        );
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct SetupBatchFixture {
        visible_instruction_copies: Vec<String>,
        qr_media: &'static str,
    }
    #[wasm_bindgen_test]
    fn setup_batch_typed_bridge_preserves_whole_bounds_and_media_evidence() -> Result<(), JsError> {
        let instruction = "Scan this QR code with your authenticator app";
        let bounded = format!("{instruction}{}", " ".repeat(512 - instruction.len()));
        for (copies, media, expected) in [
            (
                vec![bounded.clone(); 8],
                "present",
                AuthenticationAuthenticatorSetupObservation::Present,
            ),
            (
                vec![instruction.to_owned()],
                "absent",
                AuthenticationAuthenticatorSetupObservation::Absent,
            ),
            (
                Vec::new(),
                "absent",
                AuthenticationAuthenticatorSetupObservation::Absent,
            ),
        ] {
            let fixture = SetupBatchFixture {
                visible_instruction_copies: copies,
                qr_media: media,
            };
            let value = serde_wasm_bindgen::to_value(&fixture)?;
            let result =
                classify_authentication_authenticator_setup_batch(&Ts::new_unchecked(value))?;
            assert_eq!(result.to_rust()?, expected);
        }
        for copies in [vec![bounded; 9], vec!["é".repeat(257)]] {
            let fixture = SetupBatchFixture {
                visible_instruction_copies: copies,
                qr_media: "present",
            };
            let value = serde_wasm_bindgen::to_value(&fixture)?;
            assert!(
                classify_authentication_authenticator_setup_batch(&Ts::new_unchecked(value))
                    .is_err()
            );
        }
        assert!(
            classify_authentication_authenticator_setup_batch(&Ts::new_unchecked(
                JsValue::from_str("not-an-object")
            ))
            .is_err()
        );
        Ok(())
    }
}

/// Typed remote classification for a browser scan's bounded, non-secret metadata.
#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn classify_authentication_authenticator_setup_batch(
    input: &tsify::Ts<AuthenticationAuthenticatorSetupBatch>,
) -> Result<tsify::Ts<AuthenticationAuthenticatorSetupObservation>, wasm_bindgen::JsError> {
    let input = input
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { input.classify() };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}
