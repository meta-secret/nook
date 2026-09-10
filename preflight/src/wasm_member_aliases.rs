use crate::javascript_literals::JavaScriptLiteralFailure;
use crate::javascript_scopes::BindingProvenance;
use crate::wasm_dynamic_aliases::AliasResolutionFailure;
pub struct WasmMemberAliases<'scan> {
    pub binding: tree_sitter::Node<'scan>,
    pub value: tree_sitter::Node<'scan>,
    pub source: &'scan str,
    pub source_path: &'scan Path,
    pub first_line: usize,
    pub callable_names: &'scan HashSet<String>,
    pub wasm_type_names: &'scan HashSet<String>,
    pub wasm_types: &'scan WasmTypeInventory,
    pub wasm_namespace_bindings: &'scan HashMap<String, String>,
    pub wasm_class_bindings: &'scan HashMap<String, String>,
    pub wasm_instance_bindings: &'scan HashMap<String, String>,
    pub scoped_wasm_namespaces: &'scan [ScopedBinding],
    pub scoped_wasm_instances: &'scan [ScopedBinding],
    pub inventory: CallableAliasInventory,
}
use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::javascript_literals::JavaScriptLiteral;
use crate::javascript_scopes::ScopedBinding;
use crate::wasm_dynamic_aliases::DynamicWasmAliases;
use crate::wasm_inventory::WasmTypeInventory;
use crate::wasm_module_sources::WasmModuleSources;

#[allow(clippy::too_many_arguments)]
impl WasmMemberAliases<'_> {
    #[expect(
        clippy::too_many_lines,
        reason = "one destructuring traversal owns alias admission"
    )]
    pub fn collect_destructuring_aliases(self) -> (CallableAliasInventory, AliasDescent) {
        let Self {
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
            mut inventory,
        } = self;
        if binding.kind() == "array_pattern" && value.kind() == "array" {
            let values = WasmMemberAliases::array_elements(value);
            for (index, binding) in WasmMemberAliases::array_elements(binding) {
                let Some(value) = values.get(&index).copied() else {
                    continue;
                };
                if let Ok(callable) = WasmMemberAliases::wasm_callable_member_name(
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
                ) && let Ok(name) = (JavaScriptLiteral {
                    node: binding,
                    source,
                })
                .semantic_javascript_name()
                {
                    if name != callable {
                        inventory
                            .lines
                            .push(first_line + binding.start_position().row);
                    }
                    if let Ok(scoped) = ScopedBinding::from_declaration(
                        binding,
                        source,
                        BindingProvenance::Callable,
                    ) {
                        inventory.callables.push(scoped);
                    }
                }
            }
            return (inventory, AliasDescent::Complete);
        }
        if binding.kind() != "object_pattern" {
            return (inventory, AliasDescent::Descend);
        }
        if {
            let matched;
            (inventory, matched) = inventory
                .collect_tracked_object_pattern_aliases(binding, value, source, first_line);
            matches!(matched, AliasDescent::Complete)
        } {
            return (inventory, AliasDescent::Complete);
        }
        if let Ok(module) = DynamicWasmAliases::wasm_module_specifier(
            value,
            source,
            source_path,
            wasm_namespace_bindings,
            scoped_wasm_namespaces,
        ) {
            inventory = inventory.collect_object_pattern_aliases(
                binding,
                source,
                first_line,
                callable_names,
                &module,
                source_path,
            );
            return (inventory, AliasDescent::Complete);
        }
        let Ok(wasm_type) = WasmMemberAliases::wasm_receiver_type(
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
            return (inventory, AliasDescent::Descend);
        };
        inventory = inventory
            .collect_type_pattern_aliases(binding, source, first_line, &wasm_type, wasm_types);
        (inventory, AliasDescent::Complete)
    }
}

impl CallableAliasInventory {
    fn collect_tracked_object_pattern_aliases(
        mut self,
        pattern: tree_sitter::Node<'_>,
        value: tree_sitter::Node<'_>,
        source: &str,
        first_line: usize,
    ) -> (Self, AliasDescent) {
        let Ok(owner) = (JavaScriptLiteral {
            node: value,
            source,
        })
        .semantic_javascript_name() else {
            return (self, AliasDescent::Descend);
        };
        let mut found = false;
        let mut cursor = pattern.walk();
        for pair in pattern.named_children(&mut cursor) {
            let Some(property) = pair.child_by_field_name("key") else {
                continue;
            };
            let Ok(property_name) = (JavaScriptLiteral {
                node: property,
                source,
            })
            .semantic_javascript_name() else {
                continue;
            };
            let full_name = format!("{owner}.{property_name}");
            if !ScopedBinding::scoped_binding_is_visible(value, &full_name, source, &self.callables)
            {
                continue;
            }
            let binding = pair.child_by_field_name("value").unwrap_or(property);
            if (JavaScriptLiteral {
                node: binding,
                source,
            })
            .semantic_javascript_name()
            .is_ok_and(|name| name != property_name)
            {
                self.lines.push(first_line + property.start_position().row);
            }
            if let Ok(scoped) =
                ScopedBinding::from_declaration(binding, source, BindingProvenance::Callable)
            {
                self.callables.push(scoped);
            }
            found = true;
        }
        (self, AliasDescent::from(found))
    }
}

impl WasmMemberAliases<'_> {
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
}

#[allow(clippy::too_many_arguments)]
impl CallableAliasInventory {
    pub(super) fn collect_object_pattern_aliases(
        mut self,
        pattern: tree_sitter::Node<'_>,
        source: &str,
        first_line: usize,
        callable_names: &HashSet<String>,
        module: &str,
        source_path: &Path,
    ) -> Self {
        let mut cursor = pattern.walk();
        for child in pattern.named_children(&mut cursor) {
            if child.kind() == "pair_pattern"
                && let Some(authored_name) = child.child_by_field_name("key")
                && let Ok(name) = (JavaScriptLiteral {
                    node: authored_name,
                    source,
                })
                .semantic_javascript_name()
                && callable_names.contains(&name)
                && WasmModuleSources::is_wasm_callable_export(module, &name, source_path)
                && let Some(binding) = child.child_by_field_name("value")
                && (JavaScriptLiteral {
                    node: binding,
                    source,
                })
                .semantic_javascript_name()
                .is_ok_and(|binding_name| binding_name != name)
            {
                self.lines
                    .push(first_line + authored_name.start_position().row);
            }
        }
        self
    }
}

#[allow(clippy::too_many_arguments)]
impl CallableAliasInventory {
    pub(super) fn collect_namespace_member_alias(
        mut self,
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
    ) -> Self {
        let value = DynamicWasmAliases::unwrap_transparent_expression(value);
        let binding_name_node = match binding.kind() {
            "identifier" | "property_identifier" | "private_property_identifier" => Some(binding),
            "member_expression" => binding.child_by_field_name("property"),
            "subscript_expression" => binding.child_by_field_name("index"),
            _ => None,
        };
        let Some(binding_name_node) = binding_name_node else {
            return self;
        };
        let Ok(callable_name) = WasmMemberAliases::wasm_callable_member_name(
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
            return self;
        };
        let Ok(binding_name) = (JavaScriptLiteral {
            node: binding_name_node,
            source,
        })
        .semantic_javascript_name() else {
            return self;
        };
        if binding_name != callable_name {
            self.lines
                .push(first_line + binding_name_node.start_position().row);
        }
        if binding.kind() == "identifier" {
            if let Ok(scoped) =
                ScopedBinding::from_declaration(binding, source, BindingProvenance::Callable)
            {
                self.callables.push(scoped);
            } else {
                self.imported.insert(binding_name);
            }
        }
        self
    }
}

#[allow(clippy::too_many_arguments)]
#[rustfmt::skip]
impl CallableAliasInventory {
pub(super) fn collect_type_pattern_aliases(mut self, pattern: tree_sitter::Node<'_>, source: &str, first_line: usize, wasm_type: &str, wasm_types: &WasmTypeInventory,) -> Self {
    let Some(methods) = wasm_types.methods.get(wasm_type) else {
        return self;
    };
    let mut cursor = pattern.walk();
    for child in pattern.named_children(&mut cursor) {
        let pair = (child.kind() == "pair_pattern").then(|| Some((child.child_by_field_name("key")?, child.child_by_field_name("value")?))).flatten();
        let defaulted = (child.kind() == "object_assignment_pattern").then(|| child.child_by_field_name("left").map(|left| (left, left))).flatten();
        let shorthand =
            (child.kind() == "shorthand_property_identifier_pattern").then_some((child, child));
        let Some((method_node, binding)) = pair.or(defaulted).or(shorthand) else {
            continue;
        };
        let Ok(method_name) = (JavaScriptLiteral { node: method_node, source }).semantic_javascript_name()
        else {
            continue;
        };
        if !methods.contains(&method_name) { continue; }
        let binding = binding.child_by_field_name("left").unwrap_or(binding);
        let Ok(binding_name) = (JavaScriptLiteral { node: binding, source }).semantic_javascript_name() else {
            continue;
        };
        if binding_name != method_name { self.lines.push(first_line + method_node.start_position().row); }
        if let Ok(scoped) = ScopedBinding::from_declaration(binding, source, BindingProvenance::Callable) {
            self.callables.push(scoped);
        } else {
            self.imported.insert(binding_name);
        }
    }
self
}
}

#[allow(clippy::too_many_arguments)]
#[rustfmt::skip]
impl CallableAliasInventory {
pub(super) fn collect_object_literal_aliases(mut self, object: tree_sitter::Node<'_>, source: &str, source_path: &Path, first_line: usize, callable_names: &HashSet<String>, wasm_type_names: &HashSet<String>, wasm_types: &WasmTypeInventory, wasm_namespace_bindings: &HashMap<String, String>, wasm_class_bindings: &HashMap<String, String>, wasm_instance_bindings: &HashMap<String, String>, scoped_wasm_namespaces: &[ScopedBinding], scoped_wasm_instances: &[ScopedBinding],) -> Self {
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
        let Ok(property_name) = (JavaScriptLiteral { node: key, source }).semantic_javascript_name() else {
            continue;
        };
        let callable_name = WasmMemberAliases::wasm_callable_member_name(
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
        ).ok()
        .or_else(|| {
            let name = (JavaScriptLiteral { node: value, source }).semantic_javascript_name().ok()?;
            ((self.imported.contains(&name)
                && ScopedBinding::root_binding_is_visible(value, &name, source))
                || ScopedBinding::scoped_binding_is_visible(value, &name, source, &self.callables))
            .then_some(name)
        });
        if let Some(callable_name) = callable_name {
            if property_name != callable_name {
                self.lines.push(first_line + key.start_position().row);
            }
            if let Some(owner) = object
                .parent()
                .filter(|parent| parent.kind() == "variable_declarator")
                .and_then(|parent| parent.child_by_field_name("name"))
                && let Ok(owner_name) = (JavaScriptLiteral { node: owner, source }).semantic_javascript_name()
                && let Ok(mut scoped) = ScopedBinding::from_declaration(owner, source, BindingProvenance::Callable)
            {
                scoped.name = format!("{owner_name}.{property_name}");
                self.callables.push(scoped);
            }
        }
    }
self
}
}

#[allow(clippy::too_many_arguments)]
impl CallableAliasInventory {
    pub(super) fn collect_object_literal_aliases_in_tree(
        mut self,
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
    ) -> Self {
        if node.kind() == "object" {
            self = self.collect_object_literal_aliases(
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
            );
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            self = self.collect_object_literal_aliases_in_tree(
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
            );
        }
        self
    }
}

#[allow(clippy::too_many_arguments)]
#[rustfmt::skip]
impl WasmMemberAliases<'_> {
fn wasm_callable_member_name(value: tree_sitter::Node<'_>, source: &str, source_path: &Path, callable_names: &HashSet<String>, wasm_type_names: &HashSet<String>, wasm_types: &WasmTypeInventory, wasm_namespace_bindings: &HashMap<String, String>, wasm_class_bindings: &HashMap<String, String>, wasm_instance_bindings: &HashMap<String, String>, scoped_wasm_namespaces: &[ScopedBinding], scoped_wasm_instances: &[ScopedBinding]) -> Result<String, MemberResolutionFailure> {
    let mut value = DynamicWasmAliases::unwrap_transparent_expression(value);
    if value.kind() == "sequence_expression" {
        let mut cursor = value.walk();
        return value.named_children(&mut cursor).last().and_then(|result| {
            WasmMemberAliases::wasm_callable_member_name(result, source, source_path, callable_names, wasm_type_names, wasm_types, wasm_namespace_bindings, wasm_class_bindings, wasm_instance_bindings, scoped_wasm_namespaces, scoped_wasm_instances).ok()
        }).ok_or(MemberResolutionFailure::UnknownCallable);
    }
    if value.kind() == "assignment_expression" {
        return value.child_by_field_name("right").and_then(|result| {
            WasmMemberAliases::wasm_callable_member_name(result, source, source_path, callable_names, wasm_type_names, wasm_types, wasm_namespace_bindings, wasm_class_bindings, wasm_instance_bindings, scoped_wasm_namespaces, scoped_wasm_instances).ok()
        }).ok_or(MemberResolutionFailure::UnknownCallable);
    }
    if matches!(value.kind(), "ternary_expression" | "binary_expression") {
        let mut cursor = value.walk();
        return value.named_children(&mut cursor).find_map(|branch| {
            WasmMemberAliases::wasm_callable_member_name(
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
            ).ok()
        }).ok_or(MemberResolutionFailure::UnknownCallable);
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
            .and_then(|property| (JavaScriptLiteral { node: property, source }).semantic_javascript_name().ok())
            .is_some_and(|name| name == "bind")
        && let Some(bound) = function.child_by_field_name("object")
    {
        value = DynamicWasmAliases::unwrap_transparent_expression(bound);
    }
    if !matches!(value.kind(), "member_expression" | "subscript_expression") {
        return Err(MemberResolutionFailure::NotMember);
    }
    let namespace = DynamicWasmAliases::unwrap_transparent_expression(value.child_by_field_name("object").ok_or(MemberResolutionFailure::MissingReceiver)?);
    let property = value
        .child_by_field_name("property")
        .or_else(|| value.child_by_field_name("index")).ok_or(MemberResolutionFailure::MissingName)?;
    let callable_name = (JavaScriptLiteral { node: property, source }).semantic_javascript_name().map_err(MemberResolutionFailure::Literal)?;
    let direct_module = DynamicWasmAliases::loaded_module_specifier(namespace, source);
    let namespace_name = namespace.utf8_text(source.as_bytes()).map_err(|_| AliasResolutionFailure::InvalidSource);
    let receiver_type = WasmMemberAliases::wasm_receiver_type(
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
        if ScopedBinding::root_binding_is_visible(namespace, name, source) && let Some(module) = wasm_namespace_bindings.get(name) { return Ok(module.clone()); }
        DynamicWasmAliases::scoped_wasm_module_visible(namespace, name, source, scoped_wasm_namespaces)
    });
    let is_callable = receiver_type.as_ref().is_ok_and(|wasm_type| {
        wasm_types
            .methods
            .get(wasm_type)
            .is_some_and(|methods| methods.contains(&callable_name))
    }) || direct_module
        .as_ref()
        .or(recorded_module.as_ref())
        .is_ok_and(|module| {
            callable_names.contains(&callable_name)
                && WasmModuleSources::is_wasm_callable_export(module, &callable_name, source_path)
        });
    if is_callable { Ok(callable_name) } else { Err(MemberResolutionFailure::UnknownCallable) }
}
}

#[allow(clippy::too_many_arguments)]
impl WasmMemberAliases<'_> {
    #[expect(
        clippy::too_many_lines,
        reason = "receiver resolution is one cohesive syntax decision"
    )]
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
    ) -> Result<String, MemberResolutionFailure> {
        let receiver = DynamicWasmAliases::unwrap_transparent_expression(receiver);
        if receiver.kind() == "new_expression"
            && let Some(constructor) = receiver.child_by_field_name("constructor")
            && let Ok(wasm_type) = DynamicWasmAliases::constructor_wasm_class(
                constructor,
                source,
                wasm_class_bindings,
                wasm_namespace_bindings,
                scoped_wasm_namespaces,
                wasm_type_names,
            )
        {
            return Ok(wasm_type);
        }
        if receiver.kind() == "call_expression"
            && let Some(function) = receiver.child_by_field_name("function")
            && matches!(
                function.kind(),
                "member_expression" | "subscript_expression"
            )
            && let Some(object) = function.child_by_field_name("object")
            && let Some(name) = function
                .child_by_field_name("property")
                .or_else(|| function.child_by_field_name("index"))
                .and_then(|node| {
                    (JavaScriptLiteral { node, source })
                        .semantic_javascript_name()
                        .ok()
                })
            && DynamicWasmAliases::wasm_module_specifier(
                object,
                source,
                source_path,
                wasm_namespace_bindings,
                scoped_wasm_namespaces,
            )
            .is_ok_and(|module| {
                WasmModuleSources::is_wasm_callable_export(&module, &name, source_path)
            })
            && let Some(returned) = wasm_types.free_returns.get(&name)
            && wasm_type_names.contains(returned)
        {
            return Ok(returned.clone());
        }
        if receiver.kind() == "call_expression"
            && let Some(function) = receiver.child_by_field_name("function")
            && matches!(
                function.kind(),
                "member_expression" | "subscript_expression"
            )
            && let Some(object) = function.child_by_field_name("object")
            && let Ok(owner) = WasmMemberAliases::wasm_receiver_type(
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
                .and_then(|node| {
                    (JavaScriptLiteral { node, source })
                        .semantic_javascript_name()
                        .ok()
                })
            && let Some(returned) = wasm_types.returns.get(&(owner, method))
            && wasm_type_names.contains(returned)
        {
            return Ok(returned.clone());
        }
        let receiver_name = receiver.utf8_text(source.as_bytes()).ok();
        receiver_name
            .and_then(|name| {
                DynamicWasmAliases::scoped_wasm_type_visible(
                    receiver,
                    name,
                    source,
                    scoped_wasm_instances,
                )
                .ok()
                .or_else(|| {
                    ScopedBinding::root_binding_is_visible(receiver, name, source)
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
                WasmMemberAliases::namespace_member_wasm_type(
                    receiver,
                    source,
                    source_path,
                    wasm_type_names,
                    wasm_namespace_bindings,
                    scoped_wasm_namespaces,
                )
                .ok()
            })
            .ok_or(MemberResolutionFailure::UnknownReceiver)
    }
}

impl WasmMemberAliases<'_> {
    fn namespace_member_wasm_type(
        expression: tree_sitter::Node<'_>,
        source: &str,
        source_path: &Path,
        wasm_type_names: &HashSet<String>,
        wasm_namespace_bindings: &HashMap<String, String>,
        scoped_wasm_namespaces: &[ScopedBinding],
    ) -> Result<String, MemberResolutionFailure> {
        if !matches!(
            expression.kind(),
            "member_expression" | "subscript_expression"
        ) {
            return Err(MemberResolutionFailure::UnknownReceiver);
        }
        let namespace = expression
            .child_by_field_name("object")
            .ok_or(MemberResolutionFailure::MissingReceiver)?;
        let type_node = expression
            .child_by_field_name("property")
            .or_else(|| expression.child_by_field_name("index"))
            .ok_or(MemberResolutionFailure::MissingName)?;
        let wasm_type = (JavaScriptLiteral {
            node: type_node,
            source,
        })
        .semantic_javascript_name()
        .map_err(MemberResolutionFailure::Literal)?;
        if !wasm_type_names.contains(&wasm_type) {
            return Err(MemberResolutionFailure::UnknownReceiver);
        }
        let module = DynamicWasmAliases::wasm_module_specifier(
            namespace,
            source,
            source_path,
            wasm_namespace_bindings,
            scoped_wasm_namespaces,
        )
        .map_err(MemberResolutionFailure::Alias)?;
        if WasmModuleSources::is_wasm_export(&module, &wasm_type, source_path) {
            Ok(wasm_type)
        } else {
            Err(MemberResolutionFailure::UnknownReceiver)
        }
    }
}

#[derive(Default)]
pub(super) struct CallableAliasInventory {
    pub(super) callables: Vec<ScopedBinding>,
    pub(super) imported: HashSet<String>,
    pub(super) lines: Vec<usize>,
}
#[derive(Clone, Copy)]
pub(super) enum AliasDescent {
    Descend,
    Complete,
}
impl From<bool> for AliasDescent {
    fn from(matched: bool) -> Self {
        if matched {
            Self::Complete
        } else {
            Self::Descend
        }
    }
}

#[derive(Debug)]
#[expect(
    dead_code,
    reason = "typed member resolution causes are retained for diagnostics"
)]
pub(super) enum MemberResolutionFailure {
    NotMember,
    MissingReceiver,
    MissingName,
    UnknownCallable,
    UnknownReceiver,
    Literal(JavaScriptLiteralFailure),
    Alias(AliasResolutionFailure),
}
