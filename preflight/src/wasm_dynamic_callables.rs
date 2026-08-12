use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::javascript_literals::semantic_javascript_name;
use crate::javascript_scopes::ScopedBinding;
use crate::javascript_scopes::scoped_binding;
use crate::wasm_dynamic_aliases::{loaded_module_specifier, wasm_module_specifier};
use crate::wasm_module_sources::{is_wasm_callable_export, is_wasm_callable_source};

#[allow(clippy::too_many_arguments)]
pub(super) fn collect_scoped_dynamic_callable_bindings(
    node: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    callable_names: &HashSet<String>,
    wasm_namespace_bindings: &HashMap<String, String>,
    scoped_wasm_namespaces: &mut Vec<ScopedBinding>,
    bindings: &mut Vec<ScopedBinding>,
    lines: &mut Vec<usize>,
    first_line: usize,
) {
    collect_assigned_pattern(
        node,
        source,
        source_path,
        callable_names,
        wasm_namespace_bindings,
        scoped_wasm_namespaces,
        bindings,
        lines,
        first_line,
    );
    collect_import_callback_pattern(
        node,
        source,
        source_path,
        callable_names,
        scoped_wasm_namespaces,
        bindings,
        lines,
        first_line,
    );
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_scoped_dynamic_callable_bindings(
            child,
            source,
            source_path,
            callable_names,
            wasm_namespace_bindings,
            scoped_wasm_namespaces,
            bindings,
            lines,
            first_line,
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn collect_assigned_pattern(
    node: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    callable_names: &HashSet<String>,
    wasm_namespace_bindings: &HashMap<String, String>,
    scoped_wasm_namespaces: &[ScopedBinding],
    bindings: &mut Vec<ScopedBinding>,
    lines: &mut Vec<usize>,
    first_line: usize,
) {
    if !matches!(node.kind(), "variable_declarator" | "assignment_expression") {
        return;
    }
    let (Some(pattern), Some(value)) = (
        node.child_by_field_name("name")
            .or_else(|| node.child_by_field_name("left")),
        node.child_by_field_name("value")
            .or_else(|| node.child_by_field_name("right")),
    ) else {
        return;
    };
    if pattern.kind() != "object_pattern" {
        return;
    }
    let Some(module) = wasm_module_specifier(
        value,
        source,
        source_path,
        wasm_namespace_bindings,
        scoped_wasm_namespaces,
    ) else {
        return;
    };
    let context = PatternContext {
        source,
        source_path,
        callable_names,
        module: &module,
        first_line,
        is_parameter: false,
    };
    record_callable_pattern_bindings(pattern, &context, bindings, lines);
}

#[allow(clippy::too_many_arguments)]
fn collect_import_callback_pattern(
    node: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    callable_names: &HashSet<String>,
    scoped_wasm_namespaces: &mut Vec<ScopedBinding>,
    bindings: &mut Vec<ScopedBinding>,
    lines: &mut Vec<usize>,
    first_line: usize,
) {
    if node.kind() != "call_expression" {
        return;
    }
    let Some(function) = node.child_by_field_name("function") else {
        return;
    };
    if !matches!(
        function.kind(),
        "member_expression" | "subscript_expression"
    ) || member_name(function, source).as_deref() != Some("then")
    {
        return;
    }
    let Some(module) = function
        .child_by_field_name("object")
        .and_then(|receiver| loaded_module_specifier(receiver, source))
        .filter(|module| is_wasm_callable_source(module, source_path))
    else {
        return;
    };
    let Some(arguments) = node.child_by_field_name("arguments") else {
        return;
    };
    let context = PatternContext {
        source,
        source_path,
        callable_names,
        module: &module,
        first_line,
        is_parameter: true,
    };
    let mut cursor = arguments.walk();
    for callback in arguments.named_children(&mut cursor) {
        let Some(parameters) = callback.child_by_field_name("parameters") else {
            continue;
        };
        let mut parameter_cursor = parameters.walk();
        for parameter in parameters.named_children(&mut parameter_cursor) {
            let pattern = parameter
                .child_by_field_name("pattern")
                .unwrap_or(parameter);
            if pattern.kind() == "object_pattern" {
                record_callable_pattern_bindings(pattern, &context, bindings, lines);
            } else if pattern.kind() == "identifier"
                && let Some(namespace) =
                    scoped_parameter_binding(pattern, source, Some(module.clone()))
            {
                scoped_wasm_namespaces.push(namespace);
            }
        }
    }
}

struct PatternContext<'a> {
    source: &'a str,
    source_path: &'a Path,
    callable_names: &'a HashSet<String>,
    module: &'a str,
    first_line: usize,
    is_parameter: bool,
}

fn record_callable_pattern_bindings(
    pattern: tree_sitter::Node<'_>,
    context: &PatternContext<'_>,
    bindings: &mut Vec<ScopedBinding>,
    lines: &mut Vec<usize>,
) {
    let mut cursor = pattern.walk();
    for child in pattern.named_children(&mut cursor) {
        let (authored, binding) = pattern_pair(child);
        let (Some(authored), Some(binding)) = (authored, binding) else {
            continue;
        };
        let Some(authored_name) = semantic_javascript_name(authored, context.source) else {
            continue;
        };
        if !context.callable_names.contains(&authored_name)
            || !is_wasm_callable_export(context.module, &authored_name, context.source_path)
        {
            continue;
        }
        if semantic_javascript_name(binding, context.source)
            .is_some_and(|binding_name| binding_name != authored_name)
        {
            lines.push(context.first_line + authored.start_position().row);
        }
        let scoped = if context.is_parameter {
            scoped_parameter_binding(binding, context.source, None)
        } else {
            scoped_binding(binding, context.source, None, None)
        };
        if let Some(scoped) = scoped {
            bindings.push(scoped);
        }
    }
}

fn pattern_pair(
    child: tree_sitter::Node<'_>,
) -> (Option<tree_sitter::Node<'_>>, Option<tree_sitter::Node<'_>>) {
    if child.kind() == "pair_pattern" {
        return (
            child.child_by_field_name("key"),
            child.child_by_field_name("value"),
        );
    }
    if child.kind() == "shorthand_property_identifier_pattern" {
        return (Some(child), Some(child));
    }
    if child.kind() == "object_assignment_pattern"
        && let Some(binding) = child.child_by_field_name("left")
    {
        return (Some(binding), Some(binding));
    }
    (None, None)
}

fn scoped_parameter_binding(
    binding: tree_sitter::Node<'_>,
    source: &str,
    wasm_module: Option<String>,
) -> Option<ScopedBinding> {
    let name = binding.utf8_text(source.as_bytes()).ok()?.to_owned();
    let mut ancestor = binding.parent();
    while let Some(function) = ancestor {
        if matches!(
            function.kind(),
            "arrow_function" | "function_expression" | "generator_function"
        ) {
            let body = function.child_by_field_name("body")?;
            return Some(ScopedBinding {
                name,
                scope_start: body.start_byte(),
                scope_end: body.end_byte(),
                declaration_end: body.start_byte(),
                wasm_type: None,
                wasm_module,
            });
        }
        ancestor = function.parent();
    }
    None
}

fn member_name(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
    node.child_by_field_name("property")
        .or_else(|| node.child_by_field_name("index"))
        .and_then(|property| semantic_javascript_name(property, source))
}
