use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use syn::spanned::Spanned;
use syn::visit::Visit;
use syn::{Attribute, ItemFn, Macro};

use crate::Violation;

const EXCLUDED_DIRECTORIES: &[&str] = &[
    ".git",
    ".svelte-kit",
    ".wrangler",
    "coverage",
    "dist",
    "node_modules",
    "target",
];

/// Finds repository-defined declarative and procedural Rust macros.
///
/// External derives, attributes, and macro invocations are deliberately not
/// violations. This check rejects the macro definitions controlled by the
/// repository while allowing required compiler and ecosystem integration.
///
/// # Errors
///
/// Returns an error when authored Rust cannot be read or parsed.
pub fn authored_rust_macro_definitions(root: &Path) -> io::Result<Vec<Violation>> {
    let mut files = Vec::new();
    collect_rust_files(root, &mut files)?;

    let mut violations = Vec::new();
    for path in files {
        let source = fs::read_to_string(&path)?;
        let syntax = syn::parse_file(&source).map_err(|error| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("failed to parse {}: {error}", path.display()),
            )
        })?;
        let mut visitor = MacroDefinitionVisitor::default();
        visitor.visit_file(&syntax);
        violations.extend(visitor.lines.into_iter().map(|line| Violation {
            path: path.strip_prefix(root).unwrap_or(&path).to_path_buf(),
            line,
        }));
    }

    violations.sort_by(|left, right| left.path.cmp(&right.path).then(left.line.cmp(&right.line)));
    violations.dedup();
    Ok(violations)
}

fn collect_rust_files(directory: &Path, files: &mut Vec<PathBuf>) -> io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            if !path
                .file_name()
                .and_then(std::ffi::OsStr::to_str)
                .is_some_and(|name| EXCLUDED_DIRECTORIES.contains(&name))
            {
                collect_rust_files(&path, files)?;
            }
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            files.push(path);
        }
    }
    Ok(())
}

#[derive(Default)]
struct MacroDefinitionVisitor {
    lines: Vec<usize>,
}

impl MacroDefinitionVisitor {
    fn is_procedural_macro(attributes: &[Attribute]) -> bool {
        attributes.iter().any(|attribute| {
            attribute.path().is_ident("proc_macro")
                || attribute.path().is_ident("proc_macro_attribute")
                || attribute.path().is_ident("proc_macro_derive")
        })
    }
}

impl<'ast> Visit<'ast> for MacroDefinitionVisitor {
    fn visit_macro(&mut self, value: &'ast Macro) {
        if value.path.is_ident("macro_rules") {
            self.lines.push(value.path.span().start().line);
        }
        syn::visit::visit_macro(self, value);
    }

    fn visit_item_fn(&mut self, item: &'ast ItemFn) {
        if Self::is_procedural_macro(&item.attrs) {
            self.lines.push(item.span().start().line);
        }
        syn::visit::visit_item_fn(self, item);
    }
}

#[cfg(test)]
mod tests {
    use super::MacroDefinitionVisitor;
    use syn::visit::Visit;

    #[test]
    fn finds_declarative_and_procedural_macro_definitions() -> anyhow::Result<()> {
        let source = [
            "\nmacro_",
            "rules! repeated_items { () => {}; }\nfn local() {\n    macro_",
            "rules! local_items { () => {}; }\n}\n#[pro",
            "c_macro_attribute]\npub fn generated(_attribute: TokenStream, item: TokenStream) -> TokenStream { item }\n",
        ]
        .concat();
        let syntax = syn::parse_file(&source)?;
        let mut visitor = MacroDefinitionVisitor::default();
        visitor.visit_file(&syntax);
        assert_eq!(visitor.lines, vec![2, 4, 6]);
        Ok(())
    }

    #[test]
    fn allows_external_macro_invocations_and_attributes() -> anyhow::Result<()> {
        let syntax = syn::parse_file(
            r#"
                #[derive(Debug, serde::Serialize)]
                struct Visible;
                external_items! { struct Generated; }
                fn verify() { assert!(true); }
            "#,
        )?;
        let mut visitor = MacroDefinitionVisitor::default();
        visitor.visit_file(&syntax);
        assert!(visitor.lines.is_empty());
        Ok(())
    }
}
