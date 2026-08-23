//! Non-secret, versioned metadata for the Devices & access dashboard.
//!
//! This companion record is deliberately separate from `device_identity_wrapped`.
//! Corrupt or future descriptive metadata must never block device-key unlock.

pub(crate) use nook_core::{
    DeviceAccessProfile, DeviceAccessProfileDecodeResult, PasskeyAccessProfile,
    PasskeyBrowserObservation, PasskeyCreatedAtEvidence, PasskeyCreationCeremony,
    PasskeyLastUsedAtEvidence, decode_device_access_profile,
};

use crate::NookError;

use super::indexed_db::{StringUpdateGuard, StringUpdateResult, idb_get_string};
#[cfg(test)]
use super::indexed_db::{idb_delete_key, idb_put_string, save_wrapped_device_identity};

mod migration;
mod profile_store;

#[cfg(test)]
pub(crate) use profile_store::load_device_access_profile;
#[cfg(test)]
use profile_store::{DeviceAccessProfileUpdate, save_device_access_profile};
use profile_store::{
    DeviceAccessProfileUpdateIntent, device_access_profile_key_for_verified_app_id,
    update_device_access_profile, update_device_access_profile_for_app_id,
    update_device_access_profile_with_key,
};
pub(crate) use profile_store::{
    load_companion_device_access_profile, load_device_access_profile_for_app_id,
    migrate_legacy_device_access_profile_for_selected_identity,
};

pub(super) const DEVICE_ACCESS_PROFILE_KEY: &str = "device_access_profile";

#[cfg(test)]
pub(crate) async fn record_passkey_created(
    credential_fingerprint: &str,
    nook_name: &str,
    observation: PasskeyBrowserObservation,
    ceremony: PasskeyCreationCeremony,
) -> Result<(), NookError> {
    let now = browser_timestamp();
    update_device_access_profile(
        DeviceAccessProfileUpdateIntent::BestEffort,
        StringUpdateGuard::WrappedCredentialFingerprint(credential_fingerprint),
        move |profile| {
            profile.record_passkey_created(
                credential_fingerprint,
                nook_name,
                observation,
                now,
                ceremony,
            );
            Ok(())
        },
    )
    .await
    .map(|_| ())
}

pub(crate) async fn record_passkey_created_for_app_id(
    app_id: &str,
    credential_fingerprint: &str,
    nook_name: &str,
    observation: PasskeyBrowserObservation,
    ceremony: PasskeyCreationCeremony,
) -> Result<(), NookError> {
    let now = browser_timestamp();
    update_device_access_profile_for_app_id(
        app_id,
        DeviceAccessProfileUpdateIntent::BestEffort,
        StringUpdateGuard::AppWrappedCredentialFingerprint {
            app_id,
            expected: credential_fingerprint,
        },
        move |profile| {
            profile.record_passkey_created(
                credential_fingerprint,
                nook_name,
                observation,
                now,
                ceremony,
            );
            Ok(())
        },
    )
    .await
    .map(|_| ())
}

pub(crate) async fn record_passkey_used_for_app_id(
    app_id: &str,
    credential_fingerprint: &str,
    observation: PasskeyBrowserObservation,
) -> Result<(), NookError> {
    let now = browser_timestamp();
    update_device_access_profile_for_app_id(
        app_id,
        DeviceAccessProfileUpdateIntent::BestEffort,
        StringUpdateGuard::AppWrappedCredentialFingerprint {
            app_id,
            expected: credential_fingerprint,
        },
        move |profile| {
            profile.record_passkey_used(credential_fingerprint, observation, now);
            Ok(())
        },
    )
    .await
    .map(|_| ())
}

pub(crate) async fn set_passkey_provider_label(
    credential_fingerprint: &str,
    label: &str,
) -> Result<(), NookError> {
    let normalized = nook_core::normalize_device_access_provider_label(label)
        .map_err(|error| NookError::Database(error.to_string()))?;
    let result = update_device_access_profile(
        DeviceAccessProfileUpdateIntent::Interactive,
        StringUpdateGuard::WrappedCredentialFingerprint(credential_fingerprint),
        move |profile| {
            profile
                .set_passkey_provider_label(credential_fingerprint, normalized)
                .map_err(|error| NookError::Database(error.to_string()))
        },
    )
    .await?;
    match result {
        StringUpdateResult::Applied => Ok(()),
        StringUpdateResult::GuardRejected => Err(NookError::Database(
            "Passkey changed before its provider label was saved".to_owned(),
        )),
    }
}

pub(crate) async fn set_passkey_name_for_app_id(
    app_id: &str,
    credential_fingerprint: &str,
    name: &str,
) -> Result<(), NookError> {
    let normalized = nook_core::normalize_device_access_passkey_name(name)
        .map_err(|error| NookError::Database(error.to_string()))?;
    let result = update_device_access_profile_for_app_id(
        app_id,
        DeviceAccessProfileUpdateIntent::Interactive,
        StringUpdateGuard::AppWrappedCredentialFingerprint {
            app_id,
            expected: credential_fingerprint,
        },
        move |profile| {
            profile
                .set_passkey_name(credential_fingerprint, normalized)
                .map_err(|error| NookError::Database(error.to_string()))
        },
    )
    .await?;
    match result {
        StringUpdateResult::Applied => Ok(()),
        StringUpdateResult::GuardRejected => Err(NookError::Database(
            "Passkey changed before its name was saved".to_owned(),
        )),
    }
}

pub(crate) async fn record_verified_vault_access(
    device_id: &nook_core::DeviceId,
    store_id: &nook_core::StoreId,
) -> Result<(), NookError> {
    let now = browser_timestamp();
    let profile_key = device_access_profile_key_for_verified_app_id(device_id.as_str()).await?;
    update_device_access_profile_with_key(
        profile_key,
        DeviceAccessProfileUpdateIntent::BestEffort,
        StringUpdateGuard::Unconditional,
        move |profile| {
            profile.record_verified_vault_access(device_id, store_id, now);
            Ok(())
        },
    )
    .await
    .map(|_| ())
}

#[cfg(test)]
pub(crate) async fn delete_device_access_profile() -> Result<(), NookError> {
    idb_delete_key(DEVICE_ACCESS_PROFILE_KEY).await
}

fn browser_timestamp() -> nook_core::IsoTimestamp {
    nook_core::IsoTimestamp::from_trusted(js_sys::Date::new_0().to_iso_string().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn timestamp(value: &str) -> nook_core::IsoTimestamp {
        nook_core::IsoTimestamp::from_trusted(value.to_owned())
    }

    fn device_id(value: &str) -> Result<nook_core::DeviceId, NookError> {
        nook_core::DeviceId::parse(value).map_err(|error| NookError::Database(error.to_string()))
    }

    fn store_id(value: &str) -> Result<nook_core::StoreId, NookError> {
        nook_core::StoreId::parse(value).map_err(|error| NookError::Database(error.to_string()))
    }

    fn observation() -> PasskeyBrowserObservation {
        PasskeyBrowserObservation {
            attachment: nook_core::PasskeyAuthenticatorAttachment::Platform,
            transports: vec![nook_core::PasskeyTransport::Internal],
            backup_state: nook_core::PasskeyBackupState::Eligible,
            aaguid: Some("aaguid-one".to_owned()),
            browser: nook_core::PasskeyObservedBrowser::Safari,
            platform: nook_core::PasskeyObservedPlatform::MacOs,
            legacy_client_environment: None,
        }
    }

    #[test]
    fn corrupt_and_future_profiles_degrade_to_empty_metadata() {
        assert_eq!(
            decode_device_access_profile("not-json"),
            DeviceAccessProfileDecodeResult::RecoverableDefault
        );
        assert_eq!(
            decode_device_access_profile(r#"{"version":999,"verifiedVaults":[]}"#),
            DeviceAccessProfileDecodeResult::FutureVersion
        );
    }

    #[test]
    fn future_profiles_reject_interactive_updates() {
        assert!(
            DeviceAccessProfileUpdate::PreserveFutureVersion
                .into_interactive_profile()
                .is_err()
        );
    }

    #[test]
    fn passkey_creation_replaces_credential_metadata_and_usage_merges_observations()
    -> anyhow::Result<()> {
        let mut profile = DeviceAccessProfile::default();
        profile.record_passkey_created(
            "passkey:first",
            "First credential",
            observation(),
            timestamp("2026-01-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationOnly,
        );
        assert_eq!(
            profile
                .passkey
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("created passkey profile is missing"))?
                .last_used_at,
            PasskeyLastUsedAtEvidence::NotYetObserved
        );
        profile
            .passkey
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("created passkey profile is missing"))?
            .provider_label = "Bitwarden".to_owned();

        let mut replacement = observation();
        replacement.aaguid = Some("aaguid-two".to_owned());
        replacement.transports = vec![nook_core::PasskeyTransport::Hybrid];
        profile.record_passkey_created(
            "passkey:replacement",
            "Replacement credential",
            replacement,
            timestamp("2026-02-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationAndAssertion,
        );
        let passkey = profile
            .passkey
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("replacement passkey profile is missing"))?;
        assert_eq!(passkey.nook_name, "Replacement credential");
        assert!(passkey.provider_label.is_empty());
        assert_eq!(passkey.observation.aaguid.as_deref(), Some("aaguid-two"));
        assert_eq!(
            passkey.last_used_at,
            PasskeyLastUsedAtEvidence::Known {
                timestamp: timestamp("2026-02-01T00:00:00.000Z")
            }
        );

        let usage = PasskeyBrowserObservation {
            attachment: nook_core::PasskeyAuthenticatorAttachment::Unknown,
            transports: Vec::new(),
            backup_state: nook_core::PasskeyBackupState::BackedUp,
            aaguid: None,
            browser: nook_core::PasskeyObservedBrowser::Firefox,
            platform: nook_core::PasskeyObservedPlatform::Linux,
            legacy_client_environment: None,
        };
        profile.record_passkey_used(
            "passkey:replacement",
            usage,
            timestamp("2026-03-01T00:00:00.000Z"),
        );
        let passkey = profile
            .passkey
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("used passkey profile is missing"))?;
        assert_eq!(
            passkey.observation.transports,
            [nook_core::PasskeyTransport::Hybrid]
        );
        assert_eq!(passkey.observation.aaguid.as_deref(), Some("aaguid-two"));
        assert_eq!(
            passkey.observation.backup_state,
            nook_core::PasskeyBackupState::BackedUp
        );
        assert_eq!(
            passkey.observation.browser,
            nook_core::PasskeyObservedBrowser::Firefox
        );
        assert_eq!(
            passkey.observation.platform,
            nook_core::PasskeyObservedPlatform::Linux
        );
        Ok(())
    }

    #[test]
    fn passkey_usage_clears_metadata_when_the_credential_fingerprint_changes() -> anyhow::Result<()>
    {
        let mut profile = DeviceAccessProfile::default();
        profile.record_passkey_created(
            "passkey:old",
            "Old credential",
            observation(),
            timestamp("2026-01-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationOnly,
        );
        profile
            .passkey
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("created passkey profile is missing"))?
            .provider_label = "Old provider".to_owned();

        let recovered_observation = PasskeyBrowserObservation {
            attachment: nook_core::PasskeyAuthenticatorAttachment::Unknown,
            transports: Vec::new(),
            backup_state: nook_core::PasskeyBackupState::BackedUp,
            aaguid: None,
            browser: nook_core::PasskeyObservedBrowser::Firefox,
            platform: nook_core::PasskeyObservedPlatform::Linux,
            legacy_client_environment: None,
        };
        profile.record_passkey_used(
            "passkey:recovered",
            recovered_observation.clone(),
            timestamp("2026-02-01T00:00:00.000Z"),
        );

        let passkey = profile
            .passkey
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("recovered passkey profile is missing"))?;
        assert_eq!(passkey.credential_fingerprint, "passkey:recovered");
        assert!(passkey.nook_name.is_empty());
        assert!(passkey.provider_label.is_empty());
        assert_eq!(passkey.created_at, PasskeyCreatedAtEvidence::Unavailable);
        assert_eq!(passkey.observation, recovered_observation);
        Ok(())
    }

    #[test]
    fn provider_label_update_rejects_a_replaced_credential() -> anyhow::Result<()> {
        let mut profile = DeviceAccessProfile::default();
        profile.record_passkey_created(
            "passkey:current",
            "Current credential",
            observation(),
            timestamp("2026-01-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationOnly,
        );

        assert!(
            profile
                .set_passkey_provider_label("passkey:stale", "Bitwarden".to_owned())
                .is_err()
        );
        assert!(
            profile
                .passkey
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("current passkey profile is missing"))?
                .provider_label
                .is_empty()
        );

        profile.set_passkey_provider_label("passkey:current", "Bitwarden".to_owned())?;
        assert_eq!(
            profile
                .passkey
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("current passkey profile is missing"))?
                .provider_label,
            "Bitwarden"
        );
        Ok(())
    }

    #[test]
    fn provider_label_update_initializes_recoverable_missing_metadata() -> anyhow::Result<()> {
        let mut profile = DeviceAccessProfile::default();

        profile.set_passkey_provider_label("passkey:current", "Proton Pass".to_owned())?;

        let passkey = profile
            .passkey
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("recovered passkey profile is missing"))?;
        assert_eq!(passkey.credential_fingerprint, "passkey:current");
        assert_eq!(passkey.provider_label, "Proton Pass");
        assert_eq!(passkey.created_at, PasskeyCreatedAtEvidence::Unavailable);
        Ok(())
    }

    #[test]
    fn timestamp_evidence_deserializes_legacy_values_without_conflating_new_states()
    -> anyhow::Result<()> {
        let legacy_known = r#"{
            "credentialFingerprint":"passkey:legacy",
            "createdAt":"2026-01-01T00:00:00.000Z",
            "lastUsedAt":null
        }"#;
        let profile: PasskeyAccessProfile = serde_json::from_str(legacy_known)?;
        assert_eq!(
            profile.created_at,
            PasskeyCreatedAtEvidence::Known {
                timestamp: timestamp("2026-01-01T00:00:00.000Z")
            }
        );
        assert_eq!(profile.last_used_at, PasskeyLastUsedAtEvidence::Unavailable);

        let explicit = PasskeyAccessProfile {
            last_used_at: PasskeyLastUsedAtEvidence::NotYetObserved,
            ..PasskeyAccessProfile::default()
        };
        let serialized = serde_json::to_string(&explicit)?;
        let round_trip: PasskeyAccessProfile = serde_json::from_str(&serialized)?;
        assert_eq!(
            round_trip.last_used_at,
            PasskeyLastUsedAtEvidence::NotYetObserved
        );
        Ok(())
    }

    #[test]
    fn verified_access_is_scoped_by_identity_and_store_and_refreshes_one_pair() -> anyhow::Result<()>
    {
        let mut profile = DeviceAccessProfile::default();
        let device_a = device_id("0123456789abcdef")?;
        let device_b = device_id("fedcba9876543210")?;
        let store_id = store_id("store_testtoken11")?;
        profile.record_verified_vault_access(
            &device_a,
            &store_id,
            timestamp("2026-01-01T00:00:00.000Z"),
        );
        profile.record_verified_vault_access(
            &device_b,
            &store_id,
            timestamp("2026-02-01T00:00:00.000Z"),
        );
        profile.record_verified_vault_access(
            &device_a,
            &store_id,
            timestamp("2026-03-01T00:00:00.000Z"),
        );

        assert_eq!(profile.verified_vaults.len(), 2);
        let refreshed = profile
            .verified_vaults
            .iter()
            .find(|entry| entry.device_id == device_a)
            .ok_or_else(|| anyhow::anyhow!("verified device and vault pair is missing"))?;
        assert_eq!(refreshed.verified_at, timestamp("2026-03-01T00:00:00.000Z"));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn profile_persistence_can_be_replaced_and_deleted() -> Result<(), NookError> {
        delete_device_access_profile().await?;
        let mut profile = DeviceAccessProfile::default();
        profile.record_passkey_created(
            "passkey:persisted",
            "Persisted credential",
            observation(),
            timestamp("2026-04-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationOnly,
        );
        save_device_access_profile(&profile).await?;
        assert_eq!(load_device_access_profile().await?, profile);

        delete_device_access_profile().await?;
        assert_eq!(
            load_device_access_profile().await?,
            DeviceAccessProfile::default()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn provider_label_recovers_missing_metadata_only_for_the_wrapped_passkey()
    -> Result<(), NookError> {
        let _ = rexie::Rexie::delete("nook_db").await;
        let setup = nook_core::DeviceKeyProtectionSetup::generate()?;
        let secret =
            nook_core::derive_device_identity_from_passkey_prf(setup.user_handle(), &[21u8; 32])?;
        let identity = nook_core::DeviceIdentity::from_secret_str(&secret)?;
        let credential_id = [7u8; 32];
        let wrapped = nook_core::passkey_derived_device_identity_record(
            &credential_id,
            setup.user_handle(),
            setup.prf_input(),
        )?;
        save_wrapped_device_identity(identity.device_id().as_str(), &wrapped).await?;
        delete_device_access_profile().await?;

        assert!(
            set_passkey_provider_label("passkey:stale", "Bitwarden")
                .await
                .is_err()
        );
        let credential_fingerprint = nook_core::passkey_credential_identifier(&credential_id);
        set_passkey_provider_label(&credential_fingerprint, "Bitwarden").await?;

        let profile = load_device_access_profile().await?;
        let passkey = profile.passkey.ok_or_else(|| {
            NookError::Database("Recovered passkey profile is missing".to_owned())
        })?;
        assert_eq!(passkey.credential_fingerprint, credential_fingerprint);
        assert_eq!(passkey.provider_label, "Bitwarden");
        let _ = rexie::Rexie::delete("nook_db").await;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn stale_passkey_ceremony_cannot_overwrite_replaced_identity_metadata()
    -> Result<(), NookError> {
        let _ = rexie::Rexie::delete("nook_db").await;
        let setup = nook_core::DeviceKeyProtectionSetup::generate()?;
        let identity = nook_core::DeviceIdentity::generate()?;
        let current_credential = [8u8; 32];
        let current_fingerprint = nook_core::passkey_credential_identifier(&current_credential);
        let current_wrapped = nook_core::passkey_derived_device_identity_record(
            &current_credential,
            setup.user_handle(),
            setup.prf_input(),
        )?;
        save_wrapped_device_identity(identity.device_id().as_str(), &current_wrapped).await?;

        record_passkey_created(
            &current_fingerprint,
            "Current credential",
            observation(),
            PasskeyCreationCeremony::RegistrationOnly,
        )
        .await?;
        record_passkey_created(
            &nook_core::passkey_credential_identifier(&[7u8; 32]),
            "Stale credential",
            observation(),
            PasskeyCreationCeremony::RegistrationOnly,
        )
        .await?;

        let passkey = load_device_access_profile()
            .await?
            .passkey
            .ok_or_else(|| NookError::Database("Passkey profile is missing".to_owned()))?;
        assert_eq!(passkey.credential_fingerprint, current_fingerprint);
        assert_eq!(passkey.nook_name, "Current credential");
        let _ = rexie::Rexie::delete("nook_db").await;
        Ok(())
    }

    #[cfg(all(target_arch = "wasm32", feature = "browser-wasm-tests"))]
    #[wasm_bindgen_test]
    async fn app_scoped_passkey_update_ignores_another_tabs_shared_selection()
    -> Result<(), NookError> {
        let _ = rexie::Rexie::delete("nook_db").await;
        let first_key = nook_core::AppKey::generate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let first_setup = nook_core::DeviceKeyProtectionSetup::generate()?;
        let first_credential = [31u8; 32];
        let first_wrapped = nook_core::passkey_wrapped_device_identity_record(
            &first_credential,
            first_setup.user_handle(),
            first_setup.prf_input(),
            &[41u8; 32],
            &first_key.secret_string(),
        )?;
        crate::storage::identity_record::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        let companion_key = nook_core::AppKey::generate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let companion_id = device_id(companion_key.app_id().as_str())?;
        let companion_store = nook_core::generate_store_id()
            .map_err(|error| NookError::Database(error.to_string()))?;
        record_verified_vault_access(&companion_id, &companion_store).await?;
        migrate_legacy_device_access_profile_for_selected_identity().await?;
        assert!(
            load_companion_device_access_profile()
                .await?
                .verified_vaults
                .iter()
                .any(|access| access.device_id == companion_id)
        );
        let second_key = nook_core::AppKey::generate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let second_wrapped =
            nook_core::wrap_device_identity_with_pin(&second_key.secret_string(), "second-secret")?;
        crate::storage::identity_record::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            None,
            "Work",
        )
        .await?;

        let first_fingerprint = nook_core::passkey_credential_identifier(&first_credential);
        record_passkey_created_for_app_id(
            first_key.app_id().as_str(),
            &first_fingerprint,
            "Personal passkey",
            observation(),
            PasskeyCreationCeremony::RegistrationOnly,
        )
        .await?;

        let first_profile =
            load_device_access_profile_for_app_id(first_key.app_id().as_str()).await?;
        assert_eq!(
            first_profile
                .passkey
                .ok_or_else(|| NookError::Database("First passkey profile is missing".to_owned()))?
                .nook_name,
            "Personal passkey"
        );
        assert_eq!(
            load_device_access_profile_for_app_id(second_key.app_id().as_str()).await?,
            DeviceAccessProfile::default()
        );
        let _ = rexie::Rexie::delete("nook_db").await;
        Ok(())
    }

    #[cfg(all(target_arch = "wasm32", feature = "browser-wasm-tests"))]
    #[wasm_bindgen_test]
    async fn concurrent_profile_migration_preserves_scoped_update() -> Result<(), NookError> {
        let _ = rexie::Rexie::delete("nook_db").await;
        let app_key = nook_core::AppKey::generate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let wrapped =
            nook_core::wrap_device_identity_with_pin(&app_key.secret_string(), "first-secret")?;
        crate::storage::identity_record::save_new_protected_local_identity(
            &app_key, &wrapped, None, "Personal",
        )
        .await?;
        let app_device_id = device_id(app_key.app_id().as_str())?;
        let first_store = nook_core::generate_store_id()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let second_store = nook_core::generate_store_id()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let mut legacy = DeviceAccessProfile::default();
        legacy.record_verified_vault_access(
            &app_device_id,
            &first_store,
            timestamp("2026-08-24T03:00:00.000Z"),
        );
        save_device_access_profile(&legacy).await?;

        let (migration_result, update_result) = futures_util::future::join(
            migrate_legacy_device_access_profile_for_selected_identity(),
            record_verified_vault_access(&app_device_id, &second_store),
        )
        .await;
        migration_result?;
        update_result?;

        let scoped = load_device_access_profile_for_app_id(app_key.app_id().as_str()).await?;
        assert!(
            scoped
                .verified_vaults
                .iter()
                .any(|entry| entry.store_id == first_store)
        );
        assert!(
            scoped
                .verified_vaults
                .iter()
                .any(|entry| entry.store_id == second_store)
        );
        assert!(idb_get_string(DEVICE_ACCESS_PROFILE_KEY).await?.is_none());
        let _ = rexie::Rexie::delete("nook_db").await;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn future_profile_is_preserved_during_best_effort_updates() -> Result<(), NookError> {
        const FUTURE_PROFILE: &str = r#"{"version":999,"futureField":"keep-me"}"#;
        idb_put_string(DEVICE_ACCESS_PROFILE_KEY, FUTURE_PROFILE).await?;

        let device_id = device_id("0123456789abcdef")?;
        let store_id = store_id("store_testtoken11")?;
        record_verified_vault_access(&device_id, &store_id).await?;
        assert!(
            set_passkey_provider_label("passkey:future", "1Password")
                .await
                .is_err()
        );
        assert_eq!(
            idb_get_string(DEVICE_ACCESS_PROFILE_KEY).await?.as_deref(),
            Some(FUTURE_PROFILE)
        );

        delete_device_access_profile().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn concurrent_verified_access_updates_preserve_both_relationships()
    -> Result<(), NookError> {
        delete_device_access_profile().await?;
        let device_a = device_id("0123456789abcdef")?;
        let device_b = device_id("fedcba9876543210")?;
        let store_a = store_id("store_testtoken11")?;
        let store_b = store_id("store_testtoken12")?;
        let (first, second) = futures_util::future::join(
            record_verified_vault_access(&device_a, &store_a),
            record_verified_vault_access(&device_b, &store_b),
        )
        .await;
        first?;
        second?;

        let profile = load_device_access_profile().await?;
        assert!(
            profile
                .verified_vaults
                .iter()
                .any(|entry| { entry.device_id == device_a && entry.store_id == store_a })
        );
        assert!(
            profile
                .verified_vaults
                .iter()
                .any(|entry| { entry.device_id == device_b && entry.store_id == store_b })
        );

        delete_device_access_profile().await?;
        Ok(())
    }
}
