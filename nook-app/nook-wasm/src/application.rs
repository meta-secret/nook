//! Compile-time application capability for this WASM artifact.
//!
//! Production builds select exactly one capability feature. The default
//! unified capability is reserved for local development and Rust tests.

#[cfg(not(any(
    feature = "app-unified-development",
    feature = "app-simple",
    feature = "app-sentinel",
    feature = "app-extension",
    feature = "app-legacy-migration"
)))]
compile_error!("one nook-wasm application capability feature must be enabled");

#[cfg(any(
    all(feature = "app-unified-development", feature = "app-simple"),
    all(feature = "app-unified-development", feature = "app-sentinel"),
    all(feature = "app-unified-development", feature = "app-extension"),
    all(feature = "app-unified-development", feature = "app-legacy-migration"),
    all(feature = "app-simple", feature = "app-sentinel"),
    all(feature = "app-simple", feature = "app-extension"),
    all(feature = "app-simple", feature = "app-legacy-migration"),
    all(feature = "app-sentinel", feature = "app-extension"),
    all(feature = "app-sentinel", feature = "app-legacy-migration"),
    all(feature = "app-extension", feature = "app-legacy-migration")
))]
compile_error!("nook-wasm application capability features are mutually exclusive");

#[must_use]
pub const fn compiled_vault_application() -> nook_core::VaultApplication {
    #[cfg(feature = "app-simple")]
    {
        return nook_core::VaultApplication::Simple;
    }
    #[cfg(feature = "app-sentinel")]
    {
        return nook_core::VaultApplication::Sentinel;
    }
    #[cfg(feature = "app-extension")]
    {
        return nook_core::VaultApplication::Extension;
    }
    #[cfg(feature = "app-legacy-migration")]
    {
        return nook_core::VaultApplication::LegacyMigration;
    }
    #[cfg(feature = "app-unified-development")]
    {
        nook_core::VaultApplication::UnifiedDevelopment
    }
}
