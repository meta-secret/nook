//! Declared boundary justification in a lint attribute.
use rustc_hir::Attribute;
use rustc_span::{Symbol, sym};

pub(super) enum BoundaryReason {
    Undeclared,
    Declared(Symbol),
}
impl From<&Attribute> for BoundaryReason {
    fn from(attribute: &Attribute) -> Self {
        let Some(items) = attribute.meta_item_list() else {
            return Self::Undeclared;
        };
        for item in items {
            if let Some(meta) = item.meta_item()
                && meta.has_name(sym::reason)
                && let Some(reason) = meta.value_str()
            {
                return Self::Declared(reason);
            }
        }
        Self::Undeclared
    }
}
