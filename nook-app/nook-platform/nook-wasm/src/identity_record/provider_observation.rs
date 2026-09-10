//! Provider eligibility projected from local identity ownership.
use super::{CurrentAppIdentity, LocalAppProtection};
use crate::{
    BrowserProviderVaultIdentityObservations,
    BrowserProviderVaultIdentityObservationsFromProjection, NookDatabase,
    NookIdentityDirectorySnapshot,
};
use nook_core::{DeviceAccessProtectionKind, IdentityVaultAppGrant, IdentityVaultAppGrantKind};
impl NookIdentityDirectorySnapshot {
    pub(crate) async fn provider_vault_identity_observations(
        request: BrowserProviderVaultIdentityObservations<'_>,
    ) -> Result<Vec<nook_core::ProviderVaultIdentityObservation>, crate::NookError> {
        let BrowserProviderVaultIdentityObservations {
            session_app_id,
            store_id,
        } = request;
        let projection = NookDatabase::load_local_identity_projection(session_app_id).await?;
        Ok(
            NookIdentityDirectorySnapshot::provider_vault_identity_observations_from_projection(
                BrowserProviderVaultIdentityObservationsFromProjection {
                    session_app_id,
                    store_id,
                    projection: &projection,
                },
            ),
        )
    }
}
impl NookIdentityDirectorySnapshot {
    pub(super) fn provider_vault_identity_observations_from_projection(
        request: BrowserProviderVaultIdentityObservationsFromProjection<'_>,
    ) -> Vec<nook_core::ProviderVaultIdentityObservation> {
        let BrowserProviderVaultIdentityObservationsFromProjection {
            session_app_id,
            store_id,
            projection,
        } = request;
        let local_protections = LocalAppProtection::local_app_protections(&projection.keyring);
        let current_app = CurrentAppIdentity::observe(session_app_id);

        projection
            .directory
            .identities()
            .iter()
            .map(|identity| {
                let protected_members = identity
                    .members
                    .iter()
                    .filter(|member| {
                        local_protections.iter().any(|entry| {
                            entry.app_id == member.app_id
                                && entry.protection != DeviceAccessProtectionKind::Missing
                        })
                    })
                    .collect::<Vec<_>>();
                let candidate = protected_members
                    .iter()
                    .copied()
                    .find(|member| {
                        matches!(&current_app, CurrentAppIdentity::Identified(app_id) if app_id == &member.app_id)
                            && IdentityVaultAppGrant {
                                identity,
                                store_id,
                                app_id: &member.app_id,
                            }
                            .classify()
                                == IdentityVaultAppGrantKind::Granted
                    })
                    .or_else(|| {
                        protected_members.iter().copied().find(|member| {
                            IdentityVaultAppGrant {
                                identity,
                                store_id,
                                app_id: &member.app_id,
                            }
                            .classify()
                                == IdentityVaultAppGrantKind::Granted
                        })
                    })
                    .or_else(|| {
                        protected_members
                            .iter()
                            .copied()
                            .find(|member| matches!(&current_app, CurrentAppIdentity::Identified(app_id) if app_id == &member.app_id))
                    })
                    .or_else(|| protected_members.first().copied());

                nook_core::ProviderVaultIdentityObservation {
                    identity_id: identity.identity_id.as_str().to_owned(),
                    identity_label: identity.label.clone(),
                    linked_to_provider_vault: identity.owns_vault(store_id),
                    protected_local_app_available: candidate.is_some(),
                    is_current_app: candidate
                        .is_some_and(|member| matches!(&current_app, CurrentAppIdentity::Identified(app_id) if app_id == &member.app_id)),
                    app_grant: candidate.map_or(IdentityVaultAppGrantKind::NotGranted, |member| {
                        IdentityVaultAppGrant {
                            identity,
                            store_id,
                            app_id: &member.app_id,
                        }
                        .classify()
                    }),
                }
            })
            .collect()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::{
        AppKey, CurrentVaultReplaceability, DeviceIdentityProtection, IdentityDirectory,
        IdentityRecord, LocalIdentityKeyring, LocalIdentityKeyringEntry, MemberLabelState,
    };
    use nook_core::{
        ProviderVaultDecision as Decision, ProviderVaultDecisionReason as Reason,
        ProviderVaultIdentityEligibility as Eligibility,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    fn keyring_entry(
        identity: &nook_core::IdentityRecord,
        app_key: &nook_core::AppKey,
    ) -> anyhow::Result<nook_core::LocalIdentityKeyringEntry> {
        let wrapped = DeviceIdentityProtection::new(&app_key.secret_string()).with_pin("123456")?;
        Ok(LocalIdentityKeyringEntry::legacy(
            identity.identity_id.clone(),
            app_key.app_id().clone(),
            wrapped,
        ))
    }

    fn projection(
        identities: Vec<nook_core::IdentityRecord>,
        selected: nook_core::IdentityId,
        entries: Vec<nook_core::LocalIdentityKeyringEntry>,
    ) -> anyhow::Result<identity_record::LocalIdentityProjection> {
        Ok(identity_record::LocalIdentityProjection {
            directory: IdentityDirectory::from_records(
                identities,
                IdentitySelection::Selected(selected),
            )?,
            keyring: LocalIdentityKeyring::from_entries(entries)?,
            protected: ProtectedIdentityLookup::Unconfigured,
        })
    }

    fn decision(
        session_app_id: &str,
        store_id: &nook_core::StoreId,
        projection: &identity_record::LocalIdentityProjection,
    ) -> nook_core::ProviderVaultDecisionProjection {
        CurrentVaultReplaceability::Replaceable.project_provider_vault_decision(
            NookIdentityDirectorySnapshot::provider_vault_identity_observations_from_projection(
                BrowserProviderVaultIdentityObservationsFromProjection {
                    session_app_id,
                    store_id,
                    projection,
                },
            ),
        )
    }

    #[wasm_bindgen_test]
    fn current_and_other_protected_identities_keep_distinct_eligibility() -> anyhow::Result<()> {
        let current_key = AppKey::generate()?;
        let other_key = AppKey::generate()?;
        let store_id = nook_core::StoreId::generate()?;
        let current = IdentityRecord::create_with_app_key(
            "Personal",
            &current_key,
            MemberLabelState::Unnamed,
        )?;
        let current_id = current.identity_id.clone();
        let current_entry = keyring_entry(&current, &current_key)?;
        let mut other =
            IdentityRecord::create_with_app_key("Work", &other_key, MemberLabelState::Unnamed)?;
        let opened_identity = other
            .generate_vault_dek(store_id.clone())
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        other = opened_identity.identity;
        let other_entry = keyring_entry(&other, &other_key)?;
        let projection = projection(
            vec![current, other],
            current_id,
            vec![current_entry, other_entry],
        )?;

        let decision = decision(current_key.app_id().as_str(), &store_id, &projection);
        assert_eq!(decision.decision, Decision::AdoptProviderVault);
        assert_eq!(decision.identities[0].eligibility, Eligibility::NotLinked);
        assert!(decision.identities[0].is_current_app);
        assert_eq!(
            decision.identities[1].eligibility,
            Eligibility::LinkedAndPrepared
        );
        assert!(!decision.identities[1].is_current_app);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn linked_identity_without_a_protected_keyring_entry_is_unavailable() -> anyhow::Result<()> {
        let current_key = AppKey::generate()?;
        let linked_key = AppKey::generate()?;
        let store_id = nook_core::StoreId::generate()?;
        let current = IdentityRecord::create_with_app_key(
            "Personal",
            &current_key,
            MemberLabelState::Unnamed,
        )?;
        let current_id = current.identity_id.clone();
        let current_entry = keyring_entry(&current, &current_key)?;
        let mut linked =
            IdentityRecord::create_with_app_key("Work", &linked_key, MemberLabelState::Unnamed)?;
        let opened_identity = linked
            .generate_vault_dek(store_id.clone())
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        linked = opened_identity.identity;
        let projection = projection(vec![current, linked], current_id, vec![current_entry])?;

        let decision = decision(current_key.app_id().as_str(), &store_id, &projection);
        assert_eq!(decision.decision, Decision::PreserveBoth);
        assert_eq!(decision.reason, Reason::LinkedIdentityUnavailable);
        assert_eq!(
            decision.identities[1].eligibility,
            Eligibility::LinkedButUnavailable
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn revoked_or_missing_dek_envelopes_make_a_protected_identity_unavailable() -> anyhow::Result<()>
    {
        let app_key = AppKey::generate()?;
        let store_id = nook_core::StoreId::generate()?;
        let mut base =
            IdentityRecord::create_with_app_key("Personal", &app_key, MemberLabelState::Unnamed)?;
        let opened_identity = base
            .generate_vault_dek(store_id.clone())
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        base = opened_identity.identity;
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
            assert_eq!(decision.decision, Decision::PreserveBoth);
            assert_eq!(
                decision.identities[0].eligibility,
                Eligibility::LinkedButUnavailable
            );
            assert!(decision.identities[0].is_current_app);
        }
        Ok(())
    }
}
