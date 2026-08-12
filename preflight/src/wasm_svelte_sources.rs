use std::collections::HashSet;
use std::path::Path;

use crate::rust_wasm_names::typescript_wasm_import_alias_lines_at_path;
use crate::wasm_inventory::WasmTypeInventory;

pub(super) fn svelte_wasm_import_alias_lines(
    source: &str,
    source_path: &Path,
    callable_names: &HashSet<String>,
    wasm_type_names: &HashSet<String>,
    wasm_types: &WasmTypeInventory,
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
        wasm_types,
    )?;
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

fn collect_svelte_typescript(node: tree_sitter::Node<'_>, source: &str, composite: &mut [u8]) {
    preserve_block_scope(node, source, composite);
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
    if node.kind() == "expression" {
        composite[node.byte_range()].copy_from_slice(&source.as_bytes()[node.byte_range()]);
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_svelte_typescript(child, source, composite);
    }
}

fn preserve_block_scope(node: tree_sitter::Node<'_>, source: &str, composite: &mut [u8]) {
    let text = node.utf8_text(source.as_bytes()).unwrap_or_default();
    let header = text.split('}').next().unwrap_or_default();
    let raw = match node.kind() {
        "each_statement" => header.split_once(" as ").map(|(_, value)| value),
        "snippet_statement" => header
            .split_once('(')
            .and_then(|(_, value)| value.split_once(')').map(|(parameters, _)| parameters)),
        "then_block" | "catch_block" => header.split_once(' ').map(|(_, value)| value),
        _ => None,
    };
    let Some(raw) = raw else { return };
    let names = raw
        .split(',')
        .filter_map(|part| {
            let name = part.trim().split([':', '=', ' ', ')', '(']).next()?;
            (!name.is_empty()
                && name
                    .chars()
                    .all(|character| character.is_alphanumeric() || matches!(character, '_' | '$')))
            .then_some(name)
        })
        .collect::<Vec<_>>()
        .join(",");
    if names.is_empty() {
        return;
    }
    let declaration = format!("{{let {names};");
    if declaration.len() < node.end_byte() - node.start_byte() {
        composite[node.start_byte()..node.start_byte() + declaration.len()]
            .copy_from_slice(declaration.as_bytes());
        composite[node.end_byte() - 1] = b'}';
    }
}
