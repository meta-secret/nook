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

Before pushing a hosted extension change, run `task extension:check:fast` and
verify all of these invariants in code and tests:

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

## Application Checklist

- [ ] Run the host-cached fast extension gate.
- [ ] Verify channel origin and extension identity together.
- [ ] Verify injection exclusions for every vault boundary.
- [ ] Verify archive and redirect safety before activation.
- [ ] Keep profiles isolated by channel/PR.
- [ ] Run the full local/remote final gate after pushing the coherent change.

## Validation

Run `task extension:check:fast` for host-cached unit/manifest/shell proof, then
push and run `task check` for type/build validation concurrently with
the repository-owned PR workflow. Deployment verification must prove the exact
head SHA, selected channel, selected origins, checksum, and packaged manifest.
