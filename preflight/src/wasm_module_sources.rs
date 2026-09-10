mod traversal;
use traversal::ModuleTraversal;
pub struct WasmModuleSources<'scan> {
    pub module: &'scan str,
    pub source_path: &'scan Path,
}
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::javascript_literals::JavaScriptLiteral;
use crate::javascript_scopes::ScopedBinding;

const WASM_MODULE_ALIASES: &[&str] = &[
    "$app-wasm",
    "$lib/nook",
    "$lib/auth/oauth-origin",
    "$lib/auth/providers",
    "$lib/vault/architecture-model",
    "nook-wasm",
];

const WASM_MODULE_PATHS: &[&str] = &[
    "nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm",
    "nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm",
    "nook-web-shared/src/vault-app/lib/nook",
    "nook-web-shared/src/vault-app/lib/auth/oauth-origin",
    "nook-web-shared/src/vault-app/lib/auth/providers",
    "nook-web-shared/src/vault-app/lib/vault/architecture-model",
    "nook-web-extension/src/lib/nook-wasm",
];

const MODULE_EXTENSIONS: &[&str] = &["ts", "tsx", "js", "jsx", "mts", "mjs", "cts", "cjs"];

#[derive(Clone)]
enum ForwardedExport {
    All {
        module: String,
    },
    Named {
        exported: String,
        imported: String,
        module: String,
    },
    Namespace {
        exported: String,
        module: String,
    },
}

impl WasmModuleSources<'_> {
    pub fn is_wasm_callable_source(self) -> bool {
        ModuleTraversal::default()
            .any(self.module, self.source_path)
            .1
    }
}

impl WasmModuleSources<'_> {
    pub(super) fn is_wasm_callable_export(
        module: &str,
        exported_name: &str,
        source_path: &Path,
    ) -> bool {
        ModuleTraversal::default()
            .symbol(module, exported_name, source_path)
            .1
    }
}

impl WasmModuleSources<'_> {
    pub(super) fn wasm_callable_export_name(
        module: &str,
        exported_name: &str,
        source_path: &Path,
        callable_names: &HashSet<String>,
    ) -> Option<String> {
        ModuleTraversal::default()
            .callable(module, exported_name, source_path, callable_names)
            .1
    }
}

impl WasmModuleSources<'_> {
    pub(super) fn is_wasm_export(module: &str, exported_name: &str, source_path: &Path) -> bool {
        ModuleTraversal::default()
            .symbol(module, exported_name, source_path)
            .1
    }
}

impl WasmModuleSources<'_> {
    pub(super) fn wasm_namespace_export_source(
        module: &str,
        exported_name: &str,
        source_path: &Path,
    ) -> Option<String> {
        ModuleTraversal::default()
            .namespace(module, exported_name, source_path)
            .1
    }
}

impl WasmModuleSources<'_> {
    pub(super) fn wasm_factory_return_type(
        module: &str,
        exported_name: &str,
        source_path: &Path,
        wasm_type_names: &HashSet<String>,
    ) -> Option<String> {
        ModuleTraversal::default()
            .factory(module, exported_name, source_path, wasm_type_names)
            .1
    }
}

impl WasmModuleSources<'_> {
    fn local_factory_return_type(
        path: &Path,
        exported_name: &str,
        wasm_type_names: &HashSet<String>,
    ) -> Option<String> {
        let source = fs::read_to_string(path).ok()?;
        let language = if path
            .extension()
            .and_then(OsStr::to_str)
            .is_some_and(|extension| matches!(extension, "tsx" | "jsx"))
        {
            tree_sitter_typescript::LANGUAGE_TSX.into()
        } else {
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
        };
        let mut parser = tree_sitter::Parser::new();
        parser.set_language(&language).ok()?;
        let tree = parser.parse(&source, None)?;
        let mut imported_bindings = HashMap::new();
        imported_bindings = WasmModuleSources::collect_imported_bindings(
            tree.root_node(),
            &source,
            imported_bindings,
        );
        WasmModuleSources::find_factory_return_type(
            tree.root_node(),
            &source,
            path,
            exported_name,
            wasm_type_names,
            &imported_bindings,
        )
    }
}

#[rustfmt::skip]
impl WasmModuleSources<'_> {
fn find_factory_return_type(node: tree_sitter::Node<'_>, source: &str, source_path: &Path, exported_name: &str, wasm_type_names: &HashSet<String>, imported_bindings: &HashMap<String, (String, String)>) -> Option<String> {
    if exported_name == "default"
        && node.kind() == "export_statement"
        && node
            .utf8_text(source.as_bytes())
            .is_ok_and(|text| text.trim_start().starts_with("export default "))
        && let Some(local) = node
            .named_child(0)
            .filter(|child| child.kind() == "identifier")
            .and_then(|child| (JavaScriptLiteral { node: child, source: source }).semantic_javascript_name().ok())
    {
        let mut root = node;
        while let Some(parent) = root.parent() {
            root = parent;
        }
        return WasmModuleSources::find_factory_return_type(root, source, source_path, &local, wasm_type_names, imported_bindings);
    }
    if matches!(
        node.kind(),
        "function_declaration"
            | "generator_function_declaration"
            | "function_expression"
            | "generator_function"
            | "arrow_function"
    ) && (WasmModuleSources::callable_name(node, source).is_some_and(|name| name == exported_name)
        || (exported_name == "default"
            && node.parent().is_some_and(|parent| {
                parent.kind() == "export_statement"
                    && parent
                        .utf8_text(source.as_bytes())
                        .is_ok_and(|text| text.trim_start().starts_with("export default "))
            })))
        && let Some(wasm_type) = node
            .child_by_field_name("return_type")
            .and_then(|return_type| WasmModuleSources::referenced_wasm_type(return_type, source, source_path, wasm_type_names, imported_bindings))
            .or_else(|| node.child_by_field_name("body").and_then(|body| WasmModuleSources::inferred_factory_wasm_type(crate::wasm_module_sources::FactoryReturnTraversal { node: body, value_context: if body.kind() != "statement_block" { FactoryValueContext::Returned } else { FactoryValueContext::Expression }, source, source_path, wasm_type_names, imports: imported_bindings })))
    {
        return Some(wasm_type);
    }
    let mut cursor = node.walk();
    node.named_children(&mut cursor).find_map(|child| WasmModuleSources::find_factory_return_type(child, source, source_path, exported_name, wasm_type_names, imported_bindings))
}
}

#[rustfmt::skip]
impl WasmModuleSources<'_> {
fn inferred_factory_wasm_type(request: FactoryReturnTraversal<'_>) -> Option<String> {
let FactoryReturnTraversal { node, value_context, source, source_path, wasm_type_names, imports } = request;

    if matches!(value_context, FactoryValueContext::Returned)
        && node.kind() == "new_expression"
        && let Some(local) = node.child_by_field_name("constructor").and_then(|constructor| (JavaScriptLiteral { node: constructor, source: source }).semantic_javascript_name().ok())
        && let Some((module, imported)) = imports.get(&local)
        && wasm_type_names.contains(imported)
        && WasmModuleSources::is_wasm_export(module, imported, source_path)
    {
        return Some(imported.clone());
    }
    if matches!(
        node.kind(),
        "function_declaration"
            | "function_expression"
            | "generator_function_declaration"
            | "generator_function"
            | "arrow_function"
    ) {
        return None;
    }
    let mut cursor = node.walk();
    node.named_children(&mut cursor).find_map(|child| WasmModuleSources::inferred_factory_wasm_type(crate::wasm_module_sources::FactoryReturnTraversal { node: child, value_context: if matches!(value_context, FactoryValueContext::Returned) || node.kind() == "return_statement" { FactoryValueContext::Returned } else { FactoryValueContext::Expression }, source, source_path, wasm_type_names, imports }))
}
}

impl WasmModuleSources<'_> {
    fn callable_name(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
        node.child_by_field_name("name")
            .and_then(|name| {
                (JavaScriptLiteral {
                    node: name,
                    source: source,
                })
                .semantic_javascript_name()
                .ok()
            })
            .or_else(|| {
                let declarator = node.parent()?;
                (declarator.kind() == "variable_declarator")
                    .then(|| declarator.child_by_field_name("name"))
                    .flatten()
                    .and_then(|name| {
                        (JavaScriptLiteral {
                            node: name,
                            source: source,
                        })
                        .semantic_javascript_name()
                        .ok()
                    })
            })
    }
}

impl WasmModuleSources<'_> {
    fn referenced_wasm_type(
        node: tree_sitter::Node<'_>,
        source: &str,
        source_path: &Path,
        wasm_type_names: &HashSet<String>,
        imported_bindings: &HashMap<String, (String, String)>,
    ) -> Option<String> {
        let annotation = node.utf8_text(source.as_bytes()).ok()?.trim();
        let actual = annotation.strip_prefix(':').unwrap_or(annotation).trim();
        let local_name = actual
            .strip_prefix("Promise<")
            .and_then(|inner| inner.strip_suffix('>'))
            .unwrap_or(actual)
            .trim();
        if let Some((module, imported_name)) = imported_bindings.get(local_name) {
            return (wasm_type_names.contains(imported_name)
                && WasmModuleSources::is_wasm_export(module, imported_name, source_path))
            .then(|| imported_name.clone());
        }
        wasm_type_names
            .contains(local_name)
            .then(|| local_name.to_owned())
    }
}

impl WasmModuleSources<'_> {
    fn local_forwarded_exports(path: &Path) -> Option<Vec<ForwardedExport>> {
        let source = fs::read_to_string(path).ok()?;
        let language = if path
            .extension()
            .and_then(OsStr::to_str)
            .is_some_and(|extension| matches!(extension, "tsx" | "jsx"))
        {
            tree_sitter_typescript::LANGUAGE_TSX.into()
        } else {
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
        };
        let mut parser = tree_sitter::Parser::new();
        parser.set_language(&language).ok()?;
        let tree = parser.parse(&source, None)?;
        let mut imported_bindings = HashMap::new();
        imported_bindings = WasmModuleSources::collect_imported_bindings(
            tree.root_node(),
            &source,
            imported_bindings,
        );
        let mut exports = Vec::new();
        exports = WasmModuleSources::collect_forwarded_exports(
            tree.root_node(),
            &source,
            &imported_bindings,
            exports,
        );
        Some(exports)
    }
}

#[rustfmt::skip]
impl WasmModuleSources<'_> {
fn collect_imported_bindings(node: tree_sitter::Node<'_>, source: &str, mut bindings: HashMap<String, (String, String)>) -> HashMap<String, (String, String)> {
    if node.kind() == "import_statement" {
        let Some(module) = node.child_by_field_name("source").and_then(|source_node| (JavaScriptLiteral { node: source_node, source }).static_javascript_string().ok())
        else {
            return bindings;
        };
        bindings = WasmModuleSources::collect_import_specifiers(node, source, &module, bindings);
        return bindings;
    }
    if node.kind() == "variable_declarator"
        && let Some(local) = node.child_by_field_name("name").and_then(|binding| (JavaScriptLiteral { node: binding, source: source }).semantic_javascript_name().ok())
        && node.child_by_field_name("name").is_some_and(ScopedBinding::declaration_is_in_program_scope)
        && let Some(module) = node.child_by_field_name("value").and_then(|value| WasmModuleSources::required_module(value, source))
    {
        bindings.insert(local, (module, "*".to_owned()));
        return bindings;
    }
    if node.kind() == "variable_declarator"
        && let (Some(local), Some(value)) = (node.child_by_field_name("name").and_then(|binding| (JavaScriptLiteral { node: binding, source: source }).semantic_javascript_name().ok()), node.child_by_field_name("value"))
        && let Some(ForwardedExport::Named { imported, module, .. }) = WasmModuleSources::forwarded_namespace_member(local.clone(), value, source, &bindings)
    {
        bindings.insert(local, (module, imported));
        return bindings;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        bindings = WasmModuleSources::collect_imported_bindings(child, source, bindings);
    }
bindings
}
}

impl WasmModuleSources<'_> {
    fn collect_import_specifiers(
        node: tree_sitter::Node<'_>,
        source: &str,
        module: &str,
        mut bindings: HashMap<String, (String, String)>,
    ) -> HashMap<String, (String, String)> {
        if node.kind() == "namespace_import" {
            let mut cursor = node.walk();
            if let Some(local) = node.named_children(&mut cursor).find_map(|child| {
                (JavaScriptLiteral {
                    node: child,
                    source: source,
                })
                .semantic_javascript_name()
                .ok()
            }) {
                bindings.insert(local, (module.to_owned(), "*".to_owned()));
            }
            return bindings;
        }
        if node.kind() == "import_specifier"
            && let Some(imported_node) = node.child_by_field_name("name")
            && let Ok(imported) = (JavaScriptLiteral {
                node: imported_node,
                source: source,
            })
            .semantic_javascript_name()
        {
            let local_node = node.child_by_field_name("alias").unwrap_or(imported_node);
            if let Ok(local) = (JavaScriptLiteral {
                node: local_node,
                source: source,
            })
            .semantic_javascript_name()
            {
                bindings.insert(local, (module.to_owned(), imported));
            }
            return bindings;
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            bindings =
                WasmModuleSources::collect_import_specifiers(child, source, module, bindings);
        }
        bindings
    }
}

impl WasmModuleSources<'_> {
    fn collect_forwarded_exports(
        node: tree_sitter::Node<'_>,
        source: &str,
        imported_bindings: &HashMap<String, (String, String)>,
        mut exports: Vec<ForwardedExport>,
    ) -> Vec<ForwardedExport> {
        if node.kind() == "export_statement" {
            exports = WasmModuleSources::collect_export_statement(
                node,
                source,
                imported_bindings,
                exports,
            );
            return exports;
        }
        if node.kind() == "assignment_expression" {
            exports = WasmModuleSources::collect_commonjs_export(
                node,
                source,
                imported_bindings,
                exports,
            );
            return exports;
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            exports = WasmModuleSources::collect_forwarded_exports(
                child,
                source,
                imported_bindings,
                exports,
            );
        }
        exports
    }
}

#[rustfmt::skip]
impl WasmModuleSources<'_> {
fn collect_export_statement(node: tree_sitter::Node<'_>, source: &str, imported_bindings: &HashMap<String, (String, String)>, mut exports: Vec<ForwardedExport>) -> Vec<ForwardedExport> {
    let direct_module = node.child_by_field_name("source").and_then(|source_node| (JavaScriptLiteral { node: source_node, source }).static_javascript_string().ok());
    let mut saw_specifier = false;
    if node.utf8_text(source.as_bytes()).is_ok_and(|text| text.trim_start().starts_with("export = "))
        && let Some(value) = node.named_child(0)
        && let Some(module) = WasmModuleSources::forwarded_namespace_identifier(value, source, imported_bindings)
    {
        exports.push(ForwardedExport::All { module });
        return exports;
    }
    if let Some(module) = &direct_module
        && let Some(exported) = WasmModuleSources::namespace_export_name(node, source)
    {
        exports.push(ForwardedExport::Namespace { exported, module: module.clone() });
        return exports;
    }
    if direct_module.is_none() {
        if let Some(exported) = node.named_child(0).filter(|declaration| matches!(declaration.kind(), "function_declaration" | "generator_function_declaration" | "class_declaration")).and_then(|declaration| declaration.child_by_field_name("name")).and_then(|name| (JavaScriptLiteral { node: name, source: source }).semantic_javascript_name().ok())
        {
            exports.push(ForwardedExport::Named { exported: exported.clone(), imported: exported, module: String::new() });
            return exports;
        }
        exports.extend(WasmModuleSources::exported_callable_declaration(node, source, imported_bindings));
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        if child.kind() != "export_clause" {
            continue;
        }
        let mut clause_cursor = child.walk();
        for specifier in child.named_children(&mut clause_cursor) {
            if specifier.kind() != "export_specifier" {
                continue;
            }
            saw_specifier = true;
            let Some(local_node) = specifier.child_by_field_name("name") else {
                continue;
            };
            let Ok(local) = (JavaScriptLiteral { node: local_node, source: source }).semantic_javascript_name() else {
                continue;
            };
            let exported = specifier.child_by_field_name("alias").and_then(|alias| (JavaScriptLiteral { node: alias, source: source }).semantic_javascript_name().ok()).unwrap_or_else(|| local.clone());
            if let Some(module) = &direct_module {
                exports.push(ForwardedExport::Named { exported, imported: local, module: module.clone() });
            } else if let Some((module, imported)) = imported_bindings.get(&local) {
                exports.push(ForwardedExport::Named { exported, imported: imported.clone(), module: module.clone() });
            }
        }
    }
    if !saw_specifier && let Some(module) = direct_module {
        exports.push(ForwardedExport::All { module });
    }
exports
}
}

impl WasmModuleSources<'_> {
    fn exported_callable_declaration(
        node: tree_sitter::Node<'_>,
        source: &str,
        imports: &HashMap<String, (String, String)>,
    ) -> Vec<ForwardedExport> {
        if node
            .utf8_text(source.as_bytes())
            .is_ok_and(|text| text.trim_start().starts_with("export default "))
        {
            let mut cursor = node.walk();
            let children = node.named_children(&mut cursor).collect::<Vec<_>>();
            if let Some(local) = children
                .iter()
                .find(|child| child.kind() == "identifier")
                .and_then(|child| {
                    (JavaScriptLiteral {
                        node: *child,
                        source: source,
                    })
                    .semantic_javascript_name()
                    .ok()
                })
                && let Some((module, imported)) = imports.get(&local)
            {
                return vec![ForwardedExport::Named {
                    exported: "default".to_owned(),
                    imported: imported.clone(),
                    module: module.clone(),
                }];
            }
            return children
                .into_iter()
                .find(|child| matches!(child.kind(), "member_expression" | "subscript_expression"))
                .and_then(|value| {
                    WasmModuleSources::forwarded_namespace_member(
                        "default".to_owned(),
                        value,
                        source,
                        imports,
                    )
                })
                .into_iter()
                .collect();
        }
        let mut cursor = node.walk();
        let Some(declaration) = node
            .named_children(&mut cursor)
            .find(|child| matches!(child.kind(), "lexical_declaration" | "variable_declaration"))
        else {
            return Vec::new();
        };
        let mut cursor = declaration.walk();
        declaration
            .named_children(&mut cursor)
            .filter(|child| child.kind() == "variable_declarator")
            .filter_map(|declarator| {
                WasmModuleSources::forwarded_namespace_member(
                    (JavaScriptLiteral {
                        node: declarator.child_by_field_name("name")?,
                        source: source,
                    })
                    .semantic_javascript_name()
                    .ok()?,
                    declarator.child_by_field_name("value")?,
                    source,
                    imports,
                )
            })
            .collect()
    }
}

impl WasmModuleSources<'_> {
    fn forwarded_namespace_member(
        exported: String,
        value: tree_sitter::Node<'_>,
        source: &str,
        imports: &HashMap<String, (String, String)>,
    ) -> Option<ForwardedExport> {
        let namespace = value.child_by_field_name("object")?;
        let namespace_name = (JavaScriptLiteral {
            node: namespace,
            source: source,
        })
        .semantic_javascript_name()
        .ok()?;
        if !ScopedBinding::root_binding_is_visible(namespace, &namespace_name, source) {
            return None;
        }
        let (module, imported_namespace) = imports.get(&namespace_name)?;
        if imported_namespace != "*" {
            return None;
        }
        let imported = value
            .child_by_field_name("property")
            .or_else(|| value.child_by_field_name("index"))
            .and_then(|property| {
                (JavaScriptLiteral {
                    node: property,
                    source: source,
                })
                .semantic_javascript_name()
                .ok()
            })?;
        Some(ForwardedExport::Named {
            exported,
            imported,
            module: module.clone(),
        })
    }
}

impl WasmModuleSources<'_> {
    fn namespace_export_name(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
        let text = node.utf8_text(source.as_bytes()).ok()?.trim_start();
        if !text.starts_with("export * as ") {
            return None;
        }
        let remainder = text.strip_prefix("export * as ")?;
        let exported = remainder.split_whitespace().next()?;
        (!exported.is_empty()).then(|| exported.to_owned())
    }
}

#[rustfmt::skip]
impl WasmModuleSources<'_> {
fn collect_commonjs_export(node: tree_sitter::Node<'_>, source: &str, imported_bindings: &HashMap<String, (String, String)>, mut exports: Vec<ForwardedExport>) -> Vec<ForwardedExport> {
    let Some(left) = node.child_by_field_name("left") else {
        return exports;
    };
    if left
        .utf8_text(source.as_bytes())
        .is_ok_and(|text| text.trim() == "module.exports")
    {
        let Some(right) = node.child_by_field_name("right") else {
            return exports;
        };
        if right.kind() == "object" {
            let mut cursor = right.walk();
            exports.extend(right.named_children(&mut cursor).filter_map(|property| {
                WasmModuleSources::forwarded_commonjs_object_property(property, source, imported_bindings)
            }));
        } else if let Some((module, imported)) = WasmModuleSources::forwarded_member(right, source, imported_bindings) {
            exports.push(ForwardedExport::Named { exported: "default".to_owned(), imported, module });
        } else if let Some(module) = WasmModuleSources::required_module(right, source) {
            exports.push(ForwardedExport::All { module });
        } else if let Some(module) = WasmModuleSources::forwarded_namespace_identifier(right, source, imported_bindings) {
            exports.push(ForwardedExport::All { module });
        }
        return exports;
    }
    let Some(exported) = WasmModuleSources::commonjs_named_export(left, source) else {
        return exports;
    };
    let Some((module, imported)) = node.child_by_field_name("right").and_then(|right| WasmModuleSources::forwarded_member(right, source, imported_bindings))
    else {
        return exports;
    };
    exports.push(ForwardedExport::Named { exported, imported, module });
exports
}
}

#[rustfmt::skip]
impl WasmModuleSources<'_> {
fn forwarded_namespace_identifier(node: tree_sitter::Node<'_>, source: &str, imports: &HashMap<String, (String, String)>) -> Option<String> {
    let name = (JavaScriptLiteral { node: node, source: source }).semantic_javascript_name().ok()?;
    let (module, imported) = imports.get(&name)?;
    (imported == "*" && ScopedBinding::root_binding_is_visible(node, &name, source)).then(|| module.clone())
}
}

impl WasmModuleSources<'_> {
    fn forwarded_commonjs_object_property(
        property: tree_sitter::Node<'_>,
        source: &str,
        imports: &HashMap<String, (String, String)>,
    ) -> Option<ForwardedExport> {
        if matches!(
            property.kind(),
            "shorthand_property_identifier" | "shorthand_property_identifier_pattern"
        ) {
            let exported = (JavaScriptLiteral {
                node: property,
                source: source,
            })
            .semantic_javascript_name()
            .ok()?;
            let (module, imported) = imports.get(&exported)?;
            return Some(ForwardedExport::Named {
                exported,
                imported: imported.clone(),
                module: module.clone(),
            });
        }
        WasmModuleSources::forwarded_namespace_member(
            (JavaScriptLiteral {
                node: property.child_by_field_name("key")?,
                source: source,
            })
            .semantic_javascript_name()
            .ok()?,
            property.child_by_field_name("value")?,
            source,
            imports,
        )
    }
}

impl WasmModuleSources<'_> {
    fn forwarded_member(
        node: tree_sitter::Node<'_>,
        source: &str,
        imported_bindings: &HashMap<String, (String, String)>,
    ) -> Option<(String, String)> {
        WasmModuleSources::required_member(node, source).or_else(|| {
            let object = node.child_by_field_name("object")?;
            let name = (JavaScriptLiteral {
                node: object,
                source: source,
            })
            .semantic_javascript_name()
            .ok()?;
            if !ScopedBinding::root_binding_is_visible(object, &name, source) {
                return None;
            }
            let (module, namespace) = imported_bindings.get(&name)?;
            (namespace == "*").then(|| {
                let imported = node
                    .child_by_field_name("property")
                    .or_else(|| node.child_by_field_name("index"))
                    .and_then(|property| {
                        (JavaScriptLiteral {
                            node: property,
                            source: source,
                        })
                        .semantic_javascript_name()
                        .ok()
                    })?;
                Some((module.clone(), imported))
            })?
        })
    }
}

impl WasmModuleSources<'_> {
    fn commonjs_named_export(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
        if !matches!(node.kind(), "member_expression" | "subscript_expression") {
            return None;
        }
        let object = node.child_by_field_name("object")?;
        let object_text = object.utf8_text(source.as_bytes()).ok()?.trim();
        if !matches!(object_text, "exports" | "module.exports") {
            return None;
        }
        node.child_by_field_name("property")
            .or_else(|| node.child_by_field_name("index"))
            .and_then(|property| {
                (JavaScriptLiteral {
                    node: property,
                    source: source,
                })
                .semantic_javascript_name()
                .ok()
            })
    }
}

impl WasmModuleSources<'_> {
    fn required_member(node: tree_sitter::Node<'_>, source: &str) -> Option<(String, String)> {
        if !matches!(node.kind(), "member_expression" | "subscript_expression") {
            return None;
        }
        let object = node.child_by_field_name("object")?;
        let module = WasmModuleSources::required_module(object, source)?;
        let imported = node
            .child_by_field_name("property")
            .or_else(|| node.child_by_field_name("index"))
            .and_then(|property| {
                (JavaScriptLiteral {
                    node: property,
                    source: source,
                })
                .semantic_javascript_name()
                .ok()
            })?;
        Some((module, imported))
    }
}

impl WasmModuleSources<'_> {
    fn required_module(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
        let function = node.child_by_field_name("function")?;
        if node.kind() != "call_expression"
            || !function
                .utf8_text(source.as_bytes())
                .is_ok_and(|name| name == "require")
            || !ScopedBinding::root_binding_is_visible(function, "require", source)
        {
            return None;
        }
        let arguments = node.child_by_field_name("arguments")?;
        let mut cursor = arguments.walk();
        arguments.named_children(&mut cursor).find_map(|argument| {
            (JavaScriptLiteral {
                node: argument,
                source,
            })
            .static_javascript_string()
            .ok()
        })
    }
}

mod local_resolution;

#[derive(Clone, Copy, PartialEq, Eq)]
enum FactoryValueContext {
    Expression,
    Returned,
}

struct FactoryReturnTraversal<'a> {
    node: tree_sitter::Node<'a>,
    value_context: FactoryValueContext,
    source: &'a str,
    source_path: &'a Path,
    wasm_type_names: &'a HashSet<String>,
    imports: &'a HashMap<String, (String, String)>,
}
