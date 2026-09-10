use super::*;
use crate::javascript_scopes::BindingProvenance;
use crate::javascript_scopes::Invocation;
use crate::javascript_scopes::VisibleBinding;

impl DynamicWasmAliases<'_> {
    pub(super) fn dynamic_namespace_binding(
        binding: tree_sitter::Node<'_>,
        value: tree_sitter::Node<'_>,
        source: &str,
        source_path: &Path,
        wasm_namespace_bindings: &HashMap<String, String>,
        scoped_wasm_namespaces: &[ScopedBinding],
    ) -> Result<ScopedBinding, AliasResolutionFailure> {
        let reference = binding;
        let binding = DynamicWasmAliases::declared_binding(binding, source).unwrap_or(binding);
        if binding.kind() == "identifier"
            && let Ok(module) = DynamicWasmAliases::wasm_module_specifier(
                value,
                source,
                source_path,
                wasm_namespace_bindings,
                scoped_wasm_namespaces,
            )
        {
            let mut scoped =
                ScopedBinding::scoped_binding(binding, source, BindingProvenance::Module(module))
                    .map_err(AliasResolutionFailure::Scope)?;
            if let Invocation::CompletesAt(invocation_end) =
                ScopedBinding::deferred_invocation_end(reference, &scoped, source)
            {
                scoped.declaration_end = invocation_end;
            }
            return Ok(scoped);
        }
        Err(AliasResolutionFailure::UnresolvedBinding)
    }
}

#[allow(clippy::too_many_arguments)]
#[rustfmt::skip]
impl DynamicWasmAliases<'_> {
pub(super) fn wasm_instance_binding(binding: tree_sitter::Node<'_>, value: tree_sitter::Node<'_>, source: &str, source_path: &Path, wasm_types: &WasmTypeInventory, wasm_class_bindings: &HashMap<String, String>, wasm_namespace_bindings: &HashMap<String, String>, scoped_wasm_namespaces: &[ScopedBinding], wasm_type_names: &HashSet<String>, wasm_instance_factories: &HashMap<String, String>, scoped_wasm_factories: &[ScopedBinding], scoped_wasm_runtime_receivers: &[ScopedBinding], wasm_instance_bindings: &HashMap<String, String>, scoped_wasm_instances: &[ScopedBinding]) -> Result<ScopedBinding, AliasResolutionFailure> {
    let reference = binding;
    let binding = DynamicWasmAliases::declared_binding(binding, source).unwrap_or(binding);
    if !matches!(
        binding.kind(),
        "identifier" | "member_expression" | "subscript_expression"
    ) {
        return Err(AliasResolutionFailure::UnsupportedBinding);
    }
    if let Ok(wasm_type) = DynamicWasmAliases::value_is_wasm_instance(value, source, source_path, wasm_types, wasm_class_bindings, wasm_namespace_bindings, scoped_wasm_namespaces, wasm_type_names, wasm_instance_factories, scoped_wasm_factories, scoped_wasm_runtime_receivers, wasm_instance_bindings, scoped_wasm_instances) {
        let mut scoped = ScopedBinding::scoped_binding(binding, source, BindingProvenance::Class(wasm_type)).map_err(AliasResolutionFailure::Scope)?;
        if let Invocation::CompletesAt(invocation_end) = ScopedBinding::deferred_invocation_end(reference, &scoped, source) {
            scoped.declaration_end = invocation_end;
        }
        return Ok(scoped);
    }
    Err(AliasResolutionFailure::UnresolvedBinding)
}
}

impl DynamicWasmAliases<'_> {
    pub(super) fn declared_binding<'a>(
        reference: tree_sitter::Node<'a>,
        source: &str,
    ) -> Result<tree_sitter::Node<'a>, AliasResolutionFailure> {
        if reference.kind() != "identifier" {
            return Err(AliasResolutionFailure::UnsupportedBinding);
        }
        let name = (JavaScriptLiteral {
            node: reference,
            source: source,
        })
        .semantic_javascript_name()
        .map_err(AliasResolutionFailure::Literal)?;
        let mut root = reference;
        while let Some(parent) = root.parent() {
            root = parent;
        }
        DynamicWasmAliases::find_declared_binding(root, reference, &name, source)
    }
}

impl DynamicWasmAliases<'_> {
    pub(super) fn find_declared_binding<'a>(
        node: tree_sitter::Node<'a>,
        reference: tree_sitter::Node<'_>,
        name: &str,
        source: &str,
    ) -> Result<tree_sitter::Node<'a>, AliasResolutionFailure> {
        if node.kind() == "variable_declarator"
            && let Some(binding) = node.child_by_field_name("name")
            && (JavaScriptLiteral {
                node: binding,
                source: source,
            })
            .semantic_javascript_name()
            .ok()
            .as_deref()
                == Some(name)
            && let Ok(scoped) =
                ScopedBinding::scoped_binding(binding, source, BindingProvenance::Callable)
            && ScopedBinding::deferred_assignment_executes(reference, &scoped, source)
            && ScopedBinding::scoped_binding_is_visible(reference, name, source, &[scoped])
        {
            return Ok(binding);
        }
        let mut cursor = node.walk();
        node.named_children(&mut cursor)
            .find_map(|child| {
                DynamicWasmAliases::find_declared_binding(child, reference, name, source).ok()
            })
            .ok_or(AliasResolutionFailure::UnresolvedBinding)
    }
}

#[allow(clippy::too_many_arguments)]
#[rustfmt::skip]
impl DynamicWasmAliases<'_> {
pub(super) fn value_is_wasm_instance(value: tree_sitter::Node<'_>, source: &str, source_path: &Path, wasm_types: &WasmTypeInventory, wasm_class_bindings: &HashMap<String, String>, wasm_namespace_bindings: &HashMap<String, String>, scoped_wasm_namespaces: &[ScopedBinding], wasm_type_names: &HashSet<String>, wasm_instance_factories: &HashMap<String, String>, scoped_wasm_factories: &[ScopedBinding], scoped_wasm_runtime_receivers: &[ScopedBinding], wasm_instance_bindings: &HashMap<String, String>, scoped_wasm_instances: &[ScopedBinding]) -> Result<String, AliasResolutionFailure> {
    let value = DynamicWasmAliases::unwrap_transparent_expression(value);
    if value.kind() == "identifier"
        && let Ok(name) = value.utf8_text(source.as_bytes())
    {
        if let Ok(wasm_type) =
            DynamicWasmAliases::scoped_wasm_type_visible(value, name, source, scoped_wasm_instances)
        {
            return Ok(wasm_type);
        }
        if ScopedBinding::root_binding_is_visible(value, name, source)
            && let Some(wasm_type) = wasm_instance_bindings.get(name)
        {
            return Ok(wasm_type.clone());
        }
    }
    if value.kind() == "new_expression"
        && let Some(constructor) = value.child_by_field_name("constructor")
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
    if value.kind() == "call_expression"
        && let Some(function) = value.child_by_field_name("function")
        && let Ok(name) = (JavaScriptLiteral { node: function, source: source }).callable_expression_name()
    {
        if matches!(
            function.kind(),
            "member_expression" | "subscript_expression"
        ) && let Some(object) = function.child_by_field_name("object")
            && DynamicWasmAliases::wasm_module_specifier(object, source, source_path, wasm_namespace_bindings, scoped_wasm_namespaces).is_ok_and(|module| WasmModuleSources::is_wasm_callable_export(&module, &name, source_path))
            && let Some(wasm_type) = wasm_types.free_returns.get(&name)
        {
            return Ok(wasm_type.clone());
        }
        if DynamicWasmAliases::callable_binding_is_visible(function, source)
            && let Ok(full_name) = function.utf8_text(source.as_bytes())
            && let Some(wasm_type) = wasm_instance_factories.get(full_name)
        {
            return Ok(wasm_type.clone());
        }
        if name == WASM_MANAGER_ACCESSOR
            && DynamicWasmAliases::wasm_runtime_accessor_receiver_is_visible(
                function,
                source,
                scoped_wasm_runtime_receivers,
            )
        {
            return Ok("NookVaultManager".to_owned());
        }
        if let Ok(wasm_type) =
            DynamicWasmAliases::scoped_wasm_type_visible(function, &name, source, scoped_wasm_factories)
        {
            return Ok(wasm_type);
        }
        if ScopedBinding::root_binding_is_visible(function, &name, source)
            && let Some(wasm_type) = wasm_instance_factories.get(&name)
        {
            return Ok(wasm_type.clone());
        }
    }
    if value.kind() == "await_expression" {
        let mut cursor = value.walk();
        return value.named_children(&mut cursor).find_map(|child| DynamicWasmAliases::value_is_wasm_instance(child, source, source_path, wasm_types, wasm_class_bindings, wasm_namespace_bindings, scoped_wasm_namespaces, wasm_type_names, wasm_instance_factories, scoped_wasm_factories, scoped_wasm_runtime_receivers, wasm_instance_bindings, scoped_wasm_instances).ok()).ok_or(AliasResolutionFailure::UnknownInstance);
    }
    Err(AliasResolutionFailure::UnknownInstance)
}
}

impl DynamicWasmAliases<'_> {
    pub(crate) fn constructor_wasm_class(
        constructor: tree_sitter::Node<'_>,
        source: &str,
        wasm_class_bindings: &HashMap<String, String>,
        wasm_namespace_bindings: &HashMap<String, String>,
        scoped_wasm_namespaces: &[ScopedBinding],
        wasm_type_names: &HashSet<String>,
    ) -> Result<String, AliasResolutionFailure> {
        if constructor.kind() == "identifier" {
            let name = constructor
                .utf8_text(source.as_bytes())
                .map_err(|_| AliasResolutionFailure::InvalidSource)?;
            if ScopedBinding::root_binding_is_visible(constructor, name, source)
                && let Some(wasm_type) = wasm_class_bindings.get(name)
            {
                return Ok(wasm_type.clone());
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
            return Err(AliasResolutionFailure::UnsupportedConstructor);
        }
        let namespace = constructor
            .child_by_field_name("object")
            .ok_or(AliasResolutionFailure::MissingMember)?;
        let class_name = constructor
            .child_by_field_name("property")
            .and_then(|property| {
                (JavaScriptLiteral {
                    node: property,
                    source: source,
                })
                .semantic_javascript_name()
                .ok()
            })
            .ok_or(AliasResolutionFailure::MissingMember)?;
        let namespace_name = namespace
            .utf8_text(source.as_bytes())
            .map_err(|_| AliasResolutionFailure::InvalidSource)?;
        let namespace_is_wasm = (wasm_namespace_bindings.contains_key(namespace_name)
            && ScopedBinding::root_binding_is_visible(namespace, namespace_name, source))
            || DynamicWasmAliases::scoped_wasm_module_visible(
                namespace,
                namespace_name,
                source,
                scoped_wasm_namespaces,
            )
            .is_ok();
        (namespace_is_wasm && wasm_type_names.contains(&class_name))
            .then_some(class_name)
            .ok_or(AliasResolutionFailure::UnknownClass)
    }
}

#[allow(clippy::too_many_arguments)]
#[rustfmt::skip]
impl DynamicWasmAliases<'_> {
pub(super) fn copied_wasm_class(node: tree_sitter::Node<'_>, reference: tree_sitter::Node<'_>, name: &str, source: &str, classes: &HashMap<String, String>, namespaces: &HashMap<String, String>, scoped_namespaces: &[ScopedBinding], wasm_type_names: &HashSet<String>) -> Result<String, AliasResolutionFailure> {
    if node.kind() == "variable_declarator"
        && let (Some(pattern), Some(namespace)) = (node.child_by_field_name("name"), node.child_by_field_name("value"))
        && pattern.kind() == "object_pattern"
        && let Ok(namespace_name) = (JavaScriptLiteral { node: namespace, source: source }).semantic_javascript_name()
        && ((namespaces.contains_key(&namespace_name) && ScopedBinding::root_binding_is_visible(namespace, &namespace_name, source)) || DynamicWasmAliases::scoped_wasm_module_visible(namespace, &namespace_name, source, scoped_namespaces).is_ok())
    {
        let mut cursor = pattern.walk();
        if let Some(wasm_type) = pattern.named_children(&mut cursor).find_map(|pair| {
            let key = pair.child_by_field_name("key").and_then(|key| (JavaScriptLiteral { node: key, source: source }).semantic_javascript_name().ok())?;
            let alias = pair.child_by_field_name("value").and_then(|value| (JavaScriptLiteral { node: value, source: source }).semantic_javascript_name().ok())?;
            (alias == name && wasm_type_names.contains(&key)).then_some(key)
        }) {
            return Ok(wasm_type);
        }
    }
    if matches!(node.kind(), "variable_declarator" | "assignment_expression")
        && let (Some(binding), Some(value)) = (
            node.child_by_field_name("name")
                .or_else(|| node.child_by_field_name("left")),
            node.child_by_field_name("value")
                .or_else(|| node.child_by_field_name("right")),
        )
        && (JavaScriptLiteral { node: binding, source: source }).semantic_javascript_name().ok().as_deref() == Some(name)
        && let Ok(source_name) = (JavaScriptLiteral { node: value, source: source }).semantic_javascript_name()
        && ScopedBinding::root_binding_is_visible(value, &source_name, source)
        && let Some(wasm_type) = classes.get(&source_name)
        && let Ok(mut scoped) = ScopedBinding::scoped_binding(binding, source, BindingProvenance::Class(wasm_type.clone()))
        && {
            scoped.declaration_end = node.end_byte();
            true
        }
        && ScopedBinding::scoped_binding_is_visible(reference, name, source, &[scoped])
    {
        return Ok(wasm_type.clone());
    }
    let mut cursor = node.walk();
    node.named_children(&mut cursor).find_map(|child| DynamicWasmAliases::copied_wasm_class(child, reference, name, source, classes, namespaces, scoped_namespaces, wasm_type_names).ok()).ok_or(AliasResolutionFailure::UnknownClass)
}
}

impl DynamicWasmAliases<'_> {
    pub(crate) fn wasm_module_specifier(
        value: tree_sitter::Node<'_>,
        source: &str,
        source_path: &Path,
        wasm_namespace_bindings: &HashMap<String, String>,
        scoped_wasm_namespaces: &[ScopedBinding],
    ) -> Result<String, AliasResolutionFailure> {
        if let Ok(module) = DynamicWasmAliases::loaded_module_specifier(value, source)
            && (WasmModuleSources {
                module: &module,
                source_path,
            })
            .is_wasm_callable_source()
        {
            return Ok(module);
        }
        let name = value
            .utf8_text(source.as_bytes())
            .map_err(|_| AliasResolutionFailure::InvalidSource)?;
        if ScopedBinding::root_binding_is_visible(value, name, source)
            && let Some(module) = wasm_namespace_bindings.get(name)
        {
            return Ok(module.clone());
        }
        DynamicWasmAliases::scoped_wasm_module_visible(value, name, source, scoped_wasm_namespaces)
    }
}

impl DynamicWasmAliases<'_> {
    pub(crate) fn loaded_module_specifier(
        node: tree_sitter::Node<'_>,
        source: &str,
    ) -> Result<String, AliasResolutionFailure> {
        if node.kind() == "call_expression"
            && let Some(function) = node.child_by_field_name("function")
            && (function.kind() == "import"
                || (function
                    .utf8_text(source.as_bytes())
                    .is_ok_and(|name| name == "require")
                    && ScopedBinding::root_binding_is_visible(function, "require", source)))
        {
            let arguments = node
                .child_by_field_name("arguments")
                .ok_or(AliasResolutionFailure::MissingModuleArgument)?;
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
                    .ok()
                })
                .ok_or(AliasResolutionFailure::MissingModuleArgument);
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
                .find_map(|child| DynamicWasmAliases::loaded_module_specifier(child, source).ok())
                .ok_or(AliasResolutionFailure::NotModuleLoad);
        }

        Err(AliasResolutionFailure::NotModuleLoad)
    }
}

impl DynamicWasmAliases<'_> {
    pub(crate) fn scoped_wasm_type_visible(
        reference: tree_sitter::Node<'_>,
        name: &str,
        source: &str,
        bindings: &[ScopedBinding],
    ) -> Result<String, AliasResolutionFailure> {
        match ScopedBinding::visible_scoped_binding(reference, name, source, bindings) {
            VisibleBinding::Visible(binding) => match &binding.provenance {
                BindingProvenance::Class(name) => Ok(name.clone()),
                _ => Err(AliasResolutionFailure::WrongBindingProvenance),
            },
            VisibleBinding::OutsideScope => Err(AliasResolutionFailure::UnresolvedBinding),
        }
    }
}

impl DynamicWasmAliases<'_> {
    pub(crate) fn scoped_wasm_module_visible(
        reference: tree_sitter::Node<'_>,
        name: &str,
        source: &str,
        bindings: &[ScopedBinding],
    ) -> Result<String, AliasResolutionFailure> {
        match ScopedBinding::visible_scoped_binding(reference, name, source, bindings) {
            VisibleBinding::Visible(binding) => match &binding.provenance {
                BindingProvenance::Module(module) => Ok(module.clone()),
                _ => Err(AliasResolutionFailure::WrongBindingProvenance),
            },
            VisibleBinding::OutsideScope => Err(AliasResolutionFailure::UnresolvedBinding),
        }
    }
}
