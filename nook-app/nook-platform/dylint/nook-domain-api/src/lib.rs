#![feature(rustc_private)]
#![warn(unused_extern_crates)]

extern crate rustc_ast;
extern crate rustc_hir;
extern crate rustc_lint;
extern crate rustc_middle;
extern crate rustc_session;
extern crate rustc_span;

use clippy_utils::diagnostics::span_lint_and_help;
use rustc_ast::attr::AttributeExt;
use rustc_hir::def::{DefKind, Res};
use rustc_hir::intravisit::{self, FnKind, Visitor, VisitorExt};
use rustc_hir::{
    AmbigArg, Attribute, CRATE_HIR_ID, FieldDef, FnDecl, ForeignItem, ForeignItemKind,
    GenericParam, GenericParamKind, HirId, ImplItem, ImplItemKind, Item, ItemKind, Node, PrimTy,
    QPath, TraitFn, TraitItem, TraitItemKind, TraitRef, Ty as HirTy, TyKind as HirTyKind, Variant,
};
use rustc_lint::{LateContext, LateLintPass, LintStore};
use rustc_middle::ty::{self, Ty};
use rustc_session::{Session, declare_lint, declare_lint_pass};
use rustc_span::{Span, def_id::LocalDefId, sym};

dylint_linting::dylint_library!();

declare_lint! {
    /// ### What it does
    ///
    /// Rejects raw numeric primitives in effectively public function parameters,
    /// return types, and struct or enum fields. Numeric types nested in aliases,
    /// tuples, collections, and other generic types are included.
    ///
    /// ### Why is this bad?
    ///
    /// A primitive conveys representation but not domain meaning. Distinct values
    /// such as identifiers, versions, counts, timestamps, and byte payloads can be
    /// exchanged accidentally when their APIs use the same primitive type.
    ///
    /// ### Known problems
    ///
    /// Legitimate serialization, database, and FFI conversion items require a
    /// narrow, reason-bearing `expect` annotation. The companion suppression lint
    /// validates its placement and reason.
    ///
    /// ### Example
    ///
    /// ```rust
    /// pub fn user(id: u64) -> Option<u64> {
    ///     Some(id)
    /// }
    /// ```
    ///
    /// Use instead:
    ///
    /// ```rust
    /// pub struct UserId(u64);
    /// pub struct AccountBalance(u64);
    ///
    /// pub fn user(id: UserId) -> Option<AccountBalance> {
    ///     let _ = id;
    ///     None
    /// }
    /// ```
    pub RAW_NUMERIC_PUBLIC_API,
    Allow,
    "raw numeric primitive exposed through an effectively public domain API"
}

declare_lint! {
    /// ### What it does
    ///
    /// Enforces narrow, reason-bearing suppression of `raw_numeric_public_api`.
    /// Suppression is accepted only as an item-level `expect` on a callable or
    /// field and only for serialization, database, or FFI boundaries.
    ///
    /// ### Why is this bad?
    ///
    /// Broad, unexplained, or unrelated suppression silently weakens the domain
    /// API contract for code that is not an infrastructure boundary.
    pub INVALID_RAW_NUMERIC_API_SUPPRESSION,
    Allow,
    "invalid suppression of raw_numeric_public_api"
}

declare_lint_pass! {
    DomainApi => [RAW_NUMERIC_PUBLIC_API, INVALID_RAW_NUMERIC_API_SUPPRESSION]
}

#[unsafe(no_mangle)]
pub fn register_lints(session: &Session, lint_store: &mut LintStore) {
    dylint_linting::init_config(session);
    lint_store.register_lints(&[RAW_NUMERIC_PUBLIC_API, INVALID_RAW_NUMERIC_API_SUPPRESSION]);
    lint_store.register_late_pass(|_| Box::new(DomainApi));
}

impl<'tcx> LateLintPass<'tcx> for DomainApi {
    fn check_crate(&mut self, cx: &LateContext<'tcx>) {
        check_suppression_attributes(cx, cx.tcx.hir_krate_attrs(), SuppressionScope::Broad);
    }

    fn check_mod(
        &mut self,
        cx: &LateContext<'tcx>,
        _module: &'tcx rustc_hir::Mod<'tcx>,
        hir_id: HirId,
    ) {
        if hir_id != CRATE_HIR_ID {
            check_suppressions(cx, hir_id, SuppressionScope::Broad);
        }
    }

    fn check_item(&mut self, cx: &LateContext<'tcx>, item: &'tcx Item<'tcx>) {
        if !matches!(item.kind, ItemKind::Fn { .. } | ItemKind::Mod(..)) {
            check_suppressions(cx, item.hir_id(), SuppressionScope::Broad);
        }
        if matches!(item.kind, ItemKind::Struct(..) | ItemKind::Enum(..))
            && !item.span.from_expansion()
            && cx.effective_visibilities.is_reachable(item.owner_id.def_id)
        {
            let mut visitor = RawNumericHirVisitor(cx, false, Vec::new());
            if let Some(generics) = item.kind.generics() {
                visitor.visit_generics(generics);
            }
            if visitor.1 {
                emit_api_diagnostic(
                    cx,
                    cx.tcx
                        .def_ident_span(item.owner_id.def_id)
                        .unwrap_or(item.span),
                    "reachable struct or enum generic declaration",
                );
            }
        }
    }

    fn check_fn(
        &mut self,
        cx: &LateContext<'tcx>,
        _kind: FnKind<'tcx>,
        declaration: &'tcx FnDecl<'tcx>,
        _body: &'tcx rustc_hir::Body<'tcx>,
        span: Span,
        local_def_id: LocalDefId,
    ) {
        let hir_id = cx.tcx.local_def_id_to_hir_id(local_def_id);
        check_suppressions(cx, hir_id, SuppressionScope::BoundaryItem);
        check_callable(cx, local_def_id, span, declaration);
    }

    fn check_trait_item(&mut self, cx: &LateContext<'tcx>, item: &'tcx TraitItem<'tcx>) {
        match item.kind {
            TraitItemKind::Fn(signature, TraitFn::Required(_)) => {
                check_suppressions(cx, item.hir_id(), SuppressionScope::BoundaryItem);
                check_callable(cx, item.owner_id.def_id, item.ident.span, signature.decl);
            }
            TraitItemKind::Fn(_, TraitFn::Provided(_)) => {}
            _ => check_suppressions(cx, item.hir_id(), SuppressionScope::Broad),
        }
    }

    fn check_impl_item(&mut self, cx: &LateContext<'tcx>, item: &'tcx ImplItem<'tcx>) {
        if !matches!(item.kind, ImplItemKind::Fn(..)) {
            check_suppressions(cx, item.hir_id(), SuppressionScope::Broad);
        }
    }

    fn check_foreign_item(&mut self, cx: &LateContext<'tcx>, item: &'tcx ForeignItem<'tcx>) {
        match item.kind {
            ForeignItemKind::Fn(signature, ..) => {
                check_suppressions(cx, item.hir_id(), SuppressionScope::BoundaryItem);
                check_callable(cx, item.owner_id.def_id, item.ident.span, signature.decl);
            }
            _ => check_suppressions(cx, item.hir_id(), SuppressionScope::Broad),
        }
    }

    fn check_field_def(&mut self, cx: &LateContext<'tcx>, field: &'tcx FieldDef<'tcx>) {
        if !is_struct_or_enum_field(cx, field.hir_id) {
            return;
        }
        check_suppressions(cx, field.hir_id, SuppressionScope::BoundaryItem);
        if field.span.from_expansion() || !cx.effective_visibilities.is_reachable(field.def_id) {
            return;
        }

        let field_ty = cx.tcx.type_of(field.def_id).instantiate_identity();
        let mut visitor = RawNumericHirVisitor(cx, false, Vec::new());
        visitor.visit_ty_unambig(field.ty);
        if contains_raw_numeric(cx, field_ty) || visitor.1 {
            emit_api_diagnostic(cx, field.ty.span, "reachable struct or enum field");
        }
    }

    fn check_variant(&mut self, cx: &LateContext<'tcx>, variant: &'tcx Variant<'tcx>) {
        check_suppressions(cx, variant.hir_id, SuppressionScope::Broad);
    }
}

fn is_struct_or_enum_field(cx: &LateContext<'_>, hir_id: HirId) -> bool {
    matches!(
        cx.tcx.parent_hir_node(hir_id),
        Node::Variant(_)
            | Node::Item(Item {
                kind: ItemKind::Struct(..),
                ..
            })
    )
}

fn contains_raw_numeric<'tcx>(cx: &LateContext<'tcx>, ty: Ty<'tcx>) -> bool {
    let Ok(normalized) = cx.tcx.try_normalize_erasing_regions(cx.typing_env(), ty) else {
        return true;
    };
    let raw_args = |args: ty::GenericArgsRef<'tcx>| {
        args.types()
            .any(|argument| contains_raw_numeric(cx, argument))
    };

    match normalized.kind() {
        ty::Int(_) | ty::Uint(_) | ty::Float(_) => true,
        ty::Adt(_, arguments) | ty::FnDef(_, arguments) => raw_args(arguments),
        ty::Array(element, _) | ty::Slice(element) => contains_raw_numeric(cx, *element),
        ty::RawPtr(element, _) | ty::Ref(_, element, _) => contains_raw_numeric(cx, *element),
        ty::Tuple(elements) => elements
            .iter()
            .any(|element| contains_raw_numeric(cx, element)),
        ty::FnPtr(signature, _) => signature
            .skip_binder()
            .inputs_and_output
            .iter()
            .any(|element| contains_raw_numeric(cx, element)),
        ty::Dynamic(predicates, _) => {
            predicates
                .iter()
                .any(|predicate| match predicate.skip_binder() {
                    ty::ExistentialPredicate::Trait(trait_ref) => raw_args(trait_ref.args),
                    ty::ExistentialPredicate::Projection(projection) => projection
                        .term
                        .as_type()
                        .is_some_and(|term| contains_raw_numeric(cx, term)),
                    ty::ExistentialPredicate::AutoTrait(_) => false,
                })
        }
        ty::Alias(alias) => {
            raw_args(alias.args)
                || matches!(alias.kind, ty::AliasTyKind::Opaque { def_id } if
                    cx.tcx.explicit_item_bounds(def_id).iter_instantiated_copied(cx.tcx, alias.args)
                        .filter_map(|(clause, _)| clause.as_projection_clause())
                        .any(|projection| projection.skip_binder().term.as_type()
                            .is_some_and(|term| contains_raw_numeric(cx, term))))
        }
        _ => false,
    }
}

struct RawNumericHirVisitor<'a, 'tcx>(&'a LateContext<'tcx>, bool, Vec<LocalDefId>);

impl<'tcx> Visitor<'tcx> for RawNumericHirVisitor<'_, 'tcx> {
    fn visit_trait_ref(&mut self, trait_ref: &'tcx TraitRef<'tcx>) {
        if let Res::Def(DefKind::Trait, id) = trait_ref.path.res
            && let Some(id) = id.as_local()
            && !self.2.contains(&id)
        {
            self.2.push(id);
            let (_, _, _, _, _, generics, bounds, _) =
                self.0.tcx.hir_expect_item(id).expect_trait();
            self.visit_generics(generics);
            for bound in bounds {
                self.visit_param_bound(bound);
            }
        }
        intravisit::walk_trait_ref(self, trait_ref);
    }

    fn visit_generic_param(&mut self, param: &'tcx GenericParam<'tcx>) {
        if !matches!(param.kind, GenericParamKind::Const { .. }) {
            intravisit::walk_generic_param(self, param);
        }
    }

    fn visit_ty(&mut self, hir_ty: &'tcx HirTy<'tcx, AmbigArg>) {
        let raw = match hir_ty.kind {
            HirTyKind::Path(QPath::Resolved(_, path)) => match path.res {
                Res::PrimTy(PrimTy::Int(_) | PrimTy::Uint(_) | PrimTy::Float(_)) => true,
                Res::Def(DefKind::TyAlias, id) => {
                    contains_raw_numeric(self.0, self.0.tcx.type_of(id).instantiate_identity())
                }
                _ => false,
            },
            _ => false,
        };
        if raw {
            self.1 = true;
        } else {
            intravisit::walk_ty(self, hir_ty);
        }
    }
}

fn declaration_contains_raw_numeric<'tcx>(
    cx: &LateContext<'tcx>,
    local_def_id: LocalDefId,
    declaration: &'tcx FnDecl<'tcx>,
) -> bool {
    let mut visitor = RawNumericHirVisitor(cx, false, Vec::new());
    visitor.visit_fn_decl(declaration);
    if let Some(generics) = cx.tcx.hir_node_by_def_id(local_def_id).generics() {
        visitor.visit_generics(generics);
    }
    visitor.1
}

fn check_callable<'tcx>(
    cx: &LateContext<'tcx>,
    local_def_id: LocalDefId,
    span: Span,
    declaration: &'tcx FnDecl<'tcx>,
) {
    if span.from_expansion() || !cx.effective_visibilities.is_reachable(local_def_id) {
        return;
    }

    let signature = cx.tcx.fn_sig(local_def_id).instantiate_identity();
    let signature = signature.skip_binder();
    if signature
        .inputs_and_output
        .iter()
        .any(|ty| contains_raw_numeric(cx, ty))
        || declaration_contains_raw_numeric(cx, local_def_id, declaration)
    {
        let diagnostic_span = cx.tcx.def_ident_span(local_def_id).unwrap_or(span);
        emit_api_diagnostic(cx, diagnostic_span, "reachable function signature");
    }
}

#[derive(Clone, Copy)]
enum SuppressionScope {
    BoundaryItem,
    Broad,
}

fn check_suppressions(cx: &LateContext<'_>, hir_id: HirId, scope: SuppressionScope) {
    check_suppression_attributes(cx, cx.tcx.hir_attrs(hir_id), scope);
}

fn check_suppression_attributes(
    cx: &LateContext<'_>,
    attributes: &[Attribute],
    scope: SuppressionScope,
) {
    for attribute in attributes {
        if !attribute_mentions_api_lint(attribute) || attribute.span().from_expansion() {
            continue;
        }

        let problem = if attribute.has_name(sym::allow) {
            "use `expect`, not `allow`, for a reviewed boundary exception"
        } else if !attribute.has_name(sym::expect) {
            continue;
        } else if matches!(scope, SuppressionScope::Broad) {
            "crate, module, type, variant, and other blanket expectations are forbidden"
        } else if let Some(reason) = suppression_reason(attribute) {
            if valid_boundary_reason(&reason.as_str()) {
                continue;
            }
            "reason must identify exactly a serialization, database, or FFI boundary"
        } else {
            "a nonempty boundary reason must be present"
        };

        let diagnostic_span = attribute.path_span().unwrap_or_else(|| attribute.span());
        span_lint_and_help(
            cx,
            INVALID_RAW_NUMERIC_API_SUPPRESSION,
            diagnostic_span,
            "invalid suppression of `raw_numeric_public_api`",
            None,
            problem,
        );
    }
}

fn attribute_mentions_api_lint(attribute: &Attribute) -> bool {
    attribute.meta_item_list().is_some_and(|items| {
        items.iter().any(|item| {
            item.meta_item().is_some_and(|meta| {
                meta.path
                    .segments
                    .last()
                    .is_some_and(|segment| segment.ident.name.as_str() == "raw_numeric_public_api")
            })
        })
    })
}

fn suppression_reason(attribute: &Attribute) -> Option<rustc_span::Symbol> {
    attribute.meta_item_list()?.iter().find_map(|item| {
        let meta = item.meta_item()?;
        meta.has_name(sym::reason)
            .then(|| meta.value_str())
            .flatten()
    })
}

fn valid_boundary_reason(reason: &str) -> bool {
    [
        "serialization boundary:",
        "database boundary:",
        "FFI boundary:",
    ]
    .iter()
    .any(|prefix| {
        reason
            .strip_prefix(prefix)
            .is_some_and(|detail| !detail.trim().is_empty())
    })
}

fn emit_api_diagnostic(cx: &LateContext<'_>, span: Span, boundary: &str) {
    span_lint_and_help(
        cx,
        RAW_NUMERIC_PUBLIC_API,
        span,
        format!("raw numeric primitive exposed in {boundary}"),
        None,
        "introduce a named domain type, or use a validated item-level expectation at a serialization, database, or FFI boundary",
    );
}

#[test]
fn ui() {
    dylint_testing::ui::Test::src_base(env!("CARGO_PKG_NAME"), "ui")
        .rustc_flags([
            "--edition=2024",
            "--warn=raw_numeric_public_api",
            "--warn=invalid_raw_numeric_api_suppression",
        ])
        .run();
}
