//! Typed WASM exports for extension persistence layout policy.

use wasm_bindgen::JsError;
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
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn classify_extension_persistence_databases(
    input: &tsify::Ts<nook_companion_core::ExtensionPersistenceObservation>,
) -> Result<nook_companion_core::ExtensionPersistenceDatabaseState, wasm_bindgen::JsError> {
    let input = input
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { input.area.classify_database_names(&input.observed_names) };
    Ok(result)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn classify_extension_persistence_stores(
    input: &tsify::Ts<nook_companion_core::ExtensionPersistenceObservation>,
) -> Result<nook_companion_core::ExtensionPersistenceStoreState, wasm_bindgen::JsError> {
    let input = input
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { input.area.classify_store_names(&input.observed_names) };
    Ok(result)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn matching_extension_persistence_stores(
    input: &tsify::Ts<nook_companion_core::ExtensionPersistenceObservation>,
) -> Result<Vec<String>, wasm_bindgen::JsError> {
    let input = input
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { input.area.matching_store_names(&input.observed_names) };
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::ExtensionPersistenceArea;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::ExtensionPersistenceDatabaseState;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::ExtensionPersistenceStoreState;

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn exports_match_core_policy() {
        let area = ExtensionPersistenceArea::Pairing;
        assert_eq!(extension_persistence_database_name(area), "nook_extension");
        let database_observation = nook_companion_core::ExtensionPersistenceObservation {
            area,
            observed_names: vec!["nook_extension".to_owned()],
        };
        assert_eq!(
            (database_observation.clone())
                .area
                .classify_database_names(&(database_observation.clone()).observed_names),
            ExtensionPersistenceDatabaseState::Present
        );
        let store_observation = nook_companion_core::ExtensionPersistenceObservation {
            area,
            observed_names: vec!["pairing".to_owned()],
        };
        assert_eq!(
            (store_observation.clone())
                .area
                .classify_store_names(&(store_observation.clone()).observed_names),
            ExtensionPersistenceStoreState::Present
        );
        assert_eq!(extension_persistence_store_names(area), vec!["pairing"]);
        assert_eq!(
            (store_observation)
                .area
                .matching_store_names(&(store_observation).observed_names),
            vec!["pairing"]
        );
    }
}
