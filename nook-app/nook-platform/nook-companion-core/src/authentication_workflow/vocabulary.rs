//! Stable browser-companion vocabulary for authentication workflows.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

impl Serialize for AuthenticationWorkflowKind {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u32(*self as u32)
    }
}

impl<'de> Deserialize<'de> for AuthenticationWorkflowKind {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        match u32::deserialize(deserializer)? {
            0 => Ok(Self::Login),
            1 => Ok(Self::Signup),
            2 => Ok(Self::PasswordChange),
            3 => Ok(Self::TotpChallenge),
            4 => Ok(Self::TotpEnrollment),
            5 => Ok(Self::Manual),
            value => Err(serde::de::Error::custom(format!(
                "invalid authentication workflow kind: {value}"
            ))),
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

impl Serialize for AuthenticationWorkflowStage {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u32(*self as u32)
    }
}

impl<'de> Deserialize<'de> for AuthenticationWorkflowStage {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        match u32::deserialize(deserializer)? {
            0 => Ok(Self::Credentials),
            1 => Ok(Self::SecondFactor),
            2 => Ok(Self::Verification),
            3 => Ok(Self::Setup),
            4 => Ok(Self::Recovery),
            5 => Ok(Self::Manual),
            value => Err(serde::de::Error::custom(format!(
                "invalid authentication workflow stage: {value}"
            ))),
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticationWorkflowAction {
    ContinueWithNook,
    GeneratePassword,
    FillTotp,
    EnrollAuthenticator,
    UsePasskey,
    CreatePasskey,
    TakeOver,
}

impl Serialize for AuthenticationWorkflowAction {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u32(*self as u32)
    }
}

impl<'de> Deserialize<'de> for AuthenticationWorkflowAction {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        match u32::deserialize(deserializer)? {
            0 => Ok(Self::ContinueWithNook),
            1 => Ok(Self::GeneratePassword),
            2 => Ok(Self::FillTotp),
            3 => Ok(Self::EnrollAuthenticator),
            4 => Ok(Self::UsePasskey),
            5 => Ok(Self::CreatePasskey),
            6 => Ok(Self::TakeOver),
            value => Err(serde::de::Error::custom(format!(
                "invalid authentication workflow action: {value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationSavedLoginCapability {
    Unavailable,
    FillSavedLogin,
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

    fn assert_numeric_roundtrip<T>(values: &[T]) -> anyhow::Result<()>
    where
        T: Copy + PartialEq + std::fmt::Debug + Serialize + for<'de> Deserialize<'de>,
    {
        for (expected, value) in values.iter().copied().enumerate() {
            let serialized = serde_json::to_string(&value)?;
            assert_eq!(serialized, expected.to_string());
            assert_eq!(serde_json::from_str::<T>(&serialized)?, value);
        }
        Ok(())
    }

    #[test]
    fn workflow_vocabulary_roundtrips_generated_numeric_values() -> anyhow::Result<()> {
        assert_numeric_roundtrip(&[
            AuthenticationWorkflowKind::Login,
            AuthenticationWorkflowKind::Signup,
            AuthenticationWorkflowKind::PasswordChange,
            AuthenticationWorkflowKind::TotpChallenge,
            AuthenticationWorkflowKind::TotpEnrollment,
            AuthenticationWorkflowKind::Manual,
        ])?;
        assert_numeric_roundtrip(&[
            AuthenticationWorkflowStage::Credentials,
            AuthenticationWorkflowStage::SecondFactor,
            AuthenticationWorkflowStage::Verification,
            AuthenticationWorkflowStage::Setup,
            AuthenticationWorkflowStage::Recovery,
            AuthenticationWorkflowStage::Manual,
        ])?;
        assert_numeric_roundtrip(&[
            AuthenticationWorkflowAction::ContinueWithNook,
            AuthenticationWorkflowAction::GeneratePassword,
            AuthenticationWorkflowAction::FillTotp,
            AuthenticationWorkflowAction::EnrollAuthenticator,
            AuthenticationWorkflowAction::UsePasskey,
            AuthenticationWorkflowAction::CreatePasskey,
            AuthenticationWorkflowAction::TakeOver,
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
        ])
    }

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
}
