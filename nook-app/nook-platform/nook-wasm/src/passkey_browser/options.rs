use super::DEFAULT_PASSKEY_LABEL;
use super::{BrowserArrayProperty, BrowserObjectProperty};
use crate::BrowserPasskeyClient;
use crate::BrowserPasskeyGetOptionalArray;
use crate::BrowserPasskeyGetOptionalObject;
use crate::BrowserPasskeyGetRequiredObject;
use coset::iana;
use getrandom::fill;
use iana::Algorithm;
use js_sys::{JsString, Reflect, Uint8Array};
use nook_core::{
    DeviceKeyProtectionSetup, PasskeyAssertionRequest, WebAuthnCredentialId, WebAuthnPrfInput,
    WebAuthnUserHandle,
};
use passkey_types::{
    Bytes,
    webauthn::{
        AttestationConveyancePreference, AuthenticationExtensionsClientInputs,
        AuthenticationExtensionsPrfInputs, AuthenticationExtensionsPrfValues,
        AuthenticatorSelectionCriteria, CredentialCreationOptions as PasskeyCreationOptions,
        CredentialRequestOptions as PasskeyRequestOptions, PublicKeyCredentialCreationOptions,
        PublicKeyCredentialDescriptor, PublicKeyCredentialParameters,
        PublicKeyCredentialRequestOptions, PublicKeyCredentialRpEntity, PublicKeyCredentialType,
        PublicKeyCredentialUserEntity, ResidentKeyRequirement, UserVerificationRequirement,
    },
};
use serde::Serialize;
use serde_wasm_bindgen::{Error, Serializer};
use std::{collections::HashMap, fmt::Write as _};
use wasm_bindgen::{JsCast, JsError};
use web_sys::{CredentialCreationOptions, CredentialRequestOptions};

const CHALLENGE_LEN: usize = 32;

/// Named values required by `BrowserPasskeyClient::creation_options`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserPasskeyCreationOptions<'a> {
    pub(crate) rp_id: &'a str,
    pub(crate) rp_name: &'a str,
    pub(crate) passkey_label: &'a str,
    pub(crate) user_handle: &'a [u8],
    pub(crate) prf_input: &'a [u8],
}

/// Named values required by `BrowserPasskeyClient::request_options`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserPasskeyRequestOptions<'a> {
    pub(crate) rp_id: &'a str,
    pub(crate) credential_id: &'a [u8],
    pub(crate) prf_input: &'a [u8],
}

/// Named values required by `BrowserPasskeyClient::set_uint8_array_field`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserPasskeySetUint8ArrayField<'a> {
    pub(crate) target: &'a js_sys::Object,
    pub(crate) field: &'a str,
}

/// Named values required by `BrowserPasskeyClient::creation_options_struct`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserPasskeyCreationOptionsStruct<'a> {
    pub(crate) rp_id: &'a str,
    pub(crate) rp_name: &'a str,
    pub(crate) passkey_label: &'a str,
    pub(crate) user_handle: &'a [u8],
    pub(crate) prf_input: &'a [u8],
}

/// Named values required by `BrowserPasskeyClient::passkey_label_with_passkey_handle`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserPasskeyPasskeyLabelWithPasskeyHandle<'a> {
    pub(crate) passkey_label: &'a str,
    pub(crate) user_handle: &'a [u8],
}

/// Named values required by `BrowserPasskeyClient::request_options_struct`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserPasskeyRequestOptionsStruct<'a> {
    pub(crate) rp_id: &'a str,
    pub(crate) credential_id: &'a [u8],
    pub(crate) prf_input: &'a [u8],
}

/// Named values required by `BrowserPasskeyClient::recovery_options_struct`.
#[derive(Clone, Copy)]
pub(crate) struct BrowserPasskeyRecoveryOptionsStruct<'a> {
    pub(crate) rp_id: &'a str,
    pub(crate) prf_input: &'a [u8],
}

pub(crate) enum PrfCredentialSelection<'a> {
    Discoverable,
    Identified(&'a [u8]),
}
enum RelyingPartySelection {
    BrowserOrigin,
    Explicit(String),
}
/// Named values required by `BrowserPasskeyClient::prf_extension`.
pub(crate) struct BrowserPasskeyPrfExtension<'a> {
    pub(crate) prf_input: &'a [u8],
    pub(crate) credential_id: PrfCredentialSelection<'a>,
}

impl BrowserPasskeyClient {
    pub(crate) fn creation_options(
        request: BrowserPasskeyCreationOptions<'_>,
    ) -> Result<CredentialCreationOptions, JsError> {
        let BrowserPasskeyCreationOptions {
            rp_id,
            rp_name,
            passkey_label,
            user_handle,
            prf_input,
        } = request;
        let user_handle = WebAuthnUserHandle::try_from(user_handle.to_vec())
            .map_err(|error| JsError::new(&error.to_string()))?;
        let prf_input = WebAuthnPrfInput::try_from(prf_input.to_vec())
            .map_err(|error| JsError::new(&error.to_string()))?;
        let setup = DeviceKeyProtectionSetup::new(user_handle, prf_input)
            .map_err(|error| JsError::new(&error.to_string()))?;
        let passkey_label = BrowserPasskeyClient::passkey_label_with_passkey_handle(
            BrowserPasskeyPasskeyLabelWithPasskeyHandle {
                passkey_label: passkey_label,
                user_handle: setup.user_handle().as_ref(),
            },
        );
        let options =
            BrowserPasskeyClient::creation_options_struct(BrowserPasskeyCreationOptionsStruct {
                rp_id: rp_id,
                rp_name: rp_name,
                passkey_label: &passkey_label,
                user_handle: setup.user_handle().as_ref(),
                prf_input: setup.prf_input().as_ref(),
            })?;
        BrowserPasskeyClient::to_browser_object(&options)
            .map(JsCast::unchecked_into)
            .map_err(|error| {
                JsError::new(&format!(
                    "Failed to build passkey creation options: {error}"
                ))
            })
    }
}

impl BrowserPasskeyClient {
    pub(crate) fn request_options(
        request: BrowserPasskeyRequestOptions<'_>,
    ) -> Result<CredentialRequestOptions, JsError> {
        let BrowserPasskeyRequestOptions {
            rp_id,
            credential_id,
            prf_input,
        } = request;
        let credential_id = WebAuthnCredentialId::try_from(credential_id.to_vec())
            .map_err(|error| JsError::new(&error.to_string()))?;
        let prf_input = WebAuthnPrfInput::try_from(prf_input.to_vec())
            .map_err(|error| JsError::new(&error.to_string()))?;
        let request = PasskeyAssertionRequest::new(credential_id, prf_input);
        let options =
            BrowserPasskeyClient::request_options_struct(BrowserPasskeyRequestOptionsStruct {
                rp_id: rp_id,
                credential_id: request.credential_id().as_ref(),
                prf_input: request.prf_input().as_ref(),
            })?;
        BrowserPasskeyClient::to_browser_object(&options)
            .map(JsCast::unchecked_into)
            .map_err(|error| {
                JsError::new(&format!("Failed to build passkey request options: {error}"))
            })
    }
}

impl BrowserPasskeyClient {
    pub(crate) fn recovery_options(rp_id: &str) -> Result<CredentialRequestOptions, JsError> {
        let prf_input = WebAuthnPrfInput::deterministic();
        let options =
            BrowserPasskeyClient::recovery_options_struct(BrowserPasskeyRecoveryOptionsStruct {
                rp_id: rp_id,
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
    fn to_browser_object<T: Serialize>(
        value: &T,
    ) -> Result<js_sys::Object, serde_wasm_bindgen::Error> {
        let value = value.serialize(&Serializer::new().serialize_maps_as_objects(true))?;
        let value: js_sys::Object = value.unchecked_into();
        BrowserPasskeyClient::normalize_webauthn_binary_fields(&value)
            .map_err(|_| Error::new("Failed to normalize passkey binary fields"))?;
        Ok(value)
    }
}

impl BrowserPasskeyClient {
    fn normalize_webauthn_binary_fields(value: &js_sys::Object) -> Result<(), JsError> {
        let public_key =
            BrowserPasskeyClient::get_required_object(BrowserPasskeyGetRequiredObject {
                target: value,
                field: "publicKey",
            })?;
        BrowserPasskeyClient::set_uint8_array_field(BrowserPasskeySetUint8ArrayField {
            target: &public_key,
            field: "challenge",
        })?;
        BrowserPasskeyClient::normalize_creation_binary_fields(&public_key)?;
        BrowserPasskeyClient::normalize_request_binary_fields(&public_key)?;
        BrowserPasskeyClient::normalize_prf_binary_fields(&public_key)
    }
}

impl BrowserPasskeyClient {
    fn normalize_creation_binary_fields(public_key: &js_sys::Object) -> Result<(), JsError> {
        if let BrowserObjectProperty::Reported(user) =
            BrowserPasskeyClient::get_optional_object(BrowserPasskeyGetOptionalObject {
                target: public_key,
                field: "user",
            })?
        {
            BrowserPasskeyClient::set_uint8_array_field(BrowserPasskeySetUint8ArrayField {
                target: &user,
                field: "id",
            })?;
        }
        Ok(())
    }
}

impl BrowserPasskeyClient {
    fn normalize_request_binary_fields(public_key: &js_sys::Object) -> Result<(), JsError> {
        let BrowserArrayProperty::Reported(allow_credentials) =
            BrowserPasskeyClient::get_optional_array(BrowserPasskeyGetOptionalArray {
                target: public_key,
                field: "allowCredentials",
            })?
        else {
            return Ok(());
        };

        for credential in allow_credentials.iter() {
            let credential: js_sys::Object = credential.unchecked_into();
            BrowserPasskeyClient::set_uint8_array_field(BrowserPasskeySetUint8ArrayField {
                target: &credential,
                field: "id",
            })?;
        }
        Ok(())
    }
}

impl BrowserPasskeyClient {
    fn normalize_prf_binary_fields(public_key: &js_sys::Object) -> Result<(), JsError> {
        let BrowserObjectProperty::Reported(extensions) =
            BrowserPasskeyClient::get_optional_object(BrowserPasskeyGetOptionalObject {
                target: public_key,
                field: "extensions",
            })?
        else {
            return Ok(());
        };
        let BrowserObjectProperty::Reported(prf) =
            BrowserPasskeyClient::get_optional_object(BrowserPasskeyGetOptionalObject {
                target: &extensions,
                field: "prf",
            })?
        else {
            return Ok(());
        };

        if let BrowserObjectProperty::Reported(values) =
            BrowserPasskeyClient::get_optional_object(BrowserPasskeyGetOptionalObject {
                target: &prf,
                field: "eval",
            })?
        {
            BrowserPasskeyClient::set_prf_value_fields(&values)?;
        }

        if let BrowserObjectProperty::Reported(eval_by_credential) =
            BrowserPasskeyClient::get_optional_object(BrowserPasskeyGetOptionalObject {
                target: &prf,
                field: "evalByCredential",
            })?
        {
            let keys = Reflect::own_keys(&eval_by_credential).map_err(|_| {
                JsError::new("Failed to inspect passkey PRF evalByCredential entries")
            })?;
            for key in keys.iter() {
                let values = Reflect::get(&eval_by_credential, &key).map_err(|_| {
                    JsError::new("Failed to read passkey PRF evalByCredential entry")
                })?;
                let values: js_sys::Object = values.unchecked_into();
                BrowserPasskeyClient::set_prf_value_fields(&values)?;
            }
        }
        Ok(())
    }
}

impl BrowserPasskeyClient {
    fn set_prf_value_fields(values: &js_sys::Object) -> Result<(), JsError> {
        BrowserPasskeyClient::set_uint8_array_field(BrowserPasskeySetUint8ArrayField {
            target: values,
            field: "first",
        })?;
        BrowserPasskeyClient::set_uint8_array_field(BrowserPasskeySetUint8ArrayField {
            target: values,
            field: "second",
        })
    }
}

impl BrowserPasskeyClient {
    fn set_uint8_array_field(request: BrowserPasskeySetUint8ArrayField<'_>) -> Result<(), JsError> {
        let BrowserPasskeySetUint8ArrayField { target, field } = request;
        let BrowserObjectProperty::Reported(bytes) =
            BrowserPasskeyClient::get_optional_object(BrowserPasskeyGetOptionalObject {
                target: target,
                field: field,
            })?
        else {
            return Ok(());
        };
        let typed_array = Uint8Array::new(&bytes);
        Reflect::set(target, &JsString::from(field), typed_array.as_ref()).map_err(|_| {
            JsError::new(&format!("Failed to normalize passkey binary field {field}"))
        })?;
        Ok(())
    }
}

impl BrowserPasskeyClient {
    fn creation_options_struct(
        request: BrowserPasskeyCreationOptionsStruct<'_>,
    ) -> Result<PasskeyCreationOptions, JsError> {
        let BrowserPasskeyCreationOptionsStruct {
            rp_id,
            rp_name,
            passkey_label,
            user_handle,
            prf_input,
        } = request;
        let passkey_label = BrowserPasskeyClient::normalized_passkey_label(passkey_label);
        Ok(PasskeyCreationOptions {
            public_key: PublicKeyCredentialCreationOptions {
                rp: PublicKeyCredentialRpEntity {
                    id: match BrowserPasskeyClient::relying_party(rp_id) {
                        RelyingPartySelection::BrowserOrigin => None,
                        RelyingPartySelection::Explicit(id) => Some(id),
                    },
                    name: rp_name.to_owned(),
                },
                user: PublicKeyCredentialUserEntity {
                    id: user_handle.to_vec().into(),
                    name: passkey_label.clone(),
                    display_name: passkey_label,
                },
                challenge: BrowserPasskeyClient::random_challenge()?.to_vec().into(),
                pub_key_cred_params: vec![
                    PublicKeyCredentialParameters {
                        ty: PublicKeyCredentialType::PublicKey,
                        alg: Algorithm::ES256,
                    },
                    PublicKeyCredentialParameters {
                        ty: PublicKeyCredentialType::PublicKey,
                        alg: Algorithm::RS256,
                    },
                ],
                timeout: None,
                exclude_credentials: None,
                authenticator_selection: Some(AuthenticatorSelectionCriteria {
                    authenticator_attachment: None,
                    resident_key: Some(ResidentKeyRequirement::Required),
                    require_resident_key: true,
                    user_verification: UserVerificationRequirement::Required,
                }),
                hints: None,
                attestation: AttestationConveyancePreference::None,
                attestation_formats: None,
                extensions: Some(BrowserPasskeyClient::prf_extension(
                    BrowserPasskeyPrfExtension {
                        prf_input: prf_input,
                        credential_id: PrfCredentialSelection::Discoverable,
                    },
                )),
            },
        })
    }
}

impl BrowserPasskeyClient {
    fn relying_party(rp_id: &str) -> RelyingPartySelection {
        let rp_id = rp_id.trim();
        if rp_id.is_empty() {
            RelyingPartySelection::BrowserOrigin
        } else {
            RelyingPartySelection::Explicit(rp_id.to_owned())
        }
    }
}

impl BrowserPasskeyClient {
    pub(crate) fn normalized_passkey_label(label: &str) -> String {
        let trimmed = label.trim();
        if trimmed.is_empty() {
            DEFAULT_PASSKEY_LABEL.to_owned()
        } else {
            trimmed.to_owned()
        }
    }
}

impl BrowserPasskeyClient {
    fn passkey_label_with_passkey_handle(
        request: BrowserPasskeyPasskeyLabelWithPasskeyHandle<'_>,
    ) -> String {
        let BrowserPasskeyPasskeyLabelWithPasskeyHandle {
            passkey_label,
            user_handle,
        } = request;
        let label = BrowserPasskeyClient::normalized_passkey_label(passkey_label);
        format!(
            "{label} - passkey {}",
            BrowserPasskeyClient::short_byte_id(user_handle)
        )
    }
}

impl BrowserPasskeyClient {
    fn short_byte_id(bytes: &[u8]) -> String {
        const PREFIX_LEN: usize = 4;
        const SUFFIX_LEN: usize = 2;

        if bytes.len() <= PREFIX_LEN + SUFFIX_LEN {
            let mut output = String::with_capacity(bytes.len() * 2);
            for byte in bytes {
                let _ = write!(&mut output, "{byte:02x}");
            }
            return output;
        }

        let mut output = String::with_capacity((PREFIX_LEN + SUFFIX_LEN) * 2 + 3);
        for byte in bytes.iter().take(PREFIX_LEN) {
            let _ = write!(&mut output, "{byte:02x}");
        }
        output.push_str("...");
        for byte in bytes.iter().skip(bytes.len() - SUFFIX_LEN) {
            let _ = write!(&mut output, "{byte:02x}");
        }
        output
    }
}

impl BrowserPasskeyClient {
    fn request_options_struct(
        request: BrowserPasskeyRequestOptionsStruct<'_>,
    ) -> Result<PasskeyRequestOptions, JsError> {
        let BrowserPasskeyRequestOptionsStruct {
            rp_id,
            credential_id,
            prf_input,
        } = request;
        let allow_credential = PublicKeyCredentialDescriptor {
            ty: PublicKeyCredentialType::PublicKey,
            id: credential_id.to_vec().into(),
            transports: None,
        };
        Ok(PasskeyRequestOptions {
            public_key: PublicKeyCredentialRequestOptions {
                challenge: BrowserPasskeyClient::random_challenge()?.to_vec().into(),
                timeout: None,
                rp_id: match BrowserPasskeyClient::relying_party(rp_id) {
                    RelyingPartySelection::BrowserOrigin => None,
                    RelyingPartySelection::Explicit(id) => Some(id),
                },
                allow_credentials: Some(vec![allow_credential]),
                user_verification: UserVerificationRequirement::Required,
                hints: None,
                attestation: AttestationConveyancePreference::None,
                attestation_formats: None,
                extensions: Some(BrowserPasskeyClient::prf_extension(
                    BrowserPasskeyPrfExtension {
                        prf_input: prf_input,
                        credential_id: PrfCredentialSelection::Identified(credential_id),
                    },
                )),
            },
        })
    }
}

impl BrowserPasskeyClient {
    fn recovery_options_struct(
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
                        prf_input: prf_input,
                        credential_id: PrfCredentialSelection::Discoverable,
                    },
                )),
            },
        })
    }
}

impl BrowserPasskeyClient {
    fn prf_extension(
        request: BrowserPasskeyPrfExtension<'_>,
    ) -> AuthenticationExtensionsClientInputs {
        let BrowserPasskeyPrfExtension {
            prf_input,
            credential_id,
        } = request;
        let values = AuthenticationExtensionsPrfValues {
            first: prf_input.to_vec().into(),
            second: None,
        };
        let prf = match credential_id {
            PrfCredentialSelection::Identified(id) => AuthenticationExtensionsPrfInputs {
                eval: None,
                eval_by_credential: Some(HashMap::from([(
                    BrowserPasskeyClient::base64_url(id),
                    values,
                )])),
            },
            PrfCredentialSelection::Discoverable => AuthenticationExtensionsPrfInputs {
                eval: Some(values),
                eval_by_credential: None,
            },
        };
        AuthenticationExtensionsClientInputs {
            cred_props: None,
            prf: Some(prf),
            prf_already_hashed: None,
        }
    }
}

impl BrowserPasskeyClient {
    fn random_challenge() -> Result<[u8; CHALLENGE_LEN], JsError> {
        let mut challenge = [0u8; CHALLENGE_LEN];
        fill(&mut challenge).map_err(|error| {
            JsError::new(&format!("Failed to generate passkey challenge: {error}"))
        })?;
        Ok(challenge)
    }
}

impl BrowserPasskeyClient {
    fn base64_url(bytes: &[u8]) -> String {
        String::from(Bytes::from(bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::de::DeserializeOwned;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn blank_passkey_labels_use_the_persisted_default_name() {
        assert_eq!(
            BrowserPasskeyClient::normalized_passkey_label("  "),
            DEFAULT_PASSKEY_LABEL
        );
        assert_eq!(
            BrowserPasskeyClient::normalized_passkey_label("  Personal Mac  "),
            "Personal Mac"
        );
    }

    fn through_json<T>(value: &T) -> Result<T, JsError>
    where
        T: serde::Serialize + DeserializeOwned,
    {
        let json = serde_json::to_vec(value).map_err(|error| {
            JsError::new(&format!("Passkey fixture serialization failed: {error}"))
        })?;
        serde_json::from_slice(&json).map_err(|error| {
            JsError::new(&format!(
                "Passkey fixture typed deserialization failed: {error}"
            ))
        })
    }

    #[wasm_bindgen_test]
    fn creation_options_use_passkey_prf_types() -> Result<(), JsError> {
        let value =
            BrowserPasskeyClient::creation_options_struct(BrowserPasskeyCreationOptionsStruct {
                rp_id: "localhost",
                rp_name: "Nook",
                passkey_label: "Kitchen laptop",
                user_handle: &[8; 32],
                prf_input: &[9; 32],
            })?;
        let options = through_json(&value)?;
        let public_key = options.public_key;

        assert_eq!(public_key.rp.id.as_deref(), Some("localhost"));
        assert_eq!(public_key.rp.name, "Nook");
        assert_eq!(public_key.user.name, "Kitchen laptop");
        assert_eq!(public_key.user.display_name, "Kitchen laptop");
        let algorithms = public_key
            .pub_key_cred_params
            .iter()
            .map(|parameter| parameter.alg)
            .collect::<Vec<_>>();
        assert!(algorithms.contains(&Algorithm::ES256));
        assert!(algorithms.contains(&Algorithm::RS256));
        let authenticator_selection = public_key
            .authenticator_selection
            .as_ref()
            .ok_or_else(|| JsError::new("Passkey authenticator selection is required"))?;
        assert_eq!(
            authenticator_selection.resident_key,
            Some(ResidentKeyRequirement::Required)
        );
        assert!(authenticator_selection.require_resident_key);
        assert_eq!(
            authenticator_selection.user_verification,
            UserVerificationRequirement::Required
        );
        assert_eq!(
            public_key.attestation,
            AttestationConveyancePreference::None
        );
        let extensions = public_key
            .extensions
            .as_ref()
            .ok_or_else(|| JsError::new("Passkey extensions are required"))?;
        let prf = extensions
            .prf
            .as_ref()
            .ok_or_else(|| JsError::new("Passkey PRF extension is required"))?;
        let eval = prf
            .eval
            .as_ref()
            .ok_or_else(|| JsError::new("Passkey PRF input is required"))?;
        assert_eq!(eval.first.len(), 32);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn blank_rp_id_uses_browser_origin_default() -> Result<(), JsError> {
        let creation =
            BrowserPasskeyClient::creation_options_struct(BrowserPasskeyCreationOptionsStruct {
                rp_id: "",
                rp_name: "Nook",
                passkey_label: "Browser extension",
                user_handle: &[8; 32],
                prf_input: &[9; 32],
            })?;
        let creation = through_json(&creation)?;
        assert!(matches!(&creation.public_key.rp.id, None));

        let request =
            BrowserPasskeyClient::request_options_struct(BrowserPasskeyRequestOptionsStruct {
                rp_id: "",
                credential_id: &[7; 32],
                prf_input: &[9; 32],
            })?;
        let request = through_json(&request)?;
        assert!(matches!(&request.public_key.rp_id, None));

        let recovery =
            BrowserPasskeyClient::recovery_options_struct(BrowserPasskeyRecoveryOptionsStruct {
                rp_id: "",
                prf_input: &[9; 32],
            })?;
        let recovery = through_json(&recovery)?;
        assert!(matches!(&recovery.public_key.rp_id, None));
        Ok(())
    }

    #[wasm_bindgen_test]
    fn request_options_key_prf_input_by_credential_id() -> Result<(), JsError> {
        let credential_id = [7u8; 32];
        let value =
            BrowserPasskeyClient::request_options_struct(BrowserPasskeyRequestOptionsStruct {
                rp_id: "localhost",
                credential_id: &credential_id,
                prf_input: &[9; 32],
            })?;
        let options = through_json(&value)?;
        let public_key = options.public_key;
        let key = BrowserPasskeyClient::base64_url(&credential_id);

        assert_eq!(public_key.rp_id.as_deref(), Some("localhost"));
        let allowed_credentials = public_key
            .allow_credentials
            .as_ref()
            .ok_or_else(|| JsError::new("Allowed passkey credential is required"))?;
        let allowed_credential = allowed_credentials
            .first()
            .ok_or_else(|| JsError::new("Allowed passkey credential list must not be empty"))?;
        assert_eq!(allowed_credential.id.len(), 32);
        let extensions = public_key
            .extensions
            .as_ref()
            .ok_or_else(|| JsError::new("Passkey extensions are required"))?;
        let prf = extensions
            .prf
            .as_ref()
            .ok_or_else(|| JsError::new("Passkey PRF extension is required"))?;
        let eval_by_credential = prf
            .eval_by_credential
            .as_ref()
            .ok_or_else(|| JsError::new("Credential-specific PRF inputs are required"))?;
        let credential_prf = eval_by_credential
            .get(&key)
            .ok_or_else(|| JsError::new("Allowed credential PRF input is required"))?;
        assert_eq!(credential_prf.first.len(), 32);
        Ok(())
    }

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
        assert!(matches!(&public_key.allow_credentials, None));
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
    use super::*;
    use js_sys::ArrayBuffer;
    use wasm_bindgen_test::*;

    fn get(target: &js_sys::Object, field: &str) -> Result<js_sys::Object, wasm_bindgen::JsError> {
        Ok(Reflect::get(target, &JsString::from(field))
            .map_err(|_| JsError::new("failed to read reflected field"))?
            .unchecked_into())
    }

    fn get_string(target: &js_sys::Object, field: &str) -> Result<String, wasm_bindgen::JsError> {
        Reflect::get(target, &JsString::from(field))
            .map_err(|_| JsError::new("failed to read reflected string field"))?
            .as_string()
            .ok_or_else(|| JsError::new("field is not a string"))
    }

    fn assert_uint8_array(value: &js_sys::Object, expected_len: u32) {
        let bytes = Uint8Array::new(value);
        assert_eq!(bytes.length(), expected_len);
        assert!(ArrayBuffer::is_view(value));
    }

    #[wasm_bindgen_test]
    fn creation_options_serialize_webauthn_bytes_as_uint8_arrays()
    -> Result<(), wasm_bindgen::JsError> {
        let options = BrowserPasskeyClient::creation_options(BrowserPasskeyCreationOptions {
            rp_id: "localhost",
            rp_name: "Nook",
            passkey_label: "Nook device",
            user_handle: &[8; 32],
            prf_input: &[9; 32],
        })?;
        let public_key = get(&options, "publicKey")?;
        let user = get(&public_key, "user")?;
        let extensions = get(&public_key, "extensions")?;
        let prf = get(&extensions, "prf")?;
        let eval = get(&prf, "eval")?;

        assert_eq!(
            get_string(&user, "displayName")?,
            "Nook device - passkey 08080808...0808",
        );
        assert_uint8_array(&get(&public_key, "challenge")?, 32);
        assert_uint8_array(&get(&user, "id")?, 32);
        assert_uint8_array(&get(&eval, "first")?, 32);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn request_options_serialize_webauthn_bytes_as_uint8_arrays()
    -> Result<(), wasm_bindgen::JsError> {
        let credential_id = [7u8; 32];
        let options = BrowserPasskeyClient::request_options(BrowserPasskeyRequestOptions {
            rp_id: "localhost",
            credential_id: &credential_id,
            prf_input: &[9; 32],
        })?;
        let public_key = get(&options, "publicKey")?;
        let credentials: js_sys::Array = get(&public_key, "allowCredentials")?.unchecked_into();
        let first_credential: js_sys::Object = credentials.get(0).unchecked_into();
        let extensions = get(&public_key, "extensions")?;
        let prf = get(&extensions, "prf")?;
        let eval_by_credential = get(&prf, "evalByCredential")?;
        let keyed_eval = get(
            &eval_by_credential,
            &BrowserPasskeyClient::base64_url(&credential_id),
        )?;

        assert_uint8_array(&get(&public_key, "challenge")?, 32);
        assert_uint8_array(&get(&first_credential, "id")?, 32);
        assert_uint8_array(&get(&keyed_eval, "first")?, 32);
        Ok(())
    }

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
    fn normalization_keeps_optional_binary_sections_optional() -> Result<(), wasm_bindgen::JsError>
    {
        let value = js_sys::Object::new();
        let public_key = js_sys::Object::new();
        Reflect::set(&value, &JsString::from("publicKey"), public_key.as_ref())
            .map_err(|_| JsError::new("failed to build optional-section fixture"))?;
        BrowserPasskeyClient::normalize_webauthn_binary_fields(&value)?;
        assert!(
            Reflect::get(&public_key, &JsString::from("challenge"))
                .map_err(|_| JsError::new("failed to inspect challenge"))?
                .is_undefined()
        );
        assert!(
            Reflect::get(&public_key, &JsString::from("user"))
                .map_err(|_| JsError::new("failed to inspect user"))?
                .is_undefined()
        );
        assert!(
            Reflect::get(&public_key, &JsString::from("allowCredentials"))
                .map_err(|_| JsError::new("failed to inspect credentials"))?
                .is_undefined()
        );
        assert!(
            Reflect::get(&public_key, &JsString::from("extensions"))
                .map_err(|_| JsError::new("failed to inspect extensions"))?
                .is_undefined()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn short_passkey_handles_use_full_hex_and_long_handles_are_compacted() {
        assert_eq!(
            BrowserPasskeyClient::short_byte_id(&[0, 1, 2, 255]),
            "000102ff"
        );
        assert_eq!(
            BrowserPasskeyClient::short_byte_id(&[0, 1, 2, 3, 4, 5]),
            "000102030405"
        );
        assert_eq!(
            BrowserPasskeyClient::short_byte_id(&[0, 1, 2, 3, 4, 5, 6]),
            "00010203...0506"
        );
    }

    #[wasm_bindgen_test]
    fn normalization_handles_multiple_credential_specific_prf_entries()
    -> Result<(), wasm_bindgen::JsError> {
        let options =
            BrowserPasskeyClient::request_options_struct(BrowserPasskeyRequestOptionsStruct {
                rp_id: "localhost",
                credential_id: &[7; 32],
                prf_input: &[9; 32],
            })?;
        let value = options
            .serialize(&Serializer::new().serialize_maps_as_objects(true))
            .map_err(|error| JsError::new(&error.to_string()))?;
        let value: js_sys::Object = value.unchecked_into();
        let public_key = get(&value, "publicKey")?;
        let extensions = get(&public_key, "extensions")?;
        let prf = get(&extensions, "prf")?;
        let eval_by_credential = get(&prf, "evalByCredential")?;
        let keys = Reflect::own_keys(&eval_by_credential)
            .map_err(|_| JsError::new("failed to inspect serialized PRF entries"))?;
        let source_key = keys.get(0);
        if source_key.is_undefined() {
            return Err(JsError::new("serialized PRF entry is missing"));
        }
        let source = Reflect::get(&eval_by_credential, &source_key)
            .map_err(|_| JsError::new("failed to read serialized PRF entry"))?;
        Reflect::set(
            &eval_by_credential,
            &JsString::from("credential-second"),
            &source,
        )
        .map_err(|_| JsError::new("failed to add serialized PRF entry"))?;

        BrowserPasskeyClient::normalize_webauthn_binary_fields(&value)?;
        let first_entry: js_sys::Object = Reflect::get(&eval_by_credential, &source_key)
            .map_err(|_| JsError::new("failed to read first credential PRF"))?
            .unchecked_into();
        let second_entry: js_sys::Object =
            Reflect::get(&eval_by_credential, &JsString::from("credential-second"))
                .map_err(|_| JsError::new("failed to read second credential PRF"))?
                .unchecked_into();
        assert_uint8_array(&get(&first_entry, "first")?, 32);
        assert_uint8_array(&get(&second_entry, "first")?, 32);
        Ok(())
    }
}
