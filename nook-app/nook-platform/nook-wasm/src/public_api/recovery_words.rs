use super::wasm_bindgen;
use nook_core::{RecoveryWordCount, RecoveryWordSuggestions};

/// List words of the recovery word list that start with what was typed so
/// far, for the word being typed into a recovery passphrase.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: projects the `suggest_recovery_words` limit through a JavaScript Number scalar"
    )
)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn suggest_recovery_words(prefix: &str, limit: u32) -> Vec<String> {
    RecoveryWordSuggestions {
        prefix,
        limit: RecoveryWordCount::from(limit),
    }
    .words()
    .into_iter()
    .map(str::to_owned)
    .collect()
}
