//! WASM pairing-storage boundary delegates to the portable pairing-state domain.

use nook_companion_core::ExtensionConnectScope;
use nook_companion_core::ExtensionPairingVaultType;
use nook_companion_core::PairingVaultId;
use nook_companion_core::{
    ExtensionPairingState, ExtensionReadySetup, StoredExtensionPairingGrant,
};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_pairing_grant_storage_key(vault_store_id: &str) -> Result<String, JsError> {
    let store_id =
        PairingVaultId::parse(vault_store_id).map_err(|error| JsError::new(&error.to_string()))?;
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
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_vault_access_scope()
-> Result<tsify::Ts<nook_companion_core::ExtensionConnectScope>, wasm_bindgen::JsError> {
    let result = { ExtensionConnectScope::VaultAccess };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_password_filling_scope()
-> Result<tsify::Ts<nook_companion_core::ExtensionConnectScope>, wasm_bindgen::JsError> {
    let result = { ExtensionConnectScope::PasswordFilling };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_passkey_management_scope()
-> Result<tsify::Ts<nook_companion_core::ExtensionConnectScope>, wasm_bindgen::JsError> {
    let result = { ExtensionConnectScope::PasskeyManagement };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_sync_provider_credentials_scope()
-> Result<tsify::Ts<nook_companion_core::ExtensionConnectScope>, wasm_bindgen::JsError> {
    let result = { ExtensionConnectScope::SyncProviderCredentials };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn is_extension_connect_scope(value: &str) -> bool {
    ExtensionConnectScope::parse(value).is_ok()
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn admit_extension_pairing_vault_type(
    value: &str,
) -> Result<tsify::Ts<nook_companion_core::ExtensionPairingVaultType>, wasm_bindgen::JsError> {
    let result = ExtensionPairingVaultType::parse(value)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn create_extension_pairing_state(
    input: &tsify::Ts<nook_companion_core::CreateExtensionPairingStateInput>,
) -> Result<tsify::Ts<nook_companion_core::ExtensionPairingState>, wasm_bindgen::JsError> {
    let input = input
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let result =
        ExtensionPairingState::create(input).map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn refresh_extension_pairing_grant(
    input: &tsify::Ts<nook_companion_core::RefreshExtensionPairingGrantInput>,
) -> Result<tsify::Ts<nook_companion_core::ExtensionPairingState>, wasm_bindgen::JsError> {
    let input = input
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let result = ExtensionPairingState::refresh_grant(input)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn ordered_extension_pairing_grants(
    state: &tsify::Ts<nook_companion_core::ExtensionPairingState>,
) -> Result<Vec<tsify::Ts<nook_companion_core::StoredExtensionPairingGrant>>, wasm_bindgen::JsError>
{
    let state = state
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { state.ordered_grants() };
    result
        .iter()
        .map(Tsify::into_ts)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn selected_extension_pairing_grant(
    state: &tsify::Ts<nook_companion_core::ExtensionPairingState>,
) -> Result<tsify::Ts<nook_companion_core::SelectedExtensionPairingGrant>, wasm_bindgen::JsError> {
    let state = state
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { state.selected_grant() };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn first_extension_pairing_grant(
    state: &tsify::Ts<nook_companion_core::ExtensionPairingState>,
) -> Result<tsify::Ts<nook_companion_core::SelectedExtensionPairingGrant>, wasm_bindgen::JsError> {
    let state = state
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { state.first_grant() };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extension_setup_after_pairing_grant_removal(
    input: &tsify::Ts<nook_companion_core::ExtensionPairingGrantRemovalInput>,
) -> Result<tsify::Ts<nook_companion_core::ExtensionSetupAfterRemoval>, wasm_bindgen::JsError> {
    let input = input
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        input
            .state
            .setup_after_removal(&input.removed_vault_store_id)
    };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
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
) -> Result<tsify::Ts<StoredExtensionPairingGrant>, wasm_bindgen::JsError> {
    let result = StoredExtensionPairingGrant::decode_json(value)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_extension_ready_setup_json(
    value: &str,
) -> Result<tsify::Ts<ExtensionReadySetup>, wasm_bindgen::JsError> {
    let result = ExtensionReadySetup::decode_json(value)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn migrate_legacy_extension_pairing_state_json(
    value: &str,
) -> Result<tsify::Ts<nook_companion_core::ExtensionPairingState>, wasm_bindgen::JsError> {
    let result = ExtensionPairingState::migrate_legacy_json(value)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_companion_core::ExtensionConnectScope;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::ExtensionPairingApprovalEpochMilliseconds;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::ExtensionPairingRecord;
    use nook_companion_core::ExtensionPairingState;
    use nook_companion_core::ExtensionPairingVaultType;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::ExtensionSetupAfterRemoval;
    use nook_companion_core::PairingVaultId;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::SelectedExtensionPairingGrant;

    struct PairingFixture;

    impl PairingFixture {
        fn approval() -> nook_companion_core::ExtensionPairingGrantApproval {
            nook_companion_core::ExtensionPairingGrantApproval {
                vault_type: ExtensionPairingVaultType::Simple,
                device_id: "device-test".to_owned(),
                device_public_key: "age1test".to_owned(),
                device_signing_public_key: "signing-test".to_owned(),
                device_label: "Nook Extension".to_owned(),
                vault_store_id: PairingVaultId::before_genesis_placeholder(),
                vault_name: "Personal".to_owned(),
                approved_at: ExtensionPairingApprovalEpochMilliseconds::MINIMUM,
                scopes: vec![ExtensionConnectScope::PasswordFilling],
                sync_provider_count: 1.into(),
            }
        }

        fn imported_event_log(event_count: u32) -> nook_companion_core::ImportedExtensionEventLog {
            nook_companion_core::ImportedExtensionEventLog {
                vault_store_id: PairingVaultId::before_genesis_placeholder(),
                event_count: event_count.into(),
                heads: vec![format!("event-{event_count}")],
                access_granted: true,
            }
        }
    }

    #[test]
    fn admission_returns_the_typed_companion_vault_type() -> Result<(), JsError> {
        assert_eq!(
            ExtensionPairingVaultType::parse("simple")?,
            ExtensionPairingVaultType::Simple
        );
        Ok(())
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn pairing_exports_preserve_creation_refresh_selection_and_json_validation()
    -> Result<(), String> {
        let created =
            ExtensionPairingState::create(nook_companion_core::CreateExtensionPairingStateInput {
                grant: PairingFixture::approval(),
                imported: PairingFixture::imported_event_log(2),
                observed_at: "2026-09-05T00:00:01.000Z".to_owned(),
            })
            .map_err(|error| format!("create failed: {error:?}"))?;
        let grant = (created.clone())
            .ordered_grants()
            .into_iter()
            .next()
            .ok_or_else(|| "created pairing state did not contain a grant".to_owned())?;
        assert_eq!(grant.event_count, 2.into());
        assert!(
            matches!((created.clone()).first_grant(), SelectedExtensionPairingGrant::Selected { grant } if grant.vault_store_id.as_str() == "store_abcdefghijk")
        );
        assert!(
            matches!((created.clone()).selected_grant(), SelectedExtensionPairingGrant::Selected { grant } if grant.vault_store_id.as_str() == "store_abcdefghijk")
        );
        let grant_json = serde_json::to_string(&grant).map_err(|error| error.to_string())?;
        assert!(is_stored_extension_pairing_grant_json(&grant_json));
        assert!(!is_stored_extension_pairing_grant_json("{}"));
        assert_eq!(
            StoredExtensionPairingGrant::decode_json(&grant_json)
                .map_err(|error| format!("grant decode failed: {error:?}"))?,
            grant
        );
        #[cfg(target_arch = "wasm32")]
        assert!(StoredExtensionPairingGrant::decode_json("{}").is_err());
        let setup = created
            .entries
            .iter()
            .find_map(|entry| match &entry.record {
                ExtensionPairingRecord::Setup(setup) => Some(setup.clone()),
                ExtensionPairingRecord::Grant(_) => None,
            })
            .ok_or_else(|| "created pairing state did not contain setup".to_owned())?;
        let setup_json = serde_json::to_string(&setup).map_err(|error| error.to_string())?;
        assert_eq!(
            ExtensionReadySetup::decode_json(&setup_json)
                .map_err(|error| format!("setup decode failed: {error:?}"))?,
            setup
        );
        #[cfg(target_arch = "wasm32")]
        assert!(ExtensionReadySetup::decode_json("{}").is_err());
        let refreshed = ExtensionPairingState::refresh_grant(
            nook_companion_core::RefreshExtensionPairingGrantInput {
                grant,
                imported: PairingFixture::imported_event_log(4),
                observed_at: "2026-09-05T00:00:04.000Z".to_owned(),
                select: true,
            },
        )
        .map_err(|error| format!("refresh failed: {error:?}"))?;
        assert_eq!(
            (refreshed.clone())
                .ordered_grants()
                .first()
                .ok_or_else(|| "refreshed pairing state did not contain a grant".to_owned())?
                .event_count,
            4.into()
        );
        assert!(matches!(
            refreshed.setup_after_removal(&PairingVaultId::before_genesis_placeholder()),
            ExtensionSetupAfterRemoval::NoPairedVault
        ));
        #[cfg(target_arch = "wasm32")]
        assert!(migrate_legacy_extension_pairing_state_json("{").is_err());
        #[cfg(not(target_arch = "wasm32"))]
        assert!(ExtensionPairingState::migrate_legacy_json("{").is_err());
        Ok(())
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test::wasm_bindgen_test]
    fn admission_rejects_vault_types_outside_the_companion_vocabulary() {
        assert!(ExtensionPairingVaultType::try_from("sentinel").is_err());
        assert!(ExtensionPairingVaultType::try_from("external-value").is_err());
    }
}
