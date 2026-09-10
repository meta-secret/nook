pub struct DynamicWasmCallables<'scan> {
    pub node: tree_sitter::Node<'scan>,
    pub source: &'scan str,
    pub source_path: &'scan Path,
    pub callable_names: &'scan HashSet<String>,
    pub wasm_namespace_bindings: &'scan HashMap<String, String>,
    pub state: ScopedCallableInventory,
    pub first_line: usize,
}
use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::javascript_literals::JavaScriptLiteral;
use crate::javascript_scopes::ScopedBinding;
use crate::wasm_dynamic_aliases::DynamicWasmAliases;
use crate::wasm_module_sources::WasmModuleSources;

impl DynamicWasmCallables<'_> {
    pub fn collect_scoped_dynamic_callable_bindings(self) -> ScopedCallableInventory {
        let Self {
            node,
            source,
            source_path,
            callable_names,
            wasm_namespace_bindings,
            mut state,
            first_line,
        } = self;
        state = state.collect_assigned_pattern(
            node,
            source,
            source_path,
            callable_names,
            wasm_namespace_bindings,
            first_line,
        );
        state = state.collect_import_callback_pattern(
            node,
            source,
            source_path,
            callable_names,
            first_line,
        );
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            state = (DynamicWasmCallables {
                node: child,
                source,
                source_path,
                callable_names,
                wasm_namespace_bindings,
                state,
                first_line,
            })
            .collect_scoped_dynamic_callable_bindings();
        }
        state
    }
}
#[derive(Default)]
pub(super) struct ScopedCallableInventory {
    pub(super) scoped_wasm_namespaces: Vec<ScopedBinding>,
    pub(super) bindings: Vec<ScopedBinding>,
    pub(super) lines: Vec<usize>,
}

#[allow(clippy::too_many_arguments)]
impl ScopedCallableInventory {
    fn collect_assigned_pattern(
        mut self,
        node: tree_sitter::Node<'_>,
        source: &str,
        source_path: &Path,
        callable_names: &HashSet<String>,
        wasm_namespace_bindings: &HashMap<String, String>,
        first_line: usize,
    ) -> Self {
        if !matches!(node.kind(), "variable_declarator" | "assignment_expression") {
            return self;
        }
        let (Some(pattern), Some(value)) = (
            node.child_by_field_name("name")
                .or_else(|| node.child_by_field_name("left")),
            node.child_by_field_name("value")
                .or_else(|| node.child_by_field_name("right")),
        ) else {
            return self;
        };
        if pattern.kind() != "object_pattern" {
            return self;
        }
        let Some(module) = DynamicWasmAliases::wasm_module_specifier(
            value,
            source,
            source_path,
            wasm_namespace_bindings,
            &self.scoped_wasm_namespaces,
        ) else {
            return self;
        };
        let context = PatternContext {
            source,
            source_path,
            callable_names,
            module: &module,
            first_line,
            binding: BindingContext::Declaration,
        };
        self = self.record_callable_pattern_bindings(pattern, &context);
        self
    }
}

#[allow(clippy::too_many_arguments)]
impl ScopedCallableInventory {
    fn collect_import_callback_pattern(
        mut self,
        node: tree_sitter::Node<'_>,
        source: &str,
        source_path: &Path,
        callable_names: &HashSet<String>,
        first_line: usize,
    ) -> Self {
        if node.kind() != "call_expression" {
            return self;
        }
        let Some(function) = node.child_by_field_name("function") else {
            return self;
        };
        if !matches!(
            function.kind(),
            "member_expression" | "subscript_expression"
        ) || DynamicWasmCallables::member_name(function, source).as_deref() != Some("then")
        {
            return self;
        }
        let Some(module) = function
            .child_by_field_name("object")
            .and_then(|receiver| DynamicWasmAliases::loaded_module_specifier(receiver, source))
            .filter(|module| {
                (WasmModuleSources {
                    module,
                    source_path,
                })
                .is_wasm_callable_source()
            })
        else {
            return self;
        };
        let Some(arguments) = node.child_by_field_name("arguments") else {
            return self;
        };
        let context = PatternContext {
            source,
            source_path,
            callable_names,
            module: &module,
            first_line,
            binding: BindingContext::Parameter,
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
                    self = self.record_callable_pattern_bindings(pattern, &context);
                } else if pattern.kind() == "identifier"
                    && let Some(namespace) = DynamicWasmCallables::scoped_parameter_binding(
                        pattern,
                        source,
                        Some(module.clone()),
                    )
                {
                    self.scoped_wasm_namespaces.push(namespace);
                }
            }
        }
        self
    }
}

struct PatternContext<'a> {
    source: &'a str,
    source_path: &'a Path,
    callable_names: &'a HashSet<String>,
    module: &'a str,
    first_line: usize,
    binding: BindingContext,
}

impl ScopedCallableInventory {
    fn record_callable_pattern_bindings(
        mut self,
        pattern: tree_sitter::Node<'_>,
        context: &PatternContext<'_>,
    ) -> Self {
        let mut cursor = pattern.walk();
        for child in pattern.named_children(&mut cursor) {
            let (authored, binding) = DynamicWasmCallables::pattern_pair(child);
            let (Some(authored), Some(binding)) = (authored, binding) else {
                continue;
            };
            let Some(authored_name) = (JavaScriptLiteral {
                node: authored,
                source: context.source,
            })
            .semantic_javascript_name() else {
                continue;
            };
            if !context.callable_names.contains(&authored_name)
                || !WasmModuleSources::is_wasm_callable_export(
                    context.module,
                    &authored_name,
                    context.source_path,
                )
            {
                continue;
            }
            if (JavaScriptLiteral {
                node: binding,
                source: context.source,
            })
            .semantic_javascript_name()
            .is_some_and(|binding_name| binding_name != authored_name)
            {
                self.lines
                    .push(context.first_line + authored.start_position().row);
            }
            let scoped = if matches!(context.binding, BindingContext::Parameter) {
                DynamicWasmCallables::scoped_parameter_binding(binding, context.source, None)
            } else {
                ScopedBinding::scoped_binding(binding, context.source, None, None)
            };
            if let Some(scoped) = scoped {
                self.bindings.push(scoped);
            }
        }
        self
    }
}

impl DynamicWasmCallables<'_> {
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
}

impl DynamicWasmCallables<'_> {
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
}

impl DynamicWasmCallables<'_> {
    fn member_name(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
        node.child_by_field_name("property")
            .or_else(|| node.child_by_field_name("index"))
            .and_then(|property| {
                (JavaScriptLiteral {
                    node: property,
                    source: source,
                })
                .semantic_javascript_name()
            })
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum BindingContext {
    Declaration,
    Parameter,
}
