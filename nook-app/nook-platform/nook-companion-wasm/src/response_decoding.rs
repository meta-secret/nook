//! WASM exports that decode session and response wire contracts.

use nook_companion_core::{
    AuthenticationOutcomeResponse, ExtensionSessionStatusAvailability, LoginPickerOpenResponse,
};
use nook_companion_core::{
    AuthenticatorBackupAttachResponse, AuthenticatorEnrollmentConfirmResponse,
    AuthenticatorEnrollmentStageResponse, AuthenticatorOptionsResponse,
    AuthenticatorPickerOpenResponse, AuthenticatorPreviewResponse, GeneratedPasswordResponse,
    WebsiteLoginOptions, WebsitePasskeyAccountList,
};
use serde::Deserialize;
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

macro_rules! runtime_response_admission {
    ($name:ident, $wire:ty) => {
        #[derive(Deserialize, Tsify)]
        #[serde(transparent)]
        #[tsify(type = "unknown", from_wasm_abi)]
        pub struct $name($wire);
    };
}

runtime_response_admission!(
    WebsiteLoginOptionsAdmission,
    nook_companion_core::WebsiteLoginOptionsWireValue
);
runtime_response_admission!(
    WebsiteLoginSaveOfferAdmission,
    nook_companion_core::WebsiteLoginSaveOfferResponse
);
runtime_response_admission!(
    WebsiteLoginSavePendingAdmission,
    nook_companion_core::WebsiteLoginSavePendingResponse
);
runtime_response_admission!(
    WebsiteLoginSaveActionAdmission,
    nook_companion_core::WebsiteLoginSaveActionResponse
);
runtime_response_admission!(
    LoginPickerOpenAdmission,
    nook_companion_core::LoginPickerOpenResponseWire
);
runtime_response_admission!(
    AuthenticatorPickerOpenAdmission,
    nook_companion_core::AuthenticatorPickerOpenResponseWire
);
runtime_response_admission!(
    AuthenticationOutcomeAdmission,
    nook_companion_core::AuthenticationOutcomeResponseWire
);
runtime_response_admission!(
    AuthenticatorBackupAttachAdmission,
    nook_companion_core::AuthenticatorBackupAttachResponseWire
);
runtime_response_admission!(
    AuthenticatorEnrollmentStageAdmission,
    nook_companion_core::AuthenticatorEnrollmentStageResponseWire
);
runtime_response_admission!(
    AuthenticatorEnrollmentConfirmAdmission,
    nook_companion_core::AuthenticatorEnrollmentConfirmResponseWire
);
runtime_response_admission!(
    GeneratedPasswordAdmission,
    nook_companion_core::GeneratedPasswordResponseWire
);
runtime_response_admission!(
    AuthenticatorOptionsAdmission,
    nook_companion_core::AuthenticatorOptionsResponseWire
);
runtime_response_admission!(
    AuthenticatorPreviewAdmission,
    nook_companion_core::AuthenticatorPreviewResponseWire
);

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn validate_extension_session_request(
    request: nook_companion_core::ExtensionSessionRequestWire,
) -> nook_companion_core::ExtensionSessionRequestValidation {
    drop(request);
    nook_companion_core::ExtensionSessionRequestValidation::Accepted
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen owns the decoded ABI value.
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_extension_session_status_response(
    response: nook_companion_core::ExtensionSessionStatusResponseWire,
) -> nook_companion_core::ExtensionSessionStatusAvailability {
    ExtensionSessionStatusAvailability::decode_extension_session_status_response(&response)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_website_login_options(
    response: WebsiteLoginOptionsAdmission,
) -> Result<nook_companion_core::WebsiteLoginOptions, JsError> {
    let WebsiteLoginOptionsAdmission(response) = response;
    WebsiteLoginOptions::from_wire(response).map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_website_passkey_account_list(
    response: wasm_bindgen::JsValue,
) -> nook_companion_core::WebsitePasskeyAccountList {
    serde_wasm_bindgen::from_value(response).map_or_else(
        |_| WebsitePasskeyAccountList::invalid(),
        WebsitePasskeyAccountList::from_wire,
    )
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_website_login_save_offer_response(
    response: WebsiteLoginSaveOfferAdmission,
) -> Result<nook_companion_core::WebsiteLoginSaveOfferResponse, JsError> {
    let WebsiteLoginSaveOfferAdmission(response) = response;
    response
        .validate()
        .map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_website_login_save_pending_response(
    response: WebsiteLoginSavePendingAdmission,
) -> Result<nook_companion_core::WebsiteLoginSavePendingResponse, JsError> {
    let WebsiteLoginSavePendingAdmission(response) = response;
    response
        .validate()
        .map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_website_login_save_action_response(
    response: WebsiteLoginSaveActionAdmission,
) -> Result<nook_companion_core::WebsiteLoginSaveActionResponse, JsError> {
    let WebsiteLoginSaveActionAdmission(response) = response;
    response
        .validate()
        .map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_login_picker_open_response(
    response: LoginPickerOpenAdmission,
) -> Result<nook_companion_core::LoginPickerOpenResponse, wasm_bindgen::JsError> {
    let LoginPickerOpenAdmission(response) = response;
    LoginPickerOpenResponse::decode_login_picker_open_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_authenticator_picker_open_response(
    response: AuthenticatorPickerOpenAdmission,
) -> Result<nook_companion_core::AuthenticatorPickerOpenResponse, JsError> {
    let AuthenticatorPickerOpenAdmission(response) = response;
    AuthenticatorPickerOpenResponse::from_wire(response)
        .map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_authentication_outcome_response(
    response: AuthenticationOutcomeAdmission,
) -> Result<nook_companion_core::AuthenticationOutcomeResponse, wasm_bindgen::JsError> {
    let AuthenticationOutcomeAdmission(response) = response;
    AuthenticationOutcomeResponse::decode_authentication_outcome_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_authenticator_backup_attach_response(
    response: AuthenticatorBackupAttachAdmission,
) -> Result<nook_companion_core::AuthenticatorBackupAttachResponse, JsError> {
    let AuthenticatorBackupAttachAdmission(response) = response;
    AuthenticatorBackupAttachResponse::from_wire(response)
        .map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_authenticator_enrollment_stage_response(
    response: AuthenticatorEnrollmentStageAdmission,
) -> Result<nook_companion_core::AuthenticatorEnrollmentStageResponse, JsError> {
    let AuthenticatorEnrollmentStageAdmission(response) = response;
    AuthenticatorEnrollmentStageResponse::from_wire(response)
        .map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_authenticator_enrollment_confirm_response(
    response: AuthenticatorEnrollmentConfirmAdmission,
) -> Result<nook_companion_core::AuthenticatorEnrollmentConfirmResponse, JsError> {
    let AuthenticatorEnrollmentConfirmAdmission(response) = response;
    AuthenticatorEnrollmentConfirmResponse::from_wire(response)
        .map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_generated_password_response(
    response: GeneratedPasswordAdmission,
) -> Result<nook_companion_core::GeneratedPasswordResponse, JsError> {
    let GeneratedPasswordAdmission(response) = response;
    GeneratedPasswordResponse::from_wire(response).map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_authenticator_options_response(
    response: AuthenticatorOptionsAdmission,
) -> Result<nook_companion_core::AuthenticatorOptionsResponse, JsError> {
    let AuthenticatorOptionsAdmission(response) = response;
    AuthenticatorOptionsResponse::from_wire(response)
        .map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_authenticator_preview_response(
    response: AuthenticatorPreviewAdmission,
) -> Result<nook_companion_core::AuthenticatorPreviewResponse, JsError> {
    let AuthenticatorPreviewAdmission(response) = response;
    AuthenticatorPreviewResponse::from_wire(response)
        .map_err(|error| JsError::new(&error.to_string()))
}

#[cfg(test)]
mod admission_tests {
    use super::*;

    #[test]
    fn runtime_response_admissions_declare_unknown_chrome_inputs() {
        for declaration in [
            WebsiteLoginOptionsAdmission::DECL,
            WebsiteLoginSaveOfferAdmission::DECL,
            WebsiteLoginSavePendingAdmission::DECL,
            WebsiteLoginSaveActionAdmission::DECL,
            LoginPickerOpenAdmission::DECL,
            AuthenticatorPickerOpenAdmission::DECL,
            AuthenticationOutcomeAdmission::DECL,
            AuthenticatorBackupAttachAdmission::DECL,
            AuthenticatorEnrollmentStageAdmission::DECL,
            AuthenticatorEnrollmentConfirmAdmission::DECL,
            GeneratedPasswordAdmission::DECL,
            AuthenticatorOptionsAdmission::DECL,
            AuthenticatorPreviewAdmission::DECL,
        ] {
            assert!(declaration.ends_with(" = unknown;"));
        }
    }

    #[test]
    fn runtime_response_admissions_reject_non_contract_values() {
        assert!(serde_json::from_str::<WebsiteLoginOptionsAdmission>("null").is_err());
        assert!(serde_json::from_str::<WebsiteLoginSaveOfferAdmission>("null").is_err());
        assert!(serde_json::from_str::<WebsiteLoginSavePendingAdmission>("null").is_err());
        assert!(serde_json::from_str::<WebsiteLoginSaveActionAdmission>("null").is_err());
        assert!(serde_json::from_str::<LoginPickerOpenAdmission>("null").is_err());
        assert!(serde_json::from_str::<AuthenticatorPickerOpenAdmission>("null").is_err());
        assert!(serde_json::from_str::<AuthenticationOutcomeAdmission>("null").is_err());
        assert!(serde_json::from_str::<AuthenticatorBackupAttachAdmission>("null").is_err());
        assert!(serde_json::from_str::<AuthenticatorEnrollmentStageAdmission>("null").is_err());
        assert!(serde_json::from_str::<AuthenticatorEnrollmentConfirmAdmission>("null").is_err());
        assert!(serde_json::from_str::<GeneratedPasswordAdmission>("null").is_err());
        assert!(serde_json::from_str::<AuthenticatorOptionsAdmission>("null").is_err());
        assert!(serde_json::from_str::<AuthenticatorPreviewAdmission>("null").is_err());
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use serde::{Serialize, de::DeserializeOwned};
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::wasm_bindgen_test;

    use super::*;

    fn js_error(error: impl std::fmt::Display) -> JsError {
        JsError::new(&error.to_string())
    }

    fn wire<T: DeserializeOwned>(serialized: &str) -> Result<T, JsError> {
        serde_json::from_str(serialized).map_err(js_error)
    }

    fn js_value(serialized: &str) -> Result<JsValue, JsError> {
        let value: serde_json::Value = serde_json::from_str(serialized).map_err(js_error)?;
        value
            .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
            .map_err(js_error)
    }

    #[wasm_bindgen_test]
    fn session_request_and_status_decoders_preserve_typed_states() -> Result<(), JsError> {
        let request = wire(
            r#"{"type":"nook:extension-session-status","payload":{"queue":{"kind":"message-default"}}}"#,
        )?;
        assert_eq!(
            validate_extension_session_request(request),
            nook_companion_core::ExtensionSessionRequestValidation::Accepted
        );

        for (serialized, expected) in [
            (
                r#"{"ok":false,"status":6}"#,
                nook_companion_core::ExtensionSessionStatusAvailability::Unavailable,
            ),
            (
                r#"{"ok":true,"status":4}"#,
                nook_companion_core::ExtensionSessionStatusAvailability::Locked,
            ),
            (
                r#"{"ok":true,"status":6,"device":{"deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing"}}"#,
                nook_companion_core::ExtensionSessionStatusAvailability::Unlocked,
            ),
        ] {
            assert_eq!(
                decode_extension_session_status_response(wire(serialized)?),
                expected
            );
        }
        Ok(())
    }

    #[wasm_bindgen_test]
    fn website_login_and_passkey_decoders_reject_incomplete_identity() -> Result<(), JsError> {
        let options = decode_website_login_options(wire(
            r#"{"ok":true,"status":"ready","authorizationGeneration":"epoch-1","accounts":[{"vaultStoreId":"vault","vaultName":"Personal","secretId":"secret","username":"alice","websiteUrl":"https://example.test","websiteHost":"example.test"}]}"#,
        )?)?;
        assert!(matches!(
            options,
            nook_companion_core::WebsiteLoginOptions::Ready { accounts, .. }
                if accounts.len() == 1
        ));
        assert!(
            decode_website_login_options(wire(
                r#"{"ok":true,"status":"ready","authorizationGeneration":" ","accounts":[]}"#,
            )?)
            .is_err()
        );

        let accounts = decode_website_passkey_account_list(js_value(
            r#"{"ok":true,"accounts":[{"credentialId":"credential","userName":"alice@example.test","userDisplayName":"Alice"}]}"#,
        )?);
        assert!(matches!(
            accounts,
            nook_companion_core::WebsitePasskeyAccountList::Ready { accounts, .. }
                if accounts.len() == 1
        ));
        assert_eq!(
            decode_website_passkey_account_list(js_value(
                r#"{"ok":true,"accounts":[{"credentialId":" ","userName":"alice@example.test","userDisplayName":"Alice"}]}"#,
            )?),
            nook_companion_core::WebsitePasskeyAccountList::invalid()
        );
        assert_eq!(
            decode_website_passkey_account_list(JsValue::from_str("not-an-object")),
            nook_companion_core::WebsitePasskeyAccountList::invalid()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn login_save_decoders_preserve_closed_success_and_rejection_states() -> Result<(), JsError> {
        let offer = wire(
            r#"{"kind":"offer-available","offer":{"offerId":"offer","decision":0,"vaultStoreId":"vault","vaultName":"Personal"}}"#,
        )?;
        assert!(matches!(
            decode_website_login_save_offer_response(offer)?,
            nook_companion_core::WebsiteLoginSaveOfferResponse::OfferAvailable { .. }
        ));
        assert!(
            decode_website_login_save_offer_response(wire(r#"{"kind":"rejected","reason":" "}"#)?)
                .is_err()
        );

        assert!(matches!(
            decode_website_login_save_pending_response(wire(
                r#"{"ok":true,"state":"unavailable"}"#
            )?)?,
            nook_companion_core::WebsiteLoginSavePendingResponse::Available(_)
        ));
        assert!(
            decode_website_login_save_pending_response(wire(r#"{"ok":false,"reason":" "}"#)?)
                .is_err()
        );

        assert!(matches!(
            decode_website_login_save_action_response(wire(r#"{"kind":"completed"}"#)?)?,
            nook_companion_core::WebsiteLoginSaveActionResponse::Completed {}
        ));
        assert!(
            decode_website_login_save_action_response(wire(r#"{"kind":"rejected","reason":" "}"#)?)
                .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn picker_and_outcome_decoders_preserve_success_and_failure() -> Result<(), JsError> {
        assert!(matches!(
            decode_login_picker_open_response(wire(
                r#"{"ok":true,"status":"ready","requestId":"request","expiresAt":42}"#
            )?)?,
            nook_companion_core::LoginPickerOpenResponse::Ready { request_id, .. }
                if request_id == "request"
        ));
        assert!(
            decode_login_picker_open_response(wire(
                r#"{"ok":true,"status":"ready","requestId":" ","expiresAt":42}"#
            )?)
            .is_err()
        );

        assert!(matches!(
            decode_authenticator_picker_open_response(wire(
                r#"{"ok":false,"reason":"picker-failed"}"#
            )?)?,
            nook_companion_core::AuthenticatorPickerOpenResponse::Rejected { reason, .. }
                if reason == "picker-failed"
        ));
        assert!(
            decode_authenticator_picker_open_response(wire(r#"{"ok":false,"reason":" "}"#)?)
                .is_err()
        );

        assert!(matches!(
            decode_authentication_outcome_response(wire(
                r#"{"ok":true,"verdict":{"verdict":0,"allowsCredentialCommit":true}}"#
            )?)?,
            nook_companion_core::AuthenticationOutcomeResponse::Completed { .. }
        ));
        assert!(
            decode_authentication_outcome_response(wire(r#"{"ok":false,"reason":" "}"#)?).is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn authenticator_mutation_decoders_reject_incomplete_outcomes() -> Result<(), JsError> {
        assert!(matches!(
            decode_authenticator_backup_attach_response(wire(r#"{"ok":true}"#)?)?,
            nook_companion_core::AuthenticatorBackupAttachResponse::Completed { .. }
        ));
        assert!(decode_authenticator_backup_attach_response(wire(r#"{"ok":false}"#)?).is_err());

        assert!(matches!(
            decode_authenticator_enrollment_stage_response(wire(
                r#"{"ok":true,"stageId":"stage-1"}"#
            )?)?,
            nook_companion_core::AuthenticatorEnrollmentStageResponse::Staged { stage_id, .. }
                if stage_id == "stage-1"
        ));
        assert!(
            decode_authenticator_enrollment_stage_response(wire(r#"{"ok":true,"stageId":" "}"#)?)
                .is_err()
        );

        assert!(matches!(
            decode_authenticator_enrollment_confirm_response(wire(
                r#"{"ok":true,"secretId":"secret-1"}"#
            )?)?,
            nook_companion_core::AuthenticatorEnrollmentConfirmResponse::Completed {
                secret_id,
                ..
            } if secret_id == "secret-1"
        ));
        assert!(
            decode_authenticator_enrollment_confirm_response(wire(
                r#"{"ok":true,"secretId":" "}"#
            )?)
            .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn authenticator_read_decoders_preserve_available_and_invalid_states() -> Result<(), JsError> {
        assert!(matches!(
            decode_generated_password_response(wire(
                r#"{"ok":true,"password":"correct horse battery staple"}"#
            )?)?,
            nook_companion_core::GeneratedPasswordResponse::Generated { .. }
        ));
        assert!(decode_generated_password_response(wire(r#"{"ok":true,"password":""}"#)?).is_err());

        assert!(matches!(
            decode_authenticator_options_response(wire(r#"{"ok":true,"status":"unavailable"}"#)?)?,
            nook_companion_core::AuthenticatorOptionsResponse::Unavailable { .. }
        ));
        assert!(
            decode_authenticator_options_response(wire(r#"{"ok":false,"status":"unavailable"}"#)?)
                .is_err()
        );

        assert!(matches!(
            decode_authenticator_preview_response(wire(r#"{"ok":true,"status":"unavailable"}"#)?)?,
            nook_companion_core::AuthenticatorPreviewResponse::Unavailable { .. }
        ));
        assert!(
            decode_authenticator_preview_response(wire(r#"{"ok":false,"status":"unavailable"}"#)?)
                .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn authenticator_session_decoders_admit_complete_responses() -> Result<(), JsError> {
        assert!(
            decode_authenticator_code_session_response(js_value(
                r#"{"ok":true,"code":"012345","expiresAt":1700000030000}"#,
            )?)
            .is_ok()
        );
        assert!(decode_authenticator_preview_session_response(js_value(
            r#"{"ok":true,"preview":{"issuer":"Example","account":"alice@example.com","websiteUrl":"https://example.com","algorithm":"SHA1","digits":6,"period":30}}"#,
        )?)
        .is_ok());
        assert!(
            decode_authenticator_secret_session_response(js_value(
                r#"{"ok":true,"secretId":"authenticator-1"}"#,
            )?)
            .is_ok()
        );
        assert!(decode_authenticator_backup_verification_session_response(js_value(
            r#"{"ok":true,"secretId":"authenticator-1","backupCodesVerified":true,"reviewedInputPersisted":true}"#,
        )?)
        .is_ok());
        assert!(decode_authenticator_code_session_response(JsValue::from_str("invalid")).is_err());
        assert!(
            decode_authenticator_preview_session_response(JsValue::from_str("invalid")).is_err()
        );
        assert!(
            decode_authenticator_secret_session_response(JsValue::from_str("invalid")).is_err()
        );
        assert!(
            decode_authenticator_backup_verification_session_response(JsValue::from_str("invalid"))
                .is_err()
        );
        Ok(())
    }
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_authenticator_code_session_response(
    value: wasm_bindgen::JsValue,
) -> Result<nook_companion_core::AuthenticatorCodeSessionResponse, JsError> {
    let wire: nook_companion_core::AuthenticatorCodeSessionWire =
        serde_wasm_bindgen::from_value(value)
            .map_err(|_| JsError::new("Extension session returned an invalid response."))?;
    nook_companion_core::AuthenticatorCodeSessionResponse::try_from(wire).map_err(JsError::new)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_authenticator_preview_session_response(
    value: wasm_bindgen::JsValue,
) -> Result<nook_companion_core::AuthenticatorPreviewSessionResponse, JsError> {
    let wire: nook_companion_core::AuthenticatorPreviewSessionWire =
        serde_wasm_bindgen::from_value(value)
            .map_err(|_| JsError::new("Extension session returned an invalid response."))?;
    nook_companion_core::AuthenticatorPreviewSessionResponse::try_from(wire).map_err(JsError::new)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_authenticator_secret_session_response(
    value: wasm_bindgen::JsValue,
) -> Result<nook_companion_core::AuthenticatorSecretSessionResponse, JsError> {
    let wire: nook_companion_core::AuthenticatorSecretSessionWire =
        serde_wasm_bindgen::from_value(value)
            .map_err(|_| JsError::new("Extension session returned an invalid response."))?;
    nook_companion_core::AuthenticatorSecretSessionResponse::try_from(wire).map_err(JsError::new)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_authenticator_backup_verification_session_response(
    value: wasm_bindgen::JsValue,
) -> Result<nook_companion_core::VerifiedAuthenticatorBackupAttachResponse, JsError> {
    let wire: nook_companion_core::AuthenticatorBackupVerificationSessionWire =
        serde_wasm_bindgen::from_value(value)
            .map_err(|_| JsError::new("Extension session returned an invalid response."))?;
    nook_companion_core::VerifiedAuthenticatorBackupAttachResponse::try_from(wire)
        .map_err(JsError::new)
}
