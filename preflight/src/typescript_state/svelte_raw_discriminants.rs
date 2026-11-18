use crate::typescript_state::TypeScriptApplicationState;

impl TypeScriptApplicationState<'_> {
    pub(super) fn svelte_raw_string_discriminant_lines(
        source: &str,
    ) -> Result<Vec<usize>, tree_sitter::LanguageError> {
        let mut parser = tree_sitter::Parser::new();
        parser.set_language(&tree_sitter_svelte_next::LANGUAGE.into())?;
        let Some(tree) = parser.parse(source, None) else {
            return Ok(Vec::new());
        };
        let mut lines = Vec::new();
        TypeScriptApplicationState::collect_svelte_script_fragments_with(
            tree.root_node(),
            source,
            &mut lines,
            TypeScriptApplicationState::typescript_code_raw_string_discriminant_lines,
        )?;
        TypeScriptApplicationState::collect_svelte_raw_text_fragments_with(
            tree.root_node(),
            source,
            &mut lines,
            TypeScriptApplicationState::typescript_template_raw_string_discriminant_lines,
        )?;
        lines.sort_unstable();
        lines.dedup();
        Ok(lines)
    }
}

#[cfg(test)]
mod tests {
    use super::TypeScriptApplicationState;

    #[test]
    fn reports_raw_discriminants_in_template_expressions() -> Result<(), tree_sitter::LanguageError>
    {
        let source = r#"
<script lang="ts">
  enum SessionKind { Open = 'open' }
  const state = { kind: SessionKind.Open }
</script>
<button class:active={state.kind === 'open'}>
  {state.kind === 'open' ? 'Close' : 'Open'}
</button>
"#;

        assert_eq!(
            TypeScriptApplicationState::svelte_raw_string_discriminant_lines(source)?,
            vec![6, 7]
        );
        Ok(())
    }

    #[test]
    fn reports_bare_variant_comparisons() -> Result<(), tree_sitter::LanguageError> {
        let source = r#"
<script lang="ts">
  enum DialogVariant { NeedsRequest = 'needs_request' }
  const variant = DialogVariant.NeedsRequest
</script>
{#if variant === 'needs_request'}
  <button>Join</button>
{/if}
"#;

        assert_eq!(
            TypeScriptApplicationState::svelte_raw_string_discriminant_lines(source)?,
            vec![6]
        );
        Ok(())
    }
}
