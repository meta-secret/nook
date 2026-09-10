pub struct RustWasmNames<'scan> {
    pub root: &'scan Path,
}
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::Path;

use crate::Violation;
use crate::rust_wasm_attributes::RustWasmAttributes;
use crate::wasm_direct_aliases::DirectWasmAliases;
use crate::wasm_dynamic_aliases::DynamicWasmAliases;
use crate::wasm_inventory::{WasmImplContext, WasmTypeInventory};
use crate::wasm_local_reexports::LocalWasmReexports;
use crate::wasm_svelte_sources::WasmSvelteSources;
use crate::wasm_web_sources::WebSourceInventory;

/// Finds exported Rust functions and methods renamed at the JavaScript boundary.
///
/// Callers use authored Rust names; property accessor `js_name` remains valid.
///
/// # Errors
///
/// Returns an error when an authored Rust source cannot be read or parsed.
impl RustWasmNames<'_> {
    pub fn rust_wasm_callable_name_overrides(self) -> io::Result<Vec<Violation>> {
        let Self { root } = self;
        let source_root = root.join("nook-app");
        let mut files = Vec::new();
        RustWasmAttributes::collect_rust_files(&source_root, &mut files)?;

        let mut violations = Vec::new();
        let mut inventory = crate::wasm_inventory::WasmInventory::default();
        for path in files {
            let source = fs::read_to_string(&path)?;
            let syntax = syn::parse_file(&source).map_err(io::Error::other)?;
            let relative_path = path.strip_prefix(root).unwrap_or(&path).to_path_buf();
            let attribute_aliases =
                RustWasmAttributes::collect_wasm_bindgen_attribute_aliases(&syntax.items);
            RustWasmAttributes::collect_item_violations(
                &syntax.items,
                &relative_path,
                &attribute_aliases,
                &mut violations,
            );
            if relative_path.starts_with("nook-app/nook-platform/nook-wasm/src")
                || relative_path.starts_with("nook-app/nook-platform/nook-companion-wasm/src")
            {
                inventory = inventory.collect(crate::wasm_inventory::WasmInventoryCollection {
                    items: &syntax.items,
                    enclosing_wasm_impl: WasmImplContext::Outside,
                    inherited_aliases: &HashSet::new(),
                });
            }
        }

        let crate::wasm_inventory::WasmInventory {
            callable_names,
            type_names: wasm_type_names,
            types: wasm_types,
        } = inventory;
        let mut web_files = Vec::new();
        (WebSourceInventory {
            directory: &root.join("nook-app/nook-web"),
            files: &mut web_files,
        })
        .collect_web_source_files()?;
        for path in web_files {
            let source = fs::read_to_string(&path)?;
            let lines = if path
                .extension()
                .is_some_and(|extension| extension == "svelte")
            {
                (WasmSvelteSources {
                    source: &source,
                    source_path: &path,
                    callable_names: &callable_names,
                    wasm_type_names: &wasm_type_names,
                    wasm_types: &wasm_types,
                })
                .svelte_wasm_import_alias_lines()
                .map_err(io::Error::other)?
            } else if path
                .extension()
                .is_some_and(|extension| matches!(extension.to_str(), Some("jsx" | "tsx")))
            {
                RustWasmNames::tsx_wasm_import_alias_lines(
                    &source,
                    &path,
                    1,
                    &callable_names,
                    &wasm_type_names,
                    &wasm_types,
                )
                .map_err(io::Error::other)?
            } else {
                RustWasmNames::typescript_wasm_import_alias_lines_at_path(
                    &source,
                    &path,
                    1,
                    &callable_names,
                    &wasm_type_names,
                    &wasm_types,
                )
                .map_err(io::Error::other)?
            };
            let relative_path = path.strip_prefix(root).unwrap_or(&path).to_path_buf();
            violations.extend(lines.into_iter().map(|line| Violation {
                path: relative_path.clone(),
                line,
            }));
        }

        violations
            .sort_by(|left, right| left.path.cmp(&right.path).then(left.line.cmp(&right.line)));
        violations.dedup();
        Ok(violations)
    }
}

#[cfg(test)]
impl RustWasmNames<'_> {
    fn typescript_wasm_import_alias_lines(
        source: &str,
        first_line: usize,
        callable_names: &HashSet<String>,
    ) -> Result<Vec<usize>, tree_sitter::LanguageError> {
        let wasm_type_names = HashSet::from([
            "NookVaultArchitecture".to_owned(),
            "NookVaultManager".to_owned(),
        ]);
        let wasm_types = RustWasmNames::test_wasm_methods_by_type();
        RustWasmNames::typescript_wasm_import_alias_lines_at_path(
            source,
            Path::new("nook-app/nook-web/test.ts"),
            first_line,
            callable_names,
            &wasm_type_names,
            &wasm_types,
        )
    }
}

impl RustWasmNames<'_> {
    pub(super) fn typescript_wasm_import_alias_lines_at_path(
        source: &str,
        source_path: &Path,
        first_line: usize,
        callable_names: &HashSet<String>,
        wasm_type_names: &HashSet<String>,
        wasm_types: &WasmTypeInventory,
    ) -> Result<Vec<usize>, tree_sitter::LanguageError> {
        RustWasmNames::script_wasm_import_alias_lines(
            source,
            source_path,
            first_line,
            callable_names,
            wasm_type_names,
            wasm_types,
            &tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        )
    }
}

impl RustWasmNames<'_> {
    fn tsx_wasm_import_alias_lines(
        source: &str,
        source_path: &Path,
        first_line: usize,
        callable_names: &HashSet<String>,
        wasm_type_names: &HashSet<String>,
        wasm_types: &WasmTypeInventory,
    ) -> Result<Vec<usize>, tree_sitter::LanguageError> {
        RustWasmNames::script_wasm_import_alias_lines(
            source,
            source_path,
            first_line,
            callable_names,
            wasm_type_names,
            wasm_types,
            &tree_sitter_typescript::LANGUAGE_TSX.into(),
        )
    }
}

impl RustWasmNames<'_> {
    fn script_wasm_import_alias_lines(
        source: &str,
        source_path: &Path,
        first_line: usize,
        callable_names: &HashSet<String>,
        wasm_type_names: &HashSet<String>,
        wasm_types: &WasmTypeInventory,
        language: &tree_sitter::Language,
    ) -> Result<Vec<usize>, tree_sitter::LanguageError> {
        let mut parser = tree_sitter::Parser::new();
        parser.set_language(language)?;
        let Some(tree) = parser.parse(source, None) else {
            return Ok(Vec::new());
        };
        let mut lines = Vec::new();
        let mut imported_callable_bindings = HashSet::new();
        let mut wasm_namespace_bindings = HashMap::new();
        let mut wasm_class_bindings = HashMap::new();
        let mut wasm_instance_bindings = HashMap::new();
        (DirectWasmAliases {
            node: tree.root_node(),
            source,
            source_path,
            first_line,
            callable_names,
            wasm_type_names,
            wasm_namespace_bindings: &mut wasm_namespace_bindings,
            wasm_class_bindings: &mut wasm_class_bindings,
            imported_callable_bindings: &mut imported_callable_bindings,
            lines: &mut lines,
        })
        .collect_direct_wasm_aliases_and_bindings();
        DynamicWasmAliases::collect_dynamic_wasm_aliases_and_bindings(
            tree.root_node(),
            source,
            source_path,
            first_line,
            callable_names,
            wasm_type_names,
            wasm_types,
            &mut wasm_namespace_bindings,
            &wasm_class_bindings,
            &mut wasm_instance_bindings,
            &mut imported_callable_bindings,
            &mut lines,
        );
        (LocalWasmReexports {
            node: tree.root_node(),
            source,
            first_line,
            imported_callable_bindings: &imported_callable_bindings,
            lines: &mut lines,
        })
        .collect_local_wasm_reexport_aliases();
        lines.sort_unstable();
        lines.dedup();
        Ok(lines)
    }
}

#[cfg(test)]
impl RustWasmNames<'_> {
    fn test_wasm_methods_by_type() -> WasmTypeInventory {
        WasmTypeInventory {
            methods: HashMap::from([
                (
                    "NookVaultManager".to_owned(),
                    HashSet::from(["connect".to_owned(), "generate_secret_id".to_owned()]),
                ),
                (
                    "NookVaultArchitecture".to_owned(),
                    HashSet::from(["simple".to_owned()]),
                ),
            ]),
            returns: HashMap::new(),
            free_returns: HashMap::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::RustWasmNames;

    #[test]
    fn rejects_direct_typescript_alias() -> Result<(), tree_sitter::LanguageError> {
        let source = "import { generate_secret_id as generateSecretId } from \"$app-wasm\";";
        let names = HashSet::from(["generate_secret_id".to_owned()]);
        assert_eq!(
            RustWasmNames::typescript_wasm_import_alias_lines(source, 1, &names)?,
            vec![1]
        );
        Ok(())
    }
}
