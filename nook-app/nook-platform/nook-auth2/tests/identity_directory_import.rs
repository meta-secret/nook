use nook_auth2::{
    AgeArmoredCiphertext, AppKey, IdentityDirectory, IdentityVaultDekEpoch,
    IdentityVaultDekEpochUpdate, IdentityVaultDekReconciliation, VaultKeys, encrypt_for_recipient,
    generate_store_id, generate_vault_keys,
};

fn envelopes_for(
    app_key: &AppKey,
    keys: &VaultKeys,
) -> anyhow::Result<(AgeArmoredCiphertext, AgeArmoredCiphertext)> {
    Ok((
        encrypt_for_recipient(keys.secrets_key.as_str().as_bytes(), &app_key.public_key())?,
        encrypt_for_recipient(keys.members_key.as_str().as_bytes(), &app_key.public_key())?,
    ))
}

#[test]
fn imported_vault_reuses_identity_that_owns_app_key() -> anyhow::Result<()> {
    let app_key = AppKey::generate()?;
    let mut directory = IdentityDirectory::empty();
    let identity_id = directory.create_identity("Personal", &app_key, None)?;
    let first_store = generate_store_id()?;
    let _ = directory.open_or_generate_vault_dek_for_identity(
        &identity_id,
        &app_key,
        first_store.clone(),
    )?;
    let imported_store = generate_store_id()?;
    let imported_keys = generate_vault_keys()?;
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
