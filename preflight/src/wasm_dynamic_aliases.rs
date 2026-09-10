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
use crate::wasm_dynamic_callables::DynamicWasmCallables;
use crate::wasm_factories::WasmInstanceFactories;
use crate::wasm_inventory::WasmTypeInventory;
use crate::wasm_member_aliases::WasmMemberAliases;
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
            && let Some(receiver) = ScopedBinding::scoped_binding(binding, source, None, None)
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
                            source: source,
                        })
                        .semantic_javascript_name()
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
pub(super) fn collect_dynamic_wasm_aliases_and_bindings(node: tree_sitter::Node<'_>, source: &str, source_path: &Path, first_line: usize, callable_names: &HashSet<String>, wasm_type_names: &HashSet<String>, wasm_types: &WasmTypeInventory, wasm_namespace_bindings: &mut HashMap<String, String>, wasm_class_bindings: &HashMap<String, String>, wasm_instance_bindings: &mut HashMap<String, String>, imported_callable_bindings: &mut HashSet<String>, lines: &mut Vec<usize>) {
    let (mut scoped_wasm_namespaces, mut scoped_wasm_instances) = (Vec::new(), Vec::new());
    let (mut scoped_wasm_callables, mut scoped_wasm_runtime_receivers) = (Vec::new(), Vec::new());
    let mut scoped_wasm_factories = Vec::new();
    let mut imported_wasm_factories = HashMap::new();
    let mut member_alias_receivers = HashSet::new();
    let mut called_bindings = HashSet::new();
    member_alias_receivers = WasmInstanceFactories::collect_member_alias_receiver_names(node, source, callable_names, member_alias_receivers);
    called_bindings = WasmInstanceFactories::collect_factory_calls_for_receivers(node, source, &member_alias_receivers, called_bindings);
    scoped_wasm_factories = (WasmInstanceFactories { node, source, wasm_class_bindings, factories: scoped_wasm_factories }).collect_wasm_instance_factories();
    imported_wasm_factories = WasmInstanceFactories::collect_imported_wasm_instance_factories(node, source, source_path, wasm_type_names, &called_bindings, imported_wasm_factories);
    scoped_wasm_runtime_receivers = DynamicWasmAliases::collect_wasm_runtime_receivers(node, source, scoped_wasm_runtime_receivers);
    scoped_wasm_instances = WasmInstanceFactories::collect_typed_wasm_instances(node, source, wasm_class_bindings, scoped_wasm_instances);
    (DynamicWasmCallables { node, source, source_path, callable_names, wasm_namespace_bindings, scoped_wasm_namespaces: &mut scoped_wasm_namespaces, bindings: &mut scoped_wasm_callables, lines, first_line }).collect_scoped_dynamic_callable_bindings();
    DynamicWasmAliases::collect_dynamic_wasm_aliases(node, source, source_path, first_line, callable_names, wasm_type_names, wasm_types, wasm_namespace_bindings, wasm_class_bindings, wasm_instance_bindings, &imported_wasm_factories, &scoped_wasm_factories, &scoped_wasm_runtime_receivers, &mut scoped_wasm_namespaces, &mut scoped_wasm_instances, &mut scoped_wasm_callables, imported_callable_bindings, lines);
    WasmMemberAliases::collect_object_literal_aliases_in_tree(node, source, source_path, first_line, callable_names, wasm_type_names, wasm_types, wasm_namespace_bindings, wasm_class_bindings, wasm_instance_bindings, &scoped_wasm_namespaces, &scoped_wasm_instances, &mut scoped_wasm_callables, imported_callable_bindings, lines);
    DynamicWasmAliases::collect_dynamic_wasm_aliases(node, source, source_path, first_line, callable_names, wasm_type_names, wasm_types, wasm_namespace_bindings, wasm_class_bindings, wasm_instance_bindings, &imported_wasm_factories, &scoped_wasm_factories, &scoped_wasm_runtime_receivers, &mut scoped_wasm_namespaces, &mut scoped_wasm_instances, &mut scoped_wasm_callables, imported_callable_bindings, lines);
}
}

#[allow(clippy::too_many_arguments)]
#[rustfmt::skip]
impl DynamicWasmAliases<'_> {
fn collect_dynamic_wasm_aliases(node: tree_sitter::Node<'_>, source: &str, source_path: &Path, first_line: usize, callable_names: &HashSet<String>, wasm_type_names: &HashSet<String>, wasm_types: &WasmTypeInventory, wasm_namespace_bindings: &mut HashMap<String, String>, wasm_class_bindings: &HashMap<String, String>, wasm_instance_bindings: &mut HashMap<String, String>, wasm_instance_factories: &HashMap<String, String>, scoped_wasm_factories: &[ScopedBinding], scoped_wasm_runtime_receivers: &[ScopedBinding], scoped_wasm_namespaces: &mut Vec<ScopedBinding>, scoped_wasm_instances: &mut Vec<ScopedBinding>, scoped_wasm_callables: &mut Vec<ScopedBinding>, imported_callable_bindings: &mut HashSet<String>, lines: &mut Vec<usize>) {
    if matches!(
        node.kind(),
        "assignment_expression" | "augmented_assignment_expression"
    ) && let (Some(binding), Some(value)) = (
        node.child_by_field_name("left"),
        node.child_by_field_name("right"),
    ) {
        if !node.utf8_text(source.as_bytes()).is_ok_and(|text| text.contains("||=") || text.contains("??=")) {
            DynamicWasmAliases::invalidate_reassigned_wasm_binding(binding, source, scoped_wasm_namespaces, scoped_wasm_instances, scoped_wasm_callables, imported_callable_bindings);
        }
        DynamicWasmAliases::collect_binding_aliases(crate::wasm_dynamic_aliases::BindingAliasObservation { binding, value, source, source_path, first_line, callable_names, wasm_type_names, wasm_types, wasm_namespace_bindings, wasm_class_bindings, wasm_instance_bindings, wasm_instance_factories, scoped_wasm_factories, scoped_wasm_runtime_receivers, scoped_wasm_namespaces, scoped_wasm_instances, scoped_wasm_callables, imported_callable_bindings, lines });
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
    ) && DynamicWasmAliases::collect_binding_aliases(crate::wasm_dynamic_aliases::BindingAliasObservation { binding, value, source, source_path, first_line, callable_names, wasm_type_names, wasm_types, wasm_namespace_bindings, wasm_class_bindings, wasm_instance_bindings, wasm_instance_factories, scoped_wasm_factories, scoped_wasm_runtime_receivers, scoped_wasm_namespaces, scoped_wasm_instances, scoped_wasm_callables, imported_callable_bindings, lines }) {
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        DynamicWasmAliases::collect_dynamic_wasm_aliases(child, source, source_path, first_line, callable_names, wasm_type_names, wasm_types, wasm_namespace_bindings, wasm_class_bindings, wasm_instance_bindings, wasm_instance_factories, scoped_wasm_factories, scoped_wasm_runtime_receivers, scoped_wasm_namespaces, scoped_wasm_instances, scoped_wasm_callables, imported_callable_bindings, lines);
    }
}
}

impl DynamicWasmAliases<'_> {
    fn invalidate_reassigned_wasm_binding(
        binding: tree_sitter::Node<'_>,
        source: &str,
        scoped_wasm_namespaces: &mut [ScopedBinding],
        scoped_wasm_instances: &mut [ScopedBinding],
        scoped_wasm_callables: &mut [ScopedBinding],
        imported_callable_bindings: &mut HashSet<String>,
    ) {
        let binding = DynamicWasmAliases::unwrap_transparent_expression(binding);
        if !matches!(
            binding.kind(),
            "identifier" | "member_expression" | "subscript_expression"
        ) {
            return;
        }
        let Ok(name) = binding.utf8_text(source.as_bytes()) else {
            return;
        };
        ScopedBinding::invalidate_visible_scoped_binding(
            binding,
            name,
            source,
            scoped_wasm_namespaces,
        );
        ScopedBinding::invalidate_visible_scoped_binding(
            binding,
            name,
            source,
            scoped_wasm_instances,
        );
        if ScopedBinding::invalidate_visible_scoped_binding(
            binding,
            name,
            source,
            scoped_wasm_callables,
        ) && binding.kind() == "identifier"
        {
            imported_callable_bindings.remove(name);
        }
    }
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
impl DynamicWasmAliases<'_> {
    fn collect_binding_aliases(request: BindingAliasObservation<'_>) -> bool {
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
            scoped_wasm_namespaces,
            scoped_wasm_instances,
            scoped_wasm_callables,
            imported_callable_bindings,
            lines,
        } = request;

        let binding = DynamicWasmAliases::unwrap_transparent_expression(binding);
        let value = DynamicWasmAliases::unwrap_transparent_expression(value);
        if binding.kind() == "identifier"
            && let Some(module) = DynamicWasmAliases::loaded_module_specifier(value, source)
            && WasmModuleSources::is_wasm_callable_export(&module, "default", source_path)
            && let Some(name) = (JavaScriptLiteral {
                node: binding,
                source: source,
            })
            .semantic_javascript_name()
        {
            lines.push(first_line + binding.start_position().row);
            if let Some(scoped) = ScopedBinding::scoped_binding(binding, source, None, None) {
                scoped_wasm_callables.push(scoped);
            } else {
                imported_callable_bindings.insert(name);
            }
            return true;
        }
        if let Some(namespace_binding) = DynamicWasmAliases::dynamic_namespace_binding(
            binding,
            value,
            source,
            source_path,
            wasm_namespace_bindings,
            scoped_wasm_namespaces,
        ) {
            scoped_wasm_namespaces.push(namespace_binding);
        }
        if let Some(instance_binding) = DynamicWasmAliases::wasm_instance_binding(
            binding,
            value,
            source,
            source_path,
            wasm_types,
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
        if (WasmMemberAliases {
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
        })
        .collect_destructuring_aliases()
        {
            return true;
        }
        if DynamicWasmAliases::collect_factory_result_member_alias(
            binding,
            value,
            source,
            first_line,
            wasm_types,
            wasm_instance_factories,
            scoped_wasm_factories,
            scoped_wasm_callables,
            imported_callable_bindings,
            lines,
        ) {
            return true;
        }
        WasmMemberAliases::collect_namespace_member_alias(
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
        DynamicWasmAliases::collect_named_callable_copy_alias(
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
}

#[allow(clippy::too_many_arguments)]
#[rustfmt::skip]
impl DynamicWasmAliases<'_> {
fn collect_factory_result_member_alias(binding: tree_sitter::Node<'_>, value: tree_sitter::Node<'_>, source: &str, first_line: usize, wasm_types: &WasmTypeInventory, factories: &HashMap<String, String>, scoped_factories: &[ScopedBinding], scoped_callables: &mut Vec<ScopedBinding>, root_callables: &mut HashSet<String>, lines: &mut Vec<usize>) -> bool {
    if !matches!(value.kind(), "member_expression" | "subscript_expression") {
        return false;
    }
    let Some(receiver) = value.child_by_field_name("object") else {
        return false;
    };
    let receiver = DynamicWasmAliases::unwrap_transparent_expression(receiver);
    if receiver.kind() != "call_expression" {
        return false;
    }
    let Some(function) = receiver.child_by_field_name("function") else {
        return false;
    };
    let Some(factory_name) = (JavaScriptLiteral { node: function, source: source }).callable_expression_name() else {
        return false;
    };
    let wasm_type = function.utf8_text(source.as_bytes()).ok().filter(|_| DynamicWasmAliases::callable_binding_is_visible(function, source)).and_then(|name| factories.get(name).cloned()).or_else(|| DynamicWasmAliases::scoped_wasm_type_visible(function, &factory_name, source, scoped_factories));
    let Some(callable) = wasm_type
        .and_then(|owner| wasm_types.methods.get(&owner))
        .and_then(|methods| {
            value.child_by_field_name("property").or_else(|| value.child_by_field_name("index")).and_then(|property| (JavaScriptLiteral { node: property, source: source }).semantic_javascript_name()).filter(|name| methods.contains(name))
        })
    else {
        return false;
    };
    let binding_node = binding.child_by_field_name("property").or_else(|| binding.child_by_field_name("index")).unwrap_or(binding);
    let Some(binding_name) = (JavaScriptLiteral { node: binding_node, source: source }).semantic_javascript_name() else {
        return false;
    };
    if binding_name != callable {
        lines.push(first_line + binding_node.start_position().row);
    }
    if let Some(scoped) = ScopedBinding::scoped_binding(binding_node, source, None, None) {
        scoped_callables.push(scoped);
    } else {
        root_callables.insert(binding_name);
    }
    true
}
}

impl DynamicWasmAliases<'_> {
    fn dynamic_namespace_binding(
        binding: tree_sitter::Node<'_>,
        value: tree_sitter::Node<'_>,
        source: &str,
        source_path: &Path,
        wasm_namespace_bindings: &HashMap<String, String>,
        scoped_wasm_namespaces: &[ScopedBinding],
    ) -> Option<ScopedBinding> {
        let reference = binding;
        let binding = DynamicWasmAliases::declared_binding(binding, source).unwrap_or(binding);
        if binding.kind() == "identifier"
            && let Some(module) = DynamicWasmAliases::wasm_module_specifier(
                value,
                source,
                source_path,
                wasm_namespace_bindings,
                scoped_wasm_namespaces,
            )
        {
            let mut scoped = ScopedBinding::scoped_binding(binding, source, None, Some(module))?;
            if let Some(invocation_end) =
                ScopedBinding::deferred_invocation_end(reference, &scoped, source)
            {
                scoped.declaration_end = invocation_end;
            }
            return Some(scoped);
        }
        None
    }
}

#[allow(clippy::too_many_arguments)]
#[rustfmt::skip]
impl DynamicWasmAliases<'_> {
fn wasm_instance_binding(binding: tree_sitter::Node<'_>, value: tree_sitter::Node<'_>, source: &str, source_path: &Path, wasm_types: &WasmTypeInventory, wasm_class_bindings: &HashMap<String, String>, wasm_namespace_bindings: &HashMap<String, String>, scoped_wasm_namespaces: &[ScopedBinding], wasm_type_names: &HashSet<String>, wasm_instance_factories: &HashMap<String, String>, scoped_wasm_factories: &[ScopedBinding], scoped_wasm_runtime_receivers: &[ScopedBinding], wasm_instance_bindings: &HashMap<String, String>, scoped_wasm_instances: &[ScopedBinding]) -> Option<ScopedBinding> {
    let reference = binding;
    let binding = DynamicWasmAliases::declared_binding(binding, source).unwrap_or(binding);
    if !matches!(
        binding.kind(),
        "identifier" | "member_expression" | "subscript_expression"
    ) {
        return None;
    }
    if let Some(wasm_type) = DynamicWasmAliases::value_is_wasm_instance(value, source, source_path, wasm_types, wasm_class_bindings, wasm_namespace_bindings, scoped_wasm_namespaces, wasm_type_names, wasm_instance_factories, scoped_wasm_factories, scoped_wasm_runtime_receivers, wasm_instance_bindings, scoped_wasm_instances) {
        let mut scoped = ScopedBinding::scoped_binding(binding, source, Some(wasm_type), None)?;
        if let Some(invocation_end) = ScopedBinding::deferred_invocation_end(reference, &scoped, source) {
            scoped.declaration_end = invocation_end;
        }
        return Some(scoped);
    }
    None
}
}

impl DynamicWasmAliases<'_> {
    fn declared_binding<'a>(
        reference: tree_sitter::Node<'a>,
        source: &str,
    ) -> Option<tree_sitter::Node<'a>> {
        if reference.kind() != "identifier" {
            return None;
        }
        let name = (JavaScriptLiteral {
            node: reference,
            source: source,
        })
        .semantic_javascript_name()?;
        let mut root = reference;
        while let Some(parent) = root.parent() {
            root = parent;
        }
        DynamicWasmAliases::find_declared_binding(root, reference, &name, source)
    }
}

impl DynamicWasmAliases<'_> {
    fn find_declared_binding<'a>(
        node: tree_sitter::Node<'a>,
        reference: tree_sitter::Node<'_>,
        name: &str,
        source: &str,
    ) -> Option<tree_sitter::Node<'a>> {
        if node.kind() == "variable_declarator"
            && let Some(binding) = node.child_by_field_name("name")
            && (JavaScriptLiteral {
                node: binding,
                source: source,
            })
            .semantic_javascript_name()
            .as_deref()
                == Some(name)
            && let Some(scoped) = ScopedBinding::scoped_binding(binding, source, None, None)
            && ScopedBinding::deferred_assignment_executes(reference, &scoped, source)
            && ScopedBinding::scoped_binding_is_visible(reference, name, source, &[scoped])
        {
            return Some(binding);
        }
        let mut cursor = node.walk();
        node.named_children(&mut cursor).find_map(|child| {
            DynamicWasmAliases::find_declared_binding(child, reference, name, source)
        })
    }
}

#[allow(clippy::too_many_arguments)]
#[rustfmt::skip]
impl DynamicWasmAliases<'_> {
fn value_is_wasm_instance(value: tree_sitter::Node<'_>, source: &str, source_path: &Path, wasm_types: &WasmTypeInventory, wasm_class_bindings: &HashMap<String, String>, wasm_namespace_bindings: &HashMap<String, String>, scoped_wasm_namespaces: &[ScopedBinding], wasm_type_names: &HashSet<String>, wasm_instance_factories: &HashMap<String, String>, scoped_wasm_factories: &[ScopedBinding], scoped_wasm_runtime_receivers: &[ScopedBinding], wasm_instance_bindings: &HashMap<String, String>, scoped_wasm_instances: &[ScopedBinding]) -> Option<String> {
    let value = DynamicWasmAliases::unwrap_transparent_expression(value);
    if value.kind() == "identifier"
        && let Ok(name) = value.utf8_text(source.as_bytes())
    {
        if let Some(wasm_type) =
            DynamicWasmAliases::scoped_wasm_type_visible(value, name, source, scoped_wasm_instances)
        {
            return Some(wasm_type);
        }
        if ScopedBinding::root_binding_is_visible(value, name, source)
            && let Some(wasm_type) = wasm_instance_bindings.get(name)
        {
            return Some(wasm_type.clone());
        }
    }
    if value.kind() == "new_expression"
        && let Some(constructor) = value.child_by_field_name("constructor")
        && let Some(wasm_type) = DynamicWasmAliases::constructor_wasm_class(
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
        && let Some(name) = (JavaScriptLiteral { node: function, source: source }).callable_expression_name()
    {
        if matches!(
            function.kind(),
            "member_expression" | "subscript_expression"
        ) && let Some(object) = function.child_by_field_name("object")
            && DynamicWasmAliases::wasm_module_specifier(object, source, source_path, wasm_namespace_bindings, scoped_wasm_namespaces).is_some_and(|module| WasmModuleSources::is_wasm_callable_export(&module, &name, source_path))
            && let Some(wasm_type) = wasm_types.free_returns.get(&name)
        {
            return Some(wasm_type.clone());
        }
        if DynamicWasmAliases::callable_binding_is_visible(function, source)
            && let Ok(full_name) = function.utf8_text(source.as_bytes())
            && let Some(wasm_type) = wasm_instance_factories.get(full_name)
        {
            return Some(wasm_type.clone());
        }
        if name == WASM_MANAGER_ACCESSOR
            && DynamicWasmAliases::wasm_runtime_accessor_receiver_is_visible(
                function,
                source,
                scoped_wasm_runtime_receivers,
            )
        {
            return Some("NookVaultManager".to_owned());
        }
        if let Some(wasm_type) =
            DynamicWasmAliases::scoped_wasm_type_visible(function, &name, source, scoped_wasm_factories)
        {
            return Some(wasm_type);
        }
        if ScopedBinding::root_binding_is_visible(function, &name, source)
            && let Some(wasm_type) = wasm_instance_factories.get(&name)
        {
            return Some(wasm_type.clone());
        }
    }
    if value.kind() == "await_expression" {
        let mut cursor = value.walk();
        return value.named_children(&mut cursor).find_map(|child| DynamicWasmAliases::value_is_wasm_instance(child, source, source_path, wasm_types, wasm_class_bindings, wasm_namespace_bindings, scoped_wasm_namespaces, wasm_type_names, wasm_instance_factories, scoped_wasm_factories, scoped_wasm_runtime_receivers, wasm_instance_bindings, scoped_wasm_instances));
    }
    None
}
}

impl DynamicWasmAliases<'_> {
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
            if ScopedBinding::root_binding_is_visible(constructor, name, source)
                && let Some(wasm_type) = wasm_class_bindings.get(name)
            {
                return Some(wasm_type.clone());
            }
            let mut root = constructor;
            while let Some(parent) = root.parent() {
                root = parent;
            }
            return DynamicWasmAliases::copied_wasm_class(
                root,
                constructor,
                name,
                source,
                wasm_class_bindings,
                wasm_namespace_bindings,
                scoped_wasm_namespaces,
                wasm_type_names,
            );
        }
        if constructor.kind() != "member_expression" {
            return None;
        }
        let namespace = constructor.child_by_field_name("object")?;
        let class_name = constructor
            .child_by_field_name("property")
            .and_then(|property| {
                (JavaScriptLiteral {
                    node: property,
                    source: source,
                })
                .semantic_javascript_name()
            })?;
        let namespace_name = namespace.utf8_text(source.as_bytes()).ok()?;
        let namespace_is_wasm = (wasm_namespace_bindings.contains_key(namespace_name)
            && ScopedBinding::root_binding_is_visible(namespace, namespace_name, source))
            || DynamicWasmAliases::scoped_wasm_module_visible(
                namespace,
                namespace_name,
                source,
                scoped_wasm_namespaces,
            )
            .is_some();
        (namespace_is_wasm && wasm_type_names.contains(&class_name)).then_some(class_name)
    }
}

#[allow(clippy::too_many_arguments)]
#[rustfmt::skip]
impl DynamicWasmAliases<'_> {
fn copied_wasm_class(node: tree_sitter::Node<'_>, reference: tree_sitter::Node<'_>, name: &str, source: &str, classes: &HashMap<String, String>, namespaces: &HashMap<String, String>, scoped_namespaces: &[ScopedBinding], wasm_type_names: &HashSet<String>) -> Option<String> {
    if node.kind() == "variable_declarator"
        && let (Some(pattern), Some(namespace)) = (node.child_by_field_name("name"), node.child_by_field_name("value"))
        && pattern.kind() == "object_pattern"
        && let Some(namespace_name) = (JavaScriptLiteral { node: namespace, source: source }).semantic_javascript_name()
        && ((namespaces.contains_key(&namespace_name) && ScopedBinding::root_binding_is_visible(namespace, &namespace_name, source)) || DynamicWasmAliases::scoped_wasm_module_visible(namespace, &namespace_name, source, scoped_namespaces).is_some())
    {
        let mut cursor = pattern.walk();
        if let Some(wasm_type) = pattern.named_children(&mut cursor).find_map(|pair| {
            let key = pair.child_by_field_name("key").and_then(|key| (JavaScriptLiteral { node: key, source: source }).semantic_javascript_name())?;
            let alias = pair.child_by_field_name("value").and_then(|value| (JavaScriptLiteral { node: value, source: source }).semantic_javascript_name())?;
            (alias == name && wasm_type_names.contains(&key)).then_some(key)
        }) {
            return Some(wasm_type);
        }
    }
    if matches!(node.kind(), "variable_declarator" | "assignment_expression")
        && let (Some(binding), Some(value)) = (
            node.child_by_field_name("name")
                .or_else(|| node.child_by_field_name("left")),
            node.child_by_field_name("value")
                .or_else(|| node.child_by_field_name("right")),
        )
        && (JavaScriptLiteral { node: binding, source: source }).semantic_javascript_name().as_deref() == Some(name)
        && let Some(source_name) = (JavaScriptLiteral { node: value, source: source }).semantic_javascript_name()
        && ScopedBinding::root_binding_is_visible(value, &source_name, source)
        && let Some(wasm_type) = classes.get(&source_name)
        && let Some(mut scoped) = ScopedBinding::scoped_binding(binding, source, Some(wasm_type.clone()), None)
        && {
            scoped.declaration_end = node.end_byte();
            true
        }
        && ScopedBinding::scoped_binding_is_visible(reference, name, source, &[scoped])
    {
        return Some(wasm_type.clone());
    }
    let mut cursor = node.walk();
    node.named_children(&mut cursor).find_map(|child| DynamicWasmAliases::copied_wasm_class(child, reference, name, source, classes, namespaces, scoped_namespaces, wasm_type_names))
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
    pub(super) fn wasm_module_specifier(
        value: tree_sitter::Node<'_>,
        source: &str,
        source_path: &Path,
        wasm_namespace_bindings: &HashMap<String, String>,
        scoped_wasm_namespaces: &[ScopedBinding],
    ) -> Option<String> {
        if let Some(module) = DynamicWasmAliases::loaded_module_specifier(value, source)
            && (WasmModuleSources {
                module: &module,
                source_path,
            })
            .is_wasm_callable_source()
        {
            return Some(module);
        }
        let name = value.utf8_text(source.as_bytes()).ok()?;
        if ScopedBinding::root_binding_is_visible(value, name, source)
            && let Some(module) = wasm_namespace_bindings.get(name)
        {
            return Some(module.clone());
        }
        DynamicWasmAliases::scoped_wasm_module_visible(value, name, source, scoped_wasm_namespaces)
    }
}

impl DynamicWasmAliases<'_> {
    pub(super) fn loaded_module_specifier(
        node: tree_sitter::Node<'_>,
        source: &str,
    ) -> Option<String> {
        if node.kind() == "call_expression"
            && let Some(function) = node.child_by_field_name("function")
            && (function.kind() == "import"
                || (function
                    .utf8_text(source.as_bytes())
                    .is_ok_and(|name| name == "require")
                    && ScopedBinding::root_binding_is_visible(function, "require", source)))
        {
            let arguments = node.child_by_field_name("arguments")?;
            let mut cursor = arguments.walk();
            return arguments
                .named_children(&mut cursor)
                .find(|argument| matches!(argument.kind(), "string" | "template_string"))
                .and_then(|argument| {
                    (JavaScriptLiteral {
                        node: argument,
                        source,
                    })
                    .static_javascript_string()
                });
        }

        if matches!(
            node.kind(),
            "await_expression"
                | "parenthesized_expression"
                | "as_expression"
                | "satisfies_expression"
        ) {
            let mut cursor = node.walk();
            return node
                .named_children(&mut cursor)
                .find_map(|child| DynamicWasmAliases::loaded_module_specifier(child, source));
        }

        None
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

impl DynamicWasmAliases<'_> {
    pub(super) fn scoped_wasm_type_visible(
        reference: tree_sitter::Node<'_>,
        name: &str,
        source: &str,
        bindings: &[ScopedBinding],
    ) -> Option<String> {
        ScopedBinding::visible_scoped_binding(reference, name, source, bindings)
            .and_then(|binding| binding.wasm_type.clone())
    }
}

impl DynamicWasmAliases<'_> {
    pub(super) fn scoped_wasm_module_visible(
        reference: tree_sitter::Node<'_>,
        name: &str,
        source: &str,
        bindings: &[ScopedBinding],
    ) -> Option<String> {
        ScopedBinding::visible_scoped_binding(reference, name, source, bindings)
            .and_then(|binding| binding.wasm_module.clone())
    }
}

impl DynamicWasmAliases<'_> {
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
            && ScopedBinding::root_binding_is_visible(value, source_name, source);
        let is_scoped_callable = ScopedBinding::scoped_binding_is_visible(
            value,
            source_name,
            source,
            scoped_wasm_callables,
        );
        if !is_root_callable && !is_scoped_callable {
            return;
        }
        let Ok(binding_name) = binding.utf8_text(source.as_bytes()) else {
            return;
        };
        if binding_name != source_name {
            lines.push(first_line + binding.start_position().row);
        }
        if ScopedBinding::declaration_is_in_program_scope(binding) {
            imported_callable_bindings.insert(binding_name.to_owned());
        }
    }
}

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
    scoped_wasm_namespaces: &'a mut Vec<ScopedBinding>,
    scoped_wasm_instances: &'a mut Vec<ScopedBinding>,
    scoped_wasm_callables: &'a mut Vec<ScopedBinding>,
    imported_callable_bindings: &'a mut HashSet<String>,
    lines: &'a mut Vec<usize>,
}
