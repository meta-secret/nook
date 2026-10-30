use super::{
    AuthenticationRouteControlPresence, AuthenticationRoutePasswordPresence,
    AuthenticationRouteScope, AuthenticationRouteUsernamePresence, AuthenticationUsernameEvidence,
};

/// Maximum byte length for each DOM-controlled authentication identity string.
pub const MAX_AUTHENTICATION_CONTROL_TEXT_BYTES: usize = 512;

/// Maximum byte length for a browser-resolved authentication destination URL.
pub const MAX_AUTHENTICATION_DESTINATION_TEXT_BYTES: usize = 4096;

/// Maximum destination length admitted by generic authentication policies.
///
/// The larger transport envelope above exists for narrowly classified routes such as Booking's
/// opaque `op_token`; it does not broaden every authentication policy.
pub(crate) const MAX_AUTHENTICATION_POLICY_DESTINATION_TEXT_BYTES: usize = 512;

/// Named values required by `AuthenticationAdvanceControlObservation::one_time_code_ceremony_context_is_authenticated`.
#[derive(Clone, Copy)]
pub struct OneTimeCodeRouteEvidence<'a> {
    pub authentication_username: AuthenticationUsernameEvidence,
    pub source_origin: &'a str,
    pub form_identity: &'a str,
    pub destination_identity: &'a str,
}

/// Named values required by `AuthenticationAdvanceControlObservation::has_safe_authentication_route_identity`.
#[derive(Clone, Copy)]
pub struct AuthenticationRouteEvidence<'a> {
    pub source_origin: &'a str,
    pub form_identity: &'a str,
    pub destination_identity: &'a str,
}

/// Named values required by `AuthenticationAdvanceControlObservation::has_safe_credential_update_route_identity`.
#[derive(Clone, Copy)]
pub struct CredentialUpdateRouteEvidence<'a> {
    pub source_origin: &'a str,
    pub form_identity: &'a str,
    pub destination_identity: &'a str,
}

/// Named values required by `AuthenticationAdvanceControlObservation::can_activate_authentication_route_control`.
#[derive(Clone, Copy)]
pub struct AuthenticationRouteActuation<'a> {
    pub source_origin: &'a str,
    pub form_identity: &'a str,
    pub destination_identity: &'a str,
    pub control_label: &'a str,
    pub control_machine_identity: &'a str,
    pub has_concrete_control: AuthenticationRouteControlPresence,
    pub has_authentication_username: AuthenticationRouteUsernamePresence,
    pub has_local_authentication_scope: AuthenticationRouteScope,
    pub has_authentication_password: AuthenticationRoutePasswordPresence,
}

#[cfg(test)]
mod tests {
    use super::super::{
        AuthenticationAdvanceControlObservation, AuthenticationUsernameEvidence,
        OneTimeCodeRouteDecision, PageControlActionability, PageControlOwnership,
        PageControlSemantics, PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
        PasskeyControlDecision, PasskeyControlMarking,
    };
    use super::*;

    #[test]
    fn expanded_transport_does_not_expand_generic_route_otp_passkey_or_update_policy() {
        let login_destination = format!(
            "https://example.test/login?state={}",
            "a".repeat(MAX_AUTHENTICATION_CONTROL_TEXT_BYTES)
        );
        assert!(login_destination.len() < MAX_AUTHENTICATION_DESTINATION_TEXT_BYTES);
        assert!(
            !AuthenticationAdvanceControlObservation::has_safe_authentication_route_identity(
                AuthenticationRouteEvidence {
                    source_origin: "https://example.test",
                    form_identity: "login-form",
                    destination_identity: &login_destination,
                }
            )
        );
        assert_eq!(
            OneTimeCodeRouteEvidence {
                authentication_username: AuthenticationUsernameEvidence::Strong,
                source_origin: "https://example.test",
                form_identity: "login-form",
                destination_identity: &login_destination,
            }
            .classify(),
            OneTimeCodeRouteDecision::Rejected
        );

        let update_destination = format!(
            "https://example.test/reset-password?state={}",
            "a".repeat(MAX_AUTHENTICATION_CONTROL_TEXT_BYTES)
        );
        assert!(
            !AuthenticationAdvanceControlObservation::has_safe_credential_update_route_identity(
                CredentialUpdateRouteEvidence {
                    source_origin: "https://example.test",
                    form_identity: "reset-password",
                    destination_identity: &update_destination,
                }
            )
        );

        let passkey = AuthenticationAdvanceControlObservation {
            actionability: PageControlActionability::Actionable,
            ownership: PageControlOwnership::OwnedForm,
            semantics: PageControlSemantics::Activation,
            authentication_username: AuthenticationUsernameEvidence::Strong,
            password_field_count: 0.into(),
            new_password_field_count: 0.into(),
            one_time_code_field_count: 0.into(),
            semantic_submit_control_count: 1.into(),
            source_origin: "https://example.test".to_owned(),
            form_identity: "login-form".to_owned(),
            destination_identity: login_destination,
            label: "Use passkey".to_owned(),
            machine_identity: String::new(),
            submission_method: PageControlSubmissionMethod::Post,
            submission_destination_source: PageControlSubmissionDestinationSource::Authored,
        };
        assert_eq!(
            passkey.classify_authentication_passkey_control(PasskeyControlMarking::Explicit),
            PasskeyControlDecision::ControlVeto
        );
    }
}
