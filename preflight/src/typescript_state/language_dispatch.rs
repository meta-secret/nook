use std::ffi::OsStr;

use super::{
    svelte_generic_optional_state_lines, svelte_mutable_void_state_lines, svelte_null_token_lines,
    svelte_raw_string_discriminant_lines, svelte_undefined_token_lines,
    typescript_code_generic_optional_state_lines, typescript_code_mutable_void_state_lines,
    typescript_code_null_token_lines, typescript_code_raw_string_discriminant_lines,
    typescript_code_undefined_token_lines,
};

pub(super) fn undefined_token_lines(
    source: &str,
    extension: Option<&OsStr>,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    if extension.is_some_and(|value| value == "svelte") {
        return svelte_undefined_token_lines(source);
    }
    typescript_code_undefined_token_lines(source, 1)
}

pub(super) fn null_token_lines(
    source: &str,
    extension: Option<&OsStr>,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    if extension.is_some_and(|value| value == "svelte") {
        return svelte_null_token_lines(source);
    }
    typescript_code_null_token_lines(source, 1)
}

pub(super) fn mutable_void_state_lines(
    source: &str,
    extension: Option<&OsStr>,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    if extension.is_some_and(|value| value == "svelte") {
        return svelte_mutable_void_state_lines(source);
    }
    typescript_code_mutable_void_state_lines(source, 1)
}

pub(super) fn generic_optional_state_lines(
    source: &str,
    extension: Option<&OsStr>,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    if extension.is_some_and(|value| value == "svelte") {
        return svelte_generic_optional_state_lines(source);
    }
    typescript_code_generic_optional_state_lines(source, 1)
}

pub(super) fn raw_string_discriminant_lines(
    source: &str,
    extension: Option<&OsStr>,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    if extension.is_some_and(|value| value == "svelte") {
        return svelte_raw_string_discriminant_lines(source);
    }
    typescript_code_raw_string_discriminant_lines(source, 1)
}
