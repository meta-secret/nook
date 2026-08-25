//! Stable browser-companion vocabulary for authentication workflows.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationWorkflowKind {
    Login,
    Signup,
    PasswordChange,
    TotpChallenge,
    TotpEnrollment,
    Manual,
}

impl AuthenticationWorkflowKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Login => "login",
            Self::Signup => "signup",
            Self::PasswordChange => "password-change",
            Self::TotpChallenge => "totp-challenge",
            Self::TotpEnrollment => "totp-enrollment",
            Self::Manual => "manual",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationWorkflowStage {
    Credentials,
    SecondFactor,
    Verification,
    Setup,
    Recovery,
    Manual,
}

impl AuthenticationWorkflowStage {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Credentials => "credentials",
            Self::SecondFactor => "second-factor",
            Self::Verification => "verification",
            Self::Setup => "setup",
            Self::Recovery => "recovery",
            Self::Manual => "manual",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationWorkflowAction {
    ContinueWithNook,
    GeneratePassword,
    FillTotp,
    EnrollAuthenticator,
    UsePasskey,
    CreatePasskey,
    TakeOver,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationSavedLoginCapability {
    Unavailable,
    FillSavedLogin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationPilotPresentationCapability {
    Hidden,
    ProposeAction,
}

impl AuthenticationWorkflowAction {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ContinueWithNook => "continue-with-nook",
            Self::GeneratePassword => "generate-password",
            Self::FillTotp => "fill-totp",
            Self::EnrollAuthenticator => "enroll-authenticator",
            Self::UsePasskey => "use-passkey",
            Self::CreatePasskey => "create-passkey",
            Self::TakeOver => "take-over",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_semantic_roundtrip<T>(values: &[(T, &str)]) -> anyhow::Result<()>
    where
        T: Copy + PartialEq + std::fmt::Debug + Serialize + for<'de> Deserialize<'de>,
    {
        for (value, expected) in values {
            let serialized = serde_json::to_string(value)?;
            assert_eq!(serialized, format!("\"{expected}\""));
            assert_eq!(serde_json::from_str::<T>(&serialized)?, *value);
        }
        Ok(())
    }

    #[test]
    fn workflow_vocabulary_roundtrips_semantic_variants() -> anyhow::Result<()> {
        assert_semantic_roundtrip(&[
            (AuthenticationWorkflowKind::Login, "login"),
            (AuthenticationWorkflowKind::Signup, "signup"),
            (
                AuthenticationWorkflowKind::PasswordChange,
                "password-change",
            ),
            (AuthenticationWorkflowKind::TotpChallenge, "totp-challenge"),
            (
                AuthenticationWorkflowKind::TotpEnrollment,
                "totp-enrollment",
            ),
            (AuthenticationWorkflowKind::Manual, "manual"),
        ])?;
        assert_semantic_roundtrip(&[
            (AuthenticationWorkflowStage::Credentials, "credentials"),
            (AuthenticationWorkflowStage::SecondFactor, "second-factor"),
            (AuthenticationWorkflowStage::Verification, "verification"),
            (AuthenticationWorkflowStage::Setup, "setup"),
            (AuthenticationWorkflowStage::Recovery, "recovery"),
            (AuthenticationWorkflowStage::Manual, "manual"),
        ])?;
        assert_semantic_roundtrip(&[
            (
                AuthenticationWorkflowAction::ContinueWithNook,
                "continue-with-nook",
            ),
            (
                AuthenticationWorkflowAction::GeneratePassword,
                "generate-password",
            ),
            (AuthenticationWorkflowAction::FillTotp, "fill-totp"),
            (
                AuthenticationWorkflowAction::EnrollAuthenticator,
                "enroll-authenticator",
            ),
            (AuthenticationWorkflowAction::UsePasskey, "use-passkey"),
            (
                AuthenticationWorkflowAction::CreatePasskey,
                "create-passkey",
            ),
            (AuthenticationWorkflowAction::TakeOver, "take-over"),
        ])?;
        assert_semantic_roundtrip(&[
            (
                AuthenticationSavedLoginCapability::Unavailable,
                "unavailable",
            ),
            (
                AuthenticationSavedLoginCapability::FillSavedLogin,
                "fill-saved-login",
            ),
        ])?;
        assert_semantic_roundtrip(&[
            (AuthenticationPilotPresentationCapability::Hidden, "hidden"),
            (
                AuthenticationPilotPresentationCapability::ProposeAction,
                "propose-action",
            ),
        ])
    }
}
