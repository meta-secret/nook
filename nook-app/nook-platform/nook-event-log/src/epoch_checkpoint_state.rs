//! The password and metadata state an epoch checkpoint carries into the new
//! epoch.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::PasswordUnlockEntry;
use nook_auth2::StoredSecretRecord;
use serde::ser::Error as _;
use serde::{Deserialize, Serialize};

/// Checkpoint password replacement. Omitted legacy fields retain the previous
/// password entries, while an explicit empty array clears them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(from = "Vec<PasswordUnlockEntry>")]
pub enum EpochPasswordState {
    #[default]
    LegacyRetain,
    Replace(Vec<PasswordUnlockEntry>),
}

/// Checkpoint metadata replacement. Omitted legacy fields retain the previous
/// metadata, while an explicit empty array clears every metadata record.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(from = "Vec<StoredSecretRecord>")]
pub enum EpochMetadataState {
    #[default]
    LegacyRetain,
    Replace(Vec<StoredSecretRecord>),
}

impl EpochMetadataState {
    pub(crate) fn is_legacy_retain(&self) -> bool {
        matches!(self, Self::LegacyRetain)
    }
}

impl From<Vec<StoredSecretRecord>> for EpochMetadataState {
    fn from(values: Vec<StoredSecretRecord>) -> Self {
        Self::Replace(values)
    }
}

impl EpochMetadataState {
    pub(crate) fn serialize_epoch_metadata_state<S>(
        state: &EpochMetadataState,
        serializer: S,
    ) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match state {
            EpochMetadataState::Replace(records) => records.serialize(serializer),
            EpochMetadataState::LegacyRetain => Err(S::Error::custom(
                "legacy checkpoint metadata state must be omitted",
            )),
        }
    }
}

impl EpochPasswordState {
    pub(crate) fn is_legacy_retain(&self) -> bool {
        matches!(self, Self::LegacyRetain)
    }
}

impl From<Vec<PasswordUnlockEntry>> for EpochPasswordState {
    fn from(values: Vec<PasswordUnlockEntry>) -> Self {
        Self::Replace(values)
    }
}

impl EpochPasswordState {
    pub(crate) fn serialize_epoch_password_state<S>(
        state: &EpochPasswordState,
        serializer: S,
    ) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match state {
            EpochPasswordState::Replace(entries) => entries.serialize(serializer),
            EpochPasswordState::LegacyRetain => Err(S::Error::custom(
                "legacy checkpoint password state must be omitted",
            )),
        }
    }
}
