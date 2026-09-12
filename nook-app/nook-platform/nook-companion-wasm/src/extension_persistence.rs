//! Typed WASM exports for extension persistence layout policy.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn extension_persistence_database_name(
    area: nook_companion_core::ExtensionPersistenceArea,
) -> String {
    area.database_name().to_owned()
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn extension_persistence_store_names(
    area: nook_companion_core::ExtensionPersistenceArea,
) -> Vec<String> {
    area.store_names()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn classify_extension_persistence_databases(
    input: nook_companion_core::ExtensionPersistenceObservation,
) -> nook_companion_core::ExtensionPersistenceDatabaseState {
    input.area.classify_database_names(&input.observed_names)
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn classify_extension_persistence_stores(
    input: nook_companion_core::ExtensionPersistenceObservation,
) -> nook_companion_core::ExtensionPersistenceStoreState {
    input.area.classify_store_names(&input.observed_names)
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn matching_extension_persistence_stores(
    input: nook_companion_core::ExtensionPersistenceObservation,
) -> Vec<String> {
    input.area.matching_store_names(&input.observed_names)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn exports_match_core_policy() {
        let area = nook_companion_core::ExtensionPersistenceArea::Pairing;
        assert_eq!(extension_persistence_database_name(area), "nook_extension");
        let database_observation = nook_companion_core::ExtensionPersistenceObservation {
            area,
            observed_names: vec!["nook_extension".to_owned()],
        };
        assert_eq!(
            classify_extension_persistence_databases(database_observation.clone()),
            nook_companion_core::ExtensionPersistenceDatabaseState::Present
        );
        let store_observation = nook_companion_core::ExtensionPersistenceObservation {
            area,
            observed_names: vec!["pairing".to_owned()],
        };
        assert_eq!(
            classify_extension_persistence_stores(store_observation.clone()),
            nook_companion_core::ExtensionPersistenceStoreState::Present
        );
        assert_eq!(extension_persistence_store_names(area), vec!["pairing"]);
        assert_eq!(
            matching_extension_persistence_stores(store_observation),
            vec!["pairing"]
        );
    }
}
