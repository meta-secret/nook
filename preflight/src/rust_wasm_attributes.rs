pub struct RustWasmAttributes<'scan> {
    pub attribute: &'scan Attribute,
    pub aliases: &'scan HashSet<String>,
}
use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use syn::spanned::Spanned;
use syn::{Attribute, ImplItem, Item, Meta, Token, UseTree, punctuated::Punctuated};

use crate::Violation;

impl RustWasmAttributes<'_> {
    pub fn attribute_has_wasm_bindgen_with_aliases(self) -> bool {
        let Self { attribute, aliases } = self;
        RustWasmAttributes::meta_contains_wasm_bindgen(&attribute.meta, aliases)
    }
}

impl RustWasmAttributes<'_> {
    pub(super) fn attribute_is_wasm_accessor_with_aliases(
        attribute: &Attribute,
        aliases: &HashSet<String>,
    ) -> bool {
        RustWasmAttributes::meta_is_wasm_accessor(&attribute.meta, aliases)
    }
}

impl RustWasmAttributes<'_> {
    fn meta_is_wasm_accessor(meta: &Meta, aliases: &HashSet<String>) -> bool {
        let Meta::List(list) = meta else {
            return false;
        };
        let Ok(options) = list.parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated)
        else {
            return false;
        };
        if meta.path().segments.last().is_some_and(|segment| {
            segment.ident == "wasm_bindgen" || aliases.contains(&segment.ident.to_string())
        }) {
            return options.iter().any(|option| {
                option.path().is_ident("getter") || option.path().is_ident("setter")
            });
        }
        meta.path().is_ident("cfg_attr")
            && options
                .iter()
                .any(|option| RustWasmAttributes::meta_is_wasm_accessor(option, aliases))
    }
}

impl RustWasmAttributes<'_> {
    fn meta_contains_wasm_bindgen(meta: &Meta, aliases: &HashSet<String>) -> bool {
        if meta.path().segments.last().is_some_and(|segment| {
            segment.ident == "wasm_bindgen" || aliases.contains(&segment.ident.to_string())
        }) {
            return true;
        }
        if !meta.path().is_ident("cfg_attr") {
            return false;
        }
        let Meta::List(list) = meta else {
            return false;
        };
        let Ok(nested) = list.parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated)
        else {
            return false;
        };
        nested
            .iter()
            .any(|nested_meta| RustWasmAttributes::meta_contains_wasm_bindgen(nested_meta, aliases))
    }
}

impl RustWasmAttributes<'_> {
    pub(super) fn collect_rust_files(directory: &Path, files: &mut Vec<PathBuf>) -> io::Result<()> {
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
                    RustWasmAttributes::collect_rust_files(&path, files)?;
                }
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                files.push(path);
            }
        }
        Ok(())
    }
}

impl RustWasmAttributes<'_> {
    pub(super) fn collect_item_violations(
        items: &[Item],
        path: &Path,
        inherited_aliases: &HashSet<String>,
        violations: &mut Vec<Violation>,
    ) {
        let mut aliases = inherited_aliases.clone();
        aliases.extend(RustWasmAttributes::collect_wasm_bindgen_attribute_aliases(
            items,
        ));
        for item in items {
            match item {
                Item::Fn(function) => {
                    RustWasmAttributes::collect_callable_attributes(
                        &function.attrs,
                        path,
                        &aliases,
                        violations,
                    );
                }
                Item::Impl(implementation) => {
                    for item in &implementation.items {
                        if let ImplItem::Fn(function) = item {
                            RustWasmAttributes::collect_callable_attributes(
                                &function.attrs,
                                path,
                                &aliases,
                                violations,
                            );
                        }
                    }
                }
                Item::Mod(module) => {
                    if let Some((_, nested)) = &module.content {
                        RustWasmAttributes::collect_item_violations(
                            nested, path, &aliases, violations,
                        );
                    }
                }
                _ => {}
            }
        }
    }
}

impl RustWasmAttributes<'_> {
    fn collect_callable_attributes(
        attributes: &[Attribute],
        path: &Path,
        wasm_bindgen_aliases: &HashSet<String>,
        violations: &mut Vec<Violation>,
    ) {
        for attribute in attributes {
            if RustWasmAttributes::wasm_bindgen_callable_has_js_name_with_aliases(
                attribute,
                wasm_bindgen_aliases,
            ) {
                violations.push(Violation {
                    path: path.to_path_buf(),
                    line: attribute.span().start().line,
                });
            }
        }
    }
}

impl RustWasmAttributes<'_> {
    pub(super) fn wasm_bindgen_callable_has_js_name_with_aliases(
        attribute: &Attribute,
        wasm_bindgen_aliases: &HashSet<String>,
    ) -> bool {
        RustWasmAttributes::meta_has_callable_js_name(&attribute.meta, wasm_bindgen_aliases)
    }
}

impl RustWasmAttributes<'_> {
    fn meta_has_callable_js_name(meta: &Meta, wasm_bindgen_aliases: &HashSet<String>) -> bool {
        let is_wasm_bindgen_attribute = meta.path().segments.last().is_some_and(|segment| {
            segment.ident == "wasm_bindgen"
                || wasm_bindgen_aliases.contains(&segment.ident.to_string())
        });
        if is_wasm_bindgen_attribute {
            let Meta::List(list) = meta else {
                return false;
            };
            let Ok(options) = list.parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated)
            else {
                return false;
            };
            let has_js_name = options
                .iter()
                .any(|option| option.path().is_ident("js_name"));
            let property_accessor = options
                .iter()
                .any(|option| option.path().is_ident("getter") || option.path().is_ident("setter"));
            return has_js_name && !property_accessor;
        }
        if !meta.path().is_ident("cfg_attr") {
            return false;
        }
        let Meta::List(list) = meta else {
            return false;
        };
        let Ok(nested) = list.parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated)
        else {
            return false;
        };
        nested.iter().any(|nested_meta| {
            RustWasmAttributes::meta_has_callable_js_name(nested_meta, wasm_bindgen_aliases)
        })
    }
}

impl RustWasmAttributes<'_> {
    pub(super) fn collect_wasm_bindgen_attribute_aliases(items: &[Item]) -> HashSet<String> {
        let mut aliases = HashSet::new();
        for item in items {
            if let Item::Use(import) = item {
                RustWasmAttributes::collect_wasm_bindgen_use_alias(
                    &import.tree,
                    &mut Vec::new(),
                    &mut aliases,
                );
            }
        }
        aliases
    }
}

impl RustWasmAttributes<'_> {
    fn collect_wasm_bindgen_use_alias(
        tree: &UseTree,
        path: &mut Vec<String>,
        aliases: &mut HashSet<String>,
    ) {
        match tree {
            UseTree::Path(segment) => {
                path.push(segment.ident.to_string());
                RustWasmAttributes::collect_wasm_bindgen_use_alias(&segment.tree, path, aliases);
                path.pop();
            }
            UseTree::Rename(rename) => {
                path.push(rename.ident.to_string());
                if path.first().is_some_and(|root| root == "wasm_bindgen")
                    && path.last().is_some_and(|name| name == "wasm_bindgen")
                {
                    aliases.insert(rename.rename.to_string());
                }
                path.pop();
            }
            UseTree::Group(group) => {
                for nested in &group.items {
                    RustWasmAttributes::collect_wasm_bindgen_use_alias(nested, path, aliases);
                }
            }
            UseTree::Name(_) | UseTree::Glob(_) => {}
        }
    }
}
