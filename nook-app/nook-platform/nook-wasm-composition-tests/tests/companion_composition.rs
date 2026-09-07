use nook_companion_core::{
    ExtensionConnectScope, ExtensionPersistenceArea, ExtensionPersistenceDatabaseState,
    ExtensionPersistenceObservation, ExtensionPersistenceStoreState,
};

#[test]
fn both_wasm_crates_share_core_extension_scope_values() {
    assert_eq!(
        nook_wasm::extension_vault_access_scope(),
        nook_companion_wasm::extension_vault_access_scope()
    );
    assert_eq!(
        nook_wasm::extension_password_filling_scope(),
        nook_companion_wasm::extension_password_filling_scope()
    );
    assert_eq!(
        nook_wasm::extension_passkey_management_scope(),
        nook_companion_wasm::extension_passkey_management_scope()
    );
    assert_eq!(
        nook_wasm::extension_sync_provider_credentials_scope(),
        nook_companion_wasm::extension_sync_provider_credentials_scope()
    );
}

#[test]
fn both_wasm_crates_reject_unknown_extension_scope() {
    assert!(!nook_wasm::is_extension_connect_scope("unknown"));
    assert!(!nook_companion_wasm::is_extension_connect_scope("unknown"));
    assert!(nook_wasm::is_extension_connect_scope(
        ExtensionConnectScope::VaultAccess.as_str()
    ));
}

#[test]
fn companion_core_observation_passes_directly_to_companion_wasm() {
    let observation = ExtensionPersistenceObservation {
        area: ExtensionPersistenceArea::Pairing,
        observed_names: vec!["nook_extension".to_owned()],
    };
    assert_eq!(
        nook_companion_wasm::classify_extension_persistence_databases(observation),
        ExtensionPersistenceDatabaseState::Present
    );
}

#[test]
fn companion_wasm_preserves_missing_store_rejection() {
    let observation = ExtensionPersistenceObservation {
        area: ExtensionPersistenceArea::Pairing,
        observed_names: vec!["unrelated".to_owned()],
    };
    assert_eq!(
        nook_companion_wasm::classify_extension_persistence_stores(observation),
        ExtensionPersistenceStoreState::Absent
    );
}
