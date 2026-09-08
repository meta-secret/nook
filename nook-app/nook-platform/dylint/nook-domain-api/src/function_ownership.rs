use clippy_utils::{diagnostics::span_lint_and_help, is_test_function};
use rustc_ast::attr::AttributeExt;
use rustc_hir::{Attribute, HirId, Item, ItemKind, Node, def::DefKind};
use rustc_lint::{LateContext, LateLintPass};
use rustc_session::{declare_lint, declare_lint_pass, lint::LintExpectationId};
use rustc_span::sym;

declare_lint! {
    /// Detects authored free functions, including private and nested definitions.
    /// An owning type states where an operation belongs; semantic cohesion and
    /// valid typestate transitions still require domain review.
    /// Compiler entrypoints, test modules, registered tests, and external macro
    /// output have external owners. Required standalone callbacks need a checked
    /// expectation.
    pub UNOWNED_FUNCTION,
    Allow,
    "authored function has no struct, enum, or trait owner"
}

declare_lint! {
    /// Requires a free-function `expect` with a concrete FFI or framework reason.
    /// Blanket allowances and expectations on any other scope are forbidden.
    pub INVALID_UNOWNED_FUNCTION_SUPPRESSION,
    Allow,
    "invalid suppression of unowned_function"
}

declare_lint_pass! {
    FunctionOwnership => [UNOWNED_FUNCTION, INVALID_UNOWNED_FUNCTION_SUPPRESSION]
}

#[derive(Clone, Copy)]
struct FunctionOwnershipRequest<'cx, 'tcx> {
    cx: &'cx LateContext<'tcx>,
    item_hir_id: HirId,
}

impl FunctionOwnership {
    fn is_test_code(request: FunctionOwnershipRequest<'_, '_>) -> bool {
        Self::has_test_configuration_before(
            request.cx,
            request.cx.tcx.hir_span(request.item_hir_id),
        ) || request
            .cx
            .tcx
            .hir_parent_iter(request.item_hir_id)
            .any(|(_, node)| match node {
                Node::Item(item) => Self::has_test_configuration_before(request.cx, item.span),
                _ => false,
            })
    }

    fn has_test_configuration_before(cx: &LateContext<'_>, span: rustc_span::Span) -> bool {
        let source_map = cx.tcx.sess.source_map();
        let source_file = source_map.lookup_char_pos(span.lo()).file;
        let Some(source) = source_file.src.as_deref() else {
            return false;
        };
        let offset = (span.lo() - source_file.start_pos).to_usize();
        let Some(prefix) = source.get(..offset) else {
            return false;
        };
        for line in prefix.lines().rev().take(16) {
            let line = line.trim();
            if line.is_empty() || line.starts_with("//") {
                continue;
            }
            if line.starts_with("#[") {
                if line.starts_with("#[cfg(") && line.contains("test") {
                    return true;
                }
                continue;
            }
            break;
        }
        false
    }

    fn has_unowned_function_attribute(request: FunctionOwnershipRequest<'_, '_>) -> bool {
        request
            .cx
            .tcx
            .hir_attrs(request.item_hir_id)
            .iter()
            .any(Self::mentions_lint)
    }

    fn requires_owner(cx: &LateContext<'_>, item: &Item<'_>) -> bool {
        let def_id = item.owner_id.def_id;
        let request = FunctionOwnershipRequest {
            cx,
            item_hir_id: item.hir_id(),
        };
        if !matches!(item.kind, ItemKind::Fn { .. })
            || item.span.in_external_macro(cx.tcx.sess.source_map())
            || cx
                .tcx
                .entry_fn(())
                .is_some_and(|(entry, _)| entry == def_id.to_def_id())
            || (Self::is_test_code(request) && !Self::has_unowned_function_attribute(request))
        {
            return false;
        }
        // Clippy finds compiler-generated test descriptors by name. A nested
        // helper can shadow that name, but is not itself a registered test.
        !(cx.tcx.def_kind(cx.tcx.parent(def_id.to_def_id())) == DefKind::Mod
            && is_test_function(cx.tcx, def_id))
    }

    fn mentions_lint(attribute: &Attribute) -> bool {
        attribute.meta_item_list().is_some_and(|items| {
            items.iter().any(|item| {
                item.meta_item().is_some_and(|meta| {
                    meta.path
                        .segments
                        .last()
                        .is_some_and(|segment| segment.ident.name.as_str() == "unowned_function")
                })
            })
        })
    }

    fn boundary_reason(attribute: &Attribute) -> Option<rustc_span::Symbol> {
        attribute.meta_item_list()?.iter().find_map(|item| {
            let meta = item.meta_item()?;
            meta.has_name(sym::reason)
                .then(|| meta.value_str())
                .flatten()
        })
    }

    fn valid_reason(reason: &str) -> bool {
        ["FFI boundary:", "framework boundary:"]
            .iter()
            .any(|prefix| {
                reason
                    .strip_prefix(prefix)
                    .is_some_and(|detail| !detail.trim().is_empty())
            })
    }
}

impl<'tcx> LateLintPass<'tcx> for FunctionOwnership {
    fn check_item(&mut self, cx: &LateContext<'tcx>, item: &'tcx Item<'tcx>) {
        if Self::requires_owner(cx, item) {
            let ItemKind::Fn { ident, .. } = item.kind else {
                return;
            };
            // Rust expectations inherit into nested items. A boundary exception
            // belongs only to the exact function carrying its attribute.
            if cx
                .tcx
                .lint_level_at_node(UNOWNED_FUNCTION, item.hir_id())
                .lint_id
                .is_some_and(|expectation| {
                    !matches!(expectation, LintExpectationId::Stable { hir_id, .. }
                        if hir_id == item.hir_id())
                })
            {
                span_lint_and_help(
                    cx,
                    INVALID_UNOWNED_FUNCTION_SUPPRESSION,
                    ident.span,
                    "inherited suppression of `unowned_function`",
                    None,
                    "move this function to its owning type or give this required callback its own boundary expectation",
                );
            }
            span_lint_and_help(
                cx,
                UNOWNED_FUNCTION,
                ident.span,
                "authored function has no struct, enum, or trait owner",
                None,
                "move the operation to its meaningful owning type; required standalone callbacks need a boundary expectation",
            );
        }
    }

    fn check_attribute(&mut self, cx: &LateContext<'tcx>, attribute: &'tcx Attribute) {
        if !Self::mentions_lint(attribute)
            || attribute.span().in_external_macro(cx.tcx.sess.source_map())
        {
            return;
        }
        let problem = if attribute.has_name(sym::allow) {
            "use `expect`, not `allow`, for a required standalone callback"
        } else if !attribute.has_name(sym::expect) {
            return;
        } else if !matches!(cx.tcx.hir_node(cx.last_node_with_lint_attrs),
            Node::Item(item) if Self::requires_owner(cx, item))
        {
            "expectations must be on an authored free function requiring a boundary exception"
        } else if let Some(reason) = Self::boundary_reason(attribute) {
            if Self::valid_reason(reason.as_str()) {
                return;
            }
            "reason must name a concrete `FFI boundary:` or `framework boundary:`"
        } else {
            "a nonempty boundary reason must be present"
        };
        span_lint_and_help(
            cx,
            INVALID_UNOWNED_FUNCTION_SUPPRESSION,
            attribute.path_span().unwrap_or_else(|| attribute.span()),
            "invalid suppression of `unowned_function`",
            None,
            problem,
        );
    }
}
