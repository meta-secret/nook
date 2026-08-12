use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::javascript_literals::{
    semantic_javascript_name as semantic_node_name, static_javascript_string,
};
use crate::javascript_scopes::ScopedBinding;
use crate::wasm_dynamic_aliases::scoped_binding;
use crate::wasm_module_sources::wasm_factory_return_type;

pub(super) fn collect_wasm_instance_factories(
    node: tree_sitter::Node<'_>,
    source: &str,
    wasm_class_bindings: &HashMap<String, String>,
    factories: &mut Vec<ScopedBinding>,
) {
    if matches!(
        node.kind(),
        "function_declaration"
            | "generator_function_declaration"
            | "function_expression"
            | "generator_function"
            | "arrow_function"
    ) && let Some(wasm_type) = node
        .child_by_field_name("return_type")
        .and_then(|return_type| referenced_wasm_class(return_type, source, wasm_class_bindings))
        && let Some(binding) = callable_declaration_binding(node)
        && let Some(mut factory) = scoped_binding(binding, source, Some(wasm_type), None)
    {
        if matches!(
            node.kind(),
            "function_declaration" | "generator_function_declaration"
        ) {
            factory.declaration_end = factory.scope_start;
        }
        factories.push(factory);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_wasm_instance_factories(child, source, wasm_class_bindings, factories);
    }
}

pub(super) fn collect_imported_wasm_instance_factories(
    node: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    wasm_type_names: &HashSet<String>,
    called_bindings: &HashSet<String>,
    factories: &mut HashMap<String, String>,
) {
    if node.kind() == "import_statement"
        && let Some(module) = node
            .child_by_field_name("source")
            .and_then(|source_node| static_javascript_string(source_node, source))
    {
        collect_imported_factory_specifiers(
            node,
            source,
            source_path,
            &module,
            wasm_type_names,
            called_bindings,
            factories,
        );
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_imported_wasm_instance_factories(
            child,
            source,
            source_path,
            wasm_type_names,
            called_bindings,
            factories,
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn collect_imported_factory_specifiers(
    node: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    module: &str,
    wasm_type_names: &HashSet<String>,
    called_bindings: &HashSet<String>,
    factories: &mut HashMap<String, String>,
) {
    if node.kind() == "import_specifier"
        && !node_is_type_only_import(node, source)
        && let Some(imported_node) = node.child_by_field_name("name")
        && let Some(imported_name) = semantic_node_name(imported_node, source)
    {
        let local_node = node.child_by_field_name("alias").unwrap_or(imported_node);
        if let Some(local_name) = semantic_node_name(local_node, source)
            && called_bindings.contains(&local_name)
            && let Some(wasm_type) =
                wasm_factory_return_type(module, &imported_name, source_path, wasm_type_names)
        {
            factories.insert(local_name, wasm_type);
        }
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_imported_factory_specifiers(
            child,
            source,
            source_path,
            module,
            wasm_type_names,
            called_bindings,
            factories,
        );
    }
}

pub(super) fn collect_member_alias_receiver_names(
    node: tree_sitter::Node<'_>,
    source: &str,
    callable_names: &HashSet<String>,
    receivers: &mut HashSet<String>,
) {
    if matches!(node.kind(), "variable_declarator" | "assignment_expression")
        && let Some(value) = node
            .child_by_field_name("value")
            .or_else(|| node.child_by_field_name("right"))
        && let value = unwrap_transparent_expression(value)
        && matches!(value.kind(), "member_expression" | "subscript_expression")
        && let Some(object) = value.child_by_field_name("object")
        && object.kind() == "identifier"
        && let Some(property) = value
            .child_by_field_name("property")
            .or_else(|| value.child_by_field_name("index"))
        && let Some(callable_name) = semantic_node_name(property, source)
        && callable_names.contains(&callable_name)
        && let Some(receiver_name) = semantic_node_name(object, source)
    {
        receivers.insert(receiver_name);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_member_alias_receiver_names(child, source, callable_names, receivers);
    }
}

pub(super) fn collect_factory_calls_for_receivers(
    node: tree_sitter::Node<'_>,
    source: &str,
    receivers: &HashSet<String>,
    called_bindings: &mut HashSet<String>,
) {
    if matches!(node.kind(), "variable_declarator" | "assignment_expression")
        && let Some(binding) = node
            .child_by_field_name("name")
            .or_else(|| node.child_by_field_name("left"))
        && let Some(binding_name) = semantic_node_name(binding, source)
        && receivers.contains(&binding_name)
        && let Some(value) = node
            .child_by_field_name("value")
            .or_else(|| node.child_by_field_name("right"))
        && let Some(factory_name) = called_identifier(value, source)
    {
        called_bindings.insert(factory_name);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_factory_calls_for_receivers(child, source, receivers, called_bindings);
    }
}

fn called_identifier(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
    let node = unwrap_transparent_expression(node);
    if node.kind() == "await_expression" {
        let mut cursor = node.walk();
        return node
            .named_children(&mut cursor)
            .find_map(|child| called_identifier(child, source));
    }
    if node.kind() != "call_expression" {
        return None;
    }
    let function = node.child_by_field_name("function")?;
    (function.kind() == "identifier")
        .then(|| semantic_node_name(function, source))
        .flatten()
}

fn callable_declaration_binding(node: tree_sitter::Node<'_>) -> Option<tree_sitter::Node<'_>> {
    node.child_by_field_name("name").or_else(|| {
        let declarator = node.parent()?;
        (declarator.kind() == "variable_declarator")
            .then(|| declarator.child_by_field_name("name"))
            .flatten()
    })
}

fn referenced_wasm_class(
    node: tree_sitter::Node<'_>,
    source: &str,
    wasm_class_bindings: &HashMap<String, String>,
) -> Option<String> {
    let annotation = node.utf8_text(source.as_bytes()).ok()?.trim();
    let actual = annotation.strip_prefix(':').unwrap_or(annotation).trim();
    let actual = actual
        .strip_prefix("Promise<")
        .and_then(|inner| inner.strip_suffix('>'))
        .unwrap_or(actual)
        .trim();
    wasm_class_bindings.get(actual).cloned()
}

fn node_is_type_only_import(node: tree_sitter::Node<'_>, source: &str) -> bool {
    if node
        .utf8_text(source.as_bytes())
        .is_ok_and(|text| text.trim_start().starts_with("type "))
    {
        return true;
    }
    let mut ancestor = node.parent();
    while let Some(parent) = ancestor {
        if parent.kind() == "import_statement" {
            return parent
                .utf8_text(source.as_bytes())
                .is_ok_and(|text| text.trim_start().starts_with("import type "));
        }
        ancestor = parent.parent();
    }
    false
}

fn unwrap_transparent_expression(mut node: tree_sitter::Node<'_>) -> tree_sitter::Node<'_> {
    while matches!(
        node.kind(),
        "parenthesized_expression"
            | "as_expression"
            | "satisfies_expression"
            | "non_null_expression"
            | "type_assertion"
    ) {
        let mut cursor = node.walk();
        let Some(value) = node
            .named_children(&mut cursor)
            .find(|child| child.kind() != "type_annotation" && !child.kind().contains("type"))
        else {
            break;
        };
        node = value;
    }
    node
}
