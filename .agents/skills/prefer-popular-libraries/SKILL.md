---
name: prefer-popular-libraries
description: >-
  Before writing commodity boilerplate in Nook, prefer mature high-adoption npm
  packages and crates.io crates. Reject obscure low-star or low-download
  libraries. Validate candidates with Loom dependencyPopularity.
---

# Prefer Popular Libraries

Use this skill before inventing helpers or adding a new dependency.

Read `.cortex/shared/dynamic-skills/prefer-popular-libraries.md` and apply it:

1. Search for a popular library before hand-rolling diffs, parsers, or similar
   commodity code.
2. Reject packages with tiny GitHub stars or near-zero downloads unless the user
   explicitly requires that package.
3. Keep domain policy in Nook-owned code; libraries cover commodity mechanics.
4. Validate with:

```bash
task loom:dependency-popularity
```
