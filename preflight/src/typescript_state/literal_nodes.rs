use crate::typescript_state::TypeScriptApplicationState;
impl TypeScriptApplicationState<'_> {
    pub(super) fn string_literal_value<'a>(
        node: tree_sitter::Node<'_>,
        source: &'a str,
    ) -> Option<&'a str> {
        if !TypeScriptApplicationState::is_string_literal_expression(node) {
            return None;
        }
        node.utf8_text(source.as_bytes())
            .ok()
            .and_then(|text| text.get(1..text.len().saturating_sub(1)))
    }
}

impl TypeScriptApplicationState<'_> {
    fn is_string_literal_expression(node: tree_sitter::Node<'_>) -> bool {
        node.kind() == "string"
            || (node.kind() == "template_string"
                && !TypeScriptApplicationState::contains_template_substitution(node))
    }
}

impl TypeScriptApplicationState<'_> {
    fn contains_template_substitution(node: tree_sitter::Node<'_>) -> bool {
        if node.kind() == "template_substitution" {
            return true;
        }
        let mut cursor = node.walk();
        node.named_children(&mut cursor)
            .any(TypeScriptApplicationState::contains_template_substitution)
    }
}

impl TypeScriptApplicationState<'_> {
    pub(super) fn union_contains_direct_string_literal(
        node: tree_sitter::Node<'_>,
        source: &str,
    ) -> bool {
        if TypeScriptApplicationState::is_string_literal_type(node, source) {
            return true;
        }
        if !matches!(node.kind(), "union_type" | "parenthesized_type") {
            return false;
        }
        let mut cursor = node.walk();
        node.named_children(&mut cursor).any(|child| {
            TypeScriptApplicationState::union_contains_direct_string_literal(child, source)
        })
    }
}

impl TypeScriptApplicationState<'_> {
    pub(super) fn is_type_utility_key_union(node: tree_sitter::Node<'_>, source: &str) -> bool {
        let mut ancestor = node;
        let type_arguments = loop {
            let Some(parent) = ancestor.parent() else {
                return false;
            };
            if parent.kind() == "type_arguments" {
                break parent;
            }
            if !matches!(parent.kind(), "union_type" | "parenthesized_type") {
                return false;
            }
            ancestor = parent;
        };
        let Some(generic_type) = type_arguments.parent() else {
            return false;
        };
        if generic_type.kind() != "generic_type" {
            return false;
        }
        let utility_name = generic_type
            .child_by_field_name("name")
            .or_else(|| generic_type.named_child(0))
            .and_then(|name| name.utf8_text(source.as_bytes()).ok());
        utility_name.is_some_and(|name| {
            matches!(
                name.trim(),
                "Exclude" | "Extract" | "Omit" | "Pick" | "Record"
            )
        })
    }
}

impl TypeScriptApplicationState<'_> {
    pub(super) fn is_string_literal_type(node: tree_sitter::Node<'_>, source: &str) -> bool {
        if node.kind() == "literal_type" {
            return node
                .utf8_text(source.as_bytes())
                .is_ok_and(|text| matches!(text.trim().chars().next(), Some('\'' | '"' | '`')));
        }
        matches!(node.kind(), "type_annotation" | "parenthesized_type")
            && node.named_child(0).is_some_and(|child| {
                TypeScriptApplicationState::is_string_literal_type(child, source)
            })
    }
}
