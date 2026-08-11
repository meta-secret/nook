pub(super) struct ScopedBinding {
    pub(super) name: String,
    pub(super) scope_start: usize,
    pub(super) scope_end: usize,
    pub(super) declaration_end: usize,
    pub(super) wasm_type: Option<String>,
    pub(super) wasm_module: Option<String>,
}

pub(super) fn visible_scoped_binding<'a>(
    reference: tree_sitter::Node<'_>,
    name: &str,
    source: &str,
    bindings: &'a [ScopedBinding],
) -> Option<&'a ScopedBinding> {
    bindings.iter().find(|binding| {
        binding.name == name
            && binding.declaration_end <= reference.start_byte()
            && binding.scope_start <= reference.start_byte()
            && reference.end_byte() <= binding.scope_end
            && !nested_scope_shadows(reference, binding, name, source)
    })
}

pub(super) fn scoped_binding_is_visible(
    reference: tree_sitter::Node<'_>,
    name: &str,
    source: &str,
    bindings: &[ScopedBinding],
) -> bool {
    visible_scoped_binding(reference, name, source, bindings).is_some()
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

pub(super) fn root_binding_is_visible(
    reference: tree_sitter::Node<'_>,
    name: &str,
    source: &str,
) -> bool {
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

pub(super) fn declaration_is_in_program_scope(binding: tree_sitter::Node<'_>) -> bool {
    binding
        .parent()
        .and_then(|declarator| declarator.parent())
        .and_then(|declaration| declaration.parent())
        .is_some_and(|scope| scope.kind() == "program")
}
