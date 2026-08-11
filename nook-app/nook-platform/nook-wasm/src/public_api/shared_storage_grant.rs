use super::{storage, wasm_bindgen};
use crate::NookGoogleDriveFolder;

async fn grant_existing_drive_folder(
    access_token: &str,
    instructions_key: String,
    joiner_identity: String,
    target: nook_core::SharedStorageGrantTarget,
) -> nook_core::SharedStorageGrantOutcome {
    let folder_id = target.id().unwrap_or_default().to_owned();
    match storage::drive_shared::share_folder_with_email(access_token, &folder_id, &joiner_identity)
        .await
    {
        Ok(()) => nook_core::SharedStorageGrantOutcome::Granted {
            note: nook_core::i18n_keys::ARCHITECTURE_MODES_SHARED_GRANT_SUCCESS.to_owned(),
            target,
        },
        Err(error) => {
            tracing::warn!(
                scope = "shared-storage-grant",
                stage = "share-existing-folder",
                error = %error,
                "automatic shared storage grant failed; manual grant required"
            );
            nook_core::SharedStorageGrantOutcome::ManualGrantRequired {
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
        storage::drive_shared::create_shared_vault_folder(access_token, folder_name)
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
        return nook_core::SharedStorageGrantOutcome::ManualGrantRequired {
            instructions_key,
            joiner_identity,
            target: nook_core::SharedStorageGrantTarget::Unavailable,
        };
    };
    match storage::drive_shared::share_folder_with_email(access_token, &folder_id, &joiner_identity)
        .await
    {
        Ok(()) => nook_core::SharedStorageGrantOutcome::Granted {
            note: nook_core::i18n_keys::ARCHITECTURE_MODES_SHARED_GRANT_SUCCESS.to_owned(),
            target: nook_core::SharedStorageGrantTarget::Named {
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
            nook_core::SharedStorageGrantOutcome::ManualGrantRequired {
                instructions_key,
                joiner_identity,
                target: nook_core::SharedStorageGrantTarget::Named {
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
    provider_type == nook_core::StorageProviderType::OauthFile
        && oauth_preset
            == nook_core::ProviderOauthPreset::Preset(nook_core::OauthFilePreset::GoogleDrive)
}

#[wasm_bindgen(js_name = prepareSharedStorageGrant)]
pub async fn prepare_shared_storage_grant(
    request: nook_core::SharedStorageGrantRequest,
) -> Result<nook_core::SharedStorageGrantOutcome, wasm_bindgen::JsError> {
    let validated = nook_core::prepare_shared_storage_grant(&request)?;
    let outcome = match validated {
        nook_core::SharedStorageGrantOutcome::ManualGrantRequired {
            instructions_key,
            joiner_identity,
            target,
        } => {
            let token = match &request.credential {
                nook_core::SharedStorageGrantCredential::Unavailable => "",
                nook_core::SharedStorageGrantCredential::AccessToken(token) => token.trim(),
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
                            nook_core::SharedStorageTargetHint::Unspecified => "Nook shared vault",
                            nook_core::SharedStorageTargetHint::Suggested(name)
                                if name.trim().is_empty() =>
                            {
                                "Nook shared vault"
                            }
                            nook_core::SharedStorageTargetHint::Suggested(name) => name.trim(),
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
                _ => nook_core::SharedStorageGrantOutcome::ManualGrantRequired {
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

/// Resolve a shared Drive folder id/URL and verify write access for the current
/// account before persisting the provider row.
#[wasm_bindgen(js_name = verifySharedGoogleDriveFolder)]
pub async fn verify_shared_google_drive_folder(
    access_token: &str,
    folder_ref: &str,
) -> Result<NookGoogleDriveFolder, wasm_bindgen::JsError> {
    let (id, name) =
        storage::drive_shared::verify_shared_vault_folder(access_token, folder_ref).await?;
    Ok(NookGoogleDriveFolder::new(id, name))
}
