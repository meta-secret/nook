use crate::javascript_literals::JavaScriptLiteralFailure;
use crate::javascript_scopes::BindingProvenance;
pub struct WasmInstanceFactories<'scan> {
    pub node: tree_sitter::Node<'scan>,
    pub source: &'scan str,
    pub wasm_class_bindings: &'scan HashMap<String, String>,
    pub factories: Vec<ScopedBinding>,
}
use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::javascript_literals::JavaScriptLiteral;
use crate::javascript_scopes::ScopedBinding;
use crate::wasm_module_sources::WasmModuleSources;

impl WasmInstanceFactories<'_> {
    pub fn collect_wasm_instance_factories(self) -> Vec<ScopedBinding> {
        let Self {
            node,
            source,
            wasm_class_bindings,
            mut factories,
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
                .ok()
            })
            .or_else(|| {
                WasmInstanceFactories::inferred_wasm_class(node, source, wasm_class_bindings).ok()
            })
            && let Ok(binding) = WasmInstanceFactories::callable_declaration_binding(node)
            && let Ok(mut factory) = ScopedBinding::from_declaration(
                binding,
                source,
                BindingProvenance::Class(wasm_type),
            )
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
            factories = (WasmInstanceFactories {
                node: child,
                source,
                wasm_class_bindings,
                factories,
            })
            .collect_wasm_instance_factories();
        }
        factories
    }
}

#[rustfmt::skip]
impl WasmInstanceFactories<'_> {
fn inferred_wasm_class(function: tree_sitter::Node<'_>, source: &str, classes: &HashMap<String, String>) -> Result<String, FactoryResolutionFailure> {
    let body = function.child_by_field_name("body").ok_or(FactoryResolutionFailure::MissingBody)?;
    if body.kind() == "statement_block" { Self::find_returned_wasm_class(body, source, classes) } else { Self::constructed_wasm_class(body, source, classes) }
}
}

#[rustfmt::skip]
impl WasmInstanceFactories<'_> {
fn find_returned_wasm_class(node: tree_sitter::Node<'_>, source: &str, classes: &HashMap<String, String>) -> Result<String, FactoryResolutionFailure> {
    if node.kind() == "return_statement" { return Self::constructed_wasm_class(node, source, classes); }
    if matches!(node.kind(), "function_declaration" | "function_expression" | "generator_function_declaration" | "generator_function" | "arrow_function") { return Err(FactoryResolutionFailure::NestedFunction); }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) { if let Ok(class) = Self::find_returned_wasm_class(child, source, classes) { return Ok(class); } }
    Err(FactoryResolutionFailure::NoConstructedClass)
}
}

#[rustfmt::skip]
impl WasmInstanceFactories<'_> {
fn constructed_wasm_class(node: tree_sitter::Node<'_>, source: &str, classes: &HashMap<String, String>) -> Result<String, FactoryResolutionFailure> {
    if node.kind() == "new_expression" {
        let constructor = node.child_by_field_name("constructor").ok_or(FactoryResolutionFailure::MissingBinding)?;
        let name = (JavaScriptLiteral { node: constructor, source }).semantic_javascript_name().map_err(FactoryResolutionFailure::Literal)?;
        return classes.get(&name).cloned().ok_or(FactoryResolutionFailure::UnboundClass);
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) { if let Ok(class) = Self::constructed_wasm_class(child, source, classes) { return Ok(class); } }
    Err(FactoryResolutionFailure::NoConstructedClass)
}
}

#[rustfmt::skip]
impl WasmInstanceFactories<'_> {
pub(super) fn collect_typed_wasm_instances(node: tree_sitter::Node<'_>, source: &str, classes: &HashMap<String, String>, mut instances: Vec<ScopedBinding>) -> Vec<ScopedBinding> {
    if matches!(node.kind(), "required_parameter" | "optional_parameter" | "public_field_definition")
        && let Some(binding) = node.child_by_field_name("name").or_else(|| node.child_by_field_name("pattern"))
        && let Some(annotation) = node.child_by_field_name("type").or_else(|| {
            let mut cursor = node.walk();
            node.named_children(&mut cursor)
                .find(|child| child.kind() == "type_annotation")
        })
        && let Ok(text) = annotation.utf8_text(source.as_bytes())
        && let Some(wasm_type) = classes.get(text.trim().trim_start_matches(':').trim())
        && let Ok(mut scoped) = ScopedBinding::from_declaration(binding, source, BindingProvenance::Class(wasm_type.clone()))
    {
        if node.kind() == "public_field_definition"
            && let Ok(name) = (JavaScriptLiteral { node: binding, source }).semantic_javascript_name()
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
        instances = WasmInstanceFactories::collect_typed_wasm_instances(child, source, classes, instances);
    }
instances
}
}

impl WasmInstanceFactories<'_> {
    pub(super) fn collect_imported_wasm_instance_factories(
        node: tree_sitter::Node<'_>,
        source: &str,
        source_path: &Path,
        wasm_type_names: &HashSet<String>,
        called_bindings: &HashSet<String>,
        mut factories: HashMap<String, String>,
    ) -> HashMap<String, String> {
        if node.kind() == "import_statement"
            && let Some(module) = node.child_by_field_name("source").and_then(|source_node| {
                (JavaScriptLiteral {
                    node: source_node,
                    source,
                })
                .static_javascript_string()
                .ok()
            })
        {
            if let Ok(local) = WasmInstanceFactories::default_import_binding(node, source)
                && called_bindings.contains(&local)
                && let Ok(wasm_type) = WasmModuleSources::wasm_factory_return_type(
                    &module,
                    "default",
                    source_path,
                    wasm_type_names,
                )
            {
                factories.insert(local, wasm_type);
            }
            factories = WasmInstanceFactories::collect_imported_factory_specifiers(
                node,
                source,
                source_path,
                &module,
                wasm_type_names,
                called_bindings,
                factories,
            );
            return factories;
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            factories = WasmInstanceFactories::collect_imported_wasm_instance_factories(
                child,
                source,
                source_path,
                wasm_type_names,
                called_bindings,
                factories,
            );
        }
        factories
    }
}

impl WasmInstanceFactories<'_> {
    fn default_import_binding(
        node: tree_sitter::Node<'_>,
        source: &str,
    ) -> Result<String, FactoryResolutionFailure> {
        let text = node
            .utf8_text(source.as_bytes())
            .map_err(|_| FactoryResolutionFailure::InvalidSource)?;
        let clause = text
            .trim_start()
            .strip_prefix("import ")
            .ok_or(FactoryResolutionFailure::NotDefaultImport)?;
        let binding = clause
            .split_whitespace()
            .next()
            .ok_or(FactoryResolutionFailure::MissingBinding)?
            .trim_end_matches(',');
        if matches!(binding, "type" | "{" | "*") {
            return Err(FactoryResolutionFailure::NotDefaultImport);
        }
        Ok(binding.to_owned())
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
        mut factories: HashMap<String, String>,
    ) -> HashMap<String, String> {
        if node.kind() == "namespace_import"
            && let Some(local) = node.named_child(0).and_then(|child| {
                (JavaScriptLiteral {
                    node: child,
                    source,
                })
                .semantic_javascript_name()
                .ok()
            })
        {
            for called in called_bindings
                .iter()
                .filter(|called| called.starts_with(&format!("{local}.")))
            {
                let imported = called.trim_start_matches(&format!("{local}."));
                if let Ok(wasm_type) = WasmModuleSources::wasm_factory_return_type(
                    module,
                    imported,
                    source_path,
                    wasm_type_names,
                ) {
                    factories.insert(called.clone(), wasm_type);
                }
            }
            return factories;
        }
        if node.kind() == "import_specifier"
            && !WasmInstanceFactories::node_is_type_only_import(node, source)
            && let Some(imported_node) = node.child_by_field_name("name")
            && let Ok(imported_name) = (JavaScriptLiteral {
                node: imported_node,
                source,
            })
            .semantic_javascript_name()
        {
            let local_node = node.child_by_field_name("alias").unwrap_or(imported_node);
            if let Ok(local_name) = (JavaScriptLiteral {
                node: local_node,
                source,
            })
            .semantic_javascript_name()
                && called_bindings.contains(&local_name)
                && let Ok(wasm_type) = WasmModuleSources::wasm_factory_return_type(
                    module,
                    &imported_name,
                    source_path,
                    wasm_type_names,
                )
            {
                factories.insert(local_name, wasm_type);
            }
            return factories;
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            factories = WasmInstanceFactories::collect_imported_factory_specifiers(
                child,
                source,
                source_path,
                module,
                wasm_type_names,
                called_bindings,
                factories,
            );
        }
        factories
    }
}

impl WasmInstanceFactories<'_> {
    pub(super) fn collect_member_alias_receiver_names(
        node: tree_sitter::Node<'_>,
        source: &str,
        callable_names: &HashSet<String>,
        mut receivers: HashSet<String>,
    ) -> HashSet<String> {
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
            && let Ok(callable_name) = (JavaScriptLiteral {
                node: property,
                source,
            })
            .semantic_javascript_name()
            && callable_names.contains(&callable_name)
            && let Ok(receiver_name) = (JavaScriptLiteral {
                node: object,
                source,
            })
            .semantic_javascript_name()
        {
            receivers.insert(receiver_name);
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            receivers = WasmInstanceFactories::collect_member_alias_receiver_names(
                child,
                source,
                callable_names,
                receivers,
            );
        }
        receivers
    }
}

impl WasmInstanceFactories<'_> {
    pub(super) fn collect_factory_calls_for_receivers(
        node: tree_sitter::Node<'_>,
        source: &str,
        receivers: &HashSet<String>,
        mut called_bindings: HashSet<String>,
    ) -> HashSet<String> {
        if matches!(node.kind(), "member_expression" | "subscript_expression")
            && let Some(object) = node.child_by_field_name("object")
            && let Ok(factory_name) = WasmInstanceFactories::called_identifier(object, source)
        {
            called_bindings.insert(factory_name);
        }
        if matches!(node.kind(), "variable_declarator" | "assignment_expression")
            && let Some(binding) = node
                .child_by_field_name("name")
                .or_else(|| node.child_by_field_name("left"))
            && let Ok(binding_name) = (JavaScriptLiteral {
                node: binding,
                source,
            })
            .semantic_javascript_name()
            && receivers.contains(&binding_name)
            && let Some(value) = node
                .child_by_field_name("value")
                .or_else(|| node.child_by_field_name("right"))
            && let Ok(factory_name) = WasmInstanceFactories::called_identifier(value, source)
        {
            called_bindings.insert(factory_name);
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            called_bindings = WasmInstanceFactories::collect_factory_calls_for_receivers(
                child,
                source,
                receivers,
                called_bindings,
            );
        }
        called_bindings
    }
}

impl WasmInstanceFactories<'_> {
    fn called_identifier(
        node: tree_sitter::Node<'_>,
        source: &str,
    ) -> Result<String, FactoryResolutionFailure> {
        let node = Self::unwrap_transparent_expression(node);
        if node.kind() == "await_expression" {
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                if let Ok(name) = Self::called_identifier(child, source) {
                    return Ok(name);
                }
            }
            return Err(FactoryResolutionFailure::NotInvocation);
        }
        if node.kind() != "call_expression" {
            return Err(FactoryResolutionFailure::NotInvocation);
        }
        let function = node
            .child_by_field_name("function")
            .ok_or(FactoryResolutionFailure::MissingBinding)?;
        if !matches!(function.kind(), "identifier" | "member_expression") {
            return Err(FactoryResolutionFailure::NotInvocation);
        }
        function
            .utf8_text(source.as_bytes())
            .map(str::to_owned)
            .map_err(|_| FactoryResolutionFailure::InvalidSource)
    }
}

impl WasmInstanceFactories<'_> {
    fn callable_declaration_binding(
        node: tree_sitter::Node<'_>,
    ) -> Result<tree_sitter::Node<'_>, FactoryResolutionFailure> {
        if let Some(name) = node.child_by_field_name("name") {
            return Ok(name);
        }
        let declarator = node
            .parent()
            .ok_or(FactoryResolutionFailure::MissingBinding)?;
        if declarator.kind() != "variable_declarator" {
            return Err(FactoryResolutionFailure::MissingBinding);
        }
        declarator
            .child_by_field_name("name")
            .ok_or(FactoryResolutionFailure::MissingBinding)
    }
}

impl WasmInstanceFactories<'_> {
    fn referenced_wasm_class(
        node: tree_sitter::Node<'_>,
        source: &str,
        wasm_class_bindings: &HashMap<String, String>,
    ) -> Result<String, FactoryResolutionFailure> {
        let annotation = node
            .utf8_text(source.as_bytes())
            .map_err(|_| FactoryResolutionFailure::InvalidSource)?
            .trim();
        let actual = annotation.strip_prefix(':').unwrap_or(annotation).trim();
        let actual = actual
            .strip_prefix("Promise<")
            .and_then(|inner| inner.strip_suffix('>'))
            .unwrap_or(actual)
            .trim();
        wasm_class_bindings
            .get(actual)
            .cloned()
            .ok_or(FactoryResolutionFailure::UnboundClass)
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

#[derive(Debug)]
#[expect(dead_code, reason = "typed literal cause is retained for diagnostics")]
enum FactoryResolutionFailure {
    MissingBody,
    NestedFunction,
    NoConstructedClass,
    MissingBinding,
    UnboundClass,
    InvalidSource,
    NotDefaultImport,
    NotInvocation,
    Literal(JavaScriptLiteralFailure),
}
