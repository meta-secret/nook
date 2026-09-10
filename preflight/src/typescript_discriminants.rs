use crate::typescript_state::TypeScriptApplicationState;
use std::collections::{HashMap, HashSet};

const DISCRIMINANT_NAMES: [&str; 9] = [
    "action",
    "kind",
    "mode",
    "operation",
    "phase",
    "stage",
    "status",
    "type",
    "variant",
];

impl TypeScriptApplicationState<'_> {
    pub(crate) fn enclosing_enum_name<'a>(
        mut node: tree_sitter::Node<'_>,
        source: &'a str,
    ) -> EnumContext<'a> {
        while let Some(parent) = node.parent() {
            if parent.kind() == "enum_declaration" {
                return match parent
                    .child_by_field_name("name")
                    .and_then(|name| name.utf8_text(source.as_bytes()).ok())
                {
                    Some(name) => EnumContext::Named(name),
                    None => EnumContext::Malformed,
                };
            }
            node = parent;
        }
        EnumContext::Outside
    }
}

impl TypeScriptApplicationState<'_> {
    pub(crate) fn enum_value_matches_discriminant(
        enum_values: &HashMap<String, HashSet<String>>,
        value: &str,
        discriminant: &str,
    ) -> bool {
        let normalized_discriminant = discriminant.trim_matches(['\'', '"']);
        enum_values.get(value).is_some_and(|enum_names| {
            enum_names.iter().any(|enum_name| {
                enum_name
                    .to_ascii_lowercase()
                    .ends_with(&normalized_discriminant.to_ascii_lowercase())
            })
        })
    }
}

impl TypeScriptApplicationState<'_> {
    pub(crate) fn discriminant_name<'a>(
        node: tree_sitter::Node<'_>,
        source: &'a str,
    ) -> DiscriminantName<'a> {
        let name_node = match node.kind() {
            "identifier" => node,
            "member_expression" => match node.child_by_field_name("property") {
                Some(property) => property,
                None => return DiscriminantName::Unrecognized,
            },
            _ => return DiscriminantName::Unrecognized,
        };
        match name_node.utf8_text(source.as_bytes()) {
            Ok(name) if DISCRIMINANT_NAMES.contains(&name) => DiscriminantName::Recognized(name),
            _ => DiscriminantName::Unrecognized,
        }
    }
}

pub(crate) enum EnumContext<'source> {
    Named(&'source str),
    Outside,
    Malformed,
}
pub(crate) enum DiscriminantName<'source> {
    Recognized(&'source str),
    Unrecognized,
}
