use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::javascript_literals::semantic_javascript_name as semantic_node_name;
use crate::javascript_scopes::{
    ScopedBinding, root_binding_is_visible, scoped_binding, scoped_binding_is_visible,
};
use crate::wasm_dynamic_aliases::{
    constructor_wasm_class, loaded_module_specifier, scoped_wasm_module_visible,
    scoped_wasm_type_visible, unwrap_transparent_expression, wasm_module_specifier,
};
use crate::wasm_inventory::WasmTypeInventory;
use crate::wasm_module_sources::{is_wasm_callable_export, is_wasm_export};

#[allow(clippy::too_many_arguments)]
pub(super) fn collect_destructuring_aliases(
    binding: tree_sitter::Node<'_>,
    value: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    first_line: usize,
    callable_names: &HashSet<String>,
    wasm_type_names: &HashSet<String>,
    wasm_types: &WasmTypeInventory,
    wasm_namespace_bindings: &HashMap<String, String>,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_instance_bindings: &HashMap<String, String>,
    scoped_wasm_namespaces: &[ScopedBinding],
    scoped_wasm_instances: &[ScopedBinding],
    scoped_wasm_callables: &mut Vec<ScopedBinding>,
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
) -> bool {
    if binding.kind() == "array_pattern" && value.kind() == "array" {
        let values = array_elements(value);
        for (index, binding) in array_elements(binding) {
            let Some(value) = values.get(&index).copied() else {
                continue;
            };
            if let Some(callable) = wasm_callable_member_name(
                value,
                source,
                source_path,
                callable_names,
                wasm_type_names,
                wasm_types,
                wasm_namespace_bindings,
                wasm_class_bindings,
                wasm_instance_bindings,
                scoped_wasm_namespaces,
                scoped_wasm_instances,
            ) && let Some(name) = semantic_node_name(binding, source)
            {
                if name != callable {
                    lines.push(first_line + binding.start_position().row);
                }
                if let Some(scoped) = scoped_binding(binding, source, None, None) {
                    scoped_wasm_callables.push(scoped);
                }
            }
        }
        return true;
    }
    if binding.kind() != "object_pattern" {
        return false;
    }
    if collect_tracked_object_pattern_aliases(
        binding,
        value,
        source,
        first_line,
        scoped_wasm_callables,
        lines,
    ) {
        return true;
    }
    if let Some(module) = wasm_module_specifier(
        value,
        source,
        source_path,
        wasm_namespace_bindings,
        scoped_wasm_namespaces,
    ) {
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
    let Some(wasm_type) = wasm_receiver_type(
        value,
        source,
        source_path,
        wasm_type_names,
        wasm_namespace_bindings,
        wasm_class_bindings,
        wasm_instance_bindings,
        wasm_types,
        scoped_wasm_namespaces,
        scoped_wasm_instances,
    ) else {
        return false;
    };
    collect_type_pattern_aliases(
        binding,
        source,
        first_line,
        &wasm_type,
        wasm_types,
        imported_callable_bindings,
        lines,
    );
    true
}

fn collect_tracked_object_pattern_aliases(
    pattern: tree_sitter::Node<'_>,
    value: tree_sitter::Node<'_>,
    source: &str,
    first_line: usize,
    callables: &mut Vec<ScopedBinding>,
    lines: &mut Vec<usize>,
) -> bool {
    let Some(owner) = semantic_node_name(value, source) else {
        return false;
    };
    let mut found = false;
    let mut cursor = pattern.walk();
    for pair in pattern.named_children(&mut cursor) {
        let Some(property) = pair.child_by_field_name("key") else {
            continue;
        };
        let Some(property_name) = semantic_node_name(property, source) else {
            continue;
        };
        let full_name = format!("{owner}.{property_name}");
        if !scoped_binding_is_visible(value, &full_name, source, callables) {
            continue;
        }
        let binding = pair.child_by_field_name("value").unwrap_or(property);
        if semantic_node_name(binding, source).is_some_and(|name| name != property_name) {
            lines.push(first_line + property.start_position().row);
        }
        if let Some(scoped) = scoped_binding(binding, source, None, None) {
            callables.push(scoped);
        }
        found = true;
    }
    found
}

fn array_elements(node: tree_sitter::Node<'_>) -> HashMap<usize, tree_sitter::Node<'_>> {
    let (mut elements, mut index, mut cursor) = (HashMap::new(), 0, node.walk());
    for child in node.children(&mut cursor) {
        if child.kind() == "," {
            index += 1;
        } else if child.is_named() {
            elements.insert(index, child);
        }
    }
    elements
}

#[allow(clippy::too_many_arguments)]
pub(super) fn collect_object_pattern_aliases(
    pattern: tree_sitter::Node<'_>,
    source: &str,
    first_line: usize,
    callable_names: &HashSet<String>,
    module: &str,
    source_path: &Path,
    _imported_callable_bindings: &mut HashSet<String>,
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
            && semantic_node_name(binding, source).is_some_and(|binding_name| binding_name != name)
        {
            lines.push(first_line + authored_name.start_position().row);
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn collect_namespace_member_alias(
    binding: tree_sitter::Node<'_>,
    value: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    first_line: usize,
    callable_names: &HashSet<String>,
    wasm_type_names: &HashSet<String>,
    wasm_types: &WasmTypeInventory,
    wasm_namespace_bindings: &HashMap<String, String>,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_instance_bindings: &HashMap<String, String>,
    scoped_wasm_namespaces: &[ScopedBinding],
    scoped_wasm_instances: &[ScopedBinding],
    scoped_wasm_callables: &mut Vec<ScopedBinding>,
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
) {
    let value = unwrap_transparent_expression(value);
    let binding_name_node = match binding.kind() {
        "identifier" | "property_identifier" | "private_property_identifier" => Some(binding),
        "member_expression" => binding.child_by_field_name("property"),
        "subscript_expression" => binding.child_by_field_name("index"),
        _ => None,
    };
    let Some(binding_name_node) = binding_name_node else {
        return;
    };
    let Some(callable_name) = wasm_callable_member_name(
        value,
        source,
        source_path,
        callable_names,
        wasm_type_names,
        wasm_types,
        wasm_namespace_bindings,
        wasm_class_bindings,
        wasm_instance_bindings,
        scoped_wasm_namespaces,
        scoped_wasm_instances,
    ) else {
        return;
    };
    let Some(binding_name) = semantic_node_name(binding_name_node, source) else {
        return;
    };
    if binding_name != callable_name {
        lines.push(first_line + binding_name_node.start_position().row);
    }
    if binding.kind() == "identifier" {
        if let Some(scoped) = scoped_binding(binding, source, None, None) {
            scoped_wasm_callables.push(scoped);
        } else {
            imported_callable_bindings.insert(binding_name);
        }
    }
}

pub(super) fn collect_type_pattern_aliases(
    pattern: tree_sitter::Node<'_>,
    source: &str,
    first_line: usize,
    wasm_type: &str,
    wasm_types: &WasmTypeInventory,
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
) {
    let Some(methods) = wasm_types.methods.get(wasm_type) else {
        return;
    };
    let mut cursor = pattern.walk();
    for child in pattern.named_children(&mut cursor) {
        if child.kind() == "pair_pattern"
            && let Some(method_node) = child.child_by_field_name("key")
            && let Some(method_name) = semantic_node_name(method_node, source)
            && methods.contains(&method_name)
            && let Some(binding) = child.child_by_field_name("value")
            && let Some(binding_name) = semantic_node_name(binding, source)
        {
            if binding_name != method_name {
                lines.push(first_line + method_node.start_position().row);
            }
            imported_callable_bindings.insert(binding_name);
        } else if child.kind() == "shorthand_property_identifier_pattern"
            && let Some(method_name) = semantic_node_name(child, source)
            && methods.contains(&method_name)
        {
            imported_callable_bindings.insert(method_name);
        }
    }
}

#[allow(clippy::too_many_arguments)]
#[rustfmt::skip]
pub(super) fn collect_object_literal_aliases(object: tree_sitter::Node<'_>, source: &str, source_path: &Path, first_line: usize, callable_names: &HashSet<String>, wasm_type_names: &HashSet<String>, wasm_types: &WasmTypeInventory, wasm_namespace_bindings: &HashMap<String, String>, wasm_class_bindings: &HashMap<String, String>, wasm_instance_bindings: &HashMap<String, String>, scoped_wasm_namespaces: &[ScopedBinding], scoped_wasm_instances: &[ScopedBinding], scoped_wasm_callables: &mut Vec<ScopedBinding>, imported_callable_bindings: &HashSet<String>, lines: &mut Vec<usize>) {
    let mut cursor = object.walk();
    for child in object.named_children(&mut cursor) {
        let pair = (child.kind() == "pair").then(|| {
            Some((
                child.child_by_field_name("key"),
                child.child_by_field_name("value"),
            ))
        });
        let shorthand = matches!(child.kind(), "shorthand_property_identifier" | "shorthand_property_identifier_pattern").then_some((Some(child), Some(child)));
        let Some((Some(key), Some(value))) = pair.flatten().or(shorthand) else {
            continue;
        };
        let Some(property_name) = semantic_node_name(key, source) else {
            continue;
        };
        let callable_name = wasm_callable_member_name(
            value,
            source,
            source_path,
            callable_names,
            wasm_type_names,
            wasm_types,
            wasm_namespace_bindings,
            wasm_class_bindings,
            wasm_instance_bindings,
            scoped_wasm_namespaces,
            scoped_wasm_instances,
        )
        .or_else(|| {
            let name = semantic_node_name(value, source)?;
            ((imported_callable_bindings.contains(&name)
                && root_binding_is_visible(value, &name, source))
                || scoped_binding_is_visible(value, &name, source, scoped_wasm_callables))
            .then_some(name)
        });
        if let Some(callable_name) = callable_name {
            if property_name != callable_name {
                lines.push(first_line + key.start_position().row);
            }
            if let Some(owner) = object
                .parent()
                .filter(|parent| parent.kind() == "variable_declarator")
                .and_then(|parent| parent.child_by_field_name("name"))
                && let Some(owner_name) = semantic_node_name(owner, source)
                && let Some(mut scoped) = scoped_binding(owner, source, None, None)
            {
                scoped.name = format!("{owner_name}.{property_name}");
                scoped_wasm_callables.push(scoped);
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn collect_object_literal_aliases_in_tree(
    node: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    first_line: usize,
    callable_names: &HashSet<String>,
    wasm_type_names: &HashSet<String>,
    wasm_types: &WasmTypeInventory,
    wasm_namespace_bindings: &HashMap<String, String>,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_instance_bindings: &HashMap<String, String>,
    scoped_wasm_namespaces: &[ScopedBinding],
    scoped_wasm_instances: &[ScopedBinding],
    scoped_wasm_callables: &mut Vec<ScopedBinding>,
    imported_callable_bindings: &HashSet<String>,
    lines: &mut Vec<usize>,
) {
    if node.kind() == "object" {
        collect_object_literal_aliases(
            node,
            source,
            source_path,
            first_line,
            callable_names,
            wasm_type_names,
            wasm_types,
            wasm_namespace_bindings,
            wasm_class_bindings,
            wasm_instance_bindings,
            scoped_wasm_namespaces,
            scoped_wasm_instances,
            scoped_wasm_callables,
            imported_callable_bindings,
            lines,
        );
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_object_literal_aliases_in_tree(
            child,
            source,
            source_path,
            first_line,
            callable_names,
            wasm_type_names,
            wasm_types,
            wasm_namespace_bindings,
            wasm_class_bindings,
            wasm_instance_bindings,
            scoped_wasm_namespaces,
            scoped_wasm_instances,
            scoped_wasm_callables,
            imported_callable_bindings,
            lines,
        );
    }
}

#[allow(clippy::too_many_arguments)]
#[rustfmt::skip]
fn wasm_callable_member_name(value: tree_sitter::Node<'_>, source: &str, source_path: &Path, callable_names: &HashSet<String>, wasm_type_names: &HashSet<String>, wasm_types: &WasmTypeInventory, wasm_namespace_bindings: &HashMap<String, String>, wasm_class_bindings: &HashMap<String, String>, wasm_instance_bindings: &HashMap<String, String>, scoped_wasm_namespaces: &[ScopedBinding], scoped_wasm_instances: &[ScopedBinding]) -> Option<String> {
    let mut value = unwrap_transparent_expression(value);
    if value.kind() == "sequence_expression" {
        let mut cursor = value.walk();
        return value.named_children(&mut cursor).last().and_then(|result| {
            wasm_callable_member_name(result, source, source_path, callable_names, wasm_type_names, wasm_types, wasm_namespace_bindings, wasm_class_bindings, wasm_instance_bindings, scoped_wasm_namespaces, scoped_wasm_instances)
        });
    }
    if matches!(value.kind(), "ternary_expression" | "binary_expression") {
        let mut cursor = value.walk();
        return value.named_children(&mut cursor).find_map(|branch| {
            wasm_callable_member_name(
                branch,
                source,
                source_path,
                callable_names,
                wasm_type_names,
                wasm_types,
                wasm_namespace_bindings,
                wasm_class_bindings,
                wasm_instance_bindings,
                scoped_wasm_namespaces,
                scoped_wasm_instances,
            )
        });
    }
    if value.kind() == "call_expression"
        && let Some(function) = value.child_by_field_name("function")
        && matches!(
            function.kind(),
            "member_expression" | "subscript_expression"
        )
        && function
            .child_by_field_name("property")
            .or_else(|| function.child_by_field_name("index"))
            .and_then(|property| semantic_node_name(property, source))
            .is_some_and(|name| name == "bind")
        && let Some(bound) = function.child_by_field_name("object")
    {
        value = unwrap_transparent_expression(bound);
    }
    if !matches!(value.kind(), "member_expression" | "subscript_expression") {
        return None;
    }
    let namespace = unwrap_transparent_expression(value.child_by_field_name("object")?);
    let property = value
        .child_by_field_name("property")
        .or_else(|| value.child_by_field_name("index"))?;
    let callable_name = semantic_node_name(property, source)?;
    let direct_module = loaded_module_specifier(namespace, source);
    let namespace_name = namespace.utf8_text(source.as_bytes()).ok();
    let receiver_type = wasm_receiver_type(
        namespace,
        source,
        source_path,
        wasm_type_names,
        wasm_namespace_bindings,
        wasm_class_bindings,
        wasm_instance_bindings,
        wasm_types,
        scoped_wasm_namespaces,
        scoped_wasm_instances,
    );
    let recorded_module = namespace_name.and_then(|name| {
        if root_binding_is_visible(namespace, name, source) {
            wasm_namespace_bindings.get(name).cloned()
        } else {
            None
        }
        .or_else(|| scoped_wasm_module_visible(namespace, name, source, scoped_wasm_namespaces))
    });
    let is_callable = receiver_type.as_ref().is_some_and(|wasm_type| {
        wasm_types
            .methods
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

#[allow(clippy::too_many_arguments)]
pub(super) fn wasm_receiver_type(
    receiver: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    wasm_type_names: &HashSet<String>,
    wasm_namespace_bindings: &HashMap<String, String>,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_instance_bindings: &HashMap<String, String>,
    wasm_types: &WasmTypeInventory,
    scoped_wasm_namespaces: &[ScopedBinding],
    scoped_wasm_instances: &[ScopedBinding],
) -> Option<String> {
    let receiver = unwrap_transparent_expression(receiver);
    if receiver.kind() == "new_expression"
        && let Some(constructor) = receiver.child_by_field_name("constructor")
        && let Some(wasm_type) = constructor_wasm_class(
            constructor,
            source,
            wasm_class_bindings,
            wasm_namespace_bindings,
            scoped_wasm_namespaces,
            wasm_type_names,
        )
    {
        return Some(wasm_type);
    }
    if receiver.kind() == "call_expression"
        && let Some(function) = receiver.child_by_field_name("function")
        && matches!(
            function.kind(),
            "member_expression" | "subscript_expression"
        )
        && let Some(object) = function.child_by_field_name("object")
        && let Some(owner) = wasm_receiver_type(
            object,
            source,
            source_path,
            wasm_type_names,
            wasm_namespace_bindings,
            wasm_class_bindings,
            wasm_instance_bindings,
            wasm_types,
            scoped_wasm_namespaces,
            scoped_wasm_instances,
        )
        && let Some(method) = function
            .child_by_field_name("property")
            .or_else(|| function.child_by_field_name("index"))
            .and_then(|node| semantic_node_name(node, source))
        && let Some(returned) = wasm_types.returns.get(&(owner, method))
        && wasm_type_names.contains(returned)
    {
        return Some(returned.clone());
    }
    let receiver_name = receiver.utf8_text(source.as_bytes()).ok();
    receiver_name
        .and_then(|name| {
            scoped_wasm_type_visible(receiver, name, source, scoped_wasm_instances).or_else(|| {
                root_binding_is_visible(receiver, name, source)
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
                receiver,
                source,
                source_path,
                wasm_type_names,
                wasm_namespace_bindings,
                scoped_wasm_namespaces,
            )
        })
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
