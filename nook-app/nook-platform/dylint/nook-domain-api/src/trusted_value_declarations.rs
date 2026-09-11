//! Declaration policy for explicitly registered validated IDs and secrets.
//!
//! Fully qualified type identities, rather than spelling heuristics, select the
//! policy. Manual Debug implementations remain reviewable redaction boundaries;
//! this lint does not claim to prove their bodies safe. Other constructors and
//! custom Deserialize implementations likewise still need semantic review.

use clippy_utils::diagnostics::span_lint_and_help;
use rustc_hir::{ImplItem, ImplItemKind, Item, ItemKind};
use rustc_lint::{LateContext, LateLintPass};
use rustc_middle::ty;
use rustc_session::{declare_lint, declare_lint_pass};
use rustc_span::{Symbol, sym};

declare_lint! {
    /// Registered IDs must not derive transparent, unchecked deserialization.
    pub VALIDATED_ID_TRANSPARENT_DESERIALIZE,
    Deny,
    "registered validated ID derives transparent deserialization"
}

declare_lint! {
    /// Registered secrets must not expose Display or automatically derived Debug.
    pub SECRET_PLAINTEXT_FORMATTING,
    Deny,
    "registered secret exposes Display or derived Debug"
}

declare_lint! {
    /// Registered secrets cannot expose a public from_trusted constructor.
    pub PUBLIC_UNCHECKED_SECRET_CONSTRUCTOR,
    Deny,
    "registered secret exposes an unchecked constructor"
}

declare_lint_pass! {
    TrustedValueDeclarations => [
        VALIDATED_ID_TRANSPARENT_DESERIALIZE,
        SECRET_PLAINTEXT_FORMATTING,
        PUBLIC_UNCHECKED_SECRET_CONSTRUCTOR
    ]
}

struct RegisteredType;

impl RegisteredType {
    fn validated_id(path: &str) -> bool {
        matches!(
            path,
            "nook_auth2::ids::CompactToken"
                | "nook_auth2::ids::AppId"
                | "nook_auth2::ids::StoreId"
                | "nook_auth2::ids::SecretId"
                | "nook_auth2::ids::AuthKeyId"
        )
    }

    fn secret(path: &str) -> bool {
        matches!(
            path,
            "nook_auth2::wire::SymmetricKey"
                | "nook_auth2::wire::SigningSeedHex"
                | "nook_auth2::wire::DecryptedPlaintext"
                | "nook_auth2::wire::DeviceIdentitySecret"
        )
    }
}

impl<'tcx> LateLintPass<'tcx> for TrustedValueDeclarations {
    fn check_item(&mut self, cx: &LateContext<'tcx>, item: &'tcx Item<'tcx>) {
        if !matches!(item.kind, ItemKind::Impl(_)) {
            return;
        }
        let Some(trait_ref) = cx.tcx.impl_opt_trait_ref(item.owner_id.def_id) else {
            return;
        };
        let trait_ref = trait_ref.instantiate_identity();
        let self_ty = trait_ref.self_ty();
        let ty::Adt(definition, _) = self_ty.kind() else {
            return;
        };
        let type_path = cx.tcx.def_path_str(definition.did());
        let trait_path = cx.tcx.def_path_str(trait_ref.def_id);
        let derived = cx
            .tcx
            .hir_attrs(item.hir_id())
            .iter()
            .any(|attribute| attribute.has_name(sym::automatically_derived));

        if RegisteredType::secret(&type_path)
            && (trait_path == "core::fmt::Display"
                || (trait_path == "core::fmt::Debug" && derived))
        {
            span_lint_and_help(
                cx,
                SECRET_PLAINTEXT_FORMATTING,
                cx.tcx.def_span(definition.did()),
                "registered secret exposes Display or automatically derived Debug",
                None,
                "remove Display and use a manually redacted Debug implementation",
            );
        }

        if !RegisteredType::validated_id(&type_path)
            || !derived
            || !matches!(
                trait_path.as_str(),
                "serde_core::de::Deserialize" | "serde::de::Deserialize"
            )
        {
            return;
        }
        let Some(local_id) = definition.did().as_local() else {
            return;
        };
        let attributes = cx.tcx.hir_attrs(cx.tcx.local_def_id_to_hir_id(local_id));
        let transparent = attributes.iter().any(|attribute| {
            attribute.has_name(Symbol::intern("serde"))
                && attribute.meta_item_list().is_some_and(|items| {
                    items.iter().any(|item| {
                        item.meta_item()
                            .is_some_and(|meta| meta.has_name(Symbol::intern("transparent")))
                    })
                })
        });
        if transparent {
            span_lint_and_help(
                cx,
                VALIDATED_ID_TRANSPARENT_DESERIALIZE,
                cx.tcx.def_span(definition.did()),
                "registered validated ID derives transparent deserialization without validation",
                None,
                "deserialize through a fallible conversion that invokes the canonical validator",
            );
        }
    }

    fn check_impl_item(&mut self, cx: &LateContext<'tcx>, item: &'tcx ImplItem<'tcx>) {
        if !matches!(item.kind, ImplItemKind::Fn(..))
            || item.ident.name.as_str() != "from_trusted"
            || !cx.effective_visibilities.is_reachable(item.owner_id.def_id)
        {
            return;
        }
        let impl_id = cx.tcx.parent(item.owner_id.def_id.to_def_id());
        if cx.tcx.impl_opt_trait_ref(impl_id).is_some() {
            return;
        }
        let self_ty = cx.tcx.type_of(impl_id).instantiate_identity();
        let ty::Adt(definition, _) = self_ty.kind() else {
            return;
        };
        if RegisteredType::secret(&cx.tcx.def_path_str(definition.did())) {
            span_lint_and_help(
                cx,
                PUBLIC_UNCHECKED_SECRET_CONSTRUCTOR,
                item.span,
                "registered secret exposes a public unchecked from_trusted constructor",
                None,
                "keep unchecked construction private to the validating owner",
            );
        }
    }
}
