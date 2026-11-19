//! Read-only keyring details sent to the picker by the same build that
//! consumes them. They do not change stored events or require a migration.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_auth2::MemberLabel;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::{
    AppId, CredentialCheckReport, FilingIdentity, IdentityControlMember, KnownVaultName,
    ListedIdentityLog, ProviderVaultName, ProviderVaultSummary, StoreId, VaultCheckOutcome,
};

/// A keyring discovered from its control log. Vault namespaces retain
/// lightweight filing identities, rather than repeating each keyring's roster.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub struct ProviderListedIdentity {
    pub identity: FilingIdentity,
    pub details: ProviderKeyringDetails,
}

/// The verified device and vault links. A namespace without a control log
/// can name a vault it files but cannot establish the device roster.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify, Default)]
pub struct ProviderKeyringDetails {
    pub devices: ProviderKeyringDevices,
    pub vaults: Vec<ProviderKeyringVault>,
}

impl ProviderKeyringDetails {
    pub(crate) fn from_log(log: &ListedIdentityLog, names: &[KnownVaultName]) -> Self {
        Self {
            devices: log.devices.clone(),
            vaults: log
                .registered_vaults
                .iter()
                .map(|store_id| ProviderKeyringVault {
                    store_id: store_id.clone(),
                    name: ProviderVaultName::of(store_id, names),
                })
                .collect(),
        }
    }

    pub(crate) fn from_namespaces(vaults: &[ProviderVaultSummary]) -> Self {
        Self {
            devices: ProviderKeyringDevices::Unavailable,
            vaults: vaults.iter().map(ProviderKeyringVault::from).collect(),
        }
    }
}

/// The distinction between a verified roster and a missing control log.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify, Default)]
#[serde(tag = "state")]
pub enum ProviderKeyringDevices {
    #[default]
    Unavailable,
    Listed {
        devices: Vec<ProviderKeyringDevice>,
    },
}

/// An active device, represented by the app key that brought it to the
/// keyring. Its id and label are read from the signed member record.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub struct ProviderKeyringDevice {
    #[tsify(type = "string")]
    pub app_id: AppId,
    #[tsify(type = "string")]
    pub label: MemberLabel,
}

impl From<&IdentityControlMember> for ProviderKeyringDevice {
    fn from(member: &IdentityControlMember) -> Self {
        Self {
            app_id: member.keys.app_id.clone(),
            label: MemberLabel::from_trusted(member.keys.label.as_str().trim().to_owned()),
        }
    }
}

/// A vault link with a local or decrypted label, when known.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub struct ProviderKeyringVault {
    pub store_id: StoreId,
    pub name: ProviderVaultName,
}

impl From<&ProviderVaultSummary> for ProviderKeyringVault {
    fn from(vault: &ProviderVaultSummary) -> Self {
        Self {
            store_id: vault.store_id.clone(),
            name: vault.name.clone(),
        }
    }
}

pub(crate) struct ProviderVaultNameLookup<'a> {
    pub(crate) store_id: &'a StoreId,
    pub(crate) name: &'a ProviderVaultName,
}

impl ProviderVaultNameLookup<'_> {
    /// Keep a locally known name, otherwise use a check that opened this vault.
    pub(crate) fn after_checks(self, checks: &[CredentialCheckReport]) -> ProviderVaultName {
        match self.name {
            ProviderVaultName::Named { .. } => self.name.clone(),
            ProviderVaultName::Unknown => checks
                .iter()
                .flat_map(|report| &report.identities)
                .flat_map(|identity| &identity.vaults)
                .filter(|vault| &vault.store_id == self.store_id)
                .find_map(|vault| match &vault.outcome {
                    VaultCheckOutcome::Opens {
                        name: name @ ProviderVaultName::Named { .. },
                    } => Some(name.clone()),
                    VaultCheckOutcome::Opens {
                        name: ProviderVaultName::Unknown,
                    }
                    | VaultCheckOutcome::DoesNotOpen => None,
                })
                .unwrap_or(ProviderVaultName::Unknown),
        }
    }
}
