# Prefer Popular Libraries

## Relationships

- [Cortex document navigation](cortex-document-map.md)
  - Defines the mandatory relationship and internal-map structure.
  - Apply whenever this skill card changes.
- [Cortex writer](cortex-writer.md)
  - Keeps the card and its navigation summaries concise.
  - Apply while editing or reviewing this guidance.
- [Cortex consistency](cortex-consistency.md)
  - Requires the card to agree with related guidance and current code.
  - Apply when rules, paths, commands, or examples change.

## Document map

- [Purpose](#purpose)
  - Explains why the skill exists and what invariant it protects.
  - Read first to decide whether the skill applies.
- [Problem Pattern](#problem-pattern)
  - Identifies the recurring rejected pattern and its warning signs.
  - Read while locating or reviewing violations.
- [Preferred Pattern](#preferred-pattern)
  - Defines the required structure or behavior.
  - Read before implementing a correction.
- [Scope](#scope)
  - Sets the applicable paths and explicit boundaries.
  - Read before expanding the task.
- [Examples](#examples)
  - Contrasts rejected and preferred forms.
  - Read when the rule needs a concrete illustration.
- [Decision checklist](#decision-checklist)
  - Summarizes the peer checks required before adopting a dependency.
  - Use during implementation and review.
- [Validation](#validation)
  - Names the smallest relevant mechanical and semantic proof.
  - Run before completing the task.

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
5. Validate candidate dependencies with Loom:

```yaml
dependencyPopularity:
  includeRepositoryManifests: true
  minNpmWeeklyDownloads: 10000
  minGitHubStars: 100
  minCratesIoDownloads: 50000
  minCratesIoRecentDownloads: 1000
```

```bash
task loom:dependency-popularity
```

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
- [ ] Run Loom `dependencyPopularity` when adding or reviewing dependencies.
- [ ] Keep domain validation and product policy in Nook-owned code.

## Validation

- `task loom:dependency-popularity`
- Review findings for any `verdict: fail` entries before merge
