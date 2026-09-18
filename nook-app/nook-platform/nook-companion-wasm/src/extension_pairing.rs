//! WASM pairing-storage boundary delegates to the portable pairing-state domain.

use nook_companion_core::{
    ExtensionPairingState, ExtensionReadySetup, StoredExtensionPairingGrant,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_pairing_grant_storage_key(vault_store_id: &str) -> Result<String, JsError> {
    let store_id = nook_companion_core::PairingVaultId::parse(vault_store_id)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Ok(StoredExtensionPairingGrant::storage_key_for(&store_id))
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_pairing_setup_storage_key() -> String {
    nook_companion_core::EXTENSION_SETUP_KEY.to_owned()
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_vault_access_scope() -> nook_companion_core::ExtensionConnectScope {
    nook_companion_core::ExtensionConnectScope::VaultAccess
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_password_filling_scope() -> nook_companion_core::ExtensionConnectScope {
    nook_companion_core::ExtensionConnectScope::PasswordFilling
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_passkey_management_scope() -> nook_companion_core::ExtensionConnectScope {
    nook_companion_core::ExtensionConnectScope::PasskeyManagement
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_sync_provider_credentials_scope() -> nook_companion_core::ExtensionConnectScope {
    nook_companion_core::ExtensionConnectScope::SyncProviderCredentials
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn is_extension_connect_scope(value: &str) -> bool {
    nook_companion_core::ExtensionConnectScope::parse(value).is_ok()
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn admit_extension_pairing_vault_type(
    value: &str,
) -> Result<nook_companion_core::ExtensionPairingVaultType, JsError> {
    nook_companion_core::ExtensionPairingVaultType::parse(value)
        .map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn create_extension_pairing_state(
    input: nook_companion_core::CreateExtensionPairingStateInput,
) -> Result<nook_companion_core::ExtensionPairingState, JsError> {
    ExtensionPairingState::create(input).map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn refresh_extension_pairing_grant(
    input: nook_companion_core::RefreshExtensionPairingGrantInput,
) -> Result<nook_companion_core::ExtensionPairingState, JsError> {
    ExtensionPairingState::refresh_grant(input).map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn ordered_extension_pairing_grants(
    state: nook_companion_core::ExtensionPairingState,
) -> Vec<nook_companion_core::StoredExtensionPairingGrant> {
    state.ordered_grants()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn selected_extension_pairing_grant(
    state: nook_companion_core::ExtensionPairingState,
) -> nook_companion_core::SelectedExtensionPairingGrant {
    state.selected_grant()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn first_extension_pairing_grant(
    state: nook_companion_core::ExtensionPairingState,
) -> nook_companion_core::SelectedExtensionPairingGrant {
    state.first_grant()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_setup_after_pairing_grant_removal(
    input: nook_companion_core::ExtensionPairingGrantRemovalInput,
) -> nook_companion_core::ExtensionSetupAfterRemoval {
    input
        .state
        .setup_after_removal(&input.removed_vault_store_id)
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn is_stored_extension_pairing_grant_json(value: &str) -> bool {
    StoredExtensionPairingGrant::validate_json(value).is_ok()
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn is_extension_ready_setup_json(value: &str) -> bool {
    ExtensionReadySetup::validate_json(value).is_ok()
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_stored_extension_pairing_grant_json(
    value: &str,
) -> Result<StoredExtensionPairingGrant, JsError> {
    StoredExtensionPairingGrant::decode_json(value)
        .map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_extension_ready_setup_json(value: &str) -> Result<ExtensionReadySetup, JsError> {
    ExtensionReadySetup::decode_json(value).map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn migrate_legacy_extension_pairing_state_json(
    value: &str,
) -> Result<nook_companion_core::ExtensionPairingState, JsError> {
    ExtensionPairingState::migrate_legacy_json(value)
        .map_err(|error| JsError::new(&error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct PairingFixture;

    impl PairingFixture {
        fn approval() -> nook_companion_core::ExtensionPairingGrantApproval {
            nook_companion_core::ExtensionPairingGrantApproval {
                vault_type: nook_companion_core::ExtensionPairingVaultType::Simple,
                device_id: "device-test".to_owned(),
                device_public_key: "age1test".to_owned(),
                device_signing_public_key: "signing-test".to_owned(),
                device_label: "Nook Extension".to_owned(),
                vault_store_id: nook_companion_core::PairingVaultId::before_genesis_placeholder(),
                vault_name: "Personal".to_owned(),
                approved_at:
                    nook_companion_core::ExtensionPairingApprovalEpochMilliseconds::MINIMUM,
                scopes: vec![nook_companion_core::ExtensionConnectScope::PasswordFilling],
                sync_provider_count: 1.into(),
            }
        }

        fn imported_event_log(event_count: u32) -> nook_companion_core::ImportedExtensionEventLog {
            nook_companion_core::ImportedExtensionEventLog {
                vault_store_id: nook_companion_core::PairingVaultId::before_genesis_placeholder(),
                event_count: event_count.into(),
                heads: vec![format!("event-{event_count}")],
                access_granted: true,
            }
        }
    }

    #[test]
    fn admission_returns_the_typed_companion_vault_type() -> Result<(), JsError> {
        assert_eq!(
            admit_extension_pairing_vault_type("simple")?,
            nook_companion_core::ExtensionPairingVaultType::Simple
        );
        Ok(())
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn pairing_exports_preserve_creation_refresh_selection_and_json_validation()
    -> Result<(), String> {
        let created =
            create_extension_pairing_state(nook_companion_core::CreateExtensionPairingStateInput {
                grant: PairingFixture::approval(),
                imported: PairingFixture::imported_event_log(2),
                observed_at: "2026-09-05T00:00:01.000Z".to_owned(),
            })
            .map_err(|error| format!("create failed: {error:?}"))?;
        let grant = ordered_extension_pairing_grants(created.clone())
            .into_iter()
            .next()
            .ok_or_else(|| "created pairing state did not contain a grant".to_owned())?;
        assert_eq!(grant.event_count, 2.into());
        assert!(
            matches!(first_extension_pairing_grant(created.clone()), nook_companion_core::SelectedExtensionPairingGrant::Selected { grant } if grant.vault_store_id.as_str() == "store_abcdefghijk")
        );
        assert!(
            matches!(selected_extension_pairing_grant(created.clone()), nook_companion_core::SelectedExtensionPairingGrant::Selected { grant } if grant.vault_store_id.as_str() == "store_abcdefghijk")
        );
        let grant_json = serde_json::to_string(&grant).map_err(|error| error.to_string())?;
        assert!(is_stored_extension_pairing_grant_json(&grant_json));
        assert!(!is_stored_extension_pairing_grant_json("{}"));
        assert_eq!(
            decode_stored_extension_pairing_grant_json(&grant_json)
                .map_err(|error| format!("grant decode failed: {error:?}"))?,
            grant
        );
        #[cfg(target_arch = "wasm32")]
        assert!(decode_stored_extension_pairing_grant_json("{}").is_err());
        let setup = created
            .entries
            .iter()
            .find_map(|entry| match &entry.record {
                nook_companion_core::ExtensionPairingRecord::Setup(setup) => Some(setup.clone()),
                nook_companion_core::ExtensionPairingRecord::Grant(_) => None,
            })
            .ok_or_else(|| "created pairing state did not contain setup".to_owned())?;
        let setup_json = serde_json::to_string(&setup).map_err(|error| error.to_string())?;
        assert_eq!(
            decode_extension_ready_setup_json(&setup_json)
                .map_err(|error| format!("setup decode failed: {error:?}"))?,
            setup
        );
        #[cfg(target_arch = "wasm32")]
        assert!(decode_extension_ready_setup_json("{}").is_err());
        let refreshed = refresh_extension_pairing_grant(
            nook_companion_core::RefreshExtensionPairingGrantInput {
                grant,
                imported: PairingFixture::imported_event_log(4),
                observed_at: "2026-09-05T00:00:04.000Z".to_owned(),
                select: true,
            },
        )
        .map_err(|error| format!("refresh failed: {error:?}"))?;
        assert_eq!(
            ordered_extension_pairing_grants(refreshed.clone())
                .first()
                .ok_or_else(|| "refreshed pairing state did not contain a grant".to_owned())?
                .event_count,
            4.into()
        );
        assert!(matches!(
            extension_setup_after_pairing_grant_removal(
                nook_companion_core::ExtensionPairingGrantRemovalInput {
                    state: refreshed,
                    removed_vault_store_id:
                        nook_companion_core::PairingVaultId::before_genesis_placeholder(),
                }
            ),
            nook_companion_core::ExtensionSetupAfterRemoval::NoPairedVault
        ));
        #[cfg(target_arch = "wasm32")]
        assert!(migrate_legacy_extension_pairing_state_json("{").is_err());
        #[cfg(not(target_arch = "wasm32"))]
        assert!(nook_companion_core::ExtensionPairingState::migrate_legacy_json("{").is_err());
        Ok(())
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test::wasm_bindgen_test]
    fn admission_rejects_vault_types_outside_the_companion_vocabulary() {
        assert!(admit_extension_pairing_vault_type("sentinel").is_err());
        assert!(admit_extension_pairing_vault_type("external-value").is_err());
    }
}
