//! Immutable application capability selected by a thin leaf artifact.
//!
//! The featureless shared bridge compiles once. Each leaf cdylib calls
//! [`configure_vault_application`] from its `wasm_bindgen(start)` hook before
//! JavaScript can construct a manager or invoke an export.

use std::cell::Cell;

thread_local! {
    static COMPILED_APPLICATION: Cell<Option<nook_core::VaultApplication>> = const { Cell::new(None) };
}

pub fn configure_vault_application(application: nook_core::VaultApplication) {
    COMPILED_APPLICATION.with(|compiled| match compiled.get() {
        None => compiled.set(Some(application)),
        Some(existing) if existing == application => {}
        Some(existing) => panic!(
            "WASM application already configured as {}; cannot change it to {}",
            existing.as_str(),
            application.as_str()
        ),
    });
}

#[must_use]
pub fn compiled_vault_application() -> nook_core::VaultApplication {
    COMPILED_APPLICATION.with(|compiled| {
        compiled.get().unwrap_or_else(|| {
            #[cfg(test)]
            {
                nook_core::VaultApplication::UnifiedDevelopment
            }
            #[cfg(not(test))]
            panic!("WASM application capability was not configured by its leaf artifact")
        })
    })
}
