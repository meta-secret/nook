use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionConnectScope {
    VaultAccess,
    PasswordFilling,
    PasskeyManagement,
    SyncProviderCredentials,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("unsupported extension connection scope")]
pub struct UnknownExtensionConnectScope;

impl ExtensionConnectScope {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::VaultAccess => "vault-access",
            Self::PasswordFilling => "password-filling",
            Self::PasskeyManagement => "passkey-management",
            Self::SyncProviderCredentials => "sync-provider-credentials",
        }
    }

    pub fn parse(value: &str) -> Result<Self, UnknownExtensionConnectScope> {
        match value {
            "vault-access" => Ok(Self::VaultAccess),
            "password-filling" => Ok(Self::PasswordFilling),
            "passkey-management" => Ok(Self::PasskeyManagement),
            "sync-provider-credentials" => Ok(Self::SyncProviderCredentials),
            _ => Err(UnknownExtensionConnectScope),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionPairingVaultType {
    Simple,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("unsupported extension pairing vault type")]
pub struct UnknownExtensionPairingVaultType;

impl ExtensionPairingVaultType {
    pub fn parse(value: &str) -> Result<Self, UnknownExtensionPairingVaultType> {
        match value {
            "simple" => Ok(Self::Simple),
            _ => Err(UnknownExtensionPairingVaultType),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_parser_matches_serialized_vocabulary() {
        let scopes = [
            ExtensionConnectScope::VaultAccess,
            ExtensionConnectScope::PasswordFilling,
            ExtensionConnectScope::PasskeyManagement,
            ExtensionConnectScope::SyncProviderCredentials,
        ];
        for scope in scopes {
            assert_eq!(ExtensionConnectScope::parse(scope.as_str()), Ok(scope));
        }
        assert_eq!(
            ExtensionConnectScope::parse("external-value"),
            Err(UnknownExtensionConnectScope)
        );
    }

    #[test]
    fn pairing_vault_type_parser_admits_only_the_extension_vocabulary() {
        assert_eq!(
            ExtensionPairingVaultType::parse("simple"),
            Ok(ExtensionPairingVaultType::Simple)
        );
        assert_eq!(
            ExtensionPairingVaultType::parse("sentinel"),
            Err(UnknownExtensionPairingVaultType)
        );
        assert_eq!(
            ExtensionPairingVaultType::parse("external-value"),
            Err(UnknownExtensionPairingVaultType)
        );
    }
}
