use std::collections::HashSet;

use syn::{Attribute, ImplItem, Item};

fn has_wasm_bindgen(attributes: &[Attribute]) -> bool {
    attributes
        .iter()
        .any(super::rust_wasm_names::attribute_has_wasm_bindgen)
}

fn is_wasm_accessor(attributes: &[Attribute]) -> bool {
    attributes
        .iter()
        .any(super::rust_wasm_names::attribute_is_wasm_accessor)
}

pub(super) fn collect_wasm_inventory(
    items: &[Item],
    enclosing_wasm_impl: bool,
    callable_names: &mut HashSet<String>,
    type_names: &mut HashSet<String>,
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
                for item in &implementation.items {
                    if let ImplItem::Fn(function) = item
                        && matches!(function.vis, syn::Visibility::Public(_))
                        && (wasm_impl || has_wasm_bindgen(&function.attrs))
                        && !is_wasm_accessor(&function.attrs)
                    {
                        callable_names.insert(function.sig.ident.to_string());
                    }
                }
            }
            Item::Mod(module) => {
                if let Some((_, nested)) = &module.content {
                    collect_wasm_inventory(nested, enclosing_wasm_impl, callable_names, type_names);
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

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
        collect_wasm_inventory(&syntax.items, false, &mut names, &mut HashSet::new());
        assert_eq!(
            names,
            HashSet::from(["connect".to_owned(), "generate_secret_id".to_owned()])
        );
        Ok(())
    }
}
