use super::wasm_bindgen;
use crate::NookGoogleDriveFolder;
use crate::storage::drive_shared;
use nook_core::{
    OauthFilePreset, ProviderOauthPreset, SharedStorageGrantCredential, SharedStorageGrantOutcome,
    SharedStorageGrantTarget, SharedStorageTargetHint, StorageProviderType, i18n_keys,
};

async fn grant_existing_drive_folder(
    access_token: &str,
    instructions_key: String,
    joiner_identity: String,
    target: nook_core::SharedStorageGrantTarget,
) -> nook_core::SharedStorageGrantOutcome {
    let folder_id = target.id().unwrap_or_default().to_owned();
    match drive_shared::share_folder_with_email(access_token, &folder_id, &joiner_identity).await {
        Ok(()) => SharedStorageGrantOutcome::Granted {
            note: i18n_keys::ARCHITECTURE_MODES_SHARED_GRANT_SUCCESS.to_owned(),
            target,
        },
        Err(error) => {
            tracing::warn!(
                scope = "shared-storage-grant",
                stage = "share-existing-folder",
                error = %error,
                "automatic shared storage grant failed; manual grant required"
            );
            SharedStorageGrantOutcome::ManualGrantRequired {
                instructions_key,
                joiner_identity,
                target,
            }
        }
    }
}

async fn create_and_grant_drive_folder(
    access_token: &str,
    folder_name: &str,
    instructions_key: String,
    joiner_identity: String,
) -> nook_core::SharedStorageGrantOutcome {
    let Ok((folder_id, created_name)) =
        drive_shared::create_shared_vault_folder(access_token, folder_name)
            .await
            .inspect_err(|error| {
                tracing::warn!(
                    scope = "shared-storage-grant",
                    stage = "create-folder",
                    error = %error,
                    "automatic shared storage grant failed; manual grant required"
                );
            })
    else {
        return SharedStorageGrantOutcome::ManualGrantRequired {
            instructions_key,
            joiner_identity,
            target: SharedStorageGrantTarget::Unavailable,
        };
    };
    match drive_shared::share_folder_with_email(access_token, &folder_id, &joiner_identity).await {
        Ok(()) => SharedStorageGrantOutcome::Granted {
            note: i18n_keys::ARCHITECTURE_MODES_SHARED_GRANT_SUCCESS.to_owned(),
            target: SharedStorageGrantTarget::Named {
                storage_target_id: folder_id,
                storage_target_name: created_name,
            },
        },
        Err(error) => {
            tracing::warn!(
                scope = "shared-storage-grant",
                stage = "share-folder",
                error = %error,
                "automatic shared storage grant failed; manual grant required"
            );
            SharedStorageGrantOutcome::ManualGrantRequired {
                instructions_key,
                joiner_identity,
                target: SharedStorageGrantTarget::Named {
                    storage_target_id: folder_id,
                    storage_target_name: created_name,
                },
            }
        }
    }
}

/// Validate a shared-grant request, then (for Google Drive) grant the persisted
/// folder or create one when no target exists. Falls back to
/// `ManualGrantRequired` when the Drive API fails or no owner token is supplied.
pub(crate) fn is_google_drive_shared_grant_request(
    provider_type: nook_core::StorageProviderType,
    oauth_preset: nook_core::ProviderOauthPreset,
) -> bool {
    provider_type == StorageProviderType::OauthFile
        && oauth_preset == ProviderOauthPreset::Preset(OauthFilePreset::GoogleDrive)
}

#[wasm_bindgen]
pub async fn prepare_shared_storage_grant(
    request: nook_core::SharedStorageGrantRequest,
) -> Result<nook_core::SharedStorageGrantOutcome, wasm_bindgen::JsError> {
    let validated = nook_core::prepare_shared_storage_grant(&request)?;
    let outcome = match validated {
        SharedStorageGrantOutcome::ManualGrantRequired {
            instructions_key,
            joiner_identity,
            target,
        } => {
            let token = match &request.credential {
                SharedStorageGrantCredential::Unavailable => "",
                SharedStorageGrantCredential::AccessToken(token) => token.trim(),
            };
            let is_gdrive =
                is_google_drive_shared_grant_request(request.provider_type, request.oauth_preset);
            match (!token.is_empty(), is_gdrive) {
                (true, true) => {
                    if target.id().is_some_and(|id| !id.trim().is_empty()) {
                        grant_existing_drive_folder(
                            token,
                            instructions_key,
                            joiner_identity,
                            target,
                        )
                        .await
                    } else {
                        let folder_name = match &request.storage_target_hint {
                            SharedStorageTargetHint::Unspecified => "Nook shared vault",
                            SharedStorageTargetHint::Suggested(name) if name.trim().is_empty() => {
                                "Nook shared vault"
                            }
                            SharedStorageTargetHint::Suggested(name) => name.trim(),
                        };
                        create_and_grant_drive_folder(
                            token,
                            folder_name,
                            instructions_key,
                            joiner_identity,
                        )
                        .await
                    }
                }
                _ => SharedStorageGrantOutcome::ManualGrantRequired {
                    instructions_key,
                    joiner_identity,
                    target,
                },
            }
        }
        other => other,
    };
    Ok(outcome)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[must_use]
pub fn should_flush_shared_storage_grant(
    outcome: nook_core::SharedStorageGrantOutcome,
    credential: nook_core::SharedStorageGrantCredential,
) -> bool {
    nook_core::should_flush_shared_storage_grant(&outcome, &credential)
}

/// Resolve a shared Drive folder id/URL and verify write access for the current
/// account before persisting the provider row.
#[wasm_bindgen]
pub async fn verify_shared_google_drive_folder(
    access_token: &str,
    folder_ref: &str,
) -> Result<NookGoogleDriveFolder, wasm_bindgen::JsError> {
    let (id, name) = drive_shared::verify_shared_vault_folder(access_token, folder_ref).await?;
    Ok(NookGoogleDriveFolder::new(id, name))
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen::JsError;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn google_drive_request(
        credential: SharedStorageGrantCredential,
        target: nook_core::SharedStorageTargetSelection,
    ) -> nook_core::SharedStorageGrantRequest {
        nook_core::SharedStorageGrantRequest {
            provider_type: StorageProviderType::OauthFile,
            oauth_preset: ProviderOauthPreset::Preset(OauthFilePreset::GoogleDrive),
            joiner_identity_kind: nook_core::SharedJoinerIdentityKind::Email,
            joiner_identity: "joiner@example.com".to_owned(),
            storage_target_hint: SharedStorageTargetHint::Unspecified,
            storage_target: target,
            credential,
        }
    }

    #[wasm_bindgen_test]
    async fn shared_grant_adapter_preserves_manual_and_unsupported_policy_paths()
    -> Result<(), JsError> {
        let manual_request = google_drive_request(
            SharedStorageGrantCredential::Unavailable,
            nook_core::SharedStorageTargetSelection::Create,
        );
        assert!(is_google_drive_shared_grant_request(
            manual_request.provider_type,
            manual_request.oauth_preset
        ));
        let manual = prepare_shared_storage_grant(manual_request).await?;
        assert!(matches!(
            manual,
            SharedStorageGrantOutcome::ManualGrantRequired {
                target: SharedStorageGrantTarget::Unavailable,
                ..
            }
        ));
        assert!(!should_flush_shared_storage_grant(
            manual.clone(),
            SharedStorageGrantCredential::Unavailable
        ));
        assert!(should_flush_shared_storage_grant(
            manual,
            SharedStorageGrantCredential::AccessToken(" owner-token ".to_owned())
        ));

        let existing = prepare_shared_storage_grant(google_drive_request(
            SharedStorageGrantCredential::AccessToken("   ".to_owned()),
            nook_core::SharedStorageTargetSelection::Existing(" folder-1 ".to_owned()),
        ))
        .await?;
        assert!(matches!(
            existing,
            SharedStorageGrantOutcome::ManualGrantRequired {
                target: SharedStorageGrantTarget::Identified { ref storage_target_id },
                ..
            } if storage_target_id == "folder-1"
        ));

        let unsupported_request = nook_core::SharedStorageGrantRequest {
            provider_type: StorageProviderType::Github,
            oauth_preset: ProviderOauthPreset::NotApplicable,
            ..google_drive_request(
                SharedStorageGrantCredential::AccessToken("owner-token".to_owned()),
                nook_core::SharedStorageTargetSelection::Create,
            )
        };
        assert!(!is_google_drive_shared_grant_request(
            unsupported_request.provider_type,
            unsupported_request.oauth_preset
        ));
        let unsupported = prepare_shared_storage_grant(unsupported_request).await?;
        assert!(matches!(
            unsupported,
            SharedStorageGrantOutcome::Unsupported { .. }
        ));
        assert!(!should_flush_shared_storage_grant(
            unsupported,
            SharedStorageGrantCredential::AccessToken("owner-token".to_owned())
        ));

        let invalid = nook_core::SharedStorageGrantRequest {
            joiner_identity: "not-an-email".to_owned(),
            ..google_drive_request(
                SharedStorageGrantCredential::Unavailable,
                nook_core::SharedStorageTargetSelection::Create,
            )
        };
        assert!(prepare_shared_storage_grant(invalid).await.is_err());
        Ok(())
    }
}
