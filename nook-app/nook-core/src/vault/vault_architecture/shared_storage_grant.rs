//! Shared-provider storage grant request validation and ceremony outcomes.

use super::provider_replication::{
    ProviderOauthPreset, SharedJoinerIdentityKind, provider_replication_capability,
};
use crate::StorageProviderType;
use crate::errors::{ValidationError, ValidationResult};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Request to grant shared provider storage to a joiner identity.
///
/// `access_token` is optional at the Rust validation boundary. The WASM layer
/// uses it to call Drive `files.create` + `permissions.create` and may upgrade
/// a validated request into [`SharedStorageGrantOutcome::Granted`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct SharedStorageGrantRequest {
    #[tsify(type = "StorageProviderType")]
    pub provider_type: String,
    pub oauth_preset: ProviderOauthPreset,
    pub joiner_identity_kind: SharedJoinerIdentityKind,
    pub joiner_identity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_target_hint: Option<String>,
    /// Existing shareable storage target. When present, grant this target
    /// instead of creating a replacement directory for each onboarding code.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_target_id: Option<String>,
    /// Owner OAuth access token (WASM Drive grant only; ignored by Rust).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
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
        #[serde(rename = "storageTargetId")]
        storage_target_id: String,
        #[serde(
            rename = "storageTargetName",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        storage_target_name: Option<String>,
    },
    #[serde(rename = "manual-grant-required")]
    ManualGrantRequired {
        #[serde(rename = "instructionsKey")]
        instructions_key: String,
        #[serde(rename = "joinerIdentity")]
        joiner_identity: String,
        #[serde(
            rename = "storageTargetId",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        storage_target_id: Option<String>,
        #[serde(
            rename = "storageTargetName",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        storage_target_name: Option<String>,
    },
    #[serde(rename = "unsupported")]
    Unsupported {
        #[serde(rename = "reasonKey")]
        reason_key: String,
    },
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
    let provider_type = StorageProviderType::parse(&request.provider_type)?;
    let capability = provider_replication_capability(provider_type, request.oauth_preset);
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
            reason_key: "architecture_modes.shared_grant_unsupported".to_owned(),
        });
    }
    Ok(SharedStorageGrantOutcome::ManualGrantRequired {
        instructions_key: "architecture_modes.shared_grant_manual_instructions".to_owned(),
        joiner_identity: identity.to_owned(),
        storage_target_id: request
            .storage_target_id
            .as_deref()
            .map(str::trim)
            .filter(|target| !target.is_empty())
            .map(str::to_owned),
        storage_target_name: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_storage_grant_requires_valid_email_and_returns_manual_ceremony() -> anyhow::Result<()>
    {
        let request = SharedStorageGrantRequest {
            provider_type: "oauth-file".to_owned(),
            oauth_preset: ProviderOauthPreset::Preset(crate::OauthFilePreset::GoogleDrive),
            joiner_identity_kind: SharedJoinerIdentityKind::Email,
            joiner_identity: "joiner@example.com".to_owned(),
            storage_target_hint: None,
            storage_target_id: None,
            access_token: Some("ya29.owner-token".to_owned()),
        };
        let outcome = prepare_shared_storage_grant(&request)?;
        assert_eq!(
            outcome,
            SharedStorageGrantOutcome::ManualGrantRequired {
                instructions_key: "architecture_modes.shared_grant_manual_instructions".to_owned(),
                joiner_identity: "joiner@example.com".to_owned(),
                storage_target_id: None,
                storage_target_name: None,
            }
        );

        let existing_target = SharedStorageGrantRequest {
            storage_target_id: Some("folder-existing".to_owned()),
            ..request.clone()
        };
        assert_eq!(
            prepare_shared_storage_grant(&existing_target)?,
            SharedStorageGrantOutcome::ManualGrantRequired {
                instructions_key: "architecture_modes.shared_grant_manual_instructions".to_owned(),
                joiner_identity: "joiner@example.com".to_owned(),
                storage_target_id: Some("folder-existing".to_owned()),
                storage_target_name: None,
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
            provider_type: "github".to_owned(),
            oauth_preset: ProviderOauthPreset::NotApplicable,
            ..request
        };
        assert_eq!(
            prepare_shared_storage_grant(&github)?,
            SharedStorageGrantOutcome::Unsupported {
                reason_key: "architecture_modes.shared_grant_unsupported".to_owned(),
            }
        );
        Ok(())
    }

    #[test]
    fn granted_outcome_roundtrips_the_storage_target() -> anyhow::Result<()> {
        let granted = SharedStorageGrantOutcome::Granted {
            note: "Shared Drive folder ready.".to_owned(),
            storage_target_id: "folder-abc".to_owned(),
            storage_target_name: Some("Nook shared vault".to_owned()),
        };
        let encoded = serde_json::to_vec(&granted)?;
        let roundtrip: SharedStorageGrantOutcome = serde_json::from_slice(&encoded)?;
        assert_eq!(roundtrip, granted);
        Ok(())
    }

    #[test]
    fn manual_grant_roundtrips_the_created_target() -> anyhow::Result<()> {
        let manual = SharedStorageGrantOutcome::ManualGrantRequired {
            instructions_key: "architecture_modes.shared_grant_manual_instructions".to_owned(),
            joiner_identity: "joiner@example.com".to_owned(),
            storage_target_id: Some("folder-created-before-permission-failed".to_owned()),
            storage_target_name: Some("Nook shared vault".to_owned()),
        };
        let encoded = serde_json::to_vec(&manual)?;
        let roundtrip: SharedStorageGrantOutcome = serde_json::from_slice(&encoded)?;
        assert_eq!(roundtrip, manual);
        Ok(())
    }
}
