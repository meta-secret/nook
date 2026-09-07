#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Ownership proof for migrating the single-profile compatibility record.

use super::DeviceAccessProfile;

pub(super) struct LegacyProfileMembership<'a> {
    pub(super) profile: &'a DeviceAccessProfile,
    pub(super) entry: &'a nook_core::LocalIdentityKeyringEntry,
}
impl LegacyProfileMembership<'_> {
    #[must_use]
    pub(super) fn matches(&self) -> bool {
        let Self { profile, entry } = self;

        let passkey_belongs = profile.passkey.as_ref().is_none_or(|passkey| {
            entry
                .wrapped_app_key()
                .credential_id()
                .is_ok_and(|credential_id| {
                    nook_core::PasskeyAccessProfile::credential_identifier(credential_id.as_ref())
                        == passkey.credential_fingerprint
                })
        });
        passkey_belongs
            && profile
                .verified_vaults
                .iter()
                .all(|access| access.device_id.as_str() == entry.app_id().as_str())
    }
}

#[cfg(test)]
mod tests {
    use nook_core::{AppKey, DeviceId, IdentityId, IsoTimestamp, LocalIdentityKeyringEntry};

    use super::{DeviceAccessProfile, LegacyProfileMembership};
    use nook_core::DeviceIdentityProtection;

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test::wasm_bindgen_test]
    fn compatibility_profile_requires_selected_app_ownership() -> anyhow::Result<()> {
        let selected = AppKey::generate()?;
        let companion = AppKey::generate()?;
        let wrapped =
            DeviceIdentityProtection::new(&selected.secret_string()).with_pin("selected-secret")?;
        let entry = LocalIdentityKeyringEntry::legacy(
            IdentityId::generate()?,
            selected.app_id().clone(),
            wrapped,
        );
        let store_id = nook_core::StoreId::generate()?;
        let mut selected_profile = DeviceAccessProfile::default();
        selected_profile.record_verified_vault_access(
            &DeviceId::parse(selected.app_id().as_str())?,
            &store_id,
            IsoTimestamp::from_trusted("2026-08-24T01:00:00.000Z".to_owned()),
        );
        assert!(
            LegacyProfileMembership {
                profile: &selected_profile,
                entry: &entry
            }
            .matches()
        );

        let mut companion_profile = DeviceAccessProfile::default();
        companion_profile.record_verified_vault_access(
            &DeviceId::parse(companion.app_id().as_str())?,
            &store_id,
            IsoTimestamp::from_trusted("2026-08-24T02:00:00.000Z".to_owned()),
        );
        assert!(
            !LegacyProfileMembership {
                profile: &companion_profile,
                entry: &entry
            }
            .matches()
        );
        Ok(())
    }
}
