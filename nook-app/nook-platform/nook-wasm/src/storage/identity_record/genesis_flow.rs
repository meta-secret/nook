//! Explicit lifecycle states for ordinary and staged Simple-vault genesis.

use super::{simple_genesis::PendingSimpleGenesis, staged_genesis::StagedSimpleGenesisIdentity};

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(tag = "kind", content = "identity", rename_all = "kebab-case")]
pub(crate) enum PendingSimpleGenesisFlow {
    Ordinary,
    Staged(StagedSimpleGenesisIdentity),
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
