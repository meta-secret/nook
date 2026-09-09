//! Dependency-light application primitives shared by Nook's portable Rust crates.
//!
//! This crate is deliberately a leaf in the application dependency graph. It
//! owns only cross-cutting facilities that both authentication and vault-domain
//! crates need without depending on either of them.
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_raw_numeric_api_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(raw_numeric_public_api))]

mod generated;
mod i18n;

pub use generated::i18n_keys;
pub use i18n::{AppLocale, SupportedAppLocale};

pub use i18n::{
    LookupTranslationRequest, MergeTranslationCatalogsRequest, ResolveErrorMessageRequest,
    ResolveTranslationCatalogRequest, TranslateFromCatalogRequest, TranslateRequest,
    TranslateWithReplacementsRequest, TranslationCatalog,
};
