use super::{ValidationError, ValidationResult, VaultType, wasm_bindgen};
use serde::{Deserialize, Serialize};

/// User intent at the boundary where a sync provider is first connected.
///
/// An empty provider may become a backup target for a vault the user is
/// creating, but it must never satisfy an explicit request to open a vault
/// that already exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultConnectIntent {
    CreateNew,
    OpenExisting,
    AddSyncProvider,
}

impl VaultConnectIntent {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "create-new" => Ok(Self::CreateNew),
            "open-existing" => Ok(Self::OpenExisting),
            "add-sync-provider" => Ok(Self::AddSyncProvider),
            unknown => Err(format!("unknown vault connect intent: {unknown}")),
        }
    }

    #[must_use]
    pub const fn permits_empty_remote_genesis(self) -> bool {
        matches!(self, Self::CreateNew | Self::AddSyncProvider)
    }
}

/// Compile-time application capability presented to vault domain operations.
///
/// Production browser artifacts use exactly one of `Simple`, `Sentinel`, or
/// `Extension`. `UnifiedDevelopment` exists only for the local/test bundle and
/// is never emitted as a production web artifact.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum VaultApplication {
    #[default]
    UnifiedDevelopment,
    Simple,
    Sentinel,
    Extension,
}

impl VaultApplication {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::UnifiedDevelopment => "unified-development",
            Self::Simple => "simple",
            Self::Sentinel => "sentinel",
            Self::Extension => "extension",
        }
    }

    pub fn parse(value: &str) -> ValidationResult<Self> {
        match value {
            "unified-development" => Ok(Self::UnifiedDevelopment),
            "simple" => Ok(Self::Simple),
            "sentinel" => Ok(Self::Sentinel),
            "extension" => Ok(Self::Extension),
            other => Err(ValidationError::UnknownVaultApplication {
                application: other.to_owned(),
            }),
        }
    }

    #[must_use]
    pub const fn permits_vault_type(self, vault_type: VaultType) -> bool {
        match self {
            Self::UnifiedDevelopment => true,
            Self::Simple | Self::Extension => matches!(vault_type, VaultType::Simple),
            Self::Sentinel => matches!(vault_type, VaultType::Sentinel),
        }
    }

    #[must_use]
    pub const fn is_simple(self) -> bool {
        matches!(self, Self::Simple)
    }

    #[must_use]
    pub const fn is_sentinel(self) -> bool {
        matches!(self, Self::Sentinel)
    }

    #[must_use]
    pub const fn supports_extension(self) -> bool {
        !self.is_sentinel()
    }

    pub fn validate_vault_type(self, vault_type: VaultType) -> ValidationResult<()> {
        if self.permits_vault_type(vault_type) {
            return Ok(());
        }
        Err(ValidationError::VaultApplicationTypeMismatch {
            application: self.as_str().to_owned(),
            vault_type: vault_type.as_str().to_owned(),
        })
    }

    pub fn validate_session_access(self, vault_type: VaultType) -> ValidationResult<()> {
        self.validate_vault_type(vault_type)
    }

    pub fn validate_extension_approval(self, vault_type: VaultType) -> ValidationResult<()> {
        if vault_type == VaultType::Sentinel {
            return Err(ValidationError::SentinelExtensionForbidden);
        }
        if self != Self::Simple && self != Self::UnifiedDevelopment {
            return Err(ValidationError::ExtensionApprovalApplicationForbidden {
                application: self.as_str().to_owned(),
            });
        }
        self.validate_session_access(vault_type)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_applications_accept_only_their_vault_type() {
        assert!(
            VaultApplication::Simple
                .validate_session_access(VaultType::Simple)
                .is_ok()
        );
        assert!(
            VaultApplication::Sentinel
                .validate_session_access(VaultType::Sentinel)
                .is_ok()
        );
        assert!(
            VaultApplication::Extension
                .validate_session_access(VaultType::Simple)
                .is_ok()
        );
        assert_eq!(
            VaultApplication::Simple.validate_session_access(VaultType::Sentinel),
            Err(ValidationError::VaultApplicationTypeMismatch {
                application: "simple".to_owned(),
                vault_type: "sentinel".to_owned(),
            })
        );
        assert_eq!(
            VaultApplication::Sentinel.validate_session_access(VaultType::Simple),
            Err(ValidationError::VaultApplicationTypeMismatch {
                application: "sentinel".to_owned(),
                vault_type: "simple".to_owned(),
            })
        );
        assert_eq!(
            VaultApplication::Extension.validate_session_access(VaultType::Sentinel),
            Err(ValidationError::VaultApplicationTypeMismatch {
                application: "extension".to_owned(),
                vault_type: "sentinel".to_owned(),
            })
        );
    }

    #[test]
    fn application_capabilities_are_owned_by_the_application_enum() {
        assert!(VaultApplication::Simple.is_simple());
        assert!(!VaultApplication::Simple.is_sentinel());
        assert!(VaultApplication::Simple.supports_extension());

        assert!(!VaultApplication::Sentinel.is_simple());
        assert!(VaultApplication::Sentinel.is_sentinel());
        assert!(!VaultApplication::Sentinel.supports_extension());

        assert!(VaultApplication::UnifiedDevelopment.supports_extension());
        assert!(VaultApplication::Extension.supports_extension());
    }

    #[test]
    fn existing_vault_intent_rejects_empty_remote_genesis() {
        assert!(VaultConnectIntent::CreateNew.permits_empty_remote_genesis());
        assert!(VaultConnectIntent::AddSyncProvider.permits_empty_remote_genesis());
        assert!(!VaultConnectIntent::OpenExisting.permits_empty_remote_genesis());
        assert_eq!(
            VaultConnectIntent::parse("open-existing"),
            Ok(VaultConnectIntent::OpenExisting)
        );
    }

    #[test]
    fn legacy_migration_application_is_not_supported() {
        assert_eq!(
            VaultApplication::parse("legacy-migration"),
            Err(ValidationError::UnknownVaultApplication {
                application: "legacy-migration".to_owned(),
            })
        );
    }

    #[test]
    fn extension_approval_is_forbidden_for_sentinel() {
        assert!(
            VaultApplication::Simple
                .validate_extension_approval(VaultType::Simple)
                .is_ok()
        );
        assert_eq!(
            VaultApplication::Sentinel.validate_extension_approval(VaultType::Sentinel),
            Err(ValidationError::SentinelExtensionForbidden)
        );
        assert_eq!(
            VaultApplication::Extension.validate_extension_approval(VaultType::Simple),
            Err(ValidationError::ExtensionApprovalApplicationForbidden {
                application: "extension".to_owned(),
            })
        );
    }
}
