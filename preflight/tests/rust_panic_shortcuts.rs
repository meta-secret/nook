use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use syn::spanned::Spanned;
use syn::visit::Visit;
use syn::{
    Attribute, Expr, ExprIndex, ExprMethodCall, ItemFn, ItemMod, ItemUse, Local, Macro, Pat, Type,
    UseTree,
};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .map_or_else(
                    || PathBuf::from(env!("CARGO_MANIFEST_DIR")),
                    Path::to_path_buf,
                )
        },
        PathBuf::from,
    )
}

fn collect_rust_files(directory: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
    for entry in fs::read_dir(directory)
        .with_context(|| format!("read directory {}", directory.display()))?
    {
        let path = entry?.path();
        if path.is_dir() {
            if !matches!(
                path.file_name().and_then(|name| name.to_str()),
                Some(".git" | "target")
            ) {
                collect_rust_files(&path, files)?;
            }
        } else if path.extension().and_then(|extension| extension.to_str()) == Some("rs") {
            files.push(path);
        }
    }
    Ok(())
}

#[test]
fn every_rust_workspace_denies_panic_shortcut_lints() -> Result<()> {
    let root = repository_root();
    for relative in [
        "nook-app/Cargo.toml",
        "agentic-ai/minds/Cargo.toml",
        "preflight/Cargo.toml",
    ] {
        let manifest =
            fs::read_to_string(root.join(relative)).with_context(|| format!("read {relative}"))?;
        for lint in ["expect_used = \"deny\"", "unwrap_used = \"deny\""] {
            if !manifest.contains(lint) {
                bail!("{relative} must configure {lint}");
            }
        }
    }
    Ok(())
}

#[test]
fn authored_rust_never_calls_expect() -> Result<()> {
    let root = repository_root();
    let mut files = Vec::new();
    collect_rust_files(&root, &mut files)?;

    let mut violations = Vec::new();
    for path in files {
        let source =
            fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
        let syntax = syn::parse_file(&source)
            .with_context(|| format!("parse authored Rust {}", path.display()))?;
        let mut visitor = RustPolicyVisitor::default();
        visitor.visit_file(&syntax);
        for violation in visitor.panic_shortcuts {
            violations.push(format!(
                "{}:{violation}",
                path.strip_prefix(&root).unwrap_or(&path).display()
            ));
        }
    }
    if !violations.is_empty() {
        bail!(
            "authored Rust must propagate errors with Result and ?: {}",
            violations.join(", ")
        );
    }
    Ok(())
}

#[test]
fn rust_tests_assert_known_json_through_typed_contracts() -> Result<()> {
    let root = repository_root();
    let mut files = Vec::new();
    collect_rust_files(&root, &mut files)?;

    let mut violations = Vec::new();
    for path in files {
        let source =
            fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
        let syntax = syn::parse_file(&source)
            .with_context(|| format!("parse authored Rust {}", path.display()))?;
        let mut visitor = RustPolicyVisitor {
            in_test: path
                .components()
                .any(|component| component.as_os_str() == "tests"),
            ..RustPolicyVisitor::default()
        };
        visitor.visit_file(&syntax);
        visitor.untyped_json_assertions.sort_unstable();
        visitor.untyped_json_assertions.dedup();
        for line in visitor.untyped_json_assertions {
            violations.push(format!(
                "{}:{line}",
                path.strip_prefix(&root).unwrap_or(&path).display()
            ));
        }
    }

    if !violations.is_empty() {
        bail!(
            "known JSON test contracts must round-trip through concrete Rust types; raw Value indexing and is_null assertions are forbidden: {}",
            violations.join(", ")
        );
    }
    Ok(())
}

#[test]
fn typed_json_checker_reports_raw_value_assertions() -> Result<()> {
    let syntax = syn::parse_file(
        r#"
#[cfg(test)]
mod tests {
    #[test]
    fn raw_json() {
        let json = serde_json::to_value(&42);
        assert_eq!(json["kind"], "answer");
        assert!(json["optional"].is_null());
    }
}
"#,
    )?;
    let mut visitor = RustPolicyVisitor::default();
    visitor.visit_file(&syntax);
    visitor.untyped_json_assertions.sort_unstable();
    visitor.untyped_json_assertions.dedup();
    assert_eq!(visitor.untyped_json_assertions, vec![7, 8]);
    Ok(())
}

#[test]
fn anyhow_is_available_only_to_rust_tests() -> Result<()> {
    let root = repository_root();
    let mut files = Vec::new();
    collect_rust_files(&root, &mut files)?;

    let mut violations = Vec::new();
    for path in files {
        if path
            .components()
            .any(|component| component.as_os_str() == "tests")
        {
            continue;
        }
        let source =
            fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
        let syntax = syn::parse_file(&source)
            .with_context(|| format!("parse authored Rust {}", path.display()))?;
        let mut visitor = RustPolicyVisitor::default();
        visitor.visit_file(&syntax);
        for line in visitor.production_anyhow {
            violations.push(format!(
                "{}:{line}",
                path.strip_prefix(&root).unwrap_or(&path).display()
            ));
        }
    }

    let mut manifests = Vec::new();
    collect_named_files(&root, "Cargo.toml", &mut manifests)?;
    for manifest_path in manifests {
        let manifest = fs::read_to_string(&manifest_path)
            .with_context(|| format!("read {}", manifest_path.display()))?;
        let mut section = "";
        for (index, line) in manifest.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with('[') {
                section = trimmed;
            } else if trimmed.starts_with("anyhow")
                && section.ends_with("dependencies]")
                && !section.ends_with("dev-dependencies]")
                && section != "[workspace.dependencies]"
            {
                violations.push(format!(
                    "{}:{}",
                    manifest_path
                        .strip_prefix(&root)
                        .unwrap_or(&manifest_path)
                        .display(),
                    index + 1
                ));
            }
        }
    }

    if !violations.is_empty() {
        bail!(
            "anyhow is test-only; production Rust must expose concrete typed errors: {}",
            violations.join(", ")
        );
    }
    Ok(())
}

fn collect_named_files(directory: &Path, name: &str, files: &mut Vec<PathBuf>) -> Result<()> {
    for entry in fs::read_dir(directory)
        .with_context(|| format!("read directory {}", directory.display()))?
    {
        let path = entry?.path();
        if path.is_dir() {
            if !matches!(
                path.file_name().and_then(|value| value.to_str()),
                Some(".git" | "target")
            ) {
                collect_named_files(&path, name, files)?;
            }
        } else if path.file_name().and_then(|value| value.to_str()) == Some(name) {
            files.push(path);
        }
    }
    Ok(())
}

#[derive(Default)]
struct RustPolicyVisitor {
    panic_shortcuts: Vec<String>,
    production_anyhow: Vec<usize>,
    untyped_json_assertions: Vec<usize>,
    json_value_bindings: std::collections::HashSet<String>,
    in_test: bool,
}

impl RustPolicyVisitor {
    fn cfg_test(attributes: &[Attribute]) -> bool {
        attributes.iter().any(|attribute| {
            attribute.path().is_ident("cfg")
                && attribute
                    .meta
                    .require_list()
                    .is_ok_and(|list| list.tokens.to_string().contains("test"))
        })
    }

    fn test_attribute(attributes: &[Attribute]) -> bool {
        attributes.iter().any(|attribute| {
            attribute.path().is_ident("test") || Self::cfg_test(std::slice::from_ref(attribute))
        })
    }

    fn local_identifier(pattern: &Pat) -> Option<&syn::Ident> {
        match pattern {
            Pat::Ident(identifier) => Some(&identifier.ident),
            Pat::Type(typed) => Self::local_identifier(&typed.pat),
            _ => None,
        }
    }

    fn type_is_json_value(pattern: &Pat) -> bool {
        let Pat::Type(typed) = pattern else {
            return false;
        };
        matches!(
            typed.ty.as_ref(),
            Type::Path(path)
                if path
                    .path
                    .segments
                    .last()
                    .is_some_and(|segment| segment.ident == "Value")
        )
    }

    fn expression_produces_json_value(expression: &Expr) -> bool {
        match expression {
            Expr::Call(call) => {
                let Expr::Path(function) = call.func.as_ref() else {
                    return false;
                };
                function.path.segments.last().is_some_and(|segment| {
                    matches!(segment.ident.to_string().as_str(), "to_json" | "to_value")
                })
            }
            Expr::Macro(value) => value
                .mac
                .path
                .segments
                .last()
                .is_some_and(|segment| segment.ident == "json"),
            Expr::Try(value) => Self::expression_produces_json_value(&value.expr),
            Expr::Await(value) => Self::expression_produces_json_value(&value.base),
            Expr::Group(value) => Self::expression_produces_json_value(&value.expr),
            Expr::Paren(value) => Self::expression_produces_json_value(&value.expr),
            _ => false,
        }
    }

    fn indexed_root_identifier(expression: &Expr) -> Option<&syn::Ident> {
        match expression {
            Expr::Path(path) if path.path.segments.len() == 1 => {
                path.path.segments.first().map(|segment| &segment.ident)
            }
            Expr::Index(index) => Self::indexed_root_identifier(&index.expr),
            Expr::Group(value) => Self::indexed_root_identifier(&value.expr),
            Expr::Paren(value) => Self::indexed_root_identifier(&value.expr),
            Expr::Reference(value) => Self::indexed_root_identifier(&value.expr),
            _ => None,
        }
    }

    fn receiver_is_json_value(&self, expression: &Expr) -> bool {
        Self::indexed_root_identifier(expression).is_some_and(|identifier| {
            let name = identifier.to_string();
            name == "json" || name.ends_with("_json") || self.json_value_bindings.contains(&name)
        })
    }

    fn macro_contains_untyped_json_assertion(&self, value: &Macro) -> bool {
        let tokens = value.tokens.to_string();
        self.json_value_bindings
            .iter()
            .map(String::as_str)
            .chain(std::iter::once("json"))
            .any(|binding| {
                let mut remaining = tokens.as_str();
                let index_prefix = format!("{binding} [");
                while let Some(index) = remaining.find(&index_prefix) {
                    let after_prefix = &remaining[index + index_prefix.len()..];
                    if after_prefix.trim_start().starts_with('"') {
                        return true;
                    }
                    remaining = after_prefix;
                }
                tokens.contains(&format!("{binding} . is_null"))
            })
    }

    fn inspect_use_tree(&mut self, tree: &UseTree) {
        match tree {
            UseTree::Path(path) if path.ident == "anyhow" => {
                self.production_anyhow.push(path.ident.span().start().line);
            }
            UseTree::Path(path) => self.inspect_use_tree(&path.tree),
            UseTree::Group(group) => {
                for item in &group.items {
                    self.inspect_use_tree(item);
                }
            }
            UseTree::Name(_) | UseTree::Rename(_) | UseTree::Glob(_) => {}
        }
    }
}

impl<'ast> Visit<'ast> for RustPolicyVisitor {
    fn visit_item_fn(&mut self, function: &'ast ItemFn) {
        let was_in_test = self.in_test;
        let previous_bindings = std::mem::take(&mut self.json_value_bindings);
        self.in_test |= Self::test_attribute(&function.attrs);
        syn::visit::visit_item_fn(self, function);
        self.json_value_bindings = previous_bindings;
        self.in_test = was_in_test;
    }

    fn visit_item_mod(&mut self, module: &'ast ItemMod) {
        let was_in_test = self.in_test;
        self.in_test |= Self::cfg_test(&module.attrs);
        syn::visit::visit_item_mod(self, module);
        self.in_test = was_in_test;
    }

    fn visit_expr_method_call(&mut self, call: &'ast ExprMethodCall) {
        if matches!(call.method.to_string().as_str(), "expect" | "expect_err") {
            self.panic_shortcuts.push(format!(
                "{}:{}",
                call.method.span().start().line,
                call.method
            ));
        }
        if self.in_test && call.method == "is_null" && self.receiver_is_json_value(&call.receiver) {
            self.untyped_json_assertions
                .push(call.method.span().start().line);
        }
        syn::visit::visit_expr_method_call(self, call);
    }

    fn visit_expr_index(&mut self, index: &'ast ExprIndex) {
        if self.in_test && self.receiver_is_json_value(&index.expr) {
            self.untyped_json_assertions
                .push(index.bracket_token.span.open().start().line);
        }
        syn::visit::visit_expr_index(self, index);
    }

    fn visit_local(&mut self, local: &'ast Local) {
        if self.in_test
            && let Some(identifier) = Self::local_identifier(&local.pat)
            && (Self::type_is_json_value(&local.pat)
                || local
                    .init
                    .as_ref()
                    .is_some_and(|init| Self::expression_produces_json_value(&init.expr)))
        {
            self.json_value_bindings.insert(identifier.to_string());
        }
        syn::visit::visit_local(self, local);
    }

    fn visit_item_use(&mut self, item: &'ast ItemUse) {
        if !self.in_test {
            self.inspect_use_tree(&item.tree);
        }
        syn::visit::visit_item_use(self, item);
    }

    fn visit_macro(&mut self, value: &'ast Macro) {
        if self.in_test && self.macro_contains_untyped_json_assertion(value) {
            self.untyped_json_assertions
                .push(value.path.span().start().line);
        }
        if !self.in_test
            && value
                .path
                .segments
                .first()
                .is_some_and(|segment| segment.ident == "anyhow")
        {
            self.production_anyhow.push(value.path.span().start().line);
        }
        syn::visit::visit_macro(self, value);
    }

    fn visit_path(&mut self, path: &'ast syn::Path) {
        if !self.in_test
            && path
                .segments
                .first()
                .is_some_and(|segment| segment.ident == "anyhow")
        {
            self.production_anyhow.push(path.span().start().line);
        }
        syn::visit::visit_path(self, path);
    }
}
