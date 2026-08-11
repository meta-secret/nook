use std::collections::{HashMap, HashSet};

use syn::{Attribute, ImplItem, Item};

fn has_wasm_bindgen(attributes: &[Attribute]) -> bool {
    attributes
        .iter()
        .any(super::rust_wasm_attributes::attribute_has_wasm_bindgen)
}

fn is_wasm_accessor(attributes: &[Attribute]) -> bool {
    attributes
        .iter()
        .any(super::rust_wasm_attributes::attribute_is_wasm_accessor)
}

pub(super) fn collect_wasm_inventory(
    items: &[Item],
    enclosing_wasm_impl: bool,
    callable_names: &mut HashSet<String>,
    type_names: &mut HashSet<String>,
    methods_by_type: &mut HashMap<String, HashSet<String>>,
) {
    for item in items {
        match item {
            Item::Fn(function) => {
                if matches!(function.vis, syn::Visibility::Public(_))
                    && has_wasm_bindgen(&function.attrs)
                    && !is_wasm_accessor(&function.attrs)
                {
                    callable_names.insert(function.sig.ident.to_string());
                }
            }
            Item::Struct(item) if has_wasm_bindgen(&item.attrs) => {
                type_names.insert(item.ident.to_string());
            }
            Item::Enum(item) if has_wasm_bindgen(&item.attrs) => {
                type_names.insert(item.ident.to_string());
            }
            Item::Impl(implementation) => {
                let wasm_impl = enclosing_wasm_impl || has_wasm_bindgen(&implementation.attrs);
                let owner = implementation_type_name(&implementation.self_ty);
                for item in &implementation.items {
                    if let ImplItem::Fn(function) = item
                        && matches!(function.vis, syn::Visibility::Public(_))
                        && (wasm_impl || has_wasm_bindgen(&function.attrs))
                        && !is_wasm_accessor(&function.attrs)
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
}
