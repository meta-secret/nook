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
2. Security names the focused extension invariants for the handoff. Workers do
   not run the host-cached `task extension:check:fast` gate.
3. Verify channel origin and extension identity together.
4. Verify injection exclusions for every vault boundary.
5. Verify archive and redirect safety before activation.
6. Keep profiles isolated by channel and PR.
7. Security reviews the exact functional-owner handoff, formats and commits
   only its allowed security-owned Cortex changes, and returns a pending
   acceptance verdict to Gizmo.
8. Gizmo continues from the accepted commits and runs `task loom:pre-push` on the
   combined head. If formatting changes security-owned content, Gizmo returns
   that exact diff to Security for a fresh formatted commit instead of
   committing it.
9. After the owner commit and a clean `task loom:pre-push`, Gizmo pushes promptly
   and immediately obtains remote evidence. For a non-validation-ready
   extension head, Gizmo dispatches hosted extension proof. For a
   validation-ready head, Gizmo dispatches complete exact-head validation.
10. Gizmo routes the hosted extension proof plus exact-head deployed channel,
    origin, checksum, and packaged-manifest evidence back to Security. The
    Security verdict stays pending until Security accepts that evidence.
    Gizmo then owns readiness and merge.

## Validation

Deployment verification must prove:

- the exact head SHA;
- the selected channel and origins;
- the checksum; and
- the packaged manifest.

The security worker returns focused evidence for its exact committed handoff.
Gizmo obtains hosted extension proof and deployment evidence and returns both
to Security. Security accepts or rejects that exact-head evidence before
readiness.
