use nook_companion_core::{
    ExtensionConnectScope, ExtensionPersistenceArea, ExtensionPersistenceDatabaseState,
    ExtensionPersistenceObservation, ExtensionPersistenceStoreState,
};

#[test]
fn core_extension_scope_values_roundtrip_for_both_wasm_crates() {
    for scope in [
        ExtensionConnectScope::VaultAccess,
        ExtensionConnectScope::PasswordFilling,
        ExtensionConnectScope::PasskeyManagement,
        ExtensionConnectScope::SyncProviderCredentials,
    ] {
        assert_eq!(ExtensionConnectScope::parse(scope.as_str()), Ok(scope));
    }
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
fn companion_core_observation_preserves_present_database_projection() {
    let observation = ExtensionPersistenceObservation {
        area: ExtensionPersistenceArea::Pairing,
        observed_names: vec!["nook_extension".to_owned()],
    };
    assert_eq!(
        observation
            .area
            .classify_database_names(&observation.observed_names),
        ExtensionPersistenceDatabaseState::Present
    );
}

#[test]
fn companion_core_preserves_missing_store_rejection() {
    let observation = ExtensionPersistenceObservation {
        area: ExtensionPersistenceArea::Pairing,
        observed_names: vec!["unrelated".to_owned()],
    };
    assert_eq!(
        observation
            .area
            .classify_store_names(&observation.observed_names),
        ExtensionPersistenceStoreState::Absent
    );
}
