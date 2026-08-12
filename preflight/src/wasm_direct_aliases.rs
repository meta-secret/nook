use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::javascript_literals::{semantic_javascript_name, static_javascript_string};
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
    if matches!(node.kind(), "import_statement" | "import_alias")
        && let Some((binding, module)) = import_equals_binding(node, source)
        && is_wasm_callable_source(&module, source_path)
    {
        wasm_namespace_bindings.insert(binding, module);
        return;
    }
    if matches!(node.kind(), "import_statement" | "export_statement") {
        if let Some(module) = module_specifier(node, source) {
            if node.kind() == "import_statement" && is_wasm_callable_source(&module, source_path) {
                collect_namespace_import_bindings(
                    node,
                    source,
                    source_path,
                    &module,
                    wasm_namespace_bindings,
                );
                collect_default_callable_import(
                    node,
                    source,
                    source_path,
                    &module,
                    first_line,
                    callable_names,
                    imported_callable_bindings,
                    lines,
                );
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

fn import_equals_binding(node: tree_sitter::Node<'_>, source: &str) -> Option<(String, String)> {
    let text = node.utf8_text(source.as_bytes()).ok()?.trim();
    let assignment = text.strip_prefix("import ")?;
    let (binding, required) = assignment.split_once('=')?;
    let module = required
        .trim()
        .strip_prefix("require(")?
        .trim_end_matches(';')
        .strip_suffix(')')?
        .trim()
        .trim_matches(['\'', '"']);
    Some((binding.trim().to_owned(), module.to_owned()))
}

#[allow(clippy::too_many_arguments)]
fn collect_default_callable_import(
    node: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    module: &str,
    first_line: usize,
    callable_names: &HashSet<String>,
    bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
) {
    let Some(authored_name) = crate::wasm_module_sources::wasm_callable_export_name(
        module,
        "default",
        source_path,
        callable_names,
    ) else {
        return;
    };
    let Ok(text) = node.utf8_text(source.as_bytes()) else {
        return;
    };
    let Some(clause) = text.trim_start().strip_prefix("import ") else {
        return;
    };
    let binding = clause
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_end_matches(',');
    if binding.is_empty() || matches!(binding, "type" | "{" | "*") {
        return;
    }
    bindings.insert(binding.to_owned());
    if binding != authored_name {
        lines.push(first_line + node.start_position().row);
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
        && let Some(authored_name) = semantic_javascript_name(authored_name_node, source)
        && callable_names.contains(&authored_name)
        && is_wasm_callable_export(module, &authored_name, source_path)
    {
        let alias = node.child_by_field_name("alias");
        if alias
            .and_then(|alias| semantic_javascript_name(alias, source))
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
