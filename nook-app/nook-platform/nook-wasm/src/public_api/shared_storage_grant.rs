use super::wasm_bindgen;
use crate::DriveStorageClient;
use crate::DriveStorageClientShareFolderWithEmail;
use crate::NookGoogleDriveFolder;
use nook_core::{
    OauthFilePreset, ProviderOauthPreset, SharedStorageGrantCredential, SharedStorageGrantOutcome,
    SharedStorageGrantTarget, SharedStorageTargetHint, StorageProviderType, i18n_keys,
};

impl DriveStorageClient<'_> {
    async fn grant_existing_drive_folder(
        request: ExistingDriveFolderGrant<'_>,
    ) -> nook_core::SharedStorageGrantOutcome {
        let ExistingDriveFolderGrant {
            access_token,
            instructions_key,
            joiner_identity,
            target,
        } = request;
        let folder_id = match &target {
            SharedStorageGrantTarget::Unavailable => String::new(),
            SharedStorageGrantTarget::Identified { storage_target_id }
            | SharedStorageGrantTarget::Named {
                storage_target_id, ..
            } => storage_target_id.clone(),
        };
        match DriveStorageClient::new(access_token)
            .share_folder_with_email(DriveStorageClientShareFolderWithEmail {
                folder_id: &folder_id,
                email: &joiner_identity,
            })
            .await
        {
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
}

impl DriveStorageClient<'_> {
    async fn create_and_grant_drive_folder(
        request: NewDriveFolderGrant<'_>,
    ) -> nook_core::SharedStorageGrantOutcome {
        let NewDriveFolderGrant {
            access_token,
            folder_name,
            instructions_key,
            joiner_identity,
        } = request;
        let Ok((folder_id, created_name)) = DriveStorageClient::new(access_token)
            .create_shared_vault_folder(folder_name)
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
        match DriveStorageClient::new(access_token)
            .share_folder_with_email(DriveStorageClientShareFolderWithEmail {
                folder_id: &folder_id,
                email: &joiner_identity,
            })
            .await
        {
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
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AutomaticSharedGrantRoute {
    GoogleDrive,
    Manual,
}

impl SharedDriveGrantPolicy {
    pub(crate) fn automatic_grant_route(self) -> AutomaticSharedGrantRoute {
        match (self.provider_type, self.oauth_preset) {
            (
                StorageProviderType::OauthFile,
                ProviderOauthPreset::Preset(OauthFilePreset::GoogleDrive),
            ) => AutomaticSharedGrantRoute::GoogleDrive,
            _ => AutomaticSharedGrantRoute::Manual,
        }
    }
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn prepare_shared_storage_grant(
    request: nook_core::SharedStorageGrantRequest,
) -> Result<nook_core::SharedStorageGrantOutcome, wasm_bindgen::JsError> {
    let validated = request.prepare()?;
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
            let route = (SharedDriveGrantPolicy {
                provider_type: request.provider_type,
                oauth_preset: request.oauth_preset,
            })
            .automatic_grant_route();
            match (!token.is_empty(), route) {
                (true, AutomaticSharedGrantRoute::GoogleDrive) => {
                    if matches!(&target, SharedStorageGrantTarget::Identified { storage_target_id } | SharedStorageGrantTarget::Named { storage_target_id, .. } if !storage_target_id.trim().is_empty())
                    {
                        DriveStorageClient::grant_existing_drive_folder(ExistingDriveFolderGrant {
                            access_token: token,
                            instructions_key: instructions_key,
                            joiner_identity: joiner_identity,
                            target: target,
                        })
                        .await
                    } else {
                        let folder_name = match &request.storage_target_hint {
                            SharedStorageTargetHint::Unspecified => "Nook shared vault",
                            SharedStorageTargetHint::Suggested(name) if name.trim().is_empty() => {
                                "Nook shared vault"
                            }
                            SharedStorageTargetHint::Suggested(name) => name.trim(),
                        };
                        DriveStorageClient::create_and_grant_drive_folder(NewDriveFolderGrant {
                            access_token: token,
                            folder_name: folder_name,
                            instructions_key: instructions_key,
                            joiner_identity: joiner_identity,
                        })
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
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn should_flush_shared_storage_grant(
    outcome: nook_core::SharedStorageGrantOutcome,
    credential: nook_core::SharedStorageGrantCredential,
) -> bool {
    outcome.should_flush_with(&credential)
}

/// Resolve a shared Drive folder id/URL and verify write access for the current
/// account before persisting the provider row.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn verify_shared_google_drive_folder(
    access_token: &str,
    folder_ref: &str,
) -> Result<NookGoogleDriveFolder, wasm_bindgen::JsError> {
    let (id, name) = DriveStorageClient::new(access_token)
        .verify_shared_vault_folder(folder_ref)
        .await?;
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
        assert!(matches!(
            (SharedDriveGrantPolicy {
                provider_type: manual_request.provider_type,
                oauth_preset: manual_request.oauth_preset
            })
            .automatic_grant_route(),
            AutomaticSharedGrantRoute::GoogleDrive
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
        assert!(!matches!(
            (SharedDriveGrantPolicy {
                provider_type: unsupported_request.provider_type,
                oauth_preset: unsupported_request.oauth_preset
            })
            .automatic_grant_route(),
            AutomaticSharedGrantRoute::GoogleDrive
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
/// Named values required by DriveStorageClient::grant_existing_drive_folder.
pub(crate) struct ExistingDriveFolderGrant<'a> {
    pub(crate) access_token: &'a str,
    pub(crate) instructions_key: String,
    pub(crate) joiner_identity: String,
    pub(crate) target: nook_core::SharedStorageGrantTarget,
}

/// Named values required by DriveStorageClient::create_and_grant_drive_folder.
pub(crate) struct NewDriveFolderGrant<'a> {
    pub(crate) access_token: &'a str,
    pub(crate) folder_name: &'a str,
    pub(crate) instructions_key: String,
    pub(crate) joiner_identity: String,
}
/// Provider evidence used to select the available automatic grant route.
pub(crate) struct SharedDriveGrantPolicy {
    pub(crate) provider_type: nook_core::StorageProviderType,
    pub(crate) oauth_preset: nook_core::ProviderOauthPreset,
}
