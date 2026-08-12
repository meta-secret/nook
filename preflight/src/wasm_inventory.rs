use std::collections::{HashMap, HashSet};

use syn::{Attribute, ImplItem, Item};

#[derive(Default)]
pub(super) struct WasmTypeInventory {
    pub(super) methods: HashMap<String, HashSet<String>>,
    pub(super) returns: HashMap<(String, String), String>,
}

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
    types: &mut WasmTypeInventory,
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
                            types
                                .methods
                                .entry(owner.clone())
                                .or_default()
                                .insert(name.clone());
                            if let Some(returned) = wasm_return_type(&function.sig.output) {
                                types.returns.insert((owner.clone(), name), returned);
                            }
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
                        types,
                    );
                }
            }
            _ => {}
        }
    }
}

fn wasm_return_type(output: &syn::ReturnType) -> Option<String> {
    let syn::ReturnType::Type(_, ty) = output else {
        return None;
    };
    let syn::Type::Path(path) = ty.as_ref() else {
        return None;
    };
    let segment = path.path.segments.last()?;
    if matches!(
        segment.ident.to_string().as_str(),
        "Result" | "Option" | "Promise"
    ) && let syn::PathArguments::AngleBracketed(arguments) = &segment.arguments
    {
        return arguments.args.iter().find_map(|argument| match argument {
            syn::GenericArgument::Type(ty) => wasm_return_type(&syn::ReturnType::Type(
                syn::token::RArrow::default(),
                Box::new(ty.clone()),
            )),
            _ => None,
        });
    }
    Some(segment.ident.to_string())
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
    use std::collections::HashSet;

    use super::{WasmTypeInventory, collect_wasm_inventory};

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
        let mut types = WasmTypeInventory::default();
        collect_wasm_inventory(
            &syntax.items,
            false,
            &HashSet::new(),
            &mut names,
            &mut HashSet::new(),
            &mut types,
        );
        assert_eq!(
            names,
            HashSet::from(["connect".to_owned(), "generate_secret_id".to_owned()])
        );
        assert_eq!(
            types.methods.get("VaultManager"),
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
            &mut WasmTypeInventory::default(),
        );
        assert_eq!(names, HashSet::from(["generate_secret_id".to_owned()]));
        Ok(())
    }
}
