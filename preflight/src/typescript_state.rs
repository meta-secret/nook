use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::Violation;

/// Finds every authored JavaScript, TypeScript, and Svelte `undefined` token.
///
/// Authored code must model absence explicitly. Optional object shape may use
/// `?`, callbacks with no value return `void`, and external/browser absence is
/// normalized by a narrow boundary adapter before it enters application code.
/// Generated declarations, dependencies, build output, and generated WASM
/// bindings are excluded because they mirror contracts Nook does not author.
///
/// # Errors
///
/// Returns an error when the repository source tree cannot be read.
pub fn typescript_implicit_application_state(root: &Path) -> io::Result<Vec<Violation>> {
    let mut files = Vec::new();
    collect_authored_source_files(root, &mut files)?;

    let mut violations = Vec::new();
    for path in files {
        let contents = fs::read_to_string(&path)?;
        for line in undefined_token_lines(&contents, path.extension()) {
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

/// Finds mutable TypeScript/Svelte storage that disguises absence as `void`.
///
/// `void` remains truthful for function returns and external callback contracts,
/// but a mutable `let` slot must use an explicit tagged state.
///
/// # Errors
///
/// Returns an error when the repository source tree cannot be read.
pub fn typescript_mutable_void_state(root: &Path) -> io::Result<Vec<Violation>> {
    let mut files = Vec::new();
    collect_authored_source_files(root, &mut files)?;

    let mut violations = Vec::new();
    for path in files {
        let contents = fs::read_to_string(&path)?;
        for line in mutable_void_state_lines(&contents, path.extension()) {
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
            if !is_excluded_directory(&path) {
                collect_authored_source_files(&path, files)?;
            }
            continue;
        }
        let is_source = path
            .extension()
            .and_then(std::ffi::OsStr::to_str)
            .is_some_and(|extension| matches!(extension, "js" | "mjs" | "cjs" | "ts" | "svelte"));
        let is_declaration = path
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .is_some_and(|name| name.ends_with(".d.ts"));
        let is_generated_wasm = path
            .components()
            .any(|component| component.as_os_str() == "nook-wasm");
        if is_source && !is_declaration && !is_generated_wasm {
            files.push(path);
        }
    }
    Ok(())
}

fn is_excluded_directory(path: &Path) -> bool {
    path.file_name()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|name| {
            matches!(
                name,
                ".git"
                    | ".svelte-kit"
                    | "build"
                    | "coverage"
                    | "dist"
                    | "node_modules"
                    | "playwright-report"
                    | "target"
                    | "test-results"
            )
        })
}

fn undefined_token_lines(source: &str, extension: Option<&std::ffi::OsStr>) -> Vec<usize> {
    if extension.is_some_and(|value| value == "svelte") {
        return svelte_undefined_token_lines(source);
    }
    typescript_code_undefined_token_lines(source, 1)
}

fn typescript_code_undefined_token_lines(source: &str, first_line: usize) -> Vec<usize> {
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())
        .expect("bundled TypeScript grammar must load");
    let Some(tree) = parser.parse(source, None) else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    collect_undefined_nodes(tree.root_node(), first_line, &mut lines);
    lines.sort_unstable();
    lines.dedup();
    lines
}

fn mutable_void_state_lines(source: &str, extension: Option<&std::ffi::OsStr>) -> Vec<usize> {
    if extension.is_some_and(|value| value == "svelte") {
        return svelte_mutable_void_state_lines(source);
    }
    typescript_code_mutable_void_state_lines(source, 1)
}

fn typescript_code_mutable_void_state_lines(source: &str, first_line: usize) -> Vec<usize> {
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())
        .expect("bundled TypeScript grammar must load");
    let Some(tree) = parser.parse(source, None) else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    collect_mutable_void_nodes(tree.root_node(), source, first_line, &mut lines);
    lines.sort_unstable();
    lines.dedup();
    lines
}

fn collect_mutable_void_nodes(
    node: tree_sitter::Node<'_>,
    source: &str,
    first_line: usize,
    lines: &mut Vec<usize>,
) {
    if node.kind() == "lexical_declaration"
        && node
            .utf8_text(source.as_bytes())
            .is_ok_and(|text| text.trim_start().starts_with("let "))
    {
        let mut cursor = node.walk();
        for declarator in node.named_children(&mut cursor) {
            if declarator.kind() == "variable_declarator"
                && variable_declarator_has_mutable_void(declarator, source)
            {
                lines.push(first_line + declarator.start_position().row);
            }
        }
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_mutable_void_nodes(child, source, first_line, lines);
    }
}

fn variable_declarator_has_mutable_void(
    declarator: tree_sitter::Node<'_>,
    source: &str,
) -> bool {
    let mut cursor = declarator.walk();
    declarator.named_children(&mut cursor).any(|child| {
        (child.kind() == "type_annotation"
            && child
                .named_child(0)
                .is_some_and(|declared_type| direct_union_contains_void(declared_type, source)))
            || (child.kind() == "call_expression"
                && child
                    .utf8_text(source.as_bytes())
                    .is_ok_and(|text| text.starts_with("$state<") && text.contains("| void")))
    })
}

fn direct_union_contains_void(node: tree_sitter::Node<'_>, source: &str) -> bool {
    if node.kind() != "union_type" {
        return false;
    }
    let mut cursor = node.walk();
    node.named_children(&mut cursor).any(|child| {
        child
            .utf8_text(source.as_bytes())
            .is_ok_and(|text| text.trim() == "void")
            || direct_union_contains_void(child, source)
    })
}

fn collect_undefined_nodes(node: tree_sitter::Node<'_>, first_line: usize, lines: &mut Vec<usize>) {
    if node.kind() == "undefined" || node.kind() == "undefined_type" {
        lines.push(first_line + node.start_position().row);
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_undefined_nodes(child, first_line, lines);
    }
}

fn svelte_undefined_token_lines(source: &str) -> Vec<usize> {
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&tree_sitter_svelte_next::LANGUAGE.into())
        .expect("bundled Svelte grammar must load");
    let Some(tree) = parser.parse(source, None) else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    collect_svelte_script_fragments(tree.root_node(), source, &mut lines);
    lines.sort_unstable();
    lines.dedup();
    lines
}

fn svelte_mutable_void_state_lines(source: &str) -> Vec<usize> {
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&tree_sitter_svelte_next::LANGUAGE.into())
        .expect("bundled Svelte grammar must load");
    let Some(tree) = parser.parse(source, None) else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    collect_svelte_mutable_void_fragments(tree.root_node(), source, &mut lines);
    lines.sort_unstable();
    lines.dedup();
    lines
}

fn collect_svelte_mutable_void_fragments(
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
            lines.extend(typescript_code_mutable_void_state_lines(
                fragment,
                node.start_position().row + 1,
            ));
        }
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_svelte_mutable_void_fragments(child, source, lines);
    }
}

fn collect_svelte_script_fragments(
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
            lines.extend(typescript_code_undefined_token_lines(
                fragment,
                node.start_position().row + 1,
            ));
        }
        return;
    }
    if node.child_count() == 0
        && node
            .utf8_text(source.as_bytes())
            .is_ok_and(|text| text == "undefined")
    {
        lines.push(node.start_position().row + 1);
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_svelte_script_fragments(child, source, lines);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        typescript_code_mutable_void_state_lines, typescript_code_undefined_token_lines,
    };

    #[test]
    fn reports_every_code_and_type_token_but_not_prose() {
        let source = r"
// undefined is discussed here
type State = { kind: 'empty' } | { kind: 'ready'; value: string }
const config: { optional?: string } = {}
let timer: ReturnType<typeof setTimeout> | undefined
const missing = value === undefined
const word = 'undefined'
";

        assert_eq!(typescript_code_undefined_token_lines(source, 1), vec![5, 6]);
    }

    #[test]
    fn reports_mutable_void_slots_but_not_returns_or_nested_boundary_results() {
        let source = r"
let timer: ReturnType<typeof setTimeout> | void
const parser = (): string | void => {}
let request: ValueState<Promise<string | void>> = { kind: 'empty' }
let selected = $state<string | void>()
";

        assert_eq!(
            typescript_code_mutable_void_state_lines(source, 1),
            vec![2, 5]
        );
    }
}
