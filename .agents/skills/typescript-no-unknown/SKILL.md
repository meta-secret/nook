---
name: typescript-no-unknown
description: >-
  Loom and migrated Nook web TypeScript: ban authored unknown and generic value
  bags in domain or application code. Allow a generic transport value only
  inside a dedicated untrusted-input adapter that narrows immediately.
---

# TypeScript No Unknown

Use this skill when editing Loom or migrated Nook web TypeScript.

Read `.cortex/dynamic-skills/typescript-no-unknown.md` and apply it:

1. Do not author the `unknown` type token.
2. Use concrete domain types in state, results, services, commands, and UI APIs.
3. Do not replace `unknown` with `ExternalValue` or another generic value bag.
4. Allow a generic transport value only inside a dedicated parser, codec, or
   message guard.
5. Narrow that value immediately to a domain type or typed failure.
6. Keep the applicable Loom or web lint task green.
