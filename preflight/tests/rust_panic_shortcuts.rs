use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use syn::spanned::Spanned;
use syn::visit::Visit;
use syn::{Attribute, ExprMethodCall, ItemFn, ItemMod, ItemUse, Macro, UseTree};

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

fn is_rust_test_source(path: &Path) -> bool {
    path.components()
        .any(|component| component.as_os_str() == "tests")
        || path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .is_some_and(|stem| stem == "test" || stem.ends_with("_test") || stem.ends_with("_tests"))
}

#[test]
fn rust_test_sources_are_classified_without_exempting_production_modules() {
    assert!(is_rust_test_source(Path::new(
        "crate/src/manager/event_log_browser_tests.rs"
    )));
    assert!(is_rust_test_source(Path::new(
        "crate/tests/event_log_browser.rs"
    )));
    assert!(!is_rust_test_source(Path::new(
        "crate/src/manager/event_log_browser.rs"
    )));
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
fn anyhow_is_available_only_to_rust_tests() -> Result<()> {
    let root = repository_root();
    let mut files = Vec::new();
    collect_rust_files(&root, &mut files)?;

    let mut violations = Vec::new();
    for path in files {
        if is_rust_test_source(&path) {
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
        self.in_test |= Self::cfg_test(&function.attrs);
        syn::visit::visit_item_fn(self, function);
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
        syn::visit::visit_expr_method_call(self, call);
    }

    fn visit_item_use(&mut self, item: &'ast ItemUse) {
        if !self.in_test {
            self.inspect_use_tree(&item.tree);
        }
        syn::visit::visit_item_use(self, item);
    }

    fn visit_macro(&mut self, value: &'ast Macro) {
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
