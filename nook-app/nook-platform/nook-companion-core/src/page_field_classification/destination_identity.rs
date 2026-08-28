//! Canonical same-origin destination evidence for authentication controls.

use super::control_identity::identity_names_external_authentication_provider;
use percent_encoding::percent_decode_str;
use url::Url;

pub(super) struct CanonicalControlDestination {
    pub(super) route_identity: String,
    pub(super) has_provider_authority: bool,
}

fn is_http_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some()
}

fn is_origin_only(url: &Url) -> bool {
    url.path() == "/" && url.query().is_none() && url.fragment().is_none()
}

fn has_valid_percent_encoding(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit()
            {
                return false;
            }
            index += 3;
        } else {
            index += 1;
        }
    }
    true
}

fn decode_component(value: &str) -> Option<String> {
    if !has_valid_percent_encoding(value) {
        return None;
    }
    let decoded = percent_decode_str(value).decode_utf8().ok()?;
    if decoded.chars().any(char::is_control) || decoded.contains('%') {
        return None;
    }
    Some(decoded.into_owned())
}

pub(super) fn canonicalize_control_destination(
    source_origin: &str,
    destination_identity: &str,
) -> Option<CanonicalControlDestination> {
    let source = Url::parse(source_origin.trim()).ok()?;
    if !is_http_url(&source) || !is_origin_only(&source) {
        return None;
    }
    let destination_identity = destination_identity.trim();
    let destination = source.join(destination_identity).ok()?;
    if !is_http_url(&destination) || destination.origin() != source.origin() {
        return None;
    }

    let path = if destination_identity.is_empty() {
        String::new()
    } else {
        decode_component(destination.path())?
    };
    let query = match destination.query() {
        Some(value) => Some(decode_component(value)?),
        None => None,
    };
    let fragment = match destination.fragment() {
        Some(value) => Some(decode_component(value)?),
        None => None,
    };
    let mut route_identity = path;
    if let Some(query) = query {
        route_identity.push('?');
        route_identity.push_str(&query);
    }
    if let Some(fragment) = fragment {
        route_identity.push('#');
        route_identity.push_str(&fragment);
    }
    if route_identity.len() > super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES {
        return None;
    }

    Some(CanonicalControlDestination {
        route_identity,
        has_provider_authority: destination
            .host_str()
            .is_some_and(identity_names_external_authentication_provider),
    })
}

#[cfg(test)]
mod tests {
    use crate::{
        AuthenticationAdvanceControlDecision, AuthenticationAdvanceControlObservation,
        AuthenticationDetailedAdvanceControlObservation, AuthenticationFieldObservationFacts,
        AuthenticationPageObservationFacts, AuthenticationPageObservationFactsBatch,
        AuthenticationUsernameEvidence, AuthenticationWorkflowAction, AuthenticationWorkflowKind,
        PageControlActionability, PageControlOwnership, PageControlSemantics,
    };

    fn password_control(
        source_origin: &str,
        destination_identity: &str,
    ) -> AuthenticationAdvanceControlObservation {
        AuthenticationAdvanceControlObservation {
            actionability: PageControlActionability::Actionable,
            ownership: PageControlOwnership::OwnedForm,
            semantics: PageControlSemantics::SemanticSubmit,
            authentication_username: AuthenticationUsernameEvidence::Strong,
            password_field_count: 1,
            new_password_field_count: 0,
            one_time_code_field_count: 0,
            semantic_submit_control_count: 1,
            source_origin: source_origin.to_owned(),
            form_identity: "login".to_owned(),
            destination_identity: destination_identity.to_owned(),
            label: "Sign in".to_owned(),
        }
    }

    fn advances(observation: &AuthenticationAdvanceControlObservation) -> bool {
        observation.classify() == AuthenticationAdvanceControlDecision::AdvancesAuthentication
    }

    #[test]
    fn accepts_relative_and_same_origin_absolute_login_destinations() {
        assert!(advances(&password_control(
            "https://example.test",
            "/login"
        )));
        assert!(advances(&password_control(
            "https://github.com",
            "https://github.com/session"
        )));
        assert!(advances(&password_control(
            "https://gitlab.com",
            "//gitlab.com/users/sign_in"
        )));
    }

    #[test]
    fn accepts_password_only_login_on_the_sites_own_provider_host() {
        for (source_origin, destination_identity) in [
            ("https://login.microsoftonline.com", "/common/login"),
            ("https://accounts.google.com", "/signin/v2/challenge/pwd"),
        ] {
            let mut observation = password_control(source_origin, destination_identity);
            observation.authentication_username = AuthenticationUsernameEvidence::Absent;
            observation.form_identity = String::new();

            assert!(advances(&observation), "{source_origin}");
        }
    }

    #[test]
    fn rejects_cross_origin_provider_and_attacker_destinations() {
        for destination in [
            "https://evil.example/login",
            "https://accounts.google.com/o/oauth2/v2/auth",
            "//evil.example/login",
        ] {
            assert!(!advances(&password_control(
                "https://example.test",
                destination
            )));
        }
    }

    #[test]
    fn decodes_route_vocabulary_before_policy_classification() {
        for destination in [
            "/auth/%64elete-account",
            "/auth/%2564elete-account",
            "/login?next=%2Faccount%2F%63ancel",
            "/login#%6Fauth%2Fgoogle",
        ] {
            assert!(!advances(&password_control(
                "https://example.test",
                destination
            )));
        }
    }

    #[test]
    fn rejects_malformed_or_unsupported_url_evidence() {
        for destination in [
            "/login/%ZZ",
            "javascript:submit()",
            "data:text/plain,login",
            "https://user@example.test/login",
        ] {
            assert!(!advances(&password_control(
                "https://example.test",
                destination
            )));
        }
        for source_origin in [
            "not an origin",
            "ftp://example.test",
            "https://user@example.test",
            "https://example.test/path",
        ] {
            assert!(!advances(&password_control(source_origin, "/login")));
        }
    }

    #[test]
    fn authority_does_not_supply_one_time_code_authentication_context() {
        let mut observation =
            password_control("https://auth.example", "https://auth.example/verify");
        observation.authentication_username = AuthenticationUsernameEvidence::Absent;
        observation.password_field_count = 0;
        observation.one_time_code_field_count = 1;
        observation.form_identity = "verification".to_owned();
        observation.label = "Confirm".to_owned();
        assert!(!advances(&observation));
    }

    #[test]
    fn cross_origin_one_time_code_control_cannot_outrank_same_origin_login() {
        let mut one_time_code =
            password_control("https://example.test", "https://evil.example/auth/verify");
        one_time_code.authentication_username = AuthenticationUsernameEvidence::Absent;
        one_time_code.password_field_count = 0;
        one_time_code.one_time_code_field_count = 1;
        one_time_code.form_identity = "auth verification".to_owned();
        one_time_code.label = "Verify code".to_owned();

        let facts = |fields, control| AuthenticationPageObservationFacts {
            fields,
            detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::Observed(
                control,
            ),
            ..Default::default()
        };
        let snapshot = AuthenticationPageObservationFactsBatch {
            observations: vec![
                facts(
                    AuthenticationFieldObservationFacts {
                        one_time_code_field_count: 1,
                        ..Default::default()
                    },
                    one_time_code,
                ),
                facts(
                    AuthenticationFieldObservationFacts {
                        username_field_count: 1,
                        generic_password_field_count: 1,
                        ..Default::default()
                    },
                    password_control("https://example.test", "/login"),
                ),
            ],
        }
        .classify()
        .snapshot();
        assert!(matches!(
            snapshot,
            Ok(snapshot)
                if snapshot.observation_index == 1
                    && snapshot.kind == AuthenticationWorkflowKind::Login
                    && snapshot.action == AuthenticationWorkflowAction::ContinueWithNook
        ));
    }

    #[test]
    fn source_origin_is_a_required_typed_wire_field() -> Result<(), serde_json::Error> {
        let observation = password_control("https://example.test", "/login");
        let wire = serde_json::to_value(&observation)?;
        assert_eq!(wire["sourceOrigin"], "https://example.test");
        assert_eq!(
            serde_json::from_value::<AuthenticationAdvanceControlObservation>(wire)?,
            observation
        );
        let mut missing = serde_json::to_value(&observation)?;
        assert!(missing.is_object());
        if let Some(object) = missing.as_object_mut() {
            object.remove("sourceOrigin");
        }
        assert!(
            serde_json::from_value::<AuthenticationAdvanceControlObservation>(missing).is_err()
        );
        Ok(())
    }
}
