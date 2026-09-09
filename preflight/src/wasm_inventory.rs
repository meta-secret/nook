use std::collections::{HashMap, HashSet};

use super::rust_wasm_attributes;
use syn::token::RArrow;
use syn::{Attribute, ImplItem, Item};

#[derive(Default)]
pub(super) struct WasmTypeInventory {
    pub(super) methods: HashMap<String, HashSet<String>>,
    pub(super) returns: HashMap<(String, String), String>,
    pub(super) free_returns: HashMap<String, String>,
}

impl WasmTypeInventory {
    fn has_wasm_bindgen(attributes: &[Attribute], aliases: &HashSet<String>) -> bool {
        attributes.iter().any(|attribute| {
            rust_wasm_attributes::attribute_has_wasm_bindgen_with_aliases(attribute, aliases)
        })
    }
}

impl WasmTypeInventory {
    fn is_wasm_accessor(attributes: &[Attribute], aliases: &HashSet<String>) -> bool {
        attributes.iter().any(|attribute| {
            rust_wasm_attributes::attribute_is_wasm_accessor_with_aliases(attribute, aliases)
        })
    }
}

impl WasmTypeInventory {
    pub(super) fn collect_wasm_inventory(request: WasmInventoryCollection<'_>) {
        let WasmInventoryCollection {
            items,
            enclosing_wasm_impl,
            inherited_aliases,
            callable_names,
            type_names,
            types,
        } = request;

        let mut aliases = inherited_aliases.clone();
        aliases.extend(rust_wasm_attributes::collect_wasm_bindgen_attribute_aliases(items));
        for item in items {
            match item {
                Item::Fn(function) => {
                    if matches!(function.vis, syn::Visibility::Public(_))
                        && WasmTypeInventory::has_wasm_bindgen(&function.attrs, &aliases)
                        && !WasmTypeInventory::is_wasm_accessor(&function.attrs, &aliases)
                    {
                        let name = function.sig.ident.to_string();
                        callable_names.insert(name.clone());
                        if let Some(returned) =
                            WasmTypeInventory::wasm_return_type(&function.sig.output)
                        {
                            types.free_returns.insert(name, returned);
                        }
                    }
                }
                Item::Struct(item)
                    if WasmTypeInventory::has_wasm_bindgen(&item.attrs, &aliases) =>
                {
                    type_names.insert(item.ident.to_string());
                }
                Item::Enum(item) if WasmTypeInventory::has_wasm_bindgen(&item.attrs, &aliases) => {
                    type_names.insert(item.ident.to_string());
                }
                Item::Impl(implementation) => {
                    let wasm_impl = if matches!(enclosing_wasm_impl, WasmImplContext::Inside)
                        || WasmTypeInventory::has_wasm_bindgen(&implementation.attrs, &aliases)
                    {
                        WasmImplContext::Inside
                    } else {
                        WasmImplContext::Outside
                    };
                    let owner =
                        WasmTypeInventory::implementation_type_name(&implementation.self_ty);
                    for item in &implementation.items {
                        if let ImplItem::Fn(function) = item
                            && matches!(function.vis, syn::Visibility::Public(_))
                            && (matches!(wasm_impl, WasmImplContext::Inside)
                                || WasmTypeInventory::has_wasm_bindgen(&function.attrs, &aliases))
                            && !WasmTypeInventory::is_wasm_accessor(&function.attrs, &aliases)
                        {
                            let name = function.sig.ident.to_string();
                            callable_names.insert(name.clone());
                            if let Some(owner) = &owner {
                                types
                                    .methods
                                    .entry(owner.clone())
                                    .or_default()
                                    .insert(name.clone());
                                if let Some(returned) =
                                    WasmTypeInventory::wasm_return_type(&function.sig.output)
                                {
                                    types.returns.insert((owner.clone(), name), returned);
                                }
                            }
                        }
                    }
                }
                Item::Mod(module) => {
                    if let Some((_, nested)) = &module.content {
                        WasmTypeInventory::collect_wasm_inventory(
                            crate::wasm_inventory::WasmInventoryCollection {
                                items: nested,
                                enclosing_wasm_impl,
                                inherited_aliases: &aliases,
                                callable_names,
                                type_names,
                                types,
                            },
                        );
                    }
                }
                _ => {}
            }
        }
    }
}

impl WasmTypeInventory {
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
                syn::GenericArgument::Type(ty) => WasmTypeInventory::wasm_return_type(
                    &syn::ReturnType::Type(RArrow::default(), Box::new(ty.clone())),
                ),
                _ => None,
            });
        }
        Some(segment.ident.to_string())
    }
}

impl WasmTypeInventory {
    fn implementation_type_name(ty: &syn::Type) -> Option<String> {
        let syn::Type::Path(path) = ty else {
            return None;
        };
        path.path
            .segments
            .last()
            .map(|segment| segment.ident.to_string())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{WasmImplContext, WasmTypeInventory};

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
        WasmTypeInventory::collect_wasm_inventory(crate::wasm_inventory::WasmInventoryCollection {
            items: &syntax.items,
            enclosing_wasm_impl: WasmImplContext::Outside,
            inherited_aliases: &HashSet::new(),
            callable_names: &mut names,
            type_names: &mut HashSet::new(),
            types: &mut types,
        });
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
        WasmTypeInventory::collect_wasm_inventory(crate::wasm_inventory::WasmInventoryCollection {
            items: &syntax.items,
            enclosing_wasm_impl: WasmImplContext::Outside,
            inherited_aliases: &HashSet::new(),
            callable_names: &mut names,
            type_names: &mut HashSet::new(),
            types: &mut WasmTypeInventory::default(),
        });
        assert_eq!(names, HashSet::from(["generate_secret_id".to_owned()]));
        Ok(())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum WasmImplContext {
    Outside,
    Inside,
}

pub(crate) struct WasmInventoryCollection<'a> {
    pub(crate) items: &'a [Item],
    pub(crate) enclosing_wasm_impl: WasmImplContext,
    pub(crate) inherited_aliases: &'a HashSet<String>,
    pub(crate) callable_names: &'a mut HashSet<String>,
    pub(crate) type_names: &'a mut HashSet<String>,
    pub(crate) types: &'a mut WasmTypeInventory,
}
