use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use proc_macro2::Span;
use syn::spanned::Spanned;
use syn::{Attribute, Expr, LitStr, Token};

use crate::Violation;

/// Finds authored `tsify(type = "...")` overrides that smuggle an absence
/// sentinel into a Rust-owned WASM contract.
///
/// `undefined`, `null`, and `void` are not domain states. A Rust boundary DTO
/// must expose a named enum when the field distinguishes states such as
/// configured/not-applicable, while truthful wire-format omission remains an
/// ordinary `Option<T>` without a handwritten TypeScript type override.
///
/// # Errors
///
/// Returns an error when the Rust source tree cannot be read or parsed.
pub fn rust_tsify_implicit_absence_overrides(root: &Path) -> io::Result<Vec<Violation>> {
    let source_root = root.join("nook-app");
    let mut files = Vec::new();
    collect_rust_files(&source_root, &mut files)?;

    let mut violations = Vec::new();
    for path in files {
        let source = fs::read_to_string(&path)?;
        let syntax = syn::parse_file(&source).map_err(io::Error::other)?;
        let relative_path = path.strip_prefix(root).unwrap_or(&path).to_path_buf();
        collect_item_violations(&syntax.items, &relative_path, &mut violations);
    }

    violations.sort_by(|left, right| left.path.cmp(&right.path).then(left.line.cmp(&right.line)));
    violations.dedup();
    Ok(violations)
}

fn collect_rust_files(directory: &Path, files: &mut Vec<PathBuf>) -> io::Result<()> {
    if !directory.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.is_dir() {
            if !path
                .file_name()
                .and_then(std::ffi::OsStr::to_str)
                .is_some_and(|name| matches!(name, "target" | "node_modules"))
            {
                collect_rust_files(&path, files)?;
            }
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            files.push(path);
        }
    }
    Ok(())
}

fn collect_item_violations(items: &[syn::Item], path: &Path, violations: &mut Vec<Violation>) {
    for item in items {
        match item {
            syn::Item::Const(item) => collect_attribute_violations(&item.attrs, path, violations),
            syn::Item::Enum(item) => {
                collect_attribute_violations(&item.attrs, path, violations);
                for variant in &item.variants {
                    collect_attribute_violations(&variant.attrs, path, violations);
                    for field in &variant.fields {
                        collect_attribute_violations(&field.attrs, path, violations);
                    }
                }
            }
            syn::Item::Fn(item) => collect_attribute_violations(&item.attrs, path, violations),
            syn::Item::Impl(item) => {
                collect_attribute_violations(&item.attrs, path, violations);
                for impl_item in &item.items {
                    if let syn::ImplItem::Fn(function) = impl_item {
                        collect_attribute_violations(&function.attrs, path, violations);
                    }
                }
            }
            syn::Item::Mod(item) => {
                collect_attribute_violations(&item.attrs, path, violations);
                if let Some((_, nested)) = &item.content {
                    collect_item_violations(nested, path, violations);
                }
            }
            syn::Item::Static(item) => collect_attribute_violations(&item.attrs, path, violations),
            syn::Item::Struct(item) => {
                collect_attribute_violations(&item.attrs, path, violations);
                for field in &item.fields {
                    collect_attribute_violations(&field.attrs, path, violations);
                }
            }
            syn::Item::Trait(item) => {
                collect_attribute_violations(&item.attrs, path, violations);
                for trait_item in &item.items {
                    if let syn::TraitItem::Fn(function) = trait_item {
                        collect_attribute_violations(&function.attrs, path, violations);
                    }
                }
            }
            syn::Item::Type(item) => collect_attribute_violations(&item.attrs, path, violations),
            _ => {}
        }
    }
}

fn collect_attribute_violations(
    attributes: &[Attribute],
    path: &Path,
    violations: &mut Vec<Violation>,
) {
    for attribute in attributes {
        if tsify_type_override(attribute)
            .as_deref()
            .is_some_and(contains_absence_sentinel)
        {
            violations.push(Violation {
                path: path.to_path_buf(),
                line: span_line(attribute.span()),
            });
        }
    }
}

fn tsify_type_override(attribute: &Attribute) -> Option<String> {
    if !attribute.path().is_ident("tsify") {
        return None;
    }
    let mut type_override = None;
    attribute
        .parse_nested_meta(|meta| {
            if meta.path.is_ident("type") {
                type_override = Some(meta.value()?.parse::<LitStr>()?.value());
            } else if meta.input.peek(Token![=]) {
                let _ = meta.value()?.parse::<Expr>()?;
            }
            Ok(())
        })
        .ok()?;
    type_override
}

fn contains_absence_sentinel(value: &str) -> bool {
    value
        .split(|character: char| !(character.is_ascii_alphanumeric() || character == '_'))
        .any(|token| matches!(token, "undefined" | "null" | "void"))
}

fn span_line(span: Span) -> usize {
    span.start().line
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_tsify_absence_overrides_but_allows_named_types() -> anyhow::Result<()> {
        let root =
            std::env::temp_dir().join(format!("nook-rust-tsify-state-{}", std::process::id()));
        let source_root = root.join("nook-app/nook-core/src");
        if root.exists() {
            fs::remove_dir_all(&root)?;
        }
        fs::create_dir_all(&source_root)?;
        fs::write(
            source_root.join("boundary.rs"),
            r#"
pub struct Boundary {
#[tsify(type = "OAuthFilePreset | undefined")]
pub oauth_preset: Option<String>,
#[tsify(type = "string | null")]
pub account_email: Option<String>,
#[tsify(type = "StorageProviderType")]
pub provider_type: String,
}
"#,
        )?;

        let violations = rust_tsify_implicit_absence_overrides(&root)?;
        assert_eq!(
            violations,
            vec![
                Violation {
                    path: PathBuf::from("nook-app/nook-core/src/boundary.rs"),
                    line: 3,
                },
                Violation {
                    path: PathBuf::from("nook-app/nook-core/src/boundary.rs"),
                    line: 5,
                },
            ]
        );
        fs::remove_dir_all(root)?;
        Ok(())
    }
}
