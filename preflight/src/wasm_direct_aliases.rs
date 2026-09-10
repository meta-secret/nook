use crate::javascript_literals::JavaScriptLiteralFailure;
pub struct DirectWasmAliases<'scan> {
    pub node: tree_sitter::Node<'scan>,
    pub source: &'scan str,
    pub source_path: &'scan Path,
    pub first_line: usize,
    pub callable_names: &'scan HashSet<String>,
    pub wasm_type_names: &'scan HashSet<String>,
    pub wasm_namespace_bindings: HashMap<String, String>,
    pub wasm_class_bindings: HashMap<String, String>,
    pub imported_callable_bindings: HashSet<String>,
    pub lines: Vec<usize>,
}
use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::javascript_literals::JavaScriptLiteral;
use crate::wasm_dynamic_aliases::DynamicWasmAliases;
use crate::wasm_module_sources::WasmModuleSources;

#[allow(clippy::too_many_arguments)]
impl DirectWasmAliases<'_> {
    #[expect(
        clippy::too_many_lines,
        reason = "one syntax-tree traversal owns direct alias classification"
    )]
    pub fn collect_direct_wasm_aliases_and_bindings(self) -> DirectAliasInventory {
        let Self {
            node,
            source,
            source_path,
            first_line,
            callable_names,
            wasm_type_names,
            mut wasm_namespace_bindings,
            mut wasm_class_bindings,
            mut imported_callable_bindings,
            mut lines,
        } = self;
        if matches!(node.kind(), "import_statement" | "import_alias")
            && let Ok(ImportEqualsBinding { binding, module }) =
                DirectWasmAliases::import_equals_binding(node, source)
            && (WasmModuleSources {
                module: &module,
                source_path,
            })
            .is_wasm_callable_source()
        {
            wasm_namespace_bindings.insert(binding, module);
            return DirectAliasInventory {
                wasm_namespace_bindings,
                wasm_class_bindings,
                imported_callable_bindings,
                lines,
            };
        }
        if matches!(node.kind(), "import_statement" | "export_statement") {
            if let Ok(module) = DirectWasmAliases::module_specifier(node, source) {
                if node.kind() == "import_statement"
                    && (WasmModuleSources {
                        module: &module,
                        source_path,
                    })
                    .is_wasm_callable_source()
                {
                    wasm_namespace_bindings = (DynamicWasmAliases {
                        node,
                        source,
                        source_path,
                        module: &module,
                        wasm_namespace_bindings,
                    })
                    .collect_namespace_import_bindings();
                    (imported_callable_bindings, lines) =
                        DirectWasmAliases::collect_default_callable_import(
                            node,
                            source,
                            source_path,
                            &module,
                            first_line,
                            callable_names,
                            imported_callable_bindings,
                            lines,
                        );
                    wasm_class_bindings = DynamicWasmAliases::collect_wasm_type_import_bindings(
                        node,
                        source,
                        source_path,
                        &module,
                        wasm_type_names,
                        wasm_class_bindings,
                    );
                }
                (imported_callable_bindings, lines) =
                    DirectWasmAliases::collect_callable_alias_specifiers(
                        node,
                        source,
                        source_path,
                        &module,
                        first_line,
                        callable_names,
                        imported_callable_bindings,
                        lines,
                    );
            }
            return DirectAliasInventory {
                wasm_namespace_bindings,
                wasm_class_bindings,
                imported_callable_bindings,
                lines,
            };
        }

        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            DirectAliasInventory {
                wasm_namespace_bindings,
                wasm_class_bindings,
                imported_callable_bindings,
                lines,
            } = (DirectWasmAliases {
                node: child,
                source,
                source_path,
                first_line,
                callable_names,
                wasm_type_names,
                wasm_namespace_bindings,
                wasm_class_bindings,
                imported_callable_bindings,
                lines,
            })
            .collect_direct_wasm_aliases_and_bindings();
        }
        DirectAliasInventory {
            wasm_namespace_bindings,
            wasm_class_bindings,
            imported_callable_bindings,
            lines,
        }
    }
}

impl DirectWasmAliases<'_> {
    fn import_equals_binding(
        node: tree_sitter::Node<'_>,
        source: &str,
    ) -> Result<ImportEqualsBinding, ImportSyntaxFailure> {
        let text = node
            .utf8_text(source.as_bytes())
            .map_err(|_| ImportSyntaxFailure::InvalidSource)?
            .trim();
        let assignment = text
            .strip_prefix("import ")
            .ok_or(ImportSyntaxFailure::NotImport)?;
        let (binding, required) = assignment
            .split_once('=')
            .ok_or(ImportSyntaxFailure::MissingAssignment)?;
        let module = required
            .trim()
            .strip_prefix("require(")
            .ok_or(ImportSyntaxFailure::NotRequire)?
            .trim_end_matches(';')
            .strip_suffix(')')
            .ok_or(ImportSyntaxFailure::UnterminatedRequire)?
            .trim()
            .trim_matches(['\'', '"']);
        Ok(ImportEqualsBinding {
            binding: binding.trim().to_owned(),
            module: module.to_owned(),
        })
    }
}

#[allow(clippy::too_many_arguments)]
impl DirectWasmAliases<'_> {
    fn collect_default_callable_import(
        node: tree_sitter::Node<'_>,
        source: &str,
        source_path: &Path,
        module: &str,
        first_line: usize,
        callable_names: &HashSet<String>,
        mut bindings: HashSet<String>,
        mut lines: Vec<usize>,
    ) -> (HashSet<String>, Vec<usize>) {
        let Ok(authored_name) = WasmModuleSources::wasm_callable_export_name(
            module,
            "default",
            source_path,
            callable_names,
        ) else {
            return (bindings, lines);
        };
        let Ok(text) = node.utf8_text(source.as_bytes()) else {
            return (bindings, lines);
        };
        let Some(clause) = text.trim_start().strip_prefix("import ") else {
            return (bindings, lines);
        };
        let binding = clause
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .trim_end_matches(',');
        if binding.is_empty() || matches!(binding, "type" | "{" | "*") {
            return (bindings, lines);
        }
        bindings.insert(binding.to_owned());
        if binding != authored_name {
            lines.push(first_line + node.start_position().row);
        }
        (bindings, lines)
    }
}

impl DirectWasmAliases<'_> {
    fn module_specifier(
        node: tree_sitter::Node<'_>,
        source: &str,
    ) -> Result<String, ImportSyntaxFailure> {
        let source_node = node
            .child_by_field_name("source")
            .ok_or(ImportSyntaxFailure::MissingModule)?;
        (JavaScriptLiteral {
            node: source_node,
            source,
        })
        .static_javascript_string()
        .map_err(ImportSyntaxFailure::Literal)
    }
}

#[allow(clippy::too_many_arguments)]
impl DirectWasmAliases<'_> {
    fn collect_callable_alias_specifiers(
        node: tree_sitter::Node<'_>,
        source: &str,
        source_path: &Path,
        module: &str,
        first_line: usize,
        callable_names: &HashSet<String>,
        mut imported_callable_bindings: HashSet<String>,
        mut lines: Vec<usize>,
    ) -> (HashSet<String>, Vec<usize>) {
        if matches!(node.kind(), "import_specifier" | "export_specifier")
            && let Some(authored_name_node) = node.child_by_field_name("name")
            && let Ok(authored_name) = (JavaScriptLiteral {
                node: authored_name_node,
                source,
            })
            .semantic_javascript_name()
            && callable_names.contains(&authored_name)
            && WasmModuleSources::is_wasm_callable_export(module, &authored_name, source_path)
        {
            let alias = node.child_by_field_name("alias");
            if alias
                .and_then(|alias| {
                    (JavaScriptLiteral {
                        node: alias,
                        source,
                    })
                    .semantic_javascript_name()
                    .ok()
                })
                .is_some_and(|alias| alias != authored_name)
            {
                lines.push(first_line + authored_name_node.start_position().row);
            }
            if node.kind() == "import_specifier"
                && let Ok(binding_name) = alias
                    .unwrap_or(authored_name_node)
                    .utf8_text(source.as_bytes())
            {
                imported_callable_bindings.insert(binding_name.to_owned());
            }
            return (imported_callable_bindings, lines);
        }

        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            (imported_callable_bindings, lines) =
                DirectWasmAliases::collect_callable_alias_specifiers(
                    child,
                    source,
                    source_path,
                    module,
                    first_line,
                    callable_names,
                    imported_callable_bindings,
                    lines,
                );
        }
        (imported_callable_bindings, lines)
    }
}

#[derive(Default)]
pub(super) struct DirectAliasInventory {
    pub(super) wasm_namespace_bindings: HashMap<String, String>,
    pub(super) wasm_class_bindings: HashMap<String, String>,
    pub(super) imported_callable_bindings: HashSet<String>,
    pub(super) lines: Vec<usize>,
}

struct ImportEqualsBinding {
    binding: String,
    module: String,
}
#[derive(Debug)]
#[expect(
    dead_code,
    reason = "typed parse source is retained for diagnostic evolution"
)]
enum ImportSyntaxFailure {
    InvalidSource,
    NotImport,
    MissingAssignment,
    NotRequire,
    UnterminatedRequire,
    MissingModule,
    Literal(JavaScriptLiteralFailure),
}
