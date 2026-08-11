use std::collections::{HashMap, HashSet};

use syn::{Attribute, ImplItem, Item};

fn has_wasm_bindgen(attributes: &[Attribute], aliases: &HashSet<String>) -> bool {
    attributes.iter().any(|attribute| {
        super::rust_wasm_attributes::attribute_has_wasm_bindgen_with_aliases(attribute, aliases)
    })
}

fn is_wasm_accessor(attributes: &[Attribute], aliases: &HashSet<String>) -> bool {
    attributes.iter().any(|attribute| {
        super::rust_wasm_attributes::attribute_is_wasm_accessor_with_aliases(attribute, aliases)
    })
}

pub(super) fn collect_wasm_inventory(
    items: &[Item],
    enclosing_wasm_impl: bool,
    inherited_aliases: &HashSet<String>,
    callable_names: &mut HashSet<String>,
    type_names: &mut HashSet<String>,
    methods_by_type: &mut HashMap<String, HashSet<String>>,
) {
    let mut aliases = inherited_aliases.clone();
    aliases.extend(super::rust_wasm_attributes::collect_wasm_bindgen_attribute_aliases(items));
    for item in items {
        match item {
            Item::Fn(function) => {
                if matches!(function.vis, syn::Visibility::Public(_))
                    && has_wasm_bindgen(&function.attrs, &aliases)
                    && !is_wasm_accessor(&function.attrs, &aliases)
                {
                    callable_names.insert(function.sig.ident.to_string());
                }
            }
            Item::Struct(item) if has_wasm_bindgen(&item.attrs, &aliases) => {
                type_names.insert(item.ident.to_string());
            }
            Item::Enum(item) if has_wasm_bindgen(&item.attrs, &aliases) => {
                type_names.insert(item.ident.to_string());
            }
            Item::Impl(implementation) => {
                let wasm_impl =
                    enclosing_wasm_impl || has_wasm_bindgen(&implementation.attrs, &aliases);
                let owner = implementation_type_name(&implementation.self_ty);
                for item in &implementation.items {
                    if let ImplItem::Fn(function) = item
                        && matches!(function.vis, syn::Visibility::Public(_))
                        && (wasm_impl || has_wasm_bindgen(&function.attrs, &aliases))
                        && !is_wasm_accessor(&function.attrs, &aliases)
                    {
                        let name = function.sig.ident.to_string();
                        callable_names.insert(name.clone());
                        if let Some(owner) = &owner {
                            methods_by_type
                                .entry(owner.clone())
                                .or_default()
                                .insert(name);
                        }
                    }
                }
            }
            Item::Mod(module) => {
                if let Some((_, nested)) = &module.content {
                    collect_wasm_inventory(
                        nested,
                        enclosing_wasm_impl,
                        &aliases,
                        callable_names,
                        type_names,
                        methods_by_type,
                    );
                }
            }
            _ => {}
        }
    }
}

fn implementation_type_name(ty: &syn::Type) -> Option<String> {
    let syn::Type::Path(path) = ty else {
        return None;
    };
    path.path
        .segments
        .last()
        .map(|segment| segment.ident.to_string())
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use super::collect_wasm_inventory;

    #[test]
    fn inventories_callables_but_excludes_accessors() -> Result<(), syn::Error> {
        let syntax = syn::parse_file(
            r"
#[wasm_bindgen]
pub fn connect() {}

#[wasm_bindgen]
impl VaultManager {
    pub fn generate_secret_id(&self) {}
    #[wasm_bindgen(getter)]
    pub fn storage_mode(&self) {}
    fn private_helper(&self) {}
}
",
        )?;
        let mut names = HashSet::new();
        let mut methods = HashMap::new();
        collect_wasm_inventory(
            &syntax.items,
            false,
            &HashSet::new(),
            &mut names,
            &mut HashSet::new(),
            &mut methods,
        );
        assert_eq!(
            names,
            HashSet::from(["connect".to_owned(), "generate_secret_id".to_owned()])
        );
        assert_eq!(
            methods.get("VaultManager"),
            Some(&HashSet::from(["generate_secret_id".to_owned()]))
        );
        Ok(())
    }

    #[test]
    fn inventories_callables_exported_through_aliased_attributes() -> Result<(), syn::Error> {
        let syntax = syn::parse_file(
            r"
use wasm_bindgen::prelude::wasm_bindgen as export_wasm;

#[export_wasm]
pub fn generate_secret_id() {}
",
        )?;
        let mut names = HashSet::new();
        collect_wasm_inventory(
            &syntax.items,
            false,
            &HashSet::new(),
            &mut names,
            &mut HashSet::new(),
            &mut HashMap::new(),
        );
        assert_eq!(names, HashSet::from(["generate_secret_id".to_owned()]));
        Ok(())
    }
}
