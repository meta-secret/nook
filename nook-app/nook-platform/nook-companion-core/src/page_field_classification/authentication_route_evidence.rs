use super::{
    AuthenticationRouteControlPresence, AuthenticationRoutePasswordPresence,
    AuthenticationRouteScope, AuthenticationRouteUsernamePresence, AuthenticationUsernameEvidence,
};

/// Maximum byte length for each DOM-controlled authentication identity string.
pub const MAX_AUTHENTICATION_CONTROL_TEXT_BYTES: usize = 512;

/// Maximum byte length for a browser-resolved authentication destination URL.
pub const MAX_AUTHENTICATION_DESTINATION_TEXT_BYTES: usize = 4096;

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
