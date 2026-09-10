use super::*;

impl DynamicWasmAliases<'_> {
    pub fn collect_namespace_import_bindings(self) -> HashMap<String, String> {
        let Self {
            node,
            source,
            source_path,
            module,
            mut wasm_namespace_bindings,
        } = self;
        if node.kind() == "namespace_import"
            && !DynamicWasmAliases::node_is_type_only_import(node, source)
        {
            let mut cursor = node.walk();
            if let Some(binding) = node
                .named_children(&mut cursor)
                .find(|child| child.kind() == "identifier")
                .and_then(|child| child.utf8_text(source.as_bytes()).ok())
            {
                wasm_namespace_bindings.insert(binding.to_owned(), module.to_owned());
            }
            return wasm_namespace_bindings;
        }
        if node.kind() == "import_specifier"
            && !DynamicWasmAliases::node_is_type_only_import(node, source)
            && let Some(imported) = node.child_by_field_name("name")
            && let Ok(imported_name) = (JavaScriptLiteral {
                node: imported,
                source: source,
            })
            .semantic_javascript_name()
            && let Some(namespace_source) =
                WasmModuleSources::wasm_namespace_export_source(module, &imported_name, source_path)
        {
            let binding = node.child_by_field_name("alias").unwrap_or(imported);
            if let Ok(binding_name) = binding.utf8_text(source.as_bytes()) {
                wasm_namespace_bindings.insert(binding_name.to_owned(), namespace_source);
            }
            return wasm_namespace_bindings;
        }

        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            wasm_namespace_bindings = (DynamicWasmAliases {
                node: child,
                source,
                source_path,
                module,
                wasm_namespace_bindings,
            })
            .collect_namespace_import_bindings();
        }
        wasm_namespace_bindings
    }
}

impl DynamicWasmAliases<'_> {
    pub(crate) fn collect_wasm_type_import_bindings(
        node: tree_sitter::Node<'_>,
        source: &str,
        source_path: &Path,
        module: &str,
        wasm_type_names: &HashSet<String>,
        mut wasm_class_bindings: HashMap<String, String>,
    ) -> HashMap<String, String> {
        if node.kind() == "namespace_import" {
            let mut cursor = node.walk();
            if let Some(namespace) = node.named_children(&mut cursor).find_map(|child| {
                (JavaScriptLiteral {
                    node: child,
                    source: source,
                })
                .semantic_javascript_name()
                .ok()
            }) {
                for wasm_type in wasm_type_names {
                    if WasmModuleSources::is_wasm_export(module, wasm_type, source_path) {
                        wasm_class_bindings
                            .insert(format!("{namespace}.{wasm_type}"), wasm_type.clone());
                    }
                }
            }
            return wasm_class_bindings;
        }
        if node.kind() == "import_specifier"
            && let Some(imported) = node.child_by_field_name("name")
            && let Ok(imported_name) = (JavaScriptLiteral {
                node: imported,
                source: source,
            })
            .semantic_javascript_name()
            && wasm_type_names.contains(&imported_name)
            && WasmModuleSources::is_wasm_export(module, &imported_name, source_path)
        {
            let binding = node.child_by_field_name("alias").unwrap_or(imported);
            if let Ok(binding_name) = binding.utf8_text(source.as_bytes()) {
                wasm_class_bindings.insert(binding_name.to_owned(), imported_name);
            }
            return wasm_class_bindings;
        }

        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            wasm_class_bindings = DynamicWasmAliases::collect_wasm_type_import_bindings(
                child,
                source,
                source_path,
                module,
                wasm_type_names,
                wasm_class_bindings,
            );
        }
        wasm_class_bindings
    }
}

impl DynamicWasmAliases<'_> {
    pub(super) fn node_is_type_only_import(node: tree_sitter::Node<'_>, source: &str) -> bool {
        if node
            .utf8_text(source.as_bytes())
            .is_ok_and(|text| text.trim_start().starts_with("type "))
        {
            return true;
        }
        let mut ancestor = node.parent();
        while let Some(parent) = ancestor {
            if parent.kind() == "import_statement" {
                return parent
                    .utf8_text(source.as_bytes())
                    .is_ok_and(|text| text.trim_start().starts_with("import type "));
            }
            ancestor = parent.parent();
        }
        false
    }
}
