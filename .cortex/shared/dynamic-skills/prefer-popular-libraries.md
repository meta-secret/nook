# Prefer Popular Libraries

## Purpose

Before writing boilerplate, prefer a well-known library that already solves the
problem. Reject obscure packages that almost nobody uses.

## Problem Pattern

Agents reinvent diffs, parsers, HTTP helpers, or small utilities by hand.

Or they add a niche dependency with a handful of GitHub stars and almost no
downloads. That creates maintenance and supply-chain risk.

## Preferred Pattern

1. Before implementing non-domain boilerplate, search for a mature library.
2. Prefer packages/crates with clear majority adoption:
   - high weekly npm downloads or crates.io downloads
   - substantial GitHub stars when a GitHub repo is available
   - active maintenance
3. Avoid libraries with very small stars or near-zero downloads unless the user
   explicitly requires that package.
4. Domain rules, cryptography, vault policy, and product invariants stay in
   Nook-owned code (`nook-core` / Loom codecs). Libraries help with commodity
   mechanics, not product policy.
5. Record candidate adoption evidence from read-only package-registry and
   repository inspection:

```yaml
dependencyPopularity:
  includeRepositoryManifests: true
  minNpmWeeklyDownloads: 10000
  minGitHubStars: 100
  minCratesIoDownloads: 50000
  minCratesIoRecentDownloads: 1000
```

No allowlisted hosted selector executes `dependencyPopularity`. Report that
missing selector to Gizmo when an executable popularity verdict is required.
Do not invoke Loom locally or substitute an unevaluated verdict.

## Scope

Applies to:

- Choosing new npm packages and crates.io crates
- Deciding whether to hand-roll commodity helpers

Does not apply to:

- Nook domain models, crypto, auth, vault storage, or WASM contracts
- Generated bindings and toolchain-pinned packages

## Examples

- Before: hand-written YAML value-kind switches and recursive object diffs
- After: `diff` (`jsdiff`) unified patches for blueprint-vs-received YAML

## Decision checklist

- [ ] Ask whether a popular library already solves the commodity problem.
- [ ] Check stars/downloads before adding a dependency.
- [ ] Record cited stars and download evidence for candidate dependencies.
- [ ] Keep domain validation and product policy in Nook-owned code.

## Validation

- Return the cited adoption evidence with the coherent commit.
- Gizmo runs applicable hosted exact-head validation after push.
- A required executable popularity verdict remains blocked until an
  allowlisted hosted selector exists.
