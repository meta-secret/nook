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
#[derive(Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub(crate) enum MediaType {
    Declared(String),
    #[default]
    Unreported,
}
#[derive(Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub(crate) enum AppendPermission {
    Reported(bool),
    #[default]
    Unreported,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderCapabilities {
    #[serde(default)]
    pub(crate) can_add_children: AppendPermission,
}
#[derive(Default, Deserialize)]
#[serde(untagged)]
pub(crate) enum CapabilityReport {
    Reported(FolderCapabilities),
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
