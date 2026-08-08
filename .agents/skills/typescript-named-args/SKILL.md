---
name: typescript-named-args
description: >-
  Loom and migrated Nook web TypeScript: ban passing raw object literals into calls. Assign a
  named typed args value first. Enforced by ESLint loom/no-raw-object-arguments in Loom and
  nook-typed-api/no-raw-object-arguments in Nook web.
---

# TypeScript Named Call Arguments

Use this skill when editing Loom or migrated Nook web TypeScript.

Read `.cortex/dynamic-skills/typescript-named-args.md` and apply it:

1. Do not call `fn({ ... })` with an inline object literal.
2. Create a named typed variable/constant, then pass that name.
3. Keep the applicable Loom or web lint task green.
