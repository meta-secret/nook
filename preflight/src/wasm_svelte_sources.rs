use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::rust_wasm_names::typescript_wasm_import_alias_lines_at_path;

pub(super) fn svelte_wasm_import_alias_lines(
    source: &str,
    source_path: &Path,
    callable_names: &HashSet<String>,
    wasm_type_names: &HashSet<String>,
    wasm_methods_by_type: &HashMap<String, HashSet<String>>,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&tree_sitter_svelte_next::LANGUAGE.into())?;
    let Some(tree) = parser.parse(source, None) else {
        return Ok(Vec::new());
    };
    let mut lines = Vec::new();
    collect_svelte_wasm_import_aliases(
        tree.root_node(),
        source,
        source_path,
        callable_names,
        wasm_type_names,
        wasm_methods_by_type,
        &mut lines,
    )?;
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

fn collect_svelte_wasm_import_aliases(
    node: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    callable_names: &HashSet<String>,
    wasm_type_names: &HashSet<String>,
    wasm_methods_by_type: &HashMap<String, HashSet<String>>,
    lines: &mut Vec<usize>,
) -> Result<(), tree_sitter::LanguageError> {
    if node.kind() == "raw_text"
        && node
            .parent()
            .is_some_and(|parent| parent.kind() == "script_element")
    {
        if let Ok(fragment) = node.utf8_text(source.as_bytes()) {
            lines.extend(typescript_wasm_import_alias_lines_at_path(
                fragment,
                source_path,
                node.start_position().row + 1,
                callable_names,
                wasm_type_names,
                wasm_methods_by_type,
            )?);
        }
        return Ok(());
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_svelte_wasm_import_aliases(
            child,
            source,
            source_path,
            callable_names,
            wasm_type_names,
            wasm_methods_by_type,
            lines,
        )?;
    }
    Ok(())
}
