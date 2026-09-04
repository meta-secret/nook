use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use proc_macro2::Span;
use syn::spanned::Spanned;
use syn::visit::{self, Visit};
use syn::{
    Attribute, Expr, FnArg, ImplItemFn, ItemFn, LitStr, ReturnType, Signature, Token, Type,
    Visibility,
};

use crate::Violation;

/// Finds Rust-owned WASM contracts that generate implicit JavaScript absence.
///
/// `undefined`, `null`, and `void` are not domain states. A Rust boundary DTO
/// must expose a named enum when a field or function parameter distinguishes
/// states such as configured/not-applicable. `Option<T>` remains idiomatic
/// inside Rust, but a `Tsify` field or `wasm_bindgen` function signature would
/// compile that unnamed absence into the generated TypeScript contract.
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
                .and_then(OsStr::to_str)
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
                let exported_by_tsify = derives_tsify(&item.attrs);
                for variant in &item.variants {
                    collect_attribute_violations(&variant.attrs, path, violations);
                    for field in &variant.fields {
                        collect_attribute_violations(&field.attrs, path, violations);
                        if exported_by_tsify && type_contains_option(&field.ty) {
                            violations.push(Violation {
                                path: path.to_path_buf(),
                                line: span_line(field.ty.span()),
                            });
                        }
                    }
                }
            }
            syn::Item::Fn(item) => {
                collect_attribute_violations(&item.attrs, path, violations);
                if has_wasm_bindgen(&item.attrs) {
                    collect_function_signature_violations(item, path, violations);
                }
            }
            syn::Item::Impl(item) => {
                collect_attribute_violations(&item.attrs, path, violations);
                let exported_by_wasm_bindgen = has_wasm_bindgen(&item.attrs);
                for impl_item in &item.items {
                    if let syn::ImplItem::Fn(function) = impl_item {
                        collect_attribute_violations(&function.attrs, path, violations);
                        if (exported_by_wasm_bindgen || has_wasm_bindgen(&function.attrs))
                            && matches!(function.vis, Visibility::Public(_))
                        {
                            collect_method_signature_violations(function, path, violations);
                        }
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
                let exported_by_tsify = derives_tsify(&item.attrs);
                for field in &item.fields {
                    collect_attribute_violations(&field.attrs, path, violations);
                    if exported_by_tsify && type_contains_option(&field.ty) {
                        violations.push(Violation {
                            path: path.to_path_buf(),
                            line: span_line(field.ty.span()),
                        });
                    }
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

fn collect_function_signature_violations(
    function: &ItemFn,
    path: &Path,
    violations: &mut Vec<Violation>,
) {
    collect_signature_violations(&function.sig, path, violations);
}

fn collect_method_signature_violations(
    function: &ImplItemFn,
    path: &Path,
    violations: &mut Vec<Violation>,
) {
    collect_signature_violations(&function.sig, path, violations);
}

fn collect_signature_violations(
    signature: &Signature,
    path: &Path,
    violations: &mut Vec<Violation>,
) {
    for input in &signature.inputs {
        if let FnArg::Typed(argument) = input
            && type_contains_option(&argument.ty)
        {
            violations.push(Violation {
                path: path.to_path_buf(),
                line: span_line(argument.ty.span()),
            });
        }
    }
    if let ReturnType::Type(_, output) = &signature.output
        && type_contains_option(output)
    {
        violations.push(Violation {
            path: path.to_path_buf(),
            line: span_line(output.span()),
        });
    }
}

fn derives_tsify(attributes: &[Attribute]) -> bool {
    attributes.iter().any(|attribute| {
        if !attribute.path().is_ident("derive") {
            return false;
        }
        let mut derives_tsify = false;
        let parsed = attribute.parse_nested_meta(|meta| {
            if meta
                .path
                .segments
                .last()
                .is_some_and(|segment| segment.ident == "Tsify")
            {
                derives_tsify = true;
            }
            Ok(())
        });
        parsed.is_ok() && derives_tsify
    })
}

fn has_wasm_bindgen(attributes: &[Attribute]) -> bool {
    attributes
        .iter()
        .any(|attribute| attribute.path().is_ident("wasm_bindgen"))
}

fn type_contains_option(value: &Type) -> bool {
    struct OptionVisitor {
        found: bool,
    }

    impl<'ast> Visit<'ast> for OptionVisitor {
        fn visit_type_path(&mut self, path: &'ast syn::TypePath) {
            if path
                .path
                .segments
                .iter()
                .any(|segment| segment.ident == "Option")
            {
                self.found = true;
                return;
            }
            visit::visit_type_path(self, path);
        }
    }

    let mut visitor = OptionVisitor { found: false };
    visitor.visit_type(value);
    visitor.found
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
    use std::{env, process};

    #[test]
    fn reports_implicit_boundary_absence_but_allows_named_types() -> anyhow::Result<()> {
        let root = env::temp_dir().join(format!("nook-rust-tsify-state-{}", process::id()));
        let source_root = root.join("nook-app/nook-platform/nook-core/src");
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

#[derive(Tsify)]
pub struct ExportedState {
pub lifecycle: Option<String>,
}

#[wasm_bindgen]
pub fn optional_input(value: Option<String>) -> Result<Option<String>, String> {
Ok(value)
}

#[wasm_bindgen]
impl Boundary {
pub fn optional_method(&self, value: Option<String>) -> Option<String> {
value
}
pub fn named_method(&self, value: LifecycleState) -> LifecycleState {
value
}
}
"#,
        )?;

        let violations = rust_tsify_implicit_absence_overrides(&root)?;
        assert_eq!(
            violations,
            vec![
                Violation {
                    path: PathBuf::from("nook-app/nook-platform/nook-core/src/boundary.rs"),
                    line: 3,
                },
                Violation {
                    path: PathBuf::from("nook-app/nook-platform/nook-core/src/boundary.rs"),
                    line: 5,
                },
                Violation {
                    path: PathBuf::from("nook-app/nook-platform/nook-core/src/boundary.rs"),
                    line: 13,
                },
                Violation {
                    path: PathBuf::from("nook-app/nook-platform/nook-core/src/boundary.rs"),
                    line: 17,
                },
                Violation {
                    path: PathBuf::from("nook-app/nook-platform/nook-core/src/boundary.rs"),
                    line: 23,
                },
            ]
        );
        fs::remove_dir_all(root)?;
        Ok(())
    }
}
