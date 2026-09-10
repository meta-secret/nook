use crate::typescript_state::TypeScriptApplicationState;
use std::path::Path;

#[derive(Clone, Copy)]
pub(super) enum SourceLanguage {
    Svelte,
    TypeScript,
}
impl SourceLanguage {
    pub(super) fn of_path(path: &Path) -> Self {
        if path
            .extension()
            .is_some_and(|extension| extension == "svelte")
        {
            Self::Svelte
        } else {
            Self::TypeScript
        }
    }
}

impl TypeScriptApplicationState<'_> {
    pub(super) fn undefined_token_lines(
        source: &str,
        language: SourceLanguage,
    ) -> Result<Vec<usize>, tree_sitter::LanguageError> {
        if matches!(language, SourceLanguage::Svelte) {
            return TypeScriptApplicationState::svelte_undefined_token_lines(source);
        }
        TypeScriptApplicationState::typescript_code_undefined_token_lines(source, 1)
    }
}

impl TypeScriptApplicationState<'_> {
    pub(super) fn null_token_lines(
        source: &str,
        language: SourceLanguage,
    ) -> Result<Vec<usize>, tree_sitter::LanguageError> {
        if matches!(language, SourceLanguage::Svelte) {
            return TypeScriptApplicationState::svelte_null_token_lines(source);
        }
        TypeScriptApplicationState::typescript_code_null_token_lines(source, 1)
    }
}

impl TypeScriptApplicationState<'_> {
    pub(super) fn mutable_void_state_lines(
        source: &str,
        language: SourceLanguage,
    ) -> Result<Vec<usize>, tree_sitter::LanguageError> {
        if matches!(language, SourceLanguage::Svelte) {
            return TypeScriptApplicationState::svelte_mutable_void_state_lines(source);
        }
        TypeScriptApplicationState::typescript_code_mutable_void_state_lines(source, 1)
    }
}

impl TypeScriptApplicationState<'_> {
    pub(super) fn generic_optional_state_lines(
        source: &str,
        language: SourceLanguage,
    ) -> Result<Vec<usize>, tree_sitter::LanguageError> {
        if matches!(language, SourceLanguage::Svelte) {
            return TypeScriptApplicationState::svelte_generic_optional_state_lines(source);
        }
        TypeScriptApplicationState::typescript_code_generic_optional_state_lines(source, 1)
    }
}

impl TypeScriptApplicationState<'_> {
    pub(super) fn raw_string_discriminant_lines(
        source: &str,
        language: SourceLanguage,
    ) -> Result<Vec<usize>, tree_sitter::LanguageError> {
        if matches!(language, SourceLanguage::Svelte) {
            return TypeScriptApplicationState::svelte_raw_string_discriminant_lines(source);
        }
        TypeScriptApplicationState::typescript_code_raw_string_discriminant_lines(source, 1)
    }
}
