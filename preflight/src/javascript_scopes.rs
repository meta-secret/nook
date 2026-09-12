pub(super) struct ScopedBinding {
    pub(super) name: String,
    pub(super) scope_start: usize,
    pub(super) scope_end: usize,
    pub(super) declaration_end: usize,
    pub(super) provenance: BindingProvenance,
}

impl ScopedBinding {
    pub(super) fn from_declaration(
        binding: tree_sitter::Node<'_>,
        source: &str,
        provenance: BindingProvenance,
    ) -> Result<ScopedBinding, ScopeAdmissionFailure> {
        let name = binding
            .utf8_text(source.as_bytes())
            .map_err(|_| ScopeAdmissionFailure::InvalidSource)?
            .to_owned();
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
                let body = node
                    .child_by_field_name("body")
                    .ok_or(ScopeAdmissionFailure::MissingFunctionBody)?;
                return Ok(ScopedBinding {
                    name,
                    scope_start: body.start_byte(),
                    scope_end: body.end_byte(),
                    declaration_end: body.start_byte(),
                    provenance,
                });
            }
            if matches!(node.kind(), "statement_block" | "switch_body" | "program") {
                break;
            }
            ancestor = node.parent();
        }
        let is_var = ScopedBinding::binding_is_var(binding, source);
        let mut ancestor = binding.parent();
        let scope = loop {
            let candidate = ancestor.ok_or(ScopeAdmissionFailure::NoEnclosingScope)?;
            let function_body = candidate.kind() == "statement_block"
                && candidate.parent().is_some_and(|parent| {
                    matches!(
                        parent.kind(),
                        "function_declaration"
                            | "function_expression"
                            | "generator_function_declaration"
                            | "generator_function"
                            | "arrow_function"
                            | "method_definition"
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
        Ok(ScopedBinding {
            name,
            scope_start: scope.start_byte(),
            scope_end: scope.end_byte(),
            declaration_end: binding
                .parent()
                .and_then(|parent| parent.parent())
                .ok_or(ScopeAdmissionFailure::MissingDeclaration)?
                .end_byte(),
            provenance,
        })
    }
}

impl ScopedBinding {
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
}

impl ScopedBinding {
    pub(super) fn visible_scoped_binding<'a>(
        reference: tree_sitter::Node<'_>,
        name: &str,
        source: &str,
        bindings: &'a [ScopedBinding],
    ) -> VisibleBinding<'a> {
        match bindings.iter().find(|binding| {
            binding.name == name
                && (binding.declaration_end <= reference.start_byte()
                    || ScopedBinding::reference_may_capture_later_binding(reference, binding))
                && binding.scope_start <= reference.start_byte()
                && reference.end_byte() <= binding.scope_end
                && !ScopedBinding::nested_scope_shadows(reference, binding, name, source)
        }) {
            Some(binding) => VisibleBinding::Visible(binding),
            None => VisibleBinding::OutsideScope,
        }
    }
}

impl ScopedBinding {
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
}

impl ScopedBinding {
    pub(super) fn scoped_binding_is_visible(
        reference: tree_sitter::Node<'_>,
        name: &str,
        source: &str,
        bindings: &[ScopedBinding],
    ) -> bool {
        matches!(
            ScopedBinding::visible_scoped_binding(reference, name, source, bindings),
            VisibleBinding::Visible(_)
        )
    }
}

impl ScopedBinding {
    pub(super) fn invalidate_visible_scoped_binding(
        reference: tree_sitter::Node<'_>,
        name: &str,
        source: &str,
        mut bindings: Vec<ScopedBinding>,
    ) -> (Vec<ScopedBinding>, BindingInvalidation) {
        if let Some(binding) = bindings.iter_mut().find(|binding| {
            binding.name == name
                && binding.declaration_end <= reference.start_byte()
                && binding.scope_start <= reference.start_byte()
                && reference.end_byte() <= binding.scope_end
                && !ScopedBinding::nested_scope_shadows(reference, binding, name, source)
        }) && ScopedBinding::reassignment_is_unconditional(reference, binding)
        {
            binding.scope_end = reference.start_byte();
            return (bindings, BindingInvalidation::Invalidated);
        }
        (bindings, BindingInvalidation::Retained)
    }
}

impl ScopedBinding {
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
}

impl ScopedBinding {
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
            if ScopedBinding::function_parameters_declare(scope, name, source)
                || ScopedBinding::block_declares_name(scope, name, source)
                || ScopedBinding::function_declares_var(scope, name, source)
                || ScopedBinding::catch_parameter_declares(scope, name, source)
                || ScopedBinding::loop_header_declares(scope, name, source)
            {
                return true;
            }
            ancestor = scope.parent();
        }
        true
    }
}

impl ScopedBinding {
    pub(super) fn root_binding_is_visible(
        reference: tree_sitter::Node<'_>,
        name: &str,
        source: &str,
    ) -> bool {
        let mut ancestor = reference.parent();
        while let Some(scope) = ancestor {
            if ScopedBinding::function_parameters_declare(scope, name, source)
                || ScopedBinding::block_declares_name(scope, name, source)
                || ScopedBinding::function_declares_var(scope, name, source)
                || ScopedBinding::catch_parameter_declares(scope, name, source)
                || ScopedBinding::loop_header_declares(scope, name, source)
            {
                return false;
            }
            ancestor = scope.parent();
        }
        true
    }
}

impl ScopedBinding {
    fn loop_header_declares(scope: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
        let binding = match scope.kind() {
            "for_statement" => scope.child_by_field_name("initializer"),
            "for_in_statement" => scope.child_by_field_name("left"),
            _ => None,
        };
        binding.is_some_and(|binding| match binding.kind() {
            "lexical_declaration" | "variable_declaration" => {
                ScopedBinding::declaration_declares(binding, name, source)
            }
            _ => ScopedBinding::binding_pattern_declares(binding, name, source),
        })
    }
}

impl ScopedBinding {
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
            .is_some_and(|binding| ScopedBinding::binding_matches(binding, name, source))
        {
            return true;
        }
        scope
            .child_by_field_name("parameters")
            .is_some_and(|parameters| {
                ScopedBinding::binding_container_declares(parameters, name, source)
            })
    }
}

impl ScopedBinding {
    fn block_declares_name(scope: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
        if !matches!(scope.kind(), "statement_block" | "switch_body") {
            return false;
        }
        let mut cursor = scope.walk();
        scope
            .named_children(&mut cursor)
            .any(|statement| match statement.kind() {
                "lexical_declaration" | "variable_declaration" => {
                    ScopedBinding::declaration_declares(statement, name, source)
                }
                "function_declaration" | "generator_function_declaration" | "class_declaration" => {
                    statement
                        .child_by_field_name("name")
                        .is_some_and(|binding| {
                            ScopedBinding::binding_matches(binding, name, source)
                        })
                }
                "switch_case" | "switch_default" => {
                    let mut cursor = statement.walk();
                    statement.named_children(&mut cursor).any(|child| {
                        matches!(child.kind(), "lexical_declaration" | "variable_declaration")
                            && ScopedBinding::declaration_declares(child, name, source)
                    })
                }
                _ => false,
            })
    }
}

impl ScopedBinding {
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
            .is_some_and(|body| ScopedBinding::subtree_declares_var(body, name, source))
    }
}

impl ScopedBinding {
    fn subtree_declares_var(node: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
        if node.kind() == "variable_declaration"
            && node
                .utf8_text(source.as_bytes())
                .is_ok_and(|text| text.trim_start().starts_with("var "))
        {
            return ScopedBinding::declaration_declares(node, name, source);
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
            .any(|child| ScopedBinding::subtree_declares_var(child, name, source))
    }
}

impl ScopedBinding {
    fn catch_parameter_declares(scope: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
        scope.kind() == "catch_clause"
            && scope
                .child_by_field_name("parameter")
                .is_some_and(|parameter| {
                    ScopedBinding::binding_pattern_declares(parameter, name, source)
                })
    }
}

impl ScopedBinding {
    fn binding_container_declares(
        container: tree_sitter::Node<'_>,
        name: &str,
        source: &str,
    ) -> bool {
        let mut cursor = container.walk();
        container.named_children(&mut cursor).any(|parameter| {
            if matches!(
                parameter.kind(),
                "required_parameter" | "optional_parameter"
            ) {
                parameter
                    .child_by_field_name("pattern")
                    .is_some_and(|pattern| {
                        ScopedBinding::binding_pattern_declares(pattern, name, source)
                    })
            } else {
                ScopedBinding::binding_pattern_declares(parameter, name, source)
            }
        })
    }
}

impl ScopedBinding {
    fn declaration_declares(declaration: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
        let mut cursor = declaration.walk();
        declaration.named_children(&mut cursor).any(|declarator| {
            declarator.kind() == "variable_declarator"
                && declarator
                    .child_by_field_name("name")
                    .is_some_and(|binding| {
                        ScopedBinding::binding_pattern_declares(binding, name, source)
                    })
        })
    }
}

impl ScopedBinding {
    fn binding_pattern_declares(pattern: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
        if matches!(
            pattern.kind(),
            "identifier" | "shorthand_property_identifier_pattern"
        ) {
            return ScopedBinding::binding_matches(pattern, name, source);
        }
        if pattern.kind() == "type_annotation" {
            return false;
        }
        if pattern.kind() == "pair_pattern" {
            return pattern
                .child_by_field_name("value")
                .is_some_and(|value| ScopedBinding::binding_pattern_declares(value, name, source));
        }
        if pattern.kind() == "object_assignment_pattern" {
            return pattern
                .child_by_field_name("left")
                .is_some_and(|left| ScopedBinding::binding_pattern_declares(left, name, source));
        }
        let mut cursor = pattern.walk();
        pattern
            .named_children(&mut cursor)
            .any(|child| ScopedBinding::binding_pattern_declares(child, name, source))
    }
}

impl ScopedBinding {
    fn binding_matches(binding: tree_sitter::Node<'_>, name: &str, source: &str) -> bool {
        binding
            .utf8_text(source.as_bytes())
            .is_ok_and(|binding_name| binding_name == name)
    }
}

impl ScopedBinding {
    pub(super) fn declaration_is_in_program_scope(binding: tree_sitter::Node<'_>) -> bool {
        binding
            .parent()
            .and_then(|declarator| declarator.parent())
            .and_then(|declaration| declaration.parent())
            .is_some_and(|scope| scope.kind() == "program")
    }
}

impl ScopedBinding {
    pub(super) fn deferred_assignment_executes(
        reference: tree_sitter::Node<'_>,
        binding: &ScopedBinding,
        source: &str,
    ) -> bool {
        match ScopedBinding::deferred_function(reference, binding, source) {
            DeferredContext::Immediate => true,
            DeferredContext::Function(function) => matches!(
                ScopedBinding::deferred_function_call_end(function, source),
                Invocation::CompletesAt(_)
            ),
        }
    }
}

impl ScopedBinding {
    pub(super) fn deferred_invocation_end(
        reference: tree_sitter::Node<'_>,
        binding: &ScopedBinding,
        source: &str,
    ) -> Invocation {
        match ScopedBinding::deferred_function(reference, binding, source) {
            DeferredContext::Immediate => Invocation::NotObserved,
            DeferredContext::Function(function) => {
                ScopedBinding::deferred_function_call_end(function, source)
            }
        }
    }
}

impl ScopedBinding {
    fn deferred_function<'a>(
        reference: tree_sitter::Node<'a>,
        binding: &ScopedBinding,
        source: &str,
    ) -> DeferredContext<'a> {
        let mut ancestor = reference.parent();
        while let Some(function) = ancestor {
            if matches!(
                function.kind(),
                "function_declaration" | "function_expression" | "arrow_function"
            ) && binding.scope_start < function.start_byte()
                && function
                    .child_by_field_name("name")
                    .and_then(|node| {
                        (JavaScriptLiteral { node, source })
                            .semantic_javascript_name()
                            .ok()
                    })
                    .is_some()
            {
                return DeferredContext::Function(function);
            }
            ancestor = function.parent();
        }
        DeferredContext::Immediate
    }
}

impl ScopedBinding {
    fn deferred_function_call_end(function: tree_sitter::Node<'_>, source: &str) -> Invocation {
        let Some(name) = function.child_by_field_name("name").and_then(|node| {
            (JavaScriptLiteral { node, source })
                .semantic_javascript_name()
                .ok()
        }) else {
            return Invocation::NotObserved;
        };
        let mut root = function;
        while let Some(parent) = root.parent() {
            root = parent;
        }
        ScopedBinding::function_call_after(root, &name, function.end_byte(), source)
    }
}

impl ScopedBinding {
    fn function_call_after(
        node: tree_sitter::Node<'_>,
        name: &str,
        after: usize,
        source: &str,
    ) -> Invocation {
        if node.kind() == "call_expression"
            && node.start_byte() >= after
            && let Some(callee) = node.child_by_field_name("function")
            && (JavaScriptLiteral {
                node: callee,
                source,
            })
            .semantic_javascript_name()
            .ok()
            .as_deref()
                == Some(name)
            && ScopedBinding::root_binding_is_visible(callee, name, source)
        {
            return Invocation::CompletesAt(node.end_byte());
        }
        let mut cursor = node.walk();
        let mut earliest = Invocation::NotObserved;
        for child in node.named_children(&mut cursor) {
            if let Invocation::CompletesAt(end) =
                ScopedBinding::function_call_after(child, name, after, source)
            {
                earliest = match earliest {
                    Invocation::CompletesAt(previous) => Invocation::CompletesAt(previous.min(end)),
                    Invocation::NotObserved => Invocation::CompletesAt(end),
                };
            }
        }
        earliest
    }
}
use crate::javascript_literals::JavaScriptLiteral;

pub(super) enum BindingInvalidation {
    Retained,
    Invalidated,
}

pub(super) enum BindingProvenance {
    Callable,
    Class(String),
    Module(String),
}

#[derive(Debug)]
pub(super) enum ScopeAdmissionFailure {
    InvalidSource,
    MissingFunctionBody,
    NoEnclosingScope,
    MissingDeclaration,
}

pub(super) enum VisibleBinding<'scope> {
    Visible(&'scope ScopedBinding),
    OutsideScope,
}
enum DeferredContext<'tree> {
    Immediate,
    Function(tree_sitter::Node<'tree>),
}
pub(super) enum Invocation {
    NotObserved,
    CompletesAt(usize),
}
