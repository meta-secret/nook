use super::{
    typescript_code_generic_optional_state_lines, typescript_code_mutable_void_state_lines,
    typescript_code_null_token_lines, typescript_code_undefined_token_lines,
};

pub(super) fn svelte_undefined_token_lines(
    source: &str,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&tree_sitter_svelte_next::LANGUAGE.into())?;
    let Some(tree) = parser.parse(source, None) else {
        return Ok(Vec::new());
    };
    let mut lines = Vec::new();
    collect_svelte_script_fragments(tree.root_node(), source, &mut lines)?;
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}
pub(super) fn svelte_null_token_lines(
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
        typescript_code_null_token_lines,
    )?;
    collect_svelte_null_fragments(tree.root_node(), source, &mut lines)?;
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

pub(super) fn svelte_mutable_void_state_lines(
    source: &str,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&tree_sitter_svelte_next::LANGUAGE.into())?;
    let Some(tree) = parser.parse(source, None) else {
        return Ok(Vec::new());
    };
    let mut lines = Vec::new();
    collect_svelte_mutable_void_fragments(tree.root_node(), source, &mut lines)?;
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

pub(super) fn svelte_generic_optional_state_lines(
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
        typescript_code_generic_optional_state_lines,
    )?;
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

pub(super) fn collect_svelte_script_fragments_with(
    node: tree_sitter::Node<'_>,
    source: &str,
    lines: &mut Vec<usize>,
    scan: fn(&str, usize) -> Result<Vec<usize>, tree_sitter::LanguageError>,
) -> Result<(), tree_sitter::LanguageError> {
    if node.kind() == "raw_text"
        && node
            .parent()
            .is_some_and(|parent| parent.kind() == "script_element")
    {
        if let Ok(fragment) = node.utf8_text(source.as_bytes()) {
            lines.extend(scan(fragment, node.start_position().row + 1)?);
        }
        return Ok(());
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_svelte_script_fragments_with(child, source, lines, scan)?;
    }
    Ok(())
}

fn collect_svelte_mutable_void_fragments(
    node: tree_sitter::Node<'_>,
    source: &str,
    lines: &mut Vec<usize>,
) -> Result<(), tree_sitter::LanguageError> {
    if node.kind() == "raw_text"
        && node
            .parent()
            .is_some_and(|parent| parent.kind() == "script_element")
    {
        if let Ok(fragment) = node.utf8_text(source.as_bytes()) {
            lines.extend(typescript_code_mutable_void_state_lines(
                fragment,
                node.start_position().row + 1,
            )?);
        }
        return Ok(());
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_svelte_mutable_void_fragments(child, source, lines)?;
    }
    Ok(())
}

fn collect_svelte_null_fragments(
    node: tree_sitter::Node<'_>,
    source: &str,
    lines: &mut Vec<usize>,
) -> Result<(), tree_sitter::LanguageError> {
    if (node.kind() == "raw_text"
        && node
            .parent()
            .is_some_and(|parent| parent.kind() == "script_element"))
        || node.kind() == "svelte_raw_text"
    {
        if let Ok(fragment) = node.utf8_text(source.as_bytes()) {
            lines.extend(typescript_code_null_token_lines(
                fragment,
                node.start_position().row + 1,
            )?);
        }
        return Ok(());
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_svelte_null_fragments(child, source, lines)?;
    }
    Ok(())
}

fn collect_svelte_script_fragments(
    node: tree_sitter::Node<'_>,
    source: &str,
    lines: &mut Vec<usize>,
) -> Result<(), tree_sitter::LanguageError> {
    if (node.kind() == "raw_text"
        && node
            .parent()
            .is_some_and(|parent| parent.kind() == "script_element"))
        || node.kind() == "svelte_raw_text"
    {
        if let Ok(fragment) = node.utf8_text(source.as_bytes()) {
            lines.extend(typescript_code_undefined_token_lines(
                fragment,
                node.start_position().row + 1,
            )?);
        }
        return Ok(());
    }
    if node.child_count() == 0
        && node
            .utf8_text(source.as_bytes())
            .is_ok_and(|text| text == "undefined")
    {
        lines.push(node.start_position().row + 1);
        return Ok(());
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_svelte_script_fragments(child, source, lines)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::svelte_undefined_token_lines;

    #[test]
    fn reports_script_and_template_nullish_operators() -> Result<(), tree_sitter::LanguageError> {
        let source = r#"
<script lang="ts">
  const selected = value ?? fallback
  state.value ??= fallback
</script>
<p>{value ?? fallback}</p>
<button onclick={() => (state.value ??= fallback)}>Update</button>
<p>Documentation about ?? and ??= stays prose.</p>
"#;

        assert_eq!(svelte_undefined_token_lines(source)?, vec![3, 4, 6, 7]);
        Ok(())
    }
}
