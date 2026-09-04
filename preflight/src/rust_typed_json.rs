use crate::Violation;
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::{iter, mem, slice};
use syn::spanned::Spanned;
use syn::visit::{self, Visit};
use syn::{Attribute, Expr, ExprIndex, ExprMethodCall, ItemFn, ItemMod, Local, Macro, Pat, Type};

/// Finds raw JSON field-value assertions in authored Rust tests.
///
/// Known contracts must round-trip through concrete Rust types. Structural
/// `.get()` checks remain available for exact property omission or renaming.
///
/// # Errors
///
/// Returns an error when authored Rust cannot be read or parsed.
pub fn rust_test_untyped_json_assertions(root: &Path) -> io::Result<Vec<Violation>> {
    let mut files = Vec::new();
    collect_rust_files(root, &mut files)?;

    let mut violations = Vec::new();
    for path in files {
        let source = fs::read_to_string(&path)?;
        let syntax = syn::parse_file(&source).map_err(|error| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("failed to parse authored Rust {}: {error}", path.display()),
            )
        })?;
        let mut visitor = TypedJsonAssertionVisitor {
            in_test: path
                .components()
                .any(|component| component.as_os_str() == "tests"),
            ..TypedJsonAssertionVisitor::default()
        };
        visitor.visit_file(&syntax);
        visitor.lines.sort_unstable();
        visitor.lines.dedup();
        violations.extend(visitor.lines.into_iter().map(|line| Violation {
            path: path.strip_prefix(root).unwrap_or(&path).to_path_buf(),
            line,
        }));
    }
    violations.sort_by(|left, right| left.path.cmp(&right.path).then(left.line.cmp(&right.line)));
    Ok(violations)
}

fn collect_rust_files(directory: &Path, files: &mut Vec<PathBuf>) -> io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            if !matches!(
                path.file_name().and_then(|name| name.to_str()),
                Some(".git" | "node_modules" | "target")
            ) {
                collect_rust_files(&path, files)?;
            }
        } else if path.extension().and_then(|extension| extension.to_str()) == Some("rs") {
            files.push(path);
        }
    }
    Ok(())
}

#[derive(Default)]
struct TypedJsonAssertionVisitor {
    lines: Vec<usize>,
    json_value_bindings: HashSet<String>,
    in_test: bool,
}

impl TypedJsonAssertionVisitor {
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
            attribute.path().is_ident("test") || Self::cfg_test(slice::from_ref(attribute))
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
            .chain(iter::once("json"))
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
}

impl<'ast> Visit<'ast> for TypedJsonAssertionVisitor {
    fn visit_item_fn(&mut self, function: &'ast ItemFn) {
        let was_in_test = self.in_test;
        let previous_bindings = mem::take(&mut self.json_value_bindings);
        self.in_test |= Self::test_attribute(&function.attrs);
        visit::visit_item_fn(self, function);
        self.json_value_bindings = previous_bindings;
        self.in_test = was_in_test;
    }

    fn visit_item_mod(&mut self, module: &'ast ItemMod) {
        let was_in_test = self.in_test;
        self.in_test |= Self::cfg_test(&module.attrs);
        visit::visit_item_mod(self, module);
        self.in_test = was_in_test;
    }

    fn visit_expr_method_call(&mut self, call: &'ast ExprMethodCall) {
        if self.in_test && call.method == "is_null" && self.receiver_is_json_value(&call.receiver) {
            self.lines.push(call.method.span().start().line);
        }
        visit::visit_expr_method_call(self, call);
    }

    fn visit_expr_index(&mut self, index: &'ast ExprIndex) {
        if self.in_test && self.receiver_is_json_value(&index.expr) {
            self.lines
                .push(index.bracket_token.span.open().start().line);
        }
        visit::visit_expr_index(self, index);
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
        visit::visit_local(self, local);
    }

    fn visit_macro(&mut self, value: &'ast Macro) {
        if self.in_test && self.macro_contains_untyped_json_assertion(value) {
            self.lines.push(value.path.span().start().line);
        }
        visit::visit_macro(self, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_raw_value_assertions_but_allows_structural_get() -> anyhow::Result<()> {
        let syntax = syn::parse_file(
            r#"
#[cfg(test)]
mod tests {
    #[test]
    fn raw_json() {
        let json = serde_json::to_value(&42);
        assert_eq!(json["kind"], "answer");
        assert!(json["optional"].is_null());
        assert!(json.get("renamedField").is_some());
    }
}
"#,
        )?;
        let mut visitor = TypedJsonAssertionVisitor::default();
        visitor.visit_file(&syntax);
        visitor.lines.sort_unstable();
        visitor.lines.dedup();
        assert_eq!(visitor.lines, vec![7, 8]);
        Ok(())
    }
}
