use crate::{
    DirectoryLegacyVaultImport, DirectoryOwnedVaultOpening, IdentityCreation,
    IdentityVaultKeyOpening,
};
use nook_auth2::MemberLabelState;
use nook_auth2::{
    AgeArmoredCiphertext, AppKey, IdentityDirectory, IdentityVaultDekEpoch,
    IdentityVaultDekEpochUpdate, IdentityVaultDekReconciliation, StoreId, VaultKeys,
};

fn envelopes_for(
    app_key: &AppKey,
    keys: &VaultKeys,
) -> anyhow::Result<(AgeArmoredCiphertext, AgeArmoredCiphertext)> {
    Ok((
        app_key
            .public_key()
            .seal_bytes(keys.secrets_key.as_str().as_bytes())?,
        app_key
            .public_key()
            .seal_bytes(keys.members_key.as_str().as_bytes())?,
    ))
}

#[test]
fn imported_vault_reuses_identity_that_owns_app_key() -> anyhow::Result<()> {
    let app_key = AppKey::generate()?;
    let mut directory = IdentityDirectory::empty();
    let resolved_identity = directory.create_identity(IdentityCreation {
        label: "Personal",
        app_key: &app_key,
        member_label: MemberLabelState::Unnamed,
    })?;
    directory = resolved_identity.directory;
    let identity_id = resolved_identity.identity_id;
    let first_store = StoreId::generate()?;
    let opened_identity =
        directory.open_or_generate_vault_dek_for_identity(DirectoryOwnedVaultOpening {
            identity_id: &identity_id,
            vault: IdentityVaultKeyOpening {
                app_key: &app_key,
                store_id: first_store.clone(),
            },
        })?;
    directory = opened_identity.directory;
    let imported_store = StoreId::generate()?;
    let imported_keys = VaultKeys::generate()?;
    let (secrets_envelope, members_envelope) = envelopes_for(&app_key, &imported_keys)?;

    let resolved_identity = directory.import_legacy_vault(DirectoryLegacyVaultImport {
        label: "Imported",
        app_key: &app_key,
        store_id: imported_store.clone(),
        reconciliation: IdentityVaultDekReconciliation {
            secrets_envelope,
            members_envelope,
            epoch_update: IdentityVaultDekEpochUpdate::Observe {
                key_epoch: IdentityVaultDekEpoch::LegacyUnknown,
                checkpoint_ancestors: Vec::new(),
            },
            authorized_auth_ids: vec![app_key.auth_id()],
        },
    })?;
    directory = resolved_identity.directory;
    let imported_identity = resolved_identity.identity_id;

    assert_eq!(imported_identity, identity_id);
    assert_eq!(directory.identities().len(), 1);
    assert!(directory.selected()?.owns_vault(&first_store));
    assert_eq!(
        directory.open_vault_dek_for_identity(DirectoryOwnedVaultOpening {
            identity_id: &identity_id,
            vault: IdentityVaultKeyOpening {
                app_key: &app_key,
                store_id: imported_store
            }
        })?,
        imported_keys
    );
    Ok(())
}
