//! Signing material owned by independently protected local identity entries.

use crate::storage;
use crate::storage::event_db;
use nook_core::{DeviceSigningPublicKey, IdentitySelection, SigningIdentity, i18n_keys};
use rexie::TransactionMode;

use crate::NookError;

use super::{
    delete_key, load_directory_for_write, load_keyring_for_store, map_domain_error, read_string,
    write_identity_directory, write_keyring,
};

fn ensure_signing_public_key_matches(
    established: &nook_core::DeviceSigningPublicKey,
    derived: &nook_core::DeviceSigningPublicKey,
) -> Result<(), NookError> {
    if !matches!(established, DeviceSigningPublicKey::Unavailable) && established != derived {
        return Err(NookError::Database(
            "Legacy signing seed does not match the established signing public key".to_owned(),
        ));
    }
    Ok(())
}

pub(super) async fn signing_material(
    store: &rexie::Store,
    existing: Option<&nook_core::LocalIdentityKeyringEntry>,
    app_key: &nook_core::AppKey,
    migrate_legacy_seed: bool,
    legacy_signing_public_key: &nook_core::DeviceSigningPublicKey,
    identity_has_vaults: bool,
) -> Result<(String, nook_core::DeviceSigningPublicKey), NookError> {
    let seed = match existing {
        Some(entry) if entry.has_signing_seed() => entry
            .open_signing_seed(app_key)
            .map_err(|error| NookError::Database(error.to_string()))?
            .ok_or_else(|| NookError::Database("Protected signing seed is missing".to_owned()))?,
        Some(_) | None if migrate_legacy_seed => {
            match read_string(store, event_db::SIGNING_SEED_KEY, "Legacy signing seed").await? {
                Some(seed) => seed,
                None if matches!(
                    legacy_signing_public_key,
                    DeviceSigningPublicKey::Unavailable
                ) && !identity_has_vaults =>
                {
                    SigningIdentity::generate()
                        .map_err(|error| NookError::Database(error.to_string()))?
                        .1
                        .as_str()
                        .to_owned()
                }
                None => {
                    return Err(NookError::Database(
                    "Legacy protected identity with signing or vault evidence is missing its established signing seed"
                        .to_owned(),
                ));
                }
            }
        }
        Some(_) => {
            return Err(NookError::Database(
                "Existing protected identity cannot mint replacement signing material".to_owned(),
            ));
        }
        None => SigningIdentity::generate()
            .map_err(|error| NookError::Database(error.to_string()))?
            .1
            .as_str()
            .to_owned(),
    };
    let signing = SigningIdentity::from_seed_hex_stored(&seed)
        .map_err(|error| NookError::Database(error.to_string()))?;
    let signing_public_key = signing.public_key();
    ensure_signing_public_key_matches(legacy_signing_public_key, &signing_public_key)?;
    Ok((seed, signing_public_key))
}

pub(super) fn member_signing_public_key(
    directory: &nook_core::IdentityDirectory,
    identity_id: &nook_core::IdentityId,
    app_id: &nook_core::AppId,
) -> Result<nook_core::DeviceSigningPublicKey, NookError> {
    directory
        .identities()
        .iter()
        .find(|identity| identity.identity_id == *identity_id)
        .and_then(|identity| {
            identity
                .members
                .iter()
                .find(|member| member.app_id == *app_id)
        })
        .map(|member| member.signing_public_key.clone())
        .ok_or_else(|| NookError::Database("Protected identity member disappeared".to_owned()))
}

pub(super) fn identity_has_vaults(
    directory: &nook_core::IdentityDirectory,
    identity_id: &nook_core::IdentityId,
) -> Result<bool, NookError> {
    directory
        .identities()
        .iter()
        .find(|identity| identity.identity_id == *identity_id)
        .map(|identity| !identity.vault_deks.is_empty())
        .ok_or_else(|| NookError::Database("Protected identity disappeared".to_owned()))
}

pub(super) async fn protect_selected_legacy_signing_seed(
    store: &rexie::Store,
    directory: &mut nook_core::IdentityDirectory,
    keyring: &mut nook_core::LocalIdentityKeyring,
    prior_app_key: Option<&nook_core::AppKey>,
) -> Result<(), NookError> {
    let Some(seed) = read_string(store, event_db::SIGNING_SEED_KEY, "Legacy signing seed").await?
    else {
        return Ok(());
    };
    let IdentitySelection::Selected(identity_id) = directory.selection() else {
        return Err(NookError::Database(
            "Legacy signing seed has no selected identity owner".to_owned(),
        ));
    };
    let identity_id = identity_id.clone();
    let existing = keyring.entry(&identity_id).cloned().ok_or_else(|| {
        NookError::Database("Legacy signing seed owner has no local keyring entry".to_owned())
    })?;
    if existing.has_signing_seed() {
        return Ok(());
    }
    let prior_app_key = prior_app_key.ok_or_else(|| {
        NookError::Decryption(i18n_keys::ERRORS_DEVICE_PROTECTION_AUTHORIZATION_REQUIRED.to_owned())
    })?;
    let established_signing_public_key =
        member_signing_public_key(directory, &identity_id, prior_app_key.app_id())?;
    let signing_public_key = SigningIdentity::from_seed_hex_stored(&seed)
        .map_err(|error| NookError::Database(error.to_string()))?
        .public_key();
    ensure_signing_public_key_matches(&established_signing_public_key, &signing_public_key)?;
    let mut protected = existing;
    let protected_signing_public_key = protected
        .protect_signing_seed(prior_app_key, &seed)
        .map_err(|error| NookError::Database(error.to_string()))?;
    ensure_signing_public_key_matches(&signing_public_key, &protected_signing_public_key)?;
    keyring
        .replace(protected)
        .map_err(|error| NookError::Database(error.to_string()))?;
    directory
        .set_member_signing_public_key(
            &identity_id,
            prior_app_key.app_id(),
            &protected_signing_public_key,
        )
        .map_err(map_domain_error)
}

pub(crate) async fn load_or_create_signing_seed_for_app_key(
    app_key: &nook_core::AppKey,
) -> Result<String, NookError> {
    let rexie = storage::open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], TransactionMode::ReadWrite)
        .map_err(|error| {
            NookError::IndexedDb(format!("Identity signing key load error: {error:?}"))
        })?;
    let store = transaction.store("vault").map_err(|error| {
        NookError::IndexedDb(format!("Identity signing key store error: {error:?}"))
    })?;
    let mut directory = load_directory_for_write(&store).await?;
    let mut keyring = load_keyring_for_store(&store, &directory).await?;
    let existing = keyring
        .entries()
        .iter()
        .find(|entry| entry.app_id() == app_key.app_id())
        .cloned()
        .ok_or_else(|| {
            NookError::Database("App key has no protected local keyring entry".to_owned())
        })?;
    let identity_id = existing.identity_id().clone();
    let legacy_signing_public_key =
        member_signing_public_key(&directory, &identity_id, app_key.app_id())?;
    let identity_has_vaults = identity_has_vaults(&directory, &identity_id)?;
    let (seed, signing_public_key) = signing_material(
        &store,
        Some(&existing),
        app_key,
        true,
        &legacy_signing_public_key,
        identity_has_vaults,
    )
    .await?;
    if !existing.has_signing_seed() {
        let mut updated = existing;
        updated
            .protect_signing_seed(app_key, &seed)
            .map_err(|error| NookError::Database(error.to_string()))?;
        keyring
            .replace(updated)
            .map_err(|error| NookError::Database(error.to_string()))?;
        directory
            .set_member_signing_public_key(&identity_id, app_key.app_id(), &signing_public_key)
            .map_err(map_domain_error)?;
        write_keyring(&store, &keyring).await?;
        write_identity_directory(&store, &directory).await?;
    }
    delete_key(&store, event_db::SIGNING_SEED_KEY, "Legacy signing seed").await?;
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!("Identity signing key completion error: {error:?}"))
    })?;
    Ok(seed)
}

#[cfg(test)]
mod tests {
    use crate::storage;
    use crate::storage::{event_db, indexed_db};
    use nook_core::{AppKey, DeviceSigningPublicKey, IdentityRecord, LocalIdentityKeyringEntry};
    use rexie::TransactionMode;

    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn signed_vault_identity_without_seed_cannot_mint_a_replacement_signer()
    -> Result<(), NookError> {
        indexed_db::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
        let app_key = AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let wrapped = nook_core::wrap_device_identity_with_pin(
            &app_key.secret_string(),
            "legacy identity pin",
        )?;
        let identity = IdentityRecord::create_with_app_key("Legacy", &app_key, None)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let entry = LocalIdentityKeyringEntry::legacy(
            identity.identity_id,
            app_key.app_id().clone(),
            wrapped,
        );
        let rexie = storage::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| NookError::IndexedDb(format!("Signer test error: {error:?}")))?;
        let store = transaction
            .store("vault")
            .map_err(|error| NookError::IndexedDb(format!("Signer test store error: {error:?}")))?;

        let result = signing_material(
            &store,
            Some(&entry),
            &app_key,
            true,
            &DeviceSigningPublicKey::Unavailable,
            true,
        )
        .await;

        assert!(
            matches!(result, Err(NookError::Database(message)) if message.contains("vault evidence"))
        );
        transaction.done().await.map(|_| ()).map_err(|error| {
            NookError::IndexedDb(format!("Signer test completion error: {error:?}"))
        })
    }
}
