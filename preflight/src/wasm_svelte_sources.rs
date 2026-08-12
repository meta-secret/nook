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
    let mut composite = source
        .bytes()
        .map(|byte| if byte == b'\n' { byte } else { b' ' })
        .collect::<Vec<_>>();
    collect_svelte_typescript(tree.root_node(), source, &mut composite);
    let composite = String::from_utf8_lossy(&composite);
    let mut lines = typescript_wasm_import_alias_lines_at_path(
        &composite,
        source_path,
        1,
        callable_names,
        wasm_type_names,
        wasm_methods_by_type,
    )?;
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

fn collect_svelte_typescript(node: tree_sitter::Node<'_>, source: &str, composite: &mut [u8]) {
    if node.kind() == "raw_text"
        && node
            .parent()
            .is_some_and(|parent| parent.kind() == "script_element")
    {
        composite[node.byte_range()].copy_from_slice(&source.as_bytes()[node.byte_range()]);
        return;
    }
    if node.kind() == "const_tag" {
        let start = node.start_byte() + "{@const".len();
        let end = node.end_byte() - 1;
        composite[start..end].copy_from_slice(&source.as_bytes()[start..end]);
        composite[end] = b';';
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_svelte_typescript(child, source, composite);
    }
}
