pub struct LocalWasmReexports<'scan> {
    pub node: tree_sitter::Node<'scan>,
    pub source: &'scan str,
    pub first_line: usize,
    pub imported_callable_bindings: &'scan HashSet<String>,
    pub lines: Vec<usize>,
}
use std::collections::HashSet;

use crate::javascript_literals::JavaScriptLiteral;

impl LocalWasmReexports<'_> {
    pub fn collect_local_wasm_reexport_aliases(self) -> Vec<usize> {
        let Self {
            node,
            source,
            first_line,
            imported_callable_bindings,
            mut lines,
        } = self;
        if node.kind() == "export_statement" && node.child_by_field_name("source").is_none() {
            lines = LocalWasmReexports::collect_local_callable_alias_specifiers(
                node,
                source,
                first_line,
                imported_callable_bindings,
                lines,
            );
            return lines;
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            lines = (LocalWasmReexports {
                node: child,
                source: source,
                first_line: first_line,
                imported_callable_bindings: imported_callable_bindings,
                lines: lines,
            })
            .collect_local_wasm_reexport_aliases();
        }
        lines
    }
}

impl LocalWasmReexports<'_> {
    fn collect_local_callable_alias_specifiers(
        node: tree_sitter::Node<'_>,
        source: &str,
        first_line: usize,
        imported_callable_bindings: &HashSet<String>,
        mut lines: Vec<usize>,
    ) -> Vec<usize> {
        if node.kind() == "export_specifier"
            && let Some(local_name) = node.child_by_field_name("name")
            && let Some(alias) = node.child_by_field_name("alias")
            && let Ok(local_name_text) = (JavaScriptLiteral {
                node: local_name,
                source: source,
            })
            .semantic_javascript_name()
            && imported_callable_bindings.contains(&local_name_text)
            && (JavaScriptLiteral {
                node: alias,
                source: source,
            })
            .semantic_javascript_name()
            .is_ok_and(|alias_text| alias_text != local_name_text)
        {
            lines.push(first_line + local_name.start_position().row);
            return lines;
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            lines = LocalWasmReexports::collect_local_callable_alias_specifiers(
                child,
                source,
                first_line,
                imported_callable_bindings,
                lines,
            );
        }
        lines
    }
}
