//! Typed WASM bindings for portable page-field and password-form policy.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct NookPageInputFieldObservation {
    inner: nook_companion_core::PageInputFieldObservation,
}

#[wasm_bindgen]
impl NookPageInputFieldObservation {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments, clippy::needless_pass_by_value)]
    pub fn new(
        input_type: nook_companion_core::PageInputType,
        disabled: bool,
        read_only: bool,
        autocomplete_tokens: Vec<String>,
        identity_text: String,
        login_context: bool,
    ) -> Self {
        Self {
            inner: nook_companion_core::PageInputFieldObservation {
                input_type,
                disabled,
                read_only,
                autocomplete_tokens,
                identity_text,
                login_context,
            },
        }
    }
}

#[wasm_bindgen]
#[must_use]
pub fn expand_identity_text(value: &str) -> String {
    nook_companion_core::expand_identity_text(value)
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct NookLoginContextObservation {
    inner: nook_companion_core::LoginContextObservation,
}

#[wasm_bindgen]
impl NookLoginContextObservation {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        form_identity: String,
        ancestor_identities: Vec<String>,
        advance_control_label: String,
        path_context: String,
    ) -> Self {
        Self {
            inner: nook_companion_core::LoginContextObservation {
                form_identity,
                ancestor_identities,
                advance_control_label,
                path_context,
            },
        }
    }
}

#[wasm_bindgen]
#[must_use]
pub fn has_login_context(observation: &NookLoginContextObservation) -> bool {
    nook_companion_core::has_login_context(&observation.inner)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_username_field(field: &NookPageInputFieldObservation) -> bool {
    nook_companion_core::looks_like_username_field(&field.inner)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_one_time_code_field(field: &NookPageInputFieldObservation) -> bool {
    nook_companion_core::looks_like_one_time_code_field(&field.inner)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_passkey_control_label(label: &str) -> bool {
    nook_companion_core::looks_like_passkey_control_label(label)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_manual_checkpoint_label(label: &str) -> bool {
    nook_companion_core::looks_like_manual_checkpoint_label(label)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_email_verification_body(body: &str) -> bool {
    nook_companion_core::looks_like_email_verification_body(body)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_login_advance_control_label(label: &str) -> bool {
    nook_companion_core::looks_like_login_advance_control_label(label)
}

#[wasm_bindgen]
#[must_use]
pub fn has_safe_authentication_route_identity(
    source_origin: &str,
    form_identity: &str,
    destination_identity: &str,
) -> bool {
    nook_companion_core::has_safe_authentication_route_identity(
        source_origin,
        form_identity,
        destination_identity,
    )
}

#[wasm_bindgen]
#[must_use]
pub fn can_activate_authentication_route_control(
    source_origin: &str,
    form_identity: &str,
    destination_identity: &str,
    control_label: &str,
    has_form_owned_semantic_submit: bool,
    has_authentication_username: bool,
    has_local_authentication_scope: bool,
) -> bool {
    nook_companion_core::can_activate_authentication_route_control(
        source_origin,
        form_identity,
        destination_identity,
        control_label,
        has_form_owned_semantic_submit,
        has_authentication_username,
        has_local_authentication_scope,
    )
}

#[wasm_bindgen]
#[must_use]
pub fn authentication_form_observation_priority(
    observation: nook_companion_core::AuthenticationPageObservation,
) -> u8 {
    nook_companion_core::authentication_form_observation_priority(observation)
}

#[wasm_bindgen]
#[must_use]
pub fn parse_page_input_type(value: &str) -> nook_companion_core::PageInputType {
    nook_companion_core::PageInputType::parse(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_form_wasm_exports_match_core_policy() {
        let otp = NookPageInputFieldObservation::new(
            nook_companion_core::PageInputType::Text,
            false,
            false,
            Vec::new(),
            "Enter OTP Code".to_owned(),
            false,
        );
        assert!(looks_like_one_time_code_field(&otp));

        let username = NookPageInputFieldObservation::new(
            nook_companion_core::PageInputType::Text,
            false,
            false,
            Vec::new(),
            "loginfmt".to_owned(),
            false,
        );
        assert!(looks_like_username_field(&username));
        assert!(looks_like_login_advance_control_label("Entrar Entrar"));
        assert!(has_safe_authentication_route_identity(
            "https://example.test",
            "login-form",
            "https://example.test/auth/login?x=1",
        ));
        assert!(!has_safe_authentication_route_identity(
            "https://example.test",
            "login-form",
            "https://example.test/login?provider",
        ));
        assert!(!can_activate_authentication_route_control(
            "https://example.test",
            "login-form",
            "https://example.test/auth/login",
            "Entrar con Amazon",
            true,
            true,
            true,
        ));
        assert!(can_activate_authentication_route_control(
            "https://example.test",
            "login-form",
            "https://example.test/auth/login",
            "",
            false,
            true,
            true,
        ));
        let login = nook_companion_core::AuthenticationPageObservation {
            current_password_field_count: 1,
            ..Default::default()
        };
        assert_eq!(authentication_form_observation_priority(login), 4);
    }
}
