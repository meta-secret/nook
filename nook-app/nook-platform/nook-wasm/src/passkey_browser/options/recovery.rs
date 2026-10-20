//! Discoverable-passkey recovery options: the browser offers whichever Nook
//! passkey the person holds, through its picker or as autofill suggestions.

use super::{
    BrowserCredentialRequestOptions, BrowserPasskeyClient, BrowserPasskeyPrfExtension,
    PrfCredentialSelection, RelyingPartySelection,
};
use js_sys::{JsString, Reflect};
use nook_core::WebAuthnPrfInput;
use passkey_types::webauthn::{
    AttestationConveyancePreference, CredentialRequestOptions as PasskeyRequestOptions,
    PublicKeyCredentialRequestOptions, UserVerificationRequirement,
};
use wasm_bindgen::{JsCast, JsError};

/// Named values required by `BrowserPasskeyClient::recovery_options_struct`.
#[derive(Clone, Copy)]
pub(super) struct BrowserPasskeyRecoveryOptionsStruct<'a> {
    pub(super) rp_id: &'a str,
    pub(super) prf_input: &'a [u8],
}

impl BrowserPasskeyClient {
    pub(crate) fn recovery_options(
        rp_id: &str,
    ) -> Result<BrowserCredentialRequestOptions, JsError> {
        let prf_input = WebAuthnPrfInput::deterministic();
        let options =
            BrowserPasskeyClient::recovery_options_struct(BrowserPasskeyRecoveryOptionsStruct {
                rp_id,
                prf_input: prf_input.as_ref(),
            })?;
        BrowserPasskeyClient::to_browser_object(&options)
            .map(JsCast::unchecked_into)
            .map_err(|error| {
                JsError::new(&format!(
                    "Failed to build passkey recovery options: {error}"
                ))
            })
    }
}

impl BrowserPasskeyClient {
    /// Recovery options for conditional mediation: the browser offers only
    /// passkeys it holds for this origin, as suggestions on a field marked
    /// `autocomplete="webauthn"`, and shows no dialog otherwise. Chromium
    /// browsers quit on an immediate (`uiMode`) request from an extension
    /// page; this request does not.
    pub(crate) fn conditional_recovery_options(
        rp_id: &str,
    ) -> Result<BrowserCredentialRequestOptions, JsError> {
        let options = BrowserPasskeyClient::recovery_options(rp_id)?;
        Reflect::set(
            &options,
            &JsString::from("mediation"),
            &JsString::from("conditional"),
        )
        .map_err(|_| JsError::new("Failed to request passkey autofill"))?;
        Ok(options)
    }
}

impl BrowserPasskeyClient {
    pub(super) fn recovery_options_struct(
        request: BrowserPasskeyRecoveryOptionsStruct<'_>,
    ) -> Result<PasskeyRequestOptions, JsError> {
        let BrowserPasskeyRecoveryOptionsStruct { rp_id, prf_input } = request;
        Ok(PasskeyRequestOptions {
            public_key: PublicKeyCredentialRequestOptions {
                challenge: BrowserPasskeyClient::random_challenge()?.to_vec().into(),
                timeout: None,
                rp_id: match BrowserPasskeyClient::relying_party(rp_id) {
                    RelyingPartySelection::BrowserOrigin => None,
                    RelyingPartySelection::Explicit(id) => Some(id),
                },
                allow_credentials: None,
                user_verification: UserVerificationRequirement::Required,
                hints: None,
                attestation: AttestationConveyancePreference::None,
                attestation_formats: None,
                extensions: Some(BrowserPasskeyClient::prf_extension(
                    BrowserPasskeyPrfExtension {
                        prf_input,
                        credential_id: PrfCredentialSelection::Discoverable,
                    },
                )),
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::through_json;
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn recovery_options_use_discoverable_credentials_and_global_prf_input() -> Result<(), JsError> {
        let value =
            BrowserPasskeyClient::recovery_options_struct(BrowserPasskeyRecoveryOptionsStruct {
                rp_id: "localhost",
                prf_input: &[9; 32],
            })?;
        let options = through_json(&value)?;
        let public_key = options.public_key;

        assert_eq!(public_key.rp_id.as_deref(), Some("localhost"));
        assert!(public_key.allow_credentials.is_none());
        assert_eq!(
            public_key.user_verification,
            UserVerificationRequirement::Required
        );
        let extensions = public_key
            .extensions
            .as_ref()
            .ok_or_else(|| JsError::new("Recovery extensions are required"))?;
        let prf = extensions
            .prf
            .as_ref()
            .ok_or_else(|| JsError::new("Recovery PRF extension is required"))?;
        let eval = prf
            .eval
            .as_ref()
            .ok_or_else(|| JsError::new("Recovery PRF input is required"))?;
        assert_eq!(eval.first.len(), 32);
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::super::wasm_tests::{assert_uint8_array, get, get_string};
    use super::*;
    use wasm_bindgen_test::*;

    #[wasm_bindgen_test]
    fn recovery_options_serialize_webauthn_bytes_as_uint8_arrays()
    -> Result<(), wasm_bindgen::JsError> {
        let options = BrowserPasskeyClient::recovery_options("localhost")?;
        let public_key = get(&options, "publicKey")?;
        let extensions = get(&public_key, "extensions")?;
        let prf = get(&extensions, "prf")?;
        let eval = get(&prf, "eval")?;

        assert_uint8_array(&get(&public_key, "challenge")?, 32);
        assert_uint8_array(&get(&eval, "first")?, 32);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn conditional_recovery_options_ask_for_autofill_suggestions()
    -> Result<(), wasm_bindgen::JsError> {
        let options = BrowserPasskeyClient::conditional_recovery_options("localhost")?;
        let public_key = get(&options, "publicKey")?;
        let extensions = get(&public_key, "extensions")?;
        let prf = get(&extensions, "prf")?;
        let eval = get(&prf, "eval")?;

        assert_eq!(get_string(&options, "mediation")?, "conditional");
        // Autofill offers discoverable passkeys; naming credentials is not allowed.
        assert!(
            Reflect::get(&public_key, &JsString::from("allowCredentials"))
                .map_err(|_| JsError::new("failed to inspect credentials"))?
                .is_undefined()
        );
        assert_uint8_array(&get(&eval, "first")?, 32);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn picker_recovery_options_never_ask_for_an_immediate_prompt()
    -> Result<(), wasm_bindgen::JsError> {
        let options = BrowserPasskeyClient::recovery_options("localhost")?;
        for field in ["mediation", "uiMode"] {
            assert!(
                Reflect::get(&options, &JsString::from(field))
                    .map_err(|_| JsError::new("failed to inspect prompt mode"))?
                    .is_undefined()
            );
        }
        Ok(())
    }
}
