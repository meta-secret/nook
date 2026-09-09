pub struct LocalWasmReexports<'scan> {
    pub node: tree_sitter::Node<'scan>,
    pub source: &'scan str,
    pub first_line: usize,
    pub imported_callable_bindings: &'scan HashSet<String>,
    pub lines: &'scan mut Vec<usize>,
}
use std::collections::HashSet;

use crate::javascript_literals::JavaScriptLiteral;

impl LocalWasmReexports<'_> {
    pub fn collect_local_wasm_reexport_aliases(self) {
        let Self {
            node,
            source,
            first_line,
            imported_callable_bindings,
            lines,
        } = self;
        if node.kind() == "export_statement" && node.child_by_field_name("source").is_none() {
            LocalWasmReexports::collect_local_callable_alias_specifiers(
                node,
                source,
                first_line,
                imported_callable_bindings,
                lines,
            );
            return;
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            (LocalWasmReexports {
                node: child,
                source: source,
                first_line: first_line,
                imported_callable_bindings: imported_callable_bindings,
                lines: lines,
            })
            .collect_local_wasm_reexport_aliases();
        }
    }
}

impl LocalWasmReexports<'_> {
    fn collect_local_callable_alias_specifiers(
        node: tree_sitter::Node<'_>,
        source: &str,
        first_line: usize,
        imported_callable_bindings: &HashSet<String>,
        lines: &mut Vec<usize>,
    ) {
        if node.kind() == "export_specifier"
            && let Some(local_name) = node.child_by_field_name("name")
            && let Some(alias) = node.child_by_field_name("alias")
            && let Some(local_name_text) =
                JavaScriptLiteral::semantic_javascript_name(local_name, source)
            && imported_callable_bindings.contains(&local_name_text)
            && JavaScriptLiteral::semantic_javascript_name(alias, source)
                .is_some_and(|alias_text| alias_text != local_name_text)
        {
            lines.push(first_line + local_name.start_position().row);
            return;
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            LocalWasmReexports::collect_local_callable_alias_specifiers(
                child,
                source,
                first_line,
                imported_callable_bindings,
                lines,
            );
        }
    }
}
