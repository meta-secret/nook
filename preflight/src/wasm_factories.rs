pub struct WasmInstanceFactories<'scan> {
    pub node: tree_sitter::Node<'scan>,
    pub source: &'scan str,
    pub wasm_class_bindings: &'scan HashMap<String, String>,
    pub factories: &'scan mut Vec<ScopedBinding>,
}
use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::javascript_literals::JavaScriptLiteral;
use crate::javascript_scopes::ScopedBinding;
use crate::wasm_module_sources::WasmModuleSources;

impl WasmInstanceFactories<'_> {
    pub fn collect_wasm_instance_factories(self) {
        let Self {
            node,
            source,
            wasm_class_bindings,
            factories,
        } = self;
        if matches!(
            node.kind(),
            "function_declaration"
                | "generator_function_declaration"
                | "function_expression"
                | "generator_function"
                | "arrow_function"
        ) && let Some(wasm_type) = node
            .child_by_field_name("return_type")
            .and_then(|return_type| {
                WasmInstanceFactories::referenced_wasm_class(
                    return_type,
                    source,
                    wasm_class_bindings,
                )
            })
            .or_else(|| {
                WasmInstanceFactories::inferred_wasm_class(node, source, wasm_class_bindings)
            })
            && let Some(binding) = WasmInstanceFactories::callable_declaration_binding(node)
            && let Some(mut factory) =
                ScopedBinding::scoped_binding(binding, source, Some(wasm_type), None)
        {
            if matches!(
                node.kind(),
                "function_declaration" | "generator_function_declaration"
            ) {
                if let Some(scope) = node.parent() {
                    factory.scope_start = scope.start_byte();
                    factory.scope_end = scope.end_byte();
                }
                factory.declaration_end = factory.scope_start;
            }
            factories.push(factory);
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            (WasmInstanceFactories {
                node: child,
                source: source,
                wasm_class_bindings: wasm_class_bindings,
                factories: factories,
            })
            .collect_wasm_instance_factories();
        }
    }
}

#[rustfmt::skip]
impl WasmInstanceFactories<'_> {
fn inferred_wasm_class(function: tree_sitter::Node<'_>, source: &str, classes: &HashMap<String, String>) -> Option<String> {
    let body = function.child_by_field_name("body")?;
    if body.kind() == "statement_block" {
        WasmInstanceFactories::find_returned_wasm_class(body, source, classes)
    } else {
        WasmInstanceFactories::constructed_wasm_class(body, source, classes)
    }
}
}

#[rustfmt::skip]
impl WasmInstanceFactories<'_> {
fn find_returned_wasm_class(node: tree_sitter::Node<'_>, source: &str, classes: &HashMap<String, String>) -> Option<String> {
    if node.kind() == "return_statement" {
        return WasmInstanceFactories::constructed_wasm_class(node, source, classes);
    }
    if matches!(node.kind(), "function_declaration" | "function_expression" | "generator_function_declaration" | "generator_function" | "arrow_function") {
        return None;
    }
    let mut cursor = node.walk();
    node.named_children(&mut cursor)
        .find_map(|child| WasmInstanceFactories::find_returned_wasm_class(child, source, classes))
}
}

#[rustfmt::skip]
impl WasmInstanceFactories<'_> {
fn constructed_wasm_class(node: tree_sitter::Node<'_>, source: &str, classes: &HashMap<String, String>) -> Option<String> {
    if node.kind() == "new_expression" {
        return node
            .child_by_field_name("constructor")
            .and_then(|constructor| (JavaScriptLiteral { node: constructor, source: source }).semantic_javascript_name())
            .and_then(|name| classes.get(&name).cloned());
    }
    let mut cursor = node.walk();
    node.named_children(&mut cursor)
        .find_map(|child| WasmInstanceFactories::constructed_wasm_class(child, source, classes))
}
}

#[rustfmt::skip]
impl WasmInstanceFactories<'_> {
pub(super) fn collect_typed_wasm_instances(node: tree_sitter::Node<'_>, source: &str, classes: &HashMap<String, String>, instances: &mut Vec<ScopedBinding>) {
    if matches!(node.kind(), "required_parameter" | "optional_parameter" | "public_field_definition")
        && let Some(binding) = node.child_by_field_name("name").or_else(|| node.child_by_field_name("pattern"))
        && let Some(annotation) = node.child_by_field_name("type").or_else(|| {
            let mut cursor = node.walk();
            node.named_children(&mut cursor)
                .find(|child| child.kind() == "type_annotation")
        })
        && let Ok(text) = annotation.utf8_text(source.as_bytes())
        && let Some(wasm_type) = classes.get(text.trim().trim_start_matches(':').trim())
        && let Some(mut scoped) = ScopedBinding::scoped_binding(binding, source, Some(wasm_type.clone()), None)
    {
        if node.kind() == "public_field_definition"
            && let Some(name) = (JavaScriptLiteral { node: binding, source: source }).semantic_javascript_name()
        {
            scoped.name = format!("this.{name}");
            if let Some(body) = node.parent() {
                scoped.scope_start = body.start_byte();
                scoped.scope_end = body.end_byte();
            }
        }
        instances.push(scoped);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        WasmInstanceFactories::collect_typed_wasm_instances(child, source, classes, instances);
    }
}
}

impl WasmInstanceFactories<'_> {
    pub(super) fn collect_imported_wasm_instance_factories(
        node: tree_sitter::Node<'_>,
        source: &str,
        source_path: &Path,
        wasm_type_names: &HashSet<String>,
        called_bindings: &HashSet<String>,
        factories: &mut HashMap<String, String>,
    ) {
        if node.kind() == "import_statement"
            && let Some(module) = node.child_by_field_name("source").and_then(|source_node| {
                (JavaScriptLiteral {
                    node: source_node,
                    source: source,
                })
                .static_javascript_string()
            })
        {
            if let Some(local) = WasmInstanceFactories::default_import_binding(node, source)
                && called_bindings.contains(&local)
                && let Some(wasm_type) = WasmModuleSources::wasm_factory_return_type(
                    &module,
                    "default",
                    source_path,
                    wasm_type_names,
                )
            {
                factories.insert(local, wasm_type);
            }
            WasmInstanceFactories::collect_imported_factory_specifiers(
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
            WasmInstanceFactories::collect_imported_wasm_instance_factories(
                child,
                source,
                source_path,
                wasm_type_names,
                called_bindings,
                factories,
            );
        }
    }
}

impl WasmInstanceFactories<'_> {
    fn default_import_binding(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
        let clause = node
            .utf8_text(source.as_bytes())
            .ok()?
            .trim_start()
            .strip_prefix("import ")?;
        let binding = clause.split_whitespace().next()?.trim_end_matches(',');
        (!matches!(binding, "type" | "{" | "*")).then(|| binding.to_owned())
    }
}

#[allow(clippy::too_many_arguments)]
impl WasmInstanceFactories<'_> {
    fn collect_imported_factory_specifiers(
        node: tree_sitter::Node<'_>,
        source: &str,
        source_path: &Path,
        module: &str,
        wasm_type_names: &HashSet<String>,
        called_bindings: &HashSet<String>,
        factories: &mut HashMap<String, String>,
    ) {
        if node.kind() == "namespace_import"
            && let Some(local) = node
                .named_child(0)
                .and_then(|child| (JavaScriptLiteral { node: child, source: source }).semantic_javascript_name())
        {
            for called in called_bindings
                .iter()
                .filter(|called| called.starts_with(&format!("{local}.")))
            {
                let imported = called.trim_start_matches(&format!("{local}."));
                if let Some(wasm_type) = WasmModuleSources::wasm_factory_return_type(
                    module,
                    imported,
                    source_path,
                    wasm_type_names,
                ) {
                    factories.insert(called.clone(), wasm_type);
                }
            }
            return;
        }
        if node.kind() == "import_specifier"
            && !WasmInstanceFactories::node_is_type_only_import(node, source)
            && let Some(imported_node) = node.child_by_field_name("name")
            && let Some(imported_name) =
                (JavaScriptLiteral { node: imported_node, source: source }).semantic_javascript_name()
        {
            let local_node = node.child_by_field_name("alias").unwrap_or(imported_node);
            if let Some(local_name) =
                (JavaScriptLiteral { node: local_node, source: source }).semantic_javascript_name()
                && called_bindings.contains(&local_name)
                && let Some(wasm_type) = WasmModuleSources::wasm_factory_return_type(
                    module,
                    &imported_name,
                    source_path,
                    wasm_type_names,
                )
            {
                factories.insert(local_name, wasm_type);
            }
            return;
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            WasmInstanceFactories::collect_imported_factory_specifiers(
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
}

impl WasmInstanceFactories<'_> {
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
            && let value = WasmInstanceFactories::unwrap_transparent_expression(value)
            && matches!(value.kind(), "member_expression" | "subscript_expression")
            && let Some(object) = value.child_by_field_name("object")
            && object.kind() == "identifier"
            && let Some(property) = value
                .child_by_field_name("property")
                .or_else(|| value.child_by_field_name("index"))
            && let Some(callable_name) =
                (JavaScriptLiteral { node: property, source: source }).semantic_javascript_name()
            && callable_names.contains(&callable_name)
            && let Some(receiver_name) = (JavaScriptLiteral { node: object, source: source }).semantic_javascript_name()
        {
            receivers.insert(receiver_name);
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            WasmInstanceFactories::collect_member_alias_receiver_names(
                child,
                source,
                callable_names,
                receivers,
            );
        }
    }
}

impl WasmInstanceFactories<'_> {
    pub(super) fn collect_factory_calls_for_receivers(
        node: tree_sitter::Node<'_>,
        source: &str,
        receivers: &HashSet<String>,
        called_bindings: &mut HashSet<String>,
    ) {
        if matches!(node.kind(), "member_expression" | "subscript_expression")
            && let Some(object) = node.child_by_field_name("object")
            && let Some(factory_name) = WasmInstanceFactories::called_identifier(object, source)
        {
            called_bindings.insert(factory_name);
        }
        if matches!(node.kind(), "variable_declarator" | "assignment_expression")
            && let Some(binding) = node
                .child_by_field_name("name")
                .or_else(|| node.child_by_field_name("left"))
            && let Some(binding_name) = (JavaScriptLiteral { node: binding, source: source }).semantic_javascript_name()
            && receivers.contains(&binding_name)
            && let Some(value) = node
                .child_by_field_name("value")
                .or_else(|| node.child_by_field_name("right"))
            && let Some(factory_name) = WasmInstanceFactories::called_identifier(value, source)
        {
            called_bindings.insert(factory_name);
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            WasmInstanceFactories::collect_factory_calls_for_receivers(
                child,
                source,
                receivers,
                called_bindings,
            );
        }
    }
}

impl WasmInstanceFactories<'_> {
    fn called_identifier(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
        let node = WasmInstanceFactories::unwrap_transparent_expression(node);
        if node.kind() == "await_expression" {
            let mut cursor = node.walk();
            return node
                .named_children(&mut cursor)
                .find_map(|child| WasmInstanceFactories::called_identifier(child, source));
        }
        if node.kind() != "call_expression" {
            return None;
        }
        let function = node.child_by_field_name("function")?;
        matches!(function.kind(), "identifier" | "member_expression")
            .then(|| {
                function
                    .utf8_text(source.as_bytes())
                    .ok()
                    .map(str::to_owned)
            })
            .flatten()
    }
}

impl WasmInstanceFactories<'_> {
    fn callable_declaration_binding(node: tree_sitter::Node<'_>) -> Option<tree_sitter::Node<'_>> {
        node.child_by_field_name("name").or_else(|| {
            let declarator = node.parent()?;
            (declarator.kind() == "variable_declarator")
                .then(|| declarator.child_by_field_name("name"))
                .flatten()
        })
    }
}

impl WasmInstanceFactories<'_> {
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
}

impl WasmInstanceFactories<'_> {
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
}

impl WasmInstanceFactories<'_> {
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
}
