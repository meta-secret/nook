//! Immutable application capability selected once by each isolated web app.
//!
//! Nook compiles and optimizes one shared WASM library. Each independently
//! built app configures its capability before constructing a manager, and the
//! capability cannot be changed for the lifetime of that browser realm.

use std::cell::Cell;

thread_local! {
    static CONFIGURED_APPLICATION: Cell<Option<nook_core::VaultApplication>> = const { Cell::new(None) };
}

pub fn configure_vault_application(application: nook_core::VaultApplication) {
    CONFIGURED_APPLICATION.with(|configured| match configured.get() {
        None => configured.set(Some(application)),
        Some(existing) if existing == application => {}
        Some(existing) => panic!(
            "WASM application already configured as {}; cannot change it to {}",
            existing.as_str(),
            application.as_str()
        ),
    });
}

#[must_use]
pub fn configured_vault_application() -> nook_core::VaultApplication {
    CONFIGURED_APPLICATION.with(|configured| {
        #[cfg(test)]
        return configured
            .get()
            .unwrap_or(nook_core::VaultApplication::UnifiedDevelopment);

        #[cfg(not(test))]
        configured
            .get()
            .unwrap_or_else(|| panic!("WASM application capability was not configured before use"))
    })
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::{configure_vault_application, configured_vault_application};
    use nook_core::VaultApplication;

    #[test]
    fn application_configuration_is_idempotent_and_immutable() {
        std::thread::spawn(|| {
            configure_vault_application(VaultApplication::Simple);
            configure_vault_application(VaultApplication::Simple);
            assert_eq!(configured_vault_application(), VaultApplication::Simple);

            let changed = std::panic::catch_unwind(|| {
                configure_vault_application(VaultApplication::Sentinel);
            });
            assert!(changed.is_err());
            assert_eq!(configured_vault_application(), VaultApplication::Simple);
        })
        .join()
        .expect("application capability test thread must finish");
    }
}
