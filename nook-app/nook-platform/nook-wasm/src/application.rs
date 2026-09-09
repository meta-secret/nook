//! Immutable application capability selected once by each isolated web app.
//!
//! Nook compiles and optimizes one shared WASM library. Each independently
//! built app configures its capability before constructing a manager, and the
//! capability cannot be changed for the lifetime of that browser realm.

use std::cell::Cell;

#[cfg(test)]
use nook_core::VaultApplication;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct ConfiguredVaultApplication {
    application: nook_core::VaultApplication,
}
thread_local! {
    static CONFIGURED_APPLICATION: Cell<Option<ConfiguredVaultApplication>> = const { Cell::new(None) };
}

impl ConfiguredVaultApplication {
    pub fn configure_vault_application(application: nook_core::VaultApplication) {
        CONFIGURED_APPLICATION.with(|configured| match configured.get() {
            None => configured.set(Some(ConfiguredVaultApplication { application })),
            Some(existing) if existing.application == application => {}
            Some(existing) => panic!(
                "WASM application already configured as {}; cannot change it to {}",
                existing.application.as_str(),
                application.as_str()
            ),
        });
    }
}

impl ConfiguredVaultApplication {
    #[must_use]
    pub fn configured_vault_application() -> nook_core::VaultApplication {
        CONFIGURED_APPLICATION.with(|configured| {
            #[cfg(test)]
            return configured
                .get()
                .map(|configured| configured.application)
                .unwrap_or(VaultApplication::UnifiedDevelopment);

            #[cfg(not(test))]
            configured
                .get()
                .map(|configured| configured.application)
                .unwrap_or_else(|| {
                    panic!("WASM application capability was not configured before use")
                })
        })
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::{configure_vault_application, configured_vault_application};
    use nook_core::VaultApplication;
    use std::{panic, thread};

    #[test]
    fn application_configuration_is_idempotent_and_immutable() -> anyhow::Result<()> {
        thread::spawn(|| {
            ConfiguredVaultApplication::configure_vault_application(VaultApplication::Simple);
            ConfiguredVaultApplication::configure_vault_application(VaultApplication::Simple);
            assert_eq!(
                ConfiguredVaultApplication::configured_vault_application(),
                VaultApplication::Simple
            );

            let changed = panic::catch_unwind(|| {
                ConfiguredVaultApplication::configure_vault_application(VaultApplication::Sentinel);
            });
            assert!(changed.is_err());
            assert_eq!(
                ConfiguredVaultApplication::configured_vault_application(),
                VaultApplication::Simple
            );
        })
        .join()
        .map_err(|_| anyhow::anyhow!("application configuration test thread panicked"))?;
        Ok(())
    }
}
