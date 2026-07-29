use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::Violation;

/// Finds mutable authored TypeScript and Svelte application state that uses
/// `undefined` as an unnamed state, including zero-argument Svelte state runes.
///
/// External inputs, query/parser returns, optional callbacks, generated
/// declarations, tests, configuration, and DOM references are outside this
/// state-owning check.
///
/// # Errors
///
/// Returns an error when the authored web source tree cannot be read.
pub fn typescript_implicit_application_state(root: &Path) -> io::Result<Vec<Violation>> {
    let directory = root.join("nook-app/nook-web");
    let mut files = Vec::new();
    collect_authored_source_files(&directory, &mut files)?;

    let mut violations = Vec::new();
    for path in files {
        let contents = fs::read_to_string(&path)?;
        for line in implicit_state_lines(&contents, path.extension()) {
            violations.push(Violation {
                path: path.strip_prefix(root).unwrap_or(&path).to_path_buf(),
                line,
            });
        }
    }
    violations.sort_by(|left, right| left.path.cmp(&right.path).then(left.line.cmp(&right.line)));
    violations.dedup();
    Ok(violations)
}

fn collect_authored_source_files(directory: &Path, files: &mut Vec<PathBuf>) -> io::Result<()> {
    if !directory.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.is_dir() {
            collect_authored_source_files(&path, files)?;
            continue;
        }
        let is_source = path
            .extension()
            .and_then(std::ffi::OsStr::to_str)
            .is_some_and(|extension| extension == "ts" || extension == "svelte");
        let is_generated_declaration = path
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .is_some_and(|name| name.ends_with(".d.ts"));
        if is_source
            && !is_generated_declaration
            && !path
                .components()
                .any(|component| component.as_os_str() == "e2e")
            && path
                .components()
                .any(|component| component.as_os_str() == "src")
        {
            files.push(path);
        }
    }
    Ok(())
}

fn implicit_state_lines(source: &str, extension: Option<&std::ffi::OsStr>) -> Vec<usize> {
    if extension.is_some_and(|value| value == "svelte") {
        return svelte_implicit_state_lines(source);
    }
    typescript_code_implicit_state_lines(source, 1)
}

fn typescript_code_implicit_state_lines(source: &str, first_line: usize) -> Vec<usize> {
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())
        .expect("bundled TypeScript grammar must load");
    let Some(tree) = parser.parse(source, None) else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    collect_implicit_state_nodes(tree.root_node(), source, first_line, &mut lines);
    lines.sort_unstable();
    lines.dedup();
    lines
}

fn collect_implicit_state_nodes(
    node: tree_sitter::Node<'_>,
    source: &str,
    first_line: usize,
    lines: &mut Vec<usize>,
) {
    let is_mutable_declaration = node.kind() == "lexical_declaration"
        && node
            .utf8_text(source.as_bytes())
            .is_ok_and(|text| text.trim_start().starts_with("let "));
    let is_mutable_field = node.kind() == "public_field_definition";

    if is_mutable_declaration && lexical_declaration_models_implicit_state(node, source) {
        lines.push(first_line + node.start_position().row);
        return;
    }
    if is_mutable_field && declarator_models_implicit_state(node, source) {
        lines.push(first_line + node.start_position().row);
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_implicit_state_nodes(child, source, first_line, lines);
    }
}

fn lexical_declaration_models_implicit_state(
    node: tree_sitter::Node<'_>,
    source: &str,
) -> bool {
    let mut cursor = node.walk();
    node.named_children(&mut cursor)
        .filter(|child| child.kind() == "variable_declarator")
        .any(|declarator| declarator_models_implicit_state(declarator, source))
}

fn declarator_models_implicit_state(node: tree_sitter::Node<'_>, source: &str) -> bool {
    if node
        .child_by_field_name("name")
        .is_some_and(|name| name.kind() == "object_pattern")
    {
        return false;
    }
    let Ok(text) = node.utf8_text(source.as_bytes()) else {
        return false;
    };
    if declaration_is_dom_reference(text) || text.contains("ValueState<") {
        return false;
    }
    let type_is_implicit = node
        .child_by_field_name("type")
        .is_some_and(|type_node| node_has_exact_token(type_node, source, "undefined"));
    let value_is_implicit = node
        .child_by_field_name("value")
        .is_some_and(|value| {
            node_has_empty_svelte_state_call(value, source)
                || state_call_contains_undefined(value, source)
                || value_is_undefined(value, source)
        });
    type_is_implicit || value_is_implicit
}

fn declaration_is_dom_reference(text: &str) -> bool {
    [
        "Element",
        "Node",
        "Selection",
        "Range",
        "QRCodeStyling",
        "QrScanner",
    ]
    .iter()
    .any(|marker| text.contains(marker))
}

fn node_has_exact_token(node: tree_sitter::Node<'_>, source: &str, token: &str) -> bool {
    if token == "undefined" && (node.kind() == "undefined" || node.kind() == "undefined_type") {
        return true;
    }
    if node.child_count() == 0 {
        return false;
    }
    let mut cursor = node.walk();
    node.children(&mut cursor)
        .any(|child| node_has_exact_token(child, source, token))
}

fn node_has_empty_svelte_state_call(node: tree_sitter::Node<'_>, source: &str) -> bool {
    if node.kind() == "call_expression" {
        let function = node.child_by_field_name("function").and_then(|child| {
            child
                .utf8_text(source.as_bytes())
                .ok()
                .map(str::to_owned)
        });
        let arguments = node
            .child_by_field_name("arguments")
            .and_then(|child| child.utf8_text(source.as_bytes()).ok());
        if function
            .as_deref()
            .is_some_and(|name| name == "$state" || name == "$state.raw")
            && arguments.is_some_and(|value| value.trim() == "()")
        {
            return true;
        }
    }
    let mut cursor = node.walk();
    node.children(&mut cursor)
        .any(|child| node_has_empty_svelte_state_call(child, source))
}

fn state_call_contains_undefined(node: tree_sitter::Node<'_>, source: &str) -> bool {
    if node.kind() == "call_expression" {
        let is_state_call = node
            .child_by_field_name("function")
            .and_then(|child| child.utf8_text(source.as_bytes()).ok())
            .is_some_and(|name| name == "$state" || name == "$state.raw");
        return is_state_call && node_has_exact_token(node, source, "undefined");
    }
    let mut cursor = node.walk();
    node.children(&mut cursor)
        .any(|child| state_call_contains_undefined(child, source))
}

fn value_is_undefined(node: tree_sitter::Node<'_>, source: &str) -> bool {
    if node.child_count() == 0 {
        return node
            .utf8_text(source.as_bytes())
            .is_ok_and(|text| text == "undefined");
    }
    matches!(
        node.kind(),
        "as_expression" | "parenthesized_expression" | "type_assertion"
    ) && node_has_exact_token(node, source, "undefined")
}

fn svelte_implicit_state_lines(source: &str) -> Vec<usize> {
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&tree_sitter_svelte_next::LANGUAGE.into())
        .expect("bundled Svelte grammar must load");
    let Some(tree) = parser.parse(source, None) else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    collect_svelte_implicit_state_fragments(tree.root_node(), source, &mut lines);
    lines.sort_unstable();
    lines.dedup();
    lines
}

fn collect_svelte_implicit_state_fragments(
    node: tree_sitter::Node<'_>,
    source: &str,
    lines: &mut Vec<usize>,
) {
    if node.kind() == "raw_text"
        && node
            .parent()
            .is_some_and(|parent| parent.kind() == "script_element")
    {
        if let Ok(fragment) = node.utf8_text(source.as_bytes()) {
            lines.extend(typescript_code_implicit_state_lines(
                fragment,
                node.start_position().row + 1,
            ));
        }
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_svelte_implicit_state_fragments(child, source, lines);
    }
}

#[cfg(test)]
mod tests {
    use super::typescript_code_implicit_state_lines;

    #[test]
    fn reports_implicit_mutable_state_but_preserves_boundaries_and_dom_refs() {
        let source = r#"
let timer: ReturnType<typeof setTimeout> | undefined
let selected = $state<Item>()
class Session {
  manager: Manager | undefined
}
function lookup(value: string | undefined): Item | undefined {
  let element: HTMLDivElement | undefined
  return items.get(value)
}
"#;

        assert_eq!(
            typescript_code_implicit_state_lines(source, 1),
            vec![2, 3, 5]
        );
    }
}
