use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::javascript_literals::{
    semantic_javascript_name as semantic_node_name, static_javascript_string,
};

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

pub(super) fn is_wasm_callable_source(module: &str, source_path: &Path) -> bool {
    let mut visited = HashSet::new();
    module_reexports_any_wasm(module, source_path, &mut visited)
}

pub(super) fn is_wasm_callable_export(
    module: &str,
    exported_name: &str,
    source_path: &Path,
) -> bool {
    let mut visited = HashSet::new();
    module_reexports_wasm_symbol(module, exported_name, source_path, &mut visited)
}

pub(super) fn is_wasm_export(module: &str, exported_name: &str, source_path: &Path) -> bool {
    let mut visited = HashSet::new();
    module_reexports_wasm_symbol(module, exported_name, source_path, &mut visited)
}

pub(super) fn wasm_namespace_export_source(
    module: &str,
    exported_name: &str,
    source_path: &Path,
) -> Option<String> {
    let mut visited = HashSet::new();
    module_exports_wasm_namespace(module, exported_name, source_path, &mut visited)
}

fn module_exports_wasm_namespace(
    module: &str,
    exported_name: &str,
    source_path: &Path,
    visited: &mut HashSet<(PathBuf, String)>,
) -> Option<String> {
    let resolved = resolve_module(module, source_path)?;
    if !visited.insert((resolved.clone(), exported_name.to_owned())) {
        return None;
    }
    local_forwarded_exports(&resolved)?
        .into_iter()
        .find_map(|export| match export {
            ForwardedExport::Namespace { exported, module } if exported == exported_name => {
                module_reexports_any_wasm(&module, &resolved, &mut HashSet::new()).then(|| {
                    resolve_module(&module, &resolved)
                        .map_or(module, |path| path.to_string_lossy().into_owned())
                })
            }
            ForwardedExport::Named {
                exported,
                imported,
                module,
            } if exported == exported_name => {
                module_exports_wasm_namespace(&module, &imported, &resolved, visited)
            }
            ForwardedExport::All { module } => {
                module_exports_wasm_namespace(&module, exported_name, &resolved, visited)
            }
            ForwardedExport::Named { .. } | ForwardedExport::Namespace { .. } => None,
        })
}

pub(super) fn wasm_factory_return_type(
    module: &str,
    exported_name: &str,
    source_path: &Path,
    wasm_type_names: &HashSet<String>,
) -> Option<String> {
    let mut visited = HashSet::new();
    module_factory_return_type(
        module,
        exported_name,
        source_path,
        wasm_type_names,
        &mut visited,
    )
}

fn module_factory_return_type(
    module: &str,
    exported_name: &str,
    source_path: &Path,
    wasm_type_names: &HashSet<String>,
    visited: &mut HashSet<(PathBuf, String)>,
) -> Option<String> {
    let resolved = resolve_module(module, source_path)?;
    if !visited.insert((resolved.clone(), exported_name.to_owned())) {
        return None;
    }
    if let Some(wasm_type) = local_factory_return_type(&resolved, exported_name, wasm_type_names) {
        return Some(wasm_type);
    }
    for export in local_forwarded_exports(&resolved)? {
        match export {
            ForwardedExport::All { module } => {
                if let Some(wasm_type) = module_factory_return_type(
                    &module,
                    exported_name,
                    &resolved,
                    wasm_type_names,
                    visited,
                ) {
                    return Some(wasm_type);
                }
            }
            ForwardedExport::Named {
                exported,
                imported,
                module,
            } if exported == exported_name => {
                return module_factory_return_type(
                    &module,
                    &imported,
                    &resolved,
                    wasm_type_names,
                    visited,
                );
            }
            ForwardedExport::Named { .. } | ForwardedExport::Namespace { .. } => {}
        }
    }
    None
}

fn local_factory_return_type(
    path: &Path,
    exported_name: &str,
    wasm_type_names: &HashSet<String>,
) -> Option<String> {
    let source = fs::read_to_string(path).ok()?;
    let language = if path
        .extension()
        .and_then(std::ffi::OsStr::to_str)
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
    collect_imported_bindings(tree.root_node(), &source, &mut imported_bindings);
    find_factory_return_type(
        tree.root_node(),
        &source,
        path,
        exported_name,
        wasm_type_names,
        &imported_bindings,
    )
}

fn find_factory_return_type(
    node: tree_sitter::Node<'_>,
    source: &str,
    source_path: &Path,
    exported_name: &str,
    wasm_type_names: &HashSet<String>,
    imported_bindings: &HashMap<String, (String, String)>,
) -> Option<String> {
    if exported_name == "default"
        && node.kind() == "export_statement"
        && node
            .utf8_text(source.as_bytes())
            .is_ok_and(|text| text.trim_start().starts_with("export default "))
        && let Some(local) = node
            .named_child(0)
            .filter(|child| child.kind() == "identifier")
            .and_then(|child| semantic_node_name(child, source))
    {
        let mut root = node;
        while let Some(parent) = root.parent() {
            root = parent;
        }
        return find_factory_return_type(
            root,
            source,
            source_path,
            &local,
            wasm_type_names,
            imported_bindings,
        );
    }
    if matches!(
        node.kind(),
        "function_declaration"
            | "generator_function_declaration"
            | "function_expression"
            | "generator_function"
            | "arrow_function"
    ) && (callable_name(node, source).is_some_and(|name| name == exported_name)
        || (exported_name == "default"
            && node.parent().is_some_and(|parent| {
                parent.kind() == "export_statement"
                    && parent
                        .utf8_text(source.as_bytes())
                        .is_ok_and(|text| text.trim_start().starts_with("export default "))
            })))
        && let Some(return_type) = node.child_by_field_name("return_type")
        && let Some(wasm_type) = referenced_wasm_type(
            return_type,
            source,
            source_path,
            wasm_type_names,
            imported_bindings,
        )
    {
        return Some(wasm_type);
    }
    let mut cursor = node.walk();
    node.named_children(&mut cursor).find_map(|child| {
        find_factory_return_type(
            child,
            source,
            source_path,
            exported_name,
            wasm_type_names,
            imported_bindings,
        )
    })
}

fn callable_name(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
    node.child_by_field_name("name")
        .and_then(|name| semantic_node_name(name, source))
        .or_else(|| {
            let declarator = node.parent()?;
            (declarator.kind() == "variable_declarator")
                .then(|| declarator.child_by_field_name("name"))
                .flatten()
                .and_then(|name| semantic_node_name(name, source))
        })
}

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
            && is_wasm_export(module, imported_name, source_path))
        .then(|| imported_name.clone());
    }
    wasm_type_names
        .contains(local_name)
        .then(|| local_name.to_owned())
}

fn module_reexports_any_wasm(
    module: &str,
    source_path: &Path,
    visited: &mut HashSet<PathBuf>,
) -> bool {
    if WASM_MODULE_ALIASES.contains(&module) {
        return true;
    }
    let Some(resolved) = resolve_module(module, source_path) else {
        return false;
    };
    if is_known_wasm_path(&strip_module_extension(resolved.clone())) {
        return true;
    }
    if !visited.insert(resolved.clone()) {
        return false;
    }
    local_forwarded_exports(&resolved).is_some_and(|exports| {
        exports.iter().any(|export| {
            let module = match export {
                ForwardedExport::All { module }
                | ForwardedExport::Named { module, .. }
                | ForwardedExport::Namespace { module, .. } => module,
            };
            module_reexports_any_wasm(module, &resolved, visited)
        })
    })
}

fn module_reexports_wasm_symbol(
    module: &str,
    exported_name: &str,
    source_path: &Path,
    visited: &mut HashSet<(PathBuf, String)>,
) -> bool {
    if WASM_MODULE_ALIASES.contains(&module) {
        return exported_name != "default";
    }
    let Some(resolved) = resolve_module(module, source_path) else {
        return false;
    };
    if is_known_wasm_path(&strip_module_extension(resolved.clone())) {
        return exported_name != "default";
    }
    if !visited.insert((resolved.clone(), exported_name.to_owned())) {
        return false;
    }
    local_forwarded_exports(&resolved).is_some_and(|exports| {
        let has_explicit = exports.iter().any(|export| {
            matches!(export, ForwardedExport::Named { exported, .. } if exported == exported_name)
        });
        exports.iter().any(|export| match export {
            ForwardedExport::Named {
                exported,
                imported,
                module,
            } if exported == exported_name => {
                module_reexports_wasm_symbol(module, imported, &resolved, visited)
            }
            ForwardedExport::All { module } if !has_explicit => {
                module_reexports_wasm_symbol(module, exported_name, &resolved, visited)
            }
            ForwardedExport::All { .. }
            | ForwardedExport::Named { .. }
            | ForwardedExport::Namespace { .. } => false,
        })
    })
}

fn resolve_module(module: &str, source_path: &Path) -> Option<PathBuf> {
    if Path::new(module).is_absolute() {
        return resolve_local_module(Path::new(module));
    }
    if !module.starts_with('.') {
        return configured_alias_path(module, source_path);
    }
    let parent = source_path.parent()?;
    let unresolved = normalize_local_module_path(&parent.join(module));
    let stripped = strip_module_extension(unresolved.clone());
    if is_known_wasm_path(&stripped) {
        return Some(unresolved);
    }
    resolve_local_module(&unresolved)
}

fn configured_alias_path(module: &str, source_path: &Path) -> Option<PathBuf> {
    for ancestor in source_path.ancestors() {
        if let Some(path) = tsconfig_alias_path(&ancestor.join("tsconfig.json"), module) {
            return resolve_local_module(&path);
        }
    }
    source_path.ancestors().find_map(|ancestor| {
        fs::read_dir(ancestor)
            .ok()?
            .filter_map(Result::ok)
            .find_map(|entry| {
                let config = entry.path().join("tsconfig.json");
                let path = tsconfig_alias_path(&config, module)?;
                resolve_local_module(&path)
            })
    })
}

fn tsconfig_alias_path(config: &Path, module: &str) -> Option<PathBuf> {
    let value: serde_json::Value = serde_json::from_str(&fs::read_to_string(config).ok()?).ok()?;
    let paths = value.get("compilerOptions")?.get("paths")?.as_object()?;
    paths.iter().find_map(|(alias, targets)| {
        let suffix = if let Some(prefix) = alias.strip_suffix('*') {
            module.strip_prefix(prefix)?
        } else if alias == module {
            ""
        } else {
            return None;
        };
        let target = targets.as_array()?.first()?.as_str()?;
        let target = target.strip_suffix('*').unwrap_or(target);
        Some(normalize_local_module_path(
            &config.parent()?.join(format!("{target}{suffix}")),
        ))
    })
}

fn is_known_wasm_path(path: &Path) -> bool {
    let path = path.to_string_lossy();
    WASM_MODULE_PATHS
        .iter()
        .any(|candidate| path == *candidate || path.ends_with(&format!("/{candidate}")))
}

fn resolve_local_module(path: &Path) -> Option<PathBuf> {
    if path.is_file() {
        return Some(path.to_path_buf());
    }
    if path.extension().is_none() {
        for extension in MODULE_EXTENSIONS {
            let candidate = path.with_extension(extension);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        for extension in MODULE_EXTENSIONS {
            let candidate = path.join(format!("index.{extension}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn local_forwarded_exports(path: &Path) -> Option<Vec<ForwardedExport>> {
    let source = fs::read_to_string(path).ok()?;
    let language = if path
        .extension()
        .and_then(std::ffi::OsStr::to_str)
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
    collect_imported_bindings(tree.root_node(), &source, &mut imported_bindings);
    let mut exports = Vec::new();
    collect_forwarded_exports(tree.root_node(), &source, &imported_bindings, &mut exports);
    Some(exports)
}

fn collect_imported_bindings(
    node: tree_sitter::Node<'_>,
    source: &str,
    bindings: &mut HashMap<String, (String, String)>,
) {
    if node.kind() == "import_statement" {
        let Some(module) = node
            .child_by_field_name("source")
            .and_then(|source_node| static_javascript_string(source_node, source))
        else {
            return;
        };
        collect_import_specifiers(node, source, &module, bindings);
        return;
    }
    if node.kind() == "variable_declarator"
        && let Some(local) = node
            .child_by_field_name("name")
            .and_then(|binding| semantic_node_name(binding, source))
        && let Some(module) = node
            .child_by_field_name("value")
            .and_then(|value| required_module(value, source))
    {
        bindings.insert(local, (module, "*".to_owned()));
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_imported_bindings(child, source, bindings);
    }
}

fn collect_import_specifiers(
    node: tree_sitter::Node<'_>,
    source: &str,
    module: &str,
    bindings: &mut HashMap<String, (String, String)>,
) {
    if node.kind() == "namespace_import" {
        let mut cursor = node.walk();
        if let Some(local) = node
            .named_children(&mut cursor)
            .find_map(|child| semantic_node_name(child, source))
        {
            bindings.insert(local, (module.to_owned(), "*".to_owned()));
        }
        return;
    }
    if node.kind() == "import_specifier"
        && let Some(imported_node) = node.child_by_field_name("name")
        && let Some(imported) = semantic_node_name(imported_node, source)
    {
        let local_node = node.child_by_field_name("alias").unwrap_or(imported_node);
        if let Some(local) = semantic_node_name(local_node, source) {
            bindings.insert(local, (module.to_owned(), imported));
        }
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_import_specifiers(child, source, module, bindings);
    }
}

fn collect_forwarded_exports(
    node: tree_sitter::Node<'_>,
    source: &str,
    imported_bindings: &HashMap<String, (String, String)>,
    exports: &mut Vec<ForwardedExport>,
) {
    if node.kind() == "export_statement" {
        collect_export_statement(node, source, imported_bindings, exports);
        return;
    }
    if node.kind() == "assignment_expression" {
        collect_commonjs_export(node, source, imported_bindings, exports);
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_forwarded_exports(child, source, imported_bindings, exports);
    }
}

fn collect_export_statement(
    node: tree_sitter::Node<'_>,
    source: &str,
    imported_bindings: &HashMap<String, (String, String)>,
    exports: &mut Vec<ForwardedExport>,
) {
    let direct_module = node
        .child_by_field_name("source")
        .and_then(|source_node| static_javascript_string(source_node, source));
    let mut saw_specifier = false;
    if let Some(module) = &direct_module
        && let Some(exported) = namespace_export_name(node, source)
    {
        exports.push(ForwardedExport::Namespace {
            exported,
            module: module.clone(),
        });
        return;
    }
    if direct_module.is_none() {
        exports.extend(exported_callable_declaration(
            node,
            source,
            imported_bindings,
        ));
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
            let Some(local) = semantic_node_name(local_node, source) else {
                continue;
            };
            let exported = specifier
                .child_by_field_name("alias")
                .and_then(|alias| semantic_node_name(alias, source))
                .unwrap_or_else(|| local.clone());
            if let Some(module) = &direct_module {
                exports.push(ForwardedExport::Named {
                    exported,
                    imported: local,
                    module: module.clone(),
                });
            } else if let Some((module, imported)) = imported_bindings.get(&local) {
                exports.push(ForwardedExport::Named {
                    exported,
                    imported: imported.clone(),
                    module: module.clone(),
                });
            }
        }
    }
    if !saw_specifier && let Some(module) = direct_module {
        exports.push(ForwardedExport::All { module });
    }
}

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
            .and_then(|child| semantic_node_name(*child, source))
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
                forwarded_namespace_member("default".to_owned(), value, source, imports)
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
            forwarded_namespace_member(
                semantic_node_name(declarator.child_by_field_name("name")?, source)?,
                declarator.child_by_field_name("value")?,
                source,
                imports,
            )
        })
        .collect()
}

fn forwarded_namespace_member(
    exported: String,
    value: tree_sitter::Node<'_>,
    source: &str,
    imports: &HashMap<String, (String, String)>,
) -> Option<ForwardedExport> {
    let namespace = value.child_by_field_name("object")?;
    let namespace_name = semantic_node_name(namespace, source)?;
    let (module, imported_namespace) = imports.get(&namespace_name)?;
    if imported_namespace != "*" {
        return None;
    }
    let imported = value
        .child_by_field_name("property")
        .or_else(|| value.child_by_field_name("index"))
        .and_then(|property| semantic_node_name(property, source))?;
    Some(ForwardedExport::Named {
        exported,
        imported,
        module: module.clone(),
    })
}

fn namespace_export_name(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
    let text = node.utf8_text(source.as_bytes()).ok()?.trim_start();
    if !text.starts_with("export * as ") {
        return None;
    }
    let remainder = text.strip_prefix("export * as ")?;
    let exported = remainder.split_whitespace().next()?;
    (!exported.is_empty()).then(|| exported.to_owned())
}

fn collect_commonjs_export(
    node: tree_sitter::Node<'_>,
    source: &str,
    imported_bindings: &HashMap<String, (String, String)>,
    exports: &mut Vec<ForwardedExport>,
) {
    let Some(left) = node.child_by_field_name("left") else {
        return;
    };
    if left
        .utf8_text(source.as_bytes())
        .is_ok_and(|text| text.trim() == "module.exports")
    {
        let Some(right) = node.child_by_field_name("right") else {
            return;
        };
        if right.kind() == "object" {
            let mut cursor = right.walk();
            exports.extend(right.named_children(&mut cursor).filter_map(|pair| {
                forwarded_namespace_member(
                    semantic_node_name(pair.child_by_field_name("key")?, source)?,
                    pair.child_by_field_name("value")?,
                    source,
                    imported_bindings,
                )
            }));
        } else if let Some((module, imported)) = forwarded_member(right, source, imported_bindings)
        {
            exports.push(ForwardedExport::Named {
                exported: "default".to_owned(),
                imported,
                module,
            });
        } else if let Some(module) = required_module(right, source) {
            exports.push(ForwardedExport::All { module });
        }
        return;
    }
    let Some(exported) = commonjs_named_export(left, source) else {
        return;
    };
    let Some((module, imported)) = node
        .child_by_field_name("right")
        .and_then(|right| forwarded_member(right, source, imported_bindings))
    else {
        return;
    };
    exports.push(ForwardedExport::Named {
        exported,
        imported,
        module,
    });
}

fn forwarded_member(
    node: tree_sitter::Node<'_>,
    source: &str,
    imported_bindings: &HashMap<String, (String, String)>,
) -> Option<(String, String)> {
    required_member(node, source).or_else(|| {
        let object = node.child_by_field_name("object")?;
        let name = semantic_node_name(object, source)?;
        let (module, namespace) = imported_bindings.get(&name)?;
        (namespace == "*").then(|| {
            let imported = node
                .child_by_field_name("property")
                .or_else(|| node.child_by_field_name("index"))
                .and_then(|property| semantic_node_name(property, source))?;
            Some((module.clone(), imported))
        })?
    })
}

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
        .and_then(|property| semantic_node_name(property, source))
}

fn required_member(node: tree_sitter::Node<'_>, source: &str) -> Option<(String, String)> {
    if !matches!(node.kind(), "member_expression" | "subscript_expression") {
        return None;
    }
    let object = node.child_by_field_name("object")?;
    let module = required_module(object, source)?;
    let imported = node
        .child_by_field_name("property")
        .or_else(|| node.child_by_field_name("index"))
        .and_then(|property| semantic_node_name(property, source))?;
    Some((module, imported))
}

fn required_module(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
    if node.kind() != "call_expression"
        || !node
            .child_by_field_name("function")?
            .utf8_text(source.as_bytes())
            .is_ok_and(|name| name == "require")
    {
        return None;
    }
    let arguments = node.child_by_field_name("arguments")?;
    let mut cursor = arguments.walk();
    arguments
        .named_children(&mut cursor)
        .find_map(|argument| static_javascript_string(argument, source))
}

fn strip_module_extension(mut path: PathBuf) -> PathBuf {
    if path
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|extension| MODULE_EXTENSIONS.contains(&extension))
    {
        path.set_extension("");
    }
    path
}

fn normalize_local_module_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            component => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{is_wasm_callable_export, is_wasm_callable_source};

    fn temp_root(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("nook-{name}-{}", std::process::id()))
    }

    #[test]
    fn follows_arbitrary_local_reexport_chains() -> Result<(), std::io::Error> {
        let root = temp_root("wasm-facade");
        fs::create_dir_all(&root)?;
        fs::write(root.join("bridge.ts"), "export * from '$app-wasm';")?;
        let consumer = root.join("consumer.ts");
        fs::write(&consumer, "")?;
        assert!(is_wasm_callable_source("./bridge", &consumer));
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn follows_import_then_export_facades() -> Result<(), std::io::Error> {
        let root = temp_root("wasm-import-export-facade");
        fs::create_dir_all(&root)?;
        fs::write(
            root.join("bridge.ts"),
            "import { generate_secret_id as secret } from '$app-wasm'; export { secret as generate_secret_id };",
        )?;
        let consumer = root.join("consumer.ts");
        fs::write(&consumer, "")?;
        assert!(is_wasm_callable_export(
            "./bridge",
            "generate_secret_id",
            &consumer,
        ));
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn follows_commonjs_facade_exports() -> Result<(), std::io::Error> {
        let root = temp_root("wasm-commonjs-facade");
        fs::create_dir_all(&root)?;
        fs::write(
            root.join("bridge.cjs"),
            "module.exports = require('nook-wasm');",
        )?;
        let consumer = root.join("consumer.ts");
        fs::write(&consumer, "")?;
        assert!(is_wasm_callable_export(
            "./bridge.cjs",
            "generate_secret_id",
            &consumer,
        ));
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn preserves_provenance_per_exported_symbol() -> Result<(), std::io::Error> {
        let root = temp_root("wasm-mixed-facade");
        fs::create_dir_all(&root)?;
        fs::write(
            root.join("bridge.ts"),
            "export { generate_secret_id } from '$app-wasm'; export { connect } from 'socket-lib';",
        )?;
        let consumer = root.join("consumer.ts");
        fs::write(&consumer, "")?;
        assert!(is_wasm_callable_export(
            "./bridge",
            "generate_secret_id",
            &consumer,
        ));
        assert!(!is_wasm_callable_export("./bridge", "connect", &consumer));
        fs::remove_dir_all(root)?;
        Ok(())
    }
}
