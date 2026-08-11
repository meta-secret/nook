use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::javascript_literals::static_javascript_string;
use crate::wasm_dynamic_aliases::{
    collect_namespace_import_bindings, collect_wasm_type_import_bindings,
};
use crate::wasm_module_sources::{is_wasm_callable_export, is_wasm_callable_source};

#[allow(clippy::too_many_arguments)]
pub(super) fn collect_direct_wasm_aliases_and_bindings(
    node: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    first_line: usize,
    callable_names: &HashSet<String>,
    wasm_type_names: &HashSet<String>,
    wasm_namespace_bindings: &mut HashMap<String, String>,
    wasm_class_bindings: &mut HashMap<String, String>,
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
) {
    if matches!(node.kind(), "import_statement" | "export_statement") {
        if let Some(module) = module_specifier(node, source) {
            if node.kind() == "import_statement" && is_wasm_callable_source(&module, source_path) {
                collect_namespace_import_bindings(node, source, &module, wasm_namespace_bindings);
                collect_wasm_type_import_bindings(
                    node,
                    source,
                    source_path,
                    &module,
                    wasm_type_names,
                    wasm_class_bindings,
                );
            }
            collect_callable_alias_specifiers(
                node,
                source,
                source_path,
                &module,
                first_line,
                callable_names,
                imported_callable_bindings,
                lines,
            );
        }
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_direct_wasm_aliases_and_bindings(
            child,
            source,
            source_path,
            first_line,
            callable_names,
            wasm_type_names,
            wasm_namespace_bindings,
            wasm_class_bindings,
            imported_callable_bindings,
            lines,
        );
    }
}

fn module_specifier(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
    let source_node = node.child_by_field_name("source")?;
    static_javascript_string(source_node, source)
}

#[allow(clippy::too_many_arguments)]
fn collect_callable_alias_specifiers(
    node: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    module: &str,
    first_line: usize,
    callable_names: &HashSet<String>,
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
) {
    if matches!(node.kind(), "import_specifier" | "export_specifier")
        && let Some(authored_name_node) = node.child_by_field_name("name")
        && let Some(authored_name) = semantic_node_name(authored_name_node, source)
        && callable_names.contains(&authored_name)
        && is_wasm_callable_export(module, &authored_name, source_path)
    {
        let alias = node.child_by_field_name("alias");
        if alias
            .and_then(|alias| semantic_node_name(alias, source))
            .is_some_and(|alias| alias != authored_name)
        {
            lines.push(first_line + authored_name_node.start_position().row);
        }
        if node.kind() == "import_specifier"
            && let Ok(binding_name) = alias
                .unwrap_or(authored_name_node)
                .utf8_text(source.as_bytes())
        {
            imported_callable_bindings.insert(binding_name.to_owned());
        }
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_callable_alias_specifiers(
            child,
            source,
            source_path,
            module,
            first_line,
            callable_names,
            imported_callable_bindings,
            lines,
        );
    }
}

fn semantic_node_name(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
    let text = node.utf8_text(source.as_bytes()).ok()?;
    if node.kind() == "string" {
        static_javascript_string(node, source)
    } else {
        Some(text.to_owned())
    }
}
