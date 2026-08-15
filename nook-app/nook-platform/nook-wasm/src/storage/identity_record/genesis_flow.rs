//! Explicit lifecycle states for ordinary and staged Simple-vault genesis.

use super::{
    simple_genesis::{PendingSimpleGenesis, PendingSimpleGenesisEvent},
    staged_genesis::StagedSimpleGenesisIdentity,
};
use serde::Serialize;

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(tag = "kind", content = "identity", rename_all = "kebab-case")]
pub(crate) enum PendingSimpleGenesisFlow {
    Ordinary,
    Staged(StagedSimpleGenesisIdentity),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingSimpleGenesisOutput<'a> {
    store_id: &'a nook_core::StoreId,
    identity_id: &'a nook_core::IdentityId,
    created_at: &'a nook_core::IsoTimestamp,
    event_state: &'a PendingSimpleGenesisEvent,
    flow: &'a PendingSimpleGenesisFlow,
    #[serde(skip_serializing_if = "Option::is_none")]
    staged_identity: Option<&'a StagedSimpleGenesisIdentity>,
}

impl Serialize for PendingSimpleGenesis {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        PendingSimpleGenesisOutput {
            store_id: &self.store_id,
            identity_id: &self.identity_id,
            created_at: &self.created_at,
            event_state: &self.event_state,
            flow: &self.flow,
            staged_identity: self.staged_identity(),
        }
        .serialize(serializer)
    }
}

pub(crate) enum SimpleGenesisCompletion<'a> {
    Ordinary {
        pending: &'a PendingSimpleGenesis,
    },
    Staged {
        pending: &'a PendingSimpleGenesis,
        signing_seed: &'a str,
    },
}

impl SimpleGenesisCompletion<'_> {
    pub(super) fn pending(&self) -> &PendingSimpleGenesis {
        match self {
            Self::Ordinary { pending } | Self::Staged { pending, .. } => pending,
        }
    }

    pub(super) fn staged_signing_seed(&self) -> Option<&str> {
        match self {
            Self::Ordinary { .. } => None,
            Self::Staged { signing_seed, .. } => Some(signing_seed),
        }
    }
}
