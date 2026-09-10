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

impl Serialize for PendingSimpleGenesis {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeMap;
        let mut fields = serializer.serialize_map(None)?;
        fields.serialize_entry("storeId", &self.store_id)?;
        fields.serialize_entry("identityId", &self.identity_id)?;
        fields.serialize_entry("createdAt", &self.created_at)?;
        fields.serialize_entry("eventState", &self.event_state)?;
        fields.serialize_entry("flow", &self.flow)?;
        if let PendingSimpleGenesisFlow::Staged(identity) = &self.flow {
            fields.serialize_entry("stagedIdentity", identity)?;
        }
        fields.end()
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
}
