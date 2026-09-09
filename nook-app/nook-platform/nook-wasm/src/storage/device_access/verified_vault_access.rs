//! Persist the verified app-key/vault relationship in descriptive access metadata.
use super::{
    DeviceAccessProfile, DeviceAccessProfileKey, DeviceAccessProfileMutation,
    DeviceAccessProfileUpdateIntent, StringUpdateGuard,
};
use crate::NookError;
use js_sys::Date;
use nook_core::IsoTimestamp;

pub(crate) struct VerifiedVaultAccessUpdate<'a> {
    pub(crate) device_id: &'a nook_core::DeviceId,
    pub(crate) store_id: &'a nook_core::StoreId,
}
impl VerifiedVaultAccessUpdate<'_> {
    pub(crate) async fn apply(self) -> Result<(), NookError> {
        let Self {
            device_id,
            store_id,
        } = self;

        let now = IsoTimestamp::from_trusted(Date::new_0().to_iso_string().into());
        let profile_key = DeviceAccessProfileKey::for_verified_app_id(device_id.as_str()).await?;
        profile_key
            .update(DeviceAccessProfileMutation {
                intent: DeviceAccessProfileUpdateIntent::BestEffort,
                guard: StringUpdateGuard::Unconditional,
                update: move |profile: &mut DeviceAccessProfile| {
                    profile.record_verified_vault_access(device_id, store_id, now);
                    Ok(())
                },
            })
            .await
            .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::future;
    use nook_core::{DeviceId, StoreId};
    use wasm_bindgen_test::wasm_bindgen_test;
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn concurrent_verified_access_updates_preserve_both_relationships()
    -> Result<(), NookError> {
        DeviceAccessProfileKey::clear_companion().await?;
        let device_a = DeviceId::parse("0123456789abcdef")
            .map_err(|error| NookError::Database(error.to_string()))?;
        let device_b = DeviceId::parse("fedcba9876543210")
            .map_err(|error| NookError::Database(error.to_string()))?;
        let store_a = StoreId::parse("store_testtoken11")
            .map_err(|error| NookError::Database(error.to_string()))?;
        let store_b = StoreId::parse("store_testtoken12")
            .map_err(|error| NookError::Database(error.to_string()))?;
        let (first, second) = future::join(
            VerifiedVaultAccessUpdate {
                device_id: &device_a,
                store_id: &store_a,
            }
            .apply(),
            VerifiedVaultAccessUpdate {
                device_id: &device_b,
                store_id: &store_b,
            }
            .apply(),
        )
        .await;
        first?;
        second?;

        let profile = DeviceAccessProfileKey::selected().await?.load().await?;
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

        DeviceAccessProfileKey::clear_companion().await?;
        Ok(())
    }
}
