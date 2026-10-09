//! One selected Google identifier flow, bounded to its live source document.

use super::CredentialKind;
use crate::{
    AuthenticationDetailedAdvanceControlObservation, AuthenticationManualCheckpoint,
    AuthenticationPageObservationFacts, AuthenticationPageObservationFactsBatch,
    AuthenticationSavedLoginCapability, AuthenticationWorkflowKind, AuthenticationWorkflowMatch,
    AuthenticationWorkflowStage,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use url::Url;
use wasm_bindgen::prelude::wasm_bindgen;

/// Opaque generation supplied by the existing extension authorization lifecycle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(try_from = "String", into = "String")]
#[tsify(type = "string")]
pub struct GoogleLoginAuthorizationGeneration(String);

impl TryFrom<String> for GoogleLoginAuthorizationGeneration {
    type Error = GoogleLoginContinuationError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.len() {
            1..=512 => Ok(Self(value)),
            _ => Err(GoogleLoginContinuationError::InvalidObservation),
        }
    }
}

impl From<GoogleLoginAuthorizationGeneration> for String {
    fn from(value: GoogleLoginAuthorizationGeneration) -> Self {
        let GoogleLoginAuthorizationGeneration(value) = value;
        value
    }
}

/// Parsed browser URL; origin and route decisions never use text prefixes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(try_from = "String", into = "String")]
#[tsify(type = "string")]
pub struct GoogleLoginPageUrl(Url);

impl TryFrom<String> for GoogleLoginPageUrl {
    type Error = GoogleLoginContinuationError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.len() {
            1..=crate::MAX_AUTHENTICATION_DESTINATION_TEXT_BYTES => {}
            _ => return Err(GoogleLoginContinuationError::InvalidObservation),
        }
        let url =
            Url::parse(&value).map_err(|_| GoogleLoginContinuationError::InvalidObservation)?;
        match url {
            url if url.username().is_empty()
                && url.password().is_none()
                && url.fragment().is_none() =>
            {
                Ok(Self(url))
            }
            _ => Err(GoogleLoginContinuationError::InvalidObservation),
        }
    }
}

impl From<GoogleLoginPageUrl> for String {
    fn from(value: GoogleLoginPageUrl) -> Self {
        let GoogleLoginPageUrl(url) = value;
        url.into()
    }
}

enum GoogleLoginRoute {
    Identifier,
    PasswordChallenge,
    Unrelated,
}

impl GoogleLoginPageUrl {
    fn route(&self) -> GoogleLoginRoute {
        let Self(url) = self;
        match url.origin().ascii_serialization().as_str() {
            "https://accounts.google.com" => {}
            _ => return GoogleLoginRoute::Unrelated,
        }
        match url.path() {
            "/v3/signin/identifier" => GoogleLoginRoute::Identifier,
            "/v3/signin/challenge/pwd" => GoogleLoginRoute::PasswordChallenge,
            _ => GoogleLoginRoute::Unrelated,
        }
    }
}

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Serialize,
    Deserialize,
    Tsify,
    derive_more::From,
)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct GoogleLoginElapsedMilliseconds(u32);

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GoogleLoginSelectionAuthority {
    DetectedLogin,
    FocusedField,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GoogleLoginIdentifierIntegrity {
    Unchanged,
    Edited,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GoogleLoginUserIntent {
    Continuing,
    Interrupted,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GoogleLoginPasswordOccupancy {
    Empty,
    Populated,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoogleLoginContinuationDecision {
    AwaitPassword,
    FillPassword,
    Cancel,
}

/// Current browser facts. This record contains no credential values or item copies.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct GoogleLoginPageObservation {
    pub page_url: GoogleLoginPageUrl,
    pub authorization_generation: GoogleLoginAuthorizationGeneration,
    pub elapsed_milliseconds: GoogleLoginElapsedMilliseconds,
    #[tsify(type = "keyof typeof GoogleLoginIdentifierIntegrity")]
    pub identifier_integrity: GoogleLoginIdentifierIntegrity,
    #[tsify(type = "keyof typeof GoogleLoginUserIntent")]
    pub user_intent: GoogleLoginUserIntent,
    #[tsify(type = "keyof typeof GoogleLoginPasswordOccupancy")]
    pub password_occupancy: GoogleLoginPasswordOccupancy,
    pub facts: AuthenticationPageObservationFacts,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct GoogleLoginStartRequest {
    pub observation: GoogleLoginPageObservation,
    #[tsify(type = "keyof typeof GoogleLoginSelectionAuthority")]
    pub selection_authority: GoogleLoginSelectionAuthority,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum GoogleLoginContinuationError {
    #[error("invalid Google login observation")]
    InvalidObservation,
    #[error("selected login cannot begin Google two-step continuation")]
    IneligibleSelection,
    #[error("Google password continuation is unavailable")]
    PasswordUnavailable,
}

enum GoogleLoginFieldStage {
    Identifier,
    Password,
    Ineligible,
}

impl GoogleLoginPageObservation {
    fn stage(&self) -> GoogleLoginFieldStage {
        let workflow = AuthenticationPageObservationFactsBatch {
            observations: vec![self.facts.clone()],
        }
        .classify();
        let fields = self.facts.fields;
        match fields {
            fields
                if fields.new_password_field_count.is_zero()
                    && fields.one_time_code_field_count.is_zero()
                    && fields.readonly_password_field_count.is_zero() => {}
            _ => return GoogleLoginFieldStage::Ineligible,
        }
        match fields {
            fields
                if fields.username_field_count.is_single()
                    && fields.current_password_field_count.is_zero()
                    && fields.generic_password_field_count.is_zero()
                    && fields.actionable_password_field_count.is_zero() =>
            {
                self.identifier_stage(workflow)
            }
            fields
                if fields.username_field_count.is_zero()
                    && fields.current_password_field_count.is_single()
                    && fields.generic_password_field_count.is_zero()
                    && fields.actionable_password_field_count.is_single()
                    && self.facts.ceremony.manual_checkpoint
                        == AuthenticationManualCheckpoint::Absent =>
            {
                Self::password_stage(workflow)
            }
            _ => GoogleLoginFieldStage::Ineligible,
        }
    }

    fn password_stage(workflow: AuthenticationWorkflowMatch) -> GoogleLoginFieldStage {
        match workflow {
            AuthenticationWorkflowMatch::NoMatch => GoogleLoginFieldStage::Password,
            AuthenticationWorkflowMatch::Matched(snapshot)
                if snapshot.kind == AuthenticationWorkflowKind::Login
                    && snapshot.stage == AuthenticationWorkflowStage::Credentials =>
            {
                GoogleLoginFieldStage::Password
            }
            AuthenticationWorkflowMatch::Rejected | AuthenticationWorkflowMatch::Matched(_) => {
                GoogleLoginFieldStage::Ineligible
            }
        }
    }

    fn identifier_stage(&self, workflow: AuthenticationWorkflowMatch) -> GoogleLoginFieldStage {
        let AuthenticationDetailedAdvanceControlObservation::Observed(controls) =
            &self.facts.detailed_advance_control
        else {
            return GoogleLoginFieldStage::Ineligible;
        };
        match controls {
            controls
                if controls
                    .iter()
                    .all(|control| control.source_origin == "https://accounts.google.com") => {}
            _ => return GoogleLoginFieldStage::Ineligible,
        }
        let AuthenticationWorkflowMatch::Matched(classified) = workflow else {
            return GoogleLoginFieldStage::Ineligible;
        };
        match classified {
            classified
                if classified.kind == AuthenticationWorkflowKind::Login
                    && classified.stage == AuthenticationWorkflowStage::Credentials
                    && classified.saved_login_capability()
                        == AuthenticationSavedLoginCapability::FillSavedLogin =>
            {
                GoogleLoginFieldStage::Identifier
            }
            _ => GoogleLoginFieldStage::Ineligible,
        }
    }
}

/// In-memory source-document continuation. It retains authorization metadata only.
/// The browser owns its selected opaque item and destroys this owner on pagehide,
/// identifier editing, dismissal, lock, cancellation, or document replacement.
pub struct GoogleTwoStepLoginContinuation {
    authorization_generation: GoogleLoginAuthorizationGeneration,
}

impl GoogleTwoStepLoginContinuation {
    const MAX_ELAPSED: GoogleLoginElapsedMilliseconds = GoogleLoginElapsedMilliseconds(60_000);

    pub fn begin(request: GoogleLoginStartRequest) -> Result<Self, GoogleLoginContinuationError> {
        let GoogleLoginStartRequest {
            observation,
            selection_authority,
        } = request;
        let GoogleLoginSelectionAuthority::DetectedLogin = selection_authority else {
            return Err(GoogleLoginContinuationError::IneligibleSelection);
        };
        let GoogleLoginRoute::Identifier = observation.page_url.route() else {
            return Err(GoogleLoginContinuationError::IneligibleSelection);
        };
        let GoogleLoginFieldStage::Identifier = observation.stage() else {
            return Err(GoogleLoginContinuationError::IneligibleSelection);
        };
        match observation.user_intent {
            GoogleLoginUserIntent::Interrupted => {
                return Err(GoogleLoginContinuationError::IneligibleSelection);
            }
            GoogleLoginUserIntent::Continuing => {}
        }
        match observation.identifier_integrity {
            GoogleLoginIdentifierIntegrity::Edited => {
                return Err(GoogleLoginContinuationError::IneligibleSelection);
            }
            GoogleLoginIdentifierIntegrity::Unchanged => {}
        }
        match observation.password_occupancy {
            GoogleLoginPasswordOccupancy::Populated => {
                return Err(GoogleLoginContinuationError::IneligibleSelection);
            }
            GoogleLoginPasswordOccupancy::Empty => {}
        }
        match observation.elapsed_milliseconds {
            GoogleLoginElapsedMilliseconds(0) => Ok(Self {
                authorization_generation: observation.authorization_generation,
            }),
            GoogleLoginElapsedMilliseconds(_) => {
                Err(GoogleLoginContinuationError::IneligibleSelection)
            }
        }
    }

    #[must_use]
    pub fn inspect(
        &self,
        observation: &GoogleLoginPageObservation,
    ) -> GoogleLoginContinuationDecision {
        match observation.user_intent {
            GoogleLoginUserIntent::Interrupted => return GoogleLoginContinuationDecision::Cancel,
            GoogleLoginUserIntent::Continuing => {}
        }
        match observation.password_occupancy {
            GoogleLoginPasswordOccupancy::Populated => {
                return GoogleLoginContinuationDecision::Cancel;
            }
            GoogleLoginPasswordOccupancy::Empty => {}
        }
        match observation.identifier_integrity {
            GoogleLoginIdentifierIntegrity::Edited => {
                return GoogleLoginContinuationDecision::Cancel;
            }
            GoogleLoginIdentifierIntegrity::Unchanged => {}
        }
        match observation {
            observation
                if observation.authorization_generation == self.authorization_generation
                    && observation.elapsed_milliseconds < Self::MAX_ELAPSED => {}
            _ => return GoogleLoginContinuationDecision::Cancel,
        }
        match observation.page_url.route() {
            GoogleLoginRoute::Unrelated => GoogleLoginContinuationDecision::Cancel,
            GoogleLoginRoute::Identifier => match observation.stage() {
                GoogleLoginFieldStage::Identifier => GoogleLoginContinuationDecision::AwaitPassword,
                GoogleLoginFieldStage::Password | GoogleLoginFieldStage::Ineligible => {
                    GoogleLoginContinuationDecision::Cancel
                }
            },
            GoogleLoginRoute::PasswordChallenge => match observation.stage() {
                GoogleLoginFieldStage::Password => GoogleLoginContinuationDecision::FillPassword,
                GoogleLoginFieldStage::Identifier | GoogleLoginFieldStage::Ineligible => {
                    GoogleLoginContinuationDecision::Cancel
                }
            },
        }
    }

    /// Consume this source-document selection before the fresh reveal and fill.
    /// No submission capability is produced.
    /// ```compile_fail,E0382
    /// use nook_companion_core::credential_fill::GoogleTwoStepLoginContinuation;
    /// use nook_companion_core::credential_fill::GoogleLoginPageObservation;
    /// fn reuse(owner: GoogleTwoStepLoginContinuation, observation: &GoogleLoginPageObservation) {
    ///     let _ = owner.admit_password(observation);
    ///     let _ = owner.admit_password(observation);
    /// }
    /// ```
    pub fn admit_password(
        self,
        observation: &GoogleLoginPageObservation,
    ) -> Result<CredentialKind, GoogleLoginContinuationError> {
        match self.inspect(observation) {
            GoogleLoginContinuationDecision::FillPassword => Ok(CredentialKind::CurrentPassword),
            GoogleLoginContinuationDecision::AwaitPassword
            | GoogleLoginContinuationDecision::Cancel => {
                Err(GoogleLoginContinuationError::PasswordUnavailable)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::CredentialKind;
    use super::*;
    use crate::{
        AuthenticationAdvanceControlObservation, AuthenticationAuthenticatorSetupObservation,
        AuthenticationCredentialSubmissionObservation,
        AuthenticationDetailedAdvanceControlObservation, AuthenticationFieldObservationFacts,
        AuthenticationManualCheckpoint, AuthenticationUsernameEvidence, PageControlActionability,
        PageControlOwnership, PageControlSemantics, PageControlSubmissionDestinationSource,
        PageControlSubmissionMethod,
    };

    struct GoogleLoginFixture;

    impl GoogleLoginFixture {
        fn observation() -> anyhow::Result<GoogleLoginPageObservation> {
            let facts = AuthenticationPageObservationFacts {
                fields: AuthenticationFieldObservationFacts {
                    username_field_count: 1.into(),
                    ..Default::default()
                },
                detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::observed(
                    AuthenticationAdvanceControlObservation {
                        actionability: PageControlActionability::Actionable,
                        ownership: PageControlOwnership::LocallyScoped,
                        semantics: PageControlSemantics::Activation,
                        authentication_username: AuthenticationUsernameEvidence::Explicit,
                        password_field_count: 0.into(),
                        new_password_field_count: 0.into(),
                        one_time_code_field_count: 0.into(),
                        semantic_submit_control_count: 0.into(),
                        source_origin: "https://accounts.google.com".into(),
                        form_identity: "signin-view".into(),
                        destination_identity: "https://accounts.google.com/v3/signin/identifier"
                            .into(),
                        label: "Next".into(),
                        machine_identity: "identifierNext =".into(),
                        submission_method: PageControlSubmissionMethod::Absent,
                        submission_destination_source:
                            PageControlSubmissionDestinationSource::Omitted,
                    },
                ),
                ..Default::default()
            };
            Ok(GoogleLoginPageObservation {
                page_url: "https://accounts.google.com/v3/signin/identifier?flowName=GlifWebSignIn"
                    .to_owned()
                    .try_into()?,
                authorization_generation: "generation-a".to_owned().try_into()?,
                elapsed_milliseconds: 0.into(),
                identifier_integrity: GoogleLoginIdentifierIntegrity::Unchanged,
                user_intent: GoogleLoginUserIntent::Continuing,
                password_occupancy: GoogleLoginPasswordOccupancy::Empty,
                facts,
            })
        }

        fn password() -> anyhow::Result<GoogleLoginPageObservation> {
            Ok(GoogleLoginPageObservation {
                page_url: "https://accounts.google.com/v3/signin/challenge/pwd"
                    .to_owned()
                    .try_into()?,
                authorization_generation: "generation-a".to_owned().try_into()?,
                elapsed_milliseconds: 1_000.into(),
                identifier_integrity: GoogleLoginIdentifierIntegrity::Unchanged,
                user_intent: GoogleLoginUserIntent::Continuing,
                password_occupancy: GoogleLoginPasswordOccupancy::Empty,
                facts: AuthenticationPageObservationFacts {
                    fields: AuthenticationFieldObservationFacts {
                        username_field_count: 0.into(),
                        current_password_field_count: 1.into(),
                        actionable_password_field_count: 1.into(),
                        ..Default::default()
                    },
                    detailed_advance_control:
                        AuthenticationDetailedAdvanceControlObservation::Absent,
                    ..Default::default()
                },
            })
        }
    }

    #[test]
    fn selection_allows_manual_next_and_one_password_fill_without_submission() -> anyhow::Result<()>
    {
        let identifier = GoogleLoginFixture::observation()?;
        let continuation = GoogleTwoStepLoginContinuation::begin(GoogleLoginStartRequest {
            observation: identifier.clone(),
            selection_authority: GoogleLoginSelectionAuthority::DetectedLogin,
        })?;
        assert_eq!(
            continuation.inspect(&identifier),
            GoogleLoginContinuationDecision::AwaitPassword
        );
        let challenge = GoogleLoginFixture::password()?;
        assert_eq!(
            continuation.inspect(&challenge),
            GoogleLoginContinuationDecision::FillPassword
        );
        assert_eq!(
            continuation.admit_password(&challenge)?,
            CredentialKind::CurrentPassword
        );
        Ok(())
    }

    #[test]
    fn focused_selection_and_non_google_starts_have_no_continuation() -> anyhow::Result<()> {
        let observation = GoogleLoginFixture::observation()?;
        assert!(matches!(
            GoogleTwoStepLoginContinuation::begin(GoogleLoginStartRequest {
                observation: observation.clone(),
                selection_authority: GoogleLoginSelectionAuthority::FocusedField,
            }),
            Err(GoogleLoginContinuationError::IneligibleSelection)
        ));
        for url in [
            "http://accounts.google.com/v3/signin/identifier",
            "https://accounts.google.com.evil.test/v3/signin/identifier",
            "https://accounts.google.com:444/v3/signin/identifier",
            "https://accounts.google.com/signup",
            "https://other.test/v3/signin/identifier",
        ] {
            let mut changed = observation.clone();
            changed.page_url = url.to_owned().try_into()?;
            assert!(matches!(
                GoogleTwoStepLoginContinuation::begin(GoogleLoginStartRequest {
                    observation: changed,
                    selection_authority: GoogleLoginSelectionAuthority::DetectedLogin,
                }),
                Err(GoogleLoginContinuationError::IneligibleSelection)
            ));
        }
        Ok(())
    }

    #[test]
    fn edited_identifier_generation_drift_and_timeout_cancel_password_disclosure()
    -> anyhow::Result<()> {
        for change in [
            GoogleLoginCancellation::Edited,
            GoogleLoginCancellation::Generation,
            GoogleLoginCancellation::Expired,
            GoogleLoginCancellation::Origin,
        ] {
            let continuation = GoogleTwoStepLoginContinuation::begin(GoogleLoginStartRequest {
                observation: GoogleLoginFixture::observation()?,
                selection_authority: GoogleLoginSelectionAuthority::DetectedLogin,
            })?;
            let mut challenge = GoogleLoginFixture::password()?;
            match change {
                GoogleLoginCancellation::Edited => {
                    challenge.identifier_integrity = GoogleLoginIdentifierIntegrity::Edited;
                }
                GoogleLoginCancellation::Generation => {
                    challenge.authorization_generation = "generation-b".to_owned().try_into()?;
                }
                GoogleLoginCancellation::Expired => challenge.elapsed_milliseconds = 60_000.into(),
                GoogleLoginCancellation::Origin => {
                    challenge.page_url = "https://other.test/v3/signin/challenge/pwd"
                        .to_owned()
                        .try_into()?;
                }
            }
            assert_eq!(
                continuation.inspect(&challenge),
                GoogleLoginContinuationDecision::Cancel
            );
            assert_eq!(
                continuation.admit_password(&challenge),
                Err(GoogleLoginContinuationError::PasswordUnavailable)
            );
        }
        Ok(())
    }

    #[test]
    fn identifier_control_evidence_must_belong_to_google_source_origin() -> anyhow::Result<()> {
        let observation = GoogleLoginFixture::observation()?;
        let expected_fields = observation.facts.fields;
        let expected_ceremony = observation.facts.ceremony.clone();
        let AuthenticationDetailedAdvanceControlObservation::Observed(controls) =
            observation.facts.detailed_advance_control
        else {
            return Err(anyhow::anyhow!(
                "identifier fixture must have observed controls"
            ));
        };
        let controls = controls
            .into_iter()
            .map(|control| AuthenticationAdvanceControlObservation {
                source_origin: "https://other.test".into(),
                destination_identity: "https://other.test/v3/signin/identifier".into(),
                ..control
            })
            .collect();
        let observation = GoogleLoginPageObservation {
            facts: AuthenticationPageObservationFacts {
                detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::Observed(
                    controls,
                ),
                ..observation.facts
            },
            ..observation
        };
        assert_eq!(observation.facts.fields, expected_fields);
        assert_eq!(observation.facts.ceremony, expected_ceremony);
        assert!(matches!(
            GoogleTwoStepLoginContinuation::begin(GoogleLoginStartRequest {
                observation,
                selection_authority: GoogleLoginSelectionAuthority::DetectedLogin,
            }),
            Err(GoogleLoginContinuationError::IneligibleSelection)
        ));
        Ok(())
    }

    enum GoogleLoginCancellation {
        Edited,
        Generation,
        Expired,
        Origin,
    }

    #[test]
    fn changed_password_roles_and_malformed_fact_counts_are_rejected() -> anyhow::Result<()> {
        let identifier = GoogleLoginFixture::observation()?;
        let continuation = GoogleTwoStepLoginContinuation::begin(GoogleLoginStartRequest {
            observation: identifier,
            selection_authority: GoogleLoginSelectionAuthority::DetectedLogin,
        })?;
        let challenge = GoogleLoginFixture::password()?;
        let mut new_password = challenge.clone();
        new_password.facts.fields.new_password_field_count = 1.into();
        let mut otp = challenge.clone();
        otp.facts.fields.one_time_code_field_count = 1.into();
        let mut multiple = challenge.clone();
        multiple.facts.fields.current_password_field_count = 2.into();
        let mut readonly = challenge.clone();
        readonly.facts.fields.readonly_password_field_count = 1.into();
        let mut recovery = challenge;
        recovery.facts.ceremony.manual_checkpoint = AuthenticationManualCheckpoint::Present;
        for observation in [new_password, otp, multiple, readonly, recovery] {
            assert_eq!(
                continuation.inspect(&observation),
                GoogleLoginContinuationDecision::Cancel
            );
        }
        Ok(())
    }

    #[test]
    fn manual_next_is_bounded_and_interrupted_or_populated_challenges_cancel() -> anyhow::Result<()>
    {
        let continuation = GoogleTwoStepLoginContinuation::begin(GoogleLoginStartRequest {
            observation: GoogleLoginFixture::observation()?,
            selection_authority: GoogleLoginSelectionAuthority::DetectedLogin,
        })?;
        let mut challenge = GoogleLoginFixture::password()?;
        challenge.elapsed_milliseconds = 59_999.into();
        assert_eq!(
            continuation.inspect(&challenge),
            GoogleLoginContinuationDecision::FillPassword
        );
        challenge.user_intent = GoogleLoginUserIntent::Interrupted;
        assert_eq!(
            continuation.inspect(&challenge),
            GoogleLoginContinuationDecision::Cancel
        );
        challenge.user_intent = GoogleLoginUserIntent::Continuing;
        challenge.password_occupancy = GoogleLoginPasswordOccupancy::Populated;
        assert_eq!(
            continuation.inspect(&challenge),
            GoogleLoginContinuationDecision::Cancel
        );
        assert_eq!(
            continuation.admit_password(&challenge),
            Err(GoogleLoginContinuationError::PasswordUnavailable)
        );
        Ok(())
    }

    #[test]
    fn password_admission_does_not_depend_on_generic_submit_classification() -> anyhow::Result<()> {
        let continuation = GoogleTwoStepLoginContinuation::begin(GoogleLoginStartRequest {
            observation: GoogleLoginFixture::observation()?,
            selection_authority: GoogleLoginSelectionAuthority::DetectedLogin,
        })?;
        let mut challenge = GoogleLoginFixture::password()?;
        assert_eq!(
            (AuthenticationPageObservationFactsBatch {
                observations: vec![challenge.facts.clone()],
            })
            .classify(),
            AuthenticationWorkflowMatch::NoMatch
        );
        assert!(matches!(
            challenge.facts.credential_submission,
            AuthenticationCredentialSubmissionObservation::Absent
        ));
        assert_eq!(
            continuation.inspect(&challenge),
            GoogleLoginContinuationDecision::FillPassword
        );
        for route in [
            "/v3/signin/challenge/otp",
            "/v3/signin/recovery",
            "/v3/signin/identifier",
            "/v3/signin/challenge/pwd/other",
        ] {
            challenge.page_url = format!("https://accounts.google.com{route}").try_into()?;
            assert_eq!(
                continuation.inspect(&challenge),
                GoogleLoginContinuationDecision::Cancel
            );
        }
        Ok(())
    }

    #[test]
    fn current_facts_reject_malformed_manual_and_alternative_ceremonies() -> anyhow::Result<()> {
        let identifier = GoogleLoginFixture::observation()?;
        let continuation = GoogleTwoStepLoginContinuation::begin(GoogleLoginStartRequest {
            observation: identifier.clone(),
            selection_authority: GoogleLoginSelectionAuthority::DetectedLogin,
        })?;
        for observation in [identifier, GoogleLoginFixture::password()?] {
            let mut malformed = observation.clone();
            malformed.facts.ceremony.one_time_code_handler_signal =
                "x".repeat(crate::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES + 1);
            assert_eq!(
                (AuthenticationPageObservationFactsBatch {
                    observations: vec![malformed.facts.clone()],
                })
                .classify(),
                AuthenticationWorkflowMatch::Rejected
            );
            let mut manual = observation.clone();
            manual.facts.ceremony.manual_checkpoint = AuthenticationManualCheckpoint::Present;
            assert!(matches!(
                (AuthenticationPageObservationFactsBatch {
                    observations: vec![manual.facts.clone()],
                })
                .classify(),
                AuthenticationWorkflowMatch::Matched(snapshot)
                    if snapshot.stage == AuthenticationWorkflowStage::Manual
            ));
            let mut setup = observation.clone();
            setup.facts.authenticator.authenticator_setup =
                AuthenticationAuthenticatorSetupObservation::Present;
            let mut recovery = observation;
            recovery.facts.authenticator.backup_codes_copy =
                "Save your backup codes in a secure place".into();
            for alternative in [&setup, &recovery] {
                assert!(matches!(
                    (AuthenticationPageObservationFactsBatch {
                        observations: vec![alternative.facts.clone()],
                    })
                    .classify(),
                    AuthenticationWorkflowMatch::Matched(snapshot)
                        if snapshot.kind == AuthenticationWorkflowKind::TotpEnrollment
                ));
            }
            for rejected in [malformed, manual, setup, recovery] {
                assert_eq!(
                    continuation.inspect(&rejected),
                    GoogleLoginContinuationDecision::Cancel
                );
                assert!(matches!(
                    GoogleTwoStepLoginContinuation::begin(GoogleLoginStartRequest {
                        observation: rejected.clone(),
                        selection_authority: GoogleLoginSelectionAuthority::DetectedLogin,
                    }),
                    Err(GoogleLoginContinuationError::IneligibleSelection)
                ));
                let owner = GoogleTwoStepLoginContinuation::begin(GoogleLoginStartRequest {
                    observation: GoogleLoginFixture::observation()?,
                    selection_authority: GoogleLoginSelectionAuthority::DetectedLogin,
                })?;
                assert_eq!(
                    owner.admit_password(&rejected),
                    Err(GoogleLoginContinuationError::PasswordUnavailable)
                );
            }
        }
        Ok(())
    }

    #[test]
    fn start_rechecks_whole_page_evidence_and_metadata_decoding_is_validated() -> anyhow::Result<()>
    {
        let mut identifier = GoogleLoginFixture::observation()?;
        identifier.facts.detailed_advance_control =
            AuthenticationDetailedAdvanceControlObservation::Absent;
        assert!(matches!(
            GoogleTwoStepLoginContinuation::begin(GoogleLoginStartRequest {
                observation: identifier,
                selection_authority: GoogleLoginSelectionAuthority::DetectedLogin,
            }),
            Err(GoogleLoginContinuationError::IneligibleSelection)
        ));
        let observation = GoogleLoginFixture::observation()?;
        let request = GoogleLoginStartRequest {
            observation,
            selection_authority: GoogleLoginSelectionAuthority::DetectedLogin,
        };
        let wire = serde_json::to_string(&request)?;
        assert_eq!(
            serde_json::from_str::<GoogleLoginStartRequest>(&wire)?,
            request
        );
        assert!(serde_json::from_str::<GoogleLoginAuthorizationGeneration>("\"\"").is_err());
        assert!(serde_json::from_str::<GoogleLoginPageUrl>("\"not a URL\"").is_err());
        assert_eq!(
            GoogleLoginAuthorizationGeneration::try_from(String::new()),
            Err(GoogleLoginContinuationError::InvalidObservation)
        );
        assert_eq!(
            GoogleLoginPageUrl::try_from("not a URL".to_owned()),
            Err(GoogleLoginContinuationError::InvalidObservation)
        );
        assert_eq!(
            GoogleLoginPageUrl::try_from(
                "https://account:secret@accounts.google.com/v3/signin/identifier".to_owned()
            ),
            Err(GoogleLoginContinuationError::InvalidObservation)
        );
        assert_eq!(
            GoogleLoginPageUrl::try_from(
                "https://accounts.google.com/v3/signin/identifier#changed".to_owned()
            ),
            Err(GoogleLoginContinuationError::InvalidObservation)
        );
        assert_eq!(
            GoogleLoginAuthorizationGeneration::try_from("x".repeat(513)),
            Err(GoogleLoginContinuationError::InvalidObservation)
        );
        assert_eq!(
            GoogleLoginPageUrl::try_from(
                "x".repeat(crate::MAX_AUTHENTICATION_DESTINATION_TEXT_BYTES + 1)
            ),
            Err(GoogleLoginContinuationError::InvalidObservation)
        );
        Ok(())
    }
}
