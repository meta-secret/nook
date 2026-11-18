use super::*;
use serde_json::json;

struct PageFixture;

impl PageFixture {
    fn field() -> BrowserPageInput {
        BrowserPageInput {
            input_type: "text".into(),
            disabled: false,
            read_only: false,
            autocomplete_tokens: vec![],
            identity_text: String::new(),
            login_context: false,
            second_factor_route: BrowserSecondFactorRoute(PageSecondFactorRoute::Unrelated),
            input_mode: String::new(),
            max_length: -1,
            pattern: String::new(),
        }
    }

    fn email() -> BrowserPageInput {
        BrowserPageInput {
            input_type: "email".into(),
            autocomplete_tokens: vec!["email".into()],
            ..Self::field()
        }
    }

    fn otp() -> BrowserPageInput {
        BrowserPageInput {
            identity_text: "ctl00$MainContent$txtValue".into(),
            input_mode: " numeric ".into(),
            pattern: r"\d{6}".into(),
            ..Self::field()
        }
    }

    fn context() -> LoginContextObservation {
        LoginContextObservation {
            form_identity: String::new(),
            ancestor_identities: vec![],
            advance_control_label: "Submit".into(),
            path_context: "/ example.test".into(),
        }
    }

    fn challenge() -> LoginContextObservation {
        LoginContextObservation {
            path_context: "/twofa/totp/ example.test".into(),
            ..Self::context()
        }
    }
}

#[test]
fn page_fields_override_standalone_context_and_preserve_host_identity_and_order()
-> serde_json::Result<()> {
    assert_eq!(
        PageFixture::email()
            .classify()
            .authentication_username_evidence,
        AuthenticationUsernameEvidence::StandardsBasedEmail
    );
    assert!(!PageFixture::otp().classify().looks_like_one_time_code_field);

    let login = LoginContextObservation {
        ancestor_identities: vec!["panel".into(), "login-form".into()],
        ..PageFixture::context()
    };
    let page = PageInputsObservation {
        fields: vec![
            PageInputFieldRequest {
                index: PageInputRequestIndex(29.0),
                observation: PageFixture::email(),
                login_context_observation: login.clone(),
            },
            PageInputFieldRequest {
                index: PageInputRequestIndex(3.0),
                observation: PageFixture::otp(),
                login_context_observation: PageFixture::challenge(),
            },
            PageInputFieldRequest {
                index: PageInputRequestIndex(29.0),
                observation: BrowserPageInput {
                    read_only: true,
                    ..PageFixture::email()
                },
                login_context_observation: login,
            },
        ],
        labels: vec![],
    };
    let result = page.classify();
    assert_eq!(
        serde_json::to_value(result.fields)?,
        json!([
            {"index": 29.0, "loginContext": true, "authenticationUsernameEvidence": "strong",
             "looksLikeUsernameField": true, "looksLikeOneTimeCodeField": false},
            {"index": 3.0, "loginContext": false, "authenticationUsernameEvidence": "absent",
             "looksLikeUsernameField": false, "looksLikeOneTimeCodeField": true},
            {"index": 29.0, "loginContext": true, "authenticationUsernameEvidence": "absent",
             "looksLikeUsernameField": false, "looksLikeOneTimeCodeField": false}
        ])
    );
    assert_eq!(
        result.strongest_authentication_username_evidence,
        AuthenticationUsernameEvidence::Strong
    );
    assert_eq!(
        result.username_evidence_by_strength,
        AuthenticationUsernameEvidence::BY_STRENGTH
    );
    Ok(())
}

#[test]
fn page_preserves_empty_field_ranking_and_duplicate_ordered_label_results() -> serde_json::Result<()>
{
    let cases = [
        ("login-advance", "next", true),
        ("manual-checkpoint", "accept terms", true),
        ("authentication-container-identity", "reset_base", false),
        ("passkey-control", "Sign in with a passkey", true),
        ("email-verification-body", "Check your email", true),
        (
            "one-time-code-auto-submit-signal",
            "oninput=this.form.requestSubmit()",
            true,
        ),
        ("login-advance", "delete account", false),
        ("login-advance", "next", true),
    ];
    let labels: Vec<_> = cases
        .iter()
        .map(|(kind, value, _)| json!({ "kind": kind, "value": value }))
        .collect();
    let page: PageInputsObservation =
        serde_json::from_value(json!({"fields": [], "labels": labels}))?;
    let result = page.classify();
    assert!(result.fields.is_empty());
    assert_eq!(
        result.strongest_authentication_username_evidence,
        AuthenticationUsernameEvidence::Absent
    );
    let expected: Vec<_> = cases
        .iter()
        .map(|(kind, value, matches)| json!({"kind": kind, "value": value, "matches": matches}))
        .collect();
    assert_eq!(serde_json::to_value(result.labels)?, json!(expected));
    Ok(())
}

#[test]
fn standalone_observations_preserve_numeric_routes_and_reject_unknown_typed_values()
-> serde_json::Result<()> {
    let context = PageInputContext::from(&PageFixture::challenge());
    assert_eq!(
        serde_json::to_value(context)?,
        json!({"loginContext":false,"secondFactorRoute":1})
    );

    let field = BrowserPageInput {
        second_factor_route: serde_json::from_value(json!(1))?,
        ..PageFixture::otp()
    };
    assert!(field.classify().looks_like_one_time_code_field);
    assert!(serde_json::from_value::<BrowserSecondFactorRoute>(json!(2)).is_err());
    assert!(
        serde_json::from_value::<PageInputLabel>(json!({"kind":"unknown","value":""})).is_err()
    );
    Ok(())
}
