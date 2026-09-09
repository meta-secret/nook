#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Identity-scoped persistence and legacy migration for device-access profiles.

use crate::NookDatabase;
use crate::storage::{identity_record, indexed_db};
use crate::{IdbPutStringRequest, IndexedDbFallbackUpdate, IndexedDbMigration, NookError};
use nook_core::AppId;

use super::{
    DEVICE_ACCESS_PROFILE_KEY, DeviceAccessProfile, DeviceAccessProfileDecodeResult, migration,
};
use crate::storage::indexed_db::{StringUpdateGuard, StringUpdateResult};

const DEVICE_ACCESS_PROFILE_VERSION_ERROR: &str =
    "errors.device_access.profile_version_incompatible";

#[derive(Debug, PartialEq, Eq)]
pub(super) enum DeviceAccessProfileUpdate {
    Writable(DeviceAccessProfile),
    PreserveFutureVersion,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DeviceAccessProfileUpdateIntent {
    BestEffort,
    Interactive,
}

/// A resolved destination, not a replacement for the transaction's live guards.
///
/// ```compile_fail,E0603
/// use nook_wasm::storage::device_access::DeviceAccessProfileKey;
/// ```
pub(crate) struct DeviceAccessProfileKey {
    value: String,
    legacy_owner: Option<nook_core::LocalIdentityKeyringEntry>,
}

impl DeviceAccessProfileUpdate {
    pub(super) fn into_interactive_profile(self) -> Result<DeviceAccessProfile, NookError> {
        match self {
            Self::Writable(profile) => Ok(profile),
            Self::PreserveFutureVersion => Err(NookError::Database(
                DEVICE_ACCESS_PROFILE_VERSION_ERROR.to_owned(),
            )),
        }
    }
}

impl DeviceAccessProfileKey {
    pub(crate) async fn selected() -> Result<Self, NookError> {
        let keyring = NookDatabase::load_keyring().await?;
        let entry = NookDatabase::load_selected_entry().await?;
        let Some(entry) = entry else {
            return Ok(DeviceAccessProfileKey {
                value: DEVICE_ACCESS_PROFILE_KEY.to_owned(),
                legacy_owner: None,
            });
        };
        Ok(DeviceAccessProfileKey {
            value: format!("{DEVICE_ACCESS_PROFILE_KEY}:{}", entry.app_id()),
            legacy_owner: (keyring.entries().len() == 1).then_some(entry),
        })
    }
    pub(crate) async fn for_app_id(app_id: &str) -> Result<Self, NookError> {
        let app_id =
            AppId::parse(app_id).map_err(|error| NookError::Database(error.to_string()))?;
        let keyring = NookDatabase::load_keyring().await?;
        let Some(entry) = keyring
            .entries()
            .iter()
            .find(|entry| entry.app_id() == &app_id)
        else {
            return Err(NookError::Database(
                "Device access profile has no protected local app key".to_owned(),
            ));
        };
        Ok(DeviceAccessProfileKey {
            value: format!("{DEVICE_ACCESS_PROFILE_KEY}:{app_id}"),
            legacy_owner: (keyring.entries().len() == 1).then(|| entry.clone()),
        })
    }
    pub(super) async fn for_verified_app_id(app_id: &str) -> Result<Self, NookError> {
        let app_id =
            AppId::parse(app_id).map_err(|error| NookError::Database(error.to_string()))?;
        let keyring = NookDatabase::load_keyring().await?;
        if let Some(entry) = keyring
            .entries()
            .iter()
            .find(|entry| entry.app_id() == &app_id)
        {
            return Ok(DeviceAccessProfileKey {
                value: format!("{DEVICE_ACCESS_PROFILE_KEY}:{app_id}"),
                legacy_owner: (keyring.entries().len() == 1).then(|| entry.clone()),
            });
        }
        // Verified companion and extension sessions can prove vault access without
        // owning a wrapped local app key. Keep their evidence in the compatibility
        // profile used by those sessions.
        Ok(DeviceAccessProfileKey {
            value: DEVICE_ACCESS_PROFILE_KEY.to_owned(),
            legacy_owner: None,
        })
    }
    pub(crate) async fn load(self) -> Result<DeviceAccessProfile, NookError> {
        let raw = match NookDatabase::idb_get_string(&self.value).await? {
            Some(raw) => Some(raw),
            None if self.legacy_owner.is_some() => {
                NookDatabase::idb_get_string(DEVICE_ACCESS_PROFILE_KEY)
                    .await?
                    .filter(|raw| {
                        LegacyProfileAdmission {
                            owner: self.legacy_owner.as_ref(),
                        }
                        .accepts(raw)
                    })
            }
            None => None,
        };
        let Some(raw) = raw else {
            return Ok(DeviceAccessProfile::default());
        };
        Ok(match nook_core::DeviceAccessProfile::decode(&raw) {
            DeviceAccessProfileDecodeResult::Current(profile) => *profile,
            DeviceAccessProfileDecodeResult::RecoverableDefault
            | DeviceAccessProfileDecodeResult::FutureVersion => DeviceAccessProfile::default(),
        })
    }
    pub(crate) async fn migrate(self) -> Result<(), NookError> {
        if self.value == DEVICE_ACCESS_PROFILE_KEY {
            return Ok(());
        }
        let Some(entry) = self.legacy_owner else {
            return Ok(());
        };
        NookDatabase::idb_migrate_string_if(IndexedDbMigration {
            source_key: DEVICE_ACCESS_PROFILE_KEY,
            target_key: &self.value,
            can_migrate: move |legacy| match nook_core::DeviceAccessProfile::decode(legacy) {
                DeviceAccessProfileDecodeResult::Current(profile) => {
                    migration::LegacyProfileMembership {
                        profile: &profile,
                        entry: &entry,
                    }
                    .matches()
                }
                DeviceAccessProfileDecodeResult::RecoverableDefault
                | DeviceAccessProfileDecodeResult::FutureVersion => false,
            },
        })
        .await
    }
    pub(super) async fn update<F>(
        self,
        mutation: DeviceAccessProfileMutation<'_, F>,
    ) -> Result<StringUpdateResult, NookError>
    where
        F: FnOnce(&mut DeviceAccessProfile) -> Result<(), NookError>,
    {
        let fallback_key = self
            .legacy_owner
            .is_some()
            .then_some(DEVICE_ACCESS_PROFILE_KEY);
        let legacy_owner = self.legacy_owner;
        NookDatabase::idb_update_string_with_fallback(IndexedDbFallbackUpdate {
            key: &self.value,
            fallback_key: fallback_key,
            guard: mutation.guard,
            can_adopt_fallback: move |raw| {
                LegacyProfileAdmission {
                    owner: legacy_owner.as_ref(),
                }
                .accepts(raw)
            },
            update: move |raw| mutation.apply(raw),
        })
        .await
    }
    #[must_use]
    pub(crate) fn companion() -> Self {
        Self {
            value: DEVICE_ACCESS_PROFILE_KEY.to_owned(),
            legacy_owner: None,
        }
    }
    #[cfg(test)]
    pub(crate) async fn clear_companion() -> Result<(), NookError> {
        NookDatabase::idb_delete_key(DEVICE_ACCESS_PROFILE_KEY).await
    }
    #[cfg(test)]
    pub(super) async fn save_companion(profile: &DeviceAccessProfile) -> Result<(), NookError> {
        let json = serde_json::to_string(profile).map_err(|error| {
            NookError::IndexedDb(format!("Device access profile serialize error: {error}"))
        })?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: DEVICE_ACCESS_PROFILE_KEY,
            value: &json,
        })
        .await
    }
}

pub(super) struct DeviceAccessProfileMutation<'a, F> {
    pub(super) intent: DeviceAccessProfileUpdateIntent,
    pub(super) guard: StringUpdateGuard<'a>,
    pub(super) update: F,
}
impl<F> DeviceAccessProfileMutation<'_, F>
where
    F: FnOnce(&mut DeviceAccessProfile) -> Result<(), NookError>,
{
    fn apply(self, raw: Option<String>) -> Result<String, NookError> {
        let Self { intent, update, .. } = self;

        let disposition = DeviceAccessProfileUpdate::observe(raw.as_deref());
        let mut profile = match intent {
            DeviceAccessProfileUpdateIntent::Interactive => {
                disposition.into_interactive_profile()?
            }
            DeviceAccessProfileUpdateIntent::BestEffort => match disposition {
                DeviceAccessProfileUpdate::Writable(profile) => profile,
                DeviceAccessProfileUpdate::PreserveFutureVersion => {
                    return raw.ok_or_else(|| {
                        NookError::Database(
                            "Future device access profile disappeared during update.".to_owned(),
                        )
                    });
                }
            },
        };
        update(&mut profile)?;
        serde_json::to_string(&profile).map_err(|error| {
            NookError::IndexedDb(format!("Device access profile serialize error: {error}"))
        })
    }
}
struct LegacyProfileAdmission<'a> {
    owner: Option<&'a nook_core::LocalIdentityKeyringEntry>,
}
impl LegacyProfileAdmission<'_> {
    fn accepts(&self, raw: &str) -> bool {
        let owner = self.owner;

        let Some(owner) = owner else {
            return false;
        };
        match nook_core::DeviceAccessProfile::decode(raw) {
            DeviceAccessProfileDecodeResult::Current(profile) => {
                migration::LegacyProfileMembership {
                    profile: &profile,
                    entry: owner,
                }
                .matches()
            }
            DeviceAccessProfileDecodeResult::RecoverableDefault
            | DeviceAccessProfileDecodeResult::FutureVersion => false,
        }
    }
}
impl DeviceAccessProfileUpdate {
    #[must_use]
    pub(super) fn observe(raw: Option<&str>) -> Self {
        let Some(raw) = raw else {
            return DeviceAccessProfileUpdate::Writable(DeviceAccessProfile::default());
        };
        match nook_core::DeviceAccessProfile::decode(raw) {
            DeviceAccessProfileDecodeResult::Current(profile) => {
                DeviceAccessProfileUpdate::Writable(*profile)
            }
            DeviceAccessProfileDecodeResult::RecoverableDefault => {
                DeviceAccessProfileUpdate::Writable(DeviceAccessProfile::default())
            }
            DeviceAccessProfileDecodeResult::FutureVersion => {
                DeviceAccessProfileUpdate::PreserveFutureVersion
            }
        }
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::DEVICE_ACCESS_PROFILE_VERSION_ERROR;
    use crate::storage::indexed_db;
    use nook_core::{AppKey, DeviceId, IdentityId, IsoTimestamp, LocalIdentityKeyringEntry};
    use std::cell::Cell;

    use super::{
        DeviceAccessProfile, DeviceAccessProfileKey, DeviceAccessProfileMutation,
        DeviceAccessProfileUpdateIntent, LegacyProfileAdmission, NookError, StringUpdateGuard,
        StringUpdateResult,
    };
    use nook_core::DeviceIdentityProtection;
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn atomic_update_rechecks_legacy_profile_ownership() -> anyhow::Result<()> {
        const SOURCE_KEY: &str = "test-device-access-legacy-owner";
        const TARGET_KEY: &str = "test-device-access-scoped-owner";
        let selected = AppKey::generate()?;
        let companion = AppKey::generate()?;
        let wrapped =
            DeviceIdentityProtection::new(&selected.secret_string()).with_pin("selected-pin")?;
        let owner = LocalIdentityKeyringEntry::legacy(
            IdentityId::generate()?,
            selected.app_id().clone(),
            wrapped,
        );
        let mut companion_profile = DeviceAccessProfile::default();
        companion_profile.record_verified_vault_access(
            &DeviceId::parse(companion.app_id().as_str())?,
            &nook_core::StoreId::generate()?,
            IsoTimestamp::from_trusted("2026-08-25T01:00:00.000Z".to_owned()),
        );
        let companion_raw = serde_json::to_string(&companion_profile)?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: SOURCE_KEY,
            value: &companion_raw,
        })
        .await?;
        NookDatabase::idb_delete_key(TARGET_KEY).await?;

        let result = NookDatabase::idb_update_string_with_fallback(IndexedDbFallbackUpdate {
            key: TARGET_KEY,
            fallback_key: Some(SOURCE_KEY),
            guard: StringUpdateGuard::Unconditional,
            can_adopt_fallback: move |raw| {
                LegacyProfileAdmission {
                    owner: Some(&owner),
                }
                .accepts(raw)
            },
            update: |current| {
                assert!(current.is_none());
                serde_json::to_string(&DeviceAccessProfile::default()).map_err(|error| {
                    NookError::IndexedDb(format!("Test profile serialize error: {error}"))
                })
            },
        })
        .await?;

        assert_eq!(result, StringUpdateResult::Applied);
        assert_eq!(
            NookDatabase::idb_get_string(SOURCE_KEY).await?.as_deref(),
            Some(companion_raw.as_str())
        );
        assert!(NookDatabase::idb_get_string(TARGET_KEY).await?.is_some());
        NookDatabase::idb_delete_keys(&[SOURCE_KEY, TARGET_KEY]).await?;
        Ok(())
    }
    struct ProfileMutationFixture {
        key: String,
    }
    impl ProfileMutationFixture {
        fn new(name: &str) -> Self {
            Self {
                key: format!("device-profile-owner-test:{name}"),
            }
        }
        fn destination(&self) -> DeviceAccessProfileKey {
            DeviceAccessProfileKey {
                value: self.key.clone(),
                legacy_owner: None,
            }
        }
        async fn read(&self) -> Result<Option<String>, NookError> {
            NookDatabase::idb_get_string(&self.key).await
        }
        async fn write(&self, raw: &str) -> Result<(), NookError> {
            NookDatabase::idb_put_string(IdbPutStringRequest {
                key: &self.key,
                value: raw,
            })
            .await
        }
        async fn clear(self) -> Result<(), NookError> {
            NookDatabase::idb_delete_key(&self.key).await
        }
        fn expect_rejected(result: Result<StringUpdateResult, NookError>) -> anyhow::Result<()> {
            match result {
                Err(NookError::Database(message)) => {
                    assert_eq!(message, "test-profile-mutation-rejected");
                    Ok(())
                }
                Err(error) => Err(error.into()),
                Ok(_) => anyhow::bail!("rejected mutation unexpectedly succeeded"),
            }
        }
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn dropping_resolved_destination_does_not_change_profile() -> anyhow::Result<()> {
        let fixture = ProfileMutationFixture::new("drop");
        let original = r#" {"version":999,"verifiedVaults":[]} "#;
        fixture.write(original).await?;
        let destination = fixture.destination();
        assert_eq!(destination.value, fixture.key);
        drop(destination);
        assert_eq!(fixture.read().await?.as_deref(), Some(original));
        fixture.clear().await?;
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
    async fn rejected_mutation_does_not_publish_its_modified_profile() -> anyhow::Result<()> {
        let fixture = ProfileMutationFixture::new("rejected");
        let original = serde_json::to_string(&DeviceAccessProfile::default())?;
        fixture.write(&original).await?;
        let app = AppKey::generate()?;
        let device_id = DeviceId::parse(app.app_id().as_str())?;
        let store_id = nook_core::StoreId::generate()?;
        let called = Cell::new(false);
        let result = fixture
            .destination()
            .update(DeviceAccessProfileMutation {
                intent: DeviceAccessProfileUpdateIntent::Interactive,
                guard: StringUpdateGuard::Unconditional,
                update: |profile: &mut DeviceAccessProfile| {
                    called.set(true);
                    profile.record_verified_vault_access(
                        &device_id,
                        &store_id,
                        IsoTimestamp::from_trusted("2026-09-06T13:33:41.000Z".to_owned()),
                    );
                    Err(NookError::Database(
                        "test-profile-mutation-rejected".to_owned(),
                    ))
                },
            })
            .await;
        ProfileMutationFixture::expect_rejected(result)?;
        assert!(called.get());
        assert_eq!(fixture.read().await?.as_deref(), Some(original.as_str()));
        fixture.clear().await?;
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
    async fn future_profile_admission_never_calls_the_mutation() -> anyhow::Result<()> {
        let fixture = ProfileMutationFixture::new("future");
        let original = r#" {"version":999,"verifiedVaults":[],"futureField":"retained"} "#;
        fixture.write(original).await?;
        let called = Cell::new(false);
        let outcome = fixture
            .destination()
            .update(DeviceAccessProfileMutation {
                intent: DeviceAccessProfileUpdateIntent::BestEffort,
                guard: StringUpdateGuard::Unconditional,
                update: |_: &mut DeviceAccessProfile| {
                    called.set(true);
                    Ok(())
                },
            })
            .await?;
        assert_eq!(outcome, StringUpdateResult::Applied);
        assert!(!called.get());
        assert_eq!(fixture.read().await?.as_deref(), Some(original));
        let rejected = fixture
            .destination()
            .update(DeviceAccessProfileMutation {
                intent: DeviceAccessProfileUpdateIntent::Interactive,
                guard: StringUpdateGuard::Unconditional,
                update: |_: &mut DeviceAccessProfile| {
                    called.set(true);
                    Ok(())
                },
            })
            .await;
        match rejected {
            Err(NookError::Database(message)) => {
                assert_eq!(message, DEVICE_ACCESS_PROFILE_VERSION_ERROR);
            }
            Err(error) => return Err(error.into()),
            Ok(_) => anyhow::bail!("future metadata must reject interactive mutation"),
        }
        assert!(!called.get());
        assert_eq!(fixture.read().await?.as_deref(), Some(original));
        fixture.clear().await?;
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
    async fn guarded_rejection_skips_profile_admission() -> anyhow::Result<()> {
        let fixture = ProfileMutationFixture::new("guard");
        let original = "not-json";
        fixture.write(original).await?;
        let app = AppKey::generate()?;
        let called = Cell::new(false);
        let outcome = fixture
            .destination()
            .update(DeviceAccessProfileMutation {
                intent: DeviceAccessProfileUpdateIntent::Interactive,
                guard: StringUpdateGuard::AppWrappedCredentialFingerprint {
                    app_id: app.app_id().as_str(),
                    expected: "passkey:absent",
                },
                update: |_: &mut DeviceAccessProfile| {
                    called.set(true);
                    Ok(())
                },
            })
            .await?;
        assert_eq!(outcome, StringUpdateResult::GuardRejected);
        assert!(!called.get());
        assert_eq!(fixture.read().await?.as_deref(), Some(original));
        fixture.clear().await?;
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
    fn mutation_admission_reads_current_recoverable_and_absent_profiles() -> anyhow::Result<()> {
        let current = serde_json::to_string(&DeviceAccessProfile::default())?;
        for raw in [None, Some("malformed".to_owned()), Some(current.clone())] {
            let called = Cell::new(false);
            let stored = DeviceAccessProfileMutation {
                intent: DeviceAccessProfileUpdateIntent::Interactive,
                guard: StringUpdateGuard::Unconditional,
                update: |profile: &mut DeviceAccessProfile| {
                    called.set(true);
                    assert_eq!(profile, &DeviceAccessProfile::default());
                    Ok(())
                },
            }
            .apply(raw)?;
            assert!(called.get());
            assert_eq!(stored, current);
        }
        Ok(())
    }
}
