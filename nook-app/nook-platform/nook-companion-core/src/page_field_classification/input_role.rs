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
