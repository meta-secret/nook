//! Thin generated class boundary for pre-consent, non-secret setup observations.
use nook_companion_core::{
    AuthenticationAuthenticatorSetupBatch, AuthenticationAuthenticatorSetupEvidence,
    AuthenticationAuthenticatorSetupObservation,
};
use wasm_bindgen::JsError;
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

    #[must_use]
    pub fn classify_authentication_authenticator_setup_observation(
        &self,
    ) -> Result<tsify::Ts<AuthenticationAuthenticatorSetupObservation>, wasm_bindgen::JsError> {
        let result = {
            AuthenticationAuthenticatorSetupObservation::classify_authentication_authenticator_setup_observation(&self.evidence)
        };
        tsify::Tsify::into_ts(&result)
            .map_err(|_| wasm_bindgen::JsError::new("Typed WASM output could not be encoded."))
    }
}

#[cfg(test)]
pub mod tests {
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
            assert_eq!(
                classify_authentication_authenticator_setup_batch(input),
                expected
            );
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
            request.classify_authentication_authenticator_setup_observation(),
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
            request.classify_authentication_authenticator_setup_observation(),
            AuthenticationAuthenticatorSetupObservation::Present
        );
        let request = AuthenticationAuthenticatorSetupRequest::new(
            "Scan this QR code with your authenticator app",
            AuthenticationQrMediaObservation::Absent,
        )?;
        assert_eq!(
            request.classify_authentication_authenticator_setup_observation(),
            AuthenticationAuthenticatorSetupObservation::Absent
        );
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
pub mod wasm_tests {
    use super::*;
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
}

/// Typed remote classification for a browser scan's bounded, non-secret metadata.
#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn classify_authentication_authenticator_setup_batch(
    input: tsify::Ts<AuthenticationAuthenticatorSetupBatch>,
) -> Result<tsify::Ts<AuthenticationAuthenticatorSetupObservation>, wasm_bindgen::JsError> {
    let input = input
        .to_rust()
        .map_err(|_| wasm_bindgen::JsError::new("Typed WASM value could not be converted."))?;
    let result = { input.classify() };
    tsify::Tsify::into_ts(&result)
        .map_err(|_| wasm_bindgen::JsError::new("Typed WASM value could not be converted."))
}
