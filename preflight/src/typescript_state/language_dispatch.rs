use crate::typescript_state::TypeScriptApplicationState;
use std::ffi::OsStr;

impl TypeScriptApplicationState<'_> {
    pub(super) fn undefined_token_lines(
        source: &str,
        extension: Option<&OsStr>,
    ) -> Result<Vec<usize>, tree_sitter::LanguageError> {
        if extension.is_some_and(|value| value == "svelte") {
            return TypeScriptApplicationState::svelte_undefined_token_lines(source);
        }
        TypeScriptApplicationState::typescript_code_undefined_token_lines(source, 1)
    }
}

impl TypeScriptApplicationState<'_> {
    pub(super) fn null_token_lines(
        source: &str,
        extension: Option<&OsStr>,
    ) -> Result<Vec<usize>, tree_sitter::LanguageError> {
        if extension.is_some_and(|value| value == "svelte") {
            return TypeScriptApplicationState::svelte_null_token_lines(source);
        }
        TypeScriptApplicationState::typescript_code_null_token_lines(source, 1)
    }
}

impl TypeScriptApplicationState<'_> {
    pub(super) fn mutable_void_state_lines(
        source: &str,
        extension: Option<&OsStr>,
    ) -> Result<Vec<usize>, tree_sitter::LanguageError> {
        if extension.is_some_and(|value| value == "svelte") {
            return TypeScriptApplicationState::svelte_mutable_void_state_lines(source);
        }
        TypeScriptApplicationState::typescript_code_mutable_void_state_lines(source, 1)
    }
}

impl TypeScriptApplicationState<'_> {
    pub(super) fn generic_optional_state_lines(
        source: &str,
        extension: Option<&OsStr>,
    ) -> Result<Vec<usize>, tree_sitter::LanguageError> {
        if extension.is_some_and(|value| value == "svelte") {
            return TypeScriptApplicationState::svelte_generic_optional_state_lines(source);
        }
        TypeScriptApplicationState::typescript_code_generic_optional_state_lines(source, 1)
    }
}

impl TypeScriptApplicationState<'_> {
    pub(super) fn raw_string_discriminant_lines(
        source: &str,
        extension: Option<&OsStr>,
    ) -> Result<Vec<usize>, tree_sitter::LanguageError> {
        if extension.is_some_and(|value| value == "svelte") {
            return TypeScriptApplicationState::svelte_raw_string_discriminant_lines(source);
        }
        TypeScriptApplicationState::typescript_code_raw_string_discriminant_lines(source, 1)
    }
}
