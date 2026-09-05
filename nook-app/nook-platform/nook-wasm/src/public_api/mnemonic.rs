use super::wasm_bindgen;
use nook_core::Bip39MnemonicWordCount;

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookBip39MnemonicLength {
    Unsupported,
    Words12,
    Words24,
}

#[wasm_bindgen]
#[must_use]
pub fn validate_bip39_mnemonic(mnemonic: &str) -> bool {
    nook_core::validate_bip39_mnemonic(mnemonic).is_ok()
}

#[wasm_bindgen]
pub fn get_bip39_english_wordlist() -> Vec<String> {
    nook_core::bip39_english_wordlist()
        .into_iter()
        .map(str::to_owned)
        .collect()
}

#[wasm_bindgen]
#[must_use]
pub fn is_known_bip39_word(word: &str) -> bool {
    nook_core::is_known_bip39_word(word)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: projects `suggest_bip39_words` paging values through JavaScript Number scalars"
    )
)]
pub fn suggest_bip39_words(prefix: &str, limit: u32) -> Vec<String> {
    nook_core::suggest_bip39_words(prefix, limit as usize)
        .into_iter()
        .map(str::to_owned)
        .collect()
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: projects the `is_bip39_word_sequence_valid` count through a JavaScript Number scalar"
    )
)]
pub fn is_bip39_word_sequence_valid(text: &str, expected_word_count: u32) -> bool {
    nook_core::is_bip39_word_sequence_valid(text, expected_word_count as usize)
}

#[wasm_bindgen]
pub fn parse_bip39_words(text: &str) -> Vec<String> {
    nook_core::parse_bip39_words(text)
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn join_bip39_words(words: Vec<String>) -> String {
    nook_core::join_bip39_words(&words)
}

#[wasm_bindgen]
#[must_use]
pub fn infer_bip39_mnemonic_length(text: &str) -> NookBip39MnemonicLength {
    match nook_core::infer_bip39_mnemonic_length(text) {
        Some(Bip39MnemonicWordCount::WORDS_12) => NookBip39MnemonicLength::Words12,
        Some(Bip39MnemonicWordCount::WORDS_24) => NookBip39MnemonicLength::Words24,
        Some(_) | None => NookBip39MnemonicLength::Unsupported,
    }
}
