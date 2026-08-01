//! Dependency-light application primitives shared by Nook's portable Rust crates.
//!
//! This crate is deliberately a leaf in the application dependency graph. It
//! owns only cross-cutting facilities that both authentication and vault-domain
//! crates need without depending on either of them.

mod generated;
mod i18n;

pub use generated::i18n_keys;
pub use i18n::{
    AppLocale, get_translation_catalog, lookup_translation, merge_translation_catalogs,
    parse_app_locale, resolve_app_locale_from_tag, resolve_app_locale_from_tags,
    resolve_error_message, resolve_translation_catalog, translate, translate_from_catalog,
    translate_with_replacements,
};
