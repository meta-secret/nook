//! Ephemeral login-save session ingress and generic write request.
use super::queue::{MessageDefaultQueueDisposition, QueueDisposition};
use super::request::SessionSecretText;
use crate::LoginExplicitCandidatePresence;
use crate::LoginSubmissionOrigin;
use crate::LoginSubmissionPageUrl;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum SubmittedLoginSaveTarget {
    Create,
    Replace { secret_id: nook_auth2::SecretId },
}

#[derive(Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct SubmittedWebsiteLoginSaveRequest {
    pub origin: crate::LoginSubmissionPageUrl,
    pub username: SessionSecretText,
    pub password: SessionSecretText,
    pub target: SubmittedLoginSaveTarget,
    pub evidence: crate::LoginSaveOutcomeObservation,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(try_from = "LoginSavePlanPayloadWire", rename_all = "camelCase")]
pub struct LoginSavePlanPayload {
    pub(super) vault_store_id: String,
    pub(super) device_id: String,
    pub(super) device_public_key: String,
    pub(super) device_signing_public_key: String,
    pub(super) origin: crate::LoginSubmissionPageUrl,
    pub(super) username: SessionSecretText,
    pub(super) password: SessionSecretText,
    pub(super) captured_values: Vec<SessionSecretText>,
    pub(super) sender: crate::LoginSaveSenderContext,
    pub(super) capture: Box<crate::LoginSubmissionCapture>,
    pub(super) queue: QueueDisposition,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct LoginSavePlanPayloadWire {
    vault_store_id: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
    origin: String,
    username: SessionSecretText,
    password: SessionSecretText,
    captured_values: Vec<SessionSecretText>,
    sender: crate::LoginSaveSenderContext,
    capture: crate::LoginSubmissionCapture,
    queue: QueueDisposition,
}

#[derive(Debug, thiserror::Error)]
pub enum LoginSavePlanIngressError {
    #[error("login capture values do not match bounded fields")]
    MismatchedValues,
    #[error("login explicit candidate presence contradicts its values")]
    InvalidCandidate,
    #[error("login capture origin does not match sender origin")]
    OriginMismatch,
    #[error(transparent)]
    InvalidCapture(#[from] crate::LoginCaptureError),
    #[error(transparent)]
    InvalidOrigin(#[from] crate::LoginSaveContextError),
}

impl TryFrom<LoginSavePlanPayloadWire> for LoginSavePlanPayload {
    type Error = LoginSavePlanIngressError;
    fn try_from(wire: LoginSavePlanPayloadWire) -> Result<Self, Self::Error> {
        wire.capture.validate()?;
        match (wire.captured_values.len(), wire.capture.fields.len()) {
            (values, fields)
                if values == fields
                    && values <= crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT as usize => {}
            _ => return Err(LoginSavePlanIngressError::MismatchedValues),
        }
        match (
            wire.capture.explicit_candidate,
            wire.username.as_str().is_empty(),
            wire.password.as_str().is_empty(),
        ) {
            (LoginExplicitCandidatePresence::Absent, true, true)
            | (LoginExplicitCandidatePresence::Present, false, false) => {}
            (LoginExplicitCandidatePresence::Absent, false, _)
            | (LoginExplicitCandidatePresence::Absent, true, false)
            | (LoginExplicitCandidatePresence::Present, true, _)
            | (LoginExplicitCandidatePresence::Present, false, true) => {
                return Err(LoginSavePlanIngressError::InvalidCandidate);
            }
        }
        let origin = LoginSubmissionPageUrl::try_from(wire.origin)?;
        match wire.capture.submitted_url.compare_origin(&origin) {
            LoginSubmissionOrigin::SameOrigin => {}
            LoginSubmissionOrigin::ChangedOrigin => {
                return Err(LoginSavePlanIngressError::OriginMismatch);
            }
        }
        Ok(Self {
            vault_store_id: wire.vault_store_id,
            device_id: wire.device_id,
            device_public_key: wire.device_public_key,
            device_signing_public_key: wire.device_signing_public_key,
            origin,
            username: wire.username,
            password: wire.password,
            captured_values: wire.captured_values,
            sender: wire.sender,
            capture: Box::new(wire.capture),
            queue: wire.queue,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct OriginPayload {
    pub(super) origin: String,
    pub(super) sender: crate::LoginSaveSenderContext,
    pub(super) queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GrantedLoginSaveActionPayload {
    pub(super) vault_store_id: String,
    pub(super) device_id: String,
    pub(super) device_public_key: String,
    pub(super) device_signing_public_key: String,
    pub(super) origin: String,
    pub(super) offer_id: String,
    pub(super) sender: crate::LoginSaveSenderContext,
    pub(super) evidence: crate::LoginSaveCommitEvidence,
    pub(super) queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DirectLoginSaveActionPayload {
    pub(super) origin: String,
    pub(super) offer_id: String,
    pub(super) sender: crate::LoginSaveSenderContext,
    pub(super) queue: MessageDefaultQueueDisposition,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AuthenticationPageObservationFacts;
    use crate::AuthenticationWorkflowKind;
    use crate::LoginCapturedFieldIndex;
    use crate::LoginControlLabel;
    use crate::LoginExplicitCandidatePresence;
    use crate::LoginPasswordFieldHistory;
    use crate::LoginSaveCaptureDecision;
    use crate::LoginSaveCaptureSource;
    use crate::LoginSubmissionEvent;
    use crate::LoginSubmissionTarget;
    use crate::LoginSubmissionTrust;
    use crate::credential_fill::field::Index;
    use crate::{
        AuthenticationOutcomeObservation, ExtensionSessionRequest, LoginSaveCommitEvidence,
        LoginSaveFrameId, LoginSaveSenderContext, LoginSaveTabId, LoginSubmissionPageUrl,
    };
    use serde_json::Value;

    struct Fixture;
    impl Fixture {
        fn capture() -> anyhow::Result<crate::LoginSubmissionCapture> {
            let field = crate::LoginSubmissionFieldMetadata {
                input_type: "text".to_owned(),
                disabled: false,
                read_only: false,
                autocomplete_tokens: vec!["username".to_owned()],
                identity_text: "Username".to_owned(),
                login_context: true,
                password_history: LoginPasswordFieldHistory::Unobserved,
            };
            Ok(crate::LoginSubmissionCapture {
                intent: crate::LoginSubmissionIntent {
                    event: LoginSubmissionEvent::FormSubmit,
                    trust: LoginSubmissionTrust::Trusted,
                    target: LoginSubmissionTarget::CredentialScope,
                    control_label: LoginControlLabel::try_from(String::new())?,
                    context: AuthenticationPageObservationFacts::default(),
                },
                fields: vec![
                    field.clone(),
                    crate::LoginSubmissionFieldMetadata {
                        input_type: "password".to_owned(),
                        autocomplete_tokens: vec!["current-password".to_owned()],
                        identity_text: "Password".to_owned(),
                        ..field
                    },
                ],
                submitted_at: serde_json::from_str("1000")?,
                submitted_url: LoginSubmissionPageUrl::try_from(
                    "https://example.test/login".to_owned(),
                )?,
                controls: Vec::new(),
                explicit_candidate: LoginExplicitCandidatePresence::Absent,
            })
        }
        fn requests() -> anyhow::Result<[ExtensionSessionRequest; 4]> {
            let sender = LoginSaveSenderContext {
                tab_id: LoginSaveTabId::try_from(4)?,
                frame_id: LoginSaveFrameId::try_from(0)?,
            };
            Ok([
                ExtensionSessionRequest::PlanLoginSave(LoginSavePlanPayload {
                    vault_store_id: "vault".to_owned(),
                    device_id: "device".to_owned(),
                    device_public_key: "key".to_owned(),
                    device_signing_public_key: "signing".to_owned(),
                    origin: LoginSubmissionPageUrl::try_from("https://example.test".to_owned())?,
                    username: serde_json::from_str("\"\"")?,
                    password: serde_json::from_str("\"\"")?,
                    captured_values: vec![
                        serde_json::from_str("\"user\"")?,
                        serde_json::from_str("\" password \"")?,
                    ],
                    sender,
                    capture: Box::new(Self::capture()?),
                    queue: QueueDisposition::MessageDefault {},
                }),
                ExtensionSessionRequest::PendingLoginSave(OriginPayload {
                    origin: "https://example.test".to_owned(),
                    sender,
                    queue: QueueDisposition::MessageDefault {},
                }),
                ExtensionSessionRequest::CommitLoginSave(GrantedLoginSaveActionPayload {
                    vault_store_id: "vault".to_owned(),
                    device_id: "device".to_owned(),
                    device_public_key: "key".to_owned(),
                    device_signing_public_key: "signing".to_owned(),
                    origin: "https://example.test".to_owned(),
                    offer_id: "offer".to_owned(),
                    sender,
                    evidence: LoginSaveCommitEvidence::ExplicitAuthentication {
                        observation: AuthenticationOutcomeObservation {
                            success_marker_present: true,
                            same_document_mutation: true,
                            elapsed_ms: 1000.into(),
                            ..Default::default()
                        },
                    },
                    queue: QueueDisposition::MessageDefault {},
                }),
                ExtensionSessionRequest::DismissLoginSave(DirectLoginSaveActionPayload {
                    origin: "https://example.test".to_owned(),
                    offer_id: "offer".to_owned(),
                    sender,
                    queue: MessageDefaultQueueDisposition::MessageDefault {},
                }),
            ])
        }
    }

    #[test]
    fn login_save_ingress_requires_sender_capture_baseline_and_fresh_commit_evidence()
    -> anyhow::Result<()> {
        for request in Fixture::requests()? {
            let wire = serde_json::to_value(&request)?;
            let decoded: ExtensionSessionRequest = serde_json::from_value(wire.clone())?;
            assert_eq!(decoded, request);
            let mut legacy = wire.clone();
            legacy
                .get_mut("payload")
                .and_then(Value::as_object_mut)
                .ok_or_else(|| anyhow::anyhow!("payload fixture"))?
                .remove("sender");
            assert!(serde_json::from_value::<ExtensionSessionRequest>(legacy).is_err());
            let mut foreign = wire;
            foreign
                .get_mut("payload")
                .and_then(|payload| payload.get_mut("sender"))
                .and_then(Value::as_object_mut)
                .ok_or_else(|| anyhow::anyhow!("sender fixture"))?
                .insert("documentId".to_owned(), serde_json::json!("foreign"));
            assert!(serde_json::from_value::<ExtensionSessionRequest>(foreign).is_err());
        }
        Ok(())
    }

    #[test]
    fn secret_text_debug_never_discloses_credentials() -> anyhow::Result<()> {
        let secret: SessionSecretText = serde_json::from_str("\" password \"")?;
        assert_eq!(format!("{secret:?}"), "[REDACTED]");
        assert_eq!(secret.as_str(), " password ");
        Ok(())
    }

    #[test]
    fn first_message_carries_exact_values_and_rust_derived_login_selection() -> anyhow::Result<()> {
        let [request, ..] = Fixture::requests()?;
        let wire = serde_json::to_value(request)?;
        let decoded: ExtensionSessionRequest = serde_json::from_value(wire)?;
        let ExtensionSessionRequest::PlanLoginSave(payload) = &decoded else {
            anyhow::bail!("plan fixture");
        };
        assert_eq!(
            payload
                .captured_values
                .get(1)
                .ok_or_else(|| anyhow::anyhow!("password fixture"))?
                .as_str(),
            " password "
        );
        assert!(
            matches!(payload.capture.clone().classify()?, LoginSaveCaptureDecision::SubmittedLogin { username_field_index, password_field_index, baseline }
            if username_field_index == LoginCapturedFieldIndex::from(Index::ZERO)
                && password_field_index == LoginCapturedFieldIndex::from(Index::ONE)
                && baseline.source == LoginSaveCaptureSource::SubmittedLogin)
        );
        assert!(!format!("{decoded:?}").contains(" password "));
        Ok(())
    }

    #[test]
    fn first_ingress_rejects_mismatched_values_candidate_presence_and_origin() -> anyhow::Result<()>
    {
        let [request, ..] = Fixture::requests()?;
        let wire = serde_json::to_value(request)?;
        for (field, value) in [
            ("capturedValues", serde_json::json!([])),
            ("username", serde_json::json!("foreign candidate")),
            ("origin", serde_json::json!("https://foreign.test")),
        ] {
            let mut invalid = wire.clone();
            invalid
                .get_mut("payload")
                .and_then(Value::as_object_mut)
                .ok_or_else(|| anyhow::anyhow!("payload fixture"))?
                .insert(field.to_owned(), value);
            assert!(
                serde_json::from_value::<ExtensionSessionRequest>(invalid).is_err(),
                "{field}"
            );
        }
        for missing in ["capture", "capturedValues"] {
            let mut invalid = wire.clone();
            invalid
                .get_mut("payload")
                .and_then(Value::as_object_mut)
                .ok_or_else(|| anyhow::anyhow!("payload fixture"))?
                .remove(missing);
            assert!(serde_json::from_value::<ExtensionSessionRequest>(invalid).is_err());
        }
        let mut oversized = Fixture::capture()?;
        oversized.fields.resize(
            crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT as usize + 1,
            oversized
                .fields
                .first()
                .ok_or_else(|| anyhow::anyhow!("field fixture"))?
                .clone(),
        );
        assert!(oversized.validate().is_err());
        Ok(())
    }

    #[test]
    fn existing_signup_requires_genuine_explicit_candidate_and_manual_is_ignored()
    -> anyhow::Result<()> {
        let mut capture = Fixture::capture()?;
        capture
            .fields
            .get_mut(1)
            .ok_or_else(|| anyhow::anyhow!("password fixture"))?
            .autocomplete_tokens = vec!["new-password".to_owned()];
        assert_eq!(
            capture.clone().classify()?,
            LoginSaveCaptureDecision::Ignored
        );
        capture.explicit_candidate = LoginExplicitCandidatePresence::Present;
        assert!(
            matches!(capture.clone().classify()?, LoginSaveCaptureDecision::ExplicitAuthentication { baseline }
            if baseline.source == LoginSaveCaptureSource::ExplicitAuthentication
                && baseline.captured_workflow == AuthenticationWorkflowKind::Signup)
        );
        capture.intent.trust = LoginSubmissionTrust::Untrusted;
        assert_eq!(capture.classify()?, LoginSaveCaptureDecision::Ignored);
        Ok(())
    }

    #[test]
    fn entered_capture_target_is_closed_bounded_and_required() -> anyhow::Result<()> {
        let mut capture = Fixture::capture()?;
        capture.intent.event = LoginSubmissionEvent::Enter;
        capture.intent.target = LoginSubmissionTarget::CredentialField {
            field_index: LoginCapturedFieldIndex::from(Index::ONE),
        };
        let wire = serde_json::to_value(&capture)?;
        assert_eq!(
            serde_json::from_value::<crate::LoginSubmissionCapture>(wire.clone())?,
            capture
        );
        for target in [
            serde_json::json!({"kind":"CredentialField"}),
            serde_json::json!({"kind":"CredentialField","field_index":{"value":crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT}}),
            serde_json::json!({"kind":"CredentialField","field_index":{"value":-1}}),
            serde_json::json!({"kind":"CredentialField","field_index":{"value":1},"role":"password"}),
        ] {
            let mut invalid = wire.clone();
            invalid
                .get_mut("intent")
                .and_then(Value::as_object_mut)
                .ok_or_else(|| anyhow::anyhow!("intent fixture"))?
                .insert("target".to_owned(), target);
            assert!(serde_json::from_value::<crate::LoginSubmissionCapture>(invalid).is_err());
        }
        let mut missing = wire;
        missing
            .get_mut("intent")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| anyhow::anyhow!("intent fixture"))?
            .remove("target");
        assert!(serde_json::from_value::<crate::LoginSubmissionCapture>(missing).is_err());
        Ok(())
    }
}
