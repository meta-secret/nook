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
    let identity_id = directory.create_identity("Personal", &app_key, None)?;
    let first_store = StoreId::generate()?;
    let _ = directory.open_or_generate_vault_dek_for_identity(
        &identity_id,
        &app_key,
        first_store.clone(),
    )?;
    let imported_store = StoreId::generate()?;
    let imported_keys = VaultKeys::generate()?;
    let (secrets_envelope, members_envelope) = envelopes_for(&app_key, &imported_keys)?;

    let imported_identity = directory.import_legacy_vault(
        "Imported",
        &app_key,
        imported_store.clone(),
        IdentityVaultDekReconciliation {
            secrets_envelope,
            members_envelope,
            epoch_update: IdentityVaultDekEpochUpdate::Observe {
                key_epoch: IdentityVaultDekEpoch::LegacyUnknown,
                checkpoint_ancestors: Vec::new(),
            },
            authorized_auth_ids: vec![app_key.auth_id()],
        },
    )?;

    assert_eq!(imported_identity, identity_id);
    assert_eq!(directory.identities().len(), 1);
    assert!(directory.selected()?.owns_vault(&first_store));
    assert_eq!(
        directory.open_or_generate_vault_dek_for_identity(
            &identity_id,
            &app_key,
            imported_store,
        )?,
        imported_keys
    );
    Ok(())
}
