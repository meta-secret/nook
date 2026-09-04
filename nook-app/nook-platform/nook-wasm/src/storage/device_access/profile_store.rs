//! Identity-scoped persistence and legacy migration for device-access profiles.

use crate::storage::identity_record;
use nook_core::AppId;

use crate::NookError;

use super::{
    DEVICE_ACCESS_PROFILE_KEY, DeviceAccessProfile, DeviceAccessProfileDecodeResult,
    decode_device_access_profile, migration,
};
#[cfg(test)]
use crate::storage::indexed_db::idb_put_string;
use crate::storage::indexed_db::{
    StringUpdateGuard, StringUpdateResult, idb_get_string, idb_migrate_string_if,
    idb_update_string_with_fallback,
};

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

pub(super) struct DeviceAccessProfileKey {
    value: String,
    legacy_owner: Option<nook_core::LocalIdentityKeyringEntry>,
}

async fn selected_device_access_profile_key() -> Result<DeviceAccessProfileKey, NookError> {
    let keyring = identity_record::load_keyring().await?;
    let entry = identity_record::load_selected_entry().await?;
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

async fn device_access_profile_key_for_app_id(
    app_id: &str,
) -> Result<DeviceAccessProfileKey, NookError> {
    let app_id = AppId::parse(app_id).map_err(|error| NookError::Database(error.to_string()))?;
    let keyring = identity_record::load_keyring().await?;
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

pub(super) async fn device_access_profile_key_for_verified_app_id(
    app_id: &str,
) -> Result<DeviceAccessProfileKey, NookError> {
    let app_id = AppId::parse(app_id).map_err(|error| NookError::Database(error.to_string()))?;
    let keyring = identity_record::load_keyring().await?;
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

#[cfg(test)]
pub(crate) async fn load_device_access_profile() -> Result<DeviceAccessProfile, NookError> {
    let profile_key = selected_device_access_profile_key().await?;
    load_device_access_profile_with_key(profile_key).await
}

pub(crate) async fn load_device_access_profile_for_app_id(
    app_id: &str,
) -> Result<DeviceAccessProfile, NookError> {
    let profile_key = device_access_profile_key_for_app_id(app_id).await?;
    load_device_access_profile_with_key(profile_key).await
}

pub(crate) async fn load_companion_device_access_profile() -> Result<DeviceAccessProfile, NookError>
{
    load_device_access_profile_with_key(DeviceAccessProfileKey {
        value: DEVICE_ACCESS_PROFILE_KEY.to_owned(),
        legacy_owner: None,
    })
    .await
}

async fn load_device_access_profile_with_key(
    profile_key: DeviceAccessProfileKey,
) -> Result<DeviceAccessProfile, NookError> {
    let raw = match idb_get_string(&profile_key.value).await? {
        Some(raw) => Some(raw),
        None if profile_key.legacy_owner.is_some() => idb_get_string(DEVICE_ACCESS_PROFILE_KEY)
            .await?
            .filter(|raw| legacy_profile_belongs_to_owner(raw, profile_key.legacy_owner.as_ref())),
        None => None,
    };
    let Some(raw) = raw else {
        return Ok(DeviceAccessProfile::default());
    };
    Ok(match decode_device_access_profile(&raw) {
        DeviceAccessProfileDecodeResult::Current(profile) => *profile,
        DeviceAccessProfileDecodeResult::RecoverableDefault
        | DeviceAccessProfileDecodeResult::FutureVersion => DeviceAccessProfile::default(),
    })
}

pub(crate) async fn migrate_legacy_device_access_profile_for_selected_identity()
-> Result<(), NookError> {
    let profile_key = selected_device_access_profile_key().await?;
    if profile_key.value == DEVICE_ACCESS_PROFILE_KEY {
        return Ok(());
    }
    let Some(entry) = profile_key.legacy_owner else {
        return Ok(());
    };
    idb_migrate_string_if(
        DEVICE_ACCESS_PROFILE_KEY,
        &profile_key.value,
        move |legacy| match decode_device_access_profile(legacy) {
            DeviceAccessProfileDecodeResult::Current(profile) => {
                migration::profile_belongs_to_entry(&profile, &entry)
            }
            DeviceAccessProfileDecodeResult::RecoverableDefault
            | DeviceAccessProfileDecodeResult::FutureVersion => false,
        },
    )
    .await
}

fn legacy_profile_belongs_to_owner(
    raw: &str,
    owner: Option<&nook_core::LocalIdentityKeyringEntry>,
) -> bool {
    let Some(owner) = owner else {
        return false;
    };
    match decode_device_access_profile(raw) {
        DeviceAccessProfileDecodeResult::Current(profile) => {
            migration::profile_belongs_to_entry(&profile, owner)
        }
        DeviceAccessProfileDecodeResult::RecoverableDefault
        | DeviceAccessProfileDecodeResult::FutureVersion => false,
    }
}

fn device_access_profile_for_update(raw: Option<&str>) -> DeviceAccessProfileUpdate {
    let Some(raw) = raw else {
        return DeviceAccessProfileUpdate::Writable(DeviceAccessProfile::default());
    };
    match decode_device_access_profile(raw) {
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

#[cfg(test)]
pub(super) async fn save_device_access_profile(
    profile: &DeviceAccessProfile,
) -> Result<(), NookError> {
    let json = serde_json::to_string(profile).map_err(|error| {
        NookError::IndexedDb(format!("Device access profile serialize error: {error}"))
    })?;
    idb_put_string(DEVICE_ACCESS_PROFILE_KEY, &json).await
}

pub(super) async fn update_device_access_profile<F>(
    intent: DeviceAccessProfileUpdateIntent,
    guard: StringUpdateGuard<'_>,
    update: F,
) -> Result<StringUpdateResult, NookError>
where
    F: FnOnce(&mut DeviceAccessProfile) -> Result<(), NookError>,
{
    let profile_key = selected_device_access_profile_key().await?;
    update_device_access_profile_with_key(profile_key, intent, guard, update).await
}

pub(super) async fn update_device_access_profile_for_app_id<F>(
    app_id: &str,
    intent: DeviceAccessProfileUpdateIntent,
    guard: StringUpdateGuard<'_>,
    update: F,
) -> Result<StringUpdateResult, NookError>
where
    F: FnOnce(&mut DeviceAccessProfile) -> Result<(), NookError>,
{
    let profile_key = device_access_profile_key_for_app_id(app_id).await?;
    update_device_access_profile_with_key(profile_key, intent, guard, update).await
}

pub(super) async fn update_device_access_profile_with_key<F>(
    profile_key: DeviceAccessProfileKey,
    intent: DeviceAccessProfileUpdateIntent,
    guard: StringUpdateGuard<'_>,
    update: F,
) -> Result<StringUpdateResult, NookError>
where
    F: FnOnce(&mut DeviceAccessProfile) -> Result<(), NookError>,
{
    let fallback_key = profile_key
        .legacy_owner
        .is_some()
        .then_some(DEVICE_ACCESS_PROFILE_KEY);
    let legacy_owner = profile_key.legacy_owner;
    idb_update_string_with_fallback(
        &profile_key.value,
        fallback_key,
        guard,
        move |raw| legacy_profile_belongs_to_owner(raw, legacy_owner.as_ref()),
        move |raw| {
            let disposition = device_access_profile_for_update(raw.as_deref());
            let mut profile = match intent {
                DeviceAccessProfileUpdateIntent::Interactive => {
                    disposition.into_interactive_profile()?
                }
                DeviceAccessProfileUpdateIntent::BestEffort => match disposition {
                    DeviceAccessProfileUpdate::Writable(profile) => profile,
                    DeviceAccessProfileUpdate::PreserveFutureVersion => {
                        return raw.ok_or_else(|| {
                            NookError::Database(
                                "Future device access profile disappeared during update."
                                    .to_owned(),
                            )
                        });
                    }
                },
            };
            update(&mut profile)?;
            serde_json::to_string(&profile).map_err(|error| {
                NookError::IndexedDb(format!("Device access profile serialize error: {error}"))
            })
        },
    )
    .await
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use crate::storage::indexed_db;
    use nook_core::{AppKey, DeviceId, IdentityId, IsoTimestamp, LocalIdentityKeyringEntry};

    use super::*;
    use crate::storage::indexed_db::{idb_delete_keys, idb_put_string};
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn atomic_update_rechecks_legacy_profile_ownership() -> anyhow::Result<()> {
        const SOURCE_KEY: &str = "test-device-access-legacy-owner";
        const TARGET_KEY: &str = "test-device-access-scoped-owner";
        let selected = AppKey::generate()?;
        let companion = AppKey::generate()?;
        let wrapped =
            nook_core::wrap_device_identity_with_pin(&selected.secret_string(), "selected-pin")?;
        let owner = LocalIdentityKeyringEntry::legacy(
            IdentityId::generate()?,
            selected.app_id().clone(),
            wrapped,
        );
        let mut companion_profile = DeviceAccessProfile::default();
        companion_profile.record_verified_vault_access(
            &DeviceId::parse(companion.app_id().as_str())?,
            &nook_core::generate_store_id()?,
            IsoTimestamp::from_trusted("2026-08-25T01:00:00.000Z".to_owned()),
        );
        let companion_raw = serde_json::to_string(&companion_profile)?;
        idb_put_string(SOURCE_KEY, &companion_raw).await?;
        indexed_db::idb_delete_key(TARGET_KEY).await?;

        let result = idb_update_string_with_fallback(
            TARGET_KEY,
            Some(SOURCE_KEY),
            StringUpdateGuard::Unconditional,
            move |raw| legacy_profile_belongs_to_owner(raw, &Some(owner)),
            |current| {
                assert!(current.is_none());
                serde_json::to_string(&DeviceAccessProfile::default()).map_err(|error| {
                    NookError::IndexedDb(format!("Test profile serialize error: {error}"))
                })
            },
        )
        .await?;

        assert_eq!(result, StringUpdateResult::Applied);
        assert_eq!(
            idb_get_string(SOURCE_KEY).await?.as_deref(),
            Some(companion_raw.as_str())
        );
        assert!(idb_get_string(TARGET_KEY).await?.is_some());
        idb_delete_keys(&[SOURCE_KEY, TARGET_KEY]).await?;
        Ok(())
    }
}
