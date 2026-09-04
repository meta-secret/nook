//! Shared-provider storage grant request validation and ceremony outcomes.

use super::provider_replication::{
    ProviderOauthPreset, SharedJoinerIdentityKind, provider_replication_capability,
};
use crate::errors::{ValidationError, ValidationResult};
use crate::{StorageProviderType, i18n_keys};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "hint", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum SharedStorageTargetHint {
    #[default]
    Unspecified,
    Suggested(String),
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "storageTargetId", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum SharedStorageTargetSelection {
    #[default]
    Create,
    Existing(String),
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "accessToken", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum SharedStorageGrantCredential {
    #[default]
    Unavailable,
    AccessToken(String),
}

/// Request to grant shared provider storage to a joiner identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct SharedStorageGrantRequest {
    pub provider_type: StorageProviderType,
    pub oauth_preset: ProviderOauthPreset,
    pub joiner_identity_kind: SharedJoinerIdentityKind,
    pub joiner_identity: String,
    pub storage_target_hint: SharedStorageTargetHint,
    /// Existing shareable storage target. When present, grant this target
    /// instead of creating a replacement directory for each onboarding code.
    pub storage_target: SharedStorageTargetSelection,
    /// Owner OAuth access token (WASM Drive grant only; ignored by Rust).
    pub credential: SharedStorageGrantCredential,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum SharedStorageGrantTarget {
    #[default]
    Unavailable,
    Identified {
        #[serde(rename = "storageTargetId")]
        storage_target_id: String,
    },
    Named {
        #[serde(rename = "storageTargetId")]
        storage_target_id: String,
        #[serde(rename = "storageTargetName")]
        storage_target_name: String,
    },
}

impl SharedStorageGrantTarget {
    #[must_use]
    pub fn from_values(storage_target_id: String, storage_target_name: String) -> Self {
        if storage_target_name.trim().is_empty() {
            Self::Identified { storage_target_id }
        } else {
            Self::Named {
                storage_target_id,
                storage_target_name,
            }
        }
    }

    #[must_use]
    pub fn id(&self) -> Option<&str> {
        match self {
            Self::Unavailable => None,
            Self::Identified { storage_target_id }
            | Self::Named {
                storage_target_id, ..
            } => Some(storage_target_id),
        }
    }

    #[must_use]
    pub fn name(&self) -> Option<&str> {
        match self {
            Self::Named {
                storage_target_name,
                ..
            } => Some(storage_target_name),
            Self::Unavailable | Self::Identified { .. } => None,
        }
    }
}

/// Outcome of preparing a shared storage grant.
///
/// Rust validation is ceremony-agnostic: Google Drive shared replication is
/// capable, so core returns [`SharedStorageGrantOutcome::ManualGrantRequired`]
/// when no shareable folder id is produced here. The WASM layer performs the
/// real `drive.file` folder create + `permissions.create` grant and returns
/// [`SharedStorageGrantOutcome::Granted`] with `storage_target_id` on success.
/// `ManualGrantRequired` remains the fallback when the Drive API fails or the
/// token lacks `drive.file`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum SharedStorageGrantOutcome {
    #[serde(rename = "granted")]
    Granted {
        note: String,
        target: SharedStorageGrantTarget,
    },
    #[serde(rename = "manual-grant-required")]
    ManualGrantRequired {
        #[serde(rename = "instructionsKey")]
        instructions_key: String,
        #[serde(rename = "joinerIdentity")]
        joiner_identity: String,
        target: SharedStorageGrantTarget,
    },
    #[serde(rename = "unsupported")]
    Unsupported {
        #[serde(rename = "reasonKey")]
        reason_key: String,
    },
}

/// A created or existing shared target needs the current event log before the
/// enrollment code is issued. Unsupported ceremonies and missing owner
/// credentials cannot flush that target.
#[must_use]
pub fn should_flush_shared_storage_grant(
    outcome: &SharedStorageGrantOutcome,
    credential: &SharedStorageGrantCredential,
) -> bool {
    !matches!(outcome, SharedStorageGrantOutcome::Unsupported { .. })
        && matches!(
            credential,
            SharedStorageGrantCredential::AccessToken(token) if !token.trim().is_empty()
        )
}

/// Validate a shared-grant request and return the grant ceremony outcome.
///
/// Capability lookup is ceremony-agnostic: providers that cannot share return
/// [`SharedStorageGrantOutcome::Unsupported`] (typed soft failure for UI copy)
/// rather than [`ValidationError::UnsupportedProviderReplication`]. Identity
/// validation still fails closed with hard errors.
pub fn prepare_shared_storage_grant(
    request: &SharedStorageGrantRequest,
) -> ValidationResult<SharedStorageGrantOutcome> {
    let capability = provider_replication_capability(request.provider_type, request.oauth_preset);
    let identity = request.joiner_identity.trim();
    if identity.is_empty() {
        return Err(ValidationError::SharedJoinerIdentityRequired);
    }
    match request.joiner_identity_kind {
        SharedJoinerIdentityKind::Email => {
            if !nook_auth2::is_plausible_email(identity) {
                return Err(ValidationError::SharedJoinerIdentityInvalid);
            }
        }
    }
    if !capability.supports_shared {
        return Ok(SharedStorageGrantOutcome::Unsupported {
            reason_key: i18n_keys::ARCHITECTURE_MODES_SHARED_GRANT_UNSUPPORTED.to_owned(),
        });
    }
    Ok(SharedStorageGrantOutcome::ManualGrantRequired {
        instructions_key: i18n_keys::ARCHITECTURE_MODES_SHARED_GRANT_MANUAL_INSTRUCTIONS.to_owned(),
        joiner_identity: identity.to_owned(),
        target: match &request.storage_target {
            SharedStorageTargetSelection::Create => SharedStorageGrantTarget::Unavailable,
            SharedStorageTargetSelection::Existing(storage_target_id) => {
                SharedStorageGrantTarget::Identified {
                    storage_target_id: storage_target_id.trim().to_owned(),
                }
            }
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_storage_grant_requires_valid_email_and_returns_manual_ceremony() -> anyhow::Result<()>
    {
        let request = SharedStorageGrantRequest {
            provider_type: StorageProviderType::OauthFile,
            oauth_preset: ProviderOauthPreset::Preset(crate::OauthFilePreset::GoogleDrive),
            joiner_identity_kind: SharedJoinerIdentityKind::Email,
            joiner_identity: "joiner@example.com".to_owned(),
            storage_target_hint: SharedStorageTargetHint::Unspecified,
            storage_target: SharedStorageTargetSelection::Create,
            credential: SharedStorageGrantCredential::AccessToken("ya29.owner-token".to_owned()),
        };
        let outcome = prepare_shared_storage_grant(&request)?;
        assert_eq!(
            outcome,
            SharedStorageGrantOutcome::ManualGrantRequired {
                instructions_key: i18n_keys::ARCHITECTURE_MODES_SHARED_GRANT_MANUAL_INSTRUCTIONS
                    .to_owned(),
                joiner_identity: "joiner@example.com".to_owned(),
                target: SharedStorageGrantTarget::Unavailable,
            }
        );

        let existing_target = SharedStorageGrantRequest {
            storage_target: SharedStorageTargetSelection::Existing("folder-existing".to_owned()),
            ..request.clone()
        };
        assert_eq!(
            prepare_shared_storage_grant(&existing_target)?,
            SharedStorageGrantOutcome::ManualGrantRequired {
                instructions_key: i18n_keys::ARCHITECTURE_MODES_SHARED_GRANT_MANUAL_INSTRUCTIONS
                    .to_owned(),
                joiner_identity: "joiner@example.com".to_owned(),
                target: SharedStorageGrantTarget::Identified {
                    storage_target_id: "folder-existing".to_owned(),
                },
            }
        );

        let missing = SharedStorageGrantRequest {
            joiner_identity: String::new(),
            ..request.clone()
        };
        assert!(matches!(
            prepare_shared_storage_grant(&missing),
            Err(ValidationError::SharedJoinerIdentityRequired)
        ));

        let github = SharedStorageGrantRequest {
            provider_type: StorageProviderType::Github,
            oauth_preset: ProviderOauthPreset::NotApplicable,
            ..request
        };
        assert_eq!(
            prepare_shared_storage_grant(&github)?,
            SharedStorageGrantOutcome::Unsupported {
                reason_key: i18n_keys::ARCHITECTURE_MODES_SHARED_GRANT_UNSUPPORTED.to_owned(),
            }
        );
        Ok(())
    }

    #[test]
    fn granted_outcome_roundtrips_the_storage_target() -> anyhow::Result<()> {
        let granted = SharedStorageGrantOutcome::Granted {
            note: "Shared Drive folder ready.".to_owned(),
            target: SharedStorageGrantTarget::Named {
                storage_target_id: "folder-abc".to_owned(),
                storage_target_name: "Nook shared vault".to_owned(),
            },
        };
        let encoded = serde_json::to_vec(&granted)?;
        let roundtrip: SharedStorageGrantOutcome = serde_json::from_slice(&encoded)?;
        assert_eq!(roundtrip, granted);
        Ok(())
    }

    #[test]
    fn manual_grant_roundtrips_the_created_target() -> anyhow::Result<()> {
        let manual = SharedStorageGrantOutcome::ManualGrantRequired {
            instructions_key: i18n_keys::ARCHITECTURE_MODES_SHARED_GRANT_MANUAL_INSTRUCTIONS
                .to_owned(),
            joiner_identity: "joiner@example.com".to_owned(),
            target: SharedStorageGrantTarget::Named {
                storage_target_id: "folder-created-before-permission-failed".to_owned(),
                storage_target_name: "Nook shared vault".to_owned(),
            },
        };
        let encoded = serde_json::to_vec(&manual)?;
        let roundtrip: SharedStorageGrantOutcome = serde_json::from_slice(&encoded)?;
        assert_eq!(roundtrip, manual);
        Ok(())
    }

    #[test]
    fn shared_grant_flush_requires_supported_outcome_and_owner_credential() {
        let granted = SharedStorageGrantOutcome::Granted {
            note: "ready".to_owned(),
            target: SharedStorageGrantTarget::Identified {
                storage_target_id: "folder".to_owned(),
            },
        };
        let manual = SharedStorageGrantOutcome::ManualGrantRequired {
            instructions_key: "instructions".to_owned(),
            joiner_identity: "joiner@example.com".to_owned(),
            target: SharedStorageGrantTarget::Identified {
                storage_target_id: "folder".to_owned(),
            },
        };
        let unsupported = SharedStorageGrantOutcome::Unsupported {
            reason_key: "unsupported".to_owned(),
        };
        let available = SharedStorageGrantCredential::AccessToken(" token ".to_owned());

        assert!(should_flush_shared_storage_grant(&granted, &available));
        assert!(should_flush_shared_storage_grant(&manual, &available));
        assert!(!should_flush_shared_storage_grant(
            &manual,
            &SharedStorageGrantCredential::Unavailable,
        ));
        assert!(!should_flush_shared_storage_grant(&unsupported, &available,));
    }
}
