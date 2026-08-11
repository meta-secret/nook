use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::javascript_literals::{
    semantic_javascript_name as semantic_node_name, static_javascript_string,
};
use crate::javascript_scopes::{
    ScopedBinding, declaration_is_in_program_scope, invalidate_visible_scoped_binding,
    root_binding_is_visible, scoped_binding_is_visible, visible_scoped_binding,
};
use crate::wasm_factories::{
    collect_factory_calls_for_receivers, collect_imported_wasm_instance_factories,
    collect_member_alias_receiver_names, collect_wasm_instance_factories,
};
use crate::wasm_module_sources::{
    is_wasm_callable_export, is_wasm_callable_source, is_wasm_export,
};

const WASM_MANAGER_ACCESSOR: &str = "requireManager";
const WASM_RUNTIME_RECEIVER_PROPERTY: &str = "__nookVault";

pub(super) fn collect_namespace_import_bindings(
    node: tree_sitter::Node<'_>,
    source: &str,
    module: &str,
    wasm_namespace_bindings: &mut HashMap<String, String>,
) {
    if node.kind() == "namespace_import" && !node_is_type_only_import(node, source) {
        let mut cursor = node.walk();
        if let Some(binding) = node
            .named_children(&mut cursor)
            .find(|child| child.kind() == "identifier")
            .and_then(|child| child.utf8_text(source.as_bytes()).ok())
        {
            wasm_namespace_bindings.insert(binding.to_owned(), module.to_owned());
        }
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_namespace_import_bindings(child, source, module, wasm_namespace_bindings);
    }
}

pub(super) fn collect_wasm_type_import_bindings(
    node: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    module: &str,
    wasm_type_names: &HashSet<String>,
    wasm_class_bindings: &mut HashMap<String, String>,
) {
    if node.kind() == "import_specifier"
        && !node_is_type_only_import(node, source)
        && let Some(imported) = node.child_by_field_name("name")
        && let Some(imported_name) = semantic_node_name(imported, source)
        && wasm_type_names.contains(&imported_name)
        && is_wasm_export(module, &imported_name, source_path)
    {
        let binding = node.child_by_field_name("alias").unwrap_or(imported);
        if let Ok(binding_name) = binding.utf8_text(source.as_bytes()) {
            wasm_class_bindings.insert(binding_name.to_owned(), imported_name);
        }
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_wasm_type_import_bindings(
            child,
            source,
            source_path,
            module,
            wasm_type_names,
            wasm_class_bindings,
        );
    }
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

fn collect_wasm_runtime_receivers(
    node: tree_sitter::Node<'_>,
    source: &str,
    receivers: &mut Vec<ScopedBinding>,
) {
    if node.kind() == "variable_declarator"
        && let (Some(binding), Some(value)) = (
            node.child_by_field_name("name"),
            node.child_by_field_name("value"),
        )
        && binding.kind() == "identifier"
        && expression_contains_property(value, source, WASM_RUNTIME_RECEIVER_PROPERTY)
        && let Some(receiver) = scoped_binding(binding, source, None, None)
    {
        receivers.push(receiver);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_wasm_runtime_receivers(child, source, receivers);
    }
}

fn expression_contains_property(
    node: tree_sitter::Node<'_>,
    source: &str,
    property_name: &str,
) -> bool {
    if matches!(node.kind(), "member_expression" | "subscript_expression") {
        let property = if node.kind() == "subscript_expression" {
            node.child_by_field_name("index")
        } else {
            node.child_by_field_name("property")
        };
        if property
            .and_then(|property| semantic_node_name(property, source))
            .is_some_and(|property| property == property_name)
        {
            return true;
        }
    }
    let mut cursor = node.walk();
    node.named_children(&mut cursor)
        .any(|child| expression_contains_property(child, source, property_name))
}

#[allow(clippy::too_many_arguments)]
pub(super) fn collect_dynamic_wasm_aliases_and_bindings(
    node: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    first_line: usize,
    callable_names: &HashSet<String>,
    wasm_type_names: &HashSet<String>,
    wasm_methods_by_type: &HashMap<String, HashSet<String>>,
    wasm_namespace_bindings: &mut HashMap<String, String>,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_instance_bindings: &mut HashMap<String, String>,
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
) {
    let mut scoped_wasm_namespaces = Vec::new();
    let mut scoped_wasm_instances = Vec::new();
    let mut scoped_wasm_runtime_receivers = Vec::new();
    let mut wasm_instance_factories = HashMap::new();
    let mut member_alias_receivers = HashSet::new();
    let mut called_bindings = HashSet::new();
    collect_member_alias_receiver_names(node, source, callable_names, &mut member_alias_receivers);
    collect_factory_calls_for_receivers(
        node,
        source,
        &member_alias_receivers,
        &mut called_bindings,
    );
    collect_wasm_instance_factories(
        node,
        source,
        wasm_class_bindings,
        &mut wasm_instance_factories,
    );
    collect_imported_wasm_instance_factories(
        node,
        source,
        source_path,
        wasm_type_names,
        &called_bindings,
        &mut wasm_instance_factories,
    );
    collect_wasm_runtime_receivers(node, source, &mut scoped_wasm_runtime_receivers);
    collect_dynamic_wasm_aliases(
        node,
        source,
        source_path,
        first_line,
        callable_names,
        wasm_type_names,
        wasm_methods_by_type,
        wasm_namespace_bindings,
        wasm_class_bindings,
        wasm_instance_bindings,
        &wasm_instance_factories,
        &scoped_wasm_runtime_receivers,
        &mut scoped_wasm_namespaces,
        &mut scoped_wasm_instances,
        imported_callable_bindings,
        lines,
    );
}

#[allow(clippy::too_many_arguments)]
fn collect_dynamic_wasm_aliases(
    node: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    first_line: usize,
    callable_names: &HashSet<String>,
    wasm_type_names: &HashSet<String>,
    wasm_methods_by_type: &HashMap<String, HashSet<String>>,
    wasm_namespace_bindings: &mut HashMap<String, String>,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_instance_bindings: &mut HashMap<String, String>,
    wasm_instance_factories: &HashMap<String, String>,
    scoped_wasm_runtime_receivers: &[ScopedBinding],
    scoped_wasm_namespaces: &mut Vec<ScopedBinding>,
    scoped_wasm_instances: &mut Vec<ScopedBinding>,
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
) {
    if node.kind() == "assignment_expression"
        && let (Some(binding), Some(value)) = (
            node.child_by_field_name("left"),
            node.child_by_field_name("right"),
        )
    {
        invalidate_reassigned_wasm_binding(
            binding,
            source,
            scoped_wasm_namespaces,
            scoped_wasm_instances,
        );
        collect_binding_aliases(
            binding,
            value,
            source,
            source_path,
            first_line,
            callable_names,
            wasm_type_names,
            wasm_methods_by_type,
            wasm_namespace_bindings,
            wasm_class_bindings,
            wasm_instance_bindings,
            wasm_instance_factories,
            scoped_wasm_runtime_receivers,
            scoped_wasm_namespaces,
            scoped_wasm_instances,
            imported_callable_bindings,
            lines,
            true,
        );
    }

    if node.kind() == "variable_declarator"
        && let (Some(binding), Some(value)) = (
            node.child_by_field_name("name"),
            node.child_by_field_name("value"),
        )
        && collect_binding_aliases(
            binding,
            value,
            source,
            source_path,
            first_line,
            callable_names,
            wasm_type_names,
            wasm_methods_by_type,
            wasm_namespace_bindings,
            wasm_class_bindings,
            wasm_instance_bindings,
            wasm_instance_factories,
            scoped_wasm_runtime_receivers,
            scoped_wasm_namespaces,
            scoped_wasm_instances,
            imported_callable_bindings,
            lines,
            true,
        )
    {
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_dynamic_wasm_aliases(
            child,
            source,
            source_path,
            first_line,
            callable_names,
            wasm_type_names,
            wasm_methods_by_type,
            wasm_namespace_bindings,
            wasm_class_bindings,
            wasm_instance_bindings,
            wasm_instance_factories,
            scoped_wasm_runtime_receivers,
            scoped_wasm_namespaces,
            scoped_wasm_instances,
            imported_callable_bindings,
            lines,
        );
    }
}

fn invalidate_reassigned_wasm_binding(
    binding: tree_sitter::Node<'_>,
    source: &str,
    scoped_wasm_namespaces: &mut [ScopedBinding],
    scoped_wasm_instances: &mut [ScopedBinding],
) {
    let binding = unwrap_transparent_expression(binding);
    if binding.kind() != "identifier" {
        return;
    }
    let Ok(name) = binding.utf8_text(source.as_bytes()) else {
        return;
    };
    invalidate_visible_scoped_binding(binding, name, source, scoped_wasm_namespaces);
    invalidate_visible_scoped_binding(binding, name, source, scoped_wasm_instances);
}

#[allow(clippy::too_many_arguments)]
fn collect_binding_aliases(
    binding: tree_sitter::Node<'_>,
    value: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    first_line: usize,
    callable_names: &HashSet<String>,
    wasm_type_names: &HashSet<String>,
    wasm_methods_by_type: &HashMap<String, HashSet<String>>,
    wasm_namespace_bindings: &HashMap<String, String>,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_instance_bindings: &HashMap<String, String>,
    wasm_instance_factories: &HashMap<String, String>,
    scoped_wasm_runtime_receivers: &[ScopedBinding],
    scoped_wasm_namespaces: &mut Vec<ScopedBinding>,
    scoped_wasm_instances: &mut Vec<ScopedBinding>,
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
    inspect_object_pattern: bool,
) -> bool {
    let binding = unwrap_transparent_expression(binding);
    let value = unwrap_transparent_expression(value);
    if let Some(namespace_binding) = dynamic_namespace_binding(binding, value, source, source_path)
    {
        scoped_wasm_namespaces.push(namespace_binding);
    }
    if let Some(instance_binding) = wasm_instance_binding(
        binding,
        value,
        source,
        wasm_class_bindings,
        wasm_namespace_bindings,
        wasm_type_names,
        wasm_instance_factories,
        scoped_wasm_runtime_receivers,
    ) {
        scoped_wasm_instances.push(instance_binding);
    }
    if inspect_object_pattern
        && binding.kind() == "object_pattern"
        && let Some(module) = wasm_module_specifier(
            value,
            source,
            source_path,
            wasm_namespace_bindings,
            scoped_wasm_namespaces,
        )
    {
        collect_object_pattern_aliases(
            binding,
            source,
            first_line,
            callable_names,
            &module,
            source_path,
            imported_callable_bindings,
            lines,
        );
        return true;
    }
    if value.kind() == "object" {
        collect_object_literal_aliases(
            value,
            source,
            source_path,
            first_line,
            callable_names,
            wasm_type_names,
            wasm_methods_by_type,
            wasm_namespace_bindings,
            wasm_class_bindings,
            wasm_instance_bindings,
            scoped_wasm_namespaces,
            scoped_wasm_instances,
            lines,
        );
    }
    collect_namespace_member_alias(
        binding,
        value,
        source,
        source_path,
        first_line,
        callable_names,
        wasm_type_names,
        wasm_methods_by_type,
        wasm_namespace_bindings,
        wasm_class_bindings,
        wasm_instance_bindings,
        scoped_wasm_namespaces,
        scoped_wasm_instances,
        imported_callable_bindings,
        lines,
    );
    collect_named_callable_copy_alias(
        binding,
        value,
        source,
        first_line,
        imported_callable_bindings,
        lines,
    );
    false
}

fn dynamic_namespace_binding(
    binding: tree_sitter::Node<'_>,
    value: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
) -> Option<ScopedBinding> {
    if binding.kind() == "identifier"
        && let Some(module) = loaded_module_specifier(value, source)
        && is_wasm_callable_source(&module, source_path)
    {
        return scoped_binding(binding, source, None, Some(module));
    }
    None
}

#[allow(clippy::too_many_arguments)]
fn wasm_instance_binding(
    binding: tree_sitter::Node<'_>,
    value: tree_sitter::Node<'_>,
    source: &str,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_namespace_bindings: &HashMap<String, String>,
    wasm_type_names: &HashSet<String>,
    wasm_instance_factories: &HashMap<String, String>,
    scoped_wasm_runtime_receivers: &[ScopedBinding],
) -> Option<ScopedBinding> {
    if binding.kind() != "identifier" {
        return None;
    }
    if let Some(wasm_type) = value_is_wasm_instance(
        value,
        source,
        wasm_class_bindings,
        wasm_namespace_bindings,
        wasm_type_names,
        wasm_instance_factories,
        scoped_wasm_runtime_receivers,
    ) {
        return scoped_binding(binding, source, Some(wasm_type), None);
    }
    None
}

fn value_is_wasm_instance(
    value: tree_sitter::Node<'_>,
    source: &str,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_namespace_bindings: &HashMap<String, String>,
    wasm_type_names: &HashSet<String>,
    wasm_instance_factories: &HashMap<String, String>,
    scoped_wasm_runtime_receivers: &[ScopedBinding],
) -> Option<String> {
    let value = unwrap_transparent_expression(value);
    if value.kind() == "new_expression"
        && let Some(constructor) = value.child_by_field_name("constructor")
        && let Some(wasm_type) = constructor_wasm_class(
            constructor,
            source,
            wasm_class_bindings,
            wasm_namespace_bindings,
            wasm_type_names,
        )
    {
        return Some(wasm_type);
    }
    if value.kind() == "call_expression"
        && let Some(function) = value.child_by_field_name("function")
        && let Some(name) = callable_expression_name(function, source)
    {
        if name == WASM_MANAGER_ACCESSOR
            && wasm_runtime_accessor_receiver_is_visible(
                function,
                source,
                scoped_wasm_runtime_receivers,
            )
        {
            return Some("NookVaultManager".to_owned());
        }
        if root_binding_is_visible(function, &name, source)
            && let Some(wasm_type) = wasm_instance_factories.get(&name)
        {
            return Some(wasm_type.clone());
        }
    }
    if value.kind() == "await_expression" {
        let mut cursor = value.walk();
        return value.named_children(&mut cursor).find_map(|child| {
            value_is_wasm_instance(
                child,
                source,
                wasm_class_bindings,
                wasm_namespace_bindings,
                wasm_type_names,
                wasm_instance_factories,
                scoped_wasm_runtime_receivers,
            )
        });
    }
    None
}

fn constructor_wasm_class(
    constructor: tree_sitter::Node<'_>,
    source: &str,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_namespace_bindings: &HashMap<String, String>,
    wasm_type_names: &HashSet<String>,
) -> Option<String> {
    if constructor.kind() == "identifier" {
        let name = constructor.utf8_text(source.as_bytes()).ok()?;
        if !root_binding_is_visible(constructor, name, source) {
            return None;
        }
        return wasm_class_bindings.get(name).cloned();
    }
    if constructor.kind() != "member_expression" {
        return None;
    }
    let namespace = constructor.child_by_field_name("object")?;
    let class_name = constructor
        .child_by_field_name("property")
        .and_then(|property| semantic_node_name(property, source))?;
    let namespace_name = namespace.utf8_text(source.as_bytes()).ok()?;
    (wasm_namespace_bindings.contains_key(namespace_name)
        && root_binding_is_visible(namespace, namespace_name, source)
        && wasm_type_names.contains(&class_name))
    .then_some(class_name)
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

fn wasm_runtime_accessor_receiver_is_visible(
    function: tree_sitter::Node<'_>,
    source: &str,
    scoped_wasm_runtime_receivers: &[ScopedBinding],
) -> bool {
    let Some(receiver) = function.child_by_field_name("object") else {
        return false;
    };
    if expression_contains_property(receiver, source, WASM_RUNTIME_RECEIVER_PROPERTY) {
        return true;
    }
    receiver.utf8_text(source.as_bytes()).is_ok_and(|name| {
        scoped_binding_is_visible(receiver, name, source, scoped_wasm_runtime_receivers)
    })
}

fn callable_expression_name(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
    match node.kind() {
        "identifier" => semantic_node_name(node, source),
        "member_expression" => node
            .child_by_field_name("property")
            .and_then(|property| semantic_node_name(property, source)),
        "subscript_expression" => node
            .child_by_field_name("index")
            .and_then(|property| semantic_node_name(property, source)),
        _ => None,
    }
}

fn scoped_binding(
    binding: tree_sitter::Node<'_>,
    source: &str,
    wasm_type: Option<String>,
    wasm_module: Option<String>,
) -> Option<ScopedBinding> {
    let name = binding.utf8_text(source.as_bytes()).ok()?.to_owned();
    let mut ancestor = binding.parent();
    let scope = loop {
        let candidate = ancestor?;
        if matches!(candidate.kind(), "statement_block" | "program") {
            break candidate;
        }
        ancestor = candidate.parent();
    };
    Some(ScopedBinding {
        name,
        scope_start: scope.start_byte(),
        scope_end: scope.end_byte(),
        declaration_end: binding.parent()?.parent()?.end_byte(),
        wasm_type,
        wasm_module,
    })
}

fn wasm_module_specifier(
    value: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    wasm_namespace_bindings: &HashMap<String, String>,
    scoped_wasm_namespaces: &[ScopedBinding],
) -> Option<String> {
    if let Some(module) = loaded_module_specifier(value, source)
        && is_wasm_callable_source(&module, source_path)
    {
        return Some(module);
    }
    let name = value.utf8_text(source.as_bytes()).ok()?;
    if root_binding_is_visible(value, name, source)
        && let Some(module) = wasm_namespace_bindings.get(name)
    {
        return Some(module.clone());
    }
    scoped_wasm_module_visible(value, name, source, scoped_wasm_namespaces)
}

fn loaded_module_specifier(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
    if node.kind() == "call_expression"
        && let Some(function) = node.child_by_field_name("function")
        && (function.kind() == "import"
            || function
                .utf8_text(source.as_bytes())
                .is_ok_and(|name| name == "require"))
    {
        let arguments = node.child_by_field_name("arguments")?;
        let mut cursor = arguments.walk();
        return arguments
            .named_children(&mut cursor)
            .find(|argument| matches!(argument.kind(), "string" | "template_string"))
            .and_then(|argument| static_javascript_string(argument, source));
    }

    if matches!(
        node.kind(),
        "await_expression" | "parenthesized_expression" | "as_expression" | "satisfies_expression"
    ) {
        let mut cursor = node.walk();
        return node
            .named_children(&mut cursor)
            .find_map(|child| loaded_module_specifier(child, source));
    }

    None
}

#[allow(clippy::too_many_arguments)]
fn collect_object_pattern_aliases(
    pattern: tree_sitter::Node<'_>,
    source: &str,
    first_line: usize,
    callable_names: &HashSet<String>,
    module: &str,
    source_path: &Path,
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
) {
    let mut cursor = pattern.walk();
    for child in pattern.named_children(&mut cursor) {
        if child.kind() == "pair_pattern"
            && let Some(authored_name) = child.child_by_field_name("key")
            && let Some(name) = semantic_node_name(authored_name, source)
            && callable_names.contains(&name)
            && is_wasm_callable_export(module, &name, source_path)
            && let Some(binding) = child.child_by_field_name("value")
        {
            if semantic_node_name(binding, source).is_some_and(|binding_name| binding_name != name)
            {
                lines.push(first_line + authored_name.start_position().row);
            }
            if let Ok(binding_name) = binding.utf8_text(source.as_bytes()) {
                imported_callable_bindings.insert(binding_name.to_owned());
            }
        } else if child.kind() == "shorthand_property_identifier_pattern"
            && let Ok(name) = child.utf8_text(source.as_bytes())
            && callable_names.contains(name)
            && is_wasm_callable_export(module, name, source_path)
        {
            imported_callable_bindings.insert(name.to_owned());
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn collect_namespace_member_alias(
    binding: tree_sitter::Node<'_>,
    value: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    first_line: usize,
    callable_names: &HashSet<String>,
    wasm_type_names: &HashSet<String>,
    wasm_methods_by_type: &HashMap<String, HashSet<String>>,
    wasm_namespace_bindings: &HashMap<String, String>,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_instance_bindings: &HashMap<String, String>,
    scoped_wasm_namespaces: &[ScopedBinding],
    scoped_wasm_instances: &[ScopedBinding],
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
) {
    let value = unwrap_transparent_expression(value);
    if binding.kind() != "identifier" {
        return;
    }
    let Some(callable_name) = wasm_callable_member_name(
        value,
        source,
        source_path,
        callable_names,
        wasm_type_names,
        wasm_methods_by_type,
        wasm_namespace_bindings,
        wasm_class_bindings,
        wasm_instance_bindings,
        scoped_wasm_namespaces,
        scoped_wasm_instances,
    ) else {
        return;
    };
    let Ok(binding_name) = binding.utf8_text(source.as_bytes()) else {
        return;
    };
    if binding_name != callable_name {
        lines.push(first_line + binding.start_position().row);
    }
    imported_callable_bindings.insert(binding_name.to_owned());
}

#[allow(clippy::too_many_arguments)]
fn collect_object_literal_aliases(
    object: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    first_line: usize,
    callable_names: &HashSet<String>,
    wasm_type_names: &HashSet<String>,
    wasm_methods_by_type: &HashMap<String, HashSet<String>>,
    wasm_namespace_bindings: &HashMap<String, String>,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_instance_bindings: &HashMap<String, String>,
    scoped_wasm_namespaces: &[ScopedBinding],
    scoped_wasm_instances: &[ScopedBinding],
    lines: &mut Vec<usize>,
) {
    let mut cursor = object.walk();
    for child in object.named_children(&mut cursor) {
        if child.kind() == "pair"
            && let (Some(key), Some(value)) = (
                child.child_by_field_name("key"),
                child.child_by_field_name("value"),
            )
            && let Some(property_name) = semantic_node_name(key, source)
            && let Some(callable_name) = wasm_callable_member_name(
                value,
                source,
                source_path,
                callable_names,
                wasm_type_names,
                wasm_methods_by_type,
                wasm_namespace_bindings,
                wasm_class_bindings,
                wasm_instance_bindings,
                scoped_wasm_namespaces,
                scoped_wasm_instances,
            )
            && property_name != callable_name
        {
            lines.push(first_line + key.start_position().row);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn wasm_callable_member_name(
    value: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    callable_names: &HashSet<String>,
    wasm_type_names: &HashSet<String>,
    wasm_methods_by_type: &HashMap<String, HashSet<String>>,
    wasm_namespace_bindings: &HashMap<String, String>,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_instance_bindings: &HashMap<String, String>,
    scoped_wasm_namespaces: &[ScopedBinding],
    scoped_wasm_instances: &[ScopedBinding],
) -> Option<String> {
    let value = unwrap_transparent_expression(value);
    if !matches!(value.kind(), "member_expression" | "subscript_expression") {
        return None;
    }
    let namespace = value.child_by_field_name("object")?;
    let property = value
        .child_by_field_name("property")
        .or_else(|| value.child_by_field_name("index"))?;
    let callable_name = semantic_node_name(property, source)?;
    let direct_module = loaded_module_specifier(namespace, source);
    let namespace_name = namespace.utf8_text(source.as_bytes()).ok();
    let receiver_type = namespace_name
        .and_then(|name| {
            scoped_wasm_type_visible(namespace, name, source, scoped_wasm_instances).or_else(|| {
                root_binding_is_visible(namespace, name, source)
                    .then(|| {
                        wasm_class_bindings
                            .get(name)
                            .or_else(|| wasm_instance_bindings.get(name))
                            .cloned()
                    })
                    .flatten()
            })
        })
        .or_else(|| {
            namespace_member_wasm_type(
                namespace,
                source,
                source_path,
                wasm_type_names,
                wasm_namespace_bindings,
                scoped_wasm_namespaces,
            )
        });
    let recorded_module = namespace_name.and_then(|name| {
        if root_binding_is_visible(namespace, name, source) {
            wasm_namespace_bindings.get(name).cloned()
        } else {
            None
        }
        .or_else(|| scoped_wasm_module_visible(namespace, name, source, scoped_wasm_namespaces))
    });
    let is_callable = receiver_type.as_ref().is_some_and(|wasm_type| {
        wasm_methods_by_type
            .get(wasm_type)
            .is_some_and(|methods| methods.contains(&callable_name))
    }) || direct_module
        .as_ref()
        .or(recorded_module.as_ref())
        .is_some_and(|module| {
            callable_names.contains(&callable_name)
                && is_wasm_callable_export(module, &callable_name, source_path)
        });
    is_callable.then_some(callable_name)
}

fn namespace_member_wasm_type(
    expression: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    wasm_type_names: &HashSet<String>,
    wasm_namespace_bindings: &HashMap<String, String>,
    scoped_wasm_namespaces: &[ScopedBinding],
) -> Option<String> {
    if !matches!(
        expression.kind(),
        "member_expression" | "subscript_expression"
    ) {
        return None;
    }
    let namespace = expression.child_by_field_name("object")?;
    let type_node = expression
        .child_by_field_name("property")
        .or_else(|| expression.child_by_field_name("index"))?;
    let wasm_type = semantic_node_name(type_node, source)?;
    if !wasm_type_names.contains(&wasm_type) {
        return None;
    }
    let module = wasm_module_specifier(
        namespace,
        source,
        source_path,
        wasm_namespace_bindings,
        scoped_wasm_namespaces,
    )?;
    is_wasm_export(&module, &wasm_type, source_path).then_some(wasm_type)
}

fn scoped_wasm_type_visible(
    reference: tree_sitter::Node<'_>,
    name: &str,
    source: &str,
    bindings: &[ScopedBinding],
) -> Option<String> {
    visible_scoped_binding(reference, name, source, bindings)
        .and_then(|binding| binding.wasm_type.clone())
}

fn scoped_wasm_module_visible(
    reference: tree_sitter::Node<'_>,
    name: &str,
    source: &str,
    bindings: &[ScopedBinding],
) -> Option<String> {
    visible_scoped_binding(reference, name, source, bindings)
        .and_then(|binding| binding.wasm_module.clone())
}

fn collect_named_callable_copy_alias(
    binding: tree_sitter::Node<'_>,
    value: tree_sitter::Node<'_>,
    source: &str,
    first_line: usize,
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
) {
    if binding.kind() != "identifier" || value.kind() != "identifier" {
        return;
    }
    let Ok(source_name) = value.utf8_text(source.as_bytes()) else {
        return;
    };
    if !imported_callable_bindings.contains(source_name)
        || !root_binding_is_visible(value, source_name, source)
    {
        return;
    }
    let Ok(binding_name) = binding.utf8_text(source.as_bytes()) else {
        return;
    };
    if binding_name != source_name {
        lines.push(first_line + binding.start_position().row);
    }
    if declaration_is_in_program_scope(binding) {
        imported_callable_bindings.insert(binding_name.to_owned());
    }
}
