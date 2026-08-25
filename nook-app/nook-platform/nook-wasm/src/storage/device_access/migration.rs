//! Ownership proof for migrating the single-profile compatibility record.

use super::DeviceAccessProfile;

pub(super) fn profile_belongs_to_entry(
    profile: &DeviceAccessProfile,
    entry: &nook_core::LocalIdentityKeyringEntry,
) -> bool {
    let passkey_belongs = profile.passkey.as_ref().is_none_or(|passkey| {
        entry
            .wrapped_app_key()
            .credential_id_bytes()
            .is_ok_and(|credential_id| {
                nook_core::passkey_credential_identifier(&credential_id)
                    == passkey.credential_fingerprint
            })
    });
    passkey_belongs
        && profile
            .verified_vaults
            .iter()
            .all(|access| access.device_id.as_str() == entry.app_id().as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[wasm_bindgen_test::wasm_bindgen_test]
    fn compatibility_profile_requires_selected_app_ownership() -> anyhow::Result<()> {
        let selected = nook_core::AppKey::generate()?;
        let companion = nook_core::AppKey::generate()?;
        let wrapped =
            nook_core::wrap_device_identity_with_pin(&selected.secret_string(), "selected-secret")?;
        let entry = nook_core::LocalIdentityKeyringEntry::legacy(
            nook_core::IdentityId::generate()?,
            selected.app_id().clone(),
            wrapped,
        );
        let store_id = nook_core::generate_store_id()?;
        let mut selected_profile = DeviceAccessProfile::default();
        selected_profile.record_verified_vault_access(
            &nook_core::DeviceId::parse(selected.app_id().as_str())?,
            &store_id,
            nook_core::IsoTimestamp::from_trusted("2026-08-24T01:00:00.000Z".to_owned()),
        );
        assert!(profile_belongs_to_entry(&selected_profile, &entry));

        let mut companion_profile = DeviceAccessProfile::default();
        companion_profile.record_verified_vault_access(
            &nook_core::DeviceId::parse(companion.app_id().as_str())?,
            &store_id,
            nook_core::IsoTimestamp::from_trusted("2026-08-24T02:00:00.000Z".to_owned()),
        );
        assert!(!profile_belongs_to_entry(&companion_profile, &entry));
        Ok(())
    }
}
