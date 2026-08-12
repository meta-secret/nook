pub(super) struct ScopedBinding {
    pub(super) name: String,
    pub(super) scope_start: usize,
    pub(super) scope_end: usize,
    pub(super) declaration_end: usize,
    pub(super) wasm_type: Option<String>,
    pub(super) wasm_module: Option<String>,
}

pub(super) fn scoped_binding(
    binding: tree_sitter::Node<'_>,
    source: &str,
    wasm_type: Option<String>,
    wasm_module: Option<String>,
) -> Option<ScopedBinding> {
    let name = binding.utf8_text(source.as_bytes()).ok()?.to_owned();
    let mut ancestor = binding.parent();
    while let Some(node) = ancestor {
        if matches!(
            node.kind(),
            "function_declaration"
                | "function_expression"
                | "generator_function_declaration"
                | "generator_function"
                | "arrow_function"
                | "method_definition"
        ) {
            let body = node.child_by_field_name("body")?;
            return Some(ScopedBinding {
                name,
                scope_start: body.start_byte(),
                scope_end: body.end_byte(),
                declaration_end: body.start_byte(),
                wasm_type,
                wasm_module,
            });
        }
        if matches!(node.kind(), "statement_block" | "switch_body" | "program") {
            break;
        }
        ancestor = node.parent();
    }
    let is_var = binding_is_var(binding, source);
    let mut ancestor = binding.parent();
    let scope = loop {
        let candidate = ancestor?;
        let function_body = candidate.kind() == "statement_block"
            && candidate.parent().is_some_and(|parent| {
                matches!(
                    parent.kind(),
                    "function_declaration"
                        | "function_expression"
                        | "generator_function"
                        | "arrow_function"
                )
            });
        if candidate.kind() == "program"
            || (matches!(candidate.kind(), "statement_block" | "switch_body")
                && (!is_var || function_body))
        {
            break candidate;
        }
        ancestor = candidate.parent();
    };
    Some(ScopedBinding {
        name,
        scope_start: scope.start_byte(),
        scope_end: scope.end_byte(),
        declaration_end: binding.parent()?.parent()?.end_byte(),
        wasm_type,
        wasm_module,
    })
}

fn binding_is_var(binding: tree_sitter::Node<'_>, source: &str) -> bool {
    let mut ancestor = binding.parent();
    while let Some(node) = ancestor {
        if matches!(node.kind(), "variable_declaration" | "lexical_declaration") {
            return node
                .utf8_text(source.as_bytes())
                .is_ok_and(|text| text.trim_start().starts_with("var "));
        }
        ancestor = node.parent();
    }
    false
}

pub(super) fn visible_scoped_binding<'a>(
    reference: tree_sitter::Node<'_>,
    name: &str,
    source: &str,
    bindings: &'a [ScopedBinding],
) -> Option<&'a ScopedBinding> {
    bindings.iter().find(|binding| {
        binding.name == name
            && (binding.declaration_end <= reference.start_byte()
                || reference_may_capture_later_binding(reference, binding))
            && binding.scope_start <= reference.start_byte()
            && reference.end_byte() <= binding.scope_end
            && !nested_scope_shadows(reference, binding, name, source)
    })
}

fn reference_may_capture_later_binding(
    reference: tree_sitter::Node<'_>,
    binding: &ScopedBinding,
) -> bool {
    let mut ancestor = reference.parent();
    while let Some(node) = ancestor {
        if node.start_byte() == binding.scope_start && node.end_byte() == binding.scope_end {
            return false;
        }
        if matches!(
            node.kind(),
            "function_declaration"
                | "function_expression"
                | "generator_function_declaration"
                | "generator_function"
                | "arrow_function"
                | "method_definition"
        ) {
            return true;
        }
        ancestor = node.parent();
    }
    false
}

pub(super) fn scoped_binding_is_visible(
    reference: tree_sitter::Node<'_>,
    name: &str,
    source: &str,
    bindings: &[ScopedBinding],
) -> bool {
    visible_scoped_binding(reference, name, source, bindings).is_some()
}

pub(super) fn invalidate_visible_scoped_binding(
    reference: tree_sitter::Node<'_>,
    name: &str,
    source: &str,
    bindings: &mut [ScopedBinding],
) -> bool {
    if let Some(binding) = bindings.iter_mut().find(|binding| {
        binding.name == name
            && binding.declaration_end <= reference.start_byte()
            && binding.scope_start <= reference.start_byte()
            && reference.end_byte() <= binding.scope_end
            && !nested_scope_shadows(reference, binding, name, source)
    }) && reassignment_is_unconditional(reference, binding)
    {
        binding.scope_end = reference.start_byte();
        return true;
    }
    false
}

fn reassignment_is_unconditional(
    reference: tree_sitter::Node<'_>,
    binding: &ScopedBinding,
) -> bool {
    let mut ancestor = reference.parent();
    while let Some(node) = ancestor {
        if node.start_byte() == binding.scope_start && node.end_byte() == binding.scope_end {
            return true;
        }
        if matches!(
            node.kind(),
            "if_statement"
                | "switch_statement"
                | "ternary_expression"
                | "for_statement"
                | "for_in_statement"
                | "while_statement"
                | "do_statement"
                | "try_statement"
                | "catch_clause"
                | "function_declaration"
                | "function_expression"
                | "generator_function_declaration"
                | "generator_function"
                | "arrow_function"
                | "method_definition"
        ) {
            return false;
        }
        ancestor = node.parent();
    }
    false
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
            || function_declares_var(scope, name, source)
            || catch_parameter_declares(scope, name, source)
            || loop_header_declares(scope, name, source)
        {
            return true;
        }
        ancestor = scope.parent();
    }
    true
}

pub(super) fn root_binding_is_visible(
    reference: tree_sitter::Node<'_>,
    name: &str,
    source: &str,
) -> bool {
    let mut ancestor = reference.parent();
    while let Some(scope) = ancestor {
        if function_parameters_declare(scope, name, source)
            || block_declares_name(scope, name, source)
            || function_declares_var(scope, name, source)
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
            | "class"
    ) {
        return false;
    }
    if matches!(
        scope.kind(),
        "function_expression" | "generator_function" | "class"
    ) && scope
        .child_by_field_name("name")
        .is_some_and(|binding| binding_matches(binding, name, source))
    {
        return true;
    }
    scope
        .child_by_field_name("parameters")
        .is_some_and(|parameters| binding_container_declares(parameters, name, source))
}

fn block_declares_name(scope: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
    if !matches!(scope.kind(), "statement_block" | "switch_body") {
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
            "switch_case" | "switch_default" => {
                let mut cursor = statement.walk();
                statement.named_children(&mut cursor).any(|child| {
                    matches!(child.kind(), "lexical_declaration" | "variable_declaration")
                        && declaration_declares(child, name, source)
                })
            }
            _ => false,
        })
}

fn function_declares_var(scope: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
    if !matches!(
        scope.kind(),
        "function_declaration"
            | "function_expression"
            | "generator_function_declaration"
            | "generator_function"
            | "arrow_function"
            | "method_definition"
    ) {
        return false;
    }
    scope
        .child_by_field_name("body")
        .is_some_and(|body| subtree_declares_var(body, name, source))
}

fn subtree_declares_var(node: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
    if node.kind() == "variable_declaration"
        && node
            .utf8_text(source.as_bytes())
            .is_ok_and(|text| text.trim_start().starts_with("var "))
    {
        return declaration_declares(node, name, source);
    }
    if matches!(
        node.kind(),
        "function_declaration"
            | "function_expression"
            | "generator_function_declaration"
            | "generator_function"
            | "arrow_function"
            | "class_declaration"
    ) {
        return false;
    }
    let mut cursor = node.walk();
    node.named_children(&mut cursor)
        .any(|child| subtree_declares_var(child, name, source))
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
    if pattern.kind() == "pair_pattern" {
        return pattern
            .child_by_field_name("value")
            .is_some_and(|value| binding_pattern_declares(value, name, source));
    }
    if pattern.kind() == "object_assignment_pattern" {
        return pattern
            .child_by_field_name("left")
            .is_some_and(|left| binding_pattern_declares(left, name, source));
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

pub(super) fn declaration_is_in_program_scope(binding: tree_sitter::Node<'_>) -> bool {
    binding
        .parent()
        .and_then(|declarator| declarator.parent())
        .and_then(|declaration| declaration.parent())
        .is_some_and(|scope| scope.kind() == "program")
}

pub(super) fn deferred_assignment_executes(
    reference: tree_sitter::Node<'_>,
    binding: &ScopedBinding,
    source: &str,
) -> bool {
    deferred_function(reference, binding, source)
        .is_none_or(|function| deferred_function_call_end(function, source).is_some())
}

pub(super) fn deferred_invocation_end(
    reference: tree_sitter::Node<'_>,
    binding: &ScopedBinding,
    source: &str,
) -> Option<usize> {
    deferred_function(reference, binding, source)
        .and_then(|function| deferred_function_call_end(function, source))
}

fn deferred_function<'a>(
    reference: tree_sitter::Node<'a>,
    binding: &ScopedBinding,
    source: &str,
) -> Option<tree_sitter::Node<'a>> {
    let mut ancestor = reference.parent();
    while let Some(function) = ancestor {
        if matches!(
            function.kind(),
            "function_declaration" | "function_expression" | "arrow_function"
        ) && binding.scope_start < function.start_byte()
            && function
                .child_by_field_name("name")
                .and_then(|node| semantic_javascript_name(node, source))
                .is_some()
        {
            return Some(function);
        }
        ancestor = function.parent();
    }
    None
}

fn deferred_function_call_end(function: tree_sitter::Node<'_>, source: &str) -> Option<usize> {
    let name = function
        .child_by_field_name("name")
        .and_then(|node| semantic_javascript_name(node, source))?;
    let mut root = function;
    while let Some(parent) = root.parent() {
        root = parent;
    }
    function_call_after(root, &name, function.end_byte(), source)
}

fn function_call_after(
    node: tree_sitter::Node<'_>,
    name: &str,
    after: usize,
    source: &str,
) -> Option<usize> {
    if node.kind() == "call_expression"
        && node.start_byte() >= after
        && node
            .child_by_field_name("function")
            .and_then(|callee| semantic_javascript_name(callee, source))
            .as_deref()
            == Some(name)
    {
        return Some(node.end_byte());
    }
    let mut cursor = node.walk();
    node.named_children(&mut cursor)
        .filter_map(|child| function_call_after(child, name, after, source))
        .min()
}
use crate::javascript_literals::semantic_javascript_name;
