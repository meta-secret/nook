use std::collections::HashSet;
use std::path::Path;

use crate::javascript_literals::static_javascript_string;
use crate::wasm_module_sources::is_wasm_callable_source;

struct ScopedBinding {
    name: String,
    scope_start: usize,
    scope_end: usize,
    declaration_end: usize,
}

const WASM_MANAGER_ACCESSOR: &str = "requireManager";
const WASM_RUNTIME_RECEIVER_PROPERTY: &str = "__nookVault";

pub(super) fn collect_namespace_import_bindings(
    node: tree_sitter::Node<'_>,
    source: &str,
    wasm_namespace_bindings: &mut HashSet<String>,
) {
    if node.kind() == "namespace_import" && !node_is_type_only_import(node, source) {
        let mut cursor = node.walk();
        if let Some(binding) = node
            .named_children(&mut cursor)
            .find(|child| child.kind() == "identifier")
            .and_then(|child| child.utf8_text(source.as_bytes()).ok())
        {
            wasm_namespace_bindings.insert(binding.to_owned());
        }
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_namespace_import_bindings(child, source, wasm_namespace_bindings);
    }
}

pub(super) fn collect_wasm_type_import_bindings(
    node: tree_sitter::Node<'_>,
    source: &str,
    wasm_type_names: &HashSet<String>,
    wasm_class_bindings: &mut HashSet<String>,
) {
    if node.kind() == "import_specifier"
        && !node_is_type_only_import(node, source)
        && let Some(imported) = node.child_by_field_name("name")
        && let Some(imported_name) = semantic_node_name(imported, source)
        && wasm_type_names.contains(&imported_name)
    {
        let binding = node.child_by_field_name("alias").unwrap_or(imported);
        if let Ok(binding_name) = binding.utf8_text(source.as_bytes()) {
            wasm_class_bindings.insert(binding_name.to_owned());
        }
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_wasm_type_import_bindings(child, source, wasm_type_names, wasm_class_bindings);
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

fn collect_wasm_instance_factories(
    node: tree_sitter::Node<'_>,
    source: &str,
    wasm_class_bindings: &HashSet<String>,
    factories: &mut HashSet<String>,
) {
    if matches!(
        node.kind(),
        "function_declaration"
            | "generator_function_declaration"
            | "function_expression"
            | "generator_function"
            | "arrow_function"
            | "method_definition"
    ) && node
        .child_by_field_name("return_type")
        .is_some_and(|return_type| {
            type_references_wasm_class(return_type, source, wasm_class_bindings)
        })
        && let Some(name) = callable_declaration_name(node, source)
    {
        factories.insert(name);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_wasm_instance_factories(child, source, wasm_class_bindings, factories);
    }
}

fn callable_declaration_name(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
    node.child_by_field_name("name")
        .and_then(|name| semantic_node_name(name, source))
        .or_else(|| {
            let declarator = node.parent()?;
            (declarator.kind() == "variable_declarator")
                .then(|| declarator.child_by_field_name("name"))
                .flatten()
                .and_then(|name| semantic_node_name(name, source))
        })
}

fn type_references_wasm_class(
    node: tree_sitter::Node<'_>,
    source: &str,
    wasm_class_bindings: &HashSet<String>,
) -> bool {
    if node.kind() == "type_identifier"
        && node
            .utf8_text(source.as_bytes())
            .is_ok_and(|name| wasm_class_bindings.contains(name))
    {
        return true;
    }
    let mut cursor = node.walk();
    node.named_children(&mut cursor)
        .any(|child| type_references_wasm_class(child, source, wasm_class_bindings))
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
        && let Some(receiver) = scoped_binding(binding, source)
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
    wasm_namespace_bindings: &mut HashSet<String>,
    wasm_class_bindings: &HashSet<String>,
    wasm_instance_bindings: &mut HashSet<String>,
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
) {
    let mut scoped_wasm_namespaces = Vec::new();
    let mut scoped_wasm_instances = Vec::new();
    let mut scoped_wasm_runtime_receivers = Vec::new();
    let mut wasm_instance_factories = HashSet::new();
    collect_wasm_instance_factories(
        node,
        source,
        wasm_class_bindings,
        &mut wasm_instance_factories,
    );
    collect_wasm_runtime_receivers(node, source, &mut scoped_wasm_runtime_receivers);
    collect_dynamic_wasm_aliases(
        node,
        source,
        source_path,
        first_line,
        callable_names,
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
    wasm_namespace_bindings: &mut HashSet<String>,
    wasm_class_bindings: &HashSet<String>,
    wasm_instance_bindings: &mut HashSet<String>,
    wasm_instance_factories: &HashSet<String>,
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
        collect_binding_aliases(
            binding,
            value,
            source,
            source_path,
            first_line,
            callable_names,
            wasm_namespace_bindings,
            wasm_class_bindings,
            wasm_instance_bindings,
            wasm_instance_factories,
            scoped_wasm_runtime_receivers,
            scoped_wasm_namespaces,
            scoped_wasm_instances,
            imported_callable_bindings,
            lines,
            false,
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

#[allow(clippy::too_many_arguments)]
fn collect_binding_aliases(
    binding: tree_sitter::Node<'_>,
    value: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    first_line: usize,
    callable_names: &HashSet<String>,
    wasm_namespace_bindings: &HashSet<String>,
    wasm_class_bindings: &HashSet<String>,
    wasm_instance_bindings: &HashSet<String>,
    wasm_instance_factories: &HashSet<String>,
    scoped_wasm_runtime_receivers: &[ScopedBinding],
    scoped_wasm_namespaces: &mut Vec<ScopedBinding>,
    scoped_wasm_instances: &mut Vec<ScopedBinding>,
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
    inspect_object_pattern: bool,
) -> bool {
    if let Some(namespace_binding) = dynamic_namespace_binding(binding, value, source, source_path)
    {
        scoped_wasm_namespaces.push(namespace_binding);
    }
    if let Some(instance_binding) = wasm_instance_binding(
        binding,
        value,
        source,
        wasm_class_bindings,
        wasm_instance_factories,
        scoped_wasm_runtime_receivers,
    ) {
        scoped_wasm_instances.push(instance_binding);
    }
    if inspect_object_pattern
        && binding.kind() == "object_pattern"
        && value_is_wasm_module(
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
            imported_callable_bindings,
            lines,
        );
        return true;
    }
    collect_namespace_member_alias(
        binding,
        value,
        source,
        source_path,
        first_line,
        callable_names,
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
        && loaded_module_specifier(value, source)
            .is_some_and(|module| is_wasm_callable_source(&module, source_path))
    {
        return scoped_binding(binding, source);
    }
    None
}

fn wasm_instance_binding(
    binding: tree_sitter::Node<'_>,
    value: tree_sitter::Node<'_>,
    source: &str,
    wasm_class_bindings: &HashSet<String>,
    wasm_instance_factories: &HashSet<String>,
    scoped_wasm_runtime_receivers: &[ScopedBinding],
) -> Option<ScopedBinding> {
    if binding.kind() != "identifier" {
        return None;
    }
    if value_is_wasm_instance(
        value,
        source,
        wasm_class_bindings,
        wasm_instance_factories,
        scoped_wasm_runtime_receivers,
    ) {
        return scoped_binding(binding, source);
    }
    None
}

fn value_is_wasm_instance(
    value: tree_sitter::Node<'_>,
    source: &str,
    wasm_class_bindings: &HashSet<String>,
    wasm_instance_factories: &HashSet<String>,
    scoped_wasm_runtime_receivers: &[ScopedBinding],
) -> bool {
    if value.kind() == "new_expression"
        && let Some(constructor) = value.child_by_field_name("constructor")
        && constructor.utf8_text(source.as_bytes()).is_ok_and(|name| {
            wasm_class_bindings.contains(name) && root_binding_is_visible(constructor, name, source)
        })
    {
        return true;
    }
    if value.kind() == "call_expression"
        && let Some(function) = value.child_by_field_name("function")
        && callable_expression_name(function, source).is_some_and(|name| {
            (name == WASM_MANAGER_ACCESSOR
                && wasm_runtime_accessor_receiver_is_visible(
                    function,
                    source,
                    scoped_wasm_runtime_receivers,
                ))
                || (wasm_instance_factories.contains(&name)
                    && root_binding_is_visible(function, &name, source))
        })
    {
        return true;
    }
    if matches!(
        value.kind(),
        "await_expression" | "parenthesized_expression" | "as_expression" | "satisfies_expression"
    ) {
        let mut cursor = value.walk();
        return value.named_children(&mut cursor).any(|child| {
            value_is_wasm_instance(
                child,
                source,
                wasm_class_bindings,
                wasm_instance_factories,
                scoped_wasm_runtime_receivers,
            )
        });
    }
    false
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

fn scoped_binding(binding: tree_sitter::Node<'_>, source: &str) -> Option<ScopedBinding> {
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
    })
}

fn value_is_wasm_module(
    value: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    wasm_namespace_bindings: &HashSet<String>,
    scoped_wasm_namespaces: &[ScopedBinding],
) -> bool {
    loaded_module_specifier(value, source)
        .is_some_and(|module| is_wasm_callable_source(&module, source_path))
        || value.utf8_text(source.as_bytes()).is_ok_and(|name| {
            (wasm_namespace_bindings.contains(name) && root_binding_is_visible(value, name, source))
                || scoped_binding_is_visible(value, name, source, scoped_wasm_namespaces)
        })
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

fn collect_object_pattern_aliases(
    pattern: tree_sitter::Node<'_>,
    source: &str,
    first_line: usize,
    callable_names: &HashSet<String>,
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
) {
    let mut cursor = pattern.walk();
    for child in pattern.named_children(&mut cursor) {
        if child.kind() == "pair_pattern"
            && let Some(authored_name) = child.child_by_field_name("key")
            && let Some(name) = semantic_node_name(authored_name, source)
            && callable_names.contains(&name)
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
    wasm_namespace_bindings: &HashSet<String>,
    wasm_class_bindings: &HashSet<String>,
    wasm_instance_bindings: &HashSet<String>,
    scoped_wasm_namespaces: &[ScopedBinding],
    scoped_wasm_instances: &[ScopedBinding],
    imported_callable_bindings: &mut HashSet<String>,
    lines: &mut Vec<usize>,
) {
    if binding.kind() != "identifier"
        || !matches!(value.kind(), "member_expression" | "subscript_expression")
    {
        return;
    }
    let Some(namespace) = value.child_by_field_name("object") else {
        return;
    };
    let property = if value.kind() == "subscript_expression" {
        value.child_by_field_name("index")
    } else {
        value.child_by_field_name("property")
    };
    let Some(property) = property else {
        return;
    };
    let Some(callable_name) = semantic_node_name(property, source) else {
        return;
    };
    let direct_wasm_load = loaded_module_specifier(namespace, source)
        .is_some_and(|module| is_wasm_callable_source(&module, source_path));
    let recorded_binding = namespace.utf8_text(source.as_bytes()).is_ok_and(|name| {
        ((wasm_namespace_bindings.contains(name)
            || wasm_class_bindings.contains(name)
            || wasm_instance_bindings.contains(name))
            && root_binding_is_visible(namespace, name, source))
            || scoped_binding_is_visible(namespace, name, source, scoped_wasm_namespaces)
            || scoped_binding_is_visible(namespace, name, source, scoped_wasm_instances)
    });
    if (!direct_wasm_load && !recorded_binding) || !callable_names.contains(&callable_name) {
        return;
    }
    let Ok(binding_name) = binding.utf8_text(source.as_bytes()) else {
        return;
    };
    if binding_name != callable_name {
        lines.push(first_line + binding.start_position().row);
    }
    imported_callable_bindings.insert(binding_name.to_owned());
}

fn scoped_binding_is_visible(
    reference: tree_sitter::Node<'_>,
    name: &str,
    source: &str,
    bindings: &[ScopedBinding],
) -> bool {
    bindings.iter().any(|binding| {
        binding.name == name
            && binding.declaration_end <= reference.start_byte()
            && binding.scope_start <= reference.start_byte()
            && reference.end_byte() <= binding.scope_end
            && !nested_scope_shadows(reference, binding, name, source)
    })
}

fn nested_scope_shadows(
    reference: tree_sitter::Node<'_>,
    binding: &ScopedBinding,
    name: &str,
    source: &str,
) -> bool {
    let mut ancestor = reference.parent();
    while let Some(scope) = ancestor {
        if scope.start_byte() == binding.scope_start && scope.end_byte() == binding.scope_end {
            return false;
        }
        if function_parameters_declare(scope, name, source)
            || block_declares_name(scope, name, source)
            || catch_parameter_declares(scope, name, source)
            || loop_header_declares(scope, name, source)
        {
            return true;
        }
        ancestor = scope.parent();
    }
    true
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

fn root_binding_is_visible(reference: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
    let mut ancestor = reference.parent();
    while let Some(scope) = ancestor {
        if function_parameters_declare(scope, name, source)
            || block_declares_name(scope, name, source)
            || catch_parameter_declares(scope, name, source)
            || loop_header_declares(scope, name, source)
        {
            return false;
        }
        ancestor = scope.parent();
    }
    true
}

fn loop_header_declares(scope: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
    let binding = match scope.kind() {
        "for_statement" => scope.child_by_field_name("initializer"),
        "for_in_statement" => scope.child_by_field_name("left"),
        _ => None,
    };
    binding.is_some_and(|binding| match binding.kind() {
        "lexical_declaration" | "variable_declaration" => {
            declaration_declares(binding, name, source)
        }
        _ => binding_pattern_declares(binding, name, source),
    })
}

fn function_parameters_declare(scope: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
    if !matches!(
        scope.kind(),
        "function_declaration"
            | "function_expression"
            | "arrow_function"
            | "generator_function_declaration"
            | "generator_function"
            | "method_definition"
    ) {
        return false;
    }
    scope
        .child_by_field_name("parameters")
        .is_some_and(|parameters| binding_container_declares(parameters, name, source))
}

fn block_declares_name(scope: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
    if scope.kind() != "statement_block" {
        return false;
    }
    let mut cursor = scope.walk();
    scope
        .named_children(&mut cursor)
        .any(|statement| match statement.kind() {
            "lexical_declaration" | "variable_declaration" => {
                declaration_declares(statement, name, source)
            }
            "function_declaration" | "generator_function_declaration" | "class_declaration" => {
                statement
                    .child_by_field_name("name")
                    .is_some_and(|binding| binding_matches(binding, name, source))
            }
            _ => false,
        })
}

fn catch_parameter_declares(scope: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
    scope.kind() == "catch_clause"
        && scope
            .child_by_field_name("parameter")
            .is_some_and(|parameter| binding_pattern_declares(parameter, name, source))
}

fn binding_container_declares(container: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
    let mut cursor = container.walk();
    container.named_children(&mut cursor).any(|parameter| {
        if matches!(
            parameter.kind(),
            "required_parameter" | "optional_parameter"
        ) {
            parameter
                .child_by_field_name("pattern")
                .is_some_and(|pattern| binding_pattern_declares(pattern, name, source))
        } else {
            binding_pattern_declares(parameter, name, source)
        }
    })
}

fn declaration_declares(declaration: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
    let mut cursor = declaration.walk();
    declaration.named_children(&mut cursor).any(|declarator| {
        declarator.kind() == "variable_declarator"
            && declarator
                .child_by_field_name("name")
                .is_some_and(|binding| binding_pattern_declares(binding, name, source))
    })
}

fn binding_pattern_declares(pattern: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
    if matches!(
        pattern.kind(),
        "identifier" | "shorthand_property_identifier_pattern"
    ) {
        return binding_matches(pattern, name, source);
    }
    if pattern.kind() == "type_annotation" {
        return false;
    }
    let mut cursor = pattern.walk();
    pattern
        .named_children(&mut cursor)
        .any(|child| binding_pattern_declares(child, name, source))
}

fn binding_matches(binding: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
    binding
        .utf8_text(source.as_bytes())
        .is_ok_and(|binding_name| binding_name == name)
}

fn declaration_is_in_program_scope(binding: tree_sitter::Node<'_>) -> bool {
    binding
        .parent()
        .and_then(|declarator| declarator.parent())
        .and_then(|declaration| declaration.parent())
        .is_some_and(|scope| scope.kind() == "program")
}

fn semantic_node_name(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
    let text = node.utf8_text(source.as_bytes()).ok()?;
    if node.kind() == "string" {
        static_javascript_string(node, source)
    } else {
        Some(text.to_owned())
    }
}
