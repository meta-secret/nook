#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

mod control;
mod transaction;

pub use control::{
    AuthenticationCredentialDisclosureControlObservation, AuthenticationDisclosureControlDecision,
    AuthenticationDisclosureObservationSchemaVersion,
    CurrentAuthenticationDisclosureControlRequest,
    VersionedAuthenticationDisclosureControlObservation,
};
pub use transaction::{
    AuthenticationCredentialDisclosureCapability,
    AuthenticationCredentialDisclosurePlanningCapability,
    AuthenticationCredentialDisclosurePlanningDecision,
    AuthenticationCredentialDisclosurePlanningRequest,
    AuthenticationCredentialDisclosurePreflightRequest,
    AuthenticationCredentialDisclosureRejection, AuthenticationPasswordDisclosureContinuation,
    AuthenticationPasswordDisclosureRequest, AuthorizedAuthenticationUsernameDisclosure,
};
