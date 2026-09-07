use super::{
    PageInputFieldObservation, PageInputType, expand_identity_text, has_autocomplete_token,
    one_time_code_negative, one_time_code_positive, username_negative, username_positive,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Username;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct OneTimeCode;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct NonAuthentication;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Unrelated;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AuthenticationInputRole {
    Username(Username),
    OneTimeCode(OneTimeCode),
    NonAuthentication(NonAuthentication),
    Unrelated(Unrelated),
}

pub(crate) fn classify_authentication_input_role(
    field: &PageInputFieldObservation,
) -> AuthenticationInputRole {
    if has_autocomplete_token(&field.autocomplete_tokens, "one-time-code") {
        return AuthenticationInputRole::OneTimeCode(OneTimeCode);
    }

    let identity = expand_identity_text(&field.identity_text);
    if has_autocomplete_token(&field.autocomplete_tokens, "cc-csc")
        || one_time_code_negative(&identity)
        || username_negative(&identity)
    {
        return AuthenticationInputRole::NonAuthentication(NonAuthentication);
    }

    if matches!(
        field.input_type,
        PageInputType::Text | PageInputType::Email | PageInputType::Tel
    ) && (has_autocomplete_token(&field.autocomplete_tokens, "username")
        || has_autocomplete_token(&field.autocomplete_tokens, "email"))
    {
        return AuthenticationInputRole::Username(Username);
    }

    if matches!(
        field.input_type,
        PageInputType::Text | PageInputType::Tel | PageInputType::Number | PageInputType::Password
    ) && !identity.is_empty()
        && one_time_code_positive(&identity)
    {
        return AuthenticationInputRole::OneTimeCode(OneTimeCode);
    }

    if matches!(
        field.input_type,
        PageInputType::Text | PageInputType::Email | PageInputType::Tel
    ) && !identity.is_empty()
        && (username_positive(&identity)
            || (field.input_type == PageInputType::Email && field.login_context))
    {
        return AuthenticationInputRole::Username(Username);
    }

    AuthenticationInputRole::Unrelated(Unrelated)
}

#[cfg(test)]
mod tests {
    use super::super::{
        AuthenticationUsernameEvidence, MAX_AUTHENTICATION_CONTROL_TEXT_BYTES,
        PageInputFieldObservation, PageInputType, authentication_username_evidence,
    };

    impl PageInputFieldObservation {
        fn airbnb_mixed_identity() -> Self {
            Self {
                input_type: PageInputType::Text,
                disabled: false,
                read_only: false,
                autocomplete_tokens: vec!["tel-national".to_owned()],
                identity_text: "Phone number or email".to_owned(),
                login_context: true,
            }
        }
    }

    #[test]
    fn exact_mixed_phone_or_email_identity_has_distinct_evidence() {
        assert_eq!(
            authentication_username_evidence(&PageInputFieldObservation::airbnb_mixed_identity()),
            AuthenticationUsernameEvidence::MixedPhoneOrEmail
        );
    }

    #[test]
    fn mixed_phone_or_email_evidence_requires_the_complete_bounded_shape() {
        let mut missing_context = PageInputFieldObservation::airbnb_mixed_identity();
        missing_context.login_context = false;
        let mut missing_autocomplete = PageInputFieldObservation::airbnb_mixed_identity();
        missing_autocomplete.autocomplete_tokens.clear();
        let mut other_autocomplete = PageInputFieldObservation::airbnb_mixed_identity();
        other_autocomplete.autocomplete_tokens = vec!["tel".to_owned()];
        let mut extra_autocomplete = PageInputFieldObservation::airbnb_mixed_identity();
        extra_autocomplete
            .autocomplete_tokens
            .push("email".to_owned());
        let mut phone_only = PageInputFieldObservation::airbnb_mixed_identity();
        phone_only.identity_text = "Phone number".to_owned();
        let mut email_only = PageInputFieldObservation::airbnb_mixed_identity();
        email_only.identity_text = "Email".to_owned();
        let mut hostile = PageInputFieldObservation::airbnb_mixed_identity();
        hostile.identity_text = "Phone number or email delete account".to_owned();
        let mut generic = PageInputFieldObservation::airbnb_mixed_identity();
        generic.identity_text = "Generic identifier".to_owned();
        let mut tel_input = PageInputFieldObservation::airbnb_mixed_identity();
        tel_input.input_type = PageInputType::Tel;
        let mut oversized = PageInputFieldObservation::airbnb_mixed_identity();
        oversized.identity_text = "x".repeat(MAX_AUTHENTICATION_CONTROL_TEXT_BYTES + 1);
        for field in [
            missing_context,
            missing_autocomplete,
            other_autocomplete,
            extra_autocomplete,
            phone_only,
            email_only,
            hostile,
            generic,
            tel_input,
            oversized,
        ] {
            assert_ne!(
                authentication_username_evidence(&field),
                AuthenticationUsernameEvidence::MixedPhoneOrEmail
            );
        }
    }
}
