---
name: typescript-no-unknown
description: >-
  Loom, executable-skill, and migrated Nook web TypeScript: ban authored
  unknown and object. Ban generic value bags in domain or application code.
  Treat existing bags as migration debt, not precedent. Allow unknown only
  inside a dedicated transport adapter that narrows immediately. The object
  type has no exception.
---

# TypeScript No Unknown

Use this skill when editing Loom, executable-skill, or migrated Nook web
TypeScript.

Read `.cortex/dynamic-skills/typescript-no-unknown.md` and apply it:

1. Do not author the `unknown` or `object` type token.
2. Use concrete domain types in state, results, services, commands, and UI APIs.
3. Do not replace `unknown` with `ExternalValue` or another generic value bag.
4. Allow `unknown` only inside a dedicated parser, codec, or message guard.
5. Do not use `object` at that boundary. It claims structure before validation.
6. Narrow that value immediately to a domain type or typed failure.
7. Keep the applicable Loom, executable-skill, or web lint task green.
8. Treat existing generic domain APIs as staged migration debt. Do not expand
   them or cite them as precedent.
