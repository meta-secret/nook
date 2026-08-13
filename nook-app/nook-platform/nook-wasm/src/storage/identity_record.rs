//! Local identity-directory persistence, independent of vault `store_id`.

use std::cell::RefCell;
use std::rc::Rc;

use super::indexed_db::{
    StringUpdateGuard, StringUpdateResult, idb_delete_key, idb_get_string, idb_put_string,
    idb_update_string,
};
use crate::NookError;

const IDENTITY_DIRECTORY_KEY: &str = "identity_directory_v1";
const LEGACY_IDENTITY_RECORD_KEY: &str = "identity_record_v1";

pub(crate) async fn load_identity_directory() -> Result<nook_core::IdentityDirectory, NookError> {
    if let Some(raw) = idb_get_string(IDENTITY_DIRECTORY_KEY).await? {
        return decode_directory(&raw);
    }
    let Some(raw) = idb_get_string(LEGACY_IDENTITY_RECORD_KEY).await? else {
        return Ok(nook_core::IdentityDirectory::empty());
    };
    let record: nook_core::IdentityRecord = serde_json::from_str(&raw).map_err(|error| {
        NookError::IndexedDb(format!("Legacy identity record decode error: {error}"))
    })?;
    let directory = nook_core::IdentityDirectory::from_legacy_record(record)
        .map_err(|error| NookError::Database(error.to_string()))?;
    save_identity_directory(&directory).await?;
    idb_delete_key(LEGACY_IDENTITY_RECORD_KEY).await?;
    Ok(directory)
}

async fn save_identity_directory(
    directory: &nook_core::IdentityDirectory,
) -> Result<(), NookError> {
    directory
        .validate()
        .map_err(|error| NookError::Database(error.to_string()))?;
    let raw = serde_json::to_string(directory).map_err(|error| {
        NookError::IndexedDb(format!("Identity directory encode error: {error}"))
    })?;
    idb_put_string(IDENTITY_DIRECTORY_KEY, &raw).await
}

fn decode_directory(raw: &str) -> Result<nook_core::IdentityDirectory, NookError> {
    let directory: nook_core::IdentityDirectory = serde_json::from_str(raw).map_err(|error| {
        NookError::IndexedDb(format!("Identity directory decode error: {error}"))
    })?;
    directory
        .validate()
        .map_err(|error| NookError::Database(error.to_string()))?;
    Ok(directory)
}

pub(crate) async fn update_identity_directory<F, T>(update: F) -> Result<T, NookError>
where
    F: FnOnce(&mut nook_core::IdentityDirectory) -> Result<T, NookError>,
{
    // Complete legacy migration before entering the atomic current-key update.
    let _ = load_identity_directory().await?;
    let result = Rc::new(RefCell::new(None));
    let captured_result = Rc::clone(&result);
    let disposition = idb_update_string(
        IDENTITY_DIRECTORY_KEY,
        StringUpdateGuard::Unconditional,
        move |raw| {
            let mut directory = match raw {
                Some(raw) => decode_directory(&raw)?,
                None => nook_core::IdentityDirectory::empty(),
            };
            let value = update(&mut directory)?;
            directory
                .validate()
                .map_err(|error| NookError::Database(error.to_string()))?;
            let encoded = serde_json::to_string(&directory).map_err(|error| {
                NookError::IndexedDb(format!("Identity directory encode error: {error}"))
            })?;
            *captured_result.borrow_mut() = Some(value);
            Ok(encoded)
        },
    )
    .await?;
    if disposition != StringUpdateResult::Applied {
        return Err(NookError::IndexedDb(
            "Identity directory update was rejected.".to_owned(),
        ));
    }
    result.borrow_mut().take().ok_or_else(|| {
        NookError::IndexedDb("Identity directory update produced no result.".to_owned())
    })
}

pub(crate) async fn load_selected_identity() -> Result<Option<nook_core::IdentityRecord>, NookError>
{
    let directory = load_identity_directory().await?;
    match directory.selection() {
        nook_core::IdentitySelection::Empty => Ok(None),
        nook_core::IdentitySelection::Selected(_) => directory
            .selected()
            .cloned()
            .map(Some)
            .map_err(|error| NookError::Database(error.to_string())),
    }
}

/// Ensure the selected identity contains the current app key.
///
/// This preserves the legacy single-installation bootstrap. New cross-installation
/// membership uses the explicit enrollment flow rather than this compatibility path.
pub(crate) async fn ensure_local_identity_for_app_key(
    app_key: &nook_core::AppKey,
    label: &str,
) -> Result<nook_core::IdentityRecord, NookError> {
    let app_key = app_key.clone();
    let label = label.to_owned();
    update_identity_directory(move |directory| {
        if matches!(directory.selection(), nook_core::IdentitySelection::Empty) {
            directory
                .create_identity(&label, &app_key, None)
                .map_err(|error| NookError::Database(error.to_string()))?;
        } else {
            let selected = directory
                .selected_mut()
                .map_err(|error| NookError::Database(error.to_string()))?;
            if !selected
                .members
                .iter()
                .any(|member| member.app_id == *app_key.app_id())
            {
                selected
                    .add_member(nook_core::IdentityMember {
                        app_id: app_key.app_id().clone(),
                        auth_id: app_key.auth_id(),
                        public_key: app_key.public_key(),
                        label: None,
                    })
                    .map_err(|error| NookError::Database(error.to_string()))?;
            }
        }
        directory
            .selected()
            .cloned()
            .map_err(|error| NookError::Database(error.to_string()))
    })
    .await
}

/// Synthesize an identity from a legacy vault auth envelope when the directory is empty.
pub(crate) async fn ensure_identity_from_legacy_vault(
    app_key: &nook_core::AppKey,
    store_id: &nook_core::StoreId,
    secrets_envelope: nook_core::AgeArmoredCiphertext,
    members_envelope: nook_core::AgeArmoredCiphertext,
    label: &str,
) -> Result<nook_core::IdentityRecord, NookError> {
    let app_key = app_key.clone();
    let store_id = store_id.clone();
    let label = label.to_owned();
    update_identity_directory(move |directory| {
        if matches!(directory.selection(), nook_core::IdentitySelection::Empty) {
            let member = nook_core::IdentityMember {
                app_id: app_key.app_id().clone(),
                auth_id: app_key.auth_id(),
                public_key: app_key.public_key(),
                label: None,
            };
            let record = nook_core::IdentityRecord::synthesize_from_legacy_vault(
                label,
                member,
                store_id,
                secrets_envelope,
                members_envelope,
            )
            .map_err(|error| NookError::Database(error.to_string()))?;
            *directory = nook_core::IdentityDirectory::from_legacy_record(record)
                .map_err(|error| NookError::Database(error.to_string()))?;
        }
        directory
            .selected()
            .cloned()
            .map_err(|error| NookError::Database(error.to_string()))
    })
    .await
}

pub(crate) async fn generate_vault_dek_for_selected_identity(
    app_key: &nook_core::AppKey,
    label: &str,
    store_id: nook_core::StoreId,
) -> Result<nook_core::VaultKeys, NookError> {
    let app_key = app_key.clone();
    let label = label.to_owned();
    update_identity_directory(move |directory| {
        if matches!(directory.selection(), nook_core::IdentitySelection::Empty) {
            directory
                .create_identity(&label, &app_key, None)
                .map_err(|error| NookError::Database(error.to_string()))?;
        }
        let selected = directory
            .selected_mut()
            .map_err(|error| NookError::Database(error.to_string()))?;
        if !selected
            .members
            .iter()
            .any(|member| member.app_id == *app_key.app_id())
        {
            selected
                .add_member(nook_core::IdentityMember {
                    app_id: app_key.app_id().clone(),
                    auth_id: app_key.auth_id(),
                    public_key: app_key.public_key(),
                    label: None,
                })
                .map_err(|error| NookError::Database(error.to_string()))?;
        }
        selected
            .generate_vault_dek(store_id)
            .map_err(|error| NookError::Database(error.to_string()))
    })
    .await
}

#[cfg(test)]
pub(crate) async fn clear_identity_directory_for_test() -> Result<(), NookError> {
    idb_delete_key(IDENTITY_DIRECTORY_KEY).await?;
    idb_delete_key(LEGACY_IDENTITY_RECORD_KEY).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn migrates_legacy_record_then_persists_multiple_identities() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let app_key = nook_core::AppKey::generate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let legacy = nook_core::IdentityRecord::create_with_app_key("Personal", &app_key, None)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let legacy_id = legacy.identity_id.clone();
        let raw = serde_json::to_string(&legacy)
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        idb_put_string(LEGACY_IDENTITY_RECORD_KEY, &raw).await?;

        let migrated = load_identity_directory().await?;
        assert_eq!(
            migrated.selected().map_err(map_domain_error)?.identity_id,
            legacy_id
        );
        assert!(idb_get_string(LEGACY_IDENTITY_RECORD_KEY).await?.is_none());
        assert!(idb_get_string(IDENTITY_DIRECTORY_KEY).await?.is_some());

        let work_id = update_identity_directory(move |directory| {
            directory
                .create_identity("Work", &app_key, None)
                .map_err(map_domain_error)
        })
        .await?;
        let reloaded = load_identity_directory().await?;
        assert_eq!(reloaded.identities().len(), 2);
        assert_eq!(
            reloaded.selected().map_err(map_domain_error)?.identity_id,
            work_id
        );
        clear_identity_directory_for_test().await
    }

    fn map_domain_error(error: nook_core::MultiDeviceError) -> NookError {
        NookError::Database(error.to_string())
    }
}
