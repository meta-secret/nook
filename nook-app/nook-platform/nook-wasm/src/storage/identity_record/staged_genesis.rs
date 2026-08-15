//! Staged identity ownership for crash-safe fresh-vault genesis.

use std::{cell::RefCell, rc::Rc};

use super::genesis_flow::PendingSimpleGenesisFlow;
use super::simple_genesis::{
    PENDING_SIMPLE_GENESIS_KEY, PendingSimpleGenesis, PendingSimpleGenesisEvent,
    decode_pending_simple_genesis, encode_pending_simple_genesis,
};
use crate::storage::indexed_db::{StringUpdateGuard, idb_update_string};
use crate::{NookError, conversion::wasm_iso_timestamp};

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StagedSimpleGenesisIdentity {
    pub(crate) base_directory: nook_core::IdentityDirectory,
    pub(crate) directory: nook_core::IdentityDirectory,
}

pub(crate) struct StagedSimpleGenesisInput<'a> {
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) signing_public_key: &'a nook_core::DeviceSigningPublicKey,
    pub(crate) authorizer: Option<&'a nook_core::AppKey>,
    pub(crate) authorizer_signing:
        Option<&'a (nook_core::AppId, nook_core::DeviceSigningPublicKey)>,
    pub(crate) label: &'a str,
}

pub(crate) async fn begin_or_resume_staged_simple_genesis(
    input: StagedSimpleGenesisInput<'_>,
) -> Result<
    (
        PendingSimpleGenesis,
        nook_core::IdentityRecord,
        nook_core::VaultKeys,
    ),
    NookError,
> {
    let base_directory = super::load_identity_directory().await?;
    let mut staged_directory = base_directory.clone();
    if let Some(authorizer) = input.authorizer {
        staged_directory
            .enroll_selected_app_key_for_vault_creation(authorizer, input.label)
            .map_err(super::map_domain_error)?;
    }
    let identity_id = staged_directory
        .enroll_selected_app_key_for_vault_creation(input.app_key, input.label)
        .map_err(super::map_domain_error)?;
    staged_directory
        .set_member_signing_public_key(
            &identity_id,
            input.app_key.app_id(),
            input.signing_public_key,
        )
        .map_err(super::map_domain_error)?;
    if let Some((app_id, signing_public_key)) = input.authorizer_signing {
        staged_directory
            .set_member_signing_public_key(&identity_id, app_id, signing_public_key)
            .map_err(super::map_domain_error)?;
    }
    let store_id = nook_core::generate_store_id().map_err(super::map_domain_error)?;
    let _ = staged_directory
        .open_or_generate_vault_dek_for_identity(&identity_id, input.app_key, store_id.clone())
        .map_err(super::map_domain_error)?;
    let proposed = PendingSimpleGenesis {
        store_id,
        identity_id,
        created_at: nook_core::IsoTimestamp::parse(&wasm_iso_timestamp())
            .map_err(|error| NookError::Database(error.to_string()))?,
        event_state: PendingSimpleGenesisEvent::AwaitingEvent,
        flow: PendingSimpleGenesisFlow::Staged(StagedSimpleGenesisIdentity {
            base_directory,
            directory: staged_directory,
        }),
    };
    let selected = Rc::new(RefCell::new(None));
    let captured = Rc::clone(&selected);
    idb_update_string(
        PENDING_SIMPLE_GENESIS_KEY,
        StringUpdateGuard::Unconditional,
        move |current| {
            let pending = current
                .as_deref()
                .map(decode_pending_simple_genesis)
                .transpose()?
                .unwrap_or(proposed);
            if !pending.is_staged() {
                return Err(NookError::IndexedDb(
                    "Pending Simple genesis belongs to another creation flow.".to_owned(),
                ));
            }
            let encoded = encode_pending_simple_genesis(&pending)?;
            *captured.borrow_mut() = Some(pending);
            Ok(encoded)
        },
    )
    .await?;
    let pending = selected.borrow_mut().take().ok_or_else(|| {
        NookError::IndexedDb("Staged Simple genesis produced no result.".to_owned())
    })?;
    let staged = pending.staged_identity().ok_or_else(|| {
        NookError::IndexedDb("Staged Simple genesis lost its identity state.".to_owned())
    })?;
    let identity = staged
        .directory
        .identities()
        .iter()
        .find(|identity| identity.identity_id == pending.identity_id)
        .cloned()
        .ok_or_else(|| NookError::Database("Staged genesis identity disappeared.".to_owned()))?;
    let mut directory = staged.directory.clone();
    let keys = directory
        .open_or_generate_vault_dek_for_identity(
            &pending.identity_id,
            input.app_key,
            pending.store_id.clone(),
        )
        .map_err(super::map_domain_error)?;
    Ok((pending, identity, keys))
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct StagedGenesisCompatibilityWire {
        flow: PendingSimpleGenesisFlow,
        staged_identity: StagedSimpleGenesisIdentity,
    }

    #[wasm_bindgen_test]
    async fn staged_identity_publishes_only_with_genesis_cleanup() -> Result<(), NookError> {
        super::super::clear_identity_directory_for_test().await?;
        let authorizer = nook_core::AppKey::generate().map_err(super::super::map_domain_error)?;
        let extension = nook_core::AppKey::generate().map_err(super::super::map_domain_error)?;
        let (authorizer_signing, _) = nook_core::SigningIdentity::generate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let (extension_signing, _) = nook_core::SigningIdentity::generate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let authorizer_signing_pair =
            (authorizer.app_id().clone(), authorizer_signing.public_key());
        let (pending, _, _) = begin_or_resume_staged_simple_genesis(StagedSimpleGenesisInput {
            app_key: &extension,
            signing_public_key: &extension_signing.public_key(),
            authorizer: Some(&authorizer),
            authorizer_signing: Some(&authorizer_signing_pair),
            label: "Personal",
        })
        .await?;

        let encoded = super::super::simple_genesis::encode_pending_simple_genesis(&pending)?;
        let wire: StagedGenesisCompatibilityWire = serde_json::from_str(&encoded)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let PendingSimpleGenesisFlow::Staged(current_staged) = wire.flow else {
            return Err(NookError::Database(
                "Staged marker serialized as an ordinary flow.".to_owned(),
            ));
        };
        assert_eq!(current_staged, wire.staged_identity);
        assert!(super::super::simple_genesis::decode_pending_simple_genesis(&encoded)?.is_staged());

        assert!(
            super::super::load_identity_directory()
                .await?
                .identities()
                .is_empty()
        );
        super::super::clear_pending_simple_genesis(super::super::SimpleGenesisCompletion::Staged {
            pending: &pending,
            signing_seed: "staged-signing-seed",
        })
        .await?;
        let published = super::super::load_identity_directory().await?;
        let identity = published
            .selected()
            .map_err(super::super::map_domain_error)?;
        assert_eq!(identity.members.len(), 2);
        assert!(identity.owns_vault(&pending.store_id));
        assert_eq!(
            crate::storage::event_db::load_signing_seed().await?,
            Some("staged-signing-seed".to_owned())
        );
        crate::storage::indexed_db::idb_delete_key(crate::storage::event_db::SIGNING_SEED_KEY)
            .await?;
        super::super::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn staged_publish_refuses_to_overwrite_concurrent_identity_update()
    -> Result<(), NookError> {
        super::super::clear_identity_directory_for_test().await?;
        let extension = nook_core::AppKey::generate().map_err(super::super::map_domain_error)?;
        let (extension_signing, _) = nook_core::SigningIdentity::generate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let (pending, _, _) = begin_or_resume_staged_simple_genesis(StagedSimpleGenesisInput {
            app_key: &extension,
            signing_public_key: &extension_signing.public_key(),
            authorizer: None,
            authorizer_signing: None,
            label: "Personal",
        })
        .await?;
        let concurrent = nook_core::AppKey::generate().map_err(super::super::map_domain_error)?;
        let concurrent_update = concurrent.clone();
        super::super::update_identity_directory(move |directory| {
            directory
                .create_identity("Concurrent", &concurrent_update, None)
                .map_err(super::super::map_domain_error)?;
            Ok(())
        })
        .await?;

        super::super::clear_pending_simple_genesis(super::super::SimpleGenesisCompletion::Staged {
            pending: &pending,
            signing_seed: "staged-signing-seed",
        })
        .await?;
        let current = super::super::load_identity_directory().await?;
        assert_eq!(current.identities().len(), 2);
        assert!(
            current
                .identities()
                .iter()
                .any(|identity| identity.owns_vault(&pending.store_id))
        );
        assert!(current.identity_for_app_key(&concurrent)?.is_some());
        assert!(
            super::super::pending_simple_genesis_for_store(pending.store_id.as_str())
                .await?
                .is_none()
        );
        super::super::clear_identity_directory_for_test().await?;
        super::super::idb_delete_key(crate::storage::event_db::SIGNING_SEED_KEY).await
    }

    #[wasm_bindgen_test]
    async fn staged_signer_marker_resumes_with_authorizer_key() -> Result<(), NookError> {
        super::super::clear_identity_directory_for_test().await?;
        let authorizer = nook_core::AppKey::generate().map_err(super::super::map_domain_error)?;
        let extension = nook_core::AppKey::generate().map_err(super::super::map_domain_error)?;
        let (authorizer_signing, _) = nook_core::SigningIdentity::generate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let (extension_signing, _) = nook_core::SigningIdentity::generate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let authorizer_signing_pair =
            (authorizer.app_id().clone(), authorizer_signing.public_key());
        let (pending, _, _) = begin_or_resume_staged_simple_genesis(StagedSimpleGenesisInput {
            app_key: &extension,
            signing_public_key: &extension_signing.public_key(),
            authorizer: Some(&authorizer),
            authorizer_signing: Some(&authorizer_signing_pair),
            label: "Personal",
        })
        .await?;
        let first = super::super::persist_simple_genesis_event(
            &pending,
            &extension,
            "first-event\n".to_owned(),
            "first-seed".to_owned(),
        )
        .await?;
        let resumed = super::super::persist_simple_genesis_event(
            &pending,
            &authorizer,
            "ignored-event\n".to_owned(),
            "ignored-seed".to_owned(),
        )
        .await?;
        assert_eq!(resumed.event_yaml, first.event_yaml);
        assert_eq!(resumed.signing_seed, first.signing_seed);
        super::super::clear_identity_directory_for_test().await
    }
}
