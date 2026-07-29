use super::wasm_bindgen;

#[wasm_bindgen(js_name = validateBip39Mnemonic)]
#[must_use]
pub fn validate_bip39_mnemonic(mnemonic: &str) -> bool {
    nook_core::validate_bip39_mnemonic(mnemonic).is_ok()
}

#[wasm_bindgen(js_name = getBip39EnglishWordlist)]
pub fn get_bip39_english_wordlist() -> Vec<String> {
    nook_core::bip39_english_wordlist()
        .into_iter()
        .map(str::to_owned)
        .collect()
}

#[wasm_bindgen(js_name = isKnownBip39Word)]
#[must_use]
pub fn is_known_bip39_word(word: &str) -> bool {
    nook_core::is_known_bip39_word(word)
}

#[wasm_bindgen(js_name = suggestBip39Words)]
pub fn suggest_bip39_words(prefix: &str, limit: u32) -> Vec<String> {
    nook_core::suggest_bip39_words(prefix, limit as usize)
        .into_iter()
        .map(str::to_owned)
        .collect()
}

#[wasm_bindgen(js_name = isBip39WordSequenceValid)]
#[must_use]
pub fn is_bip39_word_sequence_valid(text: &str, expected_word_count: u32) -> bool {
    nook_core::is_bip39_word_sequence_valid(text, expected_word_count as usize)
}

#[wasm_bindgen(js_name = parseBip39Words)]
pub fn parse_bip39_words(text: &str) -> Vec<String> {
    nook_core::parse_bip39_words(text)
}

#[wasm_bindgen(js_name = joinBip39Words)]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn join_bip39_words(words: Vec<String>) -> String {
    nook_core::join_bip39_words(&words)
}

#[wasm_bindgen(js_name = inferBip39MnemonicLength)]
#[must_use]
pub fn infer_bip39_mnemonic_length(text: &str) -> Option<u32> {
    nook_core::infer_bip39_mnemonic_length(text)
}
