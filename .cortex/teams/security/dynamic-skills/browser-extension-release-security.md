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

1. Run `task extension:check:fast` as focused security proof.
2. Verify channel origin and extension identity together.
3. Verify injection exclusions for every vault boundary.
4. Verify archive and redirect safety before activation.
5. Keep profiles isolated by channel and PR.
6. Commit the coherent change and return the exact commit plus focused evidence
   to Gizmo.
7. Gizmo integrates the handoff, runs `task loom:pre-push` on the integrated
   head, pushes promptly, and owns complete exact-head validation, readiness,
   and merge. Focused remote execution is optional after the push.

## Validation

Deployment verification must prove:

- the exact head SHA;
- the selected channel and origins;
- the checksum; and
- the packaged manifest.

The security worker returns focused evidence for its exact committed handoff.
Gizmo owns repository-wide validation and PR/check state after integration.
