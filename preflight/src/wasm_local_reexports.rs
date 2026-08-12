use std::collections::HashSet;

use crate::javascript_literals::semantic_javascript_name as semantic_node_name;

pub(super) fn collect_local_wasm_reexport_aliases(
    node: tree_sitter::Node<'_>,
    source: &str,
    first_line: usize,
    imported_callable_bindings: &HashSet<String>,
    lines: &mut Vec<usize>,
) {
    if node.kind() == "export_statement" && node.child_by_field_name("source").is_none() {
        collect_local_callable_alias_specifiers(
            node,
            source,
            first_line,
            imported_callable_bindings,
            lines,
        );
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_local_wasm_reexport_aliases(
            child,
            source,
            first_line,
            imported_callable_bindings,
            lines,
        );
    }
}

fn collect_local_callable_alias_specifiers(
    node: tree_sitter::Node<'_>,
    source: &str,
    first_line: usize,
    imported_callable_bindings: &HashSet<String>,
    lines: &mut Vec<usize>,
) {
    if node.kind() == "export_specifier"
        && let Some(local_name) = node.child_by_field_name("name")
        && let Some(alias) = node.child_by_field_name("alias")
        && let Some(local_name_text) = semantic_node_name(local_name, source)
        && imported_callable_bindings.contains(&local_name_text)
        && semantic_node_name(alias, source).is_some_and(|alias_text| alias_text != local_name_text)
    {
        lines.push(first_line + local_name.start_position().row);
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_local_callable_alias_specifiers(
            child,
            source,
            first_line,
            imported_callable_bindings,
            lines,
        );
    }
}
