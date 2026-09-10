//! PRF evaluation admission for browser credential ceremonies.
use super::{
    BrowserBooleanProperty, BrowserBufferProperty, BrowserObjectProperty,
    BrowserPasskeyBytesFromBuffer, BrowserPasskeyClient, BrowserPasskeyGetOptionalBool,
    BrowserPasskeyGetOptionalBuffer, BrowserPasskeyGetOptionalObject, PASSKEY_PRF_UNAVAILABLE,
};
use wasm_bindgen::JsError;
use web_sys::PublicKeyCredential;
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PasskeyPrfEvaluation {
    NotEvaluated,
    Evaluated(Vec<u8>),
}
/// Named values required by BrowserPasskeyClient::prf_output.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum PasskeyPrfRequirement {
    Enabled,
    OutputOnly,
}

pub(crate) struct BrowserPasskeyPrfOutput<'a> {
    pub(crate) credential: &'a PublicKeyCredential,
    pub(crate) requirement: PasskeyPrfRequirement,
}

impl BrowserPasskeyClient {
    pub(crate) fn prf_output(
        request: BrowserPasskeyPrfOutput<'_>,
    ) -> Result<PasskeyPrfEvaluation, JsError> {
        let BrowserPasskeyPrfOutput {
            credential,
            requirement,
        } = request;
        let extension_results: js_sys::Object = credential.get_client_extension_results().into();
        let BrowserObjectProperty::Reported(prf) =
            BrowserPasskeyClient::get_optional_object(BrowserPasskeyGetOptionalObject {
                target: &extension_results,
                field: "prf",
            })?
        else {
            if requirement == PasskeyPrfRequirement::Enabled {
                return Err(BrowserPasskeyClient::prf_unavailable(
                    "This authenticator does not support the WebAuthn PRF extension required to protect device keys.",
                ));
            }
            return Ok(PasskeyPrfEvaluation::NotEvaluated);
        };
        if requirement == PasskeyPrfRequirement::Enabled
            && BrowserPasskeyClient::get_optional_bool(BrowserPasskeyGetOptionalBool {
                target: &prf,
                field: "enabled",
            })? != BrowserBooleanProperty::Enabled
        {
            return Err(BrowserPasskeyClient::prf_unavailable(
                "This authenticator does not support the WebAuthn PRF extension required to protect device keys.",
            ));
        }

        let BrowserObjectProperty::Reported(results) =
            BrowserPasskeyClient::get_optional_object(BrowserPasskeyGetOptionalObject {
                target: &prf,
                field: "results",
            })?
        else {
            return Ok(PasskeyPrfEvaluation::NotEvaluated);
        };
        let BrowserBufferProperty::Reported(first) =
            BrowserPasskeyClient::get_optional_buffer(BrowserPasskeyGetOptionalBuffer {
                target: &results,
                field: "first",
            })?
        else {
            return Ok(PasskeyPrfEvaluation::NotEvaluated);
        };
        Ok(PasskeyPrfEvaluation::Evaluated(
            BrowserPasskeyClient::bytes_from_buffer(BrowserPasskeyBytesFromBuffer {
                value: &first,
                name: "passkey PRF output",
            })?,
        ))
    }
}

impl BrowserPasskeyClient {
    pub(crate) fn require_prf_output(credential: &PublicKeyCredential) -> Result<Vec<u8>, JsError> {
        match BrowserPasskeyClient::prf_output(BrowserPasskeyPrfOutput {
            credential,
            requirement: PasskeyPrfRequirement::OutputOnly,
        })? {
            PasskeyPrfEvaluation::Evaluated(output) => Ok(output),
            PasskeyPrfEvaluation::NotEvaluated => Err(BrowserPasskeyClient::prf_unavailable(
                "The passkey did not return the required PRF output.",
            )),
        }
    }
}

impl BrowserPasskeyClient {
    pub(crate) fn prf_unavailable(message: &str) -> JsError {
        JsError::new(&format!("{PASSKEY_PRF_UNAVAILABLE}: {message}"))
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod tests {
    use super::*;
    use js_sys::{ArrayBuffer, JsString, Object, Reflect, Uint8Array};
    use wasm_bindgen::{JsCast, closure::Closure};
    use wasm_bindgen_test::*;
    #[wasm_bindgen_test]
    fn prf_projection_distinguishes_absent_disabled_empty_and_present_results()
    -> Result<(), JsError> {
        let extension_results = Object::new();
        let credential_object = Object::new();
        let callback = Closure::<dyn FnMut() -> Object>::new({
            let extension_results = extension_results.clone();
            move || extension_results.clone()
        });
        Reflect::set(
            &credential_object,
            &JsString::from("getClientExtensionResults"),
            callback.as_ref(),
        )
        .map_err(|_| JsError::new("failed to set extension result callback"))?;
        let credential: PublicKeyCredential = credential_object.unchecked_into();

        assert_eq!(
            BrowserPasskeyClient::prf_output(BrowserPasskeyPrfOutput {
                credential: &credential,
                requirement: crate::PasskeyPrfRequirement::OutputOnly
            })?,
            PasskeyPrfEvaluation::NotEvaluated
        );
        assert!(
            BrowserPasskeyClient::prf_output(BrowserPasskeyPrfOutput {
                credential: &credential,
                requirement: crate::PasskeyPrfRequirement::Enabled
            })
            .is_err()
        );

        let prf = Object::new();
        Reflect::set(&extension_results, &JsString::from("prf"), &prf)
            .map_err(|_| JsError::new("failed to set PRF object"))?;
        assert_eq!(
            BrowserPasskeyClient::prf_output(BrowserPasskeyPrfOutput {
                credential: &credential,
                requirement: crate::PasskeyPrfRequirement::OutputOnly
            })?,
            PasskeyPrfEvaluation::NotEvaluated
        );
        Reflect::set(
            &prf,
            &JsString::from("enabled"),
            &js_sys::Boolean::from(false),
        )
        .map_err(|_| JsError::new("failed to set disabled PRF"))?;
        assert!(
            BrowserPasskeyClient::prf_output(BrowserPasskeyPrfOutput {
                credential: &credential,
                requirement: crate::PasskeyPrfRequirement::Enabled
            })
            .is_err()
        );

        let results = Object::new();
        Reflect::set(
            &prf,
            &JsString::from("enabled"),
            &js_sys::Boolean::from(true),
        )
        .map_err(|_| JsError::new("failed to set enabled PRF"))?;
        Reflect::set(&prf, &JsString::from("results"), &results)
            .map_err(|_| JsError::new("failed to set PRF results"))?;
        assert_eq!(
            BrowserPasskeyClient::prf_output(BrowserPasskeyPrfOutput {
                credential: &credential,
                requirement: crate::PasskeyPrfRequirement::Enabled
            })?,
            PasskeyPrfEvaluation::NotEvaluated
        );

        let buffer = ArrayBuffer::new(2);
        Uint8Array::new(&buffer).copy_from(&[3, 5]);
        Reflect::set(&results, &JsString::from("first"), &buffer)
            .map_err(|_| JsError::new("failed to set PRF output"))?;
        assert_eq!(
            BrowserPasskeyClient::prf_output(BrowserPasskeyPrfOutput {
                credential: &credential,
                requirement: crate::PasskeyPrfRequirement::Enabled
            })?,
            PasskeyPrfEvaluation::Evaluated(vec![3, 5])
        );
        assert_eq!(
            BrowserPasskeyClient::require_prf_output(&credential)?,
            vec![3, 5]
        );
        drop(callback);
        Ok(())
    }
}
