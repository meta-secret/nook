use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::javascript_literals::{
    callable_expression_name, semantic_javascript_name as semantic_node_name,
    static_javascript_string,
};
use crate::javascript_scopes::{
    ScopedBinding, declaration_is_in_program_scope, deferred_assignment_executes,
    deferred_invocation_end, invalidate_visible_scoped_binding, root_binding_is_visible,
    scoped_binding, scoped_binding_is_visible, visible_scoped_binding,
};
use crate::wasm_dynamic_callables::collect_scoped_dynamic_callable_bindings;
use crate::wasm_factories::{
    collect_factory_calls_for_receivers, collect_imported_wasm_instance_factories,
    collect_member_alias_receiver_names, collect_typed_wasm_instances,
    collect_wasm_instance_factories,
};
use crate::wasm_inventory::WasmTypeInventory;
use crate::wasm_member_aliases::{
    collect_destructuring_aliases, collect_namespace_member_alias,
    collect_object_literal_aliases_in_tree,
};
use crate::wasm_module_sources::{
    is_wasm_callable_export, is_wasm_callable_source, is_wasm_export, wasm_namespace_export_source,
};

const WASM_MANAGER_ACCESSOR: &str = "requireManager";
const WASM_RUNTIME_RECEIVER_PROPERTY: &str = "__nookVault";

pub(super) fn collect_namespace_import_bindings(
    node: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
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
    if node.kind() == "import_specifier"
        && !node_is_type_only_import(node, source)
        && let Some(imported) = node.child_by_field_name("name")
        && let Some(imported_name) = semantic_node_name(imported, source)
        && let Some(namespace_source) =
            wasm_namespace_export_source(module, &imported_name, source_path)
    {
        let binding = node.child_by_field_name("alias").unwrap_or(imported);
        if let Ok(binding_name) = binding.utf8_text(source.as_bytes()) {
            wasm_namespace_bindings.insert(binding_name.to_owned(), namespace_source);
        }
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_namespace_import_bindings(
            child,
            source,
            source_path,
            module,
            wasm_namespace_bindings,
        );
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
    if node.kind() == "namespace_import" {
        let mut cursor = node.walk();
        if let Some(namespace) = node
            .named_children(&mut cursor)
            .find_map(|child| semantic_node_name(child, source))
        {
            for wasm_type in wasm_type_names {
                if is_wasm_export(module, wasm_type, source_path) {
                    wasm_class_bindings
                        .insert(format!("{namespace}.{wasm_type}"), wasm_type.clone());
                }
            }
        }
        return;
    }
    if node.kind() == "import_specifier"
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
    let node = unwrap_transparent_expression(node);
    if matches!(node.kind(), "member_expression" | "subscript_expression") {
        let property = if node.kind() == "subscript_expression" {
            node.child_by_field_name("index")
        } else {
            node.child_by_field_name("property")
        };
        return property
            .and_then(|property| semantic_node_name(property, source))
            .is_some_and(|property| property == property_name);
    }
    false
}

#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_lines)]
pub(super) fn collect_dynamic_wasm_aliases_and_bindings(
    node: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    first_line: usize,
    callable_names: &HashSet<String>,
    wasm_type_names: &HashSet<String>,
    wasm_types: &WasmTypeInventory,
    wasm_namespace_bindings: &mut HashMap<String, String>,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_instance_bindings: &mut HashMap<String, String>,
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
) {
    let (mut scoped_wasm_namespaces, mut scoped_wasm_instances) = (Vec::new(), Vec::new());
    let (mut scoped_wasm_callables, mut scoped_wasm_runtime_receivers) = (Vec::new(), Vec::new());
    let mut scoped_wasm_factories = Vec::new();
    let mut imported_wasm_factories = HashMap::new();
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
        &mut scoped_wasm_factories,
    );
    collect_imported_wasm_instance_factories(
        node,
        source,
        source_path,
        wasm_type_names,
        &called_bindings,
        &mut imported_wasm_factories,
    );
    collect_wasm_runtime_receivers(node, source, &mut scoped_wasm_runtime_receivers);
    collect_typed_wasm_instances(
        node,
        source,
        wasm_class_bindings,
        &mut scoped_wasm_instances,
    );
    collect_scoped_dynamic_callable_bindings(
        node,
        source,
        source_path,
        callable_names,
        wasm_namespace_bindings,
        &mut scoped_wasm_namespaces,
        &mut scoped_wasm_callables,
        lines,
        first_line,
    );
    collect_dynamic_wasm_aliases(
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
        &imported_wasm_factories,
        &scoped_wasm_factories,
        &scoped_wasm_runtime_receivers,
        &mut scoped_wasm_namespaces,
        &mut scoped_wasm_instances,
        &mut scoped_wasm_callables,
        imported_callable_bindings,
        lines,
    );
    collect_object_literal_aliases_in_tree(
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
        &scoped_wasm_namespaces,
        &scoped_wasm_instances,
        &mut scoped_wasm_callables,
        imported_callable_bindings,
        lines,
    );
    collect_dynamic_wasm_aliases(
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
        &imported_wasm_factories,
        &scoped_wasm_factories,
        &scoped_wasm_runtime_receivers,
        &mut scoped_wasm_namespaces,
        &mut scoped_wasm_instances,
        &mut scoped_wasm_callables,
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
    wasm_types: &WasmTypeInventory,
    wasm_namespace_bindings: &mut HashMap<String, String>,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_instance_bindings: &mut HashMap<String, String>,
    wasm_instance_factories: &HashMap<String, String>,
    scoped_wasm_factories: &[ScopedBinding],
    scoped_wasm_runtime_receivers: &[ScopedBinding],
    scoped_wasm_namespaces: &mut Vec<ScopedBinding>,
    scoped_wasm_instances: &mut Vec<ScopedBinding>,
    scoped_wasm_callables: &mut Vec<ScopedBinding>,
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
) {
    if matches!(
        node.kind(),
        "assignment_expression" | "augmented_assignment_expression"
    ) && let (Some(binding), Some(value)) = (
        node.child_by_field_name("left"),
        node.child_by_field_name("right"),
    ) {
        invalidate_reassigned_wasm_binding(
            binding,
            source,
            scoped_wasm_namespaces,
            scoped_wasm_instances,
            scoped_wasm_callables,
            imported_callable_bindings,
        );
        collect_binding_aliases(
            binding,
            value,
            source,
            source_path,
            first_line,
            callable_names,
            wasm_type_names,
            wasm_types,
            wasm_namespace_bindings,
            wasm_class_bindings,
            wasm_instance_bindings,
            wasm_instance_factories,
            scoped_wasm_factories,
            scoped_wasm_runtime_receivers,
            scoped_wasm_namespaces,
            scoped_wasm_instances,
            scoped_wasm_callables,
            imported_callable_bindings,
            lines,
            true,
        );
    }

    if matches!(
        node.kind(),
        "variable_declarator"
            | "public_field_definition"
            | "required_parameter"
            | "optional_parameter"
    ) && let (Some(binding), Some(value)) = (
        node.child_by_field_name("name")
            .or_else(|| node.child_by_field_name("pattern")),
        node.child_by_field_name("value"),
    ) && collect_binding_aliases(
        binding,
        value,
        source,
        source_path,
        first_line,
        callable_names,
        wasm_type_names,
        wasm_types,
        wasm_namespace_bindings,
        wasm_class_bindings,
        wasm_instance_bindings,
        wasm_instance_factories,
        scoped_wasm_factories,
        scoped_wasm_runtime_receivers,
        scoped_wasm_namespaces,
        scoped_wasm_instances,
        scoped_wasm_callables,
        imported_callable_bindings,
        lines,
        true,
    ) {
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
            wasm_types,
            wasm_namespace_bindings,
            wasm_class_bindings,
            wasm_instance_bindings,
            wasm_instance_factories,
            scoped_wasm_factories,
            scoped_wasm_runtime_receivers,
            scoped_wasm_namespaces,
            scoped_wasm_instances,
            scoped_wasm_callables,
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
    scoped_wasm_callables: &mut [ScopedBinding],
    imported_callable_bindings: &mut HashSet<String>,
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
    if invalidate_visible_scoped_binding(binding, name, source, scoped_wasm_callables) {
        imported_callable_bindings.remove(name);
    }
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
    wasm_types: &WasmTypeInventory,
    wasm_namespace_bindings: &HashMap<String, String>,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_instance_bindings: &HashMap<String, String>,
    wasm_instance_factories: &HashMap<String, String>,
    scoped_wasm_factories: &[ScopedBinding],
    scoped_wasm_runtime_receivers: &[ScopedBinding],
    scoped_wasm_namespaces: &mut Vec<ScopedBinding>,
    scoped_wasm_instances: &mut Vec<ScopedBinding>,
    scoped_wasm_callables: &mut Vec<ScopedBinding>,
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
    inspect_object_pattern: bool,
) -> bool {
    let binding = unwrap_transparent_expression(binding);
    let value = unwrap_transparent_expression(value);
    if binding.kind() == "identifier"
        && let Some(module) = loaded_module_specifier(value, source)
        && is_wasm_callable_export(&module, "default", source_path)
        && let Some(name) = semantic_node_name(binding, source)
    {
        lines.push(first_line + binding.start_position().row);
        if let Some(scoped) = scoped_binding(binding, source, None, None) {
            scoped_wasm_callables.push(scoped);
        } else {
            imported_callable_bindings.insert(name);
        }
        return true;
    }
    if let Some(namespace_binding) = dynamic_namespace_binding(
        binding,
        value,
        source,
        source_path,
        wasm_namespace_bindings,
        scoped_wasm_namespaces,
    ) {
        scoped_wasm_namespaces.push(namespace_binding);
    }
    if let Some(instance_binding) = wasm_instance_binding(
        binding,
        value,
        source,
        wasm_class_bindings,
        wasm_namespace_bindings,
        scoped_wasm_namespaces,
        wasm_type_names,
        wasm_instance_factories,
        scoped_wasm_factories,
        scoped_wasm_runtime_receivers,
        wasm_instance_bindings,
        scoped_wasm_instances,
    ) {
        scoped_wasm_instances.push(instance_binding);
    }
    if inspect_object_pattern
        && collect_destructuring_aliases(
            binding,
            value,
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
        )
    {
        return true;
    }
    collect_namespace_member_alias(
        binding,
        value,
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
    collect_named_callable_copy_alias(
        binding,
        value,
        source,
        first_line,
        imported_callable_bindings,
        scoped_wasm_callables,
        lines,
    );
    false
}

fn dynamic_namespace_binding(
    binding: tree_sitter::Node<'_>,
    value: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    wasm_namespace_bindings: &HashMap<String, String>,
    scoped_wasm_namespaces: &[ScopedBinding],
) -> Option<ScopedBinding> {
    let reference = binding;
    let binding = declared_binding(binding, source).unwrap_or(binding);
    if binding.kind() == "identifier"
        && let Some(module) = wasm_module_specifier(
            value,
            source,
            source_path,
            wasm_namespace_bindings,
            scoped_wasm_namespaces,
        )
    {
        let mut scoped = scoped_binding(binding, source, None, Some(module))?;
        if let Some(invocation_end) = deferred_invocation_end(reference, &scoped, source) {
            scoped.declaration_end = invocation_end;
        }
        return Some(scoped);
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
    scoped_wasm_namespaces: &[ScopedBinding],
    wasm_type_names: &HashSet<String>,
    wasm_instance_factories: &HashMap<String, String>,
    scoped_wasm_factories: &[ScopedBinding],
    scoped_wasm_runtime_receivers: &[ScopedBinding],
    wasm_instance_bindings: &HashMap<String, String>,
    scoped_wasm_instances: &[ScopedBinding],
) -> Option<ScopedBinding> {
    let reference = binding;
    let binding = declared_binding(binding, source).unwrap_or(binding);
    if !matches!(
        binding.kind(),
        "identifier" | "member_expression" | "subscript_expression"
    ) {
        return None;
    }
    if let Some(wasm_type) = value_is_wasm_instance(
        value,
        source,
        wasm_class_bindings,
        wasm_namespace_bindings,
        scoped_wasm_namespaces,
        wasm_type_names,
        wasm_instance_factories,
        scoped_wasm_factories,
        scoped_wasm_runtime_receivers,
        wasm_instance_bindings,
        scoped_wasm_instances,
    ) {
        let mut scoped = scoped_binding(binding, source, Some(wasm_type), None)?;
        if let Some(invocation_end) = deferred_invocation_end(reference, &scoped, source) {
            scoped.declaration_end = invocation_end;
        }
        return Some(scoped);
    }
    None
}

fn declared_binding<'a>(
    reference: tree_sitter::Node<'a>,
    source: &str,
) -> Option<tree_sitter::Node<'a>> {
    if reference.kind() != "identifier" {
        return None;
    }
    let name = semantic_node_name(reference, source)?;
    let mut root = reference;
    while let Some(parent) = root.parent() {
        root = parent;
    }
    find_declared_binding(root, reference, &name, source)
}

fn find_declared_binding<'a>(
    node: tree_sitter::Node<'a>,
    reference: tree_sitter::Node<'_>,
    name: &str,
    source: &str,
) -> Option<tree_sitter::Node<'a>> {
    if node.kind() == "variable_declarator"
        && let Some(binding) = node.child_by_field_name("name")
        && semantic_node_name(binding, source).as_deref() == Some(name)
        && let Some(scoped) = scoped_binding(binding, source, None, None)
        && deferred_assignment_executes(reference, &scoped, source)
        && scoped_binding_is_visible(reference, name, source, &[scoped])
    {
        return Some(binding);
    }
    let mut cursor = node.walk();
    node.named_children(&mut cursor)
        .find_map(|child| find_declared_binding(child, reference, name, source))
}

#[allow(clippy::too_many_arguments)]
fn value_is_wasm_instance(
    value: tree_sitter::Node<'_>,
    source: &str,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_namespace_bindings: &HashMap<String, String>,
    scoped_wasm_namespaces: &[ScopedBinding],
    wasm_type_names: &HashSet<String>,
    wasm_instance_factories: &HashMap<String, String>,
    scoped_wasm_factories: &[ScopedBinding],
    scoped_wasm_runtime_receivers: &[ScopedBinding],
    wasm_instance_bindings: &HashMap<String, String>,
    scoped_wasm_instances: &[ScopedBinding],
) -> Option<String> {
    let value = unwrap_transparent_expression(value);
    if value.kind() == "identifier"
        && let Ok(name) = value.utf8_text(source.as_bytes())
    {
        if let Some(wasm_type) =
            scoped_wasm_type_visible(value, name, source, scoped_wasm_instances)
        {
            return Some(wasm_type);
        }
        if root_binding_is_visible(value, name, source)
            && let Some(wasm_type) = wasm_instance_bindings.get(name)
        {
            return Some(wasm_type.clone());
        }
    }
    if value.kind() == "new_expression"
        && let Some(constructor) = value.child_by_field_name("constructor")
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
    if value.kind() == "call_expression"
        && let Some(function) = value.child_by_field_name("function")
        && let Some(name) = callable_expression_name(function, source)
    {
        if let Ok(full_name) = function.utf8_text(source.as_bytes())
            && let Some(wasm_type) = wasm_instance_factories.get(full_name)
        {
            return Some(wasm_type.clone());
        }
        if name == WASM_MANAGER_ACCESSOR
            && wasm_runtime_accessor_receiver_is_visible(
                function,
                source,
                scoped_wasm_runtime_receivers,
            )
        {
            return Some("NookVaultManager".to_owned());
        }
        if let Some(wasm_type) =
            scoped_wasm_type_visible(function, &name, source, scoped_wasm_factories)
        {
            return Some(wasm_type);
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
                scoped_wasm_namespaces,
                wasm_type_names,
                wasm_instance_factories,
                scoped_wasm_factories,
                scoped_wasm_runtime_receivers,
                wasm_instance_bindings,
                scoped_wasm_instances,
            )
        });
    }
    None
}

pub(super) fn constructor_wasm_class(
    constructor: tree_sitter::Node<'_>,
    source: &str,
    wasm_class_bindings: &HashMap<String, String>,
    wasm_namespace_bindings: &HashMap<String, String>,
    scoped_wasm_namespaces: &[ScopedBinding],
    wasm_type_names: &HashSet<String>,
) -> Option<String> {
    if constructor.kind() == "identifier" {
        let name = constructor.utf8_text(source.as_bytes()).ok()?;
        if root_binding_is_visible(constructor, name, source)
            && let Some(wasm_type) = wasm_class_bindings.get(name)
        {
            return Some(wasm_type.clone());
        }
        let mut root = constructor;
        while let Some(parent) = root.parent() {
            root = parent;
        }
        return copied_wasm_class(root, constructor, name, source, wasm_class_bindings);
    }
    if constructor.kind() != "member_expression" {
        return None;
    }
    let namespace = constructor.child_by_field_name("object")?;
    let class_name = constructor
        .child_by_field_name("property")
        .and_then(|property| semantic_node_name(property, source))?;
    let namespace_name = namespace.utf8_text(source.as_bytes()).ok()?;
    let namespace_is_wasm = (wasm_namespace_bindings.contains_key(namespace_name)
        && root_binding_is_visible(namespace, namespace_name, source))
        || scoped_wasm_module_visible(namespace, namespace_name, source, scoped_wasm_namespaces)
            .is_some();
    (namespace_is_wasm && wasm_type_names.contains(&class_name)).then_some(class_name)
}

fn copied_wasm_class(
    node: tree_sitter::Node<'_>,
    reference: tree_sitter::Node<'_>,
    name: &str,
    source: &str,
    classes: &HashMap<String, String>,
) -> Option<String> {
    if node.kind() == "variable_declarator"
        && let (Some(binding), Some(value)) = (
            node.child_by_field_name("name"),
            node.child_by_field_name("value"),
        )
        && semantic_node_name(binding, source).as_deref() == Some(name)
        && let Some(source_name) = semantic_node_name(value, source)
        && root_binding_is_visible(value, &source_name, source)
        && let Some(wasm_type) = classes.get(&source_name)
        && let Some(scoped) = scoped_binding(binding, source, Some(wasm_type.clone()), None)
        && scoped_binding_is_visible(reference, name, source, &[scoped])
    {
        return Some(wasm_type.clone());
    }
    let mut cursor = node.walk();
    node.named_children(&mut cursor)
        .find_map(|child| copied_wasm_class(child, reference, name, source, classes))
}

pub(super) fn unwrap_transparent_expression(
    mut node: tree_sitter::Node<'_>,
) -> tree_sitter::Node<'_> {
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

pub(super) fn wasm_module_specifier(
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

pub(super) fn loaded_module_specifier(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
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

pub(super) fn scoped_wasm_type_visible(
    reference: tree_sitter::Node<'_>,
    name: &str,
    source: &str,
    bindings: &[ScopedBinding],
) -> Option<String> {
    visible_scoped_binding(reference, name, source, bindings)
        .and_then(|binding| binding.wasm_type.clone())
}

pub(super) fn scoped_wasm_module_visible(
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
    scoped_wasm_callables: &[ScopedBinding],
    lines: &mut Vec<usize>,
) {
    if binding.kind() != "identifier" || value.kind() != "identifier" {
        return;
    }
    let Ok(source_name) = value.utf8_text(source.as_bytes()) else {
        return;
    };
    let is_root_callable = imported_callable_bindings.contains(source_name)
        && root_binding_is_visible(value, source_name, source);
    let is_scoped_callable =
        scoped_binding_is_visible(value, source_name, source, scoped_wasm_callables);
    if !is_root_callable && !is_scoped_callable {
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
