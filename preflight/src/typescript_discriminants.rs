use std::collections::{HashMap, HashSet};

pub(crate) fn enclosing_enum_name<'a>(
    mut node: tree_sitter::Node<'_>,
    source: &'a str,
) -> Option<&'a str> {
    while let Some(parent) = node.parent() {
        if parent.kind() == "enum_declaration" {
            return parent
                .child_by_field_name("name")
                .and_then(|name| name.utf8_text(source.as_bytes()).ok());
        }
        node = parent;
    }
    None
}

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

pub(crate) fn discriminant_member_name<'a>(
    node: tree_sitter::Node<'_>,
    source: &'a str,
) -> Option<&'a str> {
    if node.kind() != "member_expression" {
        return None;
    }
    let property = node.child_by_field_name("property")?;
    let name = property.utf8_text(source.as_bytes()).ok()?;
    const DISCRIMINANT_NAMES: [&str; 8] = [
        "action",
        "kind",
        "mode",
        "operation",
        "phase",
        "stage",
        "status",
        "type",
    ];
    DISCRIMINANT_NAMES.contains(&name).then_some(name)
}
