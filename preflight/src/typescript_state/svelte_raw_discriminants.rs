use super::{
    collect_svelte_script_fragments_with, typescript_code_raw_string_discriminant_lines,
    typescript_template_raw_string_discriminant_lines,
};

pub(super) fn svelte_raw_string_discriminant_lines(
    source: &str,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&tree_sitter_svelte_next::LANGUAGE.into())?;
    let Some(tree) = parser.parse(source, None) else {
        return Ok(Vec::new());
    };
    let mut lines = Vec::new();
    collect_svelte_script_fragments_with(
        tree.root_node(),
        source,
        &mut lines,
        typescript_code_raw_string_discriminant_lines,
    )?;
    collect_svelte_raw_text_fragments_with(
        tree.root_node(),
        source,
        &mut lines,
        typescript_template_raw_string_discriminant_lines,
    )?;
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

fn collect_svelte_raw_text_fragments_with(
    node: tree_sitter::Node<'_>,
    source: &str,
    lines: &mut Vec<usize>,
    scan: fn(&str, usize) -> Result<Vec<usize>, tree_sitter::LanguageError>,
) -> Result<(), tree_sitter::LanguageError> {
    if node.kind() == "svelte_raw_text" {
        if let Ok(fragment) = node.utf8_text(source.as_bytes()) {
            lines.extend(scan(fragment, node.start_position().row + 1)?);
        }
        return Ok(());
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_svelte_raw_text_fragments_with(child, source, lines, scan)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::svelte_raw_string_discriminant_lines;

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

        assert_eq!(svelte_raw_string_discriminant_lines(source)?, vec![6, 7]);
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

        assert_eq!(svelte_raw_string_discriminant_lines(source)?, vec![6]);
        Ok(())
    }
}
