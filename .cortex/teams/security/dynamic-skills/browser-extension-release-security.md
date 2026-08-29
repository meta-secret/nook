# Browser Extension Release Security

## Purpose

Protect every hosted Nook extension artifact and launcher with the same origin,
identity, archive, and browser-profile invariants before expensive full
validation begins.

## Problem Pattern

Channel packaging or launcher changes can accidentally permit widget injection
on Simple/Sentinel vault origins, accept a manifest key from the wrong channel,
follow downloads to another origin, activate an unsafe archive, or reuse a
browser profile across channel identities. These defects are expensive when
found only by asynchronous PR review.

## Preferred Pattern

For a hosted extension change, run `task extension:check:fast` as focused
security proof and verify all of these invariants in code and tests:

- selected Simple plus selected and production Sentinel injection exclusions;
- exact selected-channel externally-connectable and content-script targets;
- manifest-key-derived extension ID equals deployment metadata;
- HTTPS-only downloads whose effective URL remains on the selected origin;
- checksum, root manifest, duplicate/path traversal, and symlink rejection;
- immutable release directories with atomic current-link activation;
- distinct browser profile per channel/PR; and
- explicit Chrome/Brave binaries work outside macOS discovery.

## Scope

Applies to:

- `nook-app/nook-web/nook-web-extension/` build, package, verification, and
  hosted-launcher code.
- PR/main/release workflows that publish or verify extension artifacts.

Does not apply to:

- Browser marketplace signing and store review.
- Product-domain logic outside the browser/packaging boundary.

## Examples

- Before: validate only the selected Sentinel exclusion.
- After: validate Simple, selected Sentinel, and production Sentinel exclusions
  before activation.
- Before: retry the site alias, then verify extension metadata once.
- After: retry exact-head metadata and archive verification with a bounded
  propagation window.

## Application procedure

1. Security defines the invariants and focused acceptance evidence. A Web
   worker owns browser-control implementation, while an SRE worker owns release
   workflow and deployment implementation. Each functional worker formats and
   commits its allowed implementation files; Security does not commit foreign
   implementation.
2. Run `task extension:check:fast` as focused security proof.
3. Verify channel origin and extension identity together.
4. Verify injection exclusions for every vault boundary.
5. Verify archive and redirect safety before activation.
6. Keep profiles isolated by channel and PR.
7. Security reviews the exact functional-owner handoff and focused proof,
   formats and commits only its allowed security-owned Cortex changes, and
   returns its acceptance verdict to Gizmo.
8. Gizmo integrates the accepted handoffs and runs `task loom:pre-push` on the
   combined head. If formatting changes security-owned content, Gizmo returns
   that exact diff to Security for a fresh formatted commit instead of
   committing it.
9. After reintegration and a clean `task loom:pre-push`, Gizmo pushes promptly
   and immediately obtains remote evidence: at least one relevant focused
   remote task for a non-validation-ready head, or complete exact-head
   validation when the head is validation-ready. Gizmo owns readiness and
   merge.

## Validation

Deployment verification must prove:

- the exact head SHA;
- the selected channel and origins;
- the checksum; and
- the packaged manifest.

The security worker returns focused evidence for its exact committed handoff.
Gizmo owns repository-wide validation and PR/check state after integration.
