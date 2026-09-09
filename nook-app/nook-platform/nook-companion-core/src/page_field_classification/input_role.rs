use super::{AutocompleteTokenQuery, PageInputFieldObservation, PageInputType};
use crate::AuthenticationControlText;

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

impl PageInputFieldObservation {
    pub(crate) fn classify_authentication_input_role(&self) -> AuthenticationInputRole {
        let field = self;
        if PageInputFieldObservation::has_autocomplete_token(AutocompleteTokenQuery {
            tokens: &field.autocomplete_tokens,
            expected: "one-time-code",
        }) {
            return AuthenticationInputRole::OneTimeCode(OneTimeCode);
        }

        let identity = AuthenticationControlText::new(&field.identity_text).expand_identity_text();
        if PageInputFieldObservation::has_autocomplete_token(AutocompleteTokenQuery {
            tokens: &field.autocomplete_tokens,
            expected: "cc-csc",
        }) || PageInputFieldObservation::one_time_code_negative(&identity)
            || PageInputFieldObservation::username_negative(&identity)
        {
            return AuthenticationInputRole::NonAuthentication(NonAuthentication);
        }

        if matches!(
            field.input_type,
            PageInputType::Text | PageInputType::Email | PageInputType::Tel
        ) && (PageInputFieldObservation::has_autocomplete_token(AutocompleteTokenQuery {
            tokens: &field.autocomplete_tokens,
            expected: "username",
        }) || PageInputFieldObservation::has_autocomplete_token(AutocompleteTokenQuery {
            tokens: &field.autocomplete_tokens,
            expected: "email",
        })) {
            return AuthenticationInputRole::Username(Username);
        }

        if matches!(
            field.input_type,
            PageInputType::Text
                | PageInputType::Tel
                | PageInputType::Number
                | PageInputType::Password
        ) && !identity.is_empty()
            && PageInputFieldObservation::one_time_code_positive(&identity)
        {
            return AuthenticationInputRole::OneTimeCode(OneTimeCode);
        }

        if matches!(
            field.input_type,
            PageInputType::Text | PageInputType::Email | PageInputType::Tel
        ) && !identity.is_empty()
            && (PageInputFieldObservation::username_positive(&identity)
                || (field.input_type == PageInputType::Email && field.login_context))
        {
            return AuthenticationInputRole::Username(Username);
        }

        AuthenticationInputRole::Unrelated(Unrelated)
    }
}

#[cfg(test)]
mod tests {
    use super::super::{
        AuthenticationUsernameEvidence, MAX_AUTHENTICATION_CONTROL_TEXT_BYTES,
        PageInputFieldObservation, PageInputType,
    };

    impl PageInputFieldObservation {
        fn airbnb_mixed_identity() -> Self {
            Self {
                input_type: PageInputType::Text,
                disabled: false,
                read_only: false,
                autocomplete_tokens: vec!["tel-national".to_owned()],
                identity_text: "tel-national Phone number or email".to_owned(),
                login_context: true,
            }
        }
    }

    #[test]
    fn exact_mixed_phone_or_email_identity_has_distinct_evidence() {
        assert_eq!(
            (&PageInputFieldObservation::airbnb_mixed_identity())
                .authentication_username_evidence(),
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
        let mut label_only = PageInputFieldObservation::airbnb_mixed_identity();
        label_only.identity_text = "Phone number or email".to_owned();
        let mut hostile = PageInputFieldObservation::airbnb_mixed_identity();
        hostile.identity_text = "tel-national Phone number or email delete account".to_owned();
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
            label_only,
            hostile,
            generic,
            tel_input,
            oversized,
        ] {
            assert_ne!(
                (&field).authentication_username_evidence(),
                AuthenticationUsernameEvidence::MixedPhoneOrEmail
            );
        }
    }
}
