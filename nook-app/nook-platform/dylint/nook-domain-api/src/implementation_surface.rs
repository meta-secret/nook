//! Reachable implementation and numeric newtype surfaces.
use super::instantiated_callable_surface_contains_raw;
use rustc_hir::Impl;
use rustc_lint::LateContext;
use rustc_middle::ty::{self, Ty};
use rustc_span::def_id::{DefId, LocalDefId};

pub(super) struct ImplementationSurface<'cx, 'tcx> {
    pub(super) cx: &'cx LateContext<'tcx>,
    pub(super) impl_id: LocalDefId,
    pub(super) implementation: &'tcx Impl<'tcx>,
}
impl ImplementationSurface<'_, '_> {
    pub(super) fn exposes_reachable_surface(&self) -> bool {
        if let Some(header) = self.implementation.of_trait
            && let Some(trait_id) = header.trait_ref.trait_def_id()
            && trait_id
                .as_local()
                .is_none_or(|local_id| self.cx.effective_visibilities.is_reachable(local_id))
        {
            return true;
        }
        self.cx
            .tcx
            .associated_items(self.impl_id)
            .in_definition_order()
            .filter_map(|item| item.def_id.as_local())
            .any(|item_id| self.cx.effective_visibilities.is_reachable(item_id))
    }
    pub(super) fn inherited_surface_contains_raw(&self) -> bool {
        let Some(header) = self.implementation.of_trait else {
            return false;
        };
        let Some(trait_id) = header.trait_ref.trait_def_id() else {
            return false;
        };
        let inherited = InheritedTraitSurface {
            cx: self.cx,
            impl_id: self.impl_id.to_def_id(),
            trait_id,
        };
        inherited.contains_raw()
    }
}
struct InheritedTraitSurface<'cx, 'tcx> {
    cx: &'cx LateContext<'tcx>,
    impl_id: DefId,
    trait_id: DefId,
}
impl InheritedTraitSurface<'_, '_> {
    fn contains_raw(self) -> bool {
        let implemented = self.cx.tcx.impl_item_implementor_ids(self.impl_id);
        let trait_ref = self
            .cx
            .tcx
            .impl_trait_ref(self.impl_id)
            .instantiate_identity();
        self.cx
            .tcx
            .provided_trait_methods(self.trait_id)
            .filter(|method| !implemented.contains_key(&method.def_id))
            .any(|method| {
                let args = ty::GenericArgs::identity_for_item(self.cx.tcx, method.def_id)
                    .rebase_onto(self.cx.tcx, self.trait_id, trait_ref.args);
                instantiated_callable_surface_contains_raw(self.cx, method.def_id, args)
            })
    }
}
pub(super) enum NumericNewtypePrimitive<'tcx> {
    NotNumericNewtype,
    Numeric(Ty<'tcx>),
}
pub(super) struct NumericNewtype<'cx, 'tcx> {
    pub(super) cx: &'cx LateContext<'tcx>,
    pub(super) ty: Ty<'tcx>,
}
impl<'tcx> NumericNewtype<'_, 'tcx> {
    pub(super) fn primitive(self) -> NumericNewtypePrimitive<'tcx> {
        let ty::Adt(definition, arguments) = self.ty.kind() else {
            return NumericNewtypePrimitive::NotNumericNewtype;
        };
        let Some(definition_id) = definition.did().as_local() else {
            return NumericNewtypePrimitive::NotNumericNewtype;
        };
        if !self.cx.effective_visibilities.is_reachable(definition_id)
            || !definition.is_struct()
            || !arguments.is_empty()
        {
            return NumericNewtypePrimitive::NotNumericNewtype;
        }
        let mut fields = definition.non_enum_variant().fields.iter();
        let (Some(field), None) = (fields.next(), fields.next()) else {
            return NumericNewtypePrimitive::NotNumericNewtype;
        };
        if field.vis.is_public() {
            return NumericNewtypePrimitive::NotNumericNewtype;
        }
        let field_ty = field.ty(self.cx.tcx, arguments);
        match field_ty.kind() {
            ty::Int(_) | ty::Uint(_) | ty::Float(_) => NumericNewtypePrimitive::Numeric(field_ty),
            _ => NumericNewtypePrimitive::NotNumericNewtype,
        }
    }
}
