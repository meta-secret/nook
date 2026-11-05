use super::wasm_bindgen;
use crate::TypedOutput;
use nook_core::{RecoveryWordCount, RecoveryWordTyping};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::JsError;

/// The word being typed into a recovery words field and the list words it
/// may be. Rust reads the field: the word being typed follows the last space
/// or hyphen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NookRecoveryWordTyping {
    /// The word being typed; empty right after a separator.
    pub current: String,
    /// List words that start with it, at most the limit asked for.
    pub suggestions: Vec<String>,
}

/// Read what was typed into a recovery words field so far: the word being
/// typed and up to `limit` list words starting with it.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: projects the `recovery_word_typing` limit through a JavaScript Number scalar"
    )
)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn recovery_word_typing(typed: &str, limit: u32) -> Result<tsify::Ts<NookRecoveryWordTyping>, JsError> {
    let typing = RecoveryWordTyping { typed };
    Ok(NookRecoveryWordTyping {
        current: typing.current().to_owned(),
        suggestions: typing
            .suggestions(RecoveryWordCount::from(limit))
            .into_iter()
            .map(str::to_owned)
            .collect(),
    }
    .encode()?)
}

/// Replace the word being typed with the list word `word` and ready the
/// field for the next word. A word not on the list is refused.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn complete_recovery_word(typed: &str, word: &str) -> Result<String, JsError> {
    Ok(RecoveryWordTyping { typed }
        .complete(word)
        .map_err(nook_core::VaultError::from)
        .map_err(crate::NookError::from)?)
}
