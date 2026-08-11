use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::javascript_literals::static_javascript_string;

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

pub(super) fn is_wasm_callable_source(module: &str, source_path: &Path) -> bool {
    let mut visited = HashSet::new();
    module_reexports_wasm(module, source_path, &mut visited)
}

fn module_reexports_wasm(module: &str, source_path: &Path, visited: &mut HashSet<PathBuf>) -> bool {
    if WASM_MODULE_ALIASES.contains(&module) {
        return true;
    }
    if !module.starts_with('.') {
        return false;
    }
    let Some(parent) = source_path.parent() else {
        return false;
    };
    let unresolved = normalize_local_module_path(&parent.join(module));
    let stripped = strip_module_extension(unresolved.clone());
    if is_known_wasm_path(&stripped) {
        return true;
    }
    let Some(resolved) = resolve_local_module(&unresolved) else {
        return false;
    };
    if !visited.insert(resolved.clone()) {
        return false;
    }
    local_module_sources(&resolved).is_some_and(|sources| {
        sources
            .iter()
            .any(|source| module_reexports_wasm(source, &resolved, visited))
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

fn local_module_sources(path: &Path) -> Option<Vec<String>> {
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
    let mut sources = Vec::new();
    let mut imported_bindings = HashMap::new();
    collect_imported_bindings(tree.root_node(), &source, &mut imported_bindings);
    collect_reexport_sources(tree.root_node(), &source, &imported_bindings, &mut sources);
    Some(sources)
}

fn collect_imported_bindings(
    node: tree_sitter::Node<'_>,
    source: &str,
    bindings: &mut HashMap<String, String>,
) {
    if node.kind() == "import_statement" {
        let Some(source_node) = node.child_by_field_name("source") else {
            return;
        };
        let Some(module) = static_javascript_string(source_node, source) else {
            return;
        };
        collect_import_binding_names(node, source, &module, bindings);
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_imported_bindings(child, source, bindings);
    }
}

fn collect_import_binding_names(
    node: tree_sitter::Node<'_>,
    source: &str,
    module: &str,
    bindings: &mut HashMap<String, String>,
) {
    if matches!(node.kind(), "import_specifier" | "namespace_import") {
        let binding = node
            .child_by_field_name("alias")
            .or_else(|| node.child_by_field_name("name"))
            .or_else(|| {
                let mut cursor = node.walk();
                node.named_children(&mut cursor)
                    .find(|child| child.kind() == "identifier")
            });
        if let Some(name) = binding.and_then(|binding| semantic_node_name(binding, source)) {
            bindings.insert(name, module.to_owned());
        }
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_import_binding_names(child, source, module, bindings);
    }
}

fn collect_reexport_sources(
    node: tree_sitter::Node<'_>,
    source: &str,
    imported_bindings: &HashMap<String, String>,
    sources: &mut Vec<String>,
) {
    if node.kind() == "export_statement" {
        if let Some(source_node) = node.child_by_field_name("source")
            && let Some(module) = static_javascript_string(source_node, source)
        {
            sources.push(module);
        } else {
            collect_locally_reexported_imports(node, source, imported_bindings, sources);
        }
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_reexport_sources(child, source, imported_bindings, sources);
    }
}

fn collect_locally_reexported_imports(
    node: tree_sitter::Node<'_>,
    source: &str,
    imported_bindings: &HashMap<String, String>,
    sources: &mut Vec<String>,
) {
    if node.kind() == "export_specifier"
        && let Some(local) = node.child_by_field_name("name")
        && let Some(name) = semantic_node_name(local, source)
        && let Some(module) = imported_bindings.get(&name)
    {
        sources.push(module.clone());
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_locally_reexported_imports(child, source, imported_bindings, sources);
    }
}

fn semantic_node_name(node: tree_sitter::Node<'_>, source: &str) -> Option<String> {
    let text = node.utf8_text(source.as_bytes()).ok()?;
    if node.kind() == "string" {
        static_javascript_string(node, source)
    } else {
        Some(text.to_owned())
    }
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

    use super::is_wasm_callable_source;

    #[test]
    fn follows_arbitrary_local_reexport_chains() -> Result<(), std::io::Error> {
        let root = std::env::temp_dir().join(format!("nook-wasm-facade-{}", std::process::id()));
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
        let root = std::env::temp_dir().join(format!(
            "nook-wasm-import-export-facade-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root)?;
        fs::write(
            root.join("bridge.ts"),
            "import { generate_secret_id } from '$app-wasm'; export { generate_secret_id };",
        )?;
        let consumer = root.join("consumer.ts");
        fs::write(&consumer, "")?;
        assert!(is_wasm_callable_source("./bridge", &consumer));
        fs::remove_dir_all(root)?;
        Ok(())
    }
}
