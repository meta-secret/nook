//! Drive's nullable metadata observations, before operation-specific admission.
use serde::Deserialize;

#[derive(Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub(crate) enum FileIdentity {
    Reported(String),
    #[default]
    Unreported,
}
#[derive(Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub(crate) enum FileName {
    Reported(String),
    #[default]
    Unreported,
}
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub(crate) enum PageCompletion {
    Continue(String),
    #[default]
    Complete,
}
