use crate::javascript_literals::JavaScriptLiteralFailure;
use crate::javascript_scopes::{BindingInvalidation, BindingProvenance, ScopeAdmissionFailure};
mod resolution;
pub struct DynamicWasmAliases<'scan> {
    pub node: tree_sitter::Node<'scan>,
    pub source: &'scan str,
    pub source_path: &'scan Path,
    pub module: &'scan str,
    pub wasm_namespace_bindings: HashMap<String, String>,
}
use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::javascript_literals::JavaScriptLiteral;
use crate::javascript_scopes::ScopedBinding;
use crate::wasm_dynamic_callables::{DynamicWasmCallables, ScopedCallableInventory};
use crate::wasm_factories::WasmInstanceFactories;
use crate::wasm_inventory::WasmTypeInventory;
use crate::wasm_member_aliases::{AliasDescent, CallableAliasInventory, WasmMemberAliases};
use crate::wasm_module_sources::WasmModuleSources;

const WASM_MANAGER_ACCESSOR: &str = "requireManager";
const WASM_RUNTIME_RECEIVER_PROPERTY: &str = "__nookVault";

mod imports;

impl DynamicWasmAliases<'_> {
    fn collect_wasm_runtime_receivers(
        node: tree_sitter::Node<'_>,
        source: &str,
        mut receivers: Vec<ScopedBinding>,
    ) -> Vec<ScopedBinding> {
        if node.kind() == "variable_declarator"
            && let (Some(binding), Some(value)) = (
                node.child_by_field_name("name"),
                node.child_by_field_name("value"),
            )
            && binding.kind() == "identifier"
            && DynamicWasmAliases::trusted_runtime_receiver(value, source)
            && let Ok(receiver) =
                ScopedBinding::from_declaration(binding, source, BindingProvenance::Callable)
        {
            receivers.push(receiver);
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            receivers =
                DynamicWasmAliases::collect_wasm_runtime_receivers(child, source, receivers);
        }
        receivers
    }
}

impl DynamicWasmAliases<'_> {
    fn trusted_runtime_receiver(node: tree_sitter::Node<'_>, source: &str) -> bool {
        let node = DynamicWasmAliases::unwrap_transparent_expression(node);
        if matches!(node.kind(), "member_expression" | "subscript_expression") {
            let Some(object) = node.child_by_field_name("object") else {
                return false;
            };
            let object = DynamicWasmAliases::unwrap_transparent_expression(object);
            let property = if node.kind() == "subscript_expression" {
                node.child_by_field_name("index")
            } else {
                node.child_by_field_name("property")
            };
            return object
                .utf8_text(source.as_bytes())
                .is_ok_and(|owner| matches!(owner, "window" | "globalThis"))
                && property
                    .and_then(|property| {
                        (JavaScriptLiteral {
                            node: property,
                            source,
                        })
                        .semantic_javascript_name()
                        .ok()
                    })
                    .is_some_and(|property| property == WASM_RUNTIME_RECEIVER_PROPERTY);
        }
        false
    }
}

#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_lines)]
#[rustfmt::skip]
impl DynamicWasmAliases<'_> {
pub(super) fn collect_dynamic_wasm_aliases_and_bindings(node: tree_sitter::Node<'_>, source: &str, source_path: &Path, first_line: usize, callable_names: &HashSet<String>, wasm_type_names: &HashSet<String>, wasm_types: &WasmTypeInventory, wasm_namespace_bindings: &HashMap<String, String>, wasm_class_bindings: &HashMap<String, String>, wasm_instance_bindings: &HashMap<String, String>, imported_callable_bindings: HashSet<String>, lines: Vec<usize>) -> DynamicAliasInventory {
    let member_alias_receivers = WasmInstanceFactories::collect_member_alias_receiver_names(node, source, callable_names, HashSet::new());
    let called_bindings = WasmInstanceFactories::collect_factory_calls_for_receivers(node, source, &member_alias_receivers, HashSet::new());
    let scoped_wasm_factories = (WasmInstanceFactories { node, source, wasm_class_bindings, factories: Vec::new() }).collect_wasm_instance_factories();
    let imported_wasm_factories = WasmInstanceFactories::collect_imported_wasm_instance_factories(node, source, source_path, wasm_type_names, &called_bindings, HashMap::new());
    let scoped_wasm_runtime_receivers = DynamicWasmAliases::collect_wasm_runtime_receivers(node, source, Vec::new());
    let scoped_wasm_instances = WasmInstanceFactories::collect_typed_wasm_instances(node, source, wasm_class_bindings, Vec::new());
    let scoped_callables = (DynamicWasmCallables { node, source, source_path, callable_names, wasm_namespace_bindings, state: ScopedCallableInventory { lines, ..Default::default() }, first_line }).collect_scoped_dynamic_callable_bindings();
    let mut scope_inventory = DynamicScopeInventory { namespaces: scoped_callables.scoped_wasm_namespaces, instances: scoped_wasm_instances, callable: CallableAliasInventory { callables: scoped_callables.bindings, imported: imported_callable_bindings, lines: scoped_callables.lines } };
    let traversal = DynamicAliasTraversal { node, source, source_path, first_line, callable_names, wasm_type_names, wasm_types, wasm_namespace_bindings, wasm_class_bindings, wasm_instance_bindings, wasm_instance_factories: &imported_wasm_factories, scoped_wasm_factories: &scoped_wasm_factories, scoped_wasm_runtime_receivers: &scoped_wasm_runtime_receivers };
    scope_inventory = scope_inventory.collect(traversal);
    scope_inventory.callable = scope_inventory.callable.collect_object_literal_aliases_in_tree(node, source, source_path, first_line, callable_names, wasm_type_names, wasm_types, wasm_namespace_bindings, wasm_class_bindings, wasm_instance_bindings, &scope_inventory.namespaces, &scope_inventory.instances);
    scope_inventory = scope_inventory.collect(traversal);
    DynamicAliasInventory { imported_callable_bindings: scope_inventory.callable.imported, lines: scope_inventory.callable.lines }
}
}

#[derive(Default)]
struct DynamicScopeInventory {
    namespaces: Vec<ScopedBinding>,
    instances: Vec<ScopedBinding>,
    callable: CallableAliasInventory,
}
impl DynamicScopeInventory {
    fn collect(mut self, request: DynamicAliasTraversal<'_>) -> Self {
        let DynamicAliasTraversal {
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
            wasm_instance_factories,
            scoped_wasm_factories,
            scoped_wasm_runtime_receivers,
        } = request;
        if matches!(
            node.kind(),
            "assignment_expression" | "augmented_assignment_expression"
        ) && let (Some(binding), Some(value)) = (
            node.child_by_field_name("left"),
            node.child_by_field_name("right"),
        ) {
            if !node
                .utf8_text(source.as_bytes())
                .is_ok_and(|text| text.contains("||=") || text.contains("??="))
            {
                self = self.invalidate(binding, source);
            }
            (self, _) = self.observe(BindingAliasObservation {
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
            });
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
        ) {
            let descent;
            (self, descent) = self.observe(BindingAliasObservation {
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
            });
            if matches!(descent, AliasDescent::Complete) {
                return self;
            }
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            self = self.collect(DynamicAliasTraversal {
                node: child,
                ..request
            });
        }
        self
    }
    fn invalidate(mut self, binding: tree_sitter::Node<'_>, source: &str) -> Self {
        let binding = DynamicWasmAliases::unwrap_transparent_expression(binding);
        if !matches!(
            binding.kind(),
            "identifier" | "member_expression" | "subscript_expression"
        ) {
            return self;
        }
        let Ok(name) = binding.utf8_text(source.as_bytes()) else {
            return self;
        };
        (self.namespaces, _) = ScopedBinding::invalidate_visible_scoped_binding(
            binding,
            name,
            source,
            self.namespaces,
        );
        (self.instances, _) =
            ScopedBinding::invalidate_visible_scoped_binding(binding, name, source, self.instances);
        let invalidated;
        (self.callable.callables, invalidated) = ScopedBinding::invalidate_visible_scoped_binding(
            binding,
            name,
            source,
            self.callable.callables,
        );
        if matches!(invalidated, BindingInvalidation::Invalidated) && binding.kind() == "identifier"
        {
            self.callable.imported.remove(name);
        }
        self
    }
    #[expect(
        clippy::too_many_lines,
        reason = "one recursive alias observation keeps scope transitions local"
    )]
    fn observe(mut self, request: BindingAliasObservation<'_>) -> (Self, AliasDescent) {
        let BindingAliasObservation {
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
        } = request;
        let binding = DynamicWasmAliases::unwrap_transparent_expression(binding);
        let value = DynamicWasmAliases::unwrap_transparent_expression(value);
        if binding.kind() == "identifier"
            && let Ok(module) = DynamicWasmAliases::loaded_module_specifier(value, source)
            && WasmModuleSources::is_wasm_callable_export(&module, "default", source_path)
            && let Ok(name) = (JavaScriptLiteral {
                node: binding,
                source,
            })
            .semantic_javascript_name()
        {
            self.callable
                .lines
                .push(first_line + binding.start_position().row);
            if let Ok(scoped) =
                ScopedBinding::from_declaration(binding, source, BindingProvenance::Callable)
            {
                self.callable.callables.push(scoped);
            } else {
                self.callable.imported.insert(name);
            }
            return (self, AliasDescent::Complete);
        }
        if let Ok(namespace) = DynamicWasmAliases::dynamic_namespace_binding(
            binding,
            value,
            source,
            source_path,
            wasm_namespace_bindings,
            &self.namespaces,
        ) {
            self.namespaces.push(namespace);
        }
        if let Ok(instance) = DynamicWasmAliases::wasm_instance_binding(
            binding,
            value,
            source,
            source_path,
            wasm_types,
            wasm_class_bindings,
            wasm_namespace_bindings,
            &self.namespaces,
            wasm_type_names,
            wasm_instance_factories,
            scoped_wasm_factories,
            scoped_wasm_runtime_receivers,
            wasm_instance_bindings,
            &self.instances,
        ) {
            self.instances.push(instance);
        }
        let descent;
        (self.callable, descent) = (WasmMemberAliases {
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
            scoped_wasm_namespaces: &self.namespaces,
            scoped_wasm_instances: &self.instances,
            inventory: self.callable,
        })
        .collect_destructuring_aliases();
        if matches!(descent, AliasDescent::Complete) {
            return (self, descent);
        }
        let descent;
        (self.callable, descent) = self.callable.collect_factory_result_member_alias(
            binding,
            value,
            source,
            first_line,
            wasm_types,
            wasm_instance_factories,
            scoped_wasm_factories,
        );
        if matches!(descent, AliasDescent::Complete) {
            return (self, descent);
        }
        self.callable = self.callable.collect_namespace_member_alias(
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
            &self.namespaces,
            &self.instances,
        );
        self.callable = self
            .callable
            .collect_named_callable_copy_alias(binding, value, source, first_line);
        (self, AliasDescent::Descend)
    }
}
#[derive(Clone, Copy)]
struct DynamicAliasTraversal<'a> {
    node: tree_sitter::Node<'a>,
    source: &'a str,
    source_path: &'a Path,
    first_line: usize,
    callable_names: &'a HashSet<String>,
    wasm_type_names: &'a HashSet<String>,
    wasm_types: &'a WasmTypeInventory,
    wasm_namespace_bindings: &'a HashMap<String, String>,
    wasm_class_bindings: &'a HashMap<String, String>,
    wasm_instance_bindings: &'a HashMap<String, String>,
    wasm_instance_factories: &'a HashMap<String, String>,
    scoped_wasm_factories: &'a [ScopedBinding],
    scoped_wasm_runtime_receivers: &'a [ScopedBinding],
}

#[allow(clippy::too_many_arguments)]
#[rustfmt::skip]
impl CallableAliasInventory {
fn collect_factory_result_member_alias(mut self, binding: tree_sitter::Node<'_>, value: tree_sitter::Node<'_>, source: &str, first_line: usize, wasm_types: &WasmTypeInventory, factories: &HashMap<String, String>, scoped_factories: &[ScopedBinding],) -> (Self, AliasDescent) {
    if !matches!(value.kind(), "member_expression" | "subscript_expression") {
        return (self, AliasDescent::Descend);
    }
    let Some(receiver) = value.child_by_field_name("object") else {
        return (self, AliasDescent::Descend);
    };
    let receiver = DynamicWasmAliases::unwrap_transparent_expression(receiver);
    if receiver.kind() != "call_expression" {
        return (self, AliasDescent::Descend);
    }
    let Some(function) = receiver.child_by_field_name("function") else {
        return (self, AliasDescent::Descend);
    };
    let Ok(factory_name) = (JavaScriptLiteral { node: function, source }).callable_expression_name() else {
        return (self, AliasDescent::Descend);
    };
    let wasm_type = function.utf8_text(source.as_bytes()).ok().filter(|_| DynamicWasmAliases::callable_binding_is_visible(function, source)).and_then(|name| factories.get(name).cloned()).or_else(|| DynamicWasmAliases::scoped_wasm_type_visible(function, &factory_name, source, scoped_factories).ok());
    let Some(callable) = wasm_type
        .and_then(|owner| wasm_types.methods.get(&owner))
        .and_then(|methods| {
            value.child_by_field_name("property").or_else(|| value.child_by_field_name("index")).and_then(|property| (JavaScriptLiteral { node: property, source }).semantic_javascript_name().ok()).filter(|name| methods.contains(name))
        })
    else {
        return (self, AliasDescent::Descend);
    };
    let binding_node = binding.child_by_field_name("property").or_else(|| binding.child_by_field_name("index")).unwrap_or(binding);
    let Ok(binding_name) = (JavaScriptLiteral { node: binding_node, source }).semantic_javascript_name() else {
        return (self, AliasDescent::Descend);
    };
    if binding_name != callable {
        self.lines.push(first_line + binding_node.start_position().row);
    }
    if let Ok(scoped) = ScopedBinding::from_declaration(binding_node, source, BindingProvenance::Callable) {
        self.callables.push(scoped);
    } else {
        self.imported.insert(binding_name);
    }
    (self, AliasDescent::Complete)
}
}

impl DynamicWasmAliases<'_> {
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
}

impl DynamicWasmAliases<'_> {
    fn wasm_runtime_accessor_receiver_is_visible(
        function: tree_sitter::Node<'_>,
        source: &str,
        scoped_wasm_runtime_receivers: &[ScopedBinding],
    ) -> bool {
        let Some(receiver) = function.child_by_field_name("object") else {
            return false;
        };
        if DynamicWasmAliases::trusted_runtime_receiver(receiver, source) {
            return true;
        }
        receiver.utf8_text(source.as_bytes()).is_ok_and(|name| {
            ScopedBinding::scoped_binding_is_visible(
                receiver,
                name,
                source,
                scoped_wasm_runtime_receivers,
            )
        })
    }
}

impl DynamicWasmAliases<'_> {
    fn callable_binding_is_visible(function: tree_sitter::Node<'_>, source: &str) -> bool {
        let binding = if function.kind() == "identifier" {
            function
        } else if matches!(
            function.kind(),
            "member_expression" | "subscript_expression"
        ) {
            let Some(object) = function.child_by_field_name("object") else {
                return false;
            };
            object
        } else {
            return false;
        };
        binding
            .utf8_text(source.as_bytes())
            .is_ok_and(|name| ScopedBinding::root_binding_is_visible(binding, name, source))
    }
}

impl CallableAliasInventory {
    fn collect_named_callable_copy_alias(
        mut self,
        binding: tree_sitter::Node<'_>,
        value: tree_sitter::Node<'_>,
        source: &str,
        first_line: usize,
    ) -> Self {
        if binding.kind() != "identifier" || value.kind() != "identifier" {
            return self;
        }
        let Ok(source_name) = value.utf8_text(source.as_bytes()) else {
            return self;
        };
        let is_root_callable = self.imported.contains(source_name)
            && ScopedBinding::root_binding_is_visible(value, source_name, source);
        let is_scoped_callable =
            ScopedBinding::scoped_binding_is_visible(value, source_name, source, &self.callables);
        if !is_root_callable && !is_scoped_callable {
            return self;
        }
        let Ok(binding_name) = binding.utf8_text(source.as_bytes()) else {
            return self;
        };
        if binding_name != source_name {
            self.lines.push(first_line + binding.start_position().row);
        }
        if ScopedBinding::declaration_is_in_program_scope(binding) {
            self.imported.insert(binding_name.to_owned());
        }
        self
    }
}

#[derive(Clone, Copy)]
struct BindingAliasObservation<'a> {
    binding: tree_sitter::Node<'a>,
    value: tree_sitter::Node<'a>,
    source: &'a str,
    source_path: &'a Path,
    first_line: usize,
    callable_names: &'a HashSet<String>,
    wasm_type_names: &'a HashSet<String>,
    wasm_types: &'a WasmTypeInventory,
    wasm_namespace_bindings: &'a HashMap<String, String>,
    wasm_class_bindings: &'a HashMap<String, String>,
    wasm_instance_bindings: &'a HashMap<String, String>,
    wasm_instance_factories: &'a HashMap<String, String>,
    scoped_wasm_factories: &'a [ScopedBinding],
    scoped_wasm_runtime_receivers: &'a [ScopedBinding],
}

pub(super) struct DynamicAliasInventory {
    pub(super) imported_callable_bindings: HashSet<String>,
    pub(super) lines: Vec<usize>,
}

#[derive(Debug)]
#[expect(
    dead_code,
    reason = "typed resolution causes are retained for diagnostics"
)]
pub(super) enum AliasResolutionFailure {
    UnsupportedBinding,
    UnresolvedBinding,
    UnknownInstance,
    UnsupportedConstructor,
    InvalidSource,
    MissingMember,
    UnknownClass,
    MissingModuleArgument,
    NotModuleLoad,
    WrongBindingProvenance,
    Scope(ScopeAdmissionFailure),
    Literal(JavaScriptLiteralFailure),
}
