use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::Violation;

/// Finds every authored JavaScript, TypeScript, and Svelte use of `undefined`
/// or an assertion matcher that encodes the same implicit absence contract.
///
/// Authored code must model absence explicitly. Optional object shape may use
/// `?`, callbacks with no value return `void`, and external/browser absence is
/// normalized by a narrow boundary adapter before it enters application code.
/// Quoting the sentinel in a `typeof value === "undefined"` comparison is also
/// forbidden: structural boundaries use property/capability checks, while
/// application state uses a named tagged union.
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
        for line in undefined_token_lines(&contents, path.extension()).map_err(io::Error::other)? {
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

/// Finds every authored JavaScript, TypeScript, and Svelte use of `null`.
///
/// Generated declarations may mirror nullable external contracts, but authored
/// adapters normalize those contracts without storing or returning `null`.
///
/// # Errors
///
/// Returns an error when the repository source tree cannot be read.
pub fn typescript_null_absence_sentinels(root: &Path) -> io::Result<Vec<Violation>> {
    let mut files = Vec::new();
    collect_authored_source_files(root, &mut files)?;

    let mut violations = Vec::new();
    for path in files {
        let contents = fs::read_to_string(&path)?;
        for line in null_token_lines(&contents, path.extension()).map_err(io::Error::other)? {
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
/// `void` is TypeScript's unit/effect type for function returns, callbacks,
/// promises, and intentionally discarded results. A mutable `let` slot must
/// instead use an explicit tagged state because `T | void` stores absence.
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
        for line in
            mutable_void_state_lines(&contents, path.extension()).map_err(io::Error::other)?
        {
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

/// Finds generic Option-style wrappers that hide the meaning of application state.
///
/// # Errors
///
/// Returns an error when the repository source tree cannot be read.
pub fn typescript_generic_optional_state(root: &Path) -> io::Result<Vec<Violation>> {
    let mut files = Vec::new();
    collect_authored_source_files(root, &mut files)?;

    let mut violations = Vec::new();
    for path in files {
        let contents = fs::read_to_string(&path)?;
        for line in
            generic_optional_state_lines(&contents, path.extension()).map_err(io::Error::other)?
        {
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

/// Finds authored closed string vocabularies and runtime discriminants that
/// should be owned by enums.
///
/// Closed state and protocol vocabularies must have a named enum declaration.
/// The serialized values may remain strings for compatibility, but union
/// variants, message shapes, constructors, and comparisons refer to enum
/// members instead of repeating raw literals.
///
/// # Errors
///
/// Returns an error when the repository source tree cannot be read.
pub fn typescript_raw_string_discriminants(root: &Path) -> io::Result<Vec<Violation>> {
    let mut files = Vec::new();
    collect_authored_source_files(root, &mut files)?;

    let mut violations = Vec::new();
    for path in files {
        let contents = fs::read_to_string(&path)?;
        for line in
            raw_string_discriminant_lines(&contents, path.extension()).map_err(io::Error::other)?
        {
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
        let is_generated_bundle = path
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .is_some_and(|name| name.ends_with(".min.js") || name.ends_with(".umd.js"));
        let is_generated_wasm = path
            .components()
            .any(|component| component.as_os_str() == "nook-wasm");
        if is_source && !is_declaration && !is_generated_bundle && !is_generated_wasm {
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

fn undefined_token_lines(
    source: &str,
    extension: Option<&std::ffi::OsStr>,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    if extension.is_some_and(|value| value == "svelte") {
        return svelte_undefined_token_lines(source);
    }
    typescript_code_undefined_token_lines(source, 1)
}

fn null_token_lines(
    source: &str,
    extension: Option<&std::ffi::OsStr>,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    if extension.is_some_and(|value| value == "svelte") {
        return svelte_null_token_lines(source);
    }
    typescript_code_null_token_lines(source, 1)
}

fn typescript_code_undefined_token_lines(
    source: &str,
    first_line: usize,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())?;
    let Some(tree) = parser.parse(source, None) else {
        return Ok(Vec::new());
    };
    let mut lines = Vec::new();
    collect_undefined_nodes(tree.root_node(), source, first_line, &mut lines);
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

fn typescript_code_null_token_lines(
    source: &str,
    first_line: usize,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())?;
    let Some(tree) = parser.parse(source, None) else {
        return Ok(Vec::new());
    };
    let mut lines = Vec::new();
    collect_null_nodes(tree.root_node(), first_line, &mut lines);
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

fn mutable_void_state_lines(
    source: &str,
    extension: Option<&std::ffi::OsStr>,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    if extension.is_some_and(|value| value == "svelte") {
        return svelte_mutable_void_state_lines(source);
    }
    typescript_code_mutable_void_state_lines(source, 1)
}

fn typescript_code_mutable_void_state_lines(
    source: &str,
    first_line: usize,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())?;
    let Some(tree) = parser.parse(source, None) else {
        return Ok(Vec::new());
    };
    let mut lines = Vec::new();
    collect_mutable_void_nodes(tree.root_node(), source, first_line, &mut lines);
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

fn generic_optional_state_lines(
    source: &str,
    extension: Option<&std::ffi::OsStr>,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    if extension.is_some_and(|value| value == "svelte") {
        return svelte_generic_optional_state_lines(source);
    }
    typescript_code_generic_optional_state_lines(source, 1)
}

fn raw_string_discriminant_lines(
    source: &str,
    extension: Option<&std::ffi::OsStr>,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    if extension.is_some_and(|value| value == "svelte") {
        return svelte_raw_string_discriminant_lines(source);
    }
    typescript_code_raw_string_discriminant_lines(source, 1)
}

fn typescript_code_raw_string_discriminant_lines(
    source: &str,
    first_line: usize,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())?;
    let Some(tree) = parser.parse(source, None) else {
        return Ok(Vec::new());
    };
    let mut enum_values = HashSet::new();
    collect_enum_string_values(tree.root_node(), source, &mut enum_values);
    let mut lines = Vec::new();
    collect_raw_string_discriminant_nodes(
        tree.root_node(),
        source,
        first_line,
        &enum_values,
        &mut lines,
    );
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

fn collect_raw_string_discriminant_nodes(
    node: tree_sitter::Node<'_>,
    source: &str,
    first_line: usize,
    enum_values: &HashSet<String>,
    lines: &mut Vec<usize>,
) {
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
    if node.kind() == "property_signature" {
        let name = node
            .child_by_field_name("name")
            .and_then(|value| value.utf8_text(source.as_bytes()).ok())
            .map(str::trim);
        let declared_type = node.child_by_field_name("type");
        if name.is_some_and(|value| DISCRIMINANT_NAMES.contains(&value))
            && declared_type.is_some_and(|value| is_string_literal_type(value, source))
        {
            lines.push(first_line + node.start_position().row);
            return;
        }
    }
    if node.kind() == "union_type"
        && node
            .parent()
            .is_some_and(|parent| parent.kind() == "type_alias_declaration")
        && contains_string_literal_type(node, source)
    {
        lines.push(first_line + node.start_position().row);
        return;
    }
    if node.kind() == "pair" {
        let name = node
            .child_by_field_name("key")
            .and_then(|value| value.utf8_text(source.as_bytes()).ok())
            .map(str::trim);
        let value = node.child_by_field_name("value");
        if name.is_some_and(|value| DISCRIMINANT_NAMES.contains(&value))
            && value
                .and_then(|literal| string_literal_value(literal, source))
                .is_some_and(|literal| enum_values.contains(literal))
        {
            lines.push(first_line + node.start_position().row);
            return;
        }
    }
    if node.kind() == "binary_expression" {
        let left = node.child_by_field_name("left");
        let right = node.child_by_field_name("right");
        if left.zip(right).is_some_and(|(left, right)| {
            let literal = if is_discriminant_member(left, source) {
                string_literal_value(right, source)
            } else if is_discriminant_member(right, source) {
                string_literal_value(left, source)
            } else {
                None
            };
            is_equality_comparison(node, left, right, source)
                && literal.is_some_and(|value| enum_values.contains(value))
        }) {
            lines.push(first_line + node.start_position().row);
            return;
        }
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_raw_string_discriminant_nodes(child, source, first_line, enum_values, lines);
    }
}

fn is_equality_comparison(
    expression: tree_sitter::Node<'_>,
    left: tree_sitter::Node<'_>,
    right: tree_sitter::Node<'_>,
    source: &str,
) -> bool {
    if expression.kind() != "binary_expression" {
        return false;
    }
    source
        .get(left.end_byte()..right.start_byte())
        .is_some_and(|operator| matches!(operator.trim(), "==" | "===" | "!=" | "!=="))
}

fn collect_enum_string_values(
    node: tree_sitter::Node<'_>,
    source: &str,
    values: &mut HashSet<String>,
) {
    if node.kind() == "enum_assignment"
        && let Some(value) = node.child_by_field_name("value")
        && let Some(literal) = string_literal_value(value, source)
    {
        values.insert(literal.to_owned());
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_enum_string_values(child, source, values);
    }
}

fn string_literal_value<'a>(node: tree_sitter::Node<'_>, source: &'a str) -> Option<&'a str> {
    if !is_string_literal_expression(node) {
        return None;
    }
    node.utf8_text(source.as_bytes())
        .ok()
        .and_then(|text| text.get(1..text.len().saturating_sub(1)))
}

fn is_string_literal_expression(node: tree_sitter::Node<'_>) -> bool {
    matches!(node.kind(), "string" | "template_string")
}

fn is_discriminant_member(node: tree_sitter::Node<'_>, source: &str) -> bool {
    const DISCRIMINANT_SUFFIXES: [&str; 8] = [
        ".action",
        ".kind",
        ".mode",
        ".operation",
        ".phase",
        ".stage",
        ".status",
        ".type",
    ];
    node.kind() == "member_expression"
        && node.utf8_text(source.as_bytes()).is_ok_and(|text| {
            DISCRIMINANT_SUFFIXES
                .iter()
                .any(|suffix| text.ends_with(suffix))
        })
}

fn contains_string_literal_type(node: tree_sitter::Node<'_>, source: &str) -> bool {
    if is_string_literal_type(node, source) {
        return true;
    }
    let mut cursor = node.walk();
    node.named_children(&mut cursor)
        .any(|child| contains_string_literal_type(child, source))
}

fn is_string_literal_type(node: tree_sitter::Node<'_>, source: &str) -> bool {
    node.kind() == "literal_type"
        && node
            .utf8_text(source.as_bytes())
            .is_ok_and(|text| matches!(text.trim().chars().next(), Some('\'' | '"' | '`')))
}

fn typescript_code_generic_optional_state_lines(
    source: &str,
    first_line: usize,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())?;
    let Some(tree) = parser.parse(source, None) else {
        return Ok(Vec::new());
    };
    let mut lines = Vec::new();
    collect_generic_optional_state_nodes(tree.root_node(), source, first_line, &mut lines);
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

fn collect_generic_optional_state_nodes(
    node: tree_sitter::Node<'_>,
    source: &str,
    first_line: usize,
    lines: &mut Vec<usize>,
) {
    const BANNED_NAMES: [&str; 6] = [
        "EMPTY_VALUE",
        "ValueState",
        "omittedValue",
        "presentValue",
        "valueState",
        "valueFromState",
    ];
    if matches!(node.kind(), "identifier" | "type_identifier")
        && node
            .utf8_text(source.as_bytes())
            .is_ok_and(|text| BANNED_NAMES.contains(&text))
    {
        lines.push(first_line + node.start_position().row);
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_generic_optional_state_nodes(child, source, first_line, lines);
    }
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

fn variable_declarator_has_mutable_void(declarator: tree_sitter::Node<'_>, source: &str) -> bool {
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

fn collect_undefined_nodes(
    node: tree_sitter::Node<'_>,
    source: &str,
    first_line: usize,
    lines: &mut Vec<usize>,
) {
    if node.kind() == "undefined" || node.kind() == "undefined_type" {
        lines.push(first_line + node.start_position().row);
        return;
    }
    if node.kind() == "property_identifier"
        && node
            .utf8_text(source.as_bytes())
            .is_ok_and(|text| matches!(text, "toBeDefined" | "toBeNull" | "toBeUndefined"))
    {
        lines.push(first_line + node.start_position().row);
        return;
    }
    if node.kind() == "binary_expression" && is_typeof_undefined_comparison(node, source) {
        lines.push(first_line + node.start_position().row);
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_undefined_nodes(child, source, first_line, lines);
    }
}

fn collect_null_nodes(node: tree_sitter::Node<'_>, first_line: usize, lines: &mut Vec<usize>) {
    if node.kind() == "null" {
        lines.push(first_line + node.start_position().row);
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_null_nodes(child, first_line, lines);
    }
}

fn is_typeof_undefined_comparison(node: tree_sitter::Node<'_>, source: &str) -> bool {
    let mut child_cursor = node.walk();
    let compares_equality = node
        .children(&mut child_cursor)
        .any(|child| matches!(child.kind(), "===" | "!==" | "==" | "!="));
    if !compares_equality {
        return false;
    }

    let mut cursor = node.walk();
    let operands: Vec<_> = node.named_children(&mut cursor).collect();
    if operands.len() != 2 {
        return false;
    }
    (is_typeof_expression(operands[0]) && is_undefined_string(operands[1], source))
        || (is_undefined_string(operands[0], source) && is_typeof_expression(operands[1]))
}

fn is_typeof_expression(node: tree_sitter::Node<'_>) -> bool {
    if node.kind() != "unary_expression" {
        return false;
    }
    let mut cursor = node.walk();
    node.children(&mut cursor)
        .any(|child| child.kind() == "typeof")
}

fn is_undefined_string(node: tree_sitter::Node<'_>, source: &str) -> bool {
    matches!(node.kind(), "string" | "template_string")
        && node.utf8_text(source.as_bytes()).is_ok_and(|text| {
            matches!(text.trim(), "'undefined'" | "\"undefined\"" | "`undefined`")
        })
}

fn svelte_undefined_token_lines(source: &str) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&tree_sitter_svelte_next::LANGUAGE.into())?;
    let Some(tree) = parser.parse(source, None) else {
        return Ok(Vec::new());
    };
    let mut lines = Vec::new();
    collect_svelte_script_fragments(tree.root_node(), source, &mut lines)?;
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

fn svelte_null_token_lines(source: &str) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&tree_sitter_svelte_next::LANGUAGE.into())?;
    let Some(tree) = parser.parse(source, None) else {
        return Ok(Vec::new());
    };
    let mut lines = Vec::new();
    collect_svelte_script_fragments_with(
        tree.root_node(),
        source,
        &mut lines,
        typescript_code_null_token_lines,
    )?;
    collect_svelte_null_fragments(tree.root_node(), source, &mut lines)?;
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

fn svelte_mutable_void_state_lines(source: &str) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&tree_sitter_svelte_next::LANGUAGE.into())?;
    let Some(tree) = parser.parse(source, None) else {
        return Ok(Vec::new());
    };
    let mut lines = Vec::new();
    collect_svelte_mutable_void_fragments(tree.root_node(), source, &mut lines)?;
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

fn svelte_generic_optional_state_lines(
    source: &str,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&tree_sitter_svelte_next::LANGUAGE.into())?;
    let Some(tree) = parser.parse(source, None) else {
        return Ok(Vec::new());
    };
    let mut lines = Vec::new();
    collect_svelte_script_fragments_with(
        tree.root_node(),
        source,
        &mut lines,
        typescript_code_generic_optional_state_lines,
    )?;
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

fn svelte_raw_string_discriminant_lines(
    source: &str,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&tree_sitter_svelte_next::LANGUAGE.into())?;
    let Some(tree) = parser.parse(source, None) else {
        return Ok(Vec::new());
    };
    let mut lines = Vec::new();
    collect_svelte_script_fragments_with(
        tree.root_node(),
        source,
        &mut lines,
        typescript_code_raw_string_discriminant_lines,
    )?;
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

fn collect_svelte_script_fragments_with(
    node: tree_sitter::Node<'_>,
    source: &str,
    lines: &mut Vec<usize>,
    scan: fn(&str, usize) -> Result<Vec<usize>, tree_sitter::LanguageError>,
) -> Result<(), tree_sitter::LanguageError> {
    if node.kind() == "raw_text"
        && node
            .parent()
            .is_some_and(|parent| parent.kind() == "script_element")
    {
        if let Ok(fragment) = node.utf8_text(source.as_bytes()) {
            lines.extend(scan(fragment, node.start_position().row + 1)?);
        }
        return Ok(());
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_svelte_script_fragments_with(child, source, lines, scan)?;
    }
    Ok(())
}

fn collect_svelte_mutable_void_fragments(
    node: tree_sitter::Node<'_>,
    source: &str,
    lines: &mut Vec<usize>,
) -> Result<(), tree_sitter::LanguageError> {
    if node.kind() == "raw_text"
        && node
            .parent()
            .is_some_and(|parent| parent.kind() == "script_element")
    {
        if let Ok(fragment) = node.utf8_text(source.as_bytes()) {
            lines.extend(typescript_code_mutable_void_state_lines(
                fragment,
                node.start_position().row + 1,
            )?);
        }
        return Ok(());
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_svelte_mutable_void_fragments(child, source, lines)?;
    }
    Ok(())
}

fn collect_svelte_null_fragments(
    node: tree_sitter::Node<'_>,
    source: &str,
    lines: &mut Vec<usize>,
) -> Result<(), tree_sitter::LanguageError> {
    if (node.kind() == "raw_text"
        && node
            .parent()
            .is_some_and(|parent| parent.kind() == "script_element"))
        || node.kind() == "svelte_raw_text"
    {
        if let Ok(fragment) = node.utf8_text(source.as_bytes()) {
            lines.extend(typescript_code_null_token_lines(
                fragment,
                node.start_position().row + 1,
            )?);
        }
        return Ok(());
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_svelte_null_fragments(child, source, lines)?;
    }
    Ok(())
}

fn collect_svelte_script_fragments(
    node: tree_sitter::Node<'_>,
    source: &str,
    lines: &mut Vec<usize>,
) -> Result<(), tree_sitter::LanguageError> {
    if node.kind() == "raw_text"
        && node
            .parent()
            .is_some_and(|parent| parent.kind() == "script_element")
    {
        if let Ok(fragment) = node.utf8_text(source.as_bytes()) {
            lines.extend(typescript_code_undefined_token_lines(
                fragment,
                node.start_position().row + 1,
            )?);
        }
        return Ok(());
    }
    if node.child_count() == 0
        && node
            .utf8_text(source.as_bytes())
            .is_ok_and(|text| text == "undefined")
    {
        lines.push(node.start_position().row + 1);
        return Ok(());
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_svelte_script_fragments(child, source, lines)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        typescript_code_generic_optional_state_lines, typescript_code_mutable_void_state_lines,
        typescript_code_null_token_lines, typescript_code_raw_string_discriminant_lines,
        typescript_code_undefined_token_lines,
    };

    #[test]
    fn reports_every_code_and_type_token_but_not_prose() -> Result<(), tree_sitter::LanguageError> {
        let source = r#"
// undefined is discussed here
type State = { kind: 'empty' } | { kind: 'ready'; value: string }
const config: { optional?: string } = {}
let timer: ReturnType<typeof setTimeout> | undefined
const missing = value === undefined
const word = 'undefined'
const hidden = typeof value === 'undefined'
const reversed = "undefined" != typeof another
const parenthesized = typeof(value)===`undefined`
expect(value).toBeUndefined()
expect(value).not.toBeDefined()
expect(value).toBeNull()
"#;

        assert_eq!(
            typescript_code_undefined_token_lines(source, 1)?,
            vec![5, 6, 8, 9, 10, 11, 12, 13]
        );
        Ok(())
    }

    #[test]
    fn reports_mutable_void_slots_but_not_returns_or_nested_boundary_results()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r"
let timer: ReturnType<typeof setTimeout> | void
const parser = (): string | void => {}
let request: ValueState<Promise<string | void>> = { kind: 'empty' }
let selected = $state<string | void>()
const command = (): void => {}
const effect = async (): Promise<void> => {}
const callback: (value: string) => void = () => {}
void effect()
";

        assert_eq!(
            typescript_code_mutable_void_state_lines(source, 1)?,
            vec![2, 5]
        );
        Ok(())
    }

    #[test]
    fn reports_null_values_and_types_but_not_prose() -> Result<(), tree_sitter::LanguageError> {
        let source = r#"
// null is discussed here
const word = "null"
type State = string | null
const value = null
"#;

        assert_eq!(typescript_code_null_token_lines(source, 1)?, vec![4, 5]);
        Ok(())
    }

    #[test]
    fn reports_generic_option_style_state_names_but_not_prose()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r"
// ValueState and EMPTY_VALUE are discussed here
type ValueState<T> = { kind: 'empty' } | { kind: 'present'; value: T }
const EMPTY_VALUE = { kind: 'empty' }
const state = presentValue(value)
";

        assert_eq!(
            typescript_code_generic_optional_state_lines(source, 1)?,
            vec![3, 4, 5]
        );
        Ok(())
    }

    #[test]
    fn reports_raw_string_vocabularies_and_runtime_discriminants()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r"
enum SessionKind {
  Closed = 'closed',
  Open = 'open',
}
type SessionState =
  | { kind: 'closed' }
  | { kind: SessionKind.Open; handle: number }
type Message = { type: 'nook:open'; payload: string }
type Description = { label: 'static copy' }
type Panel = 'closed' | 'open'
const state: SessionState = { kind: 'closed' }
if (state.kind === 'closed') console.log('closed')
if ('closed' !== state.kind) console.log('open')
if (server.transport.type !== 'stdio') console.log('external protocol')
const description = { label: 'static copy' }
const externalKind = state.kind ?? 'external-value'
";

        assert_eq!(
            typescript_code_raw_string_discriminant_lines(source, 1)?,
            vec![7, 11, 12, 13, 14]
        );
        Ok(())
    }
}
