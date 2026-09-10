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

impl WasmInventory {
    pub(super) fn collect(mut self, request: WasmInventoryCollection<'_>) -> Self {
        let WasmInventoryCollection {
            items,
            enclosing_wasm_impl,
            inherited_aliases,
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
                        self.callable_names.insert(name.clone());
                        if let WasmReturnType::Named(returned) =
                            WasmTypeInventory::wasm_return_type(&function.sig.output)
                        {
                            self.types.free_returns.insert(name, returned);
                        }
                    }
                }
                Item::Struct(item)
                    if WasmTypeInventory::has_wasm_bindgen(&item.attrs, &aliases) =>
                {
                    self.type_names.insert(item.ident.to_string());
                }
                Item::Enum(item) if WasmTypeInventory::has_wasm_bindgen(&item.attrs, &aliases) => {
                    self.type_names.insert(item.ident.to_string());
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
                            self.callable_names.insert(name.clone());
                            if let ImplementationType::Named(owner) = &owner {
                                self.types
                                    .methods
                                    .entry(owner.clone())
                                    .or_default()
                                    .insert(name.clone());
                                if let Some(returned) =
                                    WasmTypeInventory::wasm_return_type(&function.sig.output)
                                {
                                    self.types.returns.insert((owner.clone(), name), returned);
                                }
                            }
                        }
                    }
                }
                Item::Mod(module) => {
                    if let Some((_, nested)) = &module.content {
                        self = self.collect(crate::wasm_inventory::WasmInventoryCollection {
                            items: nested,
                            enclosing_wasm_impl,
                            inherited_aliases: &aliases,
                        });
                    }
                }
                _ => {}
            }
        }
        self
    }
}

impl WasmTypeInventory {
    fn wasm_return_type(output: &syn::ReturnType) -> WasmReturnType {
        let syn::ReturnType::Type(_, ty) = output else {
            return WasmReturnType::Unit;
        };
        let syn::Type::Path(path) = ty.as_ref() else {
            return WasmReturnType::Unsupported;
        };
        let Some(segment) = path.path.segments.last() else {
            return WasmReturnType::Unsupported;
        };
        if matches!(
            segment.ident.to_string().as_str(),
            "Result" | "Option" | "Promise"
        ) && let syn::PathArguments::AngleBracketed(arguments) = &segment.arguments
        {
            for argument in &arguments.args {
                if let syn::GenericArgument::Type(ty) = argument {
                    let resolved = Self::wasm_return_type(&syn::ReturnType::Type(
                        RArrow::default(),
                        Box::new(ty.clone()),
                    ));
                    if matches!(resolved, WasmReturnType::Named(_)) {
                        return resolved;
                    }
                }
            }
            return WasmReturnType::Unsupported;
        }
        WasmReturnType::Named(segment.ident.to_string())
    }
}

impl WasmTypeInventory {
    fn implementation_type_name(ty: &syn::Type) -> ImplementationType {
        let syn::Type::Path(path) = ty else {
            return ImplementationType::Unsupported;
        };
        match path.path.segments.last() {
            Some(segment) => ImplementationType::Named(segment.ident.to_string()),
            None => ImplementationType::Unsupported,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{WasmImplContext, WasmInventory};

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
        let inventory =
            WasmInventory::default().collect(crate::wasm_inventory::WasmInventoryCollection {
                items: &syntax.items,
                enclosing_wasm_impl: WasmImplContext::Outside,
                inherited_aliases: &HashSet::new(),
            });
        assert_eq!(
            inventory.callable_names,
            HashSet::from(["connect".to_owned(), "generate_secret_id".to_owned()])
        );
        assert_eq!(
            inventory.types.methods.get("VaultManager"),
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
        let inventory =
            WasmInventory::default().collect(crate::wasm_inventory::WasmInventoryCollection {
                items: &syntax.items,
                enclosing_wasm_impl: WasmImplContext::Outside,
                inherited_aliases: &HashSet::new(),
            });
        assert_eq!(
            inventory.callable_names,
            HashSet::from(["generate_secret_id".to_owned()])
        );
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
}

#[derive(Default)]
pub(crate) struct WasmInventory {
    pub(crate) callable_names: HashSet<String>,
    pub(crate) type_names: HashSet<String>,
    pub(crate) types: WasmTypeInventory,
}

enum WasmReturnType {
    Unit,
    Named(String),
    Unsupported,
}
enum ImplementationType {
    Named(String),
    Unsupported,
}
