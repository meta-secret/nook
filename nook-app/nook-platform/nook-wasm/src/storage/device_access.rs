#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Non-secret, versioned metadata for the Devices & access dashboard.
//!
//! This companion record is deliberately separate from `device_identity_wrapped`.
//! Corrupt or future descriptive metadata must never block device-key unlock.

use crate::IdentityDbSaveNewProtectedLocalIdentity;
use crate::storage::indexed_db::StoredStringRecord;
use crate::{IdbPutStringRequest, NookDatabase, NookError, SaveWrappedDeviceIdentityRequest};
use js_sys::Date;
use nook_core::AuthenticatorGuidEvidence;
use nook_core::DiscardedClientEnvironment;
use nook_core::IsoTimestamp;
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
use nook_core::{DeviceIdentityProtection, PasskeyProtectionInput};
#[cfg(test)]
use nook_core::{PasskeyRecordMetadata, WrappedDeviceIdentity};

pub(crate) use nook_core::{
    DeviceAccessProfile, DeviceAccessProfileDecodeResult, PasskeyAccessProfile,
    PasskeyBrowserObservation, PasskeyCreatedAtEvidence, PasskeyCreationCeremony,
    PasskeyLastUsedAtEvidence,
};

#[cfg(test)]
use super::indexed_db;
use super::indexed_db::{StringUpdateGuard, StringUpdateResult};

mod migration;
mod profile_store;
mod verified_vault_access;
pub(crate) use verified_vault_access::VerifiedVaultAccessUpdate;

pub(crate) use profile_store::DeviceAccessProfileKey;
#[cfg(test)]
use profile_store::DeviceAccessProfileUpdate;
use profile_store::{DeviceAccessProfileMutation, DeviceAccessProfileUpdateIntent};

pub(super) const DEVICE_ACCESS_PROFILE_KEY: &str = "device_access_profile";

#[cfg(test)]
pub(crate) struct SelectedPasskeyCreation<'a> {
    pub(crate) credential_fingerprint: &'a str,
    pub(crate) nook_name: &'a str,
    pub(crate) observation: PasskeyBrowserObservation,
    pub(crate) ceremony: PasskeyCreationCeremony,
}
#[cfg(test)]
impl SelectedPasskeyCreation<'_> {
    pub(crate) async fn apply(self) -> Result<(), NookError> {
        let Self {
            credential_fingerprint,
            nook_name,
            observation,
            ceremony,
        } = self;

        let now = IsoTimestamp::from_trusted(Date::new_0().to_iso_string().into());
        DeviceAccessProfileKey::selected()
            .await?
            .update(DeviceAccessProfileMutation {
                intent: DeviceAccessProfileUpdateIntent::BestEffort,
                guard: StringUpdateGuard::WrappedCredentialFingerprint(credential_fingerprint),
                update: move |mut profile: DeviceAccessProfile| {
                    profile = profile.record_passkey_created(
                        credential_fingerprint,
                        nook_name,
                        observation,
                        now,
                        ceremony,
                    );
                    Ok(profile)
                },
            })
            .await
            .map(|_| ())
    }
}

pub(crate) struct AppPasskeyCreation<'a> {
    pub(crate) app_id: &'a str,
    pub(crate) credential_fingerprint: &'a str,
    pub(crate) nook_name: &'a str,
    pub(crate) observation: PasskeyBrowserObservation,
    pub(crate) ceremony: PasskeyCreationCeremony,
}
impl AppPasskeyCreation<'_> {
    pub(crate) async fn apply(self) -> Result<(), NookError> {
        let Self {
            app_id,
            credential_fingerprint,
            nook_name,
            observation,
            ceremony,
        } = self;

        let now = IsoTimestamp::from_trusted(Date::new_0().to_iso_string().into());
        DeviceAccessProfileKey::for_app_id(app_id)
            .await?
            .update(DeviceAccessProfileMutation {
                intent: DeviceAccessProfileUpdateIntent::BestEffort,
                guard: StringUpdateGuard::AppWrappedCredentialFingerprint {
                    app_id,
                    expected: credential_fingerprint,
                },
                update: move |mut profile: DeviceAccessProfile| {
                    profile = profile.record_passkey_created(
                        credential_fingerprint,
                        nook_name,
                        observation,
                        now,
                        ceremony,
                    );
                    Ok(profile)
                },
            })
            .await
            .map(|_| ())
    }
}

pub(crate) struct AppPasskeyUse<'a> {
    pub(crate) app_id: &'a str,
    pub(crate) credential_fingerprint: &'a str,
    pub(crate) observation: PasskeyBrowserObservation,
}
impl AppPasskeyUse<'_> {
    pub(crate) async fn apply(self) -> Result<(), NookError> {
        let Self {
            app_id,
            credential_fingerprint,
            observation,
        } = self;

        let now = IsoTimestamp::from_trusted(Date::new_0().to_iso_string().into());
        DeviceAccessProfileKey::for_app_id(app_id)
            .await?
            .update(DeviceAccessProfileMutation {
                intent: DeviceAccessProfileUpdateIntent::BestEffort,
                guard: StringUpdateGuard::AppWrappedCredentialFingerprint {
                    app_id,
                    expected: credential_fingerprint,
                },
                update: move |mut profile: DeviceAccessProfile| {
                    profile = profile.record_passkey_used(credential_fingerprint, observation, now);
                    Ok(profile)
                },
            })
            .await
            .map(|_| ())
    }
}

pub(crate) struct PasskeyProviderLabelUpdate<'a> {
    pub(crate) credential_fingerprint: &'a str,
    pub(crate) label: &'a str,
}
impl PasskeyProviderLabelUpdate<'_> {
    pub(crate) async fn apply(self) -> Result<(), NookError> {
        let Self {
            credential_fingerprint,
            label,
        } = self;

        let normalized = nook_core::PasskeyAccessProfile::normalize_provider_label(label)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let result = DeviceAccessProfileKey::selected()
            .await?
            .update(DeviceAccessProfileMutation {
                intent: DeviceAccessProfileUpdateIntent::Interactive,
                guard: StringUpdateGuard::WrappedCredentialFingerprint(credential_fingerprint),
                update: move |mut profile: DeviceAccessProfile| {
                    profile
                        .set_passkey_provider_label(credential_fingerprint, normalized)
                        .map_err(|error| NookError::Database(error.to_string()))
                },
            })
            .await?;
        match result {
            StringUpdateResult::Applied => Ok(()),
            StringUpdateResult::GuardRejected => Err(NookError::Database(
                "Passkey changed before its provider label was saved".to_owned(),
            )),
        }
    }
}

pub(crate) struct AppPasskeyNameUpdate<'a> {
    pub(crate) app_id: &'a str,
    pub(crate) credential_fingerprint: &'a str,
    pub(crate) name: &'a str,
}
impl AppPasskeyNameUpdate<'_> {
    pub(crate) async fn apply(self) -> Result<(), NookError> {
        let Self {
            app_id,
            credential_fingerprint,
            name,
        } = self;

        let normalized = nook_core::PasskeyAccessProfile::normalize_name(name)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let result = DeviceAccessProfileKey::for_app_id(app_id)
            .await?
            .update(DeviceAccessProfileMutation {
                intent: DeviceAccessProfileUpdateIntent::Interactive,
                guard: StringUpdateGuard::AppWrappedCredentialFingerprint {
                    app_id,
                    expected: credential_fingerprint,
                },
                update: move |mut profile: DeviceAccessProfile| {
                    profile
                        .set_passkey_name(credential_fingerprint, normalized)
                        .map_err(|error| NookError::Database(error.to_string()))
                },
            })
            .await?;
        match result {
            StringUpdateResult::Applied => Ok(()),
            StringUpdateResult::GuardRejected => Err(NookError::Database(
                "Passkey changed before its name was saved".to_owned(),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    #[cfg(all(target_arch = "wasm32", feature = "browser-wasm-tests"))]
    use crate::storage::identity_record;
    use futures_util::future;
    #[cfg(all(target_arch = "wasm32", feature = "browser-wasm-tests"))]
    use nook_core::AppKey;
    use nook_core::{
        DeviceId, DeviceIdentity, DeviceKeyProtectionSetup, IsoTimestamp,
        PasskeyAuthenticatorAttachment, PasskeyBackupState, PasskeyObservedBrowser,
        PasskeyObservedPlatform, PasskeyTransport, StoreId,
    };
    use rexie::Rexie;

    #[cfg(all(target_arch = "wasm32", feature = "browser-wasm-tests"))]
    use super::{AppPasskeyCreation, DeviceIdentityProtection, PasskeyProtectionInput};
    use super::{
        DEVICE_ACCESS_PROFILE_KEY, DeviceAccessProfile, DeviceAccessProfileDecodeResult,
        DeviceAccessProfileKey, DeviceAccessProfileUpdate, NookError, PasskeyAccessProfile,
        PasskeyBrowserObservation, PasskeyCreatedAtEvidence, PasskeyCreationCeremony,
        PasskeyLastUsedAtEvidence, PasskeyProviderLabelUpdate, PasskeyRecordMetadata,
        SelectedPasskeyCreation, VerifiedVaultAccessUpdate, WrappedDeviceIdentity, indexed_db,
    };
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);

    struct BrowserObservationFixture {
        browser: PasskeyObservedBrowser,
        platform: PasskeyObservedPlatform,
    }
    impl BrowserObservationFixture {
        const SAFARI_MACOS: Self = Self {
            browser: PasskeyObservedBrowser::Safari,
            platform: PasskeyObservedPlatform::MacOs,
        };
        fn observe(self) -> PasskeyBrowserObservation {
            PasskeyBrowserObservation {
                attachment: PasskeyAuthenticatorAttachment::Platform,
                transports: vec![PasskeyTransport::Internal],
                backup_state: PasskeyBackupState::Eligible,
                aaguid: AuthenticatorGuidEvidence::Reported("aaguid-one".to_owned()),
                browser: self.browser,
                platform: self.platform,
                legacy_client_environment: DiscardedClientEnvironment,
            }
        }
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn corrupt_and_future_profiles_degrade_to_empty_metadata() {
        assert_eq!(
            nook_core::DeviceAccessProfile::decode("not-json"),
            DeviceAccessProfileDecodeResult::RecoverableDefault
        );
        assert_eq!(
            nook_core::DeviceAccessProfile::decode(r#"{"version":999,"verifiedVaults":[]}"#),
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

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn passkey_creation_replaces_credential_metadata_and_usage_merges_observations()
    -> anyhow::Result<()> {
        let mut profile = DeviceAccessProfile::default();
        profile = profile.record_passkey_created(
            "passkey:first",
            "First credential",
            BrowserObservationFixture::SAFARI_MACOS.observe(),
            IsoTimestamp::from_trusted("2026-01-01T00:00:00.000Z".to_owned()),
            PasskeyCreationCeremony::RegistrationOnly,
        );
        assert_eq!(
            profile.require_passkey()?.last_used_at,
            PasskeyLastUsedAtEvidence::NotYetObserved
        );
        profile.require_passkey_mut()?.provider_label = "Bitwarden".to_owned();

        let mut replacement = BrowserObservationFixture::SAFARI_MACOS.observe();
        replacement.aaguid = AuthenticatorGuidEvidence::Reported("aaguid-two".to_owned());
        replacement.transports = vec![PasskeyTransport::Hybrid];
        profile = profile.record_passkey_created(
            "passkey:replacement",
            "Replacement credential",
            replacement,
            IsoTimestamp::from_trusted("2026-02-01T00:00:00.000Z".to_owned()),
            PasskeyCreationCeremony::RegistrationAndAssertion,
        );
        let passkey = profile.require_passkey()?;
        assert_eq!(passkey.nook_name, "Replacement credential");
        assert!(passkey.provider_label.is_empty());
        assert_eq!(
            passkey.observation.aaguid,
            AuthenticatorGuidEvidence::Reported("aaguid-two".to_owned())
        );
        assert_eq!(
            passkey.last_used_at,
            PasskeyLastUsedAtEvidence::Known {
                timestamp: IsoTimestamp::from_trusted("2026-02-01T00:00:00.000Z".to_owned())
            }
        );

        let usage = PasskeyBrowserObservation {
            attachment: PasskeyAuthenticatorAttachment::Unknown,
            transports: Vec::new(),
            backup_state: PasskeyBackupState::BackedUp,
            aaguid: AuthenticatorGuidEvidence::NotReported,
            browser: PasskeyObservedBrowser::Firefox,
            platform: PasskeyObservedPlatform::Linux,
            legacy_client_environment: DiscardedClientEnvironment,
        };
        profile = profile.record_passkey_used(
            "passkey:replacement",
            usage,
            IsoTimestamp::from_trusted("2026-03-01T00:00:00.000Z".to_owned()),
        );
        let passkey = profile.require_passkey()?;
        assert_eq!(passkey.observation.transports, [PasskeyTransport::Hybrid]);
        assert_eq!(
            passkey.observation.aaguid,
            AuthenticatorGuidEvidence::Reported("aaguid-two".to_owned())
        );
        assert_eq!(
            passkey.observation.backup_state,
            PasskeyBackupState::BackedUp
        );
        assert_eq!(passkey.observation.browser, PasskeyObservedBrowser::Firefox);
        assert_eq!(passkey.observation.platform, PasskeyObservedPlatform::Linux);
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn passkey_usage_clears_metadata_when_the_credential_fingerprint_changes() -> anyhow::Result<()>
    {
        let mut profile = DeviceAccessProfile::default();
        profile = profile.record_passkey_created(
            "passkey:old",
            "Old credential",
            BrowserObservationFixture::SAFARI_MACOS.observe(),
            IsoTimestamp::from_trusted("2026-01-01T00:00:00.000Z".to_owned()),
            PasskeyCreationCeremony::RegistrationOnly,
        );
        profile.require_passkey_mut()?.provider_label = "Old provider".to_owned();

        let recovered_observation = PasskeyBrowserObservation {
            attachment: PasskeyAuthenticatorAttachment::Unknown,
            transports: Vec::new(),
            backup_state: PasskeyBackupState::BackedUp,
            aaguid: AuthenticatorGuidEvidence::NotReported,
            browser: PasskeyObservedBrowser::Firefox,
            platform: PasskeyObservedPlatform::Linux,
            legacy_client_environment: DiscardedClientEnvironment,
        };
        profile = profile.record_passkey_used(
            "passkey:recovered",
            recovered_observation.clone(),
            IsoTimestamp::from_trusted("2026-02-01T00:00:00.000Z".to_owned()),
        );

        let passkey = profile.require_passkey()?;
        assert_eq!(passkey.credential_fingerprint, "passkey:recovered");
        assert!(passkey.nook_name.is_empty());
        assert!(passkey.provider_label.is_empty());
        assert_eq!(passkey.created_at, PasskeyCreatedAtEvidence::Unavailable);
        assert_eq!(passkey.observation, recovered_observation);
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn provider_label_update_rejects_a_replaced_credential() -> anyhow::Result<()> {
        let mut profile = DeviceAccessProfile::default();
        profile = profile.record_passkey_created(
            "passkey:current",
            "Current credential",
            BrowserObservationFixture::SAFARI_MACOS.observe(),
            IsoTimestamp::from_trusted("2026-01-01T00:00:00.000Z".to_owned()),
            PasskeyCreationCeremony::RegistrationOnly,
        );

        let rejection = profile
            .set_passkey_provider_label("passkey:stale", "Bitwarden".to_owned())
            .expect_err("stale credential rejects");
        let mut profile = rejection.profile;
        assert!(profile.require_passkey()?.provider_label.is_empty());

        profile = profile.set_passkey_provider_label("passkey:current", "Bitwarden".to_owned())?;
        assert_eq!(profile.require_passkey()?.provider_label, "Bitwarden");
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn provider_label_update_initializes_recoverable_missing_metadata() -> anyhow::Result<()> {
        let mut profile = DeviceAccessProfile::default();

        profile =
            profile.set_passkey_provider_label("passkey:current", "Proton Pass".to_owned())?;

        let passkey = profile.require_passkey()?;
        assert_eq!(passkey.credential_fingerprint, "passkey:current");
        assert_eq!(passkey.provider_label, "Proton Pass");
        assert_eq!(passkey.created_at, PasskeyCreatedAtEvidence::Unavailable);
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
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
                timestamp: IsoTimestamp::from_trusted("2026-01-01T00:00:00.000Z".to_owned())
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

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn verified_access_is_scoped_by_identity_and_store_and_refreshes_one_pair() -> anyhow::Result<()>
    {
        let mut profile = DeviceAccessProfile::default();
        let device_a = DeviceId::parse("0123456789abcdef")
            .map_err(|error| NookError::Database(error.to_string()))?;
        let device_b = DeviceId::parse("fedcba9876543210")
            .map_err(|error| NookError::Database(error.to_string()))?;
        let store_id = StoreId::parse("store_testtoken11")
            .map_err(|error| NookError::Database(error.to_string()))?;
        profile = profile.record_verified_vault_access(
            &device_a,
            &store_id,
            IsoTimestamp::from_trusted("2026-01-01T00:00:00.000Z".to_owned()),
        );
        profile = profile.record_verified_vault_access(
            &device_b,
            &store_id,
            IsoTimestamp::from_trusted("2026-02-01T00:00:00.000Z".to_owned()),
        );
        profile = profile.record_verified_vault_access(
            &device_a,
            &store_id,
            IsoTimestamp::from_trusted("2026-03-01T00:00:00.000Z".to_owned()),
        );

        assert_eq!(profile.verified_vaults.len(), 2);
        let refreshed = profile
            .verified_vaults
            .iter()
            .find(|entry| entry.device_id == device_a)
            .ok_or_else(|| anyhow::anyhow!("verified device and vault pair is missing"))?;
        assert_eq!(
            refreshed.verified_at,
            IsoTimestamp::from_trusted("2026-03-01T00:00:00.000Z".to_owned())
        );
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn profile_persistence_can_be_replaced_and_deleted() -> Result<(), NookError> {
        DeviceAccessProfileKey::clear_companion().await?;
        let mut profile = DeviceAccessProfile::default();
        profile = profile.record_passkey_created(
            "passkey:persisted",
            "Persisted credential",
            BrowserObservationFixture::SAFARI_MACOS.observe(),
            IsoTimestamp::from_trusted("2026-04-01T00:00:00.000Z".to_owned()),
            PasskeyCreationCeremony::RegistrationOnly,
        );
        DeviceAccessProfileKey::save_companion(&profile).await?;
        assert_eq!(
            DeviceAccessProfileKey::selected().await?.load().await?,
            profile
        );

        DeviceAccessProfileKey::clear_companion().await?;
        assert_eq!(
            DeviceAccessProfileKey::selected().await?.load().await?,
            DeviceAccessProfile::default()
        );
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn provider_label_recovers_missing_metadata_only_for_the_wrapped_passkey()
    -> Result<(), NookError> {
        let _ = Rexie::delete("nook_db").await;
        let setup = DeviceKeyProtectionSetup::generate()?;
        let output = nook_core::WebAuthnPrfOutput::try_from(vec![21u8; 32])?;
        let secret = setup.user_handle().derive_identity(&output)?;
        let identity = DeviceIdentity::from_secret_str(&secret)?;
        let credential_id = [7u8; 32];
        let typed_credential = nook_core::WebAuthnCredentialId::try_from(credential_id.to_vec())?;
        let wrapped = WrappedDeviceIdentity::passkey_derived(&PasskeyRecordMetadata {
            credential_id: &typed_credential,
            user_handle: setup.user_handle(),
            prf_input: setup.prf_input(),
        })?;
        NookDatabase::save_wrapped_device_identity(SaveWrappedDeviceIdentityRequest {
            device_id: identity.device_id().as_str(),
            record: &wrapped,
        })
        .await?;
        DeviceAccessProfileKey::clear_companion().await?;

        assert!(
            PasskeyProviderLabelUpdate {
                credential_fingerprint: "passkey:stale",
                label: "Bitwarden"
            }
            .apply()
            .await
            .is_err()
        );
        let credential_fingerprint =
            nook_core::PasskeyAccessProfile::credential_identifier(&credential_id);
        PasskeyProviderLabelUpdate {
            credential_fingerprint: &credential_fingerprint,
            label: "Bitwarden",
        }
        .apply()
        .await?;

        let profile = DeviceAccessProfileKey::selected().await?.load().await?;
        let passkey = profile
            .into_passkey()
            .map_err(|_| NookError::Database("Recovered passkey profile is missing".to_owned()))?;
        assert_eq!(passkey.credential_fingerprint, credential_fingerprint);
        assert_eq!(passkey.provider_label, "Bitwarden");
        let _ = Rexie::delete("nook_db").await;
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn stale_passkey_ceremony_cannot_overwrite_replaced_identity_metadata()
    -> Result<(), NookError> {
        let _ = Rexie::delete("nook_db").await;
        let setup = DeviceKeyProtectionSetup::generate()?;
        let identity = DeviceIdentity::generate()?;
        let current_credential = [8u8; 32];
        let typed_credential =
            nook_core::WebAuthnCredentialId::try_from(current_credential.to_vec())?;
        let current_fingerprint =
            nook_core::PasskeyAccessProfile::credential_identifier(&current_credential);
        let current_wrapped = WrappedDeviceIdentity::passkey_derived(&PasskeyRecordMetadata {
            credential_id: &typed_credential,
            user_handle: setup.user_handle(),
            prf_input: setup.prf_input(),
        })?;
        NookDatabase::save_wrapped_device_identity(SaveWrappedDeviceIdentityRequest {
            device_id: identity.device_id().as_str(),
            record: &current_wrapped,
        })
        .await?;

        SelectedPasskeyCreation {
            credential_fingerprint: &current_fingerprint,
            nook_name: "Current credential",
            observation: BrowserObservationFixture::SAFARI_MACOS.observe(),
            ceremony: PasskeyCreationCeremony::RegistrationOnly,
        }
        .apply()
        .await?;
        SelectedPasskeyCreation {
            credential_fingerprint: &nook_core::PasskeyAccessProfile::credential_identifier(
                &[7u8; 32],
            ),
            nook_name: "Stale credential",
            observation: BrowserObservationFixture::SAFARI_MACOS.observe(),
            ceremony: PasskeyCreationCeremony::RegistrationOnly,
        }
        .apply()
        .await?;

        let passkey = DeviceAccessProfileKey::selected()
            .await?
            .load()
            .await?
            .into_passkey()
            .map_err(|_| NookError::Database("Passkey profile is missing".to_owned()))?;
        assert_eq!(passkey.credential_fingerprint, current_fingerprint);
        assert_eq!(passkey.nook_name, "Current credential");
        let _ = Rexie::delete("nook_db").await;
        Ok(())
    }

    #[cfg(all(target_arch = "wasm32", feature = "browser-wasm-tests"))]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn app_scoped_passkey_update_ignores_another_tabs_shared_selection()
    -> Result<(), NookError> {
        let _ = Rexie::delete("nook_db").await;
        let first_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let first_setup = DeviceKeyProtectionSetup::generate()?;
        let first_credential = [31u8; 32];
        let typed_credential =
            nook_core::WebAuthnCredentialId::try_from(first_credential.to_vec())?;
        let output = nook_core::WebAuthnPrfOutput::try_from(vec![41u8; 32])?;
        let first_wrapped = DeviceIdentityProtection::new(&first_key.secret_string())
            .with_passkey(&PasskeyProtectionInput {
                credential_id: &typed_credential,
                user_handle: first_setup.user_handle(),
                prf_input: first_setup.prf_input(),
                prf_output: &output,
            })?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &first_key,
            record: &first_wrapped,
            prior_app_key: None,
            label: "Personal",
        })
        .await?;
        let companion_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let companion_id = DeviceId::parse(companion_key.app_id().as_str())
            .map_err(|error| NookError::Database(error.to_string()))?;
        let companion_store = nook_core::StoreId::generate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        VerifiedVaultAccessUpdate {
            device_id: &companion_id,
            store_id: &companion_store,
        }
        .apply()
        .await?;
        DeviceAccessProfileKey::selected().await?.migrate().await?;
        assert!(
            DeviceAccessProfileKey::companion()
                .load()
                .await?
                .verified_vaults
                .iter()
                .any(|access| access.device_id == companion_id)
        );
        let second_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &second_key,
            record: &second_wrapped,
            prior_app_key: None,
            label: "Work",
        })
        .await?;

        let first_fingerprint =
            nook_core::PasskeyAccessProfile::credential_identifier(&first_credential);
        AppPasskeyCreation {
            app_id: first_key.app_id().as_str(),
            credential_fingerprint: &first_fingerprint,
            nook_name: "Personal passkey",
            observation: BrowserObservationFixture::SAFARI_MACOS.observe(),
            ceremony: PasskeyCreationCeremony::RegistrationOnly,
        }
        .apply()
        .await?;

        let first_profile = DeviceAccessProfileKey::for_app_id(first_key.app_id().as_str())
            .await?
            .load()
            .await?;
        assert_eq!(
            first_profile
                .into_passkey()
                .map_err(|_| NookError::Database("First passkey profile is missing".to_owned()))?
                .nook_name,
            "Personal passkey"
        );
        assert_eq!(
            DeviceAccessProfileKey::for_app_id(second_key.app_id().as_str())
                .await?
                .load()
                .await?,
            DeviceAccessProfile::default()
        );
        let _ = Rexie::delete("nook_db").await;
        Ok(())
    }

    #[cfg(all(target_arch = "wasm32", feature = "browser-wasm-tests"))]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn concurrent_profile_migration_preserves_scoped_update() -> Result<(), NookError> {
        let _ = Rexie::delete("nook_db").await;
        let app_key = AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let wrapped =
            DeviceIdentityProtection::new(&app_key.secret_string()).with_pin("first-secret")?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &app_key,
            record: &wrapped,
            prior_app_key: None,
            label: "Personal",
        })
        .await?;
        let app_device_id = DeviceId::parse(app_key.app_id().as_str())
            .map_err(|error| NookError::Database(error.to_string()))?;
        let first_store = nook_core::StoreId::generate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let second_store = nook_core::StoreId::generate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let mut legacy = DeviceAccessProfile::default();
        legacy = legacy.record_verified_vault_access(
            &app_device_id,
            &first_store,
            IsoTimestamp::from_trusted("2026-08-24T03:00:00.000Z".to_owned()),
        );
        DeviceAccessProfileKey::save_companion(&legacy).await?;

        let (migration_result, update_result) = future::join(
            DeviceAccessProfileKey::selected().await?.migrate(),
            VerifiedVaultAccessUpdate {
                device_id: &app_device_id,
                store_id: &second_store,
            }
            .apply(),
        )
        .await;
        migration_result?;
        update_result?;

        let scoped = DeviceAccessProfileKey::for_app_id(app_key.app_id().as_str())
            .await?
            .load()
            .await?;
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
        assert!(matches!(
            NookDatabase::idb_get_string(DEVICE_ACCESS_PROFILE_KEY).await?,
            StoredStringRecord::MissingKey
        ));
        let _ = Rexie::delete("nook_db").await;
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn future_profile_is_preserved_during_best_effort_updates() -> Result<(), NookError> {
        const FUTURE_PROFILE: &str = r#"{"version":999,"futureField":"keep-me"}"#;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: DEVICE_ACCESS_PROFILE_KEY,
            value: FUTURE_PROFILE,
        })
        .await?;

        let device_id = DeviceId::parse("0123456789abcdef")
            .map_err(|error| NookError::Database(error.to_string()))?;
        let store_id = StoreId::parse("store_testtoken11")
            .map_err(|error| NookError::Database(error.to_string()))?;
        VerifiedVaultAccessUpdate {
            device_id: &device_id,
            store_id: &store_id,
        }
        .apply()
        .await?;
        assert!(
            PasskeyProviderLabelUpdate {
                credential_fingerprint: "passkey:future",
                label: "1Password"
            }
            .apply()
            .await
            .is_err()
        );
        assert_eq!(
            NookDatabase::idb_get_string(DEVICE_ACCESS_PROFILE_KEY).await?,
            StoredStringRecord::Stored((FUTURE_PROFILE).to_owned())
        );

        DeviceAccessProfileKey::clear_companion().await?;
        Ok(())
    }
}
