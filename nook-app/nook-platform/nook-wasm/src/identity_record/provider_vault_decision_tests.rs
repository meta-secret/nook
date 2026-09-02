use super::*;

fn keyring_entry(
    identity: &nook_core::IdentityRecord,
    app_key: &nook_core::AppKey,
) -> anyhow::Result<nook_core::LocalIdentityKeyringEntry> {
    let wrapped = nook_core::wrap_device_identity_with_pin(&app_key.secret_string(), "123456")?;
    Ok(nook_core::LocalIdentityKeyringEntry::legacy(
        identity.identity_id.clone(),
        app_key.app_id().clone(),
        wrapped,
    ))
}

fn projection(
    identities: Vec<nook_core::IdentityRecord>,
    selected: nook_core::IdentityId,
    entries: Vec<nook_core::LocalIdentityKeyringEntry>,
) -> anyhow::Result<crate::storage::identity_record::LocalIdentityProjection> {
    Ok(crate::storage::identity_record::LocalIdentityProjection {
        directory: nook_core::IdentityDirectory::from_records(
            identities,
            nook_core::IdentitySelection::Selected(selected),
        )?,
        keyring: nook_core::LocalIdentityKeyring::from_entries(entries)?,
        protected: None,
    })
}

fn decision(
    session_app_id: &str,
    store_id: &nook_core::StoreId,
    projection: &crate::storage::identity_record::LocalIdentityProjection,
) -> nook_core::ProviderVaultDecisionProjection {
    nook_core::project_provider_vault_decision(
        nook_core::CurrentVaultReplaceability::Replaceable,
        provider_vault_identity_observations_from_projection(session_app_id, store_id, projection),
    )
}

#[test]
fn current_and_other_protected_identities_keep_distinct_eligibility() -> anyhow::Result<()> {
    let current_key = nook_core::AppKey::generate()?;
    let other_key = nook_core::AppKey::generate()?;
    let store_id = nook_core::generate_store_id()?;
    let current = nook_core::IdentityRecord::create_with_app_key("Personal", &current_key, None)?;
    let current_id = current.identity_id.clone();
    let current_entry = keyring_entry(&current, &current_key)?;
    let mut other = nook_core::IdentityRecord::create_with_app_key("Work", &other_key, None)?;
    other.generate_vault_dek(store_id.clone())?;
    let other_entry = keyring_entry(&other, &other_key)?;
    let projection = projection(
        vec![current, other],
        current_id,
        vec![current_entry, other_entry],
    )?;

    let decision = decision(current_key.app_id().as_str(), &store_id, &projection);
    assert_eq!(
        decision.decision,
        nook_core::ProviderVaultDecision::AdoptProviderVault
    );
    assert_eq!(
        decision.identities[0].eligibility,
        nook_core::ProviderVaultIdentityEligibility::NotLinked
    );
    assert!(decision.identities[0].is_current_app);
    assert_eq!(
        decision.identities[1].eligibility,
        nook_core::ProviderVaultIdentityEligibility::LinkedAndPrepared
    );
    assert!(!decision.identities[1].is_current_app);
    Ok(())
}

#[test]
fn linked_identity_without_a_protected_keyring_entry_is_unavailable() -> anyhow::Result<()> {
    let current_key = nook_core::AppKey::generate()?;
    let linked_key = nook_core::AppKey::generate()?;
    let store_id = nook_core::generate_store_id()?;
    let current = nook_core::IdentityRecord::create_with_app_key("Personal", &current_key, None)?;
    let current_id = current.identity_id.clone();
    let current_entry = keyring_entry(&current, &current_key)?;
    let mut linked = nook_core::IdentityRecord::create_with_app_key("Work", &linked_key, None)?;
    linked.generate_vault_dek(store_id.clone())?;
    let projection = projection(vec![current, linked], current_id, vec![current_entry])?;

    let decision = decision(current_key.app_id().as_str(), &store_id, &projection);
    assert_eq!(
        decision.decision,
        nook_core::ProviderVaultDecision::PreserveBoth
    );
    assert_eq!(
        decision.reason,
        nook_core::ProviderVaultDecisionReason::LinkedIdentityUnavailable
    );
    assert_eq!(
        decision.identities[1].eligibility,
        nook_core::ProviderVaultIdentityEligibility::LinkedButUnavailable
    );
    Ok(())
}

#[test]
fn revoked_or_missing_dek_envelopes_make_a_protected_identity_unavailable() -> anyhow::Result<()> {
    let app_key = nook_core::AppKey::generate()?;
    let store_id = nook_core::generate_store_id()?;
    let mut base = nook_core::IdentityRecord::create_with_app_key("Personal", &app_key, None)?;
    base.generate_vault_dek(store_id.clone())?;
    let entry = keyring_entry(&base, &app_key)?;

    for (remove_secrets, remove_members) in [(true, false), (false, true), (true, true)] {
        let mut identity = base.clone();
        let vault = identity
            .vault_deks
            .first_mut()
            .ok_or_else(|| anyhow::anyhow!("missing test vault grant"))?;
        if remove_secrets {
            vault.secrets_envelopes.clear();
        }
        if remove_members {
            vault.members_envelopes.clear();
        }
        let identity_id = identity.identity_id.clone();
        let projection = projection(vec![identity], identity_id, vec![entry.clone()])?;
        let decision = decision(app_key.app_id().as_str(), &store_id, &projection);
        assert_eq!(
            decision.decision,
            nook_core::ProviderVaultDecision::PreserveBoth
        );
        assert_eq!(
            decision.identities[0].eligibility,
            nook_core::ProviderVaultIdentityEligibility::LinkedButUnavailable
        );
        assert!(decision.identities[0].is_current_app);
    }
    Ok(())
}
