#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Identity-scoped persistence for device-access profiles.

#[cfg(test)]
use crate::IdbPutStringRequest;
use crate::NookDatabase;
use crate::StoredStringRecord;
use crate::storage::identity_record::StoredIdentityProtection;
use crate::{IndexedDbUpdate, NookError};
use nook_core::AppId;

use super::{DEVICE_ACCESS_PROFILE_KEY, DeviceAccessProfile, DeviceAccessProfileDecodeResult};
use crate::storage::indexed_db::{StringUpdateGuard, StringUpdateResult};

const DEVICE_ACCESS_PROFILE_VERSION_ERROR: &str =
    "errors.device_access.profile_version_incompatible";

#[derive(Debug, PartialEq, Eq)]
pub(super) enum DeviceAccessProfileUpdate {
    Writable(Box<DeviceAccessProfile>),
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
}

impl DeviceAccessProfileUpdate {
    fn writable(profile: DeviceAccessProfile) -> Self {
        Self::Writable(Box::new(profile))
    }

    pub(super) fn into_interactive_profile(self) -> Result<DeviceAccessProfile, NookError> {
        match self {
            Self::Writable(profile) => Ok(*profile),
            Self::PreserveFutureVersion => Err(NookError::Database(
                DEVICE_ACCESS_PROFILE_VERSION_ERROR.to_owned(),
            )),
        }
    }
}

impl DeviceAccessProfileKey {
    fn scoped(app_id: &AppId) -> Self {
        Self {
            value: format!("{DEVICE_ACCESS_PROFILE_KEY}:{app_id}"),
        }
    }

    pub(crate) async fn selected() -> Result<Self, NookError> {
        Ok(match NookDatabase::load_selected_entry().await? {
            StoredIdentityProtection::Protected(entry) => Self::scoped(entry.app_id()),
            StoredIdentityProtection::Unprotected => Self::companion(),
        })
    }
    pub(crate) async fn for_app_id(app_id: &str) -> Result<Self, NookError> {
        let app_id =
            AppId::parse(app_id).map_err(|error| NookError::Database(error.to_string()))?;
        let keyring = NookDatabase::load_keyring().await?;
        if !keyring
            .entries()
            .iter()
            .any(|entry| entry.app_id() == &app_id)
        {
            return Err(NookError::Database(
                "Device access profile has no protected local app key".to_owned(),
            ));
        }
        Ok(Self::scoped(&app_id))
    }
    pub(super) async fn for_verified_app_id(app_id: &str) -> Result<Self, NookError> {
        let app_id =
            AppId::parse(app_id).map_err(|error| NookError::Database(error.to_string()))?;
        let keyring = NookDatabase::load_keyring().await?;
        if keyring
            .entries()
            .iter()
            .any(|entry| entry.app_id() == &app_id)
        {
            return Ok(Self::scoped(&app_id));
        }
        // Verified companion and extension sessions can prove vault access without
        // owning a wrapped local app key. Keep their evidence in the companion
        // profile used by those sessions.
        Ok(Self::companion())
    }
    pub(crate) async fn load(self) -> Result<DeviceAccessProfile, NookError> {
        let StoredStringRecord::Stored(raw) = NookDatabase::idb_get_string(&self.value).await?
        else {
            return Ok(DeviceAccessProfile::default());
        };
        Ok(match nook_core::DeviceAccessProfile::decode(&raw) {
            DeviceAccessProfileDecodeResult::Current(profile) => *profile,
            DeviceAccessProfileDecodeResult::RecoverableDefault
            | DeviceAccessProfileDecodeResult::FutureVersion => DeviceAccessProfile::default(),
        })
    }
    pub(super) async fn update<F>(
        self,
        mutation: DeviceAccessProfileMutation<'_, F>,
    ) -> Result<StringUpdateResult, NookError>
    where
        F: FnOnce(DeviceAccessProfile) -> Result<DeviceAccessProfile, NookError>,
    {
        NookDatabase::idb_update_string(IndexedDbUpdate {
            key: &self.value,
            guard: mutation.guard,
            update: move |raw| mutation.apply(raw),
        })
        .await
    }
    /// The profile of sessions that hold no protected local app key.
    #[must_use]
    pub(crate) fn companion() -> Self {
        Self {
            value: DEVICE_ACCESS_PROFILE_KEY.to_owned(),
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
    F: FnOnce(DeviceAccessProfile) -> Result<DeviceAccessProfile, NookError>,
{
    fn apply(self, raw: StoredStringRecord) -> Result<String, NookError> {
        let Self { intent, update, .. } = self;

        let disposition = DeviceAccessProfileUpdate::observe(&raw);
        let profile = match intent {
            DeviceAccessProfileUpdateIntent::Interactive => {
                disposition.into_interactive_profile()?
            }
            DeviceAccessProfileUpdateIntent::BestEffort => match disposition {
                DeviceAccessProfileUpdate::Writable(profile) => *profile,
                DeviceAccessProfileUpdate::PreserveFutureVersion => {
                    return match raw {
                        StoredStringRecord::Stored(raw) => Ok(raw),
                        StoredStringRecord::MissingKey => Err(NookError::Database(
                            "Future device access profile disappeared during update.".to_owned(),
                        )),
                    };
                }
            },
        };
        let profile = update(profile)?;
        serde_json::to_string(&profile).map_err(|error| {
            NookError::IndexedDb(format!("Device access profile serialize error: {error}"))
        })
    }
}
impl DeviceAccessProfileUpdate {
    #[must_use]
    pub(super) fn observe(raw: &StoredStringRecord) -> Self {
        let StoredStringRecord::Stored(raw) = raw else {
            return DeviceAccessProfileUpdate::writable(DeviceAccessProfile::default());
        };
        match nook_core::DeviceAccessProfile::decode(raw) {
            DeviceAccessProfileDecodeResult::Current(profile) => {
                DeviceAccessProfileUpdate::writable(*profile)
            }
            DeviceAccessProfileDecodeResult::RecoverableDefault => {
                DeviceAccessProfileUpdate::writable(DeviceAccessProfile::default())
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
    use crate::{IdbPutStringRequest, NookDatabase, StoredStringRecord};
    use nook_core::{AppKey, DeviceId, IsoTimestamp};
    use std::cell::Cell;

    use super::{
        DeviceAccessProfile, DeviceAccessProfileKey, DeviceAccessProfileMutation,
        DeviceAccessProfileUpdateIntent, NookError, StringUpdateGuard, StringUpdateResult,
    };
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);
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
            }
        }
        async fn read(&self) -> Result<StoredStringRecord, NookError> {
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
        assert_eq!(
            fixture.read().await?,
            StoredStringRecord::Stored((original).to_owned())
        );
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
                update: |profile: DeviceAccessProfile| {
                    called.set(true);
                    let _ = profile.record_verified_vault_access(
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
        assert_eq!(
            fixture.read().await?,
            StoredStringRecord::Stored(original.as_str().to_owned())
        );
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
                update: |profile: DeviceAccessProfile| {
                    called.set(true);
                    Ok(profile)
                },
            })
            .await?;
        assert_eq!(outcome, StringUpdateResult::Applied);
        assert!(!called.get());
        assert_eq!(
            fixture.read().await?,
            StoredStringRecord::Stored((original).to_owned())
        );
        let rejected = fixture
            .destination()
            .update(DeviceAccessProfileMutation {
                intent: DeviceAccessProfileUpdateIntent::Interactive,
                guard: StringUpdateGuard::Unconditional,
                update: |profile: DeviceAccessProfile| {
                    called.set(true);
                    Ok(profile)
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
        assert_eq!(
            fixture.read().await?,
            StoredStringRecord::Stored((original).to_owned())
        );
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
                update: |profile: DeviceAccessProfile| {
                    called.set(true);
                    Ok(profile)
                },
            })
            .await?;
        assert_eq!(outcome, StringUpdateResult::GuardRejected);
        assert!(!called.get());
        assert_eq!(
            fixture.read().await?,
            StoredStringRecord::Stored((original).to_owned())
        );
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
        for raw in [
            StoredStringRecord::MissingKey,
            StoredStringRecord::Stored("malformed".to_owned()),
            StoredStringRecord::Stored(current.clone()),
        ] {
            let called = Cell::new(false);
            let stored = DeviceAccessProfileMutation {
                intent: DeviceAccessProfileUpdateIntent::Interactive,
                guard: StringUpdateGuard::Unconditional,
                update: |profile: DeviceAccessProfile| {
                    called.set(true);
                    assert_eq!(profile, DeviceAccessProfile::default());
                    Ok(profile)
                },
            }
            .apply(raw)?;
            assert!(called.get());
            assert_eq!(stored, current);
        }
        Ok(())
    }
}
